/* ============================================================
   简易趋势图（canvas 折线图，零依赖）
   Charts.line(canvas, seriesArr, opts)
   series: { label, color, marker?('dot'|'square'), values: [{x:'MM-DD', y:Number}] }
   opts: { refLines: [{y, color, label}], yMin, yMax }
   图例不在此绘制：由调用方用同一颜色数据源生成（见 app.js 的 VITAL_SERIES）
   ============================================================ */

const Charts = (() => {
  function line(canvas, seriesArr, opts = {}) {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 320;
    const cssH = canvas.clientHeight || 200;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssW, cssH);

    const allY = [];
    seriesArr.forEach(s => s.values.forEach(v => allY.push(v.y)));
    (opts.refLines || []).forEach(r => allY.push(r.y));
    if (!allY.length) return;

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

    /* 参考线（目标值） */
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
    const base = seriesArr[0].values;
    if (base.length) {
      ctx.fillStyle = '#8A8F9C'; ctx.textBaseline = 'top';
      const idxs = base.length <= 2 ? base.map((_, i) => i)
        : [0, Math.floor((base.length - 1) / 2), base.length - 1];
      [...new Set(idxs)].forEach(i => {
        ctx.textAlign = i === 0 ? 'left' : i === base.length - 1 ? 'right' : 'center';
        ctx.fillText(base[i].x, xAt(i), padT + plotH + 8);
      });
    }

    /* 折线与数据点 */
    seriesArr.forEach(s => {
      if (!s.values.length) return;
      ctx.strokeStyle = s.color; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
      ctx.beginPath();
      s.values.forEach((v, i) => {
        const x = xAt(i), y = yAt(v.y);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.fillStyle = s.color;
      s.values.forEach((v, i) => {
        const px = xAt(i), py = yAt(v.y);
        if (s.marker === 'square') ctx.fillRect(px - 3.4, py - 3.4, 6.8, 6.8);
        else { ctx.beginPath(); ctx.arc(px, py, 3.2, 0, Math.PI * 2); ctx.fill(); }
      });
    });
  }

  return { line };
})();
