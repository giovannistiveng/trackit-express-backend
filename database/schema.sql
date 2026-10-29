-- ============================================
-- TrackIt Express - Esquema de Base de Datos
-- PostgreSQL
-- ============================================

-- Tabla: Rol
CREATE TABLE IF NOT EXISTS Rol (
    id_rol SERIAL PRIMARY KEY,
    nombre_rol VARCHAR(80) NOT NULL UNIQUE CHECK (nombre_rol IN ('Administrador', 'Cliente', 'Conductor'))
);

-- Tabla: Usuario
CREATE TABLE IF NOT EXISTS Usuario (
    id_usuario SERIAL PRIMARY KEY,
    nombre VARCHAR(120) NOT NULL,
    correo VARCHAR(180) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    id_rol INTEGER NOT NULL,
    telefono VARCHAR(20),
    fecha_registro TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_usuario_rol FOREIGN KEY (id_rol) REFERENCES Rol(id_rol)
);

-- Tabla: Conductor
CREATE TABLE IF NOT EXISTS Conductor (
    id_conductor SERIAL PRIMARY KEY,
    estado_aprobacion VARCHAR(30) NOT NULL DEFAULT 'Pendiente' CHECK (estado_aprobacion IN ('Pendiente', 'Aprobado', 'Rechazado')),
    motivo_rechazo VARCHAR(255),
    id_usuario INTEGER NOT NULL UNIQUE,
    CONSTRAINT fk_conductor_usuario FOREIGN KEY (id_usuario) REFERENCES Usuario(id_usuario)
);

-- Tabla: Vehiculo
CREATE TABLE IF NOT EXISTS Vehiculo (
    id_vehiculo SERIAL PRIMARY KEY,
    placa VARCHAR(20) NOT NULL UNIQUE,
    categoria VARCHAR(50) NOT NULL CHECK (categoria IN ('Moto Express', 'Motocarro', 'Camioneta')),
    id_conductor INTEGER NOT NULL,
    CONSTRAINT fk_vehiculo_conductor FOREIGN KEY (id_conductor) REFERENCES Conductor(id_conductor)
);

-- Tabla: Documento_Conductor
CREATE TABLE IF NOT EXISTS Documento_Conductor (
    id_documento SERIAL PRIMARY KEY,
    tipo_documento VARCHAR(50) NOT NULL CHECK (tipo_documento IN ('Cédula', 'SOAT', 'Licencia')),
    url_archivo VARCHAR(500) NOT NULL,
    id_conductor INTEGER NOT NULL,
    fecha_subida TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_documento_conductor FOREIGN KEY (id_conductor) REFERENCES Conductor(id_conductor)
);


-- Tabla: Zona_Tarifa
CREATE TABLE IF NOT EXISTS Zona_Tarifa (
    id_zona SERIAL PRIMARY KEY,
    nombre_zona VARCHAR(100) NOT NULL UNIQUE,
    tarifa_base DECIMAL(12,2) NOT NULL DEFAULT 0
);

-- Tabla: Envio
CREATE TABLE IF NOT EXISTS Envio (
    id_envio SERIAL PRIMARY KEY,
    origen VARCHAR(200) NOT NULL,
    destino VARCHAR(200) NOT NULL,
    tipo_carga VARCHAR(80) NOT NULL,
    tarifa DECIMAL(12,2) NOT NULL,
    pin_seguridad VARCHAR(20),
    id_cliente INTEGER NOT NULL,
    id_conductor INTEGER,
    id_zona INTEGER NOT NULL,
    categoria VARCHAR(50) CHECK (categoria IS NULL OR categoria IN ('Moto Express', 'Motocarro', 'Camioneta')),
    fecha_creacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    origen_lat DECIMAL(9,6),
    origen_lon DECIMAL(9,6),
    destino_lat DECIMAL(9,6),
    destino_lon DECIMAL(9,6),
    distancia_km DECIMAL(8,2),
    notas VARCHAR(300),
    motivo_cancelacion VARCHAR(255),
    CONSTRAINT fk_envio_cliente FOREIGN KEY (id_cliente) REFERENCES Usuario(id_usuario),
    CONSTRAINT fk_envio_conductor FOREIGN KEY (id_conductor) REFERENCES Conductor(id_conductor),
    CONSTRAINT fk_envio_zona FOREIGN KEY (id_zona) REFERENCES Zona_Tarifa(id_zona)
);

-- Tabla: Historial_Estado
CREATE TABLE IF NOT EXISTS Historial_Estado (
    id_historial SERIAL PRIMARY KEY,
    estado VARCHAR(40) NOT NULL,
    fecha_cambio TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    id_envio INTEGER NOT NULL,
    CONSTRAINT chk_historial_estado CHECK (estado IN ('Pendiente', 'Asignado', 'En Ruta', 'Entregado', 'Cancelado')),
    CONSTRAINT fk_historial_envio FOREIGN KEY (id_envio) REFERENCES Envio(id_envio)
);

-- Tabla: Evidencia_Entrega
CREATE TABLE IF NOT EXISTS Evidencia_Entrega (
    id_evidencia SERIAL PRIMARY KEY,
    url_foto VARCHAR(500) NOT NULL,
    fecha_subida TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    id_envio INTEGER NOT NULL UNIQUE,
    CONSTRAINT fk_evidencia_envio FOREIGN KEY (id_envio) REFERENCES Envio(id_envio)
);

-- Tabla: Calificacion
CREATE TABLE IF NOT EXISTS Calificacion (
    id_calificacion SERIAL PRIMARY KEY,
    puntuacion DECIMAL(3,2) NOT NULL CHECK (puntuacion >= 1 AND puntuacion <= 5),
    comentario VARCHAR(300),
    id_envio INTEGER NOT NULL UNIQUE,
    CONSTRAINT fk_calificacion_envio FOREIGN KEY (id_envio) REFERENCES Envio(id_envio)
);

-- Tabla: Ubicacion_Envio (posición del conductor durante el servicio)
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

-- Tabla: Auditoria (acciones relevantes de los usuarios)
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

-- Tabla: Notificacion (avisos dentro de la aplicación)
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

-- Tabla: Contacto (formulario del sitio público)
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

-- Índices para optimizar consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_usuario_correo ON Usuario(correo);
CREATE INDEX IF NOT EXISTS idx_usuario_rol ON Usuario(id_rol);
CREATE INDEX IF NOT EXISTS idx_conductor_usuario ON Conductor(id_usuario);
CREATE INDEX IF NOT EXISTS idx_vehiculo_conductor ON Vehiculo(id_conductor);
CREATE INDEX IF NOT EXISTS idx_envio_cliente ON Envio(id_cliente);
CREATE INDEX IF NOT EXISTS idx_envio_conductor ON Envio(id_conductor);
CREATE INDEX IF NOT EXISTS idx_envio_zona ON Envio(id_zona);
CREATE INDEX IF NOT EXISTS idx_historial_envio ON Historial_Estado(id_envio);
CREATE INDEX IF NOT EXISTS idx_evidencia_envio ON Evidencia_Entrega(id_envio);
CREATE INDEX IF NOT EXISTS idx_calificacion_envio ON Calificacion(id_envio);
CREATE INDEX IF NOT EXISTS idx_envio_fecha_creacion ON Envio(fecha_creacion);
CREATE INDEX IF NOT EXISTS idx_ubicacion_envio ON Ubicacion_Envio(id_envio, capturado_en DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_fecha ON Auditoria(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_accion ON Auditoria(accion);
CREATE INDEX IF NOT EXISTS idx_documento_conductor ON Documento_Conductor(id_conductor);
CREATE INDEX IF NOT EXISTS idx_notificacion_usuario ON Notificacion(id_usuario, leida, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_contacto_fecha ON Contacto(fecha DESC);
