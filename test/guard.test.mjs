import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assessCommand, commandOf } from '../lib/guard.js'

const ids = (cmd) => assessCommand(cmd).map((r) => r.id)

test('危险命令会被识别', () => {
  const cases = {
    'powercfg /h off': 'hibernate-off',
    'powercfg -hibernate off': 'hibernate-off',
    'vssadmin delete shadows /for=C: /oldest /quiet': 'restore-points',
    'Get-CimInstance Win32_ShadowCopy | % { $_.Delete() }': 'restore-points',
    "Set-CimInstance -InputObject $cs -Property @{ AutomaticManagedPagefile = $false }": 'pagefile',
    'wmic pagefileset where name="C:\\\\pagefile.sys" delete': 'pagefile',
    'bcdedit /set {current} safeboot minimal': 'boot-config',
    'reg add HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU /v NoAutoUpdate /t REG_DWORD /d 1': 'hklm-registry',
    "Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control' -Name X -Value 1": 'hklm-registry',
    'Set-MpPreference -DisableRealtimeMonitoring $true': 'defender',
    'netsh advfirewall set allprofiles state off': 'firewall',
    'sc config wuauserv start= disabled': 'services',
    'Stop-Service -Name Spooler': 'services',
    'schtasks /delete /tn "Adobe Updater" /f': 'scheduled-tasks',
    "Add-Content -Path C:\\Windows\\System32\\drivers\\etc\\hosts -Value '0.0.0.0 example.com'": 'hosts',
    'diskpart /s script.txt': 'disk',
    'manage-bde -off D:': 'disk',
    'setx PATH "C:\\tools" /M': 'machine-env',
    "[Environment]::SetEnvironmentVariable('JAVA_HOME', 'C:\\jdk', 'Machine')": 'machine-env',
    'winget uninstall --id Tencent.QQ': 'uninstall',
    'msiexec /x {12345678-1234-1234-1234-123456789012} /qn': 'uninstall',
    'Remove-Item -Recurse -Force $env:USERPROFILE\\Downloads\\*': 'mass-delete',
    'rd /s /q C:\\Users\\alice\\Desktop\\old': 'mass-delete',
    'powercfg /setactive SCHEME_MIN': 'power-plan',
  }
  for (const [cmd, id] of Object.entries(cases)) {
    assert.ok(ids(cmd).includes(id), `应识别为 ${id}：${cmd}（实际 ${ids(cmd).join(',') || '无'}）`)
  }
})

test('只读和普通命令不会被误拦', () => {
  const safe = [
    'powercfg /a',
    'powercfg /getactivescheme',
    'vssadmin list shadows',
    'Get-CimInstance Win32_PageFileUsage',
    'bcdedit /enum',
    'reg query HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion',
    "Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'",
    'Get-Service wuauserv',
    'Get-MpPreference',
    'schtasks /query',
    'Get-Content C:\\Windows\\System32\\drivers\\etc\\hosts',
    'npm install',
    'git status',
    'python build.py',
    'Remove-Item -Recurse -Force .\\dist',
    'rm -rf node_modules',
    "Set-ItemProperty -Path 'HKCU:\\Software\\Test' -Name X -Value 1",
    'winget install Git.Git',
    '',
  ]
  for (const cmd of safe) assert.deepEqual(ids(cmd), [], `不应拦截：${cmd}（实际 ${ids(cmd).join(',')}）`)
})

test('能从不同工具的参数里取出命令', () => {
  assert.equal(commandOf({ command: 'a' }), 'a')
  assert.equal(commandOf({ code: 'b' }), 'b')
  assert.equal(commandOf({ cmd: ['x', 'y'] }), 'x y')
  assert.equal(commandOf(null), '')
  assert.equal(commandOf({ path: 'z' }), '')
})
