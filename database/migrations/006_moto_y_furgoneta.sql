-- ============================================================================
-- TrackIt Express - Migración 006: solo dos vehículos, Moto Express y Furgoneta
-- ============================================================================
-- * La moto hace mandados, mercados y paquetes livianos (hasta 20 kg).
-- * La furgoneta hace trasteos y la carga pesada (hasta 1.500 kg).
-- * Motocarro, Camioneta y Camión pasan a ser Furgoneta (vehículos registrados y pedidos).
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

SELECT pg_temp.quitar_checks('vehiculo', 'categoria');
SELECT pg_temp.quitar_checks('tarifa_vehiculo', 'categoria');
SELECT pg_temp.quitar_checks('envio', 'categoria');

-- Vehículos y pedidos existentes
UPDATE Vehiculo SET categoria = 'Furgoneta' WHERE categoria IN ('Motocarro', 'Camioneta', 'Camión');
UPDATE Envio SET categoria = 'Furgoneta' WHERE categoria IN ('Motocarro', 'Camioneta', 'Camión');

-- Tarifas: la de la furgoneta queda editable por el administrador
INSERT INTO Tarifa_Vehiculo (categoria, banderazo, por_km, por_minuto, minimo)
VALUES ('Furgoneta', 12000, 1800, 150, 22000)
ON CONFLICT (categoria) DO NOTHING;
DELETE FROM Tarifa_Vehiculo WHERE categoria NOT IN ('Moto Express', 'Furgoneta');

ALTER TABLE Vehiculo ADD CONSTRAINT chk_vehiculo_categoria
  CHECK (categoria IN ('Moto Express', 'Furgoneta'));
ALTER TABLE Tarifa_Vehiculo ADD CONSTRAINT chk_tarifa_categoria
  CHECK (categoria IN ('Moto Express', 'Furgoneta'));
ALTER TABLE Envio ADD CONSTRAINT chk_envio_categoria
  CHECK (categoria IS NULL OR categoria IN ('Moto Express', 'Furgoneta'));

COMMIT;
