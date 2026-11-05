-- ============================================
-- TrackIt Express - Datos Iniciales (Seed)
-- PostgreSQL
-- ============================================

-- Insertar roles
INSERT INTO Rol (nombre_rol) VALUES
    ('Administrador'),
    ('Cliente'),
    ('Conductor')
ON CONFLICT (nombre_rol) DO NOTHING;

-- Zonas de cobertura: centro + radio en el mapa y recargo (tarifa_base) en COP.
-- Un punto pertenece a la zona más pequeña que lo contiene.
INSERT INTO Zona_Tarifa (nombre_zona, tarifa_base, centro_lat, centro_lon, radio_km, descripcion) VALUES
    ('Casco Urbano', 0, 4.336500, -74.363800, 3.5, 'Casco urbano de Fusagasugá'),
    ('Vereda Pekín', 1500, NULL, NULL, 3, 'Vereda de Fusagasugá'),
    ('Vereda Novillero', 2000, NULL, NULL, 3, 'Vereda de Fusagasugá'),
    ('Silvania', 2000, 4.403600, -74.388100, 3, 'Municipio vecino (norte)'),
    ('Pasca', 2000, 4.308600, -74.300600, 3, 'Municipio vecino (oriente)'),
    ('Rural Fusagasugá', 1500, 4.336500, -74.363800, 12, 'Veredas y fincas a menos de 12 km del centro')
ON CONFLICT (nombre_zona) DO NOTHING;

-- Tarifas por vehículo (COP)
INSERT INTO Tarifa_Vehiculo (categoria, banderazo, por_km, por_minuto, minimo) VALUES
    ('Moto Express', 2000, 700, 50, 4500),
    ('Motocarro', 4000, 950, 80, 8000),
    ('Camioneta', 10000, 1600, 120, 18000)
ON CONFLICT (categoria) DO NOTHING;

-- Usuario administrador inicial
-- Correo: admin@trackit.com.co  ·  Contraseña: Admin2026*
-- Cámbiala después del primer despliegue (hash bcrypt, 10 rondas).
INSERT INTO Usuario (nombre, correo, password_hash, id_rol) VALUES
    ('Administrador Sistema', 'admin@trackit.com.co', '$2a$10$9DBt5o56nGOPPDbVZE4nv.4xhynqYZhS2JeqLepCq0TDYaTuzW6oi', (SELECT id_rol FROM Rol WHERE nombre_rol = 'Administrador'))
ON CONFLICT (correo) DO UPDATE SET password_hash = EXCLUDED.password_hash
WHERE Usuario.password_hash LIKE '$2b$10$rX2k8J8J8%';

-- El administrador inicial tiene el correo verificado
UPDATE Usuario SET correo_verificado = TRUE WHERE correo = 'admin@trackit.com.co' AND correo_verificado = FALSE;
