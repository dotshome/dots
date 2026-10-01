# Pauses dot.home: the world freezes at this exact moment, the public site shows PAUSED,
# and nothing runs on this computer (not even at logon) until resume.ps1.
$data = Join-Path $PSScriptRoot 'data'
New-Item -ItemType Directory -Force $data | Out-Null
try {
  $r = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:5182/admin/pause' -TimeoutSec 20
  Write-Host "dot.home is paused at day $($r.day), $($r.clock)."
} catch {
  # the server wasn't running: just make sure it stays off
  Set-Content -Encoding utf8 (Join-Path $data 'PAUSED') (Get-Date -Format s)
  Write-Host 'The server was not running. Marked as paused so it stays off.'
}
