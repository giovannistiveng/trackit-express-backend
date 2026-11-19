<#
  Ejecuta un plan de JMeter en modo consola y genera el reporte HTML.

  Ejemplos:
    .\carga\ejecutar.ps1                                   # prueba de carga contra localhost:3000
    .\carga\ejecutar.ps1 -Plan estres                      # prueba de estrés por escalones
    .\carga\ejecutar.ps1 -Extra '-Jusuarios=100','-Jduracion=600'
    .\carga\ejecutar.ps1 -Servidor 192.168.56.10 -Puerto 3000

  Requiere JMeter 5.6+ en el PATH o la variable JMETER_HOME.
#>
param(
  [ValidateSet('carga', 'estres')][string]$Plan = 'carga',
  [string]$Servidor = 'localhost',
  [int]$Puerto = 3000,
  [ValidateSet('http', 'https')][string]$Protocolo = 'http',
  [string[]]$Extra = @()
)
$ErrorActionPreference = 'Stop'

$jmeter = if ($env:JMETER_HOME) { Join-Path $env:JMETER_HOME 'bin\jmeter.bat' } else { 'jmeter' }
if (-not (Get-Command $jmeter -ErrorAction SilentlyContinue)) {
  throw 'No encuentro JMeter. Agrega su carpeta bin al PATH o define JMETER_HOME.'
}

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
& $jmeter @argumentos
if ($LASTEXITCODE -ne 0) { throw "JMeter terminó con código $LASTEXITCODE" }
Write-Host "Reporte: $salida\reporte\index.html"
