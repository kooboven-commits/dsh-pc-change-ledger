/**
 * 高风险系统命令识别。
 *
 * 只看 AI 要执行的命令文本（pwsh / bash / run_code 等工具的 command、code、script 参数），
 * 命中就让 DSH 弹出确认卡片，由用户决定。规则宁可多问一次，也不放过真正危险的操作；
 * 但只读的查询命令（Get-*、powercfg /a、vssadmin list ……）不拦。
 */

/** @typedef {{ id: string, title: string, consequence: string, test: (cmd: string) => boolean }} Rule */

const re = (pattern) => (cmd) => pattern.test(cmd)

/** @type {Rule[]} */
export const RULES = [
  {
    id: 'hibernate-off',
    title: '关闭休眠',
    consequence: '会同时关掉“快速启动”，开机可能变慢；平时用休眠的人会受影响。可以用 powercfg /h on 恢复。',
    test: re(/powercfg(\.exe)?\s+[-/]h(ibernate)?\s+off\b/i),
  },
  {
    id: 'restore-points',
    title: '删除系统还原点 / 卷影副本',
    consequence: '无法撤销。删掉后，系统出问题时就没法回退到之前的状态。',
    test: re(/vssadmin(\.exe)?\s+(delete|resize)\b|wmic(\.exe)?\s+shadowcopy\b.*\bdelete\b|Remove-?ComputerRestorePoint|Disable-ComputerRestore|\bDelete-?ShadowCopy\b|Win32_ShadowCopy[\s\S]*\.Delete\(/i),
  },
  {
    id: 'pagefile',
    title: '修改虚拟内存（分页文件）',
    consequence: '要重启才生效。改得太小、或者放到开机自动解锁的 BitLocker 加密盘上，重启后可能内存不足、程序成片崩溃。看“提交内存”判断，不要只看分页文件实际占用。',
    test: re(/Win32_PageFileSetting|AutomaticManagedPagefile|wmic(\.exe)?\s+(pagefileset|computersystem\s+.*AutomaticManagedPagefile)|PagingFiles/i),
  },
  {
    id: 'boot-config',
    title: '修改系统启动配置',
    consequence: '改错可能导致电脑无法开机。',
    test: re(/\bbcdedit(\.exe)?\b(?![^|;&]*\/(enum|v)\b)|\bbcdboot\b|\bbootrec\b/i),
  },
  {
    id: 'hklm-registry',
    title: '修改系统级注册表（HKLM）',
    consequence: '影响整台电脑和所有用户，部分设置要重启才生效。改之前要记下原来的值，方便撤销。',
    test: re(/\breg(\.exe)?\s+(add|delete|import|restore|load|unload)\s+["']?(HKLM|HKEY_LOCAL_MACHINE)\b|(Set|New|Remove|Rename|Clear)-Item(Property)?\b[^|;\n]*\b(HKLM:|HKEY_LOCAL_MACHINE|Registry::HKEY_LOCAL_MACHINE)|\bregedit(\.exe)?\s+\/s\b/i),
  },
  {
    id: 'defender',
    title: '修改 Windows 安全中心 / Defender',
    consequence: '可能降低电脑的病毒防护能力。',
    test: re(/(Set|Add|Remove)-MpPreference\b|DisableRealtimeMonitoring|DisableAntiSpyware|ExclusionPath/i),
  },
  {
    id: 'firewall',
    title: '修改防火墙',
    consequence: '可能让电脑暴露在网络攻击下，或者让某些程序连不上网。',
    test: re(/netsh(\.exe)?\s+(advfirewall|firewall)\s+(set|add|delete|reset)|(Set|New|Remove|Disable|Enable)-NetFirewall(Rule|Profile)\b/i),
  },
  {
    id: 'services',
    title: '修改系统服务',
    consequence: '可能让某个软件、驱动或系统功能失灵。',
    test: re(/\bsc(\.exe)?\s+(config|delete|stop|failure)\b|(Set|Stop|Remove|Suspend)-Service\b/i),
  },
  {
    id: 'scheduled-tasks',
    title: '修改计划任务',
    consequence: '可能让某个软件的自动更新、同步或备份停止工作。',
    test: re(/schtasks(\.exe)?\s+\/(create|delete|change)\b|(Register|Unregister|Disable|Set)-ScheduledTask\b/i),
  },
  {
    id: 'windows-update',
    title: '修改 Windows 更新设置',
    consequence: '可能让电脑收不到安全补丁。',
    test: (cmd) => /WindowsUpdate|wuauserv|UsoSvc|NoAutoUpdate|AUOptions|WaaSMedicSvc/i.test(cmd) && /\b(Set|New|Remove|Stop|Disable)-|\breg(\.exe)?\s+(add|delete)|\bsc(\.exe)?\s+config/i.test(cmd),
  },
  {
    id: 'hosts',
    title: '修改 hosts 文件',
    consequence: '可能让某些网站打不开，或者被导向别的地址。',
    test: (cmd) => /drivers[\\/]+etc[\\/]+hosts/i.test(cmd) && /(Set|Add|Clear)-Content|Out-File|>{1,2}|WriteAll|Copy-Item|Move-Item|Remove-Item/i.test(cmd),
  },
  {
    id: 'disk',
    title: '磁盘、分区或加密操作',
    consequence: '可能造成数据丢失，或者让硬盘无法访问。',
    test: re(/\bformat(\.com)?\s+[a-z]:|\bdiskpart\b|(Clear|Initialize|Set)-Disk\b|(Remove|Resize|New)-Partition\b|\bFormat-Volume\b|manage-bde(\.exe)?\s+-(off|on|lock|protectors\s+-(delete|disable))|(Disable|Enable|Suspend)-BitLocker\b/i),
  },
  {
    id: 'machine-env',
    title: '修改系统级环境变量',
    consequence: '影响所有用户和所有程序，改错可能让很多软件找不到路径。',
    test: re(/\bsetx(\.exe)?\b[^\n]*\s\/M\b|SetEnvironmentVariable\([^)]*['"]?Machine['"]?\)|\[EnvironmentVariableTarget\]::Machine/i),
  },
  {
    id: 'uninstall',
    title: '卸载软件或驱动',
    consequence: '软件的设置和数据可能会一起被删掉。',
    test: re(/\bwinget(\.exe)?\s+uninstall\b|\bmsiexec(\.exe)?\s+[^\n]*\/(x|uninstall)\b|Uninstall-Package\b|Remove-AppxPackage\b|pnputil(\.exe)?\s+\/(delete-driver|remove-device)/i),
  },
  {
    id: 'mass-delete',
    title: '大范围删除系统或用户文件夹',
    consequence: '删除无法撤销。建议先移到回收站或备份。',
    test: (cmd) => /\b(Remove-Item|rm|rmdir|rd|del|erase)\b[^\n]*(-Recurse|\/s\b|-r\b)/i.test(cmd)
      && /([A-Z]:\\(Windows|Program Files|ProgramData)\b|\\Users\\[^\\'"\s]+\\(AppData|Desktop|Documents|Downloads|Pictures|Videos|Music)\b|\$env:(USERPROFILE|APPDATA|LOCALAPPDATA|ProgramData|windir)|%(USERPROFILE|APPDATA|LOCALAPPDATA)%|~[\\/](Desktop|Documents|Downloads))/i.test(cmd),
  },
  {
    id: 'power-plan',
    title: '修改电源计划 / 睡眠设置',
    consequence: '可能影响电池续航、性能或自动睡眠。',
    test: re(/powercfg(\.exe)?\s+[-/](setactive|change|setacvalueindex|setdcvalueindex|delete|import|duplicatescheme)\b/i),
  },
]

/** 从工具参数里取出要执行的命令文本（不同工具字段名不同）。 */
export function commandOf(args) {
  if (!args || typeof args !== 'object') return ''
  const parts = []
  for (const key of ['command', 'code', 'script', 'cmd', 'input']) {
    const value = args[key]
    if (typeof value === 'string') parts.push(value)
    else if (Array.isArray(value)) parts.push(value.filter((v) => typeof v === 'string').join(' '))
  }
  return parts.join('\n')
}

/**
 * 评估一段命令：返回命中的规则（可能多条），没有命中返回空数组。
 * @param {string} command
 * @returns {Rule[]}
 */
export function assessCommand(command) {
  const cmd = String(command || '')
  if (cmd.trim() === '') return []
  return RULES.filter((rule) => {
    try { return rule.test(cmd) } catch { return false }
  })
}

/** 把命中的规则写成给用户看的确认说明。 */
export function describeHits(hits, command) {
  const head = hits.map((h) => `· ${h.title}：${h.consequence}`).join('\n')
  const shown = String(command).length > 300 ? String(command).slice(0, 300) + '…' : String(command)
  return `AI 想执行一条会修改系统设置的命令：\n${head}\n\n命令：${shown}\n\n同意后请让它把这次改动记进“电脑改动账本”，方便以后撤销。`
}
