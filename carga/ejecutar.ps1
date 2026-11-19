<#
  Ejecuta un plan de JMeter en modo consola y genera el reporte HTML.

  Ejemplos:
    .\carga\ejecutar.ps1                                   # prueba de carga contra localhost:3000
    .\carga\ejecutar.ps1 -Plan estres                      # prueba de estrés por escalones
    .\carga\ejecutar.ps1 -Extra '-Jusuarios=100','-Jduracion=600'
    .\carga\ejecutar.ps1 -Servidor 192.168.56.10 -Puerto 3000
    .\carga\ejecutar.ps1 -JMeter "D:\herramientas\apache-jmeter-5.6.3"

  Busca JMeter en -JMeter, JMETER_HOME, el PATH y en carpetas apache-jmeter* de C:\, Descargas,
  Escritorio, la carpeta del usuario y Archivos de programa.
#>
param(
  [ValidateSet('carga', 'estres')][string]$Plan = 'carga',
  [string]$JMeter = '',
  [string]$Servidor = 'localhost',
  [int]$Puerto = 3000,
  [ValidateSet('http', 'https')][string]$Protocolo = 'http',
  [string[]]$Extra = @()
)
$ErrorActionPreference = 'Stop'

function Find-JMeter {
  # 1) -JMeter  2) JMETER_HOME (de esta sesión o guardada en el usuario)  3) PATH  4) carpetas típicas
  $homeUsuario = [Environment]::GetEnvironmentVariable('JMETER_HOME', 'User')
  $candidatos = @()
  if ($JMeter) { $candidatos += $JMeter, (Join-Path $JMeter 'bin\jmeter.bat') }
  foreach ($h in @($env:JMETER_HOME, $homeUsuario)) {
    if ($h) { $candidatos += (Join-Path $h 'bin\jmeter.bat'), (Join-Path $h 'jmeter.bat') }
  }
  $enPath = Get-Command 'jmeter.bat', 'jmeter' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($enPath) { $candidatos += $enPath.Source }
  $raices = @('C:\', $env:USERPROFILE, (Join-Path $env:USERPROFILE 'Downloads'), (Join-Path $env:USERPROFILE 'Descargas'),
    (Join-Path $env:USERPROFILE 'Desktop'), (Join-Path $env:USERPROFILE 'Escritorio'), $env:ProgramFiles)
  foreach ($r in $raices) {
    if (-not $r -or -not (Test-Path $r)) { continue }
    foreach ($d in Get-ChildItem -Path $r -Directory -Filter 'apache-jmeter*' -ErrorAction SilentlyContinue) {
      $candidatos += (Join-Path $d.FullName 'bin\jmeter.bat')
      # El .zip a veces queda en una carpeta doble: apache-jmeter-5.6.3\apache-jmeter-5.6.3
      foreach ($i in Get-ChildItem -Path $d.FullName -Directory -Filter 'apache-jmeter*' -ErrorAction SilentlyContinue) {
        $candidatos += (Join-Path $i.FullName 'bin\jmeter.bat')
      }
    }
  }
  foreach ($c in $candidatos) {
    if ($c -and (Test-Path $c -PathType Leaf)) { return (Resolve-Path $c).Path }
  }
  return $null
}

$ejecutable = Find-JMeter
if (-not $ejecutable) {
  throw ('No encuentro JMeter (jmeter.bat). Descomprime el .zip de jmeter.apache.org en C:\ ' +
    '(queda C:\apache-jmeter-5.6.3) o pasa la ruta: -JMeter "C:\ruta\apache-jmeter-5.6.3"')
}
if (-not (Get-Command 'java' -ErrorAction SilentlyContinue)) {
  throw 'No encuentro Java. Instala un JDK 17 o superior y abre una PowerShell nueva.'
}
Write-Host "JMeter: $ejecutable"

$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
$salida = Join-Path $aqui ("resultados\{0}-{1}" -f $Plan, (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Force -Path $salida | Out-Null

$argumentos = @(
  '-n', '-t', (Join-Path $aqui "jmeter\$Plan.jmx"),
  '-l', (Join-Path $salida 'resultados.jtl'),
  '-j', (Join-Path $salida 'jmeter.log'),
  '-e', '-o', (Join-Path $salida 'reporte'),
  "-Jhost=$Servidor", "-Jpuerto=$Puerto", "-Jprotocolo=$Protocolo"
) + $Extra

Write-Host "Ejecutando $Plan contra ${Protocolo}://${Servidor}:$Puerto ..."
& $ejecutable @argumentos
if ($LASTEXITCODE -ne 0) { throw "JMeter terminó con código $LASTEXITCODE" }
Write-Host "Reporte: $salida\reporte\index.html"
