# Scheduled Bug Fix Agent Runner
# Waits 6 hours then dispatches DMDeveloper agent via gh copilot CLI
# to fix all bugs/enhancements from test run reports
# Model: Claude Opus 4.6

$delayHours = 6
$delaySeconds = $delayHours * 3600
$promptFile = Join-Path $PSScriptRoot "scheduled-agent-tests-prompt.txt"
$workspaceRoot = Split-Path $PSScriptRoot -Parent
$timestamp = Get-Date -Format 'yyyy-MM-dd-HHmm'
$logFile = Join-Path $workspaceRoot ".github\prompts\Test-Runs\scheduled-bugfix-log-$timestamp.txt"

Write-Host "=== Scheduled Bug Fix Agent Runner ==="
Write-Host "Workspace: $workspaceRoot"
Write-Host "Prompt file: $promptFile"
Write-Host "Log file: $logFile"
Write-Host "Delay: $delayHours hours ($delaySeconds seconds)"
Write-Host "Model: claude-opus-4.6"
Write-Host "Agent: DMDeveloper (adaptive workflow)"
Write-Host "Scheduled to run at: $(Get-Date (Get-Date).AddHours($delayHours) -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host ""
Write-Host "Waiting $delayHours hours..."

Start-Sleep -Seconds $delaySeconds

Write-Host ""
Write-Host "=== Timer expired. Starting bug fix run at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ==="

# Verify game server is running
try {
    $health = Invoke-WebRequest http://localhost:3000/api/health -UseBasicParsing -TimeoutSec 5
    Write-Host "Game server is UP (status $($health.StatusCode))"
} catch {
    Write-Host "WARNING: Game server not responding at localhost:3000."
    Write-Host "Start it with: pnpm -C packages/game-server dev"
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - Game server not running, aborting." | Out-File $logFile
    exit 1
}

# Run gh copilot with the prompt using DMDeveloper agent
Write-Host "Launching gh copilot with Claude Opus 4.6 (DMDeveloper adaptive workflow)..."
"$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - Starting copilot bugfix run" | Out-File $logFile
"Bugs: B01-B14, Enhancements: E01-E05" | Out-File $logFile -Append
"Workflow: Full adaptive (SME research → plan → challenge → implement → verify)" | Out-File $logFile -Append

$promptContent = Get-Content $promptFile -Raw

copilot agent `
    --agent DMDeveloper `
    --model claude-opus-4.6 `
    --reasoning-effort high `
    -p $promptContent `
    2>&1 | Tee-Object -FilePath $logFile -Append

$exitCode = $LASTEXITCODE

Write-Host ""
Write-Host "=== Run complete at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') (exit code: $exitCode) ==="
Write-Host "Log saved to: $logFile"

# If rate limited or failed, log for next retry
if ($exitCode -ne 0) {
    Write-Host "WARNING: Non-zero exit code ($exitCode). Check log for rate limit or errors."
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - Exited with code $exitCode (may need re-run)" | Out-File $logFile -Append
}
