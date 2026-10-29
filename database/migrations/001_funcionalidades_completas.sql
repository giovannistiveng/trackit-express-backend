-- ============================================================================
-- TrackIt Express - Migración 001: funcionalidades completas
-- ============================================================================
-- Aplica sobre una base creada con la versión anterior de schema.sql.
-- Es idempotente: se puede ejecutar varias veces sin error.
--   psql -U postgres -d trackit_express -f database/migrations/001_funcionalidades_completas.sql
-- ============================================================================

BEGIN;

-- Motivo del rechazo del conductor (CU-011)
ALTER TABLE Conductor ADD COLUMN IF NOT EXISTS motivo_rechazo VARCHAR(255);

-- Categoría de vehículo requerida por el envío (opcional) y fecha de creación
ALTER TABLE Envio ADD COLUMN IF NOT EXISTS categoria VARCHAR(50);
ALTER TABLE Envio ADD COLUMN IF NOT EXISTS fecha_creacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_envio_categoria') THEN
    ALTER TABLE Envio ADD CONSTRAINT chk_envio_categoria
      CHECK (categoria IS NULL OR categoria IN ('Moto Express', 'Motocarro', 'Camioneta'));
  END IF;
END $$;

-- Ubicación en tiempo real (CU-008)
CREATE TABLE IF NOT EXISTS Ubicacion_Envio (
    id_ubicacion SERIAL PRIMARY KEY,
    id_envio INTEGER NOT NULL,
    latitud DECIMAL(9,6) NOT NULL CHECK (latitud BETWEEN -90 AND 90),
    longitud DECIMAL(9,6) NOT NULL CHECK (longitud BETWEEN -180 AND 180),
    capturado_en TIMESTAMP NOT NULL,
    recibido_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ubicacion_envio FOREIGN KEY (id_envio) REFERENCES Envio(id_envio),
    CONSTRAINT uq_ubicacion_envio_captura UNIQUE (id_envio, capturado_en)
);

-- Auditoría (E7-HU2)
CREATE TABLE IF NOT EXISTS Auditoria (
    id_auditoria SERIAL PRIMARY KEY,
    fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    id_usuario INTEGER,
    correo_usuario VARCHAR(180),
    accion VARCHAR(80) NOT NULL,
    entidad VARCHAR(40) NOT NULL,
    id_entidad INTEGER,
    detalle VARCHAR(500),
    CONSTRAINT fk_auditoria_usuario FOREIGN KEY (id_usuario) REFERENCES Usuario(id_usuario)
);

CREATE INDEX IF NOT EXISTS idx_envio_fecha_creacion ON Envio(fecha_creacion);
CREATE INDEX IF NOT EXISTS idx_ubicacion_envio ON Ubicacion_Envio(id_envio, capturado_en DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_fecha ON Auditoria(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_accion ON Auditoria(accion);
CREATE INDEX IF NOT EXISTS idx_documento_conductor ON Documento_Conductor(id_conductor);

-- Usuarios con rol Conductor que se registraron antes de esta versión: crear su perfil
INSERT INTO Conductor (id_usuario, estado_aprobacion)
SELECT u.id_usuario, 'Pendiente'
FROM Usuario u
JOIN Rol r ON r.id_rol = u.id_rol AND r.nombre_rol = 'Conductor'
WHERE NOT EXISTS (SELECT 1 FROM Conductor c WHERE c.id_usuario = u.id_usuario);

COMMIT;
