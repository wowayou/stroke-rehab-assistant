# 交接文档（HANDOVER）

> 写给接手本项目的下一位开发者/AI。目的：让你在**不了解任何历史对话**的情况下安全接手。
> 交接日期：2026-08-01。交接时项目状态：**v0.2，功能完整，全部测试通过，无任何进行中的半成品工作。**

## 当前版本（2026-10-02）

**生产：v0.2.35**（提交 `dca0e7a`），地址 <https://stroke-rehab-assistant.pages.dev/>，Cloudflare 部署 `4268e015`（2026-10-02，`ver=20261002125604`）。它是两条线的合并：笔记本线 v0.2.32（9 月 28 日部署 `f39824c7` 时**没有提交 Git**，2026-10-02 补存为分支 `wip-laptop-2026-10-02`）与本机线 v0.2.32～v0.2.34；冲突怎么取舍见 [CHANGELOG](CHANGELOG.md) v0.2.35。部署后已核对：22 个运行文件与 `dca0e7a` 逐字节一致（首页仅部署戳不同）；首页 CSP/HSTS/防嵌入等响应头在位；`/sw.js` 不带 CSP、有 `cache-control: no-cache`（`_headers` 的摘除规则在 Cloudflare 上确实生效）；生产上离线缓存装上、断网能打开；对生产地址跑 `settings`、`lifecycle`、`overlay` 三套 Chromium 回归全部通过。**未验：真机**（按 [MANUAL-TEST](MANUAL-TEST.md) v0.2.32/v0.2.33 两节与补记/修改相关项）。

**数据兼容（务必）**：线上用户数据已经带 `trackFrom`/`timesHistory`/`medLate`。合并版全部保留；**不要部署任何不认识这三个字段的版本**——`normalizeState()` 会在下次保存时把它们丢掉（补记标记、改时间前的服药安排、登记日都会丢，登记前的日子还会重新被算成漏服）。

**5 张示意图仍全部是 `pending`**（未经医生复核），用 `node test/preview-figures.js --review` 出复核单找医生。

更早：v0.2.31 已提交（`f6a1907`），曾部署 `03608e86`（动作示意图临床角度护栏等）。

v0.2.30.1 在 v0.2.30 基础上继续打磨精致度/统一性（设置弹窗卡片标题层级对齐、展开折叠箭头改 CSS V 形），提交 `714c435`、部署 `03a2a862`；范围与验证见 [CHANGELOG](CHANGELOG.md)，组件及分阶段加固标准见 [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md)。仍需真机核对读屏、原生键盘和返回手势。

设计组件与交互标准见 [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md)，子域名迁移方法见 [DOMAIN-MIGRATION.md](DOMAIN-MIGRATION.md)。最终子域名尚未确定，未改 DNS 或旧站跳转；手机实际拨号、原生返回、读屏、备份文件落地与真实设备迁移仍需核对。下文早期交接状态为历史记录。

## 0. 一分钟了解本项目

「脑梗康复助手」：面向脑梗（缺血性脑卒中）恢复期患者及家属的家庭康复辅助工具。纯静态 Web 应用（HTML/CSS/JS，零依赖、零构建），数据只存浏览器 localStorage，不上传。五个页面：今日打卡 / 康复训练（28 个训练动作 + 4 个认知游戏）/ 健康记录（血压血糖体重+图表+导出）/ 用药核对 / 康复知识（9 篇科普 + BE-FAST 急救）。适老化设计（三档字号、大触控目标、高对比度）。

**先读文档的顺序**：本文 → `CLAUDE.md`（或 `AGENTS.md`，硬约定速查）→ `docs/DEVELOPMENT.md`（架构与扩展方法）→ 改医学内容前必读 `docs/RESEARCH.md` §八。

## 1. 交接时的准确状态

### 1.1 已完成并验证 ✅

2026-08 首次交接时的逐项验证记录已移到 [CHANGELOG.md](CHANGELOG.md) 末尾附录（历史记录，接手不必通读）；之后每一版的验证写在 CHANGELOG 对应条目里。

### 1.2 未做/未验证 ⚠️（接手后建议最先补的）

1. **真机手测仅部分完成**（2026-08-02 用户录屏实测）：首次指引、设置（含备份/恢复按钮）、保存血压、知识页、导出报告已验证正常。**仍未验证**：`tel:120` 拨号唤起、震动反馈、剪贴板复制、微信内置浏览器行为、360px 小屏布局、训练与用药的完整操作流程，以及 **v0.2.9 历史视图、v0.2.11 图表交互、v0.2.12 少算数/认同患者改造、v0.2.13 语音朗读与动作简笔画、v0.2.15 停药记录、v0.2.16 交互打磨（安卓返回键是重点）**（后三项尤其需要真人判断：措辞是否被患者接受、"还差 N 次"与拆解提示在三档字号下是否好读、**语音朗读在真机与微信内置浏览器能否出声**、简笔画在小屏是否看得清）。完整手工回归清单见 `docs/MANUAL-TEST.md`（唯一真源）。
2. **版本管理——已解决（2026-08-01，经用户确认）**：本项目内已 `git init`（main 分支），首次提交即 v0.2.2 全量状态，远程为私有仓库 <https://github.com/wowayou/stroke-rehab-assistant>。上级目录遗留的空 `my-projects/.git` 未动（不影响本项目，相关坑见 §3）。
3. **部署——已完成（2026-08-01）**：公开部署到 Cloudflare Pages <https://stroke-rehab-assistant.pages.dev/>。直传 12 个运行时文件（index/manifest/icon + css + 8 个 js）及 1 个 Pages `_headers` 规则文件（不含 docs/、test/、源码 md、.git）。线上验证通过：五页无头渲染冒烟全过、无 JS 报错。国内可达性已由用户真机确认可打开（速度/稳定性仍建议家人实测）。重新部署用仓库根目录的 `deploy.sh`。**2026-08-10 v0.2.12～v0.2.16 一并上线，线上 12 个运行时文件与本地逐字节一致（12/12 OK）；同日 v0.2.17～v0.2.19 部署完成（部署 `26600867`），生产首页/重定向/JS 均实测带 CSP、HSTS、防嵌入、`nosniff`、Referrer Policy 与 Permissions Policy，生产无头浏览器在新 CSP 下正常渲染。2026-08-11 v0.2.22 备份闪退修复部署 `1aa929c3`，生产四路径真实 Chromium 回归通过。**
   - **部署账号**：Cloudflare 账号邮箱 **demoqqxu@gmail.com**（账号名 "Demoqqxu@gmail.com's Account"，ID 0e2703e9...），与 GitHub 账号（wowayou）**不是同一个账号**，已由用户确认归其本人所有（2026-08-02）。管理入口：dash.cloudflare.com → Workers & Pages → Pages → stroke-rehab-assistant。wrangler 登录凭证在 `~/.config/.wrangler/config/default.toml`。**v0.2.9 曾因该凭证缺失/未登录而未上线（2026-08-03）**，当晚上线已解决：用户在本机终端确认已登录正确账号（demoqqxu@gmail.com）后跑 `./deploy.sh` 部署成功，线上已核对 JS 文件与本地逐字节一致（6/6 全部一致）。`deploy.sh` 现带 `chmod +x` 可直接 `./` 运行，并自带登录检查与 npx 回落；注意**带代理的 shell 里 `wrangler whoami` 会卡死**，需无代理终端或先 `unset http_proxy https_proxy`。
4. **等着你接手的一件事**：动作示意简笔画目前 5 个（`js/figures.js`：踝泵、Bobath握手、桥式、坐站转移、原地踏步）。**画法体系已经建好**——按 7.5 头身骨架 + 两连杆逆解生成姿势，几何正确性由 `node test/figures.test.js` 断言（肢段等长、两帧同一人、不穿地、动作要点），v0.2.31 起还有临床角度护栏（活动度包络 + 按要领原文推出的断言），补齐其余动作是机械工作。但**每张新图都要做三件事**：跑断言（并给它写按要领原文推出的那一层）、**放大人眼看图**（AI 写坐标是盲画，几何对了也可能难认——已踩过的坑列在 DEVELOPMENT.md §6 figures.js）、进复核单请医生确认。复核状态只看 `POSES[id].review`；复核单用 `node test/preview-figures.js --review` 生成。姿势正确性仍需康复医生/治疗师复核，尤其患侧摆位与关节角度。
5. 路线图见 DEVELOPMENT.md §9（唯一真源；离线缓存 v0.2.32 已做，双抗到期提醒、PHQ-9 情绪自评仍是规划）。

### 1.3 没有已知 bug

交接时无任何已知未修复缺陷。测试中曾发现并已修复的问题都在测试脚本自身（端口探测、孤儿进程、裸 `wait` 死等），应用代码自首次通过测试后未发现过 bug。

## 2. 快速接手三步

```bash
cd stroke-rehab-assistant   # 仓库根目录

# ① 确认现状是好的（预期：三个 ✅，退出码 0；smoke 约需 2~3 分钟）
node test/storage.test.js
node test/contracts.test.js
bash test/smoke.sh

# ② 自己打开看看（或直接双击 index.html）
python3 -m http.server 8080   # 浏览器访问 http://localhost:8080

# ③ 改任何东西之前，读 AGENTS.md 的硬约定，再按 DEVELOPMENT.md §0 找到要改的文件
```

注意：`test/storage.test.js` 运行时会打印 `QuotaExceededError` 和 `SyntaxError ... JSON` 两段告警——**这是预期输出**（测试故意模拟写盘失败和损坏 JSON，验证回滚/兜底逻辑），只要最后一行是"✅ storage.js 全部断言通过"就是成功。

## 3. 环境备忘（本机实测）

- **部署只从已提交的干净工作区做**：`deploy.sh` 拷的是工作区文件。2026-09 笔记本上直接从没提交的工作区部署了 v0.2.32，线上与仓库分叉 4 天，另一台机器差点用一次正常部署把它整体覆盖（会抹掉用户数据里的 `trackFrom`/`timesHistory`/`medLate`）。现在 `deploy.sh` 遇到未提交改动会拒绝（确需临时部署设 `ALLOW_DIRTY=1`），并把提交号记到 Cloudflare 的部署上；部署后照旧提交、推送。**接手时先核对线上文件与 `main` 是否一致**（`curl` 线上 js 求 md5 对照 `git show main:<文件>`），不一致先查清楚再动。

- WSL2（Linux 6.6.114.1-microsoft-standard-WSL2），Node v24.18.0，Python 3.12.3。
- 无头浏览器：`~/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell`（smoke.sh 会自动找最新版本；不存在时 `npx playwright install chromium`）。
- WSL2 下无头浏览器启动很慢，smoke.sh 已并行化，整体仍需 2~3 分钟，属正常。
- smoke.sh 默认用 8799 端口并在结束时清理自己起的服务器；它探测的是**目标 URL** 而非端口（因为端口可能被根目录不对的服务器占用）。
- AI 编码工具的会话环境快照可能因上级空 `.git` 误报"本目录是 git 仓库"（实际任何 git 命令都会 `fatal: not a git repository`）。以实际命令输出为准，别信快照。
- 写运维脚本时的两个已踩过的坑：`pkill -f`/`pgrep -f` 的模式会匹配到包含该字符串的调用方自身命令行（自伤）；`( cd x && cmd ) &` 记录的是子 shell PID，`kill` 它不会杀死 cmd，要用 `exec cmd`。
- **Windows 侧 Git Bash 跑 WSL 命令的两个坑**：① 会把 WSL 路径改写成 `D:/Dev/Git/...`，须加 `MSYS_NO_PATHCONV=1`；② `wsl` 默认发行版解析可能失败，显式 `-d Ubuntu-24.04`。CDP 类测试还须用 nvm 的 node 24（系统 node18 没有全局 `WebSocket`）。
- **部署后验证 `_headers` 不能比对文件内容**：Cloudflare Pages 把 `_headers` 当配置消费掉、不作为静态文件对外提供，`GET /_headers` 返回的是站点回退页（即 index.html），md5 必然对不上。判定它有没有上去要看**生产响应头里的规则是否逐条生效**（CSP/HSTS/防嵌入/nosniff/Referrer/Permissions）。另：`pages deploy` 刚结束时生产别名可能因边缘缓存仍取到上一版，加随机 query 穿透确认即可，别据此重复部署。

## 4. 用户（项目所有者）的工作约定

1. **用中文交流。**
2. **执行类工作省着用最强模型**：用户原话"执行可以让 opus5 来"——跑测试、批量验证、机械性执行等委派给低成本模型/子代理完成（Claude Code 环境用 Agent 工具 `model: "opus"`；其他工具按其等价机制），设计决策、医学内容、架构取舍用主模型。
3. **文档和记录必须随做随写**：用户明确要求为后来的开发和维护者写好文档。本项目的文档结构（README + DEVELOPMENT + RESEARCH + CLAUDE/AGENTS + 可复跑测试 + 变更日志）就是为此建立的，**每次改动后更新 `docs/CHANGELOG.md`**，别让它腐烂。
4. 版本管理已启用（见 §1.2）。日常改动默认不自动提交/推送，做版本管理动作前先与用户确认。

## 5. 红线（违反会造成实际伤害，务必遵守）

以 [`AGENTS.md`](../AGENTS.md)「硬约定」为唯一真源，这里不再复述（此前这里是一份副本，2026-10 `file://` 降级时两边差点又分叉）。最常被问到的三条：医学内容必须有出处且带"遵医嘱"；不加任何上传/埋点/第三方脚本；适老化只能加强。

## 6. 建议的下一步

路线图只在 [DEVELOPMENT.md §9](DEVELOPMENT.md#9-已知限制与后续路线) 维护（这里原有一份副本，已过时：其中离线缓存、语音朗读都已做完）。眼下最值钱的两件都不是写代码：按 [`MANUAL-TEST.md`](MANUAL-TEST.md) 真机走一遍；用 `node test/preview-figures.js --review` 出复核单找康复医生。

## 7. 文档地图（哪个问题去哪找答案）

| 你想知道… | 去看 |
|---|---|
| 怎么跑起来、给谁用的 | `README.md` |
| 架构、数据 schema、怎么加动作/文章/游戏 | `docs/DEVELOPMENT.md` §3–§6 |
| 为什么做成这样（决策依据）、什么条件下可以推翻 | `docs/DEVELOPMENT.md` §2 |
| 医学数字的出处、哪些数字不能乱写 | `docs/RESEARCH.md` §三、§八 |
| 需求/竞品/适老化规范依据 | `docs/RESEARCH.md` §一、§五、§六 |
| 硬约定速查 | `CLAUDE.md` / `AGENTS.md` |
| 改完怎么验证 | 自动化：`AGENTS.md`「验证命令」；真机手测：`docs/MANUAL-TEST.md` |
| 之前每一版改了什么 | `docs/CHANGELOG.md` |
