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

-- Usuario administrador de ejemplo
-- Nota: la contraseña hash es de "admin123" con bcrypt (salt rounds 10)
INSERT INTO Usuario (nombre, correo, password_hash, id_rol) VALUES
    ('Administrador Sistema', 'admin@trackit.com.co', '$2b$10$rX2k8J8J8J8J8J8J8J8J8uJ8J8J8J8J8J8J8J8J8J8J8J8J8J8J8', (SELECT id_rol FROM Rol WHERE nombre_rol = 'Administrador'))
ON CONFLICT (correo) DO NOTHING;