# 开发与维护文档

> 面向后续开发者/维护者。读完本文你应该能：跑起来、测起来、知道每个文件干什么、知道怎么加一个训练动作/文章/游戏、知道哪些内容不能随便改。

## 1. 项目是什么

「脑梗康复助手」：面向**脑梗（缺血性脑卒中）恢复期患者及家属**的家庭康复辅助工具。核心场景是出院回家后的日常：每天练什么怎么练、按时吃药、测血压做记录、认识复发信号。

目标用户是老年患者和中年家属，使用环境不可控（老旧安卓机、微信内置浏览器、被儿女远程指导）。这决定了后面所有技术取舍。

## 2. 技术决策记录（为什么是现在这个样子）

| 决策 | 理由 | 推翻条件 |
|---|---|---|
| 纯静态 HTML/CSS/JS，零依赖、零构建 | 双击 `index.html` 就能用；任何静态托管都能部署；十年后依然能跑，不存在依赖腐烂 | 需要多端同步/远程查看时再上后端 |
| 普通 `<script>` 标签 + 全局对象，**不用 ES Modules** | ES Modules 在 `file://` 协议下被浏览器 CORS 策略阻止，会导致"双击打开白屏"。**因此脚本加载顺序重要**（见 §4） | 放弃 file:// 直开支持时 |
| 数据只存 localStorage，无账号无上传 | 健康数据敏感，本地存储零隐私风险、零合规负担；老人无需注册登录 | 用户明确需要多设备同步时（届时优先考虑导出/导入文件方案，其次才是服务端） |
| 手写 canvas 图表 / 手写小游戏 | 引入 chart.js 等会破坏"零依赖"，且需求只是简单折线 | 图表需求复杂化时 |
| innerHTML 模板字符串渲染 | 无构建约束下最直接的方案；配合转义纪律（见 §6 安全） | 交互复杂度显著上升时考虑迁移框架 |
| 适老化：18px 基准/三档字号/≥48px 触控 | 参考工信部适老化通用设计规范的思路 | 不要推翻 |

## 3. 目录结构

```
stroke-rehab-assistant/
├── index.html            # 应用外壳：顶栏、视图容器、底部导航、modal/toast 挂载点
├── manifest.json         # PWA manifest（支持"添加到主屏幕"）
├── icon.svg              # 应用图标
├── css/style.css         # 全部样式。顶部 :root 定义设计变量（颜色/圆角/导航高度）
├── js/
│   ├── data-exercises.js # 【内容】训练动作库 EXERCISES + 分类 EX_CATS + 阶段 STAGES + 每日推荐 DAILY_PLAN
│   ├── data-articles.js  # 【内容】科普文章 ARTICLES + 紧急识别 BEFAST
│   ├── storage.js        # 【逻辑】Store：localStorage 数据层，唯一的数据读写入口
│   ├── charts.js         # 【逻辑】Charts.line()：零依赖 canvas 折线图
│   ├── games.js          # 【逻辑】Games：4 个认知训练小游戏
│   └── app.js            # 【逻辑】App：视图渲染、训练引导器、弹窗、导航、初始化
├── test/
│   ├── storage.test.js   # 数据层单元测试（node 直接跑）
│   └── smoke.sh          # 无头浏览器冒烟测试（5 个页面渲染 + 资源可达）
├── docs/
│   ├── HANDOVER.md       # 交接文档：接手状态、已验证/未验证、环境备忘、红线（新接手先读）
│   ├── DEVELOPMENT.md    # 本文档
│   └── RESEARCH.md       # 产品调研结论（需求痛点、循证依据、竞品、设计规范）
├── CLAUDE.md             # 硬约定速查（Claude Code 自动读取）
├── AGENTS.md             # 硬约定速查（其他 AI 工具通用约定文件，内容与 CLAUDE.md 一致）
└── README.md             # 面向使用者的说明
```

**内容与逻辑分离**是本项目最重要的结构约定：改训练动作、改文章**只动 `data-*.js`**，不需要碰任何逻辑代码。

## 4. 脚本加载顺序（不能乱）

`index.html` 底部按此顺序加载，后者依赖前者定义的全局名：

```
data-exercises.js → data-articles.js → storage.js → charts.js → games.js → app.js
```

全局名清单：`EXERCISES` `EX_CATS` `STAGES` `DAILY_PLAN` `ARTICLES` `BEFAST` `Store` `Charts` `Games` `App`。新增文件时在 app.js 之前插入，并在此处记录。

## 5. 数据模型（localStorage）

单一 key：`strokeRehab.v1`（版本号在 key 名里；不兼容的 schema 变更时新建 `strokeRehab.v2` 并写迁移代码，见下）。完整 schema：

```js
{
  profile: {
    name: '',            // 称呼，显示在问候语里
    strokeDate: '',      // 发病日期 YYYY-MM-DD，用于计算"康复第N天"（发病日=第1天）
    stage: 'sitting',    // 康复阶段 bed|sitting|standing|walking，决定推荐训练
    font: 'normal',      // 字号 normal|large|xlarge
    height: '',          // cm，选填，用于 BMI
  },
  meds: [                // 药物清单
    { id, name, dose, times: ['08:00','20:00'], note }
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
}
```

约定：

- **所有读写必须走 `Store` 的方法**，不要在视图代码里直接摸 `localStorage`。
- `Store.load()` 对损坏 JSON 有兜底（回落空默认值），对缺字段有 `Object.assign` 补默认。
- 日期一律 `YYYY-MM-DD` 本地时区字符串（`Store.today()` / `Store.addDays()`），不要用 `Date.toISOString()`（会有 UTC 偏移导致的跨天 bug）。
- 未来做 schema 迁移：在 `load()` 里检测旧 key 存在且新 key 不存在 → 转换 → 写新 key（保留旧 key 一段时间以便回滚）。

## 6. 各模块要点

### app.js（主逻辑，约 900 行）

- **视图注册表** `RENDERERS = { today, train, records, meds, learn }`，`App.go(view)` 切换。支持 URL 参数 `?view=xxx` 直达（冒烟测试和深度链接依赖此特性）。
- **渲染模式**：每个 `renderXxx()` 整段重建 `#view` 的 innerHTML，然后绑定事件。数据变更后调 `render(currentView)` 重渲染。没有虚拟 DOM，没有局部更新——数据量小，整页重渲染足够快，别过早优化。
- **训练引导器 `openTrainer(ex)`**：全屏覆盖层，按 `ex.mode.type` 三种形态：
  - `reps`：大圆按钮计次，达标震动+提示音；
  - `timer`：倒计时（开始/暂停/重置），归零提示；
  - `game`：挂载认知游戏，游戏内"完成打卡"回调 `finish()`。
  - 完成 → `Store.logExercise(id)`（同日去重）→ toast → 关闭 → 重渲染。
  - **关闭时必须清理**：`closeTrainer()` 负责 `clearInterval` + `Games.stop()`，新增异步资源要在这里一并清理。
- **安全/转义纪律**：所有**用户输入**（姓名、药名、剂量、备注等）插入 HTML 前必须过 `esc()`。`data-*.js` 里的静态内容是我们自己写的，直接插入；**如果未来文章/动作内容改为用户可编辑或远程下发，必须改为全量转义或消毒**。
- 提示反馈：`toast(msg)`（2.2s 自动消失）、`beep()`（WebAudio 提示音+震动，失败静默）。

### storage.js

纯数据层，无 DOM 依赖（因此可以在 Node 里测试）。公开 API 见文件头部注释和 `return` 清单。改这里必须同步跑 `node test/storage.test.js`。

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

`Games.start(key, container, onDone)`；`onDone(score, detailText)` 由游戏的"完成打卡"按钮触发。**新增游戏**：写 `function mygame(container, onDone)`，结束时调 `showResult()`，注册进 `registry`，再到 data-exercises.js 加一条 `mode: {type:'game', game:'mygame'}` 的动作。游戏内的 `setInterval` 必须存入模块级 `timerId`（`Games.stop()` 靠它清理）。

## 7. 测试

```bash
# 1) 数据层单元测试（快，每次改 storage.js 必跑）
node test/storage.test.js

# 2) 冒烟测试：无头浏览器渲染 5 个页面 + 静态资源可达性
bash test/smoke.sh
#    依赖 Playwright 下载的 chrome-headless-shell（无需安装 playwright 包）
#    没有时：npx playwright install chromium

# 3) 语法快查
for f in js/*.js; do node --check "$f"; done
```

手工回归清单（发版前过一遍，重点是老人机场景）：

- [ ] 双击 index.html（file://）打开不白屏
- [ ] 五个底部标签都能切换；`?view=train` 等直达参数有效
- [ ] 完成一次计次训练、一次计时训练、一局游戏，今日页进度和连续天数正确
- [ ] 添加药物（含自定义时间）→ 今日核对打勾 → 刷新页面数据还在
- [ ] 记录一条血压 → 徽章分级正确 → 两条以上出趋势图 → 导出可复制
- [ ] 设置改字号立即生效、保存后刷新仍生效
- [ ] 急救弹窗 `tel:120` 在手机上能唤起拨号
- [ ] 手机小屏（360px 宽）无横向滚动、按钮可点
- [ ] 首次打开弹出使用指引，点"我知道了"后不再自动出现；设置→查看使用指引可重看
- [ ] 设置→备份全部数据能下载 JSON 文件；改动几笔数据后→从备份恢复→预览条数正确→确认后数据回到备份时的状态

## 8. 医学内容维护守则（重要）

1. **来源**：训练动作与文案参考《中国脑卒中康复治疗指南》《中国缺血性卒中和短暂性脑缺血发作二级预防指南》等公开指南的通行建议。修改医学内容需给出指南/权威来源依据，在 PR/提交说明里注明。
2. **不越界**：本应用是健康教育与自我管理工具。**永远不要**：给出个体化用药建议（只做"遵医嘱记录与核对"）、承诺疗效、弱化就医提示、删除免责声明和安全警示。
3. **数值有主**：文中出现的目标值（血压耐受时<130/80、LDL-C<1.8mmol/L、限盐5g、双抗21天等）均为指南一般性建议，展示时必须伴随"具体遵医嘱"措辞。指南更新时集中检查：`data-articles.js`（prevention/diet/followup/positioning/rehab-principle 五篇）、`app.js` 的 `bpBadge/gluBadge/bmiBadge` 阈值与提示文案、README。各数值的指南出处见 `docs/RESEARCH.md` §三（含 130/80 的例外分支、HbA1c 不做硬指标等注意事项，改文案前必读其 §八）。
4. **语言**：面向老人的口语化中文，避免术语堆砌；安全警示用"必须/立即/不要"等明确措辞。

## 9. 已知限制与后续路线

当前明确不做/做不了（对应 §2 的取舍）：

- 无云端同步、无多设备互通（换手机数据不跟随；缓解手段是导出功能）
- 无后台推送提醒（纯网页做不到可靠的定时提醒；页面内核对 + 建议用户设手机闹钟）
- 图表为最近 N 条的索引轴，不是严格时间轴
- 训练示范是文字分步，无图片/视频/语音

建议的演进顺序（按价值/成本比，调研依据见 docs/RESEARCH.md §五/§六）：

1. **Service Worker 离线缓存**：真 PWA，弱网/无网可用（注意缓存版本管理，避免更新不生效的经典坑）
2. **语音朗读（Web Speech API）**：训练要领读出来，失语/视力差患者受益大（调研：文字+图片+语音三通道冗余）
3. **数据导入**：与导出配对（JSON 文件导出/导入），解决换机迁移
4. **卒中后抑郁自评（PHQ-9 类量表）**：PSD 发生率 31% 且长期被忽视，量表+就医指引是明确空白
5. **双抗到期提醒**：登记双抗起始日，21 天时提示"请医生确认是否改单药"——高价值低风险
6. **久坐提醒**：每 30 分钟起身活动 3 分钟，有 RCT 依据（BUST-Stroke）
7. **动作示意图**：为每个动作补简笔示意 SVG
8. **患者/家属双视图**：患者视图极简大字，家属视图看数据趋势与安全须知
9. **家属远程查看**：需要后端，是跨越"零依赖"红线的大决策，先确认真实需求
10. **微信小程序壳**：触达最容易，但意味着第二套代码，谨慎

## 10. 变更记录

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-08-02 | v0.2.7 | 文档：Cloudflare 部署账号归属已由用户确认为本人；§7 手工回归清单补「首次指引」「备份/恢复」两项。无代码改动 |
| 2026-08-02 | v0.2.6 | 导出/持久化做扎实（用户要求）：① 新增**全量备份导出**（设置页"备份全部数据"，下载带 app 标识/schema 版本/导出时间的 JSON 文件）；② 新增**恢复导入**（"从备份恢复"：选文件→校验文件身份→预览恢复将包含的药物/血压/血糖/体重/打卡条数→确认覆盖后整体恢复）；③ **字段级类型守卫**：非本应用备份一律拒绝、畸形内容按字段回落默认，防止误选任意文件清空数据；④ storage.test.js 新增备份往返/3 种畸形拒绝/部分字段合并用例，全部通过。换机迁移问题（路线图第 6 项）就此落地；⑤ HANDOVER §1.2/§6 同步（备份/恢复已完成、路线图状态更新）。 |
| 2026-08-02 | v0.2.5 | ① 新增**首次使用指引**：首次打开自动弹窗引导（测血压→服药→训练→记录/急救），"我知道了"后持久化（`Store.ui.guideSeen`），设置页新增"查看使用指引"可随时重看；指引文案只复述既有已审核内容，未引入新医学论断。② **医学内容复核**（用户最高优先项"不给错误消息"）：逐条核对 RESEARCH §八 全部易错点确认已落实；抓出 7 处遗留问题（0 高危/1 中/6 低）**全部修正**——含钾代盐禁忌补全"普利/沙坦类降压药或保钾利尿剂"（高钾血症风险，中危）；"复发和死亡风险≈1/3"按调研原文改为"再次中风风险≈1/3"（两处，CNSR-II 复发 HR0.37/死亡 HR0.20 分开表述）；双抗"约3周"补"多见于轻型/小卒中"限定（CHANCE/POINT 证据）；限盐 5g 补"遵医嘱"措辞（落实 §8.3 守则）；低血糖警示线改 `<=3.9`（ADA 警戒线 ≤3.9）；血压 ok 档提示语补"目标遵医嘱"避免"已达标"误读；血糖图增加餐后 10.0 参考线与图注（消除餐后值误读）。③ HANDOVER 记录部署账号归属（demoqqxu@gmail.com，待用户确认本人账号）。 |
| 2026-08-01 | v0.2.4 | 部署：仓库转公开；Cloudflare Pages 项目 stroke-rehab-assistant 上线（https://stroke-rehab-assistant.pages.dev/），直传 10 个静态文件；新增 deploy.sh 一键部署脚本；线上验证（内容一致性 + 五页冒烟）全过。无应用代码改动 |
| 2026-08-01 | v0.2.3 | 启用版本管理（经用户确认）：项目内 `git init`（main 分支），首次提交 3bf06fb 为 v0.2.2 全量状态，推送至私有仓库 github.com/wowayou/stroke-rehab-assistant；HANDOVER §1.2/§4/§6 相应条目同步更新。无代码改动 |
| 2026-08-01 | v0.2.2 | 接手核验后文档纠错：README 科普篇数 8→9（v0.2 新增《良肢位摆放》后未同步）；HANDOVER 动作数"31 个分期动作"→"28 个训练动作"（实际 28 动作 + 4 游戏共 32 项，其中 14 个带分期）；HANDOVER §3 补记"上级空 .git 会让 AI 会话环境快照误报 git 仓库"。无代码改动，单测/冒烟/语法检查在本次核验中全部通过 |
| 2026-08-01 | v0.2.1 | 移交准备：新增 docs/HANDOVER.md（交接状态/环境备忘/红线）与 AGENTS.md（工具无关的硬约定，供非 Claude 的 AI 工具读取）；README/CLAUDE.md 增加指引。无代码改动 |
| 2026-08-01 | v0.2 | 按调研报告（docs/RESEARCH.md）修订医学内容：血压目标改为"耐受时<130/80"主线+例外分支表述；HbA1c 改为个体化参考值+低血糖警示；新增依从性数据（复发风险≈1/3）与双抗21天提醒；运动量对齐指南表述+有氧运动评估门槛；新增含钾代盐、久坐提醒、六字速记；新增《良肢位摆放》文章；强化 Bobath 握手肩保护警示 |
| 2026-08-01 | v0.1 | 初版：五页框架、30+ 训练动作、4 个认知游戏、血压/血糖/体重记录与图表、用药核对与依从率、8 篇科普、BE-FAST 急救、适老化三档字号、单元测试与冒烟测试脚本 |
