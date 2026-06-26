Write-Host "=== Cleaning old builds ===" -ForegroundColor Cyan
if (Test-Path dist) { Remove-Item -Recurse -Force dist }
if (Test-Path dist-dev) { Remove-Item -Recurse -Force dist-dev }

Write-Host "=== Building ===" -ForegroundColor Cyan
pnpm build

if ($LASTEXITCODE -eq 0) {
    Write-Host "=== Build succeeded! ===" -ForegroundColor Green
} else {
    Write-Host "=== Build failed. Check errors above. ===" -ForegroundColor Red
}

Read-Host "Press Enter to exit"
