/* ============================================================
   简易趋势图（canvas 折线图，零依赖）
   Charts.line(canvas, seriesArr, opts)
   series: { label, color, marker?('dot'|'square'), values: [{x:'MM-DD', y:Number}] }
   opts: {
     refLines: [{y, color, label}],   // 参考线（虚线+可选文字）
     zones:    [{from, to, color}],   // 着色目标区（from=下限, to=上限），先于网格绘制
     onTap(i, {x, y}), onLeave(),     // 交互：选中/离开最近的数据点列
     yMin, yMax
   }
   图例不在此绘制：由调用方用同一颜色数据源生成（见 app.js 的 VITAL_SERIES）
   交互：点按/悬停命中最近的数据点列（容错 ~32px，适老化），
   高亮选中点并压暗其余点，回调 onTap 供调用方弹 tooltip。
   ============================================================ */

const Charts = (() => {
  function line(canvas, seriesArr, opts = {}) {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 320;
    const cssH = canvas.clientHeight || 200;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    const ctx = canvas.getContext('2d');
    const base = seriesArr[0].values;

    const allY = [];
    seriesArr.forEach(s => s.values.forEach(v => allY.push(v.y)));
    (opts.refLines || []).forEach(r => allY.push(r.y));
    (opts.zones || []).forEach(z => { allY.push(z.from, z.to); });
    if (!allY.length) { bindPointer(canvas, { pick() {}, clearSel() {} }); return; }

    let yMin = opts.yMin !== undefined ? opts.yMin : Math.min(...allY);
    let yMax = opts.yMax !== undefined ? opts.yMax : Math.max(...allY);
    const span = yMax - yMin || 1;
    yMin -= span * 0.15; yMax += span * 0.15;
    if (opts.yFloor !== undefined) yMin = Math.max(yMin, opts.yFloor);

    const padL = 38, padR = 10, padT = 12, padB = 26;
    const plotW = cssW - padL - padR;
    const plotH = cssH - padT - padB;
    const n = Math.max(...seriesArr.map(s => s.values.length));
    const xAt = i => padL + (n <= 1 ? plotW / 2 : (plotW * i) / (n - 1));
    const yAt = v => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

    let sel = -1;

    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      /* 目标区着色（在网格之下，避免压盖） */
      (opts.zones || []).forEach(z => {
        const yTop = yAt(z.to), yBot = yAt(z.from);
        if (yBot <= yTop) return;
        ctx.save();
        ctx.fillStyle = z.color;
        ctx.fillRect(padL, yTop, plotW, yBot - yTop);
        ctx.restore();
      });

      /* 网格与Y轴刻度 */
      ctx.font = '11px sans-serif';
      ctx.fillStyle = '#8A8F9C';
      ctx.strokeStyle = '#E8E4DA';
      ctx.lineWidth = 1;
      const ticks = 4;
      for (let i = 0; i <= ticks; i++) {
        const v = yMin + ((yMax - yMin) * i) / ticks;
        const y = yAt(v);
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(cssW - padR, y); ctx.stroke();
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(Math.round(v), padL - 5, y);
      }

      /* 参考线（目标值/提示线） */
      (opts.refLines || []).forEach(r => {
        const y = yAt(r.y);
        ctx.save();
        ctx.strokeStyle = r.color; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(cssW - padR, y); ctx.stroke();
        if (r.label) {
          ctx.fillStyle = r.color; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
          ctx.fillText(r.label, padL + 3, y - 2);
        }
        ctx.restore();
      });

      /* X轴日期标签：首、中、尾 */
      if (base.length) {
        ctx.fillStyle = '#8A8F9C'; ctx.textBaseline = 'top';
        const idxs = base.length <= 2 ? base.map((_, i) => i)
          : [0, Math.floor((base.length - 1) / 2), base.length - 1];
        [...new Set(idxs)].forEach(i => {
          ctx.textAlign = i === 0 ? 'left' : i === base.length - 1 ? 'right' : 'center';
          ctx.fillText(base[i].x, xAt(i), padT + plotH + 8);
        });
      }

      /* 折线（保持全不透明度，趋势始终可读） */
      seriesArr.forEach(s => {
        if (!s.values.length) return;
        ctx.strokeStyle = s.color; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
        ctx.beginPath();
        s.values.forEach((v, i) => {
          const x = xAt(i), y = yAt(v.y);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
      });

      /* 数据点：选中点放大+描圈，其余压暗 */
      seriesArr.forEach(s => {
        if (!s.values.length) return;
        s.values.forEach((v, i) => {
          const px = xAt(i), py = yAt(v.y);
          const isSel = sel === i;
          ctx.save();
          if (sel >= 0 && !isSel) ctx.globalAlpha = 0.45;
          ctx.fillStyle = s.color;
          if (isSel) {
            ctx.globalAlpha = 1;
            ctx.strokeStyle = s.color; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.stroke();
            ctx.fillStyle = '#fff';
            ctx.beginPath(); ctx.arc(px, py, 4.5, 0, Math.PI * 2); ctx.fill();
          } else if (s.marker === 'square') {
            ctx.fillRect(px - 3.4, py - 3.4, 6.8, 6.8);
          } else {
            ctx.beginPath(); ctx.arc(px, py, 3.2, 0, Math.PI * 2); ctx.fill();
          }
          ctx.restore();
        });
      });

      /* 选中列的垂直引导线 */
      if (sel >= 0) {
        const gx = xAt(sel);
        ctx.save();
        ctx.strokeStyle = 'rgba(34,38,46,0.25)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(gx, padT); ctx.lineTo(gx, cssH - padB); ctx.stroke();
        ctx.restore();
      }
    }

    function nearest(px) {
      if (!base.length) return -1;
      let best = 0, bd = Infinity;
      for (let i = 0; i < base.length; i++) {
        const d = Math.abs(xAt(i) - px);
        if (d < bd) { bd = d; best = i; }
      }
      return bd <= 32 ? best : -1;  // 容错 32px，适老化
    }

    function pick(e) {
      const r = canvas.getBoundingClientRect();
      const i = nearest(e.clientX - r.left);
      if (i < 0) { clearSel(); return; }
      sel = i;
      draw();
      const ys = seriesArr.map(s => (s.values[i] ? yAt(s.values[i].y) : null)).filter(y => y !== null);
      opts.onTap && opts.onTap(i, { x: xAt(i), y: ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : padT });
    }
    function clearSel() {
      sel = -1;
      draw();
      opts.onLeave && opts.onLeave();
    }

    bindPointer(canvas, { pick, clearSel });
    draw();
  }

  /* 点按/悬停事件：每次 Charts.line 调用替换旧监听，避免重复绑定 */
  function bindPointer(canvas, h) {
    if (canvas._chartsCleanup) canvas._chartsCleanup();
    const isHover = window.matchMedia && window.matchMedia('(hover: hover)').matches;
    const down = e => h.pick(e);
    canvas.addEventListener('pointerdown', down);
    let move = null, leave = null;
    if (isHover) {
      move = e => h.pick(e);
      leave = () => h.clearSel();
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerleave', leave);
    }
    canvas._chartsCleanup = () => {
      canvas.removeEventListener('pointerdown', down);
      if (move) canvas.removeEventListener('pointermove', move);
      if (leave) canvas.removeEventListener('pointerleave', leave);
      delete canvas._chartsCleanup;
    };
  }

  return { line };
})();
