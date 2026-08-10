# CLAUDE.md — 脑梗康复助手

面向脑梗恢复期患者/家属的纯静态家庭康复 Web 应用。**新接手请先读 `docs/HANDOVER.md`**（交接状态与红线），再读 `docs/DEVELOPMENT.md`（架构、数据模型、扩展方法），本文件只列硬约定。

## 硬约定

- **零依赖红线**：不引入任何 npm 依赖、框架、构建步骤。必须保持 `file://` 双击可用（因此不用 ES Modules，脚本靠全局对象 + index.html 底部的加载顺序）。
- **内容与逻辑分离**：改训练动作只动 `js/data-exercises.js`，改文章只动 `js/data-articles.js`。动作的 `id` 发布后不可改（打卡历史引用它）。
- **数据只走 `Store`**（js/storage.js），不要在视图代码直接摸 localStorage。日期一律用 `Store.today()/addDays()` 的本地时区 `YYYY-MM-DD`，禁用 `toISOString()` 派生日期。
- **转义纪律**：用户输入插入 HTML 前必须过 `App` 内的 `esc()`；`data-*.js` 静态内容例外。
- **医学内容守则**（docs/DEVELOPMENT.md §8）：修改医学文案需注明指南依据；不得给个体化用药建议、不得删弱免责声明与安全警示；目标值必须带"遵医嘱"措辞。
- **适老化不回退**：基准字号 18px、三档可调、触控目标 ≥48px、高对比度。
- **少让患者算数**（v0.2.12，详见 DEVELOPMENT.md §6）：界面不出现要患者心算或理解比率的东西——用"还差 3 次"+ 圆点/进度条，不用 `2/5` 和百分比；差值、时长、趋势都由应用算好再说结论（复用 `leftText/dotsHTML/repTrackHTML/deltaLineHTML/chartSummaryHTML/plainDuration`）；结论在前、数字在后。给医生看的精确数字保留但降为次要并注明。
- **认同患者、不制造逆反**：不打分不排名、不按成绩分档给评语；连续中断先肯定过去再说"做一个动作就重新开始"；漏做/做不到按"很常见、不是您的问题"处理并给可执行办法，不用威慑指责。认知游戏必须留退路（换难度、看提示、跳过、换不用算的、中途收工仍打卡）。**注意**：这条只改措辞与呈现，医学事实、目标值与安全警示不得删弱。

## 常用命令

```bash
node test/storage.test.js        # 数据层单测（改 storage.js 必跑）
bash test/smoke.sh               # 无头浏览器冒烟测试（5 页渲染 + 资源可达）
for f in js/*.js; do node --check "$f"; done   # 语法快查
python3 -m http.server 8080      # 本地预览（也可直接双击 index.html）
```

调试直达某页：`index.html?view=today|train|records|meds|learn`。

## 改完代码之后

1. 跑上面的测试；
2. 更新 `docs/DEVELOPMENT.md` §10 变更记录；
3. 若改了脚本文件组成或全局名，同步更新 DEVELOPMENT.md §4。
