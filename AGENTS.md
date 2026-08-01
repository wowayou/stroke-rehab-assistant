# AGENTS.md — 脑梗康复助手

> 本文件面向任何 AI 编码工具（Codex/Cursor/Claude Code 等均适用）。接手本项目先读 `docs/HANDOVER.md`（交接状态），再读 `docs/DEVELOPMENT.md`（架构与扩展方法）。本文只列硬约定。

## 项目一句话

面向脑梗恢复期患者/家属的纯静态家庭康复 Web 应用（零依赖、localStorage 本地存储、适老化设计）。

## 硬约定（违反会造成实际伤害）

1. **医学内容守则**：修改医学文案必须有指南/权威来源依据（出处对照见 `docs/RESEARCH.md`）；所有目标值必须带"遵医嘱"措辞；不得给出个体化用药建议；不得删除或弱化免责声明与安全警示。已知的坑：HbA1c 7% 不能做成硬性达标线；血压 130/80 目标有例外分支；中度亚急性期患者不推荐有氧训练（详见 RESEARCH.md §八）。
2. **零依赖红线**：不引入任何 npm 依赖、框架、构建步骤；必须保持 `file://` 双击可用（因此不用 ES Modules，脚本靠全局对象 + index.html 底部的固定加载顺序）。
3. **隐私红线**：不添加任何数据上传、埋点、第三方脚本。
4. **适老化不回退**：基准字号 18px、三档可调、触控目标 ≥48px、高对比度，只能加强不能削弱。
5. **内容与逻辑分离**：改训练动作只动 `js/data-exercises.js`，改文章只动 `js/data-articles.js`；动作 `id` 发布后不可改（打卡历史引用它）。
6. **数据只走 `Store`**（`js/storage.js`）；日期一律用 `Store.today()/addDays()` 的本地时区 `YYYY-MM-DD`，禁用 `toISOString()` 派生日期。
7. **转义纪律**：用户输入插入 HTML 前必须过 `app.js` 内的 `esc()`。
8. 用户未要求时不做 git 提交/推送（注意：上级目录的 `.git` 是空目录，非有效仓库）。

## 验证命令

```bash
node test/storage.test.js   # 数据层单测（改 storage.js 必跑；输出中的 JSON SyntaxError 告警是预期的兜底测试）
bash test/smoke.sh          # 无头浏览器冒烟测试，约 2~3 分钟
for f in js/*.js; do node --check "$f"; done
```

调试直达某页：`index.html?view=today|train|records|meds|learn`。

## 改完之后

1. 跑上面的测试；2. 更新 `docs/DEVELOPMENT.md` §10 变更记录；3. 与用户用中文交流。
