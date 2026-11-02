-- ============================================================================
-- TrackIt Express - Migración 003: tarifas automáticas y zonas geográficas
-- ============================================================================
-- * Zona_Tarifa pasa a ser un área en el mapa (centro + radio) con un recargo.
--   La columna tarifa_base se conserva y ahora significa "recargo de la zona".
-- * Tarifa_Vehiculo: banderazo, valor por km, valor por minuto y mínimo por vehículo.
-- * Envio guarda la duración estimada y el desglose de la tarifa.
-- Idempotente: se puede ejecutar varias veces sin error (npm run db:migrate).
-- ============================================================================

BEGIN;

ALTER TABLE Zona_Tarifa ADD COLUMN IF NOT EXISTS centro_lat DECIMAL(9,6);
ALTER TABLE Zona_Tarifa ADD COLUMN IF NOT EXISTS centro_lon DECIMAL(9,6);
ALTER TABLE Zona_Tarifa ADD COLUMN IF NOT EXISTS radio_km DECIMAL(6,2) NOT NULL DEFAULT 3;
ALTER TABLE Zona_Tarifa ADD COLUMN IF NOT EXISTS activa BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE Zona_Tarifa ADD COLUMN IF NOT EXISTS descripcion VARCHAR(200);

ALTER TABLE Zona_Tarifa DROP CONSTRAINT IF EXISTS chk_zona_radio;
ALTER TABLE Zona_Tarifa ADD CONSTRAINT chk_zona_radio CHECK (radio_km > 0 AND radio_km <= 60);

-- Ubicación en el mapa de las zonas iniciales (si aún no la tienen)
UPDATE Zona_Tarifa SET centro_lat = 4.336500, centro_lon = -74.363800, radio_km = 3.5
 WHERE nombre_zona = 'Casco Urbano' AND centro_lat IS NULL;
UPDATE Zona_Tarifa SET centro_lat = 4.403600, centro_lon = -74.388100, radio_km = 3
 WHERE nombre_zona = 'Silvania' AND centro_lat IS NULL;
UPDATE Zona_Tarifa SET centro_lat = 4.308600, centro_lon = -74.300600, radio_km = 3
 WHERE nombre_zona = 'Pasca' AND centro_lat IS NULL;

-- La tarifa base pasa a ser un recargo pequeño (solo si conservan los valores del seed original;
-- lo que un administrador haya cambiado se respeta)
UPDATE Zona_Tarifa SET tarifa_base = 0    WHERE nombre_zona = 'Casco Urbano'     AND tarifa_base = 5000;
UPDATE Zona_Tarifa SET tarifa_base = 1500 WHERE nombre_zona = 'Vereda Pekín'     AND tarifa_base = 8000;
UPDATE Zona_Tarifa SET tarifa_base = 2000 WHERE nombre_zona = 'Vereda Novillero' AND tarifa_base = 9000;
UPDATE Zona_Tarifa SET tarifa_base = 2000 WHERE nombre_zona IN ('Silvania', 'Pasca') AND tarifa_base = 12000;

UPDATE Zona_Tarifa SET descripcion = 'Casco urbano de Fusagasugá' WHERE nombre_zona = 'Casco Urbano' AND descripcion IS NULL;
UPDATE Zona_Tarifa SET descripcion = 'Vereda de Fusagasugá' WHERE nombre_zona IN ('Vereda Pekín', 'Vereda Novillero') AND descripcion IS NULL;
UPDATE Zona_Tarifa SET descripcion = 'Municipio vecino (norte)' WHERE nombre_zona = 'Silvania' AND descripcion IS NULL;
UPDATE Zona_Tarifa SET descripcion = 'Municipio vecino (oriente)' WHERE nombre_zona = 'Pasca' AND descripcion IS NULL;

-- Área rural alrededor de Fusagasugá: atrapa cualquier punto que no esté en una zona más específica
INSERT INTO Zona_Tarifa (nombre_zona, tarifa_base, centro_lat, centro_lon, radio_km, descripcion)
VALUES ('Rural Fusagasugá', 1500, 4.336500, -74.363800, 12, 'Veredas y fincas a menos de 12 km del centro')
ON CONFLICT (nombre_zona) DO NOTHING;

CREATE TABLE IF NOT EXISTS Tarifa_Vehiculo (
    categoria VARCHAR(50) PRIMARY KEY CHECK (categoria IN ('Moto Express', 'Motocarro', 'Camioneta')),
    banderazo DECIMAL(10,2) NOT NULL CHECK (banderazo >= 0),
    por_km DECIMAL(10,2) NOT NULL CHECK (por_km >= 0),
    por_minuto DECIMAL(10,2) NOT NULL CHECK (por_minuto >= 0),
    minimo DECIMAL(10,2) NOT NULL CHECK (minimo >= 0),
    actualizado TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO Tarifa_Vehiculo (categoria, banderazo, por_km, por_minuto, minimo) VALUES
    ('Moto Express', 2000, 700, 50, 4500),
    ('Motocarro', 4000, 950, 80, 8000),
    ('Camioneta', 10000, 1600, 120, 18000)
ON CONFLICT (categoria) DO NOTHING;

ALTER TABLE Envio ADD COLUMN IF NOT EXISTS duracion_min INTEGER;
ALTER TABLE Envio ADD COLUMN IF NOT EXISTS desglose JSONB;

COMMIT;
