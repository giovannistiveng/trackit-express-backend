-- ============================================================================
-- TrackIt Express - Migración 002: operación ampliada
-- ============================================================================
-- Cancelación de envíos, coordenadas y notas del envío, perfil del usuario,
-- comentario en la calificación, notificaciones y formulario de contacto.
-- Idempotente: se puede ejecutar varias veces sin error (npm run db:migrate).
-- ============================================================================

BEGIN;

-- Perfil del usuario
ALTER TABLE Usuario ADD COLUMN IF NOT EXISTS telefono VARCHAR(20);
ALTER TABLE Usuario ADD COLUMN IF NOT EXISTS fecha_registro TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Envío: coordenadas geocodificadas, distancia, notas para el conductor y motivo de cancelación
ALTER TABLE Envio ADD COLUMN IF NOT EXISTS origen_lat DECIMAL(9,6);
ALTER TABLE Envio ADD COLUMN IF NOT EXISTS origen_lon DECIMAL(9,6);
ALTER TABLE Envio ADD COLUMN IF NOT EXISTS destino_lat DECIMAL(9,6);
ALTER TABLE Envio ADD COLUMN IF NOT EXISTS destino_lon DECIMAL(9,6);
ALTER TABLE Envio ADD COLUMN IF NOT EXISTS distancia_km DECIMAL(8,2);
ALTER TABLE Envio ADD COLUMN IF NOT EXISTS notas VARCHAR(300);
ALTER TABLE Envio ADD COLUMN IF NOT EXISTS motivo_cancelacion VARCHAR(255);

-- Nuevo estado: Cancelado
ALTER TABLE Historial_Estado DROP CONSTRAINT IF EXISTS historial_estado_estado_check;
ALTER TABLE Historial_Estado DROP CONSTRAINT IF EXISTS chk_historial_estado;
ALTER TABLE Historial_Estado ADD CONSTRAINT chk_historial_estado
  CHECK (estado IN ('Pendiente', 'Asignado', 'En Ruta', 'Entregado', 'Cancelado'));

-- Comentario opcional en la calificación (E7-HU1)
ALTER TABLE Calificacion ADD COLUMN IF NOT EXISTS comentario VARCHAR(300);

-- Notificaciones dentro de la aplicación
CREATE TABLE IF NOT EXISTS Notificacion (
    id_notificacion SERIAL PRIMARY KEY,
    id_usuario INTEGER NOT NULL,
    tipo VARCHAR(40) NOT NULL,
    titulo VARCHAR(120) NOT NULL,
    mensaje VARCHAR(300) NOT NULL,
    id_envio INTEGER,
    leida BOOLEAN NOT NULL DEFAULT FALSE,
    fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_notificacion_usuario FOREIGN KEY (id_usuario) REFERENCES Usuario(id_usuario),
    CONSTRAINT fk_notificacion_envio FOREIGN KEY (id_envio) REFERENCES Envio(id_envio)
);
CREATE INDEX IF NOT EXISTS idx_notificacion_usuario ON Notificacion(id_usuario, leida, fecha DESC);

-- Mensajes del formulario de contacto del sitio público
CREATE TABLE IF NOT EXISTS Contacto (
    id_contacto SERIAL PRIMARY KEY,
    nombre VARCHAR(120) NOT NULL,
    correo VARCHAR(180) NOT NULL,
    telefono VARCHAR(20),
    asunto VARCHAR(40) NOT NULL DEFAULT 'General',
    mensaje VARCHAR(1000) NOT NULL,
    atendido BOOLEAN NOT NULL DEFAULT FALSE,
    fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_contacto_fecha ON Contacto(fecha DESC);

COMMIT;
