/* ============================================================
   简笔画目视检查工具（改 js/figures.js 后必跑一次并**真的看图**）

   运行：node test/preview-figures.js            → 生成 figures-preview.png（全部动作）
        node test/preview-figures.js bobath     → 生成 figures-preview.png（单个动作放大）

   为什么必须有这个：写 SVG 坐标是"盲画"，test/figures.test.js 只能保证几何自洽
   （肢段等长、不穿地、两帧差异够大），保证不了"看着像不像那个动作"。历史上只有
   放大看图才发现的问题：腿悬空在床面上方、跖屈的脚穿进床垫、上举时手和头挤成
   两个圆圈、脚画成线几乎看不见。所以：跑断言 + 看图，两步都要做。

   输出图里同时给 400 / 150 / 96 px 三种尺寸——小尺寸下两帧差异最容易糊掉。
   依赖 Playwright 下载的 chrome-headless-shell（与 smoke.sh 相同，无需装 playwright 包）。
   ============================================================ */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'figures-preview.png');
const PORT = 8788, CDP_PORT = 9340;
const ONLY = process.argv[2] || '';

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

(async () => {
  const shell = findShell();
  if (!shell) {
    console.error('❌ 找不到 chrome-headless-shell。先跑：npx playwright install chromium');
    process.exit(1);
  }
  const tmp = path.join(ROOT, '_preview-figures.html');
  fs.writeFileSync(tmp, HTML(ONLY));
  const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore', detached: true });
  const browser = spawn(shell, ['--headless=new', '--disable-gpu', '--no-sandbox',
    `--window-size=${ONLY ? 940 : 800},1200`, `--remote-debugging-port=${CDP_PORT}`, 'about:blank'],
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
    const mt = await cmd('Page.getLayoutMetrics');
    const h = Math.ceil(mt.result.cssContentSize.height);
    const w = Math.ceil(mt.result.cssContentSize.width);
    await cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false });
    await sleep(400);
    const shot = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
    console.log(`✅ 已生成 ${path.relative(ROOT, OUT)}（${w}×${h}）——请打开图片**用眼睛看一遍**，别只看断言通过。`);
  } catch (e) {
    console.error('❌ 生成失败：', e.message);
    process.exitCode = 1;
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) { /* 忽略 */ }
    try { process.kill(-server.pid); } catch (e) { /* 忽略 */ }
    try { process.kill(-browser.pid); } catch (e) { /* 忽略 */ }
  }
})();
