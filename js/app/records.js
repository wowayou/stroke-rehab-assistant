/* ============================================================
   记录页：判定(bp/glu/bmiBadge) → 格式化 → 比上次 → 图表(VITAL_SERIES/targetConfig)
   → 历史与修改（openVitalEdit）→ 血压/血糖/体重三个表单（共用校验 readVital；记录时间未改过取保存那刻：whenOf）→ 导出报告
   医学阈值改动前读 docs/RESEARCH.md §八。
   ============================================================ */

/* ============================================================
   【区】记录页：判定 → 格式化 → 比上次 → 图表 → 三个表单 → 导出
   ============================================================ */
const REC_KINDS = {
  bp: { name: '血压', icon: '🩺' },
  glucose: { name: '血糖', icon: '🩸' },
  weight: { name: '体重', icon: '⚖️' },
};

function bpBadge(sys, dia) {
  const t = Store.data.profile.targets; // 个人目标值（遵医嘱）
  if (sys >= 180 || dia >= 110) return ['bad', '血压很高，尽快联系医生'];   // 绝对安全线，不随目标变
  if (sys < 90 || dia < 60) return ['warn', '偏低，注意头晕跌倒'];
  if (sys > t.bpSys || dia > t.bpDia) return ['warn', '偏高（超过您的目标值）'];
  return ['ok', '在您的目标值内（遵医嘱）'];
}
function gluBadge(gtype, v) {
  const t = Store.data.profile.targets;
  if (v <= 3.9) return ['bad', '偏低，警惕低血糖'];   // 绝对安全线
  if (gtype === '空腹') {
    if (v <= t.gluFast) return ['ok', '空腹在您的目标内（遵医嘱）'];
    if (v <= 10) return ['warn', '空腹偏高（超过您的目标值）'];
    return ['bad', '明显偏高，联系医生'];   // 绝对安全线，不随目标变
  }
  if (v <= t.gluPost) return ['ok', '在您的目标内（遵医嘱）'];
  if (v < 13.9) return ['warn', '偏高（超过您的目标值）'];
  return ['bad', '明显偏高，联系医生'];   // 绝对安全线，不随目标变
}
function bmiBadge(bmi) {
  if (bmi < 18.5) return ['warn', '偏瘦，注意营养'];
  if (bmi < 24) return ['ok', '体重适中'];
  if (bmi < 28) return ['warn', '超重'];
  return ['bad', '肥胖，建议咨询医生'];
}

/* 单条记录的显示文本与红黄绿状态（历史列表的小圆点用同一套判定） */
const VITAL_FMT = {
  bp: v => `${esc(v.sys)}/${esc(v.dia)} mmHg${v.pulse ? ' · 脉搏 ' + esc(v.pulse) : ''}`,
  glucose: v => `${esc(v.value)} mmol/L · ${esc(v.gtype)}`,
  weight: v => `${esc(v.value)} 公斤`,
};
function vitalStatus(kind, v) {
  if (kind === 'bp') return bpBadge(+v.sys, +v.dia);
  if (kind === 'glucose') return gluBadge(v.gtype, +v.value);
  const h = +Store.data.profile.height;
  if (!h) return ['', ''];
  const bmi = +v.value / Math.pow(h / 100, 2);
  const [cls, txt] = bmiBadge(bmi);
  /* 结论在前、数字在后：BMI 是个算出来的抽象数，先说人话 */
  return [cls, `${txt}（BMI ${bmi.toFixed(1)}）`];
}

/* ---------- 「比上次…」：应用把减法做完，直接说结论 ---------- */
const UP_DOWN = d => (d > 0 ? '高' : '低');
function deltaLineHTML(kind) {
  const d = Store.vitalDelta(kind);
  if (!d) return '';
  let body;
  if (kind === 'bp') {
    if (!d.sys && !d.dia) body = '和上次一样';
    else {
      const parts = [];
      if (d.sys) parts.push(`高压${UP_DOWN(d.sys)}了 ${Math.abs(d.sys)}`);
      if (d.dia) parts.push(`低压${UP_DOWN(d.dia)}了 ${Math.abs(d.dia)}`);
      body = parts.join('，');
    }
  } else {
    const unit = kind === 'weight' ? '公斤' : '';
    if (!d.value) body = '和上次一样';
    else body = `比上次${UP_DOWN(d.value)}了 ${Math.abs(d.value)}${unit}`;
  }
  const prefix = (kind === 'bp' && body !== '和上次一样') ? '比上次：' : '';
  return `<div class="delta-line">↕ ${prefix}${esc(body)}<span class="muted">（上次 ${esc(d.prevDate)}${d.prevTime ? ' ' + esc(d.prevTime) : ''}）</span></div>`;
}

/* 图表上方一句话小结：不看图也能知道大概情况，避免"看图 + 心算"双重负担 */
function chartSummaryHTML(kind, list) {
  if (list.length < 2) return '';
  const first = list[0], last = list[list.length - 1];
  const val = v => (kind === 'bp' ? +v.sys : +v.value);
  const diff = val(last) - val(first);
  const nameOf = { bp: '高压', glucose: '血糖', weight: '体重' }[kind];
  const unit = kind === 'weight' ? ' 公斤' : '';
  const amount = Math.round(Math.abs(diff) * 10) / 10;
  let trend;
  if (!amount) trend = `${nameOf}和最早一条差不多`;
  else trend = `这 ${list.length} 条里，${nameOf}比最早一条${UP_DOWN(diff)}了 ${amount}${unit}`;

  let inTarget = '';
  if (kind !== 'weight') {
    const ok = list.filter(v => vitalStatus(kind, v)[0] === 'ok').length;
    /* 说"有几次在目标内"而不是百分比；一次都没有也不说重话 */
    inTarget = ok
      ? `　·　其中 ${ok} 次在您的目标内`
      : '　·　这段时间都超过了目标值，可以带记录去问问医生';
  }
  return `<div class="chart-summary">${esc(trend)}${inTarget}</div>`;
}
/* 趋势图颜色与图例的单一数据源：canvas 画线与下方图例都从这里读，保证颜色一一对应。
   series.key 对应记录字段；refs 为参考线（y=目标值，label 画在图上，legend 出现在图例）。
   调色板对齐 css/style.css：高压=--red、低压=--primary、血糖=--green、参考线=--orange。 */
const VITAL_SERIES = {
  bp: {
    series: [
      { key: 'sys', label: '高压', color: '#D93A3A', marker: 'dot' },
      { key: 'dia', label: '低压', color: '#2E6FE0', marker: 'square' },
    ],
    note: '',
  },
  glucose: {
    series: [
      { key: 'value', label: '血糖', color: '#1E8E5A', marker: 'dot' },
    ],
    note: '目标遵医嘱',
  },
  weight: {
    series: [
      { key: 'value', label: '体重', color: '#7C5CD9', marker: 'dot' },
    ],
    note: '',
  },
};
/* 由个人目标值生成参考线与目标区（目标值遵医嘱、用户可调）。
   血压：目标区着色（低压~高压）；与默认 140/90 不同才补淡色 140/90 参考线。
   血糖：空腹/餐后参考线用个人值。绝对安全线（180/110、3.9、13.9 等）不在此。 */
function targetConfig(kind) {
  const t = Store.data.profile.targets;
  const g = n => n.toFixed(1);
  if (kind === 'bp') {
    const isDefault = t.bpSys === 140 && t.bpDia === 90;
    return {
      zones: [{ from: t.bpDia, to: t.bpSys, color: 'rgba(30,142,90,0.10)' }],
      refLines: [
        { y: t.bpSys, color: '#1E8E5A' },
        { y: t.bpDia, color: '#1E8E5A' },
        ...(isDefault ? [] : [
          { y: 140, color: '#C8B48F', label: '140' },
          { y: 90, color: '#C8B48F' },
        ]),
      ],
      legend: [
        { band: true, label: '目标区（遵医嘱）' },
        ...(isDefault ? [] : [{ color: '#C8B48F', label: '140/90 提示线', dash: true }]),
      ],
    };
  }
  if (kind === 'glucose') {
    return {
      zones: [],
      refLines: [
        { y: t.gluFast, color: '#D97706', label: `空腹参考${g(t.gluFast)}` },
        { y: t.gluPost, color: '#0E7490', label: `餐后参考${g(t.gluPost)}` },
      ],
      legend: [
        { color: '#D97706', label: `空腹目标 ${g(t.gluFast)}`, dash: true },
        { color: '#0E7490', label: `餐后2h目标 ${g(t.gluPost)}`, dash: true },
      ],
    };
  }
  return { zones: [], refLines: [], legend: [] };
}
/* 图例：一小段和图上完全一致的线（实线=数据、同色虚线=参考线/目标区带）+ 深色标签 */
function chartLegendHTML(kind) {
  const def = VITAL_SERIES[kind];
  const tc = targetConfig(kind);
  const items = [];
  def.series.forEach(s => items.push(
    `<span class="lg-item"><span class="lg-sw" style="border-color:${s.color}"></span>${esc(s.label)}</span>`));
  tc.legend.forEach(l => items.push(l.band
    ? `<span class="lg-item"><span class="lg-band"></span>${esc(l.label)}</span>`
    : `<span class="lg-item"><span class="lg-sw ${l.dash ? 'lg-dash' : ''}" style="border-color:${l.color}"></span>${esc(l.label)}</span>`));
  return `<div class="chart-legend"><div class="lg-hint">👆 点一下图上的点，看当天数值</div>${items.join('')}${def.note ? `<span class="lg-note">${esc(def.note)}</span>` : ''}</div>`;
}
/* 趋势图（记录页与历史弹窗共用，只是取的条数不同）；点选某列弹 tooltip 显示该条详情 */
function drawVitalChart(kind, canvas, recent) {
  if (!canvas || recent.length < 2) return;
  const def = VITAL_SERIES[kind];
  const tc = targetConfig(kind);
  const x = v => v.date.slice(5);
  const series = def.series.map(s => ({
    label: s.label, color: s.color, marker: s.marker,
    values: recent.map(v => ({ x: x(v), y: +v[s.key] })),
  }));
  const opts = kind === 'weight' ? {} : { yFloor: 0 }; // 体重不压 0，否则曲线被压扁
  if (tc.refLines.length) opts.refLines = tc.refLines;
  if (tc.zones.length) opts.zones = tc.zones;
  opts.onTap = (i, pos) => { const rec = recent[i]; if (rec) showVitalTooltip(canvas.parentElement, kind, rec, pos.x, pos.y); };
  opts.onLeave = () => hideVitalTooltip();
  Charts.line(canvas, series, opts);
}
/* tooltip：画布上方浮层，显示日期/时间/数值/判定（关键信息仍在下方列表，这里只做补充） */
function showVitalTooltip(box, kind, v, px, py) {
  hideVitalTooltip();
  const [cls, txt] = vitalStatus(kind, v);
  let html = `<div class="vt-t">${esc(v.date)}${v.time ? ' ' + esc(v.time) : ''}</div>`;
  if (kind === 'bp') {
    /* 高压/低压颜色从 VITAL_SERIES 取，别再在这里硬写一遍 hex——
       图表画线与这里的 tooltip 数字要同色，只能有一个真源。 */
    const bpColor = key => (VITAL_SERIES.bp.series.find(s => s.key === key) || {}).color || '';
    html += `<div class="vt-v"><span style="color:${bpColor('sys')}">${esc(v.sys)}</span>/<span style="color:${bpColor('dia')}">${esc(v.dia)}</span> mmHg${v.pulse ? ' · ♥ ' + esc(v.pulse) : ''}</div>`;
  } else {
    html += `<div class="vt-v">${VITAL_FMT[kind](v)}</div>`;
  }
  html += `<div class="vt-s ${cls}">${esc(txt)}</div>`;
  const tip = document.createElement('div');
  tip.className = 'vital-tooltip';
  tip.innerHTML = html;
  box.appendChild(tip);
  const w = tip.offsetWidth || 170, h = tip.offsetHeight || 70;
  const bw = box.clientWidth;
  let left = px - w / 2;
  left = Math.max(6, Math.min(left, bw - w - 6));
  let top = py - h - 12;
  if (top < 6) top = py + 12;
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}
function hideVitalTooltip() {
  const el = document.querySelector('.vital-tooltip');
  if (el) el.remove();
}
function histBtnHTML(kind, count) {
  if (!count) return '';
  return `<button class="btn ghost block" data-hist="${kind}" style="margin-top:0.8rem">📄 查看全部历史记录（${count} 条）</button>`;
}
function bindHist(body) {
  body.querySelectorAll('[data-hist]').forEach(b => b.onclick = () => openVitalHistory(b.dataset.hist));
}

/* 历史弹窗：趋势图 + 全部记录（每条可点开修改、行尾删除），分页 60+60 */
function openVitalHistory(kind) {
  const meta = REC_KINDS[kind];
  const node = document.createElement('div');
  const close = openModal(`${meta.icon} ${meta.name}历史`, node);
  let shown = 60;

  const paint = () => {
    const sorted = Store.vitalsSorted(kind);
    if (!sorted.length) {
      node.innerHTML = '<div class="empty-tip">没有记录了</div>';
      return;
    }
    const recent = sorted.slice(-30);
    const all = [...sorted].reverse();
    const rows = all.slice(0, shown).map(v => {
      const [cls, txt] = vitalStatus(kind, v);
      return `
      <div class="rec-row">
        <button class="rec-open" id="vital-row-${esc(v.id)}" data-vital="${esc(v.id)}">
          <span class="rec-dot ${cls}"></span>
          <span class="rec-date">${esc(v.date)}<br>${esc(v.time || '')}</span>
          <span class="rec-val">${VITAL_FMT[kind](v)}${txt ? `<br><span class="rec-note ${cls}">${txt}</span>` : ''}</span>
          <span class="dg-arrow" aria-hidden="true">›</span>
        </button>
        <button class="rec-del" data-del="${esc(v.id)}" aria-label="删除这条记录">🗑</button>
      </div>`;
    }).join('');
    const remain = Math.max(0, all.length - shown);

    node.innerHTML = `
    ${recent.length >= 2 ? `
    <div class="card">
      <div class="card-title">📈 趋势（近 ${recent.length} 条）</div>
      ${chartSummaryHTML(kind, recent)}
      <div class="chart-box"><canvas id="vh-chart"></canvas></div>
      ${chartLegendHTML(kind)}
    </div>` : ''}
    <div class="card">
      <div class="card-title">📄 全部记录（${sorted.length} 条）</div>
      <div class="rec-list">${rows}</div>
      ${remain ? `<button class="btn ghost block" id="rec-more" style="margin-top:0.6rem">显示更早的记录（还有 ${remain} 条）</button>` : ''}
    </div>`;

    node.querySelectorAll('[data-vital]').forEach(b => b.onclick = () => openVitalEdit(kind, b.dataset.vital));
    node.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      const v = Store.vitalsSorted(kind).find(x => x.id === b.dataset.del);
      const plain = !v ? '' : kind === 'bp' ? `${v.sys}/${v.dia} mmHg`
        : kind === 'glucose' ? `${v.value} mmol/L ${v.gtype}` : `${v.value} 公斤`;
      confirmInPlace(b.closest('.rec-row'), {
        message: `删除这条记录（${v ? v.date + (v.time ? ' ' + v.time : '') + ' · ' + plain : ''}）？删除后无法恢复。`,
        confirmLabel: '删除',
        cancelLabel: '不删了',
        onConfirm: () => {
          if (!stored(Store.removeVital(kind, b.dataset.del))) return false;
          paint();
          render('records', { keepScroll: true, preserveInputs: true });
        },
      });
    });
    const moreBtn = node.querySelector('#rec-more');
    if (moreBtn) moreBtn.onclick = () => { shown += 60; paint(); };
    drawVitalChart(kind, node.querySelector('#vh-chart'), recent);
  };
  paint();
  close.onResume(paint);
}

/* 修改一条记录（子弹窗）：预填数值与日期时间，max=今天；保存/删除后刷新背后页。 */
function openVitalEdit(kind, id) {
  const v = Store.data.vitals[kind].find(x => x.id === id);
  if (!v) return;
  const meta = REC_KINDS[kind];
  const hasTime = kind !== 'weight';
  let fields;
  if (kind === 'bp') {
    fields = `
      <div class="form-row">
        <div class="field"><label for="ev-sys">高压<span class="label-opt">（收缩压）</span></label><input id="ev-sys" type="number" inputmode="numeric" value="${esc(v.sys)}"></div>
        <div class="field"><label for="ev-dia">低压<span class="label-opt">（舒张压）</span></label><input id="ev-dia" type="number" inputmode="numeric" value="${esc(v.dia)}"></div>
      </div>
      <div class="form-inline">
        <label class="fi-label" for="ev-pulse">脉搏<span class="label-opt">（选填）</span></label>
        <input id="ev-pulse" type="number" inputmode="numeric" value="${esc(v.pulse || '')}">
      </div>`;
  } else if (kind === 'glucose') {
    fields = `
      <div class="form-row">
        <div class="field"><label for="ev-type">测量类型</label>
          <select id="ev-type">${['空腹', '餐后2小时', '随机'].map(o => `<option ${o === v.gtype ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
        <div class="field"><label for="ev-val">数值 mmol/L</label><input id="ev-val" type="number" step="0.1" inputmode="decimal" value="${esc(v.value)}"></div>
      </div>`;
  } else {
    fields = `<div class="form-row"><div class="field"><label for="ev-val">体重（公斤）</label><input id="ev-val" type="number" step="0.1" inputmode="decimal" value="${esc(v.value)}"></div></div>`;
  }
  const node = nodeFromHTML(`
    <div class="vital-form">
      ${fields}
      <div class="form-row">
        <div class="field wide"><label for="ev-date">日期</label><input id="ev-date" type="date" value="${esc(v.date)}" max="${Store.today()}"></div>
        ${hasTime ? `<div class="field wide"><label for="ev-time">时间</label><input id="ev-time" type="time" value="${esc(v.time || '')}"></div>` : ''}
      </div>
      <button class="btn block" id="ev-save">保存修改</button>
      <button class="btn red block" id="ev-del" style="margin-top:0.6rem">删除这条记录</button>
    </div>`);
  const close = openModal(`修改${meta.name}记录`, node);
  const flowIds = kind === 'bp' ? ['ev-sys', 'ev-dia', 'ev-pulse'] : ['ev-val'];
  bindEnterFlow(flowIds.map(i => node.querySelector('#' + i)), () => node.querySelector('#ev-save').click());
  node.querySelector('#ev-save').onclick = () => {
    clearFieldErrors(node);
    const when = { date: node.querySelector('#ev-date').value, time: hasTime ? node.querySelector('#ev-time').value : '' };
    const entry = readVital(kind, 'ev', when);
    if (!entry) return;
    if (!stored(Store.updateVital(kind, id, entry))) return;
    close();
    toast('已保存修改');
    render('records', { keepScroll: true, preserveInputs: true });
  };
  node.querySelector('#ev-del').onclick = () => {
    confirmInPlace(node.querySelector('#ev-del'), {
      message: '删除后无法恢复。确定删除这条记录吗？',
      confirmLabel: '删除',
      cancelLabel: '不删了',
      onConfirm: () => {
        if (!stored(Store.removeVital(kind, id))) return false;
        close();
        toast('已删除');
        render('records', { keepScroll: true, preserveInputs: true });
      },
    });
  };
}

function renderRecords() {
  let html = `
  ${pageHeading('健康记录', '记录测量结果，复诊时方便核对。')}
  <div class="rec-tabs" role="group" aria-label="记录类型">
    ${Object.entries(REC_KINDS).map(([k, v]) =>
      `<button class="rec-tab ${recTab === k ? 'active' : ''}" aria-pressed="${recTab === k}" aria-controls="rec-body" data-rectab="${k}">${v.name}</button>`).join('')}
  </div>
  <div id="rec-body"></div>
  <button class="btn ghost block" id="btn-export" style="margin-top:0.2rem">📤 导出记录给医生看</button>
  <div class="disclaimer">浅绿为目标区（遵医嘱，可在设置里调整）；140/90 为一般提示线。指南建议多数患者在能耐受时降至 130/80 以下（部分情况例外），你的控制目标以医生要求为准。</div>`;
  $view().innerHTML = html;

  $view().querySelectorAll('[data-rectab]').forEach(b => b.onclick = () => {
    if (recTab === b.dataset.rectab) return;
    captureRecordDraft();
    recTab = b.dataset.rectab;
    render('records', { keepScroll: true });
    $view().querySelector(`[data-rectab="${recTab}"]`).focus({ preventScroll: true });
  });
  document.getElementById('btn-export').onclick = openExport;

  const body = document.getElementById('rec-body');
  if (recTab === 'bp') renderBP(body);
  else if (recTab === 'glucose') renderGlucose(body);
  else renderWeight(body);
  restoreRecordDraft();
  const form = body.querySelector('.vital-form');
  const status = document.createElement('p');
  status.className = 'form-status';
  status.setAttribute('role', 'status');
  form.appendChild(status);
  const markDraft = () => {
    form.dataset.dirty = 'true';
    status.className = 'form-status';
    status.textContent = '尚未保存，填写后请点保存。';
    if (recordSaved && recordSaved.kind === recTab) recordSaved = null;
  };
  form.addEventListener('input', markDraft);
  form.addEventListener('change', markDraft);
  if (recordDrafts[recTab]) markDraft();
  else if (recordSaved && recordSaved.kind === recTab) {
    status.classList.add('saved');
    status.textContent = recordSaved.message;
  } else status.textContent = '填好后请点保存，记录仅保存在本机。';
}

function captureRecordDraft() {
  const body = document.getElementById('rec-body');
  if (!body) return;
  const form = body.querySelector('.vital-form');
  const typed = [...form.querySelectorAll('input[type="number"]')].some(el => el.value !== '');
  if (!typed && !form.dataset.dirty) return;
  recordDrafts[recTab] = {
    values: [...form.querySelectorAll('input[id], select[id]')].map(el => [el.id, el.value]),
    expanded: !form.querySelector('.dt-row').hidden,
    touched: form.querySelector('.dt-row').dataset.touched === 'true',
  };
}
function restoreRecordDraft() {
  const draft = recordDrafts[recTab];
  if (!draft) return;
  draft.values.forEach(([id, value]) => { const el = document.getElementById(id); if (el) el.value = value; });
  const prefix = { bp: 'bp', glucose: 'glu', weight: 'wt' }[recTab];
  const row = document.getElementById(prefix + '-dt-row');
  row.hidden = !draft.expanded;
  if (draft.touched) row.dataset.touched = 'true';
  bindWhenToggle(prefix);
}
function recordSaveDone(message) {
  delete recordDrafts[recTab];
  recordSaved = { kind: recTab, message };
  render('records', { keepScroll: true });
  const status = document.querySelector('.form-status');
  status.tabIndex = -1;
  status.focus({ preventScroll: true });
  toast('记录已保存');
}
function clearRecordSession() {
  Object.keys(recordDrafts).forEach(key => delete recordDrafts[key]);
  recordSaved = null;
}

function formDefaults() {
  return { d: Store.today(), t: Store.timeStr() };
}

/* 日期时间的口语化短显示：绝大多数记录就是"刚刚"，低频修改不值得占一级大字段 */
function fmtWhen(date, time) {
  if (!date) return '请选择日期';
  const today = Store.today();
  const head = date === today ? '今天'
    : date === Store.addDays(today, -1) ? '昨天'
      : `${+date.slice(5, 7)}-${+date.slice(8, 10)}`;
  return time ? `${head} ${time}` : head;
}

/* 「记录时间」收敛成一个小条：未改过时显“现在 · 修改”（体重“今天 · 修改”），
   改过显 fmtWhen(...)。未改过 → 保存时取此刻（whenOf）；日期/时间 change 置 touched，日期 max=今天。 */
function bindWhenToggle(prefix) {
  const row = document.getElementById(prefix + '-dt-row');
  const chip = document.getElementById(prefix + '-dt-chip');
  if (!row || !chip) return;
  const dateEl = document.getElementById(prefix + '-date');
  const timeEl = document.getElementById(prefix + '-time');
  const isWeight = prefix === 'wt';
  const fmt = () => {
    chip.textContent = (row.dataset.touched === 'true'
      ? fmtWhen(dateEl.value, timeEl ? timeEl.value : '')
      : (isWeight ? '今天' : '现在')) + ' · 修改';
  };
  dateEl.max = Store.today();
  chip.setAttribute('aria-controls', row.id);
  chip.setAttribute('aria-expanded', String(!row.hidden));
  chip.onclick = () => {
    row.hidden = !row.hidden;
    chip.setAttribute('aria-expanded', String(!row.hidden));
    if (!row.hidden && row.dataset.touched !== 'true') {
      dateEl.value = Store.today();
      if (timeEl) timeEl.value = Store.timeStr();
    }
    dateEl.max = Store.today();
  };
  const touch = () => { row.dataset.touched = 'true'; fmt(); };
  dateEl.onchange = touch;
  if (timeEl) timeEl.onchange = touch;
  fmt();
}
/* 未改过返回此刻；改过返回输入值。体重无时间输入，time 为 ''。 */
function whenOf(prefix) {
  const row = document.getElementById(prefix + '-dt-row');
  const dateEl = document.getElementById(prefix + '-date');
  const timeEl = document.getElementById(prefix + '-time');
  if (!row || row.dataset.touched !== 'true') {
    return { date: Store.today(), time: timeEl ? Store.timeStr() : '' };
  }
  return { date: dateEl.value, time: timeEl ? timeEl.value : '' };
}
/* 共享校验：页面三表单与修改弹窗共用。通过返回干净 entry，失败 fieldError 并返回 null。 */
function readVital(kind, prefix, when) {
  const id = suf => prefix + '-' + suf;
  const val = suf => document.getElementById(id(suf));
  if (!when.date) { fieldError(id('date'), '请选择这次测量的日期。'); return null; }
  if (when.date > Store.today()) { fieldError(id('date'), '日期不能晚于今天，请核对这次测量的日期。'); return null; }
  if (kind === 'bp') {
    const sys = +val('sys').value, dia = +val('dia').value, pulse = val('pulse').value;
    if (!sys || sys < 50 || sys > 300) { fieldError(id('sys'), '请核对血压计上的高压读数，再填写高压。'); return null; }
    if (!dia || dia < 30 || dia > 200) { fieldError(id('dia'), '请核对血压计上的低压读数，再填写低压。'); return null; }
    /* 高压一定比低压高：反过来几乎都是两格填反了，存进去会被判成"偏低" */
    if (sys <= dia) { fieldError(id('dia'), '低压应该比高压低，请核对是不是两格填反了。'); return null; }
    if (pulse && !(+pulse > 0 && +pulse <= 400)) { fieldError(id('pulse'), '请核对脉搏读数，不记录时可以留空。'); return null; }
    return { date: when.date, time: when.time, sys, dia, pulse: pulse ? +pulse : '' };
  }
  if (kind === 'glucose') {
    const gtype = val('type').value;
    const value = +val('val').value;
    if (!value || value < 1 || value > 40) { fieldError(id('val'), '请核对血糖读数，按 mmol/L 填写。'); return null; }
    return { date: when.date, time: when.time, gtype, value };
  }
  const value = +val('val').value;
  if (!value || value < 20 || value > 300) { fieldError(id('val'), '请核对体重读数，以公斤填写。'); return null; }
  return { date: when.date, value };
}

function renderBP(body) {
  const { d, t } = formDefaults();
  const sorted = Store.vitalsSorted('bp');
  const latest = sorted[sorted.length - 1];
  let latestHTML = '<div class="empty-tip">还没有血压记录，从今天开始吧</div>';
  if (latest) {
    const [cls, txt] = bpBadge(+latest.sys, +latest.dia);
    latestHTML = `
    <div class="latest-value">
      <span class="big">${esc(latest.sys)}/${esc(latest.dia)}</span><span class="muted">mmHg</span>
      <span class="badge ${cls}">${txt}</span>
    </div>
    ${deltaLineHTML('bp')}
    <div class="muted">最近记录：${esc(latest.date)} ${esc(latest.time || '')}${latest.pulse ? ' · 脉搏 ' + esc(latest.pulse) + ' 次/分' : ''}</div>`;
  }

  body.innerHTML = `
  <div class="card">
    <h2 class="card-title">记一次血压</h2>
    <div class="vital-form">
      <div class="form-row">
        <div class="field"><label for="bp-sys">高压<span class="label-opt">（收缩压）</span></label><input id="bp-sys" type="number" inputmode="numeric" placeholder="如 135"></div>
        <div class="field"><label for="bp-dia">低压<span class="label-opt">（舒张压）</span></label><input id="bp-dia" type="number" inputmode="numeric" placeholder="如 85"></div>
      </div>
      <div class="form-inline">
        <label class="fi-label" for="bp-pulse">脉搏<span class="label-opt">（选填）</span></label>
        <input id="bp-pulse" type="number" inputmode="numeric" placeholder="次/分">
      </div>
      <div class="form-inline">
        <span class="fi-label">记录时间</span>
        <button type="button" class="dt-chip" id="bp-dt-chip"></button>
      </div>
      <div class="form-row dt-row" id="bp-dt-row" hidden>
        <div class="field wide"><label for="bp-date">日期</label><input id="bp-date" type="date" value="${d}" max="${d}"></div>
        <div class="field wide"><label for="bp-time">时间</label><input id="bp-time" type="time" value="${t}"></div>
      </div>
      <button class="btn block" id="bp-save">保存血压记录</button>
    </div>
  </div>
  <div class="card">
    <h2 class="card-title">最近血压</h2>
    ${latestHTML}
    ${sorted.length >= 2 ? `${chartSummaryHTML('bp', sorted.slice(-14))}<div class="chart-box"><canvas id="bp-chart"></canvas></div>${chartLegendHTML('bp')}` : ''}
    ${histBtnHTML('bp', sorted.length)}
  </div>`;

  bindWhenToggle('bp');
  const bpSave = () => {
    clearFieldErrors(body);
    const entry = readVital('bp', 'bp', whenOf('bp'));
    if (!entry) return;
    if (!stored(Store.addVital('bp', entry))) return;
    const [cls, txt] = bpBadge(entry.sys, entry.dia);
    recordSaveDone(`✓ 已保存血压 ${entry.sys}/${entry.dia} mmHg · ${fmtWhen(entry.date, entry.time)}${cls === 'bad' ? '。' + txt : ''}`);
  };
  bindEnterFlow(['bp-sys', 'bp-dia', 'bp-pulse'].map(i => document.getElementById(i)), bpSave);
  document.getElementById('bp-save').onclick = bpSave;
  bindHist(body);
  drawVitalChart('bp', document.getElementById('bp-chart'), sorted.slice(-14));
}

function renderGlucose(body) {
  const { d, t } = formDefaults();
  const sorted = Store.vitalsSorted('glucose');
  const latest = sorted[sorted.length - 1];
  let latestHTML = '<div class="empty-tip">还没有血糖记录（没有糖尿病也可偶尔测测）</div>';
  if (latest) {
    const [cls, txt] = gluBadge(latest.gtype, +latest.value);
    latestHTML = `
    <div class="latest-value">
      <span class="big">${esc(latest.value)}</span><span class="muted">mmol/L（${esc(latest.gtype)}）</span>
      <span class="badge ${cls}">${txt}</span>
    </div>
    ${deltaLineHTML('glucose')}
    <div class="muted">最近记录：${esc(latest.date)} ${esc(latest.time || '')}</div>`;
  }

  body.innerHTML = `
  <div class="card">
    <h2 class="card-title">记一次血糖</h2>
    <div class="vital-form">
      <div class="form-row">
        <div class="field"><label for="glu-type">测量类型</label>
          <select id="glu-type"><option>空腹</option><option>餐后2小时</option><option>随机</option></select>
        </div>
        <div class="field"><label for="glu-val">数值 mmol/L</label><input id="glu-val" type="number" step="0.1" inputmode="decimal" placeholder="如 6.2"></div>
      </div>
      <div class="form-inline">
        <span class="fi-label">记录时间</span>
        <button type="button" class="dt-chip" id="glu-dt-chip"></button>
      </div>
      <div class="form-row dt-row" id="glu-dt-row" hidden>
        <div class="field wide"><label for="glu-date">日期</label><input id="glu-date" type="date" value="${d}" max="${d}"></div>
        <div class="field wide"><label for="glu-time">时间</label><input id="glu-time" type="time" value="${t}"></div>
      </div>
      <button class="btn block" id="glu-save">保存血糖记录</button>
    </div>
  </div>
  <div class="card">
    <h2 class="card-title">最近血糖</h2>
    ${latestHTML}
    ${sorted.length >= 2 ? `${chartSummaryHTML('glucose', sorted.slice(-14))}<div class="chart-box"><canvas id="glu-chart"></canvas></div>${chartLegendHTML('glucose')}` : ''}
    ${histBtnHTML('glucose', sorted.length)}
  </div>`;

  bindWhenToggle('glu');
  const gluSave = () => {
    clearFieldErrors(body);
    const entry = readVital('glucose', 'glu', whenOf('glu'));
    if (!entry) return;
    if (!stored(Store.addVital('glucose', entry))) return;
    recordSaveDone(`✓ 已保存${entry.gtype}血糖 ${entry.value} mmol/L · ${fmtWhen(entry.date, entry.time)}`);
  };
  bindEnterFlow([document.getElementById('glu-val')], gluSave);
  document.getElementById('glu-save').onclick = gluSave;
  bindHist(body);
  drawVitalChart('glucose', document.getElementById('glu-chart'), sorted.slice(-14));
}

function renderWeight(body) {
  const { d } = formDefaults();
  const sorted = Store.vitalsSorted('weight');
  const latest = sorted[sorted.length - 1];
  const height = +Store.data.profile.height;
  let latestHTML = '<div class="empty-tip">还没有体重记录，每周记 1～2 次就够了</div>';
  if (latest) {
    let bmiHTML = '';
    if (height) {
      const bmi = +latest.value / Math.pow(height / 100, 2);
      const [cls, txt] = bmiBadge(bmi);
      /* 先给结论"体重适中"，BMI 数字放括号里降为参考 */
      bmiHTML = `<span class="badge ${cls}">${txt}（BMI ${bmi.toFixed(1)}）</span>`;
    } else {
      bmiHTML = '<span class="muted">在「设置」里填身高，就能帮您算胖瘦</span>';
    }
    latestHTML = `
    <div class="latest-value">
      <span class="big">${esc(latest.value)}</span><span class="muted">公斤</span>
      ${bmiHTML}
    </div>
    ${deltaLineHTML('weight')}
    <div class="muted">最近记录：${esc(latest.date)}</div>`;
  }

  body.innerHTML = `
  <div class="card">
    <h2 class="card-title">记一次体重</h2>
    <div class="vital-form">
      <div class="form-row">
        <div class="field"><label for="wt-val">体重（公斤）</label><input id="wt-val" type="number" step="0.1" inputmode="decimal" placeholder="如 62.5"></div>
      </div>
      <div class="form-inline">
        <span class="fi-label">记录日期</span>
        <button type="button" class="dt-chip" id="wt-dt-chip"></button>
      </div>
      <div class="form-row dt-row" id="wt-dt-row" hidden>
        <div class="field wide"><label for="wt-date">日期</label><input id="wt-date" type="date" value="${d}" max="${d}"></div>
      </div>
      <button class="btn block" id="wt-save">保存体重记录</button>
    </div>
  </div>
  <div class="card">
    <h2 class="card-title">最近体重</h2>
    ${latestHTML}
    ${sorted.length >= 2 ? `${chartSummaryHTML('weight', sorted.slice(-14))}<div class="chart-box"><canvas id="wt-chart"></canvas></div>${chartLegendHTML('weight')}` : ''}
    ${histBtnHTML('weight', sorted.length)}
  </div>`;

  bindWhenToggle('wt');
  const wtSave = () => {
    clearFieldErrors(body);
    const entry = readVital('weight', 'wt', whenOf('wt'));
    if (!entry) return;
    if (!stored(Store.addVital('weight', entry))) return;
    recordSaveDone(`✓ 已保存体重 ${entry.value} 公斤 · ${fmtWhen(entry.date)}`);
  };
  bindEnterFlow([document.getElementById('wt-val')], wtSave);
  document.getElementById('wt-save').onclick = wtSave;
  bindHist(body);
  drawVitalChart('weight', document.getElementById('wt-chart'), sorted.slice(-14));
}

function openExport() {
  const text = Store.exportReport();
  const node = nodeFromHTML(`
    <p class="muted" style="margin-bottom:0.5rem">复诊时把这份记录给医生看，或复制后发给家人打印。</p>
    <textarea id="export-text" style="width:100%;height:45vh;border:1.5px solid var(--border);border-radius:12px;padding:0.7rem;font-size:0.9rem;line-height:1.5" readonly></textarea>
    <button class="btn block" id="copy-export" style="margin-top:0.7rem">📋 复制全部内容</button>`);
  node.querySelector('#export-text').value = text;
  openModal('导出健康记录', node);
  node.querySelector('#copy-export').onclick = async () => {
    const ta = node.querySelector('#export-text');
    try {
      await navigator.clipboard.writeText(ta.value);
      toast('已复制，可粘贴到微信发给家人');
    } catch (e) {
      ta.focus(); ta.select();
      document.execCommand && document.execCommand('copy');
      toast('已选中内容，长按可复制');
    }
  };
}
