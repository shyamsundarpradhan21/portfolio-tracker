# Broker-sync launcher. Resolves the newest installed claude.exe (the CLI ships
# version-pinned inside the VS Code extension and the Desktop app, so we glob both
# and pick the most recently written) and opens it in Windows Terminal running
# `/sync`. Driven by the DailyBrokerSync logon task and by double-clicking
# scripts/sync.cmd. The `/sync` skill then syncs the 3 zero-touch brokers via
# scripts/sync-brokers.mjs (mint-on-demand) and walks the Kite login.
$ErrorActionPreference = 'Stop'
$proj = Split-Path $PSScriptRoot -Parent

$claude = @(
  Get-ChildItem "$env:USERPROFILE\.vscode\extensions\anthropic.claude-code-*\resources\native-binary\claude.exe" -ErrorAction SilentlyContinue
  Get-ChildItem "$env:LOCALAPPDATA\Packages\Claude_*\LocalCache\Roaming\Claude\claude-code\*\claude.exe" -ErrorAction SilentlyContinue
) | Sort-Object LastWriteTime -Descending | Select-Object -First 1

if (-not $claude) {
  Write-Host "claude.exe not found - is Claude Code installed? (looked in the VS Code extension + Desktop app)"
  Start-Sleep -Seconds 8
  exit 1
}

# Open a real terminal (the TUI + the Kite browser-OAuth need an interactive
# session) in the project dir so .mcp.json connects, and run the skill.
wt -d $proj -- $claude.FullName "/sync"
