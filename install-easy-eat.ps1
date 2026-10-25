param(
    [switch]$Yes,
    [switch]$SkipLaunch
)

$ErrorActionPreference = 'Stop'

$Source        = $PSScriptRoot
$AppHome       = Join-Path $env:LOCALAPPDATA 'EasyEat\app'
$SkillSource   = Join-Path $Source 'skills\easy-eat'
$SkillTarget   = Join-Path $env:USERPROFILE '.workbuddy\skills\easy-eat'
$ResultDir     = Join-Path $env:LOCALAPPDATA 'EasyEat'
$ResultPath    = Join-Path $ResultDir 'install-result.json'
$JevKeyFile    = Join-Path $env:USERPROFILE '.jevmodel\api_key.txt'
$McpConfigFile = Join-Path $env:USERPROFILE '.workbuddy\mcp.json'

New-Item -ItemType Directory -Force -Path $ResultDir | Out-Null

$result = [ordered]@{
    ok            = $false
    appHome       = $AppHome
    skillDir      = $SkillTarget
    node          = $null
    workbuddyExe  = $null
    mcp           = 'missing'
    jev           = 'missing'
    jevHealth     = 'skipped'
    petStarted    = $false
    workbuddyOpen = $false
    message       = ''
    finishedAt    = (Get-Date).ToString('s')
}

function Save-Result {
    $result.finishedAt = (Get-Date).ToString('s')
    ($result | ConvertTo-Json -Depth 4) | Set-Content -Path $ResultPath -Encoding UTF8
}

function Fail-Install {
    param([int]$Code, [string]$Message)
    $result.ok = $false
    $result.message = $Message
    Save-Result
    Write-Host ''
    Write-Host "[FAIL] $Message" -ForegroundColor Red
    Write-Host "结果文件: $ResultPath"
    exit $Code
}

function Write-Step {
    param([string]$Text)
    Write-Host ''
    Write-Host "== $Text ==" -ForegroundColor Cyan
}

function Find-WorkBuddy {
    $registry = Get-ItemProperty 'HKCU:\Software\Classes\workbuddy\shell\open\command' -ErrorAction SilentlyContinue
    if ($registry -and $registry.'(default)') {
        if ($registry.'(default)' -match '"([^"]+\.exe)"') {
            if (Test-Path $matches[1]) { return $matches[1] }
        }
    }

    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\WorkBuddy\WorkBuddy.exe'),
        (Join-Path $env:ProgramFiles 'WorkBuddy\WorkBuddy.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'WorkBuddy\WorkBuddy.exe'),
        'D:\LenovoSoftstore\Install\WorkBuddy\WorkBuddy.exe'
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path $candidate)) { return $candidate }
    }

    $process = Get-Process WorkBuddy -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($process -and $process.Path -and (Test-Path $process.Path)) { return $process.Path }
    return $null
}

function Find-WorkBuddyNode {
    $versions = Join-Path $env:USERPROFILE '.workbuddy\binaries\node\versions'
    if (Test-Path $versions) {
        $node = Get-ChildItem $versions -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending |
            ForEach-Object { Join-Path $_.FullName 'node.exe' } |
            Where-Object { Test-Path $_ } |
            Select-Object -First 1
        if ($node) { return $node }
    }

    $command = Get-Command node -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    return $null
}

function Get-McpToken {
    if ($env:MCD_MCP_TOKEN -and $env:MCD_MCP_TOKEN.Trim()) {
        return $env:MCD_MCP_TOKEN.Trim()
    }
    if (Test-Path $McpConfigFile) {
        try {
            $config = Get-Content $McpConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
            $auth = $config.mcpServers.'mcd-mcp'.headers.Authorization
            if ($auth -match '^\s*Bearer\s+(.+?)\s*$') { return $matches[1] }
        } catch { }
    }
    return $null
}

function Read-JevKey {
    if (Test-Path $JevKeyFile) {
        $key = (Get-Content $JevKeyFile -Raw -ErrorAction SilentlyContinue).Trim()
        if ($key) { return $key }
    }
    return $null
}

Write-Host 'Easy Eat / 简单麦 安装器' -ForegroundColor Yellow
Write-Host '安装不会上传任何 Token/Key；只写本机固定目录。'

Write-Step '1/6 检查 WorkBuddy'
$workbuddy = Find-WorkBuddy
if (-not $workbuddy) {
    Fail-Install 10 '没有找到 WorkBuddy。请先安装并登录 WorkBuddy，再运行本安装器。'
}
$result.workbuddyExe = $workbuddy
Write-Host "WorkBuddy: $workbuddy"

Write-Step '2/6 检查 WorkBuddy 自带 Node'
$node = Find-WorkBuddyNode
if (-not $node) {
    Fail-Install 11 '没有找到 Node。请确认 WorkBuddy 安装完整，或安装 Node 22+。'
}
$result.node = $node
Write-Host "Node: $node"

Write-Step '3/6 检查麦当劳 MCP Token'
$mcpToken = Get-McpToken
if (-not $mcpToken) {
    $result.mcp = 'missing'
    Fail-Install 20 @'
没有找到麦当劳 MCP Token。
请先打开：https://open.mcd.cn/mcp
手机号登录 -> 控制台 -> 激活 -> 复制 Token；
在 WorkBuddy 的 MCP 配置里填好后，再运行本安装器。
'@
}
$result.mcp = 'ok'
Write-Host '麦当劳 MCP Token: 已找到（不显示内容）'

Write-Step '4/6 检查 JEV'
$jevKey = Read-JevKey
if (-not $jevKey) {
    $result.jev = 'missing'
    Fail-Install 30 @'
没有找到 JEV Key。
请先打开：https://jevmodel.org/zh/dashboard/
登录后创建/显示 Key，保存到：
%USERPROFILE%\.jevmodel\api_key.txt
JEV 是必需裁判；没有它，简单麦不会推荐。
'@
}
$env:JEVMODEL_API_KEY = $jevKey
$result.jev = 'ok'
Write-Host 'JEV Key: 已找到（不显示内容）'

Write-Step '5/6 复制程序与 Skill'
New-Item -ItemType Directory -Force -Path $AppHome | Out-Null
$robocopyArgs = @(
    $Source, $AppHome,
    '/E', '/XD', '.git', 'memory', 'node_modules', 'tools\out', '.scratch',
    '/XF', '.env', '*.local',
    '/NFL', '/NDL', '/NJH', '/NJS', '/NP'
)
& robocopy @robocopyArgs | Out-Null
if ($LASTEXITCODE -ge 8) {
    Fail-Install 40 "复制程序失败（robocopy exit $LASTEXITCODE）。"
}
Write-Host "程序目录: $AppHome"

if (-not (Test-Path $SkillSource)) {
    Fail-Install 41 "找不到 Skill 源目录: $SkillSource"
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $SkillTarget) | Out-Null
if (Test-Path $SkillTarget) { Remove-Item -LiteralPath $SkillTarget -Recurse -Force }
Copy-Item -LiteralPath $SkillSource -Destination $SkillTarget -Recurse -Force
Write-Host "Skill 目录: $SkillTarget"

[Environment]::SetEnvironmentVariable('EASY_EAT_HOME', $AppHome, 'User')
$env:EASY_EAT_HOME = $AppHome
Write-Host "EASY_EAT_HOME=$AppHome"

# 给宠物写本机配置（config.json 已被 .gitignore 忽略，不会进仓库）
$petDir = Join-Path $AppHome 'pet'
if (Test-Path $petDir) {
    $petConfig = [ordered]@{
        workbuddyExe = $workbuddy
        projectPath  = $AppHome
        startPrompt  = '用简单麦。午饭吃啥？'
        bubbleText   = '今天想麦什么'
    }
    ($petConfig | ConvertTo-Json -Depth 3) | Set-Content -Path (Join-Path $petDir 'config.json') -Encoding UTF8
    Write-Host '宠物本机配置已生成。'
}

Write-Step '6/6 JEV health 检查'
Push-Location $AppHome
try {
    $healthOutput = & $node 'scripts\judge.mjs' '--health' 2>&1 | Out-String
    $healthCode = $LASTEXITCODE
} finally {
    Pop-Location
}
if ($healthCode -ne 0) {
    $result.jevHealth = 'failed'
    Fail-Install 50 @"
JEV health 不通过（exit $healthCode）。
简单麦不会在 JEV 未就绪时推荐。
请确认：
1. JEV Key 正确；
2. 本机代理可用（默认 http://127.0.0.1:7897）；
3. 再运行本安装器。
"@
}
$result.jevHealth = 'ok'
Write-Host 'JEV health: ok'

$result.ok = $true
$result.message = '安装完成：Skill 已复制，程序目录已就绪，JEV health 通过。'
Save-Result
Write-Host ''
Write-Host '[OK] 安装完成。' -ForegroundColor Green
Write-Host "结果文件: $ResultPath"

if (-not $SkipLaunch) {
    $petCmd = Join-Path $AppHome 'pet\start-pet.cmd'
    if (Test-Path $petCmd) {
        Start-Process -FilePath $petCmd -WorkingDirectory (Join-Path $AppHome 'pet') | Out-Null
        $result.petStarted = $true
        Write-Host '小简已启动。'
    }
    if ($workbuddy) {
        Start-Process -FilePath $workbuddy | Out-Null
        $result.workbuddyOpen = $true
        Write-Host 'WorkBuddy 已打开。'
    }
    Save-Result
}

Write-Host ''
Write-Host '下一步：'
Write-Host '1. 在 WorkBuddy 新建任务，选 easy-eat；'
Write-Host '2. 如果 WorkBuddy 要求选择项目，选择：'
Write-Host "   $AppHome"
Write-Host '3. 说：午饭吃啥'
exit 0
