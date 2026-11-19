# Pruebas de carga y estrés (Apache JMeter)

Planes de JMeter para medir cómo responde el backend de TrackIt Express con muchos usuarios a la vez.

| Archivo | Para qué sirve |
| --- | --- |
| `jmeter/carga.jmx` | **Carga:** la demanda esperada, sostenida (por defecto 50 clientes + 20 visitantes durante 5 min). |
| `jmeter/estres.jmx` | **Estrés:** sube por escalones (50 → 100 → 200 → 400 clientes) para encontrar el punto de quiebre. |
| `jmeter/puntos.csv` | Destinos reales dentro de la cobertura (Fusagasugá, Silvania, Pasca, Chinauta…). |
| `.env.carga.example` | Entorno del backend para estas pruebas. |
| `ejecutar.ps1` / `ejecutar.sh` | Corren JMeter en consola y generan el reporte HTML. |

## Qué hace cada usuario virtual

**Clientes** (una sola vez): se registran con su propio correo (`carga.<grupo>.<n>@trackit.test`) e inician sesión.
Luego, en bucle y con una pausa de 1 ± 1 s entre vueltas:

1. **Inicio del cliente:** perfil, notificaciones sin leer y envíos activos.
2. **Cotizar:** zonas y cotización hacia un destino de `puntos.csv`.
3. **30 %** de las vueltas crea un envío en efectivo y consulta su detalle y su seguimiento.
4. **10 %** de las vueltas crea un envío pagado con Nequi (simulado) y consulta el estado del pago.

**Visitantes** (sin sesión): `/health`, estadísticas, tarifas y zonas de la página pública.

Cada petición verifica el código HTTP esperado, y la cotización verifica que traiga `tarifa_total`. Toda petición
que tarde más de `limite_ms` (2 s por defecto) cuenta como error.

## 1. Preparar el backend

Las pruebas crean miles de usuarios y envíos: usa **una base de datos aparte**, nunca la de producción.

```powershell
# 1. Crea la base vacía (psql, pgAdmin o Docker)
psql -U postgres -c "CREATE DATABASE trackit_carga"

# 2. Copia el entorno de carga y ajusta usuario y contraseña de PostgreSQL
copy carga\.env.carga.example carga\.env.carga

# 3. Compila y crea las tablas en esa base
npm run carga:preparar

# 4. Levanta el backend en modo carga (déjalo corriendo en otra terminal)
npm run carga:servidor
```

El entorno de carga apaga lo que no se debe medir ni disparar:

| Variable | Valor | Por qué |
| --- | --- | --- |
| `RATE_LIMIT_DISABLED` | `true` | JMeter manda todo desde una IP; con el límite activo el login respondería 429. |
| `GEO_MODO` | `sin-red` | Las rutas se estiman sin consultar OpenStreetMap (no abusar de un servicio público ni medirlo a él). |
| `NEQUI_MODO` | `simulado` | No se cobra nada; el pago se aprueba a los 2 s. |
| `SMTP_HOST`, `VAPID_*`… | vacías | No se envían correos ni notificaciones reales. |
| `LOG_LEVEL` | `WARN` | Menos escritura en disco durante la prueba. |

## 2. Ejecutar

Requisitos: **Java 17+** y **Apache JMeter 5.6+** (con su carpeta `bin` en el `PATH` o la variable `JMETER_HOME`).

```powershell
# Prueba de carga (desde la carpeta del backend)
powershell -ExecutionPolicy Bypass -File carga\ejecutar.ps1

# Prueba de estrés
powershell -ExecutionPolicy Bypass -File carga\ejecutar.ps1 -Plan estres

# Con otros valores
powershell -ExecutionPolicy Bypass -File carga\ejecutar.ps1 -Extra '-Jusuarios=100','-Jduracion=600'

# Contra la máquina virtual
powershell -ExecutionPolicy Bypass -File carga\ejecutar.ps1 -Servidor 192.168.56.10
```

En Linux o macOS: `carga/ejecutar.sh carga` o `carga/ejecutar.sh estres -Jpaso4=300`.

Cada ejecución queda en `carga/resultados/<plan>-<fecha>/`: `resultados.jtl` (datos crudos), `jmeter.log` y
`reporte/index.html` (el dashboard de JMeter). Esa carpeta no se sube a git.

> Para editar o depurar los planes abre el `.jmx` en la interfaz de JMeter (`jmeter.bat`) y activa
> «Árbol de resultados». Para las mediciones de verdad usa siempre el modo consola: la interfaz consume
> mucha memoria y altera los tiempos.

### Parámetros (`-J<nombre>=<valor>`)

| Parámetro | Por defecto | Plan | Qué controla |
| --- | --- | --- | --- |
| `host`, `puerto`, `protocolo` | `localhost`, `3000`, `http` | ambos | Dónde está el backend. |
| `usuarios` | 50 | carga | Clientes simultáneos. |
| `visitantes` | 20 | ambos | Visitantes simultáneos de la página pública. |
| `rampa` | 60 (carga) / 30 (estrés) | ambos | Segundos para llegar al total de usuarios de cada grupo. |
| `duracion` | 300 | carga | Segundos que dura la prueba. |
| `paso1` … `paso4` | 50, 50, 100, 200 | estrés | Clientes que se suman en cada escalón (total 50 → 100 → 200 → 400). |
| `escalon` | 120 | estrés | Segundos de cada escalón (la prueba dura 4 × escalón). |
| `pausa` | 1000 | ambos | Pausa base entre vueltas, en ms (se le suma de 0 a 1 s al azar). |
| `limite_ms` | 2000 | ambos | Una respuesta más lenta que esto cuenta como error. |

## 3. Criterios de aceptación

**Carga** (la prueba pasa si se cumplen todos):

- Errores < **1 %** de las peticiones.
- Percentil 95 < **1 s** y percentil 99 < **2 s** en cada transacción.
- El rendimiento (peticiones/s) se mantiene estable después de la rampa.

**Estrés** (no «pasa» o «falla»: busca el límite):

- El **punto de quiebre** es el primer escalón con errores > 5 % o percentil 95 > 3 s. Anota cuántos usuarios había.
- El backend no debe caerse; al terminar, `/health` responde 200 y la app sigue funcionando.
- Revisa en `logs/carga/errores-*.txt` qué falló primero (base de datos, tiempo de espera, memoria…).

## 4. Leer el reporte

En `reporte/index.html`:

- **Statistics:** por cada transacción, el número de peticiones, el % de error y los percentiles 90/95/99.
  Las filas «01 Inicio del cliente», «02 Cotizar», «03 Crear envío…» agrupan las peticiones de cada paso.
- **Errors / Top 5 errors by sampler:** qué falló y por qué (código HTTP o aserción).
- **Charts → Over Time:** *Response Times Over Time* y *Active Threads Over Time* juntos muestran en qué escalón
  empieza a degradarse el servicio en la prueba de estrés.
- **APDEX:** satisfacción (1 = todo rápido). Por defecto, satisfecho < 500 ms y tolerable < 1,5 s.

## Recomendaciones

- Corre JMeter en un equipo distinto al del backend o, al menos, sin otros programas pesados abiertos.
- Antes de repetir una prueba, puedes vaciar la base: `DROP DATABASE trackit_carga` y repetir el paso 1.
- Si ves errores `Non HTTP response code: java.net.BindException`, el equipo de JMeter se quedó sin puertos:
  baja los usuarios o sube la pausa.
