/* ============================================================
   动作示意简笔画（内联 SVG，零依赖、零外部图片）

   —— 画法不是"手填坐标"，而是**按人体比例定义骨架、用几何算关节位置**。
      比例依据：成人约 7.5 头身、肩宽≈2 头（通用人体比例，见 docs/RESEARCH.md §十）。
      好处是每个姿势的肢段长度**由构造保证一致**（同一个人不会在第二帧里
      大腿变长），而这一点可以用脚本自动校验，不靠肉眼。

   数据结构：POSES[id] = { alt, view, frames:[poseA, poseB], props, labels }
      pose = { head, sh, el, wr, hip, kn, an, toe }（缺省的关节不画）
   FIGURES[id] = { alt, svg }  由 POSES 在加载时渲染而成，app.js 只用 FIGURES。

   坐标系：局部帧 0..104 × 0..118，y 向下；地面/床面 y=100。
      左帧画在 translate(4,0)，右帧 translate(128,0)，画布 240×140。

   ⚠️ 属于**医学示意内容**：姿势要点来自 data-exercises.js 里已按指南核对过的
      steps/caution 文本（来源见 docs/RESEARCH.md）。新增/修改仍需康复医生复核，
      尤其患侧摆位与关节角度。宁可不画，也不要画错。
   ============================================================ */

const FIG = (() => {
  /* 头高 12 → 全身 7.5 头 = 90；其余肢段按常用比例折算 */
  const H = 12;
  const SEG = {
    headR: H / 2,          // 头半径 6
    neck: H * 0.83,        // 肩→头心 10
    torso: H * 2.17,       // 肩→髋 26
    upperArm: H * 1.42,    // 肩→肘 17
    foreArm: H * 1.17,     // 肘→腕 14
    thigh: H * 1.92,       // 髋→膝 23
    shin: H * 1.75,        // 膝→踝 21
    foot: H * 0.92,        // 踝→趾 11
  };

  const rad = d => (d * Math.PI) / 180;
  /* 从 from 出发，朝 deg 方向（0=右，90=下，-90=上）走 len，得到关节点 */
  const at = (from, deg, len) => [
    from[0] + len * Math.cos(rad(deg)),
    from[1] + len * Math.sin(rad(deg)),
  ];
  /* 两连杆逆解：已知根点 a、末端 c 与两段长度，求中间关节（膝/肘）。
     dir=+1/-1 决定往哪边弯。用它可以"钉住脚的位置"再算膝，
     这样抬臀时脚不会跟着跑——手填坐标最容易在这里出错。 */
  function joint(a, c, l1, l2, dir) {
    const dx = c[0] - a[0], dy = c[1] - a[1];
    const d = Math.hypot(dx, dy) || 0.001;
    const dd = Math.min(d, l1 + l2 - 0.001);
    const t = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd);
    const h = Math.sqrt(Math.max(0, l1 * l1 - t * t));
    const ux = dx / d, uy = dy / d;
    return [a[0] + t * ux - dir * h * uy, a[1] + t * uy + dir * h * ux];
  }

  const n = v => Math.round(v * 10) / 10;

  /* ---------- 手绘感（Notion 那种简笔风）----------
     三件事：① 线细（这套图在手机上约 290px 宽，2 左右才像"笔画"，
     3.6 会糊成香肠）；② 直线改成带一点弓的曲线；③ 不画关节实心点——
     手绘线的转折本身就交代了关节，加点会变成"关节炎"。
     抖动用**固定种子**的伪随机：同一张图每次渲染完全一样，
     否则快照/回归测试没法比对。 */
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }
  /* 把折线画成手绘感路径：每段用二次贝塞尔，控制点朝法线方向偏一点点 */
  function sketch(pts, seed = 7, amp = 0.9) {
    const r = rng(seed);
    let d = `M${n(pts[0][0])},${n(pts[0][1])}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      const dx = x1 - x0, dy = y1 - y0;
      const len = Math.hypot(dx, dy) || 1;
      /* 法线方向偏移量：随机但有界，长段偏多一点、短段几乎不偏 */
      const k = (r() - 0.5) * 2 * amp * Math.min(1, len / 18);
      const mx = (x0 + x1) / 2 - (dy / len) * k;
      const my = (y0 + y1) / 2 + (dx / len) * k;
      d += ` Q${n(mx)},${n(my)} ${n(x1)},${n(y1)}`;
    }
    return `<path d="${d}"/>`;
  }
  /* 手绘圆：四段贝塞尔，半径逐段微抖，起笔处**故意不完全闭合**（留一点缺口） */
  function circle(cx, cy, rad, seed = 11) {
    const r = rng(seed);
    const jitter = () => rad * (1 + (r() - 0.5) * 0.10);
    const k = 0.5523;
    const r1 = jitter(), r2 = jitter(), r3 = jitter(), r4 = jitter();
    const gap = 0.14 + r() * 0.06;   // 缺口弧度
    const sx = cx + Math.cos(gap) * r1, sy = cy + Math.sin(gap) * r1;
    return `<path d="M${n(sx)},${n(sy)}`
      + ` C${n(cx + r1)},${n(cy + r1 * k)} ${n(cx + r2 * k)},${n(cy + r2)} ${n(cx)},${n(cy + r2)}`
      + ` C${n(cx - r2 * k)},${n(cy + r2)} ${n(cx - r3)},${n(cy + r3 * k)} ${n(cx - r3)},${n(cy)}`
      + ` C${n(cx - r3)},${n(cy - r3 * k)} ${n(cx - r4 * k)},${n(cy - r4)} ${n(cx)},${n(cy - r4)}`
      + ` C${n(cx + r4 * k)},${n(cy - r4)} ${n(cx + r1)},${n(cy - r1 * k)} ${n(cx + r1)},${n(cy)}"/>`;
  }

  /* 脚画成楔形（鞋子侧影）而不是一根线：跖屈（绷脚）时脚与小腿几乎共线，
     线条会看着像"腿变长了"，楔形在任何角度都还认得出是一只脚。
     用 rotate 变换摆放，避免手算三角函数出错。 */
  function foot(an, toe, opt = {}) {
    const deg = (Math.atan2(toe[1] - an[1], toe[0] - an[0]) * 180) / Math.PI;
    const L = SEG.foot;
    /* 描边的鞋形轮廓，不填实色——填实在细线风格里会变成一块很重的墨点 */
    const d = `M-2,-1.8 L${n(L * 0.6)},-2.4 L${n(L)},0.6 L${n(L)},2.4 L-2,3.4 Z`;
    const style = opt.ghost
      ? `stroke-dasharray="3.5 2.5" opacity="0.45"`
      : (opt.opacity ? ` opacity="${opt.opacity}"` : '');
    return `<g transform="translate(${n(an[0])},${n(an[1])}) rotate(${n(deg)})"><path d="${d}" ${style}/></g>`;
  }

  /* 把一个姿势画成 SVG：躯干/四肢手绘折线，头手绘圆，不画关节点 */
  function figure(p, opt = {}) {
    const out = [];
    let seed = 3;
    const push = (pts) => { if (pts.length && pts.every(Boolean)) out.push(sketch(pts, seed += 17)); };

    if (p.sh && p.hip) push([p.sh, p.hip]);
    /* 颈部画到头的**圆周**为止，不要连到圆心——否则圆里会多出一根竖线，
       整个人看着像"棒棒糖插了根杆"。 */
    if (p.sh && p.head) {
      const dx = p.head[0] - p.sh[0], dy = p.head[1] - p.sh[1];
      const len = Math.hypot(dx, dy) || 1;
      const k = Math.max(0, (len - SEG.headR) / len);
      push([p.sh, [p.sh[0] + dx * k, p.sh[1] + dy * k]]);
    }
    push([p.sh, p.el, p.wr].filter(Boolean).length === 3 ? [p.sh, p.el, p.wr] : []);
    push([p.hip, p.kn, p.an].filter(Boolean).length === 3 ? [p.hip, p.kn, p.an] : []);
    if (p.kn && p.an && !p.hip) push([p.kn, p.an]);
    /* 脚用楔形（见 foot()）：脚的角度往往正是这张图要教的东西 */
    const feet = [];
    if (p.an && p.toe) feet.push(foot(p.an, p.toe));
    if (p.an2 && p.toe2) feet.push(foot(p.an2, p.toe2, { opacity: 0.68 }));
    /* 远侧手臂/腿：细一点、淡一点，表示"另一侧"（但不能太淡，否则
       抬腿这类"动作发生在远侧"的图会看不清） */
    const far = [];
    if (p.sh && p.el2 && p.wr2) far.push(sketch([p.sh, p.el2, p.wr2], 91));
    if (p.hip && p.kn2 && p.an2) far.push(sketch([p.hip, p.kn2, p.an2], 113));

    return `
    <g fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
      ${out.join('\n      ')}
    </g>${feet.length ? `
    <g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
      ${feet.join('\n      ')}
    </g>` : ''}${far.length ? `
    <g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity="${opt.farOpacity || 0.55}">
      ${far.join('\n      ')}
    </g>` : ''}${p.head ? `
    <g fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round">
      ${circle(p.head[0], p.head[1], SEG.headR, 29)}
    </g>` : ''}`;
  }

  return { SEG, at, joint, figure, foot, sketch, circle, n };
})();

/* ---------- 姿势定义 ----------
   全部用 FIG.at / FIG.joint 由骨架算出，肢段长度由构造保证一致。
   钉住脚的位置再用 joint() 反解膝盖，是"抬臀时脚不能跟着跑"的关键。 */
const POSES = (() => {
  const { SEG: S, at, joint } = FIG;
  const GROUND = 100;
  /* 床/地面/椅子也用手绘线，且比人体更细更淡——它们是背景，不该抢戏 */
  const prop = (pts, seed, op = 0.5) =>
    `<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity="${op}">`
    + FIG.sketch(pts, seed, 0.6) + '</g>';
  const ground = prop([[4, GROUND], [100, GROUND]], 41);
  const bed = prop([[4, GROUND], [100, GROUND]], 53);
  const chair = prop([[26, 44], [26, 80], [62, 80]], 67);

  /* —— 踝泵：仰卧、整条腿平放在床上，靠脚的角度对比表达勾脚/绷脚。
        画整条腿（髋→膝→踝）而不是只画小腿，否则画面大半是空的、
        小尺寸下更认不出这是一条腿。 —— */
  /* 这张图要教的只有"脚的角度"，画整条腿的话腿很小、脚更小，细线风格下几乎看不见。
     所以改成**小腿+脚的特写**，整帧放大 1.8 倍（见 POSES.scale）。
     床面也定义在同一套放大前坐标里，否则会和腿对不上。
     跖屈时脚尖只能与小腿大致成一线，再往下就"穿进床垫里"了。 */
  const AP_SCALE = 1.8;
  const AP_GROUND = 46;
  const apKn = [8, 40];
  const apAn = at(apKn, 0, S.shin);
  const DORSI = -72, PLANTAR = 6;    // 背屈（脚尖朝身体）/ 跖屈（脚尖伸直，像踩油门）
  const anklePump = dir => ({ kn: apKn, an: apAn, toe: at(apAn, dir, S.foot) });
  const apBed = prop([[2, AP_GROUND], [56, AP_GROUND]], 53);
  /* 曾试过在脚旁画"另一端位置"的虚线残影，放大看是一团碎虚线（干扰大于帮助）：
     两帧本来就并排、中间有箭头，对比已经足够，故不画。 */

  /* —— Bobath 握手：坐位，双手交叉从腹前缓慢举过头顶 —— */
  const bHip = [52, 78];
  const bSh = at(bHip, -90, S.torso);
  const bLeg = {
    hip: bHip, kn: at(bHip, -4, S.thigh),
  };
  bLeg.an = at(bLeg.kn, 86, S.shin);
  bLeg.toe = at(bLeg.an, 6, S.foot);
  const bobathPose = (elDeg, wrDeg, elDeg2, wrDeg2) => {
    const el = at(bSh, elDeg, S.upperArm);
    const el2 = at(bSh, elDeg2, S.upperArm);
    return {
      head: at(bSh, -90, S.neck), sh: bSh, ...bLeg,
      el, wr: at(el, wrDeg, S.foreArm),
      el2, wr2: at(el2, wrDeg2, S.foreArm),
    };
  };

  /* —— 桥式：肩不动、抬髋，脚钉在原地用 joint() 反解膝 —— */
  const brSh = [32, 90];
  const brAnkle = [86, 92];
  const bridgePose = hipDeg => {
    const hip = at(brSh, hipDeg, S.torso);
    const kn = joint(hip, brAnkle, S.thigh, S.shin, -1);
    return {
      head: at(brSh, 180, S.neck), sh: brSh, hip, kn,
      an: brAnkle, toe: at(brAnkle, 33, S.foot),
    };
  };

  /* —— 坐到站：从坐位前倾到站直 —— */
  const sitStand = (hip, torsoDeg, thighDeg, shinDeg, armDeg, foreDeg) => {
    const sh = at(hip, torsoDeg, S.torso);
    const kn = at(hip, thighDeg, S.thigh);
    const an = at(kn, shinDeg, S.shin);
    const el = at(sh, armDeg, S.upperArm);
    return {
      head: at(sh, torsoDeg, S.neck), sh, hip, kn, an,
      toe: at(an, 6, S.foot), el, wr: at(el, foreDeg, S.foreArm),
    };
  };

  /* —— 原地踏步：支撑腿站直，另一腿屈髋屈膝抬起 —— */
  const marchPose = raise => {
    const an = [50, 97];
    const kn = at(an, -88, S.shin);
    const hip = at(kn, -86, S.thigh);
    const sh = at(hip, -90, S.torso);
    const el = at(sh, 84, S.upperArm);
    const p = {
      head: at(sh, -90, S.neck), sh, hip, kn, an, toe: at(an, 6, S.foot),
      el, wr: at(el, 88, S.foreArm),
    };
    if (raise) {
      /* 抬起侧：屈髋屈膝，脚离地 */
      p.kn2 = at(hip, -28, S.thigh);
      p.an2 = at(p.kn2, 72, S.shin);
      p.toe2 = at(p.an2, -24, S.foot);
    } else {
      /* 站立：另一条腿也在地上（角度略偏，避免两条腿完全重合看不出来） */
      p.kn2 = at(hip, 95, S.thigh);
      p.an2 = at(p.kn2, 86, S.shin);
      p.toe2 = at(p.an2, 6, S.foot);
    }
    return p;
  };

  return {
    'ankle-pump': {
      alt: '小腿和脚的特写。左图勾脚：脚尖尽量向身体方向抬起。右图绷脚：脚尖向前伸直，像踩油门。两个方向各保持2～3秒，交替算一次。',
      props: apBed, arrow: 'right', scale: AP_SCALE, groundY: AP_GROUND,
      frames: [anklePump(DORSI), anklePump(PLANTAR)],
      labels: ['勾脚', '绷脚（像踩油门）'],
    },
    bobath: {
      alt: '左图：坐稳，双手十指交叉放在腹部前面，患侧拇指放在最上面。右图：伸直肘部，双手一起缓慢举过头顶，肩部有轻微牵拉感就停下。',
      props: chair, arrow: 'up',
      /* 上举走**前屈**方向（肩关节屈曲）而不是贴着耳朵直上：既符合 Bobath 握手的
         做法，也让手臂从头前方经过、不与头重叠——严格侧面直上举时，手和头会
         挤成"两个圆圈"，放大看才发现。 */
      frames: [bobathPose(88, -10, 84, -6), bobathPose(-55, -70, -50, -66)],
      hands: [true, true],
      labels: ['十指交叉放腹部', '缓慢举过头顶'],
    },
    bridge: {
      alt: '左图：仰卧屈膝，双脚平踏床面，臀部贴着床。右图：缓慢抬起臀部，让肩、髋、膝大致成一条斜线，保持5到10秒再慢慢放下。',
      props: bed, arrow: 'up',
      frames: [bridgePose(0), bridgePose(-28)],
      alignHint: 1,
      labels: ['臀部贴床', '抬起保持5～10秒'],
    },
    'sit-to-stand': {
      alt: '左图：坐在椅子前半部，双脚平放、身体前倾，鼻子超过脚尖。右图：手扶稳、慢慢站起，站直后停一下再坐下。',
      props: chair + ground, arrow: 'up',
      frames: [
        sitStand([46, 78], -72, -6, 84, 78, 68),
        sitStand([62, 53], -90, 86, 92, 85, 88),
      ],
      labels: ['坐稳前倾', '慢慢站起'],
    },
    march: {
      alt: '左图：站稳，双手可扶稳固物体。右图：一条腿屈髋屈膝抬起，像原地走路，落下后换另一条腿。',
      props: ground, arrow: 'right',
      /* 这张图的动作发生在"远侧"那条腿上，所以远侧不能画太淡，否则重点被淡掉了 */
      farOpacity: 0.85,
      frames: [marchPose(false), marchPose(true)],
      labels: ['站稳', '抬腿踏步'],
    },
  };
})();

/* ---------- 渲染：两帧并排 + 中间箭头 + 标签 ---------- */
const FIGURES = (() => {
  const out = {};
  const L = 4, R = 128;   // 左右帧的横向偏移

  /* 箭头也手绘，粗细与人体一致（它是要被看见的，但别比人还重） */
  const arrow = (pts, heads, seed) =>
    `<g fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" opacity="0.85">`
    + FIG.sketch(pts, seed, 0.5) + heads + '</g>';
  const arrowRight = arrow([[112, 62], [127, 62]],
    '<path d="M127 62 l-6.5 -4.5 M127 62 l-6.5 4.5"/>', 71);
  const arrowUp = arrow([[119, 79], [119, 46]],
    '<path d="M119 46 l-5 7.5 M119 46 l5 7.5"/>', 83);

  Object.keys(POSES).forEach(id => {
    const d = POSES[id];
    const frames = d.frames.map((p, i) => {
      const dx = i === 0 ? L : R;
      const extra = (d.extras && d.extras[i]) || '';
      /* 交叉的双手：细线小圆圈，不用实心点——细线风格里实心点会变成最重的一团墨 */
      const hands = (d.hands && d.hands[i] && p.wr)
        ? `<g fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round">`
          + FIG.circle(p.wr[0], p.wr[1], 3.6, 37 + i * 13) + '</g>' : '';
      /* 肩髋膝成一条线的对齐提示：**不手绘**，用干净的直虚线——
         抖动的虚线看着像涂改痕迹，而这条是"参考线"，越规整越像辅助线 */
      const align = (d.alignHint === i && p.sh && p.kn)
        ? `<line x1="${FIG.n(p.sh[0])}" y1="${FIG.n(p.sh[1])}" x2="${FIG.n(p.kn[0])}" y2="${FIG.n(p.kn[1])}"
             stroke="currentColor" stroke-width="1.4" stroke-dasharray="4 4" opacity="0.4" fill="none"/>` : '';
      const scale = d.scale || 1;
      const inner = `${d.props}${extra}${align}${FIG.figure(p, { farOpacity: d.farOpacity })}${hands}`;
      return scale === 1
        ? `<g transform="translate(${dx},0)">${inner}</g>`
        : `<g transform="translate(${dx},0) scale(${scale})">${inner}</g>`;
    });

    const labels = `
    <g fill="currentColor" font-size="13.5" text-anchor="middle" opacity="0.82">
      <text x="${L + 52}" y="131">${d.labels[0]}</text>
      <text x="${R + 52}" y="131">${d.labels[1]}</text>
    </g>`;

    out[id] = {
      alt: d.alt,
      svg: `
<svg viewBox="0 0 240 140" role="img" aria-hidden="true">
  ${frames.join('\n  ')}
  ${d.arrow === 'up' ? arrowUp : arrowRight}
  ${labels}
</svg>`,
    };
  });
  return out;
})();
