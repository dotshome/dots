# Keeps the dot.home server running on this computer: starts it, and restarts it if it ever stops.
# Started hidden at logon by start-hidden.vbs (via the "dot.home" scheduled task). Output goes to data\server.log.
$root = Split-Path $PSScriptRoot -Parent
$data = Join-Path $PSScriptRoot 'data'
$log = Join-Path $data 'server.log'
New-Item -ItemType Directory -Force $data | Out-Null

# only one keeper at a time, however many times this gets launched
$mutex = New-Object System.Threading.Mutex($false, 'Local\dothome-server')
if (-not $mutex.WaitOne(0)) { exit }

# while the keeper runs, ask Windows not to idle-sleep (like a video player does). Changes no settings;
# the request ends when this process ends. Closing the lid still follows the power plan's lid action.
Add-Type -Namespace DotHome -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
[void][DotHome.Power]::SetThreadExecutionState([uint32]2147483649) # ES_CONTINUOUS (0x80000000) | ES_SYSTEM_REQUIRED (0x1)

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = Join-Path $env:ProgramFiles 'nodejs\node.exe' }
# paused on purpose (pause.ps1): don't start, even at logon, until resume.ps1 removes this marker
$paused = Join-Path $data 'PAUSED'
Set-Location $root
while (-not (Test-Path $paused)) {
  if ((Test-Path $log) -and (Get-Item $log).Length -gt 5MB) { Move-Item -Force $log "$log.old" }
  Add-Content -Encoding utf8 $log "$(Get-Date -Format s) keeper: starting server"
  cmd /c "`"$node`" server/server.js >> `"$log`" 2>&1"
  if (Test-Path $paused) { break }
  Add-Content -Encoding utf8 $log "$(Get-Date -Format s) keeper: server exited ($LASTEXITCODE), restarting in 5s"
  Start-Sleep -Seconds 5
}
Add-Content -Encoding utf8 $log "$(Get-Date -Format s) keeper: the world is paused - not running it (resume.ps1 starts it again)"
