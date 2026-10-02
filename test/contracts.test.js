/* 静态硬约定回归：零依赖、可直接由 Node 运行。 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
/* 应用层是 js/app/ 下按固定顺序加载的一组文件（2026-10 由 app.js 拆出），按加载顺序拼起来当一份检查 */
const APP_FILES = ['core', 'overlay', 'today', 'train', 'records', 'meds', 'learn', 'settings', 'backup', 'boot'].map(n => `js/app/${n}.js`);
const app = APP_FILES.map(read).join('\n');
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
assert(!/min-height:\s*(?:4[0-7]|[0-3]?\d)px/.test(app), 'js/app/ 内联交互控件不得低于 48px');
assert(/Content-Security-Policy/.test(html) && /connect-src 'none'/.test(html), '页面必须保留禁止联网的 CSP');
assert(/Content-Security-Policy:/.test(headers) && /connect-src 'none'/.test(headers), 'Pages 响应头必须保留禁止联网的 CSP');
assert(/frame-ancestors 'none'/.test(headers) && /X-Frame-Options: DENY/.test(headers), 'Pages 响应头必须禁止第三方页面嵌入');
assert(/Strict-Transport-Security: max-age=31536000/.test(headers), 'Pages 响应头必须启用 HSTS');
assert(/X-Content-Type-Options: nosniff/.test(headers) && /Referrer-Policy: no-referrer/.test(headers), 'Pages 响应头必须限制内容嗅探与来源泄露');
assert(/Permissions-Policy:.*camera=\(\).*geolocation=\(\).*microphone=\(\)/.test(headers), 'Pages 响应头必须关闭未使用的敏感浏览器能力');
assert(/cp -r[^\n]*\b_headers\b/.test(deploy), '部署包必须包含 Cloudflare Pages 的 _headers 文件');
/* 兼容老手机（v0.2.33）：运行时脚本的语法与 API 不超过 ES2018（Chrome 62 / iOS 11.3 能用）。
   超了不是"某个功能不好用"，而是整个文件解析失败、老手机白屏。真解析器核对方法见 DEVELOPMENT §6「兼容性」。 */
const stripComments = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[ \t])\/\/[^\n]*/gm, '$1');
const RUNTIME_JS = ['js/data-exercises.js', 'js/data-articles.js', 'js/storage.js', 'js/charts.js', 'js/games.js', 'js/figures.js', 'js/speech.js', ...APP_FILES];
const TOO_NEW = [
  [/\?\.(?=[A-Za-z_$(\[])/, '可选链 ?.（Chrome 80 / iOS 13.4 才能解析）'],
  [/\?\?/, '空值合并 ??（Chrome 80 / iOS 13.4）'],
  [/(?:\|\||&&)=/, '逻辑赋值 ||= &&=（Chrome 85 / iOS 14）'],
  [/\bcatch\s*\{/, '省略 catch 参数（Chrome 66）'],
  [/\.(?:at|findLast|findLastIndex|toSorted|toReversed|replaceAll|matchAll|trimEnd|trimStart|flat|flatMap)\(/, '新的数组/字符串方法（老浏览器上调用即报错）'],
  [/\b(?:Object\.hasOwn|Object\.fromEntries|structuredClone|globalThis|queueMicrotask|Promise\.allSettled|Promise\.any)\b/, '新的全局 API'],
];
RUNTIME_JS.forEach(f => {
  const code = stripComments(read(f));
  TOO_NEW.forEach(([re, what]) => assert(!re.test(code), `${f} 用了${what}：老手机会白屏，换成老写法`));
});
/* 兜底页必须是 ES5，并且最后加载：它要在主程序解析失败的浏览器里也能跑 */
const bootCheck = stripComments(read('js/boot-check.js'));
assert(!/=>|`|\b(?:let|const)\s+[A-Za-z_$[{]|\bclass\s+[A-Za-z_$]|\.\.\./.test(bootCheck), 'js/boot-check.js 只能用 ES5（var/function/字符串拼接）');
assert(/<script src="js\/app\/boot\.js[^"]*"><\/script>\s*<script src="js\/boot-check\.js[^"]*"><\/script>\s*<\/body>/.test(html), 'boot-check.js 必须紧跟 js/app/boot.js 最后加载');
/* 拆分后的应用层：index.html 必须按约定顺序引用全部文件，否则加载时就会引用到还没定义的名字 */
assert([...html.matchAll(/<script src="js\/app\/([\w-]+)\.js/g)].map(m => `js/app/${m[1]}.js`).join() === APP_FILES.join(), 'index.html 必须按 core→…→boot 的顺序加载 js/app/ 全部文件');
/* 各文件共用一个全局作用域：顶层名字重复时，let/const 会让整页加载失败，function 则会悄悄覆盖前一个 */
{
  const seen = new Map();
  APP_FILES.forEach(f => read(f).split('\n').forEach(line => {
    const m = line.match(/^(?:async\s+)?function\s+([\w$]+)|^(?:const|let|var)\s+([\w$]+)/);
    if (!m) return;
    const name = m[1] || m[2];
    assert(!seen.has(name), `顶层名字 ${name} 在 ${seen.get(name)} 和 ${f} 里重复声明`);
    seen.set(name, f);
  }));
  assert(seen.size > 120, '应能从 js/app/ 读出全部顶层名字（读不到说明解析规则失效）');
}
assert(/href="tel:120"/.test(read('js/boot-check.js')), '打不开时的兜底页也必须能拨 120');
assert(!/(^|[;{\s])inset\s*:/m.test(css), 'CSS 不用 inset 简写定位（iOS 14.1 以前不认，浮层会盖不住屏幕）');
/* 微信里不能下载文件：备份必须换成复制，且有粘贴恢复入口 */
assert(/IN_WECHAT/.test(app) && /id="backup-copy"/.test(app) && /openPasteRestore/.test(app), '微信内置浏览器必须提供复制备份 + 粘贴恢复');

/* DEVELOPMENT.md §0「改什么去哪里」只是索引，但索引指错比没有更糟：里面点名的文件与函数必须真实存在 */
{
  const dev = read('docs/DEVELOPMENT.md');
  const sec0 = dev.slice(dev.indexOf('## 0.'), dev.indexOf('## 1.'));
  const allJs = [...APP_FILES, 'js/storage.js', 'js/speech.js', 'js/figures.js', 'js/games.js', 'js/charts.js', 'js/boot-check.js', 'sw.js'].map(read).join('\n');
  const tokens = [...sec0.matchAll(/`([^`]+)`/g)].map(m => m[1]);
  const isFile = t => /^(?:js\/(?:app\/)?|css\/|test\/)?[\w.-]+\.(?:js|css|sh|md)$|^_headers$/.test(t);
  tokens.filter(isFile).forEach(f => {
    assert(['', 'docs', 'js', 'js/app', 'test'].some(dir => fs.existsSync(path.join(root, dir, f))), `DEVELOPMENT §0 指向的文件不存在：${f}`);
  });
  /* 只查像代码名的：带 () 的函数、全大写常量、驼峰名；smoke 之类的普通词不查 */
  tokens.filter(t => !isFile(t) && /^[A-Za-z_$][\w$]{3,}(?:\(\))?$/.test(t) && /\(\)$|^[A-Z][A-Z0-9_]+$|[a-z][A-Z]/.test(t)).forEach(t => {
    const name = t.replace('()', '');
    assert(new RegExp(`\\b${name}\\b`).test(allJs), `DEVELOPMENT §0 提到的 ${t} 在代码里找不到（改名后要同步索引）`);
  });
}

/* 离线缓存（v0.2.32）：只缓存本站文件、不碰数据、只在线上注册；sw.js 必须摘掉页面那条禁止联网的 CSP，
   否则它的 fetch 全被拦（安装失败只是退化成没有离线缓存，但功能就白做了） */
const sw = read('sw.js');
/* 去注释再查：行注释只认"行首或空白后的 //"，否则会把 http:// 里的 // 当注释删掉，查外链就瞎了 */
const swCode = sw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[ \t])\/\/[^\n]*/gm, '$1');
assert(/cp -r[^\n]*\bsw\.js\b/.test(deploy), '部署包必须包含 sw.js');
/* 2026-09 线上曾从没提交的工作区部署，与仓库分叉 4 天，差点被正常部署覆盖、抹掉用户数据里的新字段 */
assert(/git status --porcelain/.test(deploy) && /ALLOW_DIRTY/.test(deploy) && /--commit-hash/.test(deploy), '部署脚本必须拒绝从未提交的工作区部署，并把提交号记到部署上');
assert(/^\/sw\.js\n\s+! Content-Security-Policy$/m.test(headers), '_headers 必须为 /sw.js 摘除页面 CSP（同名头多规则会合并成两条同时生效）');
assert(!/https?:\/\//.test(swCode), 'sw.js 不得请求任何外部地址');
assert(/url\.origin !== SCOPE\.origin/.test(sw) && /request\.method !== 'GET'/.test(sw), 'sw.js 只处理本站 GET 请求');
assert(!/localStorage|indexedDB/.test(swCode), 'sw.js 不得碰健康数据');
assert(/location\.protocol === 'https:'/.test(app) && /serviceWorker\.register\('sw\.js'\)/.test(app), '离线缓存只在 HTTPS 线上注册（本地 http 预览不注册，免得改了代码刷新拿旧文件）');
[
  [/data-med="\$\{esc\(/, /data-med="\$\{(?!esc\()/, 'med'],
  [/data-del="\$\{esc\(/, /data-del="\$\{(?!esc\()/, 'del'],
  [/data-day="\$\{esc\(/, /data-day="\$\{(?!esc\()/, 'day'],
  [/data-exday="\$\{esc\(/, /data-exday="\$\{(?!esc\()/, 'exday'],
  [/data-exid="\$\{esc\(/, /data-exid="\$\{(?!esc\()/, 'exid'],
  [/data-vital="\$\{esc\(/, /data-vital="\$\{(?!esc\()/, 'vital'],
].forEach(([good, bad, name]) => {
  assert(good.test(app), `data-${name} 动态值插入 HTML 前必须经 esc()`);
  assert(!bad.test(app), `data-${name} 不得出现未转义的动态插值`);
});
assert(/addEventListener\('visibilitychange'/.test(app) && /renderedDay/.test(app), '跨天重画必须监听 visibilitychange 并记录 renderedDay');
assert(!/按「当前药物清单」计算/.test(app), '服药历史不得再写“按当前药物清单计算”（已改为 trackFrom 口径）');
assert(!/confirm\('删除这条记录/.test(app) && !/confirm\(`确定删除「/.test(app), '高频删除不得用原生 confirm()（已改 confirmInPlace）');
/* P2#1：补记单独记 medLate，medLog 仍只存 true（旧版读新数据只会丢标记，核对本身不受影响）。 */
const storage = read('js/storage.js');
assert(!/=\s*'late'/.test(storage), 'medLog 不得存非 true 值（事后补记单独记 medLate）');
assert(/medLate: \{\}/.test(storage), 'defaults() 必须声明并行的 medLate 字段');
assert(/\['medLate', BACKUP_LIMITS\.medChecksPerDay/.test(storage), 'medLate 必须纳入 validateBackupLimits 限额');
assert(/'toast-action'/.test(app) && /has-action/.test(app), 'toast 撤销动作按钮按现有惯例登记（toast-action / has-action）');
assert((app.match(/whenOf\('/g) || []).length >= 3, '三个保存都要经 whenOf() 取记录时间');
assert(/e\.isComposing/.test(app), '回车处理必须避开中文输入法组字（isComposing）');
assert(/enterkeyhint/.test(app), '高频录入输入应带 enterkeyhint（手机键盘下一项/完成）');
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
