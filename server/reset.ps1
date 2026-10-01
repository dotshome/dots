# Starts the world over at day 1. The current world is archived first (server/data/backups), and the
# dots' chronicle starts over with it. A running world restarts fresh; a paused one stays paused
# until resume.ps1, and starts fresh then.
$data = Join-Path $PSScriptRoot 'data'
$world = Join-Path $data 'world.json'
$running = [bool](Get-NetTCPConnection -LocalPort 5182 -State Listen -ErrorAction SilentlyContinue)
if ($running) { & (Join-Path $PSScriptRoot 'pause.ps1') | Out-Null; Start-Sleep -Seconds 2 }

if (Test-Path $world) {
  $backups = Join-Path $data 'backups'
  New-Item -ItemType Directory -Force $backups | Out-Null
  $stamp = Get-Date -Format 'yyyy-MM-ddTHH-mm-ss'
  Move-Item $world (Join-Path $backups "world-reset-$stamp.json")
  Write-Host "The old world is archived as backups\world-reset-$stamp.json"
}
Remove-Item (Join-Path $data 'chronicle.json') -ErrorAction SilentlyContinue

if ($running) { & (Join-Path $PSScriptRoot 'resume.ps1') | Out-Null; Write-Host 'A new world begins: day 1. The site shows it within about 15 seconds.' }
else { Write-Host 'Ready: the next time it runs (resume.cmd), a new world begins at day 1.' }
