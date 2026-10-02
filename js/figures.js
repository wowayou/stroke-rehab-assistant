/* ============================================================
   动作示意简笔画（内联 SVG，零依赖、零外部图片）

   —— 画法不是"手填坐标"，而是**按人体比例定义骨架、用几何算关节位置**。
      比例依据：成人约 7.5 头身、肩宽≈2 头（通用人体比例，见 docs/RESEARCH.md §十）。
      好处是每个姿势的肢段长度**由构造保证一致**（同一个人不会在第二帧里
      大腿变长），而这一点可以用脚本自动校验，不靠肉眼。

   数据结构：POSES[id] = { alt, view, frames:[poseA, poseB], props, labels }
      pose = { head, sh, el, wr, hip, kn, an, toe }（缺省的关节不画）
   FIGURES[id] = { alt, svg }  由 POSES 在加载时渲染而成，应用层（js/app/core.js 的 figureHTML）只用 FIGURES。

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

  /* 把一个姿势画成 SVG：躯干/四肢手绘折线，头手绘圆，不画关节点。
     opt.focus = 这个动作真正在动的部位（'trunk' 'arm' 'leg' 'foot'，远侧加 2），
     这些部位单独成组、带 class="fig-focus"，由 CSS 换成强调色——颜色走样式表
     而不写死在 SVG 里，主题/高对比度只改 CSS。
     不做"患侧上色"：图是侧面视角，而患者患侧因人而异，固定一侧上色会误导。 */
  function figure(p, opt = {}) {
    const focus = new Set(opt.focus || []);
    const near = [], hot = [];
    let seed = 3;
    const push = (part, pts) => {
      if (pts.length && pts.every(Boolean)) (focus.has(part) ? hot : near).push(sketch(pts, seed += 17));
    };

    if (p.sh && p.hip) push('trunk', [p.sh, p.hip]);
    /* 颈部画到头的**圆周**为止，不要连到圆心——否则圆里会多出一根竖线，
       整个人看着像"棒棒糖插了根杆"。 */
    if (p.sh && p.head) {
      const dx = p.head[0] - p.sh[0], dy = p.head[1] - p.sh[1];
      const len = Math.hypot(dx, dy) || 1;
      const k = Math.max(0, (len - SEG.headR) / len);
      push('neck', [p.sh, [p.sh[0] + dx * k, p.sh[1] + dy * k]]);
    }
    push('arm', [p.sh, p.el, p.wr].filter(Boolean).length === 3 ? [p.sh, p.el, p.wr] : []);
    push('leg', [p.hip, p.kn, p.an].filter(Boolean).length === 3 ? [p.hip, p.kn, p.an] : []);
    if (p.kn && p.an && !p.hip) push('leg', [p.kn, p.an]);
    /* 脚用楔形（见 foot()）：脚的角度往往正是这张图要教的东西 */
    const feet = [], hotFeet = [];
    if (p.an && p.toe) (focus.has('foot') ? hotFeet : feet).push(foot(p.an, p.toe));
    if (p.an2 && p.toe2) (focus.has('foot2') ? hotFeet : feet).push(foot(p.an2, p.toe2, { opacity: 0.68 }));
    /* 远侧手臂/腿：细一点、淡一点，表示"另一侧"（但不能太淡，否则
       抬腿这类"动作发生在远侧"的图会看不清） */
    const far = [], hotFar = [];
    if (p.sh && p.el2 && p.wr2) (focus.has('arm2') ? hotFar : far).push(sketch([p.sh, p.el2, p.wr2], 91));
    if (p.hip && p.kn2 && p.an2) (focus.has('leg2') ? hotFar : far).push(sketch([p.hip, p.kn2, p.an2], 113));

    const G = (items, attrs, cls = '') => items.length ? `
    <g${cls ? ` class="${cls}"` : ''} fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" ${attrs}>
      ${items.join('\n      ')}
    </g>` : '';
    const farOp = `opacity="${opt.farOpacity || 0.55}"`;
    return G(near, 'stroke-width="2.1"')
      + G(feet, 'stroke-width="1.9"')
      + G(far, `stroke-width="1.8" ${farOp}`)
      + (p.head ? G([circle(p.head[0], p.head[1], SEG.headR, 29)], 'stroke-width="2.1"') : '')
      /* 强调部位最后画、压在其它线上；远侧的强调保持远侧的淡度，否则远近关系会乱 */
      + G(hotFar, `stroke-width="1.8" ${farOp}`, 'fig-focus')
      + G(hot, 'stroke-width="2.3"', 'fig-focus')
      + G(hotFeet, 'stroke-width="2.1"', 'fig-focus');
  }

  /* 运动弧线：绕 pivot，从 from 帧的 end 关节方向转到 to 帧的方向，末端带箭头。
     方向全由两帧姿势现算、不手填——改了姿势，箭头自动跟着对。 */
  function motionArc(from, to, pivot, end, r, seed = 131) {
    const c = to[pivot];
    const ang = q => Math.atan2(q[end][1] - q[pivot][1], q[end][0] - q[pivot][0]);
    const a0 = ang(from);
    let da = ang(to) - a0;
    da = ((da + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;   // 走短的那一边
    const sg = Math.sign(da) || 1;
    /* 两端各收一点，箭头别戳到肢体上 */
    const trim = Math.min(0.18, Math.abs(da) * 0.15) * sg;
    const N = Math.max(3, Math.ceil(Math.abs(da) / 0.25));
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const a = a0 + trim + (da - 2 * trim) * (i / N);
      pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
    }
    const [x1, y1] = pts[N];
    const aEnd = a0 + da - trim;
    const tx = -Math.sin(aEnd) * sg, ty = Math.cos(aEnd) * sg;   // 末端切线方向
    const h = 4.2, w = 2.8;
    const head = `<path d="M${n(x1 - tx * h + ty * w)},${n(y1 - ty * h - tx * w)} L${n(x1)},${n(y1)}`
      + ` L${n(x1 - tx * h - ty * w)},${n(y1 - ty * h + tx * w)}"/>`;
    return `<g class="fig-focus" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" opacity="0.9">`
      + sketch(pts, seed, 0.3) + head + '</g>';
  }

  return { SEG, at, joint, figure, motionArc, foot, sketch, circle, n };
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
     角度按人的正常活动度取（仰卧时脚与小腿垂直＝中立，脚尖朝天花板）：
     勾脚＝背屈约 18°，脚尖越过垂直、朝膝盖方向倒；绷脚＝跖屈约 45°。
     v0.2.31 前画成"勾脚朝天、绷脚与小腿共线"，量出来勾脚其实是跖屈 18°、
     绷脚跖屈 96°（人做不到）——而防足下垂的关键恰恰是背屈。 */
  const AP_SCALE = 1.8;
  const AP_GROUND = 46;
  const apKn = [8, 40];
  const apAn = at(apKn, 0, S.shin);
  const DORSI = -108, PLANTAR = -45;   // 脚（踝→趾）的方向：小腿朝右为 0°，-90° 为中立
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

  /* —— 桥式：肩不动、抬髋，脚钉在原地用 joint() 反解膝。
        脚要**平踏**床面（要领原文）：踝离床约 3.4、脚放平，楔形鞋底才正好贴床；
        v0.2.31 前踝离床 8、脚斜 33°，放大看是踮着脚。 —— */
  const brSh = [32, 90];
  const brAnkle = [83, 96.6];
  const bridgePose = hipDeg => {
    const hip = at(brSh, hipDeg, S.torso);
    const kn = joint(hip, brAnkle, S.thigh, S.shin, -1);
    return {
      head: at(brSh, 180, S.neck), sh: brSh, hip, kn,
      an: brAnkle, toe: at(brAnkle, 5, S.foot),
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
  /* 起始帧照要领的三个要点画：双脚后收到膝盖后方（小腿向后斜）、双手十指交叉
     伸肘前伸、身体前倾到鼻尖超过膝盖（约 35°）。v0.2.31 前这三点全反了：脚在膝前、
     只前倾 18°、双手垂着扶椅面——照着做，重心移不到脚上，容易起不来或往后跌坐。 */
  const stsSit = sitStand([50, 78], -55, -6, 100, 40, 36);
  /* 站起那一帧从脚往上反推髋：起立过程中脚不挪动，两帧踝必须同位 */
  const standOn = (an, thighDeg, shinDeg, armDeg, foreDeg) => {
    const kn = at(an, shinDeg + 180, S.shin);
    return sitStand(at(kn, thighDeg + 180, S.thigh), -90, thighDeg, shinDeg, armDeg, foreDeg);
  };

  /* —— 原地踏步：支撑腿站直，另一腿屈髋屈膝抬起。
        动作名是「扶持」原地踏步、要领第一句「手扶稳固支撑物站立」，所以身前画一张桌面，
        手用 joint() 钉在桌沿（两帧都扶着）。桌面要高过抬起的膝：抬腿画到髋屈约 75°
        （大腿略低于水平），膝才从桌面下方经过、不撞桌子。
        v0.2.31 前没画扶持物、抬腿髋屈约 118°，站立帧远侧膝还画成了过伸 9°——
        卒中后膝过伸正是要纠正的异常步态，两条腿都要保持微屈或伸直、不能反弯。 —— */
  const MARCH_TABLE = { x0: 64, x1: 100, y: 50, legX: 96 };
  const MARCH_HAND = [68, 50];
  const table = prop([[MARCH_TABLE.x0, MARCH_TABLE.y], [MARCH_TABLE.x1, MARCH_TABLE.y]], 79)
    + prop([[MARCH_TABLE.legX, MARCH_TABLE.y], [MARCH_TABLE.legX, GROUND]], 89);
  const marchPose = raise => {
    const an = [50, 97];
    const kn = at(an, -88, S.shin);
    const hip = at(kn, -90, S.thigh);
    const sh = at(hip, -90, S.torso);
    const p = {
      head: at(sh, -90, S.neck), sh, hip, kn, an, toe: at(an, 6, S.foot),
      el: joint(sh, MARCH_HAND, S.upperArm, S.foreArm, 1), wr: MARCH_HAND,
    };
    if (raise) {
      /* 抬起侧：屈髋屈膝，脚离地 */
      p.kn2 = at(hip, 15, S.thigh);
      p.an2 = at(p.kn2, 105, S.shin);
      p.toe2 = at(p.an2, 15, S.foot);
    } else {
      /* 站立：另一条腿也在地上，略靠后，避免两条腿完全重合看不出来 */
      p.kn2 = at(hip, 97, S.thigh);
      p.an2 = at(p.kn2, 99, S.shin);
      p.toe2 = at(p.an2, 6, S.foot);
    }
    return p;
  };

  /* review：这张图有没有被康复医生/治疗师看过的**唯一真源**（文档只指向这里）。
     status: pending 未复核 | approved 已确认 | changes 复核后待修改；
     approved 必须填 by（复核人身份，如"康复科医师"）与 date（YYYY-MM-DD）。
     questions 是要请医生拍板的点，复核单（node test/preview-figures.js --review）逐条列出；
     角度写"见角度表"而不写死数字——数字由复核单从姿势现算，写死会随改图过期。 */
  const pending = questions => ({ status: 'pending', by: '', date: '', notes: '', questions });

  return {
    'ankle-pump': {
      alt: '小腿和脚的特写。左图勾脚：脚尖尽量向身体方向抬起。右图绷脚：脚尖向前伸直，像踩油门。两个方向各保持2～3秒，交替算一次。',
      props: apBed, arrow: 'right', scale: AP_SCALE, groundY: AP_GROUND,
      frames: [anklePump(DORSI), anklePump(PLANTAR)],
      focus: ['foot'], motion: { pivot: 'an', end: 'toe', r: 14 },
      labels: ['勾脚', '绷脚（像踩油门）'],
      review: pending([
        '勾脚画成脚尖越过"与小腿垂直"、朝膝盖方向倒（背屈），绷脚画成明显跖屈，幅度见角度表。这个幅度对卧床患者是否合适？',
      ]),
    },
    bobath: {
      alt: '左图：坐稳，双手十指交叉放在腹部前面，患侧拇指放在最上面。右图：伸直肘部，双手一起缓慢举过头顶，肩部有轻微牵拉感就停下。',
      props: chair, arrow: 'up',
      /* 上举走**前屈**方向（肩关节屈曲）而不是贴着耳朵直上：既符合 Bobath 握手的
         做法，也让手臂从头前方经过、不与头重叠——严格侧面直上举时，手和头会
         挤成"两个圆圈"，放大看才发现。 */
      frames: [bobathPose(88, -10, 84, -6), bobathPose(-55, -70, -50, -66)],
      hands: [true, true],
      focus: ['arm', 'arm2'], motion: { pivot: 'sh', end: 'wr', r: 36 },
      labels: ['十指交叉放腹部', '缓慢举过头顶'],
      review: pending([
        '上举高度见角度表（肩前屈）。注意事项要求软瘫期肩关节活动不超过正常的三分之二（约 120°，此时双手大约与头顶齐平），而要领写"举过头顶"——卧床期的示意图应画到哪个高度？',
        '图为坐位；该动作归在卧床期，要领写"仰卧或坐位"。是否应改画仰卧位？',
        '"患侧拇指放在最上面"在这个尺寸画不出来，只靠图下文字说明是否足够？',
      ]),
    },
    bridge: {
      alt: '左图：仰卧屈膝，双脚平踏床面，臀部贴着床。右图：缓慢抬起臀部，让肩、髋、膝大致成一条斜线，保持5到10秒再慢慢放下。',
      props: bed, arrow: 'up',
      /* 抬到肩、髋、膝成一条线为止——再高就是塌腰（躯干-大腿角成负值） */
      frames: [bridgePose(0), bridgePose(-19)],
      /* 不画运动弧线：绕肩的弧正好压在躯干上，放大看像一道划痕；两帧间的向上箭头已够 */
      focus: ['trunk', 'leg'],
      alignHint: 1,
      labels: ['臀部贴床', '抬起保持5～10秒'],
      review: pending([
        '抬臀帧画到肩、髋、膝约成一条线，膝的弯曲见角度表。抬臀高度与膝的弯曲程度是否合适？',
        '要领第 2 步是"必要时家属帮助固定患侧膝盖和脚"。图中是否需要示意？',
      ]),
    },
    'sit-to-stand': {
      alt: '左图：坐在椅子前半部，双脚后收到膝盖后方、踏实地面；双手十指交叉向前伸，身体前倾到鼻尖超过膝盖。右图：重心前移、慢慢站直，双腿均匀承重；坐下时同样先前倾、慢慢落座。',
      props: chair + ground, arrow: 'up',
      frames: [stsSit, standOn(stsSit.an, 86, 92, 86, 82)],
      hands: [true, false],
      labels: ['坐稳前倾', '慢慢站起'],
      review: pending([
        '起始姿势按要领画成：双脚后收到膝盖后方、双手十指交叉向前伸、身体前倾到鼻尖超过膝盖（前倾角度见角度表）。前倾幅度是否合适？',
        '家庭场景下，"双手交叉前伸"与"双手扶椅子扶手/椅面借力"哪种更合适？（v0.2.31 前的图更像后者、与要领不一致，已按要领改为前者）',
      ]),
    },
    march: {
      alt: '左图：手扶稳固的桌子或台面站稳。右图：一条腿屈髋屈膝抬起，像原地走路，落下后换另一条腿。',
      props: ground + table, arrow: 'right',
      /* 这张图的动作发生在"远侧"那条腿上，所以远侧不能画太淡，否则重点被淡掉了 */
      farOpacity: 0.85,
      frames: [marchPose(false), marchPose(true)],
      focus: ['leg2', 'foot2'], motion: { pivot: 'hip', end: 'kn2', r: 13 },
      support: MARCH_HAND, table: MARCH_TABLE,
      labels: ['扶稳站好', '抬腿踏步'],
      review: pending([
        '扶持物画成身前的桌面/台面、手扶桌沿。这种扶法是否合适？还是更推荐扶椅背或扶墙？',
        '抬腿高度见角度表（大腿略低于水平）。要领写"患腿也要尽量抬起"——这个高度是否合适？',
      ]),
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
        ? `<g${(d.focus || []).includes('arm') ? ' class="fig-focus"' : ''} fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round">`
          + FIG.circle(p.wr[0], p.wr[1], 3.6, 37 + i * 13) + '</g>' : '';
      /* 肩髋膝成一条线的对齐提示：**不手绘**，用干净的直虚线——
         抖动的虚线看着像涂改痕迹，而这条是"参考线"，越规整越像辅助线 */
      const align = (d.alignHint === i && p.sh && p.kn)
        ? `<line x1="${FIG.n(p.sh[0])}" y1="${FIG.n(p.sh[1])}" x2="${FIG.n(p.kn[0])}" y2="${FIG.n(p.kn[1])}"
             stroke="currentColor" stroke-width="1.4" stroke-dasharray="4 4" opacity="0.4" fill="none"/>` : '';
      const scale = d.scale || 1;
      /* 运动弧线只画在到位帧：从起始姿势指向当前姿势 */
      const m = d.motion;
      const arc = (m && i === 1) ? FIG.motionArc(d.frames[0], p, m.pivot, m.end, m.r) : '';
      const inner = `${d.props}${extra}${align}${FIG.figure(p, { farOpacity: d.farOpacity, focus: d.focus })}${hands}${arc}`;
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
