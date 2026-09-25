/* 静态硬约定回归：零依赖、可直接由 Node 运行。 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('js/app.js');
const games = read('js/games.js');
const exercises = read('js/data-exercises.js');
const css = read('css/style.css');
const html = read('index.html');
const headers = read('_headers');
const deploy = read('deploy.sh');

let failed = 0;
function assert(cond, msg) {
  if (!cond) { failed++; console.error('FAIL:', msg); }
}

assert(!games.includes('/${TOTAL}'), '患者界面/历史不应重新出现 N/总数 的比分');
assert(!exercises.includes('答对越多越好'), '认知训练文案不应按答对数量施压');
assert(/\.btn\.small\s*\{[^}]*min-height:\s*48px/s.test(css), '小按钮触控高度必须至少 48px');
assert(!/min-height:\s*(?:4[0-7]|[0-3]?\d)px/.test(app), 'app.js 内联交互控件不得低于 48px');
assert(/Content-Security-Policy/.test(html) && /connect-src 'none'/.test(html), '页面必须保留禁止联网的 CSP');
assert(/Content-Security-Policy:/.test(headers) && /connect-src 'none'/.test(headers), 'Pages 响应头必须保留禁止联网的 CSP');
assert(/frame-ancestors 'none'/.test(headers) && /X-Frame-Options: DENY/.test(headers), 'Pages 响应头必须禁止第三方页面嵌入');
assert(/Strict-Transport-Security: max-age=31536000/.test(headers), 'Pages 响应头必须启用 HSTS');
assert(/X-Content-Type-Options: nosniff/.test(headers) && /Referrer-Policy: no-referrer/.test(headers), 'Pages 响应头必须限制内容嗅探与来源泄露');
assert(/Permissions-Policy:.*camera=\(\).*geolocation=\(\).*microphone=\(\)/.test(headers), 'Pages 响应头必须关闭未使用的敏感浏览器能力');
assert(/cp -r[^\n]*\b_headers\b/.test(deploy), '部署包必须包含 Cloudflare Pages 的 _headers 文件');
assert(/data-med="\$\{esc\(m\.id\)\}"/.test(app), '药物动态 id 插入 HTML 前必须转义');
assert(/data-del="\$\{esc\(v\.id\)\}"/.test(app), '健康记录动态 id 插入 HTML 前必须转义');
assert(/备份里有健康隐私/.test(app) && /内容是可以直接阅读的/.test(app), '下载明文备份前必须说明敏感健康信息风险');
assert(/set-backup'\)\.onclick = openBackupWarning/.test(app), '备份按钮必须先显示隐私提醒，并保留父级设置');
assert(!/unwindDebt/.test(app) && /close\.replace\(openEncryptedBackup\)/.test(app), '连续备份弹窗不得用异步 history.back 后立即 pushState');
assert(/id="set-undo-restore"/.test(app) && /Store\.undoLastRestore\(\)/.test(app), '设置页必须提供一次性的恢复撤销入口');
assert(!/恢复会[^\n]*无法撤销/.test(app) && /可在设置中撤销一次/.test(app), '恢复确认必须说明可撤销一次');
assert(/file\.size > Store\.backupLimits\.maxEncryptedBytes/.test(app), '备份文件大小限制必须与 Store 使用同一配置');
assert(/id="backup-plain"/.test(app) && /id="backup-encrypted"/.test(app), '普通备份应保持主操作，加密备份只作为可选操作');
assert(/密码只用于这份备份，不会保存或上传/.test(app) && /忘记密码后本应用无法恢复/.test(app) && /过于简单的密码仍可能被猜中/.test(app), '加密备份必须准确说明密码不保存、遗忘及弱密码风险');
assert(/Store\.exportEncryptedBackup\(password\.value\)/.test(app) && /Store\.parseEncryptedBackup\(jsonText, input\.value\)/.test(app), '加密导出与恢复必须走 Store 的 Web Crypto 接口');
assert(/name: 'AES-GCM'/.test(read('js/storage.js')) && /kdf: 'PBKDF2'/.test(read('js/storage.js')), '加密备份必须使用 AES-GCM 与 PBKDF2');
assert(!/localStorage\.setItem\([^\n]*(?:password|passphrase)/i.test(read('js/storage.js') + app), '备份密码不得写入 localStorage');

/* 即时生效型设置（字号/语速）：选中态只能从 Store 派生，且点一下就落盘。
   设置弹窗有 ✕/返回键/Esc/点遮罩四种关法，只有一种走「保存设置」——
   若把它们挂在保存按钮上，已生效的字号会丢，重开时回显旧档（v0.2.25 修的 bug）。 */
assert(/current: \(\) => Store\.data\.profile\.font/.test(app), '字号选中态必须从 Store 读取，不得依赖 DOM 上的 .active');
assert(/current: \(\) => Store\.data\.profile\.speechRate/.test(app), '语速选中态必须从 Store 读取，不得依赖 DOM 上的 .active');
assert(!/\[data-font\]\.active/.test(app) && !/\[data-rate\]\.active/.test(app),
  '不得再按 DOM 的 .active 反推设置值（那是"显示与实际不一致"的根源）');
assert(/#set-save'\)\.onclick[\s\S]{0,900}?字号与语速不在这里读/.test(app), '「保存设置」不得重新赋值字号/语速，否则会覆盖已即时生效的偏好');
assert(/role="radiogroup"/.test(app) && /role="radio"/.test(app) && /aria-checked=/.test(app), '分段单选控件必须是可被读屏识别的 radiogroup');
/* commit() 抛异常时选中态也必须重刷：不刷的话高亮停在旧值、Store 已是新值，
   又变成"显示与真相两个来源"——正是 v0.2.25 修掉的那类 bug。 */
assert(/try\s*\{\s*commit\(c\.dataset\.segKey\);\s*\}\s*finally\s*\{\s*paint\(\);\s*\}/.test(app),
  '分段控件的 commit 失败也必须重刷选中态（paint 放 finally）');

/* 朗读层（v0.2.27）：生硬的主因是喂给引擎的文本，归一化必须在 Speech 内部统一做。 */
const speech = read('js/speech.js');
assert(/normalize\(text\)/.test(speech) && /splitSentences\(normalize\(text\)\)/.test(speech),
  'speak() 必须自己归一化，不能让每个调用方各自处理（漏一处就是一处生硬）');
assert(/GAP_SENTENCE/.test(speech) && /gapAfter\(/.test(speech),
  '句间必须留换气停顿，不能 onend 立刻念下一句（机关枪式朗读）');
assert(/gapTimer[\s\S]{0,200}?myGen !== gen/.test(speech),
  '句间停顿的定时器必须认代号，否则停止后到点仍会接着念旧内容');
/* 老 WebView 不支持 lookbehind：用了会让整个文件解析失败、朗读功能全哑 */
assert(!/\(\?<[=!]/.test(speech), 'speech.js 不得使用 lookbehind（老 WebView 会整文件解析失败）');
/* 显示文案是给眼睛的，不能为了朗读去改数据文件 */
assert(/[～]/.test(exercises) && /[×]/.test(exercises),
  '动作库里的 ～ 与 × 是给眼睛看的，朗读问题只能在 speech.js 里解，不许改数据文件');
/* 文章朗读稿必须按块级标签断句，且只在叶子块取文本（否则外层容器重复念一遍） */
assert(/SPEECH_BLOCK/.test(app) && /!node\.querySelector\(SPEECH_BLOCK\)/.test(app),
  '文章朗读稿必须按块级标签断句，并只在叶子块上取文本');
assert(!/div\.textContent \|\| ''\)\.replace\(\/\\s\+\/g, ' '\)\.trim\(\);\s*\n\s*return `\$\{a\.title\}/.test(app),
  'articleSpeechText 不得退回 textContent 直取（会把小标题和正文粘成破句）');
/* 音色是自由字符串，不能白名单（各机音色名不同）；整体换 data 的地方都要重新套用 */
assert(/out\.profile\.speechVoice = text\(p\.speechVoice/.test(read('js/storage.js')),
  '音色名只能限长不能白名单——每台机器装的音色不一样，枚举不出来');
assert(/function applyVoice/.test(app) && (app.match(/applyVoice\(/g) || []).length >= 5,
  '凡是整体换掉 data 的地方（启动/恢复/撤销/清空）都要 applyVoice()，同 applyFont');

/* 设计系统的语义配色必须在真实前景/背景组合中可读。 */
const colors = Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[\da-f]{6});/gi)].map(m => [m[1], m[2]]));
const luminance = hex => {
  const channels = hex.slice(1).match(/../g).map(c => parseInt(c, 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};
for (const [front, back] of [
  ['text', 'bg'], ['text-2', 'bg'], ['text-2', 'card'],
  ['text-2', 'surface-subtle'], ['text-2', 'surface-hover'],
  ['primary-dark', 'primary-soft'], ['primary', 'primary-soft'],
  ['green', 'green-soft'], ['orange', 'orange-soft'], ['red', 'red-soft'],
  ['card', 'primary'], ['card', 'green'], ['card', 'red'],
]) {
  const a = luminance(colors[front]), b = luminance(colors[back]);
  assert((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5, `${front}/${back} 文字对比度至少 4.5:1`);
}
assert(html.includes(`name="theme-color" content="${colors.primary}"`) && JSON.parse(read('manifest.json')).theme_color === colors.primary,
  '浏览器与主屏幕主题色必须与应用主色一致');

if (failed) {
  console.error(`❌ ${failed} 项静态硬约定失败`);
  process.exit(1);
}
console.log('✅ 静态安全/适老化硬约定全部通过');
