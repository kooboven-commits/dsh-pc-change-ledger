# 电脑改动账本 · dsh-pc-change-ledger

> 让 AI 改你的电脑之前先记账：每一项系统改动都有记录、都能一键撤销。
> DeepSeek Harness 插件，Windows 10 / 11。

现在很多人让 AI 帮忙清理电脑、优化系统。改完出了问题，往往不知道是哪个 AI 改了什么，更不知道怎么改回去。这个插件给所有 AI 助手准备了**一本共用的账本**：

- 🧾 **右侧栏“电脑改动账本”**：按时间列出 AI 对系统做过的每一项改动——哪个助手改的、为什么、原来是什么、现在是什么
- ↩️ **一键撤销**：每条改动旁边有“撤销”按钮，先显示要执行的命令，确认后再执行；同一个设置改过多次时只允许从新往旧撤
- 🛡 **高风险命令拦截**：AI 想执行关休眠、删还原点、改虚拟内存、改系统注册表、关防火墙/Defender、停服务、改计划任务、卸载软件、大范围删除用户文件夹等命令时，先弹出 DSH 的确认卡片，写清后果，由你决定
- 🤖 **给 AI 的记账工具**：改注册表、改环境变量自动记下旧值和撤销命令；其他改动做完立刻记账
- 📸 **快照对比**：给常见系统设置拍快照（电源、虚拟内存、开机自启、服务、计划任务、用户环境变量、更新策略、hosts、已装软件），之后一点就能看出哪里变了——就算有 AI 忘了记账也查得出来
- 🔔 **出问题时提醒**：最近 24 小时有还没撤销的高风险改动时，面板顶部和 AI 的上下文里都会提醒
- 🤝 **多个 AI 共用一本账**：账本放在 `%USERPROFILE%\.agents\change-ledger\`，Codex、Claude Code 装上配套的[技能](#给-codex--claude-code-用的技能)后也写同一本账

## 安装

需要 **Windows 10 / 11** 和 **DeepSeek Harness 0.2.x**。

在 PowerShell 里运行（不需要管理员）：

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add github:kooboven-commits/dsh-pc-change-ledger
```

然后**完全退出 DeepSeek Harness 再重新打开**（托盘图标右键退出）。

> 用的是 Web 版配置的话，把 `--profile desktop` 换成 `--profile web`。

## 使用

### 打开账本
右侧栏的引导页里点 **“电脑改动账本”**。

### 平时
正常让 AI 干活就行，例如“帮我清理一下 C 盘”“把文件扩展名显示出来”。涉及系统设置时：

1. AI 会先查账本，看其他助手最近改过什么
2. 高风险操作会弹出确认卡片，你点同意才执行
3. 改完 AI 会记账，并告诉你编号
4. 不满意就在账本里点“撤销”

### 斜杠命令
| 命令 | 作用 |
|---|---|
| `/ledger` | 在对话里列出最近 15 条改动 |
| `/ledger-undo 12` | 预览撤销第 12 条要执行的命令 |
| `/ledger-undo 12 确认` | 真的撤销 |

### 面板按钮
| 按钮 | 作用 |
|---|---|
| 拍快照 | 记下现在的系统设置 |
| 对比 | 选一张快照，和现在对比，列出新增 / 删除 / 修改的项目 |
| 🛡 拦截：开 / 关 | 拦截高风险命令的总开关；关掉后 AI 执行命令不再弹卡片（记账功能照常） |
| 详情 / 撤销 | 看原值、新值、撤销命令；撤销前会再确认一次 |

### AI 可以用的工具
| 工具 | 作用 |
|---|---|
| `ledger_list` | 查账 |
| `ledger_reg_set` | 改注册表值并自动记账 |
| `ledger_env_set` | 改用户环境变量并自动记账 |
| `ledger_record` | 其他改动手动记账（必须写撤销命令） |
| `ledger_undo` | 撤销（一定会先问你） |
| `ledger_capture` / `ledger_diff` | 拍快照 / 对比 |

## 给 Codex / Claude Code 用的技能

仓库里的 [`skill/pc-change-ledger`](skill/pc-change-ledger) 是同一套规则的技能版，复制到对应目录即可，写的是同一本账：

| 工具 | 复制到 |
|---|---|
| Codex | `%USERPROFILE%\.codex\skills\pc-change-ledger` |
| Claude Code | `%USERPROFILE%\.claude\skills\pc-change-ledger` |
| DeepSeek Harness（只要技能、不要插件） | `%USERPROFILE%\.dsh\skills\pc-change-ledger` |

## 卸载

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop remove dsh-pc-change-ledger
```

重启 DSH 生效。账本数据还留在 `%USERPROFILE%\.agents\change-ledger\`，不需要可以手动删除。

## 局限（请务必知道）

- **只是多一道保险，不是万能的**：高风险命令是按规则识别的，换个写法、或者 AI 通过图形界面点击操作，就可能识别不到
- **撤销靠记账时写下的命令**：AI 自己写的撤销命令可能写错；没记账的改动无法一键撤销（可以用快照对比找出来）
- 删除文件、删除还原点这类操作**本身就无法撤销**，插件只会提醒，不能恢复
- 需要管理员权限的改动，撤销时同样需要管理员权限，否则会报错
- 确认卡片走的是 DSH 自带的审批机制，具体表现取决于你在 DSH 里的审批设置
- 只支持 Windows

## 原理和安全

- 账本是一个 JSON Lines 文件，只追加不修改；写入、撤销、快照都由随插件附带的 PowerShell 脚本 [`scripts/ledger.ps1`](scripts/ledger.ps1) 完成，插件和技能用的是同一份
- 高风险命令拦截挂在 DSH 的 `tools/pre-execute` 上，命中规则就返回 `ask`，由 DSH 弹出确认卡片；规则见 [`lib/guard.js`](lib/guard.js)
- 面板用的本机接口只接受 `localhost` 同源请求，拒绝跨站请求和非 JSON 写入；撤销只按账本编号执行账本里记好的命令，不接受任意命令文本
- 不联网，不上传任何数据

## 开发

```powershell
npm test     # node --test，覆盖拦截规则、插件装配、真实记账与撤销、接口安全、客户端注册
```

测试使用临时账本目录和临时注册表键，不会动你的真实账本和系统设置。

## 授权

MIT

---

**English (short):** A DeepSeek Harness plugin for Windows that keeps a shared ledger of every system change AI agents make (registry, power/hibernation, pagefile, startup items, services, scheduled tasks, environment variables, Windows Update, firewall, hosts, installs), with one-click undo in a right-sidebar panel, approval cards before high-risk commands, snapshot diffs, and tools for the agent to record changes. The ledger at `%USERPROFILE%\.agents\change-ledger` is shared with a companion skill for Codex and Claude Code.
