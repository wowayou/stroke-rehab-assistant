# AGENTS.md — 脑梗康复助手

> 本文件面向任何 AI 编码工具（Codex/Cursor/Claude Code 等均适用），是硬约定的**唯一真源**：`CLAUDE.md` 只是指向本文的指针，**不要在那边另写一份**。两份曾各自演进过一段时间，结果一边漏了隐私红线、另一边写着早已不存在的 `overlayPop()`——照着写就是错的。
> 接手本项目先读 `docs/HANDOVER.md`（交接状态），再读 `docs/DEVELOPMENT.md`（架构与扩展方法）。本文只列硬约定。

## 项目一句话

面向脑梗恢复期患者/家属的纯静态家庭康复 Web 应用（零依赖、localStorage 本地存储、适老化设计）。

## 硬约定（违反会造成实际伤害）

1. **医学内容守则**：修改医学文案必须有指南/权威来源依据（出处对照见 `docs/RESEARCH.md`）；所有目标值必须带"遵医嘱"措辞；不得给出个体化用药建议；不得删除或弱化免责声明与安全警示。已知的坑：HbA1c 7% 不能做成硬性达标线；血压 130/80 目标有例外分支；中度亚急性期患者不推荐有氧训练（详见 RESEARCH.md §八）。
2. **零依赖红线**：不引入任何 npm 依赖、框架、构建步骤；必须保持 `file://` 双击可用（因此不用 ES Modules，脚本靠全局对象 + index.html 底部的固定加载顺序）。
3. **隐私红线**：不添加任何数据上传、埋点、第三方脚本。要做同步类功能必须先与用户确认方案。
4. **适老化不回退**：基准字号 18px、三档可调、触控目标 ≥48px、高对比度，只能加强不能削弱。
5. **少让患者算数、不制造逆反心理**（v0.2.12，详见 docs/DEVELOPMENT.md §6）：卒中后计算障碍常见——界面不出现 `2/5`、百分比等要心算或理解比率的东西，改用"还差 3 次"+ 圆点/进度条，差值与时长由应用算好（复用 `leftText/dotsHTML/repTrackHTML/deltaLineHTML/chartSummaryHTML/plainDuration`），结论在前数字在后；不打分不排名、不按成绩给评语，漏做按"很常见、不是您的问题"+ 可执行办法处理，认知游戏必须留退路（换难度/看提示/跳过/换不用算的/中途收工仍打卡）。只改措辞与呈现，**医学事实与安全警示不得删弱**；给医生看的精确数字保留并注明。
6. **内容与逻辑分离**：改训练动作只动 `js/data-exercises.js`，改文章只动 `js/data-articles.js`；动作 `id` 发布后不可改（打卡历史引用它）。
7. **数据只走 `Store`**（`js/storage.js`），视图代码不要直接摸 localStorage；日期一律用 `Store.today()/addDays()` 的本地时区 `YYYY-MM-DD`，禁用 `toISOString()` 派生日期。
8. **服药计数只走 `Store.medsOn(date)`**：药有 `from`/`to`（停药只写 `to`、不删记录）。别再遍历 `Store.data.meds` 数总数，否则停用的药会天天算漏服、历史分母也会被今天的改动带偏。
9. **即时生效型设置必须即时落盘**（v0.2.25，加这类偏好时必须照做）：字号、语速、音色这种"点一下就看到/听到效果"的偏好，**不能挂在「保存设置」按钮上**——设置弹窗有 ✕ / 安卓返回键 / Esc / 点遮罩四种关法，只有一种会走保存按钮。两条规则：① 点一下立刻写 `Store`（走 `commitProfile()`）；② 选中态**只从 `Store` 派生**（`segGroupHTML()` + `bindSegGroup({current, commit})`），绝不用 DOM 上残留的 `.active` 反推真值。相关回归跑 `node test/settings.test.js`。
10. **加浮层必须接返回键**（v0.2.22）：开浮层时 `overlayPush()` 压一个历史条目；**主动关闭（✕ / Esc）只发起 `history.back()`**，DOM 统一由 `popstate` → `closeTopOverlayDOM()` 关闭（没有 `overlayPop()` 这个函数，别照着旧文档写）。连续弹窗用 `close.replace(openNext)` 原位复用条目。数据变更后的重渲染用 `render(view, { keepScroll: true })`，别把人弹回页首。相关回归跑 `node test/overlay.test.js --stress`。
11. **同类条目用分组列表，不要一条一张卡**（v0.2.26）：列表项是"一张卡内分行"（发丝线分隔），不是每项一张浮动卡片。按钮分三级：**实心蓝每屏只留一个主操作**（保存/打卡/拨 120），重复出现的行内动作用 `--primary-soft` 底 + `--primary-dark` 字，完成态用浅绿。分组标题用 `.section-label`/`.ex-group-label` 加粗成扫读锚点，不用小灰字。
12. **朗读稿与显示文案分离**（v0.2.27）：屏幕上的写法是给眼睛的（`10～15次`、`130/80 mmHg`、`10次×2组`），原样送进 TTS 就是"机器味"的主因。要改朗读效果**只动 `js/speech.js` 的 `SPEAK_RULES`，绝不改数据文件里的显示文案**。该表顺序敏感（含 `/` 的单位排在裸 `/` 之前；去 emoji 排在箭头之后）；吃前后空白只能用 `[ \t]`，**用 `\s` 会连换行一起吃掉、把两句粘成一句**；`speech.js` 内**禁用 lookbehind**（老 WebView 不支持，会让整个文件解析失败、朗读全哑）。相关回归跑 `node test/speech.test.js`。
13. **转义纪律**：用户输入插入 HTML 前必须过 `app.js` 内的 `esc()`（`data-*.js` 里的静态内容例外）。
14. 用户未要求时不做 git 提交/推送（注意：上级目录的 `.git` 是空目录，非有效仓库；本项目自己的仓库是有效的，远程见 HANDOVER §1.2）。

## 验证命令

```bash
# 必跑（改到对应模块就得跑）
node test/storage.test.js      # 数据层（改 storage.js 必跑；输出里的 JSON SyntaxError 告警是预期的兜底测试）
node test/contracts.test.js    # 跨模块静态硬约定（改 app.js/css/_headers 必跑，很快）
node test/speech.test.js       # 朗读层（改 speech.js 或朗读稿必跑）
node test/figures.test.js      # 简笔画几何（改 figures.js 必跑）

# 需要无头 Chromium（WSL 侧须用 nvm 的 node 24，系统 node18 没有全局 WebSocket）
node test/settings.test.js     # 即时生效偏好的落盘与回显
node test/overlay.test.js      # 浮层四路径不得离开页面（加 --stress 跑 40 轮）
node test/encryption.test.js   # 加密备份往返
node test/backup-stress.test.js # 大备份压力
bash test/smoke.sh             # 五页渲染 + file:// 直开 + 资源可达，约 2~3 分钟

# 目视与语法
node test/preview-figures.js   # 简笔画截图（改 figures.js 后必看一眼，断言替代不了眼睛）
for f in js/*.js; do node --check "$f"; done
python3 -m http.server 8080    # 本地预览（也可直接双击 index.html）
```

调试直达某页：`index.html?view=today|train|records|meds|learn`。

## 改完之后

1. 跑上面对应的测试；
2. 更新 `docs/DEVELOPMENT.md` §10 变更记录（**边做边写**，别攒到最后）；
3. 若改了脚本文件组成或全局名，同步更新 DEVELOPMENT.md §4；
4. 与用户用中文交流。

### 写文档的纪律（v0.2.28.1 立，专治已经发生过两次的两种病）

**病一：同一件事写在两处，然后分叉出真错误。** 已经犯过两次——`CLAUDE.md` 与 `AGENTS.md` 曾各自演进（一边漏隐私红线、一边写着不存在的 `overlayPop()`）；`DEVELOPMENT.md` §7 与 `docs/MANUAL-TEST.md` 是同一份手工清单的两个副本，已分叉成 41 条 vs 45 条。规矩：

- **每类信息只有一个真源**，别处只放一行指针。现有分工：硬约定→本文；接手状态与未验证项→`HANDOVER.md`；架构与扩展方法→`DEVELOPMENT.md`；真机执行清单→`MANUAL-TEST.md`（§7 只留指针，不再维护第二份勾选表）；医学出处→`RESEARCH.md`。
- 想在第二处复述时，改成写指针。**复述一次就是下一个分叉点。**

**病二：变更记录写成长篇叙事，淹掉真正的约定。** §10 曾占全文 60%（5.8 万字节），单条最长 5154 字节，而"下次该怎么做"反而找不到。规矩：

- **一条变更记录以 800 字节为上限**，只写四件事：改了什么、为什么（用户原话或触发场景）、跑了哪些验证、**未验证的是什么**。
- 过程叙事（试了几次、踩了什么坑、如何定位）**不进变更记录**。若那个坑会再咬人，把它写成 §6 对应模块的一条约定或一条测试断言——**测试能拦住的，就不要靠文档记性**。
- 详细复盘只在两种情况下值得留：① 踩坑教训无法用测试表达（写进 §6 该模块要点）；② 医学内容的依据（写进 `RESEARCH.md`）。

**审计文档引用别机械照报告改（v0.2.27.1 教训）。** 用脚本把文档里反引号包的函数名/文件名对照真实代码，是好办法，但报出的"幽灵引用"**必须人工复核语境**——三类会被误报：① 否定句（"没有 `overlayPop()` 这个函数，别照旧文档写"里的函数名本就是警告，不是引用）；② 通称占位符（`renderXxx()` 指代 `renderToday/renderTrain`）；③ 历史记录（变更记录里讲"移除了 `hasVoice()`"）。照报告直接改会把正确的文档改坏。更值钱的是换个问法：**"文档承诺的运行时行为现在还成立吗"**——这样才在同一轮里抓出 `SPEAK_RULES` 用 `\s` 违反自己约定的真 bug。

**自检**：写完问一句——这段话半年后有人会读，还是只是我在给自己留痕？只留前者。
