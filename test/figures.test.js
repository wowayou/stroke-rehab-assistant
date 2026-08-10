/* ============================================================
   figures.js 简笔画几何校验（Node 直接运行，无需浏览器）
   运行：node test/figures.test.js
   通过标准：输出「✅ figures.js 全部几何断言通过」，退出码 0

   为什么需要它：写 SVG 坐标是"盲画"，肉眼只能看出明显难看，看不出
   "第二帧里大腿悄悄变长了 3 个单位"这类错误。这里把解剖一致性变成断言：
   同一张图的两帧必须是**同一个人**——所有肢段长度逐一相等。
   ============================================================ */

const fs = require('fs');
const path = require('path');

const exSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'data-exercises.js'), 'utf8');
eval(exSrc + '; globalThis.EXERCISES = EXERCISES;');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'figures.js'), 'utf8');
eval(src + '; globalThis.FIG = FIG; globalThis.POSES = POSES; globalThis.FIGURES = FIGURES;');

let failed = 0;
function assert(cond, msg) {
  if (!cond) { failed++; console.error('FAIL:', msg); }
}

const S = FIG.SEG;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol;

/* 肢段定义：[关节A, 关节B, 期望长度名] */
const SEGMENTS = [
  ['sh', 'hip', 'torso'],
  ['sh', 'head', 'neck'],
  ['sh', 'el', 'upperArm'],
  ['el', 'wr', 'foreArm'],
  ['hip', 'kn', 'thigh'],
  ['kn', 'an', 'shin'],
  ['an', 'toe', 'foot'],
  ['sh', 'el2', 'upperArm'],
  ['el2', 'wr2', 'foreArm'],
  ['hip', 'kn2', 'thigh'],
  ['kn2', 'an2', 'shin'],
  ['an2', 'toe2', 'foot'],
];

const ids = Object.keys(POSES);
assert(ids.length >= 3, '至少应有 3 个动作的简笔画');

/* --- 0) 每个 key 必须对得上真实动作 id：拼错的话图会永远不显示且没人发现 --- */
ids.forEach(id => {
  const ex = EXERCISES.find(e => e.id === id);
  assert(!!ex, `简笔画 key "${id}" 在 EXERCISES 里找不到对应动作（拼错了图就永远不显示）`);
});

/* --- 1) 每一帧的肢段长度必须等于骨架定义（画法正确性） --- */
ids.forEach(id => {
  POSES[id].frames.forEach((p, fi) => {
    SEGMENTS.forEach(([a, b, key]) => {
      if (!p[a] || !p[b]) return;
      const d = dist(p[a], p[b]);
      assert(near(d, S[key]),
        `${id} 第${fi + 1}帧 ${a}→${b} 长度应为 ${S[key].toFixed(1)}（${key}），实际 ${d.toFixed(1)}`);
    });
  });
});

/* --- 2) 同一张图的两帧必须是同一个人：肢段长度逐一相等 --- */
ids.forEach(id => {
  const [A, B] = POSES[id].frames;
  SEGMENTS.forEach(([a, b, key]) => {
    if (!A[a] || !A[b] || !B[a] || !B[b]) return;
    const dA = dist(A[a], A[b]), dB = dist(B[a], B[b]);
    assert(near(dA, dB, 0.4),
      `${id} 两帧的 ${key} 不一致（${dA.toFixed(1)} vs ${dB.toFixed(1)}）——同一个人不该变形`);
  });
});

/* --- 3) 所有点必须落在局部帧内，且不穿到地面/床面以下 ---
   注意：有的图整帧放大了（如踝泵特写 scale=1.8），越界要按**放大后**的坐标判，
   地面高度也按该图自己的 groundY 判，否则校验的是错的空间。 */
const GROUND = 100;
ids.forEach(id => {
  const d = POSES[id];
  const s = d.scale || 1;
  const gy = d.groundY === undefined ? GROUND : d.groundY;
  d.frames.forEach((p, fi) => {
    Object.keys(p).forEach(k => {
      const j = p[k];
      if (!Array.isArray(j)) return;
      const fx = j[0] * s, fy = j[1] * s;
      assert(fx >= -2 && fx <= 106, `${id} 第${fi + 1}帧 ${k} 横向越界（放大后 x=${fx.toFixed(1)}）`);
      assert(fy >= 2 && fy <= 118, `${id} 第${fi + 1}帧 ${k} 纵向越界（放大后 y=${fy.toFixed(1)}）`);
      /* 脚趾可以贴地，其余关节不该明显穿地 */
      const limit = (k === 'toe' || k === 'toe2' || k === 'an' || k === 'an2') ? gy + 2 : gy;
      assert(j[1] <= limit, `${id} 第${fi + 1}帧 ${k} 穿到地面以下（y=${j[1].toFixed(1)} > ${limit}）`);
    });
  });
  /* 放大后的图，标签是在帧坐标里画的，不该被放大的画面压住 */
  if (s !== 1) {
    const maxY = Math.max(...d.frames.flatMap(p => Object.values(p)
      .filter(Array.isArray).map(j => j[1] * s)));
    assert(maxY <= 124, `${id} 放大后画面压到标签（最低 y=${maxY.toFixed(1)}，标签在 131）`);
  }
});

/* --- 4) 两帧必须"看得出区别"：至少一个关节移动超过 8 个单位 --- */
ids.forEach(id => {
  const [A, B] = POSES[id].frames;
  let maxMove = 0;
  Object.keys(A).forEach(k => {
    if (Array.isArray(A[k]) && Array.isArray(B[k])) maxMove = Math.max(maxMove, dist(A[k], B[k]));
  });
  assert(maxMove >= 8, `${id} 两帧差异过小（最大位移 ${maxMove.toFixed(1)}），小尺寸下会看不出动作`);
});

/* --- 5) 动作专属的医学要点 --- */

/* 踝泵：两帧的关键是"踝关节活动范围尽量大"，所以校验两个脚位之间的**夹角**，
   而不是简单的高低——同时要求跖屈时脚不能穿进床垫里（放大看才发现过的错误）。 */
{
  const [d, pl] = POSES['ankle-pump'].frames;
  const angOf = p => Math.atan2(p.toe[1] - p.an[1], p.toe[0] - p.an[0]) * 180 / Math.PI;
  const sweep = Math.abs(angOf(pl) - angOf(d));
  assert(sweep >= 60, `踝泵：勾脚与绷脚之间的夹角应 ≥60°（尽量大范围），实际 ${sweep.toFixed(0)}°`);
  assert(d.toe[1] < d.an[1] - 6, '踝泵背屈帧：脚尖应明显抬到踝关节上方（勾脚）');
  assert(pl.toe[1] > d.toe[1] + 8, '踝泵跖屈帧：脚尖应明显比勾脚时低（绷脚）');
  assert(dist(d.kn, pl.kn) < 0.1 && dist(d.an, pl.an) < 0.1, '踝泵两帧：膝与踝应固定不动，只有脚在转');
  /* 小腿应贴着床面放、不能悬空；脚尖也不能低于床面。
     踝泵是特写图、有自己的 groundY，必须用它而不是全局 GROUND。 */
  const apGround = POSES['ankle-pump'].groundY;
  POSES['ankle-pump'].frames.forEach((p, i) => {
    assert(apGround - p.an[1] <= 8, `踝泵第${i + 1}帧：腿应贴着床面放，不该悬空（踝到床面 ${(apGround - p.an[1]).toFixed(1)}）`);
    assert(p.toe[1] <= apGround, `踝泵第${i + 1}帧：脚尖不能穿到床面以下（y=${p.toe[1].toFixed(1)}，床面 ${apGround}）`);
  });
}

/* Bobath 握手：起始帧双手在腹部高度（低于肩），到位帧必须高过头顶 */
{
  const [down, up] = POSES.bobath.frames;
  assert(down.wr[1] > down.sh[1], 'Bobath 起始帧：双手应在肩以下（腹部前面）');
  assert(up.wr[1] < up.head[1] - FIG.SEG.headR,
    `Bobath 到位帧：双手必须举到头顶以上（腕 y=${up.wr[1].toFixed(1)}，头顶 y=${(up.head[1] - FIG.SEG.headR).toFixed(1)}）`);
  assert(Math.abs(down.wr[0] - down.wr2[0]) < 6 && Math.abs(down.wr[1] - down.wr2[1]) < 6,
    'Bobath 起始帧：两只手应握在一起（腕部位置接近）');
  assert(Math.abs(up.wr[0] - up.wr2[0]) < 6 && Math.abs(up.wr[1] - up.wr2[1]) < 6,
    'Bobath 到位帧：两只手应握在一起');
  /* 手不能和头挤在一起：严格侧面直上举时手与头会重叠成"两个圆圈"，
     必须让手臂从头前方经过（肩关节前屈），横向拉开足够距离。 */
  assert(Math.abs(up.wr[0] - up.head[0]) >= 8,
    `Bobath 到位帧：手应在头的前方拉开距离，否则看着像两个头（横向差 ${Math.abs(up.wr[0] - up.head[0]).toFixed(1)}，应 ≥8）`);
  assert(up.el[0] > up.sh[0], 'Bobath 到位帧：肘应在肩的前方（前屈上举，不是贴耳直上）');
  assert(down.kn[1] < down.an[1], 'Bobath：坐位时膝应高于踝（小腿向下）');
}

/* 桥式：抬臀帧髋必须明显抬高，肩与脚不动，且肩髋膝接近一条线 */
{
  const [flat, up] = POSES.bridge.frames;
  assert(dist(flat.sh, up.sh) < 0.1, '桥式：抬臀时肩应保持不动');
  assert(dist(flat.an, up.an) < 0.1, '桥式：抬臀时脚应钉在原地（不能跟着移动）');
  assert(up.hip[1] < flat.hip[1] - 8, `桥式：抬臀帧髋应明显高于贴床帧（${up.hip[1].toFixed(1)} vs ${flat.hip[1].toFixed(1)}）`);
  /* 肩髋膝共线程度：髋到"肩-膝连线"的距离应较小 */
  const [x1, y1] = up.sh, [x2, y2] = up.kn, [px, py] = up.hip;
  const devi = Math.abs((y2 - y1) * px - (x2 - x1) * py + x2 * y1 - y2 * x1) / Math.hypot(y2 - y1, x2 - x1);
  assert(devi < 5, `桥式抬臀帧：肩、髋、膝应大致成一条线（髋偏离连线 ${devi.toFixed(1)}，应 <5）`);
  assert(flat.hip[1] >= flat.sh[1] - 1, '桥式贴床帧：髋应与肩基本齐平（躺平）');
}

/* 坐到站：站立帧髋必须明显升高，且躯干竖直 */
{
  const [sit, stand] = POSES['sit-to-stand'].frames;
  assert(stand.hip[1] < sit.hip[1] - 15, '坐到站：站立帧髋应明显高于坐位帧');
  assert(Math.abs(stand.sh[0] - stand.hip[0]) < 4, '坐到站：站立帧躯干应基本竖直');
  assert(sit.sh[0] > sit.hip[0], '坐到站：坐位帧身体应前倾（肩在髋前方）');
  assert(stand.an[1] > stand.kn[1], '坐到站：站立帧踝应在膝下方');
}

/* 原地踏步：抬腿帧的抬起侧膝必须明显高于支撑侧膝，支撑腿不动 */
{
  const [stand, raise] = POSES.march.frames;
  assert(raise.kn2[1] < raise.kn[1] - 10, '踏步抬腿帧：抬起侧膝应明显高于支撑侧膝');
  assert(dist(stand.an, raise.an) < 0.1, '踏步：支撑腿应保持不动');
  assert(raise.an2[1] < GROUND - 5, '踏步抬腿帧：抬起侧的脚应离开地面');
  assert(stand.an2[1] > GROUND - 8, '踏步站立帧：两只脚都应在地面上');
}

/* --- 6) 渲染产物：每个动作都要有合法 SVG 与非空 alt --- */
ids.forEach(id => {
  const f = FIGURES[id];
  assert(f && f.svg && /^\s*<svg /.test(f.svg), `${id} 应渲染出 svg`);
  assert(/viewBox="0 0 240 140"/.test(f.svg), `${id} 画布尺寸应为 240×140`);
  assert(f.alt && f.alt.length >= 15, `${id} 的 alt 文字说明应能独立说清动作`);
  assert(/<\/svg>/.test(f.svg), `${id} 的 svg 应闭合`);
  assert(!/NaN|undefined/.test(f.svg), `${id} 的 svg 不应含 NaN/undefined`);
  /* 两帧都要画出来（只数帧级偏移，别把脚部的 rotate 变换也算进来；
     放大的图会带 scale(...)，所以不能要求 translate 后面立刻是引号） */
  assert(/<g transform="translate\(4,0\)[ "]/.test(f.svg), `${id} 应有左帧（translate(4,0)）`);
  assert(/<g transform="translate\(128,0\)[ "]/.test(f.svg), `${id} 应有右帧（translate(128,0)）`);
});

if (failed) {
  console.error(`❌ ${failed} 项几何断言失败`);
  process.exit(1);
}
console.log(`✅ figures.js 全部几何断言通过（${ids.length} 个动作 × 2 帧，含肢段等长、两帧同一人、不穿地、动作要点）`);
