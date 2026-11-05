-- ============================================================================
-- TrackIt Express - Migración 004: cuentas, pagos, tiempo real y envíos avanzados
-- ============================================================================
-- * Verificación de correo y recuperación de contraseña (Token_Usuario)
-- * Pagos con Nequi y efectivo (Pago) y liquidación semanal a conductores (Liquidacion)
-- * Suscripciones a notificaciones push (web y app móvil)
-- * Enlace público de seguimiento y datos de quien recibe
-- * Envíos programados, paradas intermedias e ida y vuelta (Parada_Envio)
-- * Chat entre cliente y conductor (Mensaje_Chat) y foto de recogida
-- * Eliminación de zonas sin perder el historial (eliminada)
-- Idempotente: se puede ejecutar varias veces sin error (npm run db:migrate).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------- Cuentas
-- Las cuentas que ya existían quedan verificadas (al crear la columna con DEFAULT TRUE);
-- las nuevas nacen sin verificar.
ALTER TABLE Usuario ADD COLUMN IF NOT EXISTS correo_verificado BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE Usuario ALTER COLUMN correo_verificado SET DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS Token_Usuario (
    id_token SERIAL PRIMARY KEY,
    id_usuario INTEGER NOT NULL REFERENCES Usuario(id_usuario) ON DELETE CASCADE,
    tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('verificacion', 'recuperacion')),
    token_hash CHAR(64) NOT NULL UNIQUE,
    expira TIMESTAMP NOT NULL,
    usado_en TIMESTAMP,
    creado TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_token_usuario ON Token_Usuario(id_usuario, tipo);

-- ---------------------------------------------------------------- Zonas
ALTER TABLE Zona_Tarifa ADD COLUMN IF NOT EXISTS eliminada BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------- Envíos
ALTER TABLE Envio ADD COLUMN IF NOT EXISTS metodo_pago VARCHAR(20) NOT NULL DEFAULT 'efectivo';
ALTER TABLE Envio ADD COLUMN IF NOT EXISTS token_seguimiento VARCHAR(40);
ALTER TABLE Envio ADD COLUMN IF NOT EXISTS destinatario_nombre VARCHAR(120);
ALTER TABLE Envio ADD COLUMN IF NOT EXISTS destinatario_telefono VARCHAR(20);
ALTER TABLE Envio ADD COLUMN IF NOT EXISTS fecha_programada TIMESTAMP;
ALTER TABLE Envio ADD COLUMN IF NOT EXISTS aviso_programado BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE Envio ADD COLUMN IF NOT EXISTS ida_y_vuelta BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE Envio ADD COLUMN IF NOT EXISTS destino_visitado_en TIMESTAMP;
ALTER TABLE Envio ADD COLUMN IF NOT EXISTS url_foto_recogida VARCHAR(500);
ALTER TABLE Envio ADD COLUMN IF NOT EXISTS fecha_recogida TIMESTAMP;

ALTER TABLE Envio DROP CONSTRAINT IF EXISTS chk_envio_metodo_pago;
ALTER TABLE Envio ADD CONSTRAINT chk_envio_metodo_pago CHECK (metodo_pago IN ('efectivo', 'nequi'));

-- Enlace de seguimiento para los envíos existentes (32 caracteres aleatorios)
UPDATE Envio SET token_seguimiento = md5(random()::text || clock_timestamp()::text || id_envio::text)
 WHERE token_seguimiento IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_envio_token_seguimiento ON Envio(token_seguimiento);
CREATE INDEX IF NOT EXISTS idx_envio_programado ON Envio(fecha_programada) WHERE fecha_programada IS NOT NULL;

CREATE TABLE IF NOT EXISTS Parada_Envio (
    id_parada SERIAL PRIMARY KEY,
    id_envio INTEGER NOT NULL REFERENCES Envio(id_envio) ON DELETE CASCADE,
    orden SMALLINT NOT NULL CHECK (orden BETWEEN 1 AND 10),
    direccion VARCHAR(200) NOT NULL,
    lat DECIMAL(9,6) NOT NULL,
    lon DECIMAL(9,6) NOT NULL,
    notas VARCHAR(200),
    completada_en TIMESTAMP,
    CONSTRAINT uq_parada_orden UNIQUE (id_envio, orden)
);

-- ---------------------------------------------------------------- Pagos
CREATE TABLE IF NOT EXISTS Liquidacion (
    id_liquidacion SERIAL PRIMARY KEY,
    id_conductor INTEGER NOT NULL REFERENCES Conductor(id_conductor),
    desde DATE NOT NULL,
    hasta DATE NOT NULL,
    servicios INTEGER NOT NULL DEFAULT 0,
    total_tarifas DECIMAL(12,2) NOT NULL DEFAULT 0,
    ganancia_conductor DECIMAL(12,2) NOT NULL DEFAULT 0,
    cobrado_efectivo DECIMAL(12,2) NOT NULL DEFAULT 0,
    comision_efectivo DECIMAL(12,2) NOT NULL DEFAULT 0,
    -- Positivo: la plataforma le paga al conductor. Negativo: el conductor le debe a la plataforma.
    saldo DECIMAL(12,2) NOT NULL DEFAULT 0,
    estado VARCHAR(20) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'pagada')),
    referencia VARCHAR(100),
    creada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    pagada_en TIMESTAMP,
    CONSTRAINT uq_liquidacion_periodo UNIQUE (id_conductor, desde, hasta)
);

CREATE TABLE IF NOT EXISTS Pago (
    id_pago SERIAL PRIMARY KEY,
    id_envio INTEGER NOT NULL UNIQUE REFERENCES Envio(id_envio),
    metodo VARCHAR(20) NOT NULL CHECK (metodo IN ('efectivo', 'nequi')),
    estado VARCHAR(30) NOT NULL CHECK (estado IN (
        'pendiente', 'aprobado', 'rechazado', 'expirado',
        'por_cobrar', 'cobrado', 'anulado', 'reembolso_pendiente', 'reembolsado')),
    monto DECIMAL(12,2) NOT NULL CHECK (monto >= 0),
    telefono VARCHAR(10),
    transaccion_id VARCHAR(100),
    mensaje VARCHAR(255),
    intentos INTEGER NOT NULL DEFAULT 0,
    creado TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    aprobado_en TIMESTAMP,
    id_liquidacion INTEGER REFERENCES Liquidacion(id_liquidacion),
    -- Envíos anteriores al sistema de pagos: no entran en las liquidaciones
    historico BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_pago_estado ON Pago(metodo, estado);
ALTER TABLE Pago ADD COLUMN IF NOT EXISTS historico BOOLEAN NOT NULL DEFAULT FALSE;

-- Los envíos que ya existían se pagan en efectivo. Los ya entregados quedan como históricos
-- para no cobrar comisiones de semanas anteriores al sistema de pagos.
INSERT INTO Pago (id_envio, metodo, estado, monto, historico)
SELECT e.id_envio, 'efectivo',
       CASE ult.estado WHEN 'Entregado' THEN 'cobrado' WHEN 'Cancelado' THEN 'anulado' ELSE 'por_cobrar' END,
       e.tarifa,
       COALESCE(ult.estado IN ('Entregado', 'Cancelado'), FALSE)
  FROM Envio e
  LEFT JOIN LATERAL (
    SELECT h.estado FROM Historial_Estado h WHERE h.id_envio = e.id_envio
     ORDER BY h.fecha_cambio DESC, h.id_historial DESC LIMIT 1
  ) ult ON TRUE
 WHERE NOT EXISTS (SELECT 1 FROM Pago p WHERE p.id_envio = e.id_envio);

-- ---------------------------------------------------------------- Chat
CREATE TABLE IF NOT EXISTS Mensaje_Chat (
    id_mensaje SERIAL PRIMARY KEY,
    id_envio INTEGER NOT NULL REFERENCES Envio(id_envio) ON DELETE CASCADE,
    id_usuario INTEGER NOT NULL REFERENCES Usuario(id_usuario),
    texto VARCHAR(500) NOT NULL,
    leido BOOLEAN NOT NULL DEFAULT FALSE,
    creado TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chat_envio ON Mensaje_Chat(id_envio, creado);

-- ---------------------------------------------------------------- Notificaciones push
CREATE TABLE IF NOT EXISTS Suscripcion_Push (
    id_suscripcion SERIAL PRIMARY KEY,
    id_usuario INTEGER NOT NULL REFERENCES Usuario(id_usuario) ON DELETE CASCADE,
    plataforma VARCHAR(10) NOT NULL CHECK (plataforma IN ('web', 'android', 'ios')),
    -- Web: endpoint del navegador. Android/iOS: token de Firebase Cloud Messaging.
    endpoint VARCHAR(700) NOT NULL UNIQUE,
    p256dh VARCHAR(200),
    auth VARCHAR(100),
    creada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_push_usuario ON Suscripcion_Push(id_usuario);

-- Las notificaciones se pueden borrar sin romper nada
ALTER TABLE Notificacion DROP CONSTRAINT IF EXISTS fk_notificacion_envio;
ALTER TABLE Notificacion ADD CONSTRAINT fk_notificacion_envio FOREIGN KEY (id_envio) REFERENCES Envio(id_envio) ON DELETE SET NULL;

COMMIT;
