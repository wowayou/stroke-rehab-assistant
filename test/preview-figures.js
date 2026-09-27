/* ============================================================
   简笔画目视检查工具（改 js/figures.js 后必跑一次并**真的看图**）

   运行：node test/preview-figures.js            → 生成 figures-preview.png（全部动作）
        node test/preview-figures.js bobath     → 生成 figures-preview.png（单个动作放大）
        node test/preview-figures.js --review   → 生成给康复医生/治疗师的复核单：
             figures-review.pdf（A4 打印）+ figures-review.png（长图，便于微信发送）

   为什么必须有这个：写 SVG 坐标是"盲画"，test/figures.test.js 只能保证几何自洽
   （肢段等长、不穿地、两帧差异够大），保证不了"看着像不像那个动作"。历史上只有
   放大看图才发现的问题：腿悬空在床面上方、跖屈的脚穿进床垫、上举时手和头挤成
   两个圆圈、脚画成线几乎看不见。所以：跑断言 + 看图，两步都要做。

   输出图里同时给 400 / 150 / 96 px 三种尺寸——小尺寸下两帧差异最容易糊掉。

   复核单（v0.2.31）：每个动作一页——大图、图下说明、动作要领与注意（应用内原文）、
   由姿势现算的关键角度表（test/figure-angles.js）、POSES[id].review.questions 里的
   待确认问题与勾选/签名栏。只含标准示意内容，不含任何患者数据。
   医生的结论回填到 js/figures.js 的 POSES[id].review。

   依赖 Playwright 下载的 chrome-headless-shell（与 smoke.sh 相同，无需装 playwright 包）。
   ============================================================ */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const ARGS = process.argv.slice(2);
const REVIEW = ARGS.includes('--review');
const ONLY = ARGS.find(a => !a.startsWith('--')) || '';
const OUT = path.join(ROOT, REVIEW ? 'figures-review.png' : 'figures-preview.png');
const PDF_OUT = path.join(ROOT, 'figures-review.pdf');
const PORT = 8788, CDP_PORT = 9340;

function findShell() {
  const base = path.join(process.env.HOME, '.cache/ms-playwright');
  if (!fs.existsSync(base)) return null;
  const dirs = fs.readdirSync(base).filter(d => d.startsWith('chromium_headless_shell')).sort();
  if (!dirs.length) return null;
  const p = path.join(base, dirs[dirs.length - 1], 'chrome-headless-shell-linux64/chrome-headless-shell');
  return fs.existsSync(p) ? p : null;
}
const get = url => new Promise((res, rej) => {
  http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

const HTML = only => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>
  body { font-family:"Noto Sans CJK SC","Microsoft YaHei",sans-serif; background:#F6F3EC; margin:0; padding:14px; width:${only ? 920 : 760}px; }
  h1 { font-size:19px; margin:0 0 10px; }
  .item { background:#fff; border-radius:16px; padding:12px; margin-bottom:12px; box-shadow:0 2px 8px rgba(40,40,60,.08); }
  .nm { font-weight:700; font-size:16px; }
  .goal { font-size:12.5px; color:#5A6070; }
  svg { width:100%; height:auto; color:#1F55B5; display:block; }
  .fig-focus { color:#935000; }  /* 与 css/style.css 的 --orange 一致 */
  .cap { font-size:12.5px; color:#5A6070; line-height:1.55; margin-top:5px; }
  .row { display:flex; gap:10px; align-items:flex-start; margin-top:6px; }
  .box { border:1px dashed #C9C2B4; border-radius:10px; padding:5px; }
  .lbl { font-size:10.5px; color:#8A8578; text-align:center; }
</style></head><body>
<h1>动作示意简笔画 — 目视检查（左=起始，右=到位）</h1><div id="out"></div>
<script src="js/data-exercises.js"></script>
<script src="js/figures.js"></script>
<script>
  var ONLY = ${JSON.stringify(only)};
  var out = document.getElementById('out');
  var ids = ONLY ? [ONLY] : Object.keys(FIGURES);
  ids.forEach(function (id) {
    var f = FIGURES[id];
    if (!f) { out.insertAdjacentHTML('beforeend', '<div class="item">找不到动作：' + id + '</div>'); return; }
    var ex = EXERCISES.find(function (e) { return e.id === id; }) || { name: id, goal: '' };
    var sizes = ONLY ? [[880, '放大 880px']] : [[400, '400px'], [150, '小屏 150px'], [96, '96px']];
    var boxes = sizes.map(function (s) {
      return '<div class="box" style="width:' + s[0] + 'px">' + f.svg + '<div class="lbl">' + s[1] + '</div></div>';
    }).join('');
    out.insertAdjacentHTML('beforeend',
      '<div class="item"><div class="nm">' + ex.name + '</div><div class="goal">' + (ex.goal || '') + '</div>'
      + '<div class="row">' + boxes + '</div><div class="cap">图下说明：' + f.alt + '</div></div>');
  });
</script></body></html>`;

/* 复核单：内容在 Node 端拼好（角度要由姿势现算），页面本身不跑脚本。
   打印走 @media print（A4 分页），长图走屏幕样式。 */
function reviewHTML(only) {
  const src = ['data-exercises.js', 'figures.js']
    .map(f => fs.readFileSync(path.join(ROOT, 'js', f), 'utf8')).join('\n');
  const { EXERCISES, STAGES, POSES, FIGURES } =
    new Function(`${src}\nreturn { EXERCISES, STAGES, POSES, FIGURES };`)();
  const { jointAngles, LABELS, NORMAL } = require('./figure-angles');

  const ids = only ? [only] : Object.keys(POSES);
  ids.forEach(id => { if (!POSES[id]) throw new Error(`找不到动作：${id}`); });

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const STATUS = { pending: '未复核', approved: '已确认', changes: '复核后待修改' };
  const ORDER = ['trunk', 'shoulder', 'elbow', 'shoulder2', 'elbow2', 'hip', 'knee', 'ankle', 'hip2', 'knee2', 'ankle2'];
  /* 负角度换成医生习惯的说法（后伸/过伸/跖屈），不让人去读正负号 */
  const fmt = (k, v) => {
    const base = k.replace(/2$/, ''), r = Math.round(v);
    if (base === 'ankle') return r >= 0 ? `背屈约 ${r}°` : `跖屈约 ${-r}°`;
    if (r < 0) return `${{ trunk: '后仰', shoulder: '后伸', elbow: '过伸', hip: '后伸', knee: '过伸' }[base]}约 ${-r}°`;
    return `约 ${r}°`;
  };
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const exOf = id => EXERCISES.find(e => e.id === id) || { name: id, steps: [], dose: '' };
  const stageOf = ex => (ex.stage && (STAGES.find(s => s.key === ex.stage) || {}).name) || '—';

  const sections = ids.map((id, i) => {
    const P = POSES[id], ex = exOf(id), r = P.review || { status: 'pending', questions: [] };
    const angles = P.frames.map(jointAngles);
    /* 躯干前倾只对站/坐的图有意义；仰卧的图躯干是横的，不列 */
    const upright = angles.some(a => a.trunk !== undefined && Math.abs(a.trunk) <= 60);
    const rows = ORDER
      .filter(k => angles.some(a => a[k] !== undefined) && (k !== 'trunk' || upright))
      .map(k => {
        const base = k.replace(/2$/, '');
        const name = (k.endsWith('2') ? '远侧（图中较淡）· ' : '') + LABELS[base];
        const cells = angles.map(a => (a[k] === undefined ? '—' : fmt(k, a[k])));
        return `<tr><td>${esc(name)}</td><td>${cells[0]}</td><td>${cells[1]}</td><td>${esc(NORMAL[base])}</td></tr>`;
      }).join('');
    const qs = (r.questions || []).map(q =>
      `<li>${esc(q)}<div class="tick">□ 合适　　□ 需修改：<span class="line"></span></div></li>`).join('');
    return `
<section class="page">
  <h2>${i + 1}. ${esc(ex.name)}</h2>
  <div class="meta">阶段：${esc(stageOf(ex))}　｜　建议量：${esc(ex.dose || '—')}　｜　当前状态：${esc(STATUS[r.status] || r.status)}</div>
  <div class="fig">${FIGURES[id].svg}<div class="lr"><span>左图：${esc(P.labels[0])}</span><span>右图：${esc(P.labels[1])}</span></div></div>
  <p class="cap">图下说明（应用内原文）：${esc(P.alt)}</p>
  <h3>动作要领（应用内原文）</h3>
  <ol>${(ex.steps || []).map(s => `<li>${esc(s)}</li>`).join('')}</ol>
  ${ex.caution ? `<p class="caution">注意：${esc(ex.caution)}</p>` : ''}
  <h3>图中关键角度（由简笔画算出的近似值，不是测量值）</h3>
  <table><tr><th>角度</th><th>左图</th><th>右图</th><th>常用正常范围</th></tr>${rows}</table>
  <h3>请您判断</h3>
  <ol class="q">${qs}</ol>
  <div class="sign">这张图总体：□ 可以使用　　□ 需修改（请写在空白处）<br>
    复核人身份（如康复科医师 / 治疗师）：<span class="line"></span>　日期：<span class="line short"></span></div>
</section>`;
  });

  const statusRows = ids.map(id => {
    const ex = exOf(id), r = POSES[id].review || { status: 'pending' };
    return `<tr><td>${esc(ex.name)}</td><td>${esc(stageOf(ex))}</td><td>${esc(STATUS[r.status] || r.status)}</td></tr>`;
  }).join('');

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>动作示意图复核单</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family:"Noto Sans CJK SC","Microsoft YaHei",sans-serif; color:#1C2230; font-size:10.5pt; line-height:1.55; margin:0; }
  h1 { font-size:18pt; margin:0 0 4px; }
  h2 { font-size:14pt; margin:0 0 2px; }
  h3 { font-size:11pt; margin:10px 0 3px; }
  p, ol { margin:3px 0; }
  ol { padding-left:1.6em; }
  .meta { color:#4A5060; font-size:9.5pt; }
  .fig { margin:6px auto 2px; width:125mm; }
  .fig svg { width:100%; height:auto; color:#1F55B5; display:block; }
  .fig .fig-focus { color:#935000; }
  .lr { display:flex; justify-content:space-around; font-size:9pt; color:#4A5060; }
  .cap { font-size:9.5pt; color:#4A5060; }
  .caution { background:#FFF4E5; border-left:3px solid #D97706; padding:3px 8px; }
  table { border-collapse:collapse; width:100%; font-size:9.5pt; }
  th, td { border:1px solid #C9C2B4; padding:2px 6px; text-align:left; vertical-align:top; }
  th { background:#F1EEE7; }
  .q li { margin-bottom:5px; }
  .tick { color:#333; margin-top:2px; }
  .line { display:inline-block; min-width:62mm; border-bottom:1px solid #555; height:1em; vertical-align:bottom; }
  .line.short { min-width:30mm; }
  .sign { margin-top:10px; border-top:1px dashed #999; padding-top:6px; }
  .note { color:#4A5060; font-size:9.5pt; }
  .page { break-after:page; }
  .page:last-child { break-after:auto; }
  table, .sign, .q li { break-inside:avoid; }
  @media screen {
    body { width:760px; padding:14px; background:#F6F3EC; }
    .page { background:#fff; border-radius:14px; padding:16px 20px; margin-bottom:14px; }
    .fig { width:520px; }
    .line { min-width:220px; } .line.short { min-width:110px; }
  }
</style></head><body>
<section class="page">
  <h1>脑梗康复助手 · 动作示意图复核单</h1>
  <div class="meta">生成日期 ${today}　｜　共 ${ids.length} 张图</div>
  <h3>这是什么</h3>
  <p>一个给脑梗恢复期患者和家属用的家庭康复网页工具，数据只存在患者自己的手机里、不上传。训练页里有 ${ids.length} 个动作配了两帧简笔示意图（左＝起始姿势，右＝动作到位），患者会照着图做。</p>
  <h3>想请您看什么</h3>
  <p>每张图的姿势是否正确，尤其是<b>患侧摆位、关节角度、是否适合它所归的康复阶段</b>。每张图后面列了几个我们拿不准、需要专业判断的问题，请逐条勾选或写下意见。</p>
  <h3>角度是怎么来的</h3>
  <p>由简笔画的几何直接算出，是"火柴人近似角"：躯干只画了一根线，"躯干-大腿角"里含腰椎前屈，不等于真实的髋关节角度。仅供对照图意，不是测量值。</p>
  <h3>怎么反馈</h3>
  <p>在空白处写下意见后拍照发回即可，也可以直接告诉患者家属。</p>
  <h3>本次复核的图</h3>
  <table><tr><th>动作</th><th>阶段</th><th>当前状态</th></tr>${statusRows}</table>
  <p class="note">本文件只包含标准示意内容，不包含任何患者数据。</p>
</section>
${sections.join('\n')}
</body></html>`;
}

(async () => {
  const shell = findShell();
  if (!shell) {
    console.error('❌ 找不到 chrome-headless-shell。先跑：npx playwright install chromium');
    process.exit(1);
  }
  const tmp = path.join(ROOT, '_preview-figures.html');
  try {
    fs.writeFileSync(tmp, REVIEW ? reviewHTML(ONLY) : HTML(ONLY));
  } catch (e) {
    console.error('❌ 生成页面失败：', e.message);
    process.exit(1);
  }
  const width = !REVIEW && ONLY ? 940 : 800;
  const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore', detached: true });
  const browser = spawn(shell, ['--headless=new', '--disable-gpu', '--no-sandbox',
    `--window-size=${width},1200`, `--remote-debugging-port=${CDP_PORT}`, 'about:blank'],
    { stdio: 'ignore', detached: true });
  await sleep(2500);
  try {
    const t = (await get(`http://127.0.0.1:${CDP_PORT}/json/list`)).find(x => x.type === 'page');
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pend = new Map();
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
    const cmd = (m, p = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });

    await cmd('Page.enable');
    await cmd('Page.navigate', { url: `http://localhost:${PORT}/_preview-figures.html` });
    await sleep(1800);
    if (REVIEW) {
      /* 先按打印样式出 A4 PDF（改视口之前做，免得屏幕尺寸影响分页） */
      const pdf = await cmd('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
      if (!pdf.result) throw new Error(`printToPDF 失败：${JSON.stringify(pdf.error)}`);
      fs.writeFileSync(PDF_OUT, Buffer.from(pdf.result.data, 'base64'));
    }
    const mt = await cmd('Page.getLayoutMetrics');
    const h = Math.ceil(mt.result.cssContentSize.height);
    const w = Math.ceil(mt.result.cssContentSize.width);
    await cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false });
    await sleep(400);
    const shot = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
    if (REVIEW) {
      console.log(`✅ 已生成 ${path.relative(ROOT, PDF_OUT)}（A4 打印）与 ${path.relative(ROOT, OUT)}（长图 ${w}×${h}，便于微信发送）`
        + '——发出去之前请自己打开**完整看一遍**。');
    } else {
      console.log(`✅ 已生成 ${path.relative(ROOT, OUT)}（${w}×${h}）——请打开图片**用眼睛看一遍**，别只看断言通过。`);
    }
  } catch (e) {
    console.error('❌ 生成失败：', e.message);
    process.exitCode = 1;
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) { /* 忽略 */ }
    try { process.kill(-server.pid); } catch (e) { /* 忽略 */ }
    try { process.kill(-browser.pid); } catch (e) { /* 忽略 */ }
  }
})();
