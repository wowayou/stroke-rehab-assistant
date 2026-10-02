# 开发与维护文档

> 面向后续开发者/维护者。读完本文你应该能：跑起来、测起来、知道每个文件干什么、知道怎么加一个训练动作/文章/游戏、知道哪些内容不能随便改。

## 0. 改什么，去哪里（速查）

> 只是索引，规则以 [`AGENTS.md`](../AGENTS.md) 为准、细节在下面各节。**先在这张表里找到要做的事，再只读对应的文件段与测试**，不必通读全部文档和代码。测试名对应 `test/<名>.test.js`（`smoke` 是 `test/smoke.sh`），命令见 AGENTS「验证命令」。

| 要做的事 | 改哪里 | 先读 | 改完必跑 |
|---|---|---|---|
| 改/加训练动作 | `js/data-exercises.js`（`id` 发布后不能改） | §6 data-exercises · 硬约定 6 | contracts · speech · smoke |
| 改/加科普文章、急救要点 | `js/data-articles.js` | §8 · RESEARCH §八 | speech（朗读稿全量扫描）· smoke |
| 朗读听着别扭 | `js/speech.js` 的 `SPEAK_RULES`（不改显示文案） | §6 speech · 硬约定 12 | speech |
| 画/改动作示意图 | `js/figures.js` 的 `POSES` | §6 figures | figures + `preview-figures.js` 看图 |
| 认知游戏 | `js/games.js` | §6 games · 硬约定 5 | smoke · overlay |
| 数据结构、校验、统计口径 | `js/storage.js`：`normalizeState` / `medProblem` / `medCountOn` | §5 · §6 storage · 硬约定 7、8、16 | storage |
| 某个页面的显示与交互 | `js/app/` 下对应的一个文件：`today.js` `train.js` `records.js` `meds.js` `learn.js` `settings.js` `backup.js`，文件内搜 `【区】` | `js/app/core.js` 头部的文件地图 · DESIGN-SYSTEM | overlay · settings · smoke |
| 加弹窗/浮层 | `js/app/overlay.js`：`openModal()`、`overlayPush()` | §6 应用层 浮层 · 硬约定 10 | overlay --stress |
| 点一下就生效的设置 | `js/app/core.js`：`segGroupHTML` / `bindSegGroup` / `commitProfile` | 硬约定 9 | settings |
| 跨天、锁屏计时、多页面同步 | `js/app/boot.js` 的 `refreshIfStale()`、`js/app/records.js` 的 `whenValue()`、`js/app/train.js` 的 `openTrainer()` 计时段 | §6 应用层 · 硬约定 15 | lifecycle |
| 备份、恢复、加密、粘贴恢复 | `storage.js` 备份段 + `js/app/backup.js` | §5 隐私边界 · DESIGN-SYSTEM §5 | storage · encryption · overlay · backup-stress · compat |
| 离线缓存 | `sw.js`、`_headers` 的 `/sw.js` 规则 | §6 sw.js | sw |
| 老手机、微信内置浏览器 | 语法上限、`js/boot-check.js`、`js/app/core.js` 的 `IN_WECHAT` | §6 兼容性 · 硬约定 17 | contracts · compat |
| 样式、适老化 | `css/style.css`（颜色尺寸只改 `:root` 变量） | DESIGN-SYSTEM · 硬约定 4、11 | contracts · overlay（90 组布局） |
| 部署上线 | `deploy.sh` | HANDOVER §1.2、§3 | 部署后按 HANDOVER「当前版本」核对 |
| 查某一版为什么这样改 | — | [CHANGELOG.md](CHANGELOG.md) | — |

## 1. 项目是什么

「脑梗康复助手」：面向**脑梗（缺血性脑卒中）恢复期患者及家属**的家庭康复辅助工具。核心场景是出院回家后的日常：每天练什么怎么练、按时吃药、测血压做记录、认识复发信号。

目标用户是老年患者和中年家属，使用环境不可控（老旧安卓机、微信内置浏览器、被儿女远程指导）。这决定了后面所有技术取舍。

## 2. 技术决策记录（为什么是现在这个样子）

| 决策 | 理由 | 推翻条件 |
|---|---|---|
| 纯静态 HTML/CSS/JS，零依赖、零构建 | 双击 `index.html` 就能用；任何静态托管都能部署；十年后依然能跑，不存在依赖腐烂 | 需要多端同步/远程查看时再上后端 |
| 普通 `<script>` 标签 + 全局对象，**不用 ES Modules** | ES Modules 在 `file://` 协议下被浏览器 CORS 策略阻止，会导致"双击打开白屏"。**因此脚本加载顺序重要**（见 §4） | `file://` 已降为尽量支持（2026-10-02），但改模块仍会让它彻底白屏；有明确收益（且已核对老设备兼容）时再议 |
| `file://` 双击打开：**尽量支持，非红线**（2026-10-02 用户决定） | 患者实际都用网址打开；`file://` 的数据和线上按来源隔离、本来就是两份。保留它是因为成本低（冒烟测试仍覆盖） | — |
| 数据只存 localStorage，无账号无上传 | 避免服务端收集与泄露面，老人无需注册登录；但本地数据和下载备份仍是明文健康信息，受设备、浏览器账户和备份保管方式保护 | 用户明确需要多设备同步时（届时优先考虑导出/导入文件方案，其次才是服务端） |
| 手写 canvas 图表 / 手写小游戏 | 引入 chart.js 等会破坏"零依赖"，且需求只是简单折线 | 图表需求复杂化时 |
| innerHTML 模板字符串渲染 | 无构建约束下最直接的方案；配合转义纪律（见 §6 安全） | 交互复杂度显著上升时考虑迁移框架 |
| 适老化：18px 基准/三档字号/≥48px 触控 | 参考工信部适老化通用设计规范的思路 | 不要推翻 |

UI 与 UX 的组件、状态和验收标准见 [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md)；域名切换步骤见 [DOMAIN-MIGRATION.md](DOMAIN-MIGRATION.md)。

## 3. 目录结构

```
stroke-rehab-assistant/
├── index.html            # 应用外壳：顶栏、视图容器、底部导航、modal/toast 挂载点
├── _headers              # Cloudflare Pages 生产响应头（CSP/HSTS/防嵌入等）
├── manifest.json         # PWA manifest（支持"添加到主屏幕"）
├── sw.js                 # 离线缓存（Service Worker），只在线上 HTTPS 由 js/app/boot.js 注册；不在脚本加载顺序里
├── icon.svg              # 应用图标
├── css/style.css         # 全部样式。顶部 :root 定义设计变量（颜色/圆角/导航高度）
├── js/
│   ├── data-exercises.js # 【内容】训练动作库 EXERCISES + 分类 EX_CATS + 阶段 STAGES + 每日推荐 DAILY_PLAN
│   ├── data-articles.js  # 【内容】科普文章 ARTICLES + 紧急识别 BEFAST
│   ├── storage.js        # 【逻辑】Store：localStorage 数据层，唯一的数据读写入口
│   ├── charts.js         # 【逻辑】Charts.line()：零依赖 canvas 折线图
│   ├── games.js          # 【逻辑】Games：4 个认知训练小游戏
│   ├── figures.js        # 【逻辑】FIGURES：训练动作双帧简笔示意图
│   ├── speech.js         # 【逻辑】Speech：Web Speech API 朗读封装
│   ├── app/              # 【逻辑】应用层（2026-10 由 app.js 按页面拆出，共用一个全局作用域，按下列顺序加载）
│   │   ├── core.js       #   共享状态、工具、少算数、分段控件、朗读稿；头部有全部文件的地图
│   │   ├── overlay.js    #   浮层与返回键、openModal
│   │   ├── today.js  train.js  records.js  meds.js  learn.js   # 五个页面（训练含训练引导器，知识含急救弹窗）
│   │   ├── settings.js   #   设置弹窗、字号/音色套用、换声音引导、首次指引
│   │   ├── backup.js     #   从备份恢复（选文件/粘贴/解密/预览）与下载/复制/加密备份
│   │   └── boot.js       #   render/go、跨天与跨页面重画、离线缓存注册、init（最后加载）
│   └── boot-check.js     # 【兜底】ES5：主程序没起来（老浏览器/初始化出错）时显示人话 + 拨 120，最后加载
├── test/
│   ├── storage.test.js   # 数据层单元测试（node 直接跑）
│   ├── encryption.test.js # 可选加密备份单元测试（node 直接跑）
│   ├── contracts.test.js  # 跨模块静态契约检查（node 直接跑）
│   ├── figures.test.js    # 简笔画几何校验 + 临床角度护栏（node 直接跑）
│   ├── figure-angles.js   # 简笔画关节角度推导（测试与复核单共用，不随应用发布）
│   ├── speech.test.js     # 朗读层：归一化规则全表 + 句间停顿（node 直接跑）
│   ├── overlay.test.js    # 真实 Chromium 浮层/返回/急救/布局回归
│   ├── settings.test.js   # 真实 Chromium 即时生效偏好落盘与回显
│   ├── backup-stress.test.js # 接近上限的大备份压力回归
│   ├── lifecycle.test.js  # 真实 Chromium：跨天、锁屏计时、多页面同步、屏幕常亮（时钟/可见性打桩）
│   ├── sw.test.js         # 真实 Chromium：离线缓存（Node 静态服务器按真实 _headers 加头）
│   ├── compat.test.js     # 真实 Chromium：兜底页、微信复制备份/粘贴恢复、无 Pointer Events
│   ├── preview-figures.js # 简笔画截图（目视用，非断言）；--review 生成给医生的复核单
│   └── smoke.sh          # 无头浏览器冒烟测试（5 个页面/file:// + 资源可达）
├── docs/
│   ├── HANDOVER.md       # 交接文档：当前状态、未验证项、部署与环境备忘（新接手先读）
│   ├── DEVELOPMENT.md    # 本文档（§0 是"改什么去哪里"速查）
│   ├── CHANGELOG.md      # 变更记录（查"某一版为什么这样改"时再读）
│   ├── DESIGN-SYSTEM.md  # UI/UX 组件与行为标准
│   ├── MANUAL-TEST.md    # 真机手测清单（唯一真源）
│   ├── DOMAIN-MIGRATION.md # 换域名的执行方法
│   └── RESEARCH.md       # 产品调研结论（需求痛点、循证依据、竞品、设计规范）
├── AGENTS.md             # 【硬约定唯一真源】所有 AI 工具都读这份；含验证命令与「改完之后」纪律
├── CLAUDE.md             # 仅一页指针，指向 AGENTS.md（**不要在这里另写一份**，曾分叉出真错误）
└── README.md             # 面向使用者的说明
```

**内容与逻辑分离**是本项目最重要的结构约定：改训练动作、改文章**只动 `data-*.js`**，不需要碰任何逻辑代码。

## 4. 脚本加载顺序（不能乱）

`index.html` 底部按此顺序加载，后者依赖前者定义的全局名：

```
data-exercises.js → data-articles.js → storage.js → charts.js → games.js → figures.js → speech.js
→ app/core.js → app/overlay.js → app/today.js → app/train.js → app/records.js → app/meds.js → app/learn.js → app/settings.js → app/backup.js → app/boot.js
→ boot-check.js
```

`boot-check.js` 必须最后：它靠 `typeof App` 和 `#view` 是否有内容判断主程序有没有起来。

全局名清单：`EXERCISES` `EX_CATS` `STAGES` `DAILY_PLAN` `ARTICLES` `BEFAST` `Store` `Charts` `Games` `FIG` `POSES` `FIGURES` `Speech` `App`，外加 `js/app/` 各文件的顶层函数与变量。

**`js/app/` 是同一个程序切成的几段**（2026-10 由 2800 行的 app.js 拆出，纯搬移、逻辑未改）：普通 `<script>` 共用一个全局作用域，所以一个文件里的函数可以直接调用另一个文件里的函数（运行时都已加载）；但**文件顶层立即执行的代码只能用排在它前面的文件里的东西**——`boot.js` 的 `RENDERERS` 在加载时就引用各页的 `renderXxx`，所以它必须最后。代价是这些名字都成了全局名，两条护栏防止出事：`contracts.test.js` 查各文件顶层名字不重复（`let/const` 重复整页加载失败，`function` 重复会悄悄覆盖）；`compat.test.js` 在真实浏览器里查它们不与浏览器自带的全局名同名（同名会盖掉 `window` 上的东西）。为什么不用 ES Modules：会让 `file://` 白屏、老设备兼容更差（硬约定 2、17），而切文件已经拿到"一次只读一块"的主要好处。

`sw.js` 不在这个顺序里（它跑在 Service Worker 线程，由 `js/app/boot.js` 的 `registerOffline()` 注册），也不读任何全局名。新增脚本时放在 `js/app/boot.js` 之前的合适位置，同步改 `index.html`、本节、`contracts.test.js` 的 `APP_FILES`（应用层文件）与 `test/smoke.sh` 的静态资源清单；`deploy.sh` 整目录拷贝 `js/`，无需改。

## 5. 数据模型（localStorage）

单一 key：`strokeRehab.v1`（版本号在 key 名里；不兼容的 schema 变更时新建 `strokeRehab.v2` 并写迁移代码，见下）。完整 schema：

```js
{
  profile: {
    name: '',            // 称呼，显示在问候语里
    strokeDate: '',      // 发病日期 YYYY-MM-DD，用于计算"康复第N天"（发病日=第1天）
    stage: 'sitting',    // 康复阶段 bed|sitting|standing|walking，决定推荐训练
    font: 'normal',      // 字号 normal|large|xlarge
    speechRate: 'slow',  // 朗读语速 slow|mid|fast（默认慢；枚举值在 load() 里消毒）
    height: '',          // cm，选填，用于 BMI；只收 50～250（按米填的 1.7 读盘时丢弃）
    targets: {           // 个人目标值（遵医嘱、可调），数字在 load() 里消毒
      bpSys: 140, bpDia: 90, gluFast: 7.0, gluPost: 10.0,
    },
  },
  meds: [                // 药物清单
    // from = 开始吃的日期（新登记默认当天，避免把登记之前的日子算成漏服）
    // to   = 最后一次服药的日期（含当天），'' 表示还在吃
    // 停药只写 to、**不删记录**：删了复诊查不到吃过什么，留着不管又会天天算漏服。
    // 所有服药计数都走 Store.medsOn(date)，所以停药/加药不影响历史日期的分母。
    { id, name, dose, times: ['08:00','20:00'], note, from: 'YYYY-MM-DD', to: '', previousCourseId: '' }
  ],
  medLog: {              // 服药核对记录
    'YYYY-MM-DD': { '<medId>@<HH:MM>': true }
  },
  vitals: {
    bp:      [{ id, date, time, sys, dia, pulse }],   // 血压
    glucose: [{ id, date, time, gtype, value }],      // 血糖，gtype: 空腹|餐后2小时|随机
    weight:  [{ id, date, value }],                   // 体重 kg
  },
  exerciseLog: { 'YYYY-MM-DD': ['exId', ...] },       // 训练打卡（同日去重）
  gameLog:     { 'YYYY-MM-DD': [{ game, score, detail, time }] },  // 游戏成绩
  ui: { guideSeen: false, lastBackupAt: '' },  // 是否看过首次指引 / 这台设备上次点"下载备份"的日期
}
```

约定：

- **所有读写必须走 `Store` 的方法**，不要在视图代码里直接摸 `localStorage`。
- `Store.load()` 通过 `normalizeState()` 对缺字段与非法嵌套值做深度规范化；读取失败时用空值维持页面可打开，同时禁止写入并保留原件。`storageStatus()` 向界面提供持续错误，`originalData()` 仅提供读取失败的原始文本供人工排查；该文本不是已校验备份。
- **隐私边界**：`localStorage` 与普通 JSON 备份都是明文。不做“应用内加密”，因为密钥若同存在浏览器里不能抵御设备或同源脚本失陷，而要求患者每次输入口令会增加锁死数据的风险。v0.2.21 仅为需要放网盘/共享电脑的备份提供主动选择的口令加密（PBKDF2-SHA-256 600000 次 + AES-256-GCM，随机 16-byte salt / 12-byte IV，口令不保存）；普通备份仍是默认主操作，旧明文备份保持兼容。忘记口令无法恢复，弱口令仍可能被猜中，界面必须同时说明这两个边界。
- 日期一律 `YYYY-MM-DD` 本地时区字符串（`Store.today()` / `Store.addDays()`），不要用 `Date.toISOString()`（会有 UTC 偏移导致的跨天 bug）。
- 未来做 schema 迁移：在 `load()` 里检测旧 key 存在且新 key 不存在 → 转换 → 写新 key（保留旧 key 一段时间以便回滚）。

## 6. 各模块要点

### 应用层 js/app/（原 app.js；`core.js` 头部有文件地图，各文件内分区标题带 `【区】` 前缀可搜索跳转）

- **视图注册表** `RENDERERS = { today, train, records, meds, learn }`，`App.go(view)` 切换。支持 URL 参数 `?view=xxx` 直达（冒烟测试和深度链接依赖此特性）。
- **渲染模式**：每个 `renderXxx()` 整段重建 `#view` 的 innerHTML，然后绑定事件。数据变更后调 `render(currentView)` 重渲染。没有虚拟 DOM，没有局部更新——数据量小，整页重渲染足够快，别过早优化。
- **少算数原则（v0.2.12，改 UI 时必须遵守）**：卒中后计算障碍很常见，界面里**不要出现需要患者心算或理解比率的东西**。已有的三个工具函数，加新指标/新进度时直接复用：
  - `leftText(done, total, unit)` → "还差 3 次"（不写 `2/5`、不写百分比）；
  - `dotsHTML(done, total)` / `repTrackHTML(done, total)` → 圆点或进度条（>12 个自动改进度条，否则糊成一片）；
  - `deltaLineHTML(kind)`、`chartSummaryHTML(kind, list)`、`plainDuration(sec)` → 差值、图表小结、"大约 5 分钟"都由应用算好再说。
  - 结论在前、数字在后（如 BMI 写成"体重适中（BMI 21.6）"）。给医生看的精确数字（百分比、导出报告）保留，但标注"给医生看的"并降为次要信息。
- **认同患者的措辞（v0.2.12）**：不打分、不排名、不按成绩分档给评语；连续天数断了先肯定历史（`Store.bestStreak()`）再说"做一个动作就重新开始"；做不到/漏做一律按"很常见、不是您的问题"处理并给出可执行的办法，不用威慑或指责。医学事实与安全警示不得因此删弱（见 §8）。
- **浮层与返回键（v0.2.22，加浮层时必须照做）**：安卓实体返回键默认会直接退出应用，对老人是很糟的体验。每开一个浮层就 `overlayPush()` 压一个历史条目；实体返回键或屏幕上的 ✕ / Esc 都只发起 `history.back()`，统一由 `popstate` 调 `closeTopOverlayDOM()` 关最上层，保证 DOM 与历史状态同步。主动关闭先置 `dismissPending` 并禁用控件，避免回退完成前快速双击重复保存。父任务打开帮助或独立任务时直接 `openModal()` 叠子层，保留父层 DOM；同一任务切换步骤才用 `close.replace(openNext)` 原位替换，既不 back 也不再次 push；`openTrainer` 换动作同样复用已有条目（`hadTrainer` 判断）。没有浮层时不拦返回键。相关回归必须跑 `node test/overlay.test.js --stress`。
- **即时生效型设置必须即时落盘（v0.2.25，加这类偏好时必须照做）**：字号、语速这类"点一下就看到/听到效果"的偏好，**不能挂在「保存设置」按钮上**。设置弹窗有 ✕、安卓返回键、Esc、点遮罩四种关法，只有一种会走保存按钮——挂在保存上等于四分之三的关法都会丢设置。两条规则：① 点一下立刻写 `Store`（走 `commitProfile()`，同训练页阶段 chip 的 `Store.save()` 范式）；② 选中态**只从 `Store` 派生**（`segGroupHTML()` 渲染 + `bindSegGroup({ current, commit })` 重刷），绝不用 DOM 上残留的 `.active` 反推真值。用 `.active` 反推是 v0.2.25 修掉的那个 bug 的根源：DOM 与 `Store` 成了两个真相来源，点完特大再用 ✕ 关掉，字号已生效但没落盘，重开回显"标准"、刷新后字号直接掉回标准。相关回归必须跑 `node test/settings.test.js`。
- **同类条目用分组列表，不要一条一张卡（v0.2.26，加列表/按钮时必须照做）**：同一页出现三个以上同构条目（训练动作、科普文章）时，用「分组标题 + 一张卡内分行」（`.section-label` + `.list-group` / `#ex-list` + `.ex-item`），不要每条一张带阴影的浮动卡片——十几张同款卡叠起来是"卡片墙"，看不出哪项是今天该做的。按钮分三级：**实心蓝（`.btn`）每屏只允许一个主操作**（保存、拨 120），列表行里重复出现的操作用浅蓝（`.ex-start` / `.ci-action`，`--primary-soft` 底 + `--primary-dark` 字，对比度约 6.4:1），完成态用浅绿。一屏六七个实心蓝按钮会让真正的主操作消失在其中。触控目标仍是 48px 起，分级只改颜色不改尺寸。
- **重渲染不要跳页首**：`render(view, { keepScroll })`。切页用默认（回顶部），"数据变了重渲染"（如训练打卡）传 `keepScroll: true`——否则在训练页往下翻着练，练完一个就被弹回顶部。
- **跨天与跨页面（v0.2.32，硬约定 15）**：手机切后台不重载页面——晚上打开的用药页第二天切回来，曾显示昨天全打了勾。`refreshIfStale()` 在切回本页（`visibilitychange`/`pageshow`/`focus`）、别的页面写过数据（`storage` 事件）和开着时每分钟检查一次：日子换了或 `Store.reloadIfChanged()` 读到新数据就重画（保留滚动与记录草稿）；有浮层开着时只记 `refreshPending`，最后一层关掉再画。用药核对点击前也先检查一次，旧屏幕上的那一下不记账。记录表单的日期时间默认"跟着现在走"（`whenValue()`，表单上 `data-when="set"` 才按用户所填），草稿也不冻结旧时刻。
- **训练引导器 `openTrainer(ex)`**：全屏覆盖层，按 `ex.mode.type` 三种形态：
  - `reps`：大圆按钮计次，**大数字是"还差几次"的倒数**（不是已完成数），到量显示 ✓、超量说"比目标还多 N 次"，达标震动+提示音；
  - `timer`：倒计时（开始/暂停/重置）+ 人话时长与进度条，归零提示。**按截止时刻现算剩余**（`deadline - Date.now()`），不按每秒减一：锁屏/后台时定时器会被冻结或降频，减一式计时会停在半路；锁屏期间到点的，切回来由 `_tick()` 立刻报"时间到"。到点后再点从头计；
  - `game`：挂载认知游戏，游戏内"完成打卡"回调 `finish()`；另传 `onSwitch(gameKey)`（换成别的游戏）与 `onQuit()`（中途收工也打卡）。
  - 完成 → `Store.logExercise(id)`（同日去重）→ toast → 关闭 → 重渲染。
  - **关闭时必须清理**：`closeTrainer()` 负责 `clearInterval` + `Games.stop()` + `Awake.stop()` + `releaseAudio()`，新增异步资源要在这里一并清理。
  - **屏幕常亮与提示音（v0.2.32）**：训练页开着时 `Awake` 请求 Screen Wake Lock（不支持就静默放弃），10 分钟没碰屏幕且不在计时就放掉；页面切走浏览器会自动释放，切回来 `Awake.poke()` 再要。提示音共用一个在点按里创建/恢复的 `AudioContext`（`unlockAudio()`）——iOS 上不在点按里建的 AudioContext 是静音的，计时结束那一声由定时器触发，以前每次新建所以不响。
- **历史视图**：三个入口都是 `openModal` 弹窗，不占主页面高度——`openVitalHistory(kind)`（趋势图 + 全部记录 + 状态点 + 删除，删除后 `paint()` 重画弹窗并 `renderRecords()` 刷新背后页面）、`openExerciseHistory()`、`openMedHistory()`。血压/血糖/体重的判定统一走 `vitalStatus(kind, v)`（复用 `bpBadge/gluBadge/bmiBadge`），趋势图统一走 `drawVitalChart(kind, canvas, recent)`——**加新指标时改这两个函数即可**。打卡日历 `calendarHTML(n)` 由 `Store.exerciseCalendar(n)` 驱动，训练页与弹窗共用。
- **安全/转义纪律**：所有**用户输入**（姓名、药名、剂量、备注等）插入 HTML 前必须过 `esc()`。`data-*.js` 里的静态内容是我们自己写的，直接插入；**如果未来文章/动作内容改为用户可编辑或远程下发，必须改为全量转义或消毒**。
- 提示反馈：`toast(msg)`（5s 自动消失）；需用户处理的错误用 `showError()` 持续显示，存储问题另由 `renderStorageNotice()` 显示；`beep()`（WebAudio 提示音+震动，失败静默）。

### storage.js

纯数据层，无 DOM 依赖（因此可以在 Node 里测试）。公开 API 见文件头部注释和 `return` 清单。**写入 API 先校验再改数据（硬约定 16）**：`addMed/updateMed` 走 `medProblem()`（药名、时间、`from ≤ to`、新旧疗程不重叠），`toggleMed` 只接受当天确实要吃的那一次、不能提前勾，`addVital` 先过与读盘同一套 `VITAL_CLEAN`、拒绝将来日期；不通过就 `refuse(原因)`，界面经 `stored()` 显示 `Store.actionError()`。**服药统计分两种口径**：今日核对表（`medProgressToday`）数全天；"吃没吃到"（`adherence7d`/`medFullDays`/`medStatusOn().dueTotal`）只数已到点的（`isDoseDue`），这些函数都接受 `now` 参数，测试必须传固定时刻。`reloadIfChanged()` 供跨页面同步。`save()` 在规范化前检查容量、保存前对照 `persistedRaw` 检测过期快照，失败回滚到 `persistedJSON`；不会自动合并另一标签页的数据。`exportBackup()` 也走解析校验，拒绝不可恢复的文件。改这里必须同步跑 `node test/storage.test.js`。

### data-exercises.js

训练动作 schema：

```js
{
  id: 'bobath',            // 全局唯一，打卡记录引用它，【发布后不要改 id】否则历史打卡对不上
  cat: 'limb',             // limb|hand|speech|swallow|cognitive
  stage: 'bed',            // 仅 limb 类需要：bed|sitting|standing|walking
  icon: '🙌',              // emoji 图标
  name, goal, dose,        // 名称 / 目的 / 建议量（纯文本）
  mode: { type: 'reps', target: 10 },     // 或 {type:'timer', seconds:300} 或 {type:'game', game:'memory'}
  steps: ['...'],          // 分步要领，患者视角、口语化
  caution: '...',          // 安全警示（可省略，但站立/步行/吞咽类必须有）
}
```

`DAILY_PLAN` 定义各阶段的每日推荐组合（4~6 项，覆盖肢体+手/言语+认知）。新增动作后酌情加入。

### data-articles.js

文章 schema：`{ id, icon, group, title, sub, body }`。`body` 是 HTML 字符串，可用的语义类：`<h3>` 小节、`.art-tip`（绿色提示框）、`.art-warn`（红色警告框）。分组按 `group` 字符串自动聚合，顺序 = 首次出现顺序。

### charts.js

`Charts.line(canvas, seriesArr, opts)`。`seriesArr: [{label, color, values: [{x:'MM-DD', y:Number}]}]`；`opts.refLines: [{y, color, label}]` 画目标参考虚线。已处理 devicePixelRatio。X 轴按索引均分（非时间比例尺）——对"最近14条记录"这种用法是正确的简化。

### games.js

`Games.start(key, container, onDone, opts)`；`onDone(score, detailText)` 由游戏的"完成打卡"按钮触发。`opts = { onSwitch(gameKey), onQuit() }` 供"换个不用算的""先打卡收工"使用——**游戏层不碰 `Store`**，打卡与打开别的动作都由 `js/app/train.js` 执行。**新增游戏**：写 `function mygame(container, onDone, opts)`，结束时调 `showResult()`，注册进 `registry`，再到 data-exercises.js 加一条 `mode: {type:'game', game:'mygame'}` 的动作。游戏内的 `setInterval` 必须存入模块级 `timerId`（`Games.stop()` 靠它清理）。

**「算一算」（`math`）的设计约束**——这是最容易让患者产生逆反心理的一处，改动前请读 §6 的"少算数原则"：三档难度自选且随时可换（`MATH_LEVELS`，`mid` 档刻意**不产生进位/退位**）；**答错不判错不记分**（第一次橙色"再看看"允许重选，第二次给答案 + `mathExplain(q)` 的分步拆解）；「看提示」「这道先跳过」都不扣分不变红；连错两道自动降到容易档；结果页只报"做完几道 / 自己算出几道"，**不出现比分**。`mathExplain` 有凑十、退十、整十、借十四种讲法，改它必须穷举校验文案里的每个算式与中间结果（曾出现"先减 0 回到整十"这类错误 670 例）。

### speech.js

`Speech.speak(text, {rateKey, onEnd, onFail})` / `stop()` / `speaking()` / `supported()` / `rateOf(key)` / `splitSentences(text)` / `normalize(text)` / `voices()` / `setVoice(name)` / `voiceName()`。Web Speech API，零依赖。应用层（`js/app/core.js`）用 `speakBtnHTML(id, label)` + `bindSpeak(btn, getText)` 接线，朗读稿由 `exerciseSpeechText(ex)` / `articleSpeechText(a)` 生成。

**"听起来生硬"是三层问题，不是音色问题（v0.2.27）**。用户回报"配音太生硬"，本能反应是换音色，但实测三层里音色是影响最小的一层：

1. **喂给引擎的文本（主因）**。屏幕上的写法是给眼睛的，原样丢给 TTS 就是机器味的来源：`10～15次` 念成"10 15次"（范围整个听不出来）、`mmHg` 拼成"m m h g"、`10次×2组` 念成"10次乘2组"、`130/80 mmHg` 念成"130斜杠80"、`——` 引出的补充说明被跳过或念出怪音、`阿司匹林+氯吡格雷` 的加号念不出来。`normalize()` 里的 `SPEAK_RULES` 逐条换成口语说法，**界面显示一个字都不改**（数据文件不动）。规则表**顺序敏感**，改动前读表上的注释：含 `/` 的单位必须排在裸 `/` 规则之前（否则 `mmol/L` 先变成"mmol或L"）；去 emoji 的码位区间覆盖了箭头，必须排在箭头规则之后（否则 `→` 被直接删掉、递进关系丢失）。两条易犯的错：① 吃单位/破折号前后的空白只能用 `[ \t]`，**用 `\s` 会连换行一起吃掉**，把上下两句粘成一句（这条踩过，被测试抓出来）；② 乘号规则只能要求右边是数字——动作库里 7 处乘号左边全是量词（`10次×2组`、`5～10个台阶×2～3回`），要求左边也是数字会一处都匹配不上。
2. **句间没有换气**。原先是"上一句 `onend` 立刻 `speak` 下一句"，机关枪式。现按标点给不同长度的停顿（`GAP_SENTENCE` 320ms / `GAP_CLAUSE` 130ms，`gapAfter()` 判断）。**停顿定时器也必须认代号**：停顿期间用户点了停止或换了内容，定时器到点不能把旧队列接着念下去。
3. **文章的块级边界**（在 `js/app/core.js` 侧）。`articleSpeechText` 原先用 `textContent` 直取，`<h3>2. 控制血压</h3><ul><li>高血压是…` 被粘成"控制血压高血压是…"，一句破句念到底。改成 `collectSpeechBlocks()` 按块级标签断行、段末没标点补句号。**只在"叶子块"上取文本**（`node.matches(SPEECH_BLOCK) && !node.querySelector(SPEECH_BLOCK)`），否则 `ul`/`div` 这类外层容器会把内层每一段重复念一遍。实测 9 篇文章切出 10~21 块。

**音色可选**：有些系统装了多个中文音色，默认那个不一定最好听。`voices()` 只列中文音色（`/^zh/`）；音色名对老人没有意义，`VOICE_ALIAS` 按 **token 子串**匹配给中文说法（不能用整名相等——iOS 是 `Tingting`、安卓是 `Chinese China`、Windows 是 `Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)`，整名相等只认得出 iOS 那一种，其余会把一长串英文塞进按钮），认不出的走 `shortLabel()` 去掉厂商前缀与括注、实在没人名就用"中文语音"兜底。设置页只在 `voiceOpts.length > 1` 时才显示这一档（只有一个声音时让人"选"是无意义的噪音）。存 `profile.speechVoice`（自由字符串，**不能白名单**：每台机器装的音色不一样，枚举不出来），机上不存在时 `pickVoice()` 静默回落到 zh-CN → 任意中文，换手机或恢复别人的备份都不会哑掉。凡是整体换掉 `data` 的地方（启动、恢复备份、撤销恢复、清空）都要 `applyVoice()` 重新套一次——和 `applyFont()` 同一个道理。

**五个已踩过的坑，改这里前务必知道**：

1. **音色异步加载**：Chrome 首次 `getVoices()` 返回空，要监听 `voiceschanged` 重挑中文音色。
2. **长文本被截断**：部分浏览器对单条 utterance 有长度限制 → `splitSentences()` 按句切分排队朗读。
3. **`onend` 偶发不触发**：队列会卡住 → 按字数估算时长的看门狗定时器兜底推进。
4. **API 齐全但一个音色都没有**（部分微信内置 WebView、未装语音包的系统）：`speak()` 静默失败，`supported()` 仍为 true。因此**不能只靠 `supported()` 判断能不能出声**——`speak()` 内有 1.5 秒起播看门狗，没等到 `onstart` 就调 `onFail`，UI 负责复原按钮并提示"这个手机好像没装朗读语音"。**不要**加"本机是否有语音包"的查询接口：`getVoices()` 为空时无法区分"还没加载完"和"根本没有"，给不出可靠答案。
5. **不能用 lookbehind**（`(?<=)` / `(?<!)`）：老 WebView 不支持，会让**整个文件解析失败、朗读功能全哑**。需要"只在左边是某类字符时替换"就用捕获组把左边那个字带回来（见加号规则）。contracts 与 speech 测试都钉了这条。

**为什么不换成"更好的 TTS 库"（v0.2.28 选型结论，再被问到直接引这段，不用重新调研）**：本项目的红线——零依赖、隐私红线、CSP `connect-src 'none'`（当时 `file://` 可用也算一条，2026-10 已降为尽量支持，不改变结论）——几乎排除了全部神经 TTS。

| 方案 | 本质 | 为什么不行 |
|---|---|---|
| Azure AI Speech / edge-tts | 文本发到微软服务器 | 违反隐私红线，且 CSP `connect-src 'none'` 直接禁掉 |
| SpeechT5 / Kokoro / Piper | 浏览器端 ONNX+WASM 离线推理 | 要么需下载数十~上百 MB 模型（同样被 CSP 禁，得放宽才能下），要么需打包进部署+构建步骤（破零依赖）；老人机加载与推理都吃力 |

**要用神经 TTS 就必须先松一条红线，这是产品决策，不是技术选型——必须先问用户。** 不破红线的替代路径已在 v0.2.28 落地：`openVoiceGuide()` 教用户在手机系统里下载更自然的中文语音包（iOS 带「增强／高质量」的声音、安卓的中文语音数据），装一次长期可用，**音质提升远大于应用层能做的任何调整**。引导措辞只给"大致这样找"+ 搜索关键词，不给精确按钮名：各机型/版本菜单名不同，给老人一个找不到的按钮名比不给更糟。

**必须 `Speech.stop()` 的时机**：关训练引导页（`closeTrainer`）、关任意弹窗（`openModal` 的 `close`）、切换主页面（`go`）。漏了会在 iOS 上继续念上一页的内容。

`node test/speech.test.js` 是这层的护栏（**改 speech.js 或朗读稿必跑**）。它不只测样例，还拿真实动作库+文章库**全量扫**（47 条）确保没有漏网的写法；用桩 `speechSynthesis` 记时间戳**真的量出句间停顿**（不是看源码里有没有写）；并反向断言数据文件里给眼睛看的 `～`/`×`/`mmHg` 必须还在——**朗读稿变了但显示文案一个字都不能改**。

### figures.js

三层结构，**不要手填坐标**：

1. `FIG` —— 骨架与画法引擎。`SEG` 按成人 7.5 头身折算各肢段长度（头 12 → 全身 90；来源见 docs/RESEARCH.md §十）；`at(from, deg, len)` 沿角度走一段得到关节；`joint(a, c, l1, l2, dir)` 是两连杆逆解——**已知髋与脚、反求膝**，这是"抬臀时脚必须钉在原地"的关键；`figure(pose)` 把姿势画成 SVG；`foot(an, toe)` 把脚画成楔形。
2. `POSES[id] = { alt, props, arrow, frames:[poseA, poseB], labels, review, ... }` —— 姿势用 `at`/`joint` **算**出来，因此肢段长度由构造保证一致。局部帧 0..104 × 0..118，y 向下，地面/床面 y=100。`review` 是这张图复核状态的唯一真源（见下）。
3. `FIGURES[id] = { alt, svg }` —— 加载时渲染（左帧 `translate(4,0)`、右帧 `translate(128,0)`，画布 240×140）。应用层只用这一层（`js/app/core.js`）：`figureHTML(ex)` 有图就画、没图退回大 emoji，**不留空位**。

`node test/figures.test.js` 是这套东西的护栏，**改 figures.js 必跑**。它把"画得对不对"变成可断言的几何性质：每帧肢段长度等于骨架定义、两帧必须是**同一个人**（同名肢段长度相等）、关节不穿地、两帧差异足够大（否则小尺寸看不出动作）、key 必须对得上真实动作 id，再加每个动作的医学要点（踝泵勾脚绷脚夹角 ≥60° 且不穿床垫、Bobath 双手必须过头顶且与头横向拉开 ≥8、桥式肩脚不动且肩髋膝近似共线、坐到站髋明显升高躯干竖直、踏步抬起侧膝高于支撑侧且脚离地）。**它第一次运行就抓出一个真 bug**（踏步站立帧的远侧腿被画到了髋以上）。

**临床角度护栏（v0.2.31，新画一张图必须照做）**：上面这些只保证"几何自洽"，管不了"图和动作自己的文字要领对不对得上"——v0.2.31 把关节角度算出来对照原文，一跑就抓出 4 张线上图与要领矛盾（坐站转移脚在膝前、前倾不足、双手没前伸；踝泵"勾脚"其实是跖屈、"绷脚"跖屈 96°；桥式踮着脚且塌腰；踏步没画扶持物且远侧膝过伸）。`test/figure-angles.js` 的 `jointAngles(pose)` 由几何推出肩前屈/肘屈/躯干-大腿角/膝屈/踝背屈（屏幕 y 向下、逆时针为正；现有图都是右手系，将来画朝左的图须加镜像标记再取反），`figures.test.js` 第 7 节分两层拦：① 每帧角度在宽松活动度包络 `ROM` 内，拦人做不到的姿势；② 每个动作一组**从 `steps`/`caution` 原文推出**的专属断言，注释引原文，原文一改测试就提醒同步。**新图必须写第 ② 层**。这是火柴人近似角（躯干一根刚体，"躯干-大腿角"含腰椎前屈），只拦明显错误，不冒充临床测量。

画法约定：线条 `currentColor`（跟随主题色与字号）；不画关节实心点（手绘线的转折本身就交代了关节）；颈部画到头的圆周为止（连到圆心会在头里留一根杆）；脚用楔形不用线（跖屈时脚与小腿几乎共线，线看着像"腿变长了"）；虚线只用于对齐提示；同一部位两帧只改角度、不改形状。`alt` 既给读屏也印在图下方，必须能独立说清动作，且与 `steps` 一致。

**动作部位高亮与运动弧线（v0.2.31）**：`POSES[id].focus` 列出这个动作真正在动的部位（`trunk`/`arm`/`leg`/`foot`，远侧加 `2`），渲染时单独成组、带 `class="fig-focus"`，由 CSS（`.ex-figure .fig-focus` → `--orange`）换成强调色——颜色只走样式表，SVG 里仍是 `currentColor`；`POSES[id].motion = { pivot, end, r }` 在到位帧画一条绕 `pivot` 的弧形箭头，方向由两帧姿势**现算**，不手填；弧会压在肢体上时不画（桥式），半径要让弧落在末端关节外侧（踝泵 r 小于脚长时弧被脚挡住）。整体性动作（坐站转移）不设 focus。**不做患侧上色**：图是侧面视角，患者患侧因人而异，固定一侧上色会误导。关节圆点、加粗线条已被上面的画法约定否决，别再提。

⚠️ **医学示意内容**：姿势要点取自 data-exercises.js 里已按指南核对过的 `steps`/`caution`（来源见 docs/RESEARCH.md §八），**仍需康复医生复核**，尤其患侧摆位与关节角度；宁可不画也不要画错。每张图的复核状态**只记在 `POSES[id].review`**（`pending`/`approved`/`changes`；已确认须填复核人身份与 `YYYY-MM-DD` 日期；`questions` 列要请医生拍板的点，角度写"见角度表"不写死数字；测试第 8 节校验）。`node test/preview-figures.js --review` 生成复核单：`figures-review.pdf`（A4 打印）+ `figures-review.png`（长图，便于微信发送），每图一页——大图、应用内原文要领、现算角度表、待确认问题与签名栏，不含患者数据。医生结论回填 `review`。

**人眼检查是必需的，几何断言替代不了它**（AI 写坐标是盲画）。用 `node test/preview-figures.js` 生成 `figures-preview.png`（同时给 400px / 150px / 96px 三种尺寸），再 `node test/preview-figures.js <动作id>` 逐张放大看。这轮靠放大才发现的问题：整条腿悬空在床面上方 12 个单位；跖屈的脚穿进床垫里；严格侧面直上举时手和头挤成"两个圆圈"（改成符合 Bobath 做法的前屈上举后解决）；脚画成线几乎看不见；虚线残影放大后是一团碎线（已删）。

**为什么不接 MediaPipe / SetPose / Rive 等（v0.2.31 选型结论，再被问到直接引这段，不用重新调研）**：2026-09 用户提供的一份火柴人示意图技术栈调研，主张「姿态数据与渲染分离 + 临床规则校验 + 临床人员审核后再发布」。前后两段本项目早已具备（`POSES` → `FIG.figure()` → `FIGURES`），缺的是规则校验与复核流程，已按上面两段补上。调研推荐的工具与红线冲突：

| 方案 | 本质 | 为什么不用 |
|---|---|---|
| MediaPipe / MoveNet（摄像头识别动作） | 浏览器端 WASM + 模型推理 | 生产 `Permissions-Policy: camera=()` 禁摄像头、CSP `connect-src 'none'` 禁加载模型、`file://` 载不了 WASM；患者视频属敏感个人信息；"做得对不对"的反馈违背硬约定 #5 不打分；把定位从教学示意推到运动量化/评价，牵动医疗器械边界；调研自己也承认对卒中患者的测量准确性未经验证 |
| SetPose / PoseMy.Art / Magic Poser | 在线 3D 姿势编辑器（付费） | 产出 PNG/3D，不是我们的数据；瓶颈是找医生而不是作图。借了它"用关节角度和治疗师对话"的思路，做成复核单的角度表 |
| Rive / Lottie / Spine / Three.js | 动画或 3D 运行时库 | 破零依赖 |
| OpenCap / OpenSim | 多机位测量与生物力学验证 | 本应用不做测量 |
| Noun Project 素材、Mannequin.js | 图标库 / GPL 人体模型 | 授权问题；各张图骨架不一致 |

**要做摄像头动作识别，必须先松红线（摄像头权限、CSP、零依赖）并重新评估医疗器械边界——这是产品决策，不是技术选型，必须先问用户**（2026-09-26 用户已定：不做）。动画可以零依赖自做（按关节角度插值画 SVG），前提：① 复合动作用关键帧，不能两帧线性插值——坐站转移会变成"边起身边伸直"，恰好教错"先前倾、后起身"的顺序；② 有暂停键（自动播放超过 5 秒必须可停，WCAG 2.2.2）；③ 服从系统"减少动画"；④ 两端姿势先经复核。患侧着色留到画"好腿先上、坏腿先下"这类新图时再定，颜色不能单独承载含义。

### 兼容性（v0.2.33，硬约定 17）

目标：**Chrome 62 / iOS 11.3 以上能用**。老人常用旧手机和系统自带浏览器（国内部分安卓系统 WebView 停在 Chrome 6x，iPhone 6/5s 最高 iOS 12）；安卓微信内置浏览器是 XWeb（Chromium 1xx），不是瓶颈。以前用了 `?.`/`??`，iOS 13.3 以下与 Chrome 79 以下整个文件解析失败、白屏。

- **语法与 API 上限 ES2018**：静态护栏在 `contracts.test.js`（列出了禁用写法）。它只能扫已知写法；改了运行时脚本、拿不准时用**真解析器**核对：把 Node 8（V8 6.2≈Chrome 62）下载到临时目录，`node-v8.17.0-linux-x64/bin/node --check js/*.js` 全部通过才算数（下载地址 `https://nodejs.org/dist/v8.17.0/node-v8.17.0-linux-x64.tar.xz`，不要装进系统）。`sw.js` 不受此限（只在支持 Service Worker 的新浏览器里跑，解析失败即没有离线缓存）。
- **运行时兜底**：`boot-check.js`（ES5）在主程序解析失败或初始化出错时显示"这个浏览器打不开本应用"+ 换浏览器的办法 + BE-FAST 与拨 120，并藏起点了没反应的导航。`index.html` 另有 `<noscript>`。
- **会降级、不会坏的**：iOS 14.1 / Chrome 84 以前不支持 flex `gap`，间距变紧（55 处，未逐一兜底）；`inert`、屏幕常亮、离线缓存、`:focus-visible` 不支持时静默跳过；无 Pointer Events（iOS 12）时图表改用 `click`。
- **微信内置浏览器**：不能下载文件，记录存在微信自己的存储里（清理微信缓存可能被一起清掉）。检测到 `MicroMessenger` 时，首次指引与设置里说明并建议「在浏览器打开」后添加到桌面；备份改为「复制备份内容」（先同步 `execCommand`，再 Clipboard API，都不行就摆出来长按复制），所有浏览器都有「粘贴备份内容恢复」，走与选文件同一套校验、预览、恢复点。复制不算"下载了备份"，不更新上次备份日期。

### sw.js（离线缓存，v0.2.32）

只缓存本站运行文件，不碰健康数据、不向外发请求；只在 `https:` 注册（本地 http 预览加 `?sw=1` 才注册，否则改了 js 刷新会拿到缓存旧文件）。策略：页面联网优先，`SHELL_TIMEOUT`（4 秒）内没回来或连不上、5xx 就用缓存，网络那边到了再后台更新；带 `?ver=` 的 css/js 缓存优先（`deploy.sh` 每次部署盖新戳，同一 URL 内容不变），每拿到新页面按它实际引用的 URL 清掉旧版本；没带版本号的（`manifest.json`、`icon.svg`）先给缓存、后台取新。**安装时整套预缓存，取不到任何一个就整体失败——失败等于没有 sw.js，不会把站点弄坏**（`sw.test.js` 专门验）。

三条会咬人的约定：① `_headers` 里 `/sw.js` 的 `! Content-Security-Policy` 不能删——页面的 `connect-src 'none'` 套到 SW 上会拦掉它的全部 fetch；同名头多条规则是**逗号合并**（两条策略同时生效），所以只能摘、不能另加放宽的一条。② 新增运行文件若不是 `index.html` 里直接引用的（像 manifest 引用的 `icon.svg`），要加进 `EXTRA`，并且 `asset()` 只拦 `.js/.css/.svg/.json`，别的类型要一并加上。③ 部署后核对 `curl -sI <站点>/sw.js` 没有 `content-security-policy` 头、有 `cache-control: no-cache`。另：`registerOffline()` 顺带请求 `navigator.storage.persist()`（Safari 会清长期没打开的网站的 localStorage，持久化的不清；跳过会弹权限框的 Firefox）。

## 7. 测试

```bash
# 1) 数据层单元测试（快，每次改 storage.js 必跑）
node test/storage.test.js

# 1a) 可选密码加密备份（Web Crypto 往返、错误口令与篡改拒绝）
node test/encryption.test.js

# 1b) 跨模块契约检查（少算数、触控尺寸、CSP、动态属性转义）
node test/contracts.test.js

# 1c) 简笔画几何校验（快，每次改 figures.js 必跑）
node test/figures.test.js

# 1c-2) 朗读层（归一化规则 + 真的量出句间停顿 + 音色回落；改 speech.js 或朗读稿必跑）
node test/speech.test.js

# 1d) 真实 Chromium 浮层回归（关闭/普通下载/进入加密/完成加密后页面不得离开）
node test/overlay.test.js --stress
# 部署后可把生产地址作为参数，在隔离浏览器中跑同一套回归
node test/overlay.test.js https://stroke-rehab-assistant.pages.dev/

# 1e) 备份压力回归（40 轮浮层/历史 + 4.8MB 级备份加密恢复）
node test/overlay.test.js --stress
node test/backup-stress.test.js

# 1g) 设置项持久化（字号/语速：不按保存就关掉也必须留住，且回显与实际一致）
node test/settings.test.js

# 1h) 跨天/锁屏计时/多页面同步/屏幕常亮（页面内打桩时钟、可见性、Wake Lock、AudioContext）
node test/lifecycle.test.js

# 1i) 离线缓存（Node 静态服务器按真实 _headers 加头：断网、网络卡住、5xx、重新部署、重定向、安装失败即退化）
node test/sw.test.js

# 1j) 老手机与微信（主程序起不来时的兜底页、微信复制备份/粘贴恢复、无 Pointer Events 的图表）
node test/compat.test.js

# 1f) 简笔画目视检查（改 figures.js 后必看一眼图，断言替代不了眼睛）
node test/preview-figures.js            # 全部动作 → figures-preview.png（含 400/150/96px）
node test/preview-figures.js bobath     # 单个动作放大看
node test/preview-figures.js --review   # 给康复医生的复核单 → figures-review.pdf + figures-review.png

# 2) 冒烟测试：无头浏览器渲染 5 个页面 + file:// 直开 + 静态资源可达性
bash test/smoke.sh
#    依赖 Playwright 下载的 chrome-headless-shell（无需安装 playwright 包）
#    没有时：npx playwright install chromium
#    浏览器与网络请求均有硬超时；脚本会清理临时目录和自己启动的服务器。

# 3) 语法快查
for f in js/*.js; do node --check "$f"; done
```

手工回归清单：**唯一真源是 [`docs/MANUAL-TEST.md`](MANUAL-TEST.md)**（52 项，按真机执行顺序分三轮 + P2 选测，含时长预估、新版判据、安全注意与历次实测结果）。

> 这里**故意不再放第二份清单**。此前本节与 MANUAL-TEST.md 各自维护，已分叉到 41 条 vs 45 条——本节独有 7 项（`?view=` 直达、日历颜色变深、停用药报告小节、朗读不念 HTML 标签、一局游戏、导出可复制、**简笔画的医学确认**）在真机执行版里根本不存在，等于悄悄漏测。这 7 项已于 2026-09-19 合并进 MANUAL-TEST.md。要加测试项就加在那一份里。

自动化测不到、只能靠真人的四类（真机清单里已分别标注）：**安卓返回键**、**语音朗读的出声与听感**、**特大字号下的实际观感**、**简笔画姿势的医学正确性**（必须找康复医生/治疗师）。

## 8. 医学内容维护守则（重要）

1. **来源**：训练动作与文案参考《中国脑卒中康复治疗指南》《中国缺血性卒中和短暂性脑缺血发作二级预防指南》等公开指南的通行建议。修改医学内容需给出指南/权威来源依据，在 PR/提交说明里注明。
2. **不越界**：本应用是健康教育与自我管理工具。**永远不要**：给出个体化用药建议（只做"遵医嘱记录与核对"）、承诺疗效、弱化就医提示、删除免责声明和安全警示。
3. **数值有主**：文中出现的目标值（血压耐受时<130/80、LDL-C<1.8mmol/L、限盐5g、双抗21天等）均为指南一般性建议，展示时必须伴随"具体遵医嘱"措辞。指南更新时集中检查：`data-articles.js`（prevention/diet/followup/positioning/rehab-principle 五篇）、`js/app/records.js` 的 `bpBadge/gluBadge/bmiBadge` 阈值与提示文案、README。各数值的指南出处见 `docs/RESEARCH.md` §三（含 130/80 的例外分支、HbA1c 不做硬指标等注意事项，改文案前必读其 §八）。
4. **语言**：面向老人的口语化中文，避免术语堆砌；安全警示用"必须/立即/不要"等明确措辞。

## 9. 已知限制与后续路线

**优先级硬规则（2026-08-10 用户确认）**：先处理会影响患者能否正确、安全、持续完成康复的交互与信息准确性，再做有明确恢复收益的功能；备份、离线、平台迁移等便利性工作排在后面。医学内容必须先有权威依据和专业复核，不能用“功能更多”替代准确。

当前明确不做/做不了（对应 §2 的取舍）：

- 无云端同步、无多设备互通（换手机数据不跟随；缓解手段是导出功能）
- 无后台推送提醒（纯网页做不到可靠的定时提醒；页面内核对 + 建议用户设手机闹钟）
- 图表为最近 N 条的索引轴，不是严格时间轴
- 全部训练有文字分步和语音朗读，但仅 5 个动作有两帧示意图、无视频；示意姿势仍需康复医生/治疗师复核后才能继续铺开（复核状态见 `POSES[id].review`，复核单见 §6 figures.js）
- 不做摄像头动作识别/评分（MediaPipe 类方案与零依赖、隐私、CSP、摄像头禁用多条红线冲突，理由见 §6 figures.js 选型结论）
- ~~训练/用药/游戏历史无应用内视图~~ ——已补齐（v0.2.9，见 [CHANGELOG](CHANGELOG.md)）。~~**遗留取舍**：服药历史每天的"应服次数"按当前药物清单计算，改过处方后更早日期的分母会跟着变~~ ——**已解决**（v0.2.15：药物带 `from`/`to`，计数走 `Store.medsOn(date)`，停药/加药不再影响历史日期的分母）。**剩余取舍**：同一种药中途改剂量或改服药时间点没有版本记录，改完之后历史日期会按新的时间点显示
- ~~记录页历史列表位于输入表单下方、小屏易漏~~ ——已解决（v0.2.9：入口上移到"最近血压/血糖/体重"卡内，全部记录进弹窗）
- 训练日历固定看最近 4 周；训练历史弹窗一次渲染全部有记录的日期，长期使用（数百天）后需要分页或折叠
- **v0.2.12「少算数」的剩余缺口**：血压/血糖**录入**仍要求患者读血压计并输入数字（这是数据源头，无法回避；可考虑的缓解是"上次是 138/86，这次差不多吗"式的就近微调输入）；导出给医生的报告仍是精确数字与百分比（**这是刻意保留的**，医生需要原始数据）；训练日历格子里仍是当天项数的数字（颜色深浅已是主要通道，数字只作补充）。语音朗读已在 v0.2.13 完成；当前更重要的是用真机和真实患者验证可读性、朗读可用性及操作负担，并由专业人员复核训练示意和医学文案

建议的演进顺序（先看患者恢复价值与风险，再看开发成本；调研依据见 docs/RESEARCH.md §五/§六）：

1. **真机交互与医学准确性复核**：邀请患者/家属走完今日任务、训练引导、服药、记录和急救入口；重点观察读字、误触、返回键、语音、疲劳与抗拒。康复医生/治疗师逐项复核训练示意、阶段适用性和安全警示
2. **短期双抗疗程提醒**：仅针对医生已开立并登记了结束日期的短期疗程，在临近日期提示“请按医嘱复诊确认”，绝不自动建议停药或改单药；实施前再次核对指南适用人群与例外
3. **动作示意图专业复核后扩充**：画法体系已完成（v0.2.14），目前 5 个动作；几何测试只能保证画法自洽，不能替代治疗师确认患侧摆位、关节角度和阶段适用性。v0.2.31 补了临床角度护栏与复核单，下一步是拿复核单找医生，结论回填 `POSES[id].review`
4. **卒中后情绪筛查与就医指引**：PSD 常被忽视，但量表措辞、危机响应与转介路径必须先由专业人员审核；不能只做一个分数
5. **患者/家属双视图**：患者视图进一步减少干扰，家属视图保留趋势、原始数字和安全须知；先用真实家庭分工验证是否有价值
6. ~~**Service Worker 离线缓存**~~ ——已完成（v0.2.32，策略见 §6 sw.js；页面联网优先，医学内容更新后联网即生效）
7. **久坐提醒**：先按行动能力和跌倒风险设计适用条件，不能对所有卒中患者统一提示起身活动
8. **家属远程查看**：需要后端并扩大隐私与合规边界，只有真实家庭需求明确后再考虑
9. **微信小程序壳**：意味着第二套发布与审核链路，不在近期主线

已完成的基础能力：语音朗读（v0.2.13）、数据备份/恢复（v0.2.6）、恢复点与撤销（v0.2.20）、可选密码加密备份（v0.2.21）、离线缓存与持久化存储申请（v0.2.32）。

## 10. 变更记录

已移到 [CHANGELOG.md](CHANGELOG.md)（2026-10 拆出：它曾占本文一半篇幅，接手和日常开发不必通读，要查"某一版改了什么、为什么"时再看）。新条目加在那边表格最上面，写法见 [`AGENTS.md`](../AGENTS.md)「写文档的纪律」。
