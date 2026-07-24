$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

$VirtualEnv = Join-Path $ProjectRoot ".venv"
$PythonExe = Join-Path $VirtualEnv "Scripts\python.exe"
$RequirementsFile = Join-Path $PSScriptRoot "requirements.txt"
$EnvExampleFile = Join-Path $PSScriptRoot ".env.example"
$EnvFile = Join-Path $ProjectRoot ".env"

if (-not (Test-Path $PythonExe)) {
    Write-Host "正在创建 Python 3.12 虚拟环境..." -ForegroundColor Cyan

    $PythonLauncher = Get-Command py -ErrorAction SilentlyContinue
    if ($null -eq $PythonLauncher) {
        Write-Host "未找到 py.exe，请先安装 Python 3.12。" -ForegroundColor Red
        Write-Host "安装完成后运行 py -0p，确认列表中存在 Python 3.12。" -ForegroundColor Yellow
        exit 1
    }

    & py -3.12 -m venv $VirtualEnv

    if ($LASTEXITCODE -ne 0) {
        Write-Host "创建 Python 3.12 虚拟环境失败。" -ForegroundColor Red
        Write-Host "请运行 py -0p 检查 Python 3.12 是否已安装。" -ForegroundColor Yellow
        exit $LASTEXITCODE
    }
}

$PythonVersionText = (& $PythonExe --version 2>&1 | Out-String).Trim()

if ($PythonVersionText -notmatch "^Python 3\.12(\.|$)") {
    Write-Host "当前虚拟环境版本不正确：$PythonVersionText" -ForegroundColor Red
    Write-Host "请删除项目根目录中的 .venv 文件夹，然后重新运行本脚本。" -ForegroundColor Yellow
    exit 1
}

Write-Host "当前解释器：$PythonVersionText" -ForegroundColor Cyan
Write-Host "正在安装后端依赖..." -ForegroundColor Cyan

& $PythonExe -m pip install -r $RequirementsFile

if ($LASTEXITCODE -ne 0) {
    Write-Host "后端依赖安装失败。" -ForegroundColor Red
    exit $LASTEXITCODE
}

if (-not (Test-Path $EnvFile)) {
    if (Test-Path $EnvExampleFile) {
        Copy-Item $EnvExampleFile $EnvFile
        Write-Host ""
        Write-Host "已创建 .env 文件。" -ForegroundColor Yellow
        Write-Host "请填写 LLM_API_KEY，然后重新运行本脚本。" -ForegroundColor Yellow
        exit 0
    }

    Write-Host "未找到 server\.env.example。" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "PDF Helper 后端：http://127.0.0.1:8000" -ForegroundColor Green
Write-Host "健康检查：http://127.0.0.1:8000/health" -ForegroundColor Green
Write-Host "按 Ctrl+C 可停止服务。" -ForegroundColor DarkGray
Write-Host ""

& $PythonExe -m uvicorn server.app:app `
    --host 127.0.0.1 `
    --port 8000 `
    --reload
