# Scheduled Agent Test Runner
# Waits 3 hours then runs remaining agent-player scenarios via gh copilot CLI
# Model: Claude Opus 4.6

$delayHours = 3
$delaySeconds = $delayHours * 3600
$promptFile = Join-Path $PSScriptRoot "scheduled-agent-tests-prompt.txt"
$workspaceRoot = Split-Path $PSScriptRoot -Parent
$logFile = Join-Path $workspaceRoot ".github\prompts\Test-Runs\scheduled-run-log-$(Get-Date -Format 'yyyy-MM-dd-HHmm').txt"

Write-Host "=== Scheduled Agent Test Runner ==="
Write-Host "Workspace: $workspaceRoot"
Write-Host "Prompt file: $promptFile"
Write-Host "Log file: $logFile"
Write-Host "Delay: $delayHours hours ($delaySeconds seconds)"
Write-Host "Model: claude-opus-4.6"
Write-Host "Scheduled to run at: $(Get-Date (Get-Date).AddHours($delayHours) -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host ""
Write-Host "Waiting $delayHours hours..."

Start-Sleep -Seconds $delaySeconds

Write-Host ""
Write-Host "=== Timer expired. Starting agent test run at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ==="

# Verify game server is running
try {
    $health = Invoke-WebRequest http://localhost:3000/api/health -UseBasicParsing -TimeoutSec 5
    Write-Host "Game server is UP (status $($health.StatusCode))"
} catch {
    Write-Host "WARNING: Game server not responding at localhost:3000. Tests may fail."
    Write-Host "Start it with: pnpm -C packages/game-server dev"
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - Game server not running, aborting." | Out-File $logFile
    exit 1
}

# Run gh copilot with the prompt
Write-Host "Launching gh copilot with Claude Opus 4.6..."
"$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - Starting copilot run" | Out-File $logFile

$promptContent = Get-Content $promptFile -Raw

gh copilot -- `
    --model "claude-opus-4.6" `
    --no-custom-instructions `
    --allow-all `
    --add-dir $workspaceRoot `
    -p $promptContent `
    2>&1 | Tee-Object -FilePath $logFile

Write-Host ""
Write-Host "=== Run complete at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ==="
Write-Host "Log saved to: $logFile"
