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

-- Insertar zonas de tarifa
INSERT INTO Zona_Tarifa (nombre_zona, tarifa_base) VALUES
    ('Casco Urbano', 5000.00),
    ('Vereda Pekín', 8000.00),
    ('Vereda Novillero', 9000.00),
    ('Silvania', 12000.00),
    ('Pasca', 12000.00)
ON CONFLICT (nombre_zona) DO NOTHING;

-- Usuario administrador inicial
-- Correo: admin@trackit.com.co  ·  Contraseña: Admin2026*
-- Cámbiala después del primer despliegue (hash bcrypt, 10 rondas).
INSERT INTO Usuario (nombre, correo, password_hash, id_rol) VALUES
    ('Administrador Sistema', 'admin@trackit.com.co', '$2a$10$9DBt5o56nGOPPDbVZE4nv.4xhynqYZhS2JeqLepCq0TDYaTuzW6oi', (SELECT id_rol FROM Rol WHERE nombre_rol = 'Administrador'))
ON CONFLICT (correo) DO UPDATE SET password_hash = EXCLUDED.password_hash
WHERE Usuario.password_hash LIKE '$2b$10$rX2k8J8J8%';
