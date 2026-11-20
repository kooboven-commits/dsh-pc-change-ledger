<#
电脑改动账本 ledger.ps1 —— 给 AI 助手用：改 Windows 系统设置前先记账，随时查看、随时撤销。
账本放在 %USERPROFILE%\.agents\change-ledger\，Codex、DeepSeek、Claude 等所有助手共用。
兼容 Windows PowerShell 5.1 和 PowerShell 7。

用法（在本技能目录下）：
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\ledger.ps1 <命令> [参数]

  list     [-Last 20]                                   列出最近的改动（含是否已撤销）
  show     -Id 3                                        查看某条改动的详情和撤销命令
  reg-set  -Path HKCU:\... -Name X -Value 1 -Type DWord -Why "原因" [-Agent codex] [-Risk medium]
                                                        改注册表值：自动记下旧值和撤销命令
  env-set  -Name X -Value Y -Why "原因"                  改用户环境变量：自动记下旧值
  record   -What "改了什么" -Undo "撤销命令" [-Verify "验证命令"] [-Risk high] [-Why "原因"]
                                                        其他改动（电源、服务、计划任务……）手动记账
  undo     -Id 3 [-Yes]                                 撤销某条改动（不加 -Yes 只显示要执行的命令）
  capture  [-Name before-xxx]                           给常见系统设置拍快照
  diff     -From before-xxx [-To after-xxx]             对比两张快照（不写 -To 就和现在对比）
  snapshots                                             列出已有快照
#>
param(
    [Parameter(Position = 0)]
    [ValidateSet('list', 'show', 'reg-set', 'env-set', 'record', 'undo', 'capture', 'diff', 'snapshots', 'help')]
    [string]$Command = 'help',
    [string]$Path,
    [string]$Name,
    $Value,
    [ValidateSet('String', 'ExpandString', 'DWord', 'QWord', 'MultiString', 'Binary')]
    [string]$Type = 'String',
    [string]$Why = '',
    [string]$Agent = $(if ($env:LEDGER_AGENT) { $env:LEDGER_AGENT } else { 'unknown' }),
    [string]$What,
    [string]$Undo,
    [string]$Verify,
    [ValidateSet('low', 'medium', 'high')]
    [string]$Risk = 'medium',
    [int]$Id,
    [switch]$Yes,
    [int]$Last = 20,
    [string]$From,
    [string]$To,
    [switch]$Json
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

$Root = if ($env:LEDGER_ROOT) { $env:LEDGER_ROOT } else { Join-Path $env:USERPROFILE '.agents\change-ledger' }
$LedgerFile = Join-Path $Root 'ledger.jsonl'
$SnapDir = Join-Path $Root 'snapshots'
$Utf8 = New-Object Text.UTF8Encoding $false
New-Item -ItemType Directory -Force -Path $Root, $SnapDir | Out-Null

# ───────── 账本读写 ─────────
function Read-Ledger {
    if (-not (Test-Path $LedgerFile)) { return @() }
    $rows = @()
    foreach ($line in [IO.File]::ReadAllLines($LedgerFile, $Utf8)) {
        if ($line.Trim()) { try { $rows += ($line | ConvertFrom-Json) } catch { } }
    }
    return $rows
}

function Add-Entry([hashtable]$e) {
    $rows = @(Read-Ledger)   # @() 不能省：PowerShell 5.1 里单个对象没有 .Count
    $next = 1
    if ($rows.Count -gt 0) { $next = ([int](($rows | Measure-Object -Property id -Maximum).Maximum)) + 1 }
    $e['id'] = $next
    $e['time'] = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    $e['agent'] = $Agent
    $e['computer'] = $env:COMPUTERNAME
    $json = (New-Object PSObject -Property $e) | ConvertTo-Json -Compress -Depth 6
    [IO.File]::AppendAllText($LedgerFile, $json + "`n", $Utf8)
    return $next
}

function Get-UndoneIds($rows) {
    $ids = @{}
    foreach ($r in $rows) { if ($r.kind -eq 'undo' -and $r.of) { $ids[[int]$r.of] = $r.id } }
    return $ids
}

# 把一个值写成能放进 PowerShell 命令里的字面量
function ConvertTo-PsLiteral($v, [string]$kind) {
    if ($null -eq $v) { return '$null' }
    switch ($kind) {
        'DWord' { return [string][int64]$v }
        'QWord' { return [string][int64]$v }
        'Binary' { return '[byte[]](' + ((@($v) | ForEach-Object { [string][int]$_ }) -join ',') + ')' }
        'MultiString' { return '@(' + ((@($v) | ForEach-Object { "'" + ([string]$_).Replace("'", "''") + "'" }) -join ',') + ')' }
        default { return "'" + ([string]$v).Replace("'", "''") + "'" }
    }
}

function Quote([string]$s) { return "'" + $s.Replace("'", "''") + "'" }

function Need-Why {
    if (-not $Why) { throw '请用 -Why 写清楚为什么要改（会写进账本给用户看）。' }
}

# ───────── 命令 ─────────
trap { Write-Output "出错：$($_.Exception.Message)"; exit 1 }
switch ($Command) {

    'help' {
        Get-Content -LiteralPath $PSCommandPath -Encoding UTF8 -TotalCount 26 | Select-Object -Skip 1
    }

    'list' {
        $rows = @(Read-Ledger)
        if ($rows.Count -eq 0) { Write-Output '账本是空的：还没有记录任何改动。'; break }
        $undone = Get-UndoneIds $rows
        $rows | Select-Object -Last $Last | ForEach-Object {
            $mark = ''
            if ($_.kind -ne 'undo' -and $undone.ContainsKey([int]$_.id)) { $mark = "（已被 #$($undone[[int]$_.id]) 撤销）" }
            [PSCustomObject]@{ Id = $_.id; 时间 = $_.time; 助手 = $_.agent; 风险 = $_.risk; 改动 = ($_.what + $mark) }
        } | Format-Table -AutoSize -Wrap | Out-String -Width 220
    }

    'show' {
        $e = Read-Ledger | Where-Object { [int]$_.id -eq $Id } | Select-Object -First 1
        if (-not $e) { throw "账本里没有 #$Id。" }
        $e | Format-List | Out-String -Width 220
    }

    'reg-set' {
        if (-not $Path -or -not $Name -or $null -eq $Value) { throw 'reg-set 需要 -Path、-Name、-Value。' }
        Need-Why
        $keyExisted = Test-Path -LiteralPath $Path
        $oldKind = $null; $old = $null
        if ($keyExisted) {
            $key = Get-Item -LiteralPath $Path
            if ($key.GetValueNames() -contains $Name) {
                $oldKind = $key.GetValueKind($Name).ToString()
                $old = $key.GetValue($Name, $null, 'DoNotExpandEnvironmentNames')
            }
        }
        try {
            if (-not $keyExisted) { New-Item -Path $Path -Force | Out-Null }
            $typed = $Value
            if ($Type -in 'DWord', 'QWord') { $typed = [int64]$Value }
            New-ItemProperty -LiteralPath $Path -Name $Name -Value $typed -PropertyType $Type -Force | Out-Null
        }
        catch {
            throw "写入失败：$($_.Exception.Message)（HKLM 下的项需要管理员权限）。没有记账。"
        }
        $now = (Get-Item -LiteralPath $Path).GetValue($Name, $null, 'DoNotExpandEnvironmentNames')
        if ($null -eq $oldKind) {
            $undoCmd = "Remove-ItemProperty -LiteralPath $(Quote $Path) -Name $(Quote $Name)"
            if (-not $keyExisted) {
                $undoCmd += "; `$k = Get-Item -LiteralPath $(Quote $Path); if (`$k.ValueCount -eq 0 -and `$k.SubKeyCount -eq 0) { Remove-Item -LiteralPath $(Quote $Path) }"
            }
            $before = '（原来没有这个值）'
        }
        else {
            $undoCmd = "New-ItemProperty -LiteralPath $(Quote $Path) -Name $(Quote $Name) -Value $(ConvertTo-PsLiteral $old $oldKind) -PropertyType $oldKind -Force | Out-Null"
            $before = "$oldKind = $(ConvertTo-PsLiteral $old $oldKind)"
        }
        $newId = Add-Entry @{
            kind = 'registry'; risk = $Risk; why = $Why; target = "reg:$Path\$Name"
            what = "注册表 $Path\$Name = $(ConvertTo-PsLiteral $Value $Type)"
            before = $before; after = "$Type = $(ConvertTo-PsLiteral $now $Type)"
            undo = $undoCmd
            verify = "(Get-Item -LiteralPath $(Quote $Path)).GetValue($(Quote $Name))"
        }
        Write-Output "已修改并记账 #$newId：$Path\$Name"
        Write-Output "  原来：$before"
        Write-Output "  现在：$Type = $(ConvertTo-PsLiteral $now $Type)"
        Write-Output "  撤销：ledger.ps1 undo -Id $newId"
    }

    'env-set' {
        if (-not $Name) { throw 'env-set 需要 -Name 和 -Value（-Value 为空字符串表示删除）。' }
        Need-Why
        $old = [Environment]::GetEnvironmentVariable($Name, 'User')
        $newVal = if ([string]::IsNullOrEmpty([string]$Value)) { $null } else { [string]$Value }
        [Environment]::SetEnvironmentVariable($Name, $newVal, 'User')
        $oldLit = if ($null -eq $old) { '$null' } else { Quote $old }
        $newId = Add-Entry @{
            kind = 'env'; risk = $Risk; why = $Why; target = "env:$Name"
            what = "用户环境变量 $Name = $(if ($null -eq $newVal) { '（删除）' } else { $newVal })"
            before = $(if ($null -eq $old) { '（原来没有）' } else { $old }); after = $newVal
            undo = "[Environment]::SetEnvironmentVariable($(Quote $Name), $oldLit, 'User')"
            verify = "[Environment]::GetEnvironmentVariable($(Quote $Name), 'User')"
        }
        Write-Output "已修改并记账 #$newId：用户环境变量 $Name（新开的程序才会看到新值）"
        Write-Output "  撤销：ledger.ps1 undo -Id $newId"
    }

    'record' {
        if (-not $What -or -not $Undo) { throw 'record 需要 -What（改了什么）和 -Undo（撤销命令；确实无法撤销就写 NONE 并在 -What 里说明）。' }
        Need-Why
        $newId = Add-Entry @{ kind = 'manual'; risk = $Risk; why = $Why; what = $What; undo = $Undo; verify = $Verify }
        Write-Output "已记账 #$newId：$What"
        if ($Undo -ne 'NONE') { Write-Output "  撤销：ledger.ps1 undo -Id $newId" } else { Write-Output '  注意：这条改动无法撤销。' }
    }

    'undo' {
        $rows = @(Read-Ledger)
        $e = $rows | Where-Object { [int]$_.id -eq $Id } | Select-Object -First 1
        if (-not $e) { throw "账本里没有 #$Id。" }
        if ($e.kind -eq 'undo') { throw "#$Id 本身就是一次撤销。" }
        $undone = Get-UndoneIds $rows
        if ($undone.ContainsKey($Id)) { throw "#$Id 已经被 #$($undone[$Id]) 撤销过了。" }
        if (-not $e.undo -or $e.undo -eq 'NONE') { throw "#$Id 记录为无法撤销：$($e.what)" }
        # 同一个设置后来又被改过、还没撤销：必须从新往旧撤，否则会把后来的改动一起抹掉
        if ($e.target) {
            $later = @($rows | Where-Object { $_.target -eq $e.target -and [int]$_.id -gt $Id -and $_.kind -ne 'undo' -and -not $undone.ContainsKey([int]$_.id) })
            if ($later.Count -gt 0) {
                throw "这个设置之后又被 #$((@($later | ForEach-Object { $_.id })) -join '、#') 改过，请先撤销更新的那条（从新往旧撤）。"
            }
        }
        Write-Output "要撤销的改动 #$Id（$($e.time)，$($e.agent)）：$($e.what)"
        Write-Output "将执行：$($e.undo)"
        if (-not $Yes) { Write-Output '确认无误后加 -Yes 再运行一次。'; break }
        try { Invoke-Expression $e.undo }
        catch { throw "撤销失败：$($_.Exception.Message)（可能需要管理员权限）。账本没有改动。" }
        $check = ''
        if ($e.verify) { try { $check = [string](Invoke-Expression $e.verify) } catch { $check = '' } }
        $newId = Add-Entry @{ kind = 'undo'; of = $Id; risk = 'low'; why = '撤销'; what = "撤销 #$Id：$($e.what)"; undo = 'NONE'; verify = $e.verify }
        Write-Output "已撤销，记账 #$newId。"
        if ($e.verify) { Write-Output "  现在的值：$(if ($check) { $check } else { '（空 / 已删除）' })" }
    }

    'capture' {
        $label = if ($Name) { $Name } else { 'snap' }
        $snap = [ordered]@{}
        function Add-Section($title, [scriptblock]$body) {
            $sec = [ordered]@{}
            try { & $body $sec } catch { $sec['（读取失败）'] = $_.Exception.Message }
            $snap[$title] = $sec
        }
        Add-Section '电源' {
            param($s)
            $s['休眠文件 hiberfil.sys 存在'] = [string](Test-Path -LiteralPath "$env:SystemDrive\hiberfil.sys")
            $s['快速启动 HiberbootEnabled'] = [string](Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' -ErrorAction SilentlyContinue).HiberbootEnabled
            $s['当前电源计划'] = ((powercfg /getactivescheme) -join ' ').Trim()
        }
        Add-Section '虚拟内存' {
            param($s)
            $s['系统自动管理'] = [string](Get-CimInstance Win32_ComputerSystem).AutomaticManagedPagefile
            Get-CimInstance Win32_PageFileSetting -ErrorAction SilentlyContinue | ForEach-Object { $s["设置 $($_.Name)"] = "$($_.InitialSize)-$($_.MaximumSize) MB" }
        }
        Add-Section '开机自启' {
            param($s)
            foreach ($k in 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run') {
                if (Test-Path $k) { $item = Get-Item $k; foreach ($n in $item.GetValueNames()) { $s["$($k.Split(':')[0]) $n"] = [string]$item.GetValue($n) } }
            }
            $sf = [Environment]::GetFolderPath('Startup')
            if (Test-Path $sf) { Get-ChildItem $sf -File | ForEach-Object { $s["启动文件夹 $($_.Name)"] = $_.FullName } }
        }
        Add-Section '服务启动类型' {
            param($s)
            Get-Service | ForEach-Object { $s[$_.Name] = [string]$_.StartType }
        }
        Add-Section '计划任务' {
            param($s)
            Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskPath -notlike '\Microsoft\*' } | ForEach-Object { $s["$($_.TaskPath)$($_.TaskName)"] = [string]$_.State }
        }
        Add-Section '用户环境变量' {
            param($s)
            $vars = [Environment]::GetEnvironmentVariables('User')
            foreach ($k in $vars.Keys) { $s[[string]$k] = [string]$vars[$k] }
        }
        Add-Section 'Windows 更新策略' {
            param($s)
            foreach ($k in 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate', 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU') {
                if (Test-Path $k) { $item = Get-Item $k; foreach ($n in $item.GetValueNames()) { $s["$($k.Split('\')[-1]) $n"] = [string]$item.GetValue($n) } }
            }
        }
        Add-Section 'hosts 文件' {
            param($s)
            $h = "$env:SystemRoot\System32\drivers\etc\hosts"
            if (Test-Path $h) { $s['SHA256'] = (Get-FileHash $h -Algorithm SHA256).Hash }
        }
        Add-Section '已安装软件' {
            param($s)
            foreach ($k in 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*') {
                Get-ItemProperty $k -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | ForEach-Object { $s[[string]$_.DisplayName] = [string]$_.DisplayVersion }
            }
        }
        $file = Join-Path $SnapDir ("{0}_{1}.json" -f $label, (Get-Date).ToString('yyyyMMdd-HHmmss'))
        [IO.File]::WriteAllText($file, ($snap | ConvertTo-Json -Depth 5), $Utf8)
        if ($Json) { ConvertTo-Json -Compress -InputObject ([PSCustomObject]@{ name = [IO.Path]::GetFileNameWithoutExtension($file) }); break }
        Write-Output "已拍快照：$([IO.Path]::GetFileNameWithoutExtension($file))"
        Write-Output "  之后用 ledger.ps1 diff -From $label 对比现在的状态。"
    }

    'snapshots' {
        $snaps = @(Get-ChildItem $SnapDir -Filter *.json | Where-Object { $_.BaseName -notlike '_now*' } | Sort-Object LastWriteTime)
        if ($Json) { ConvertTo-Json -Compress -InputObject @($snaps | ForEach-Object { [PSCustomObject]@{ name = $_.BaseName; time = $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss') } }); break }
        $snaps | ForEach-Object { '{0}  {1}' -f $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm'), $_.BaseName }
    }

    'diff' {
        function Find-Snap([string]$n) {
            $f = Get-ChildItem $SnapDir -Filter *.json | Where-Object { $_.BaseName -eq $n -or $_.BaseName -like "$($n)_*" } | Sort-Object LastWriteTime | Select-Object -Last 1
            if (-not $f) { throw "找不到快照：$n（用 ledger.ps1 snapshots 查看）" }
            return $f.FullName
        }
        function Flatten([string]$file) {
            $map = @{}
            $obj = [IO.File]::ReadAllText($file, $Utf8) | ConvertFrom-Json
            foreach ($sec in $obj.PSObject.Properties) {
                foreach ($p in $sec.Value.PSObject.Properties) { $map["[$($sec.Name)] $($p.Name)"] = [string]$p.Value }
            }
            return $map
        }
        if (-not $From) { throw 'diff 需要 -From <快照名>。' }
        $a = Flatten (Find-Snap $From)
        if ($To) { $b = Flatten (Find-Snap $To) }
        else {
            $tmpName = '_now'
            & $PSCommandPath capture -Name $tmpName | Out-Null
            $nowFile = Find-Snap $tmpName
            $b = Flatten $nowFile
            Remove-Item $nowFile -Force
        }
        $changes = @()
        foreach ($k in $a.Keys) {
            if (-not $b.ContainsKey($k)) { $changes += [PSCustomObject]@{ 变化 = '删除'; 项目 = $k; 之前 = $a[$k]; 之后 = '' } }
            elseif ($a[$k] -ne $b[$k]) { $changes += [PSCustomObject]@{ 变化 = '修改'; 项目 = $k; 之前 = $a[$k]; 之后 = $b[$k] } }
        }
        foreach ($k in $b.Keys) { if (-not $a.ContainsKey($k)) { $changes += [PSCustomObject]@{ 变化 = '新增'; 项目 = $k; 之前 = ''; 之后 = $b[$k] } } }
        if ($Json) {
            ConvertTo-Json -Compress -Depth 3 -InputObject @($changes | Sort-Object 项目 | ForEach-Object { [PSCustomObject]@{ change = $_.变化; item = $_.项目; before = $_.之前; after = $_.之后 } })
            break
        }
        if ($changes.Count -eq 0) { Write-Output '没有变化。' }
        else { $changes | Sort-Object 项目 | Format-Table -AutoSize -Wrap | Out-String -Width 220 }
    }
}
