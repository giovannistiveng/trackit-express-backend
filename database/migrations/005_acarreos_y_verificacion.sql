-- ============================================================================
-- TrackIt Express - Migración 005: acarreos, entrega sin confusiones y verificación
-- ============================================================================
-- * Tipos de servicio (mandado, mercado, paquete, trasteo, insumos del campo) con su detalle
-- * Vehículo "Camión" para trasteos e insumos pesados
-- * Etapas de la entrega: llegada a recoger, código de recogida, bultos, llegada al destino
-- * Valor de la compra en mandados y mercados (se paga contra la factura)
-- * Verificación de conductores por documento: estado, motivo, vencimiento y suspensión
-- Idempotente: se puede ejecutar varias veces sin error (npm run db:migrate).
-- ============================================================================

BEGIN;

-- Quita las restricciones CHECK de una columna (los nombres los generó PostgreSQL)
CREATE OR REPLACE FUNCTION pg_temp.quitar_checks(tabla TEXT, columna TEXT) RETURNS VOID AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'c' AND c.conrelid = tabla::regclass AND a.attname = columna
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', tabla, r.conname);
  END LOOP;
END $$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------- Camión
SELECT pg_temp.quitar_checks('vehiculo', 'categoria');
ALTER TABLE Vehiculo ADD CONSTRAINT chk_vehiculo_categoria
  CHECK (categoria IN ('Moto Express', 'Motocarro', 'Camioneta', 'Camión'));
SELECT pg_temp.quitar_checks('tarifa_vehiculo', 'categoria');
ALTER TABLE Tarifa_Vehiculo ADD CONSTRAINT chk_tarifa_categoria
  CHECK (categoria IN ('Moto Express', 'Motocarro', 'Camioneta', 'Camión'));
SELECT pg_temp.quitar_checks('envio', 'categoria');
ALTER TABLE Envio ADD CONSTRAINT chk_envio_categoria
  CHECK (categoria IS NULL OR categoria IN ('Moto Express', 'Motocarro', 'Camioneta', 'Camión'));

-- ---------------------------------------------------------------- Tipos de servicio
ALTER TABLE Envio ADD COLUMN IF NOT EXISTS tipo_servicio VARCHAR(20) NOT NULL DEFAULT 'paquete';
SELECT pg_temp.quitar_checks('envio', 'tipo_servicio');
ALTER TABLE Envio ADD CONSTRAINT chk_envio_tipo_servicio
  CHECK (tipo_servicio IN ('mandado', 'mercado', 'paquete', 'trasteo', 'insumos'));
ALTER TABLE Envio ADD COLUMN IF NOT EXISTS detalle_servicio JSONB;

-- ---------------------------------------------------------------- Etapas de la entrega
ALTER TABLE Envio ADD COLUMN IF NOT EXISTS codigo_recogida VARCHAR(6);
ALTER TABLE Envio ADD COLUMN IF NOT EXISTS llegada_recogida_en TIMESTAMP;
ALTER TABLE Envio ADD COLUMN IF NOT EXISTS llegada_destino_en TIMESTAMP;
ALTER TABLE Envio ADD COLUMN IF NOT EXISTS bultos_recogidos SMALLINT;
ALTER TABLE Envio ADD COLUMN IF NOT EXISTS valor_compra DECIMAL(12,2);

-- ---------------------------------------------------------------- Verificación de conductores
SELECT pg_temp.quitar_checks('conductor', 'estado_aprobacion');
ALTER TABLE Conductor ADD CONSTRAINT chk_conductor_estado
  CHECK (estado_aprobacion IN ('Pendiente', 'Aprobado', 'Rechazado', 'Suspendido'));

SELECT pg_temp.quitar_checks('documento_conductor', 'tipo_documento');
ALTER TABLE Documento_Conductor ADD CONSTRAINT chk_documento_tipo
  CHECK (tipo_documento IN ('Cédula', 'Selfie', 'Licencia', 'SOAT', 'Tecnomecánica', 'Tarjeta de propiedad', 'Antecedentes'));
ALTER TABLE Documento_Conductor ADD COLUMN IF NOT EXISTS estado VARCHAR(20) NOT NULL DEFAULT 'Pendiente';
SELECT pg_temp.quitar_checks('documento_conductor', 'estado');
ALTER TABLE Documento_Conductor ADD CONSTRAINT chk_documento_estado
  CHECK (estado IN ('Pendiente', 'Aprobado', 'Rechazado'));
ALTER TABLE Documento_Conductor ADD COLUMN IF NOT EXISTS motivo_rechazo VARCHAR(255);
ALTER TABLE Documento_Conductor ADD COLUMN IF NOT EXISTS fecha_vencimiento DATE;
ALTER TABLE Documento_Conductor ADD COLUMN IF NOT EXISTS revisado_en TIMESTAMP;
ALTER TABLE Documento_Conductor ADD COLUMN IF NOT EXISTS aviso_vencimiento_en TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_documento_conductor ON Documento_Conductor (id_conductor, tipo_documento, fecha_subida DESC);

-- Los documentos de conductores ya aprobados se consideran revisados
UPDATE Documento_Conductor d SET estado = 'Aprobado', revisado_en = CURRENT_TIMESTAMP
FROM Conductor c
WHERE c.id_conductor = d.id_conductor AND c.estado_aprobacion = 'Aprobado' AND d.estado = 'Pendiente' AND d.revisado_en IS NULL;

COMMIT;
