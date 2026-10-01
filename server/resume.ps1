# Resumes dot.home after pause.ps1: the world carries on from the moment it was paused (nothing is replayed),
# and the public site goes back to LIVE.
$data = Join-Path $PSScriptRoot 'data'
$paused = Join-Path $data 'PAUSED'
if (Test-Path $paused) { Move-Item -Force $paused (Join-Path $data 'RESUMING') }
Start-ScheduledTask -TaskName 'dot.home'
Write-Host 'dot.home is starting again. The site shows LIVE within about 15 seconds.'
