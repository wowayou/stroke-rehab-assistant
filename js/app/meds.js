/* ============================================================
   用药页：今日核对表 → 近 7 天 → 药物清单（在吃/停用）→ 服药历史 → 登记/停用/新疗程表单
   服药计数只走 Store.medsOn/medCountOn（硬约定 8）；统计只算已到点的（硬约定 15）。
   ============================================================ */

/* ============================================================
   【区】用药页：核对表 → 药物清单 → 服药历史 → 登记/停用/新疗程表单
   ============================================================ */
function renderMeds() {
  const meds = Store.data.meds;
  const ad = Store.adherence7d();

  /* 按时间分组的今日核对表：只列**今天在吃**的药（已停用的不出现在核对表里，
     否则会天天显示"漏服"，冤枉患者） */
  const todayMeds = Store.medsOn();
  const slots = {};
  todayMeds.forEach(m => (m.times || []).forEach(t => {
    if (!slots[t]) slots[t] = [];
    slots[t].push(m);
  }));
  const times = Object.keys(slots).sort();

  let checkHTML;
  if (!meds.length) {
    checkHTML = '<div class="empty-tip">还没有登记药物。<br>请按医生处方，点下方按钮添加。</div>';
  } else if (!todayMeds.length) {
    checkHTML = '<div class="empty-tip">今天没有需要核对的药。<br>（清单里的药都已停用，或还没到开始服用的日期）</div>';
  } else {
    checkHTML = times.map(t => `
      <div class="med-time-group">
        <div class="med-time-label">🕐 ${esc(t)}</div>
        ${slots[t].map(m => {
          const taken = Store.isMedTaken(m.id, t);
          return `
          <div class="med-check ${taken ? 'checked' : ''}" data-med="${esc(m.id)}" data-time="${esc(t)}" role="checkbox" aria-checked="${taken}" tabindex="0">
            <div class="mc-box">${taken ? '✓' : ''}</div>
            <div>
              <div class="mc-name">${esc(m.name)}</div>
              <div class="mc-dose">${esc(m.dose || '')}${m.note ? ' · ' + esc(m.note) : ''}</div>
            </div>
          </div>`;
        }).join('')}
      </div>`).join('');
  }

  /* 今日核对：把"还差几次"说在最前面，患者不用去数勾了几个 */
  const mp = Store.medProgressToday();
  const todayLine = mp.total
    ? (mp.done >= mp.total
      ? `<div class="today-summary">今天该吃的 ${mp.total} 次都核对完了 ✓</div>`
      : `<div class="today-summary">今天一共 ${mp.total} 次，${leftText(mp.done, mp.total, '次还没核对')}${dotsHTML(mp.done, mp.total)}</div>`)
    : '';

  /* 近 7 天：主指标改成"几天全吃到"（整数天数，好懂），百分比降为给医生看的次要信息。
     医学内容不删：依从性与复发风险的科普保留，但从"指责漏服"改成中性知识 + 可执行的办法。 */
  const fd = Store.medFullDays(7);
  let adBody = '';
  if (fd.days) {
    if (fd.full >= fd.days) {
      adBody = `<div class="ad-main">最近 ${fd.days} 天，每天该吃的都核对到了</div>
        <div class="muted">这件事做得很到位，继续保持就好。</div>`;
    } else if (fd.full > 0) {
      adBody = `<div class="ad-main">最近 ${fd.days} 天里，有 <b>${fd.full}</b> 天全都吃到了</div>
        <div class="muted">已经记住大部分了。剩下容易忘的那几次，可以试试：手机设闹钟、把药盒放在饭桌上、或让家人在服药时间提一句。</div>`;
    } else {
      adBody = `<div class="ad-main">最近这几天还没有哪天全部核对上</div>
        <div class="muted">忘吃药很常见，不是您的问题，多半是没有提醒。可以试试：手机设闹钟、把药盒放在饭桌上、请家人在服药时间提一句。吃完在这一页点一下就行。</div>`;
    }
  }

  let html = `
  ${pageHeading('用药核对', '按医生处方服药，吃完再做标记。')}
  <div class="card">
    <h2 class="card-title">今日服药核对 <span class="card-meta">吃完点一下</span></h2>
    ${todayLine}
    ${checkHTML}
  </div>
  ${ad !== null ? `
  <div class="card">
    <div class="card-title">📊 最近 7 天吃药情况</div>
    ${adBody}
    <div class="muted" style="margin-top:0.5rem">按次数算的完成率是 ${ad}%（这个数字是给医生看的）。坚持按医嘱服药，是预防再次中风最有效的一件事。</div>
    <button class="btn ghost block" id="btn-med-hist" style="margin-top:0.7rem">📄 查看服药历史（近14天）</button>
  </div>` : ''}
  ${medListHTML()}`;

  $view().innerHTML = html;

  $view().querySelectorAll('.med-check').forEach(elm => {
    const act = () => {
      /* 页面是昨天画的（开着过了零点），或别的页面刚改过记录：屏幕上的勾已经不是真相，
         点下去会记错。先换成最新的核对表让人重新看一眼，不替他做这一下。 */
      const newDay = Store.today() !== renderedDay;
      if (refreshIfStale()) {
        toast(newDay ? '已经是新的一天了，请按今天的核对表再点一次' : '记录刚在别的页面更新过，请看一眼再点');
        return;
      }
      if (!stored(Store.toggleMed(elm.dataset.med, elm.dataset.time))) return;
      render('meds', { keepScroll: true });
    };
    elm.onclick = act;
    elm.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } };
  });
  document.getElementById('btn-add-med').onclick = () => openMedForm();
  $view().querySelectorAll('[data-edit-med]').forEach(b => b.onclick = () => {
    const m = Store.data.meds.find(x => x.id === b.dataset.editMed);
    if (m) openMedForm(m);
  });
  const medHistBtn = document.getElementById('btn-med-hist');
  if (medHistBtn) medHistBtn.onclick = openMedHistory;
}

/* 药物清单：在吃的和已停用的分开列。
   停用的药**保留在清单里**（复诊要说清吃过什么），但灰显、不参与核对与依从率。 */
function medRowHTML(m, stopped) {
  const times = m.times || [];
  const period = stopped
    ? `${m.from ? esc(m.from) + ' ' : ''}至 ${esc(m.to)} 停用`
    : (m.from ? `${esc(m.from)} 开始` : '');
  return `
  <div class="med-item${stopped ? ' stopped' : ''}">
    <div class="mi-body">
      <div class="mi-name">${esc(m.name)}${stopped ? '<span class="badge info mi-tag">已停用</span>' : ''}</div>
      <div class="mi-sub">${esc(m.dose || '')} · 每日${times.length}次（${times.map(esc).join('、')}）${m.note ? ' · ' + esc(m.note) : ''}</div>
      ${period ? `<div class="mi-period">${period}</div>` : ''}
    </div>
    <button class="btn small outline" data-edit-med="${esc(m.id)}" aria-label="${stopped ? '查看' : '修改'}：${esc(m.name)}">${stopped ? '查看' : '修改'}</button>
  </div>`;
}
function medListHTML() {
  const active = Store.activeMeds();
  const stopped = Store.stoppedMeds();
  return `
  <div class="card">
    <h2 class="card-title">我的药物清单</h2>
    ${active.map(m => medRowHTML(m, false)).join('')}
    ${!active.length && !stopped.length ? '' : ''}
    <button class="btn ghost block" id="btn-add-med" style="margin-top:0.7rem">＋ 添加药物</button>
    <div class="muted" style="margin-top:0.5rem">请严格按医生处方登记。任何加药、减药、停药都要先问医生。</div>
  </div>
  ${stopped.length ? `
  <div class="card">
    <div class="card-title">📋 已停用的药 <span class="muted" style="font-weight:400">（留着给医生看）</span></div>
    ${stopped.map(m => medRowHTML(m, true)).join('')}
    <div class="muted" style="margin-top:0.5rem">停用的药不再出现在每日核对里，也不计入完成率，但记录保留下来——复诊时医生常会问"这个药吃到什么时候"。</div>
  </div>` : ''}`;
}

/* 服药历史：每天一行，一个圆点代表一次应服的药 */
function openMedHistory() {
  const now = new Date();
  const days = Store.medHistory(14, now);
  /* 只算已经到点的次数：今天晚上那次还没到时间，不能算成"差 1 次" */
  const sum = days.reduce((a, d) => ({ total: a.total + d.dueTotal, done: a.done + d.dueDone }), { total: 0, done: 0 });
  const pct = sum.total ? Math.round(sum.done / sum.total * 100) : 0;
  const t = Store.today();
  const hasPending = days.some(d => d.items.some(i => !i.due));

  const dayScore = d => {
    if (!d.total) return '—';
    if (d.dueDone < d.dueTotal) return `差 ${d.dueTotal - d.dueDone} 次`;
    if (d.dueTotal < d.total) return d.dueTotal ? '到点的都吃了' : '还没到时间';
    return '全吃到';
  };
  const rows = days.map(d => `
    <div class="day-row">
      <span class="day-date">${esc(d.date.slice(5))}${d.date === t ? '（今天）' : ''}<br>${weekdayOf(d.date)}</span>
      <span class="dot-row">${d.items.map(i =>
        `<i class="dose-dot ${i.taken ? 'taken' : i.due ? '' : 'pending'}" aria-label="${esc(i.time)} ${esc(i.name)} ${i.taken ? '已服' : i.due ? '未记录' : '还没到时间'}"></i>`).join('')}</span>
      <span class="day-score ${d.total && d.dueDone >= d.dueTotal && d.dueTotal ? 'ok' : ''}">${dayScore(d)}</span>
    </div>`).join('');

  const fd14 = Store.medFullDays(14, now);
  const node = nodeFromHTML(`
    <div class="card">
      <div class="card-title">📊 最近 14 天</div>
      <div class="ad-main">有 <b>${fd14.full}</b> 天该吃的全都核对到了${fd14.days ? `（共 ${fd14.days} 天有记录）` : ''}</div>
      <div class="muted">按次数算：${sum.total} 次里核对了 ${sum.done} 次，完成率 ${pct}%（给医生看的数字）</div>
    </div>
    <div class="card">
      <div class="card-title">📄 每天核对情况</div>
      <div class="day-legend"><span><i class="dose-dot taken"></i>已核对</span><span><i class="dose-dot"></i>未记录</span>${hasPending ? '<span><i class="dose-dot pending"></i>还没到时间</span>' : ''}</div>
      ${rows}
    </div>
    <div class="disclaimer">停药和登记新疗程不会改动更早日期的次数；但如果改过同一种药的服药时间，更早的日期也会按新时间显示。还没到时间的那几次不算没吃。漏服记录仅供自我提醒，用药调整请遵医嘱。</div>`);
  openModal('服药历史', node);
}

const COMMON_TIMES = ['06:30', '07:30', '08:00', '11:30', '12:00', '17:30', '18:00', '20:00', '21:00'];
const COMMON_MEDS = ['阿司匹林肠溶片', '硫酸氢氯吡格雷片', '阿托伐他汀钙片', '瑞舒伐他汀钙片'];

function openMedForm(med, seed = null) {
  const isEdit = !!med;
  const stopped = isEdit && Store.isMedStopped(med);
  const formData = med || seed || {};
  const sel = new Set(Array.isArray(formData.times) && formData.times.length ? formData.times : ['08:00']);

  const node = nodeFromHTML(`
    <div class="vital-form">
      <div class="field" style="margin-bottom:0.7rem">
        <label for="med-name">药物名称（按处方填写）</label>
        <input id="med-name" type="text" placeholder="如 阿司匹林肠溶片" value="${esc(formData.name || '')}">
        <div class="time-chip-row" style="margin-top:0.4rem">
          ${COMMON_MEDS.map(n => `<button class="time-chip" data-preset="${esc(n)}" style="font-size:0.88rem">${esc(n)}</button>`).join('')}
        </div>
      </div>
      <div class="field" style="margin-bottom:0.7rem">
        <label for="med-dose">每次用量</label>
        <input id="med-dose" type="text" placeholder="如 100mg，1片" value="${esc(formData.dose || '')}">
      </div>
      <div class="field" style="margin-bottom:0.7rem">
        <label for="custom-time" id="med-time-label">每天服药时间（可多选）</label>
        <div class="time-chip-row" id="time-chips" role="group" aria-labelledby="med-time-label">
          ${COMMON_TIMES.map(t => `<button class="time-chip ${sel.has(t) ? 'active' : ''}" data-t="${t}" aria-pressed="${sel.has(t)}">${t}</button>`).join('')}
        </div>
        <div style="display:flex;gap:0.5rem;margin-top:0.5rem;align-items:center">
          <input id="custom-time" type="time" style="flex:1">
          <button class="btn small outline" id="add-custom-time">添加自定时间</button>
        </div>
        <div class="muted" style="margin-top:0.3rem">已选：<span id="sel-times">${[...sel].sort().join('、') || '无'}</span></div>
      </div>
      <div class="field" style="margin-bottom:0.7rem">
        <label for="med-note">备注（可不填）</label>
        <input id="med-note" type="text" placeholder="如 饭后服、别嚼碎" value="${esc(formData.note || '')}">
      </div>
      <div class="field" style="margin-bottom:0.9rem">
        <label for="med-from">从哪天开始吃</label>
        <input id="med-from" type="date" value="${esc(formData.from || Store.today())}">
        <div class="muted" style="margin-top:0.3rem">用来算完成率：开始之前的日子不会算你漏服。</div>
      </div>
      <button class="btn block" id="med-save">${isEdit ? '保存修改' : seed ? '登记新疗程' : '添加药物'}</button>
      ${isEdit && stopped ? `
      <div class="stop-box">
        <div class="sb-title">已停用：${esc(med.from || '')} 至 ${esc(med.to)}</div>
        <div class="muted">这个药已经不在每日核对里了，记录保留着给医生看。</div>
        ${Store.canUndoStop(med.id)
          ? '<button class="btn outline block" id="med-undo-stop" style="margin-top:0.6rem">停错了，撤销停用</button>'
          : '<div class="muted" style="margin-top:0.5rem">已经登记了后续新疗程，这段旧停药记录不能再撤销。</div>'}
        <button class="btn ghost block" id="med-new-course" style="margin-top:0.6rem">医生重新开了，登记新疗程</button>
      </div>` : ''}
      ${isEdit && !stopped ? `
      <div class="stop-box">
        <div class="sb-title">医生让停这个药了？</div>
        <div class="muted">选「已停用」——它会从每日核对里消失、不再算漏服，但记录留着（复诊时医生常问"吃到什么时候"）。<b>不要用删除</b>，删了历史里就查不到吃过这个药。</div>
        <div style="display:flex;gap:0.5rem;margin-top:0.5rem;align-items:center">
          <input id="med-stop-date" aria-label="最后服药日期" type="date" value="${Store.today()}" min="${esc(med.from || '')}" max="${Store.today()}" style="flex:1;min-height:54px;border:1.5px solid var(--border);border-radius:12px;padding:0 0.6rem;font-size:1.05rem">
          <button class="btn small outline" id="med-stop">吃到这天为止</button>
        </div>
      </div>` : ''}
      ${isEdit ? '<button class="btn red block" id="med-del" style="margin-top:0.6rem">删除（登记错了才用）</button>' : ''}
    </div>`);

  const close = openModal(isEdit ? '修改药物' : seed ? '登记新疗程' : '添加药物', node);

  const refreshSel = () => {
    node.querySelector('#sel-times').textContent = [...sel].sort().join('、') || '无';
    node.querySelectorAll('#time-chips .time-chip').forEach(c => {
      c.classList.toggle('active', sel.has(c.dataset.t));
      c.setAttribute('aria-pressed', String(sel.has(c.dataset.t)));
    });
  };
  node.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => {
    node.querySelector('#med-name').value = b.dataset.preset;
  });
  node.querySelectorAll('#time-chips .time-chip').forEach(c => c.onclick = () => {
    const t = c.dataset.t;
    if (sel.has(t)) sel.delete(t); else sel.add(t);
    refreshSel();
  });
  node.querySelector('#add-custom-time').onclick = () => {
    const v = node.querySelector('#custom-time').value;
    if (v) { sel.add(v); refreshSel(); }
  };
  node.querySelector('#med-save').onclick = () => {
    clearFieldErrors(node);
    const name = node.querySelector('#med-name').value.trim();
    const dose = node.querySelector('#med-dose').value.trim();
    const note = node.querySelector('#med-note').value.trim();
    if (!name) { fieldError('med-name', '请按医生处方填写药物名称。'); return; }
    if (!sel.size) { showError(node, '请至少选择一个服药时间'); return; }
    const from = node.querySelector('#med-from').value;
    if (!from) { showError(node, '请选择开始服用日期'); return; }
    if (seed && seed.from && from < seed.from) { showError(node, '新疗程不能早于上次停药后的第一天'); return; }
    const payload = { name, dose, note, times: [...sel].sort(), from, previousCourseId: seed ? seed.previousCourseId || '' : formData.previousCourseId || '' };
    const ok = isEdit ? Store.updateMed(med.id, payload) : Store.addMed(payload);
    if (!stored(ok)) return;
    close();
    toast(isEdit ? '已保存修改' : seed ? '已登记新疗程' : '已添加药物');
    render('meds', { keepScroll: true });
  };
  const stopBtn = node.querySelector('#med-stop');
  if (stopBtn) stopBtn.onclick = () => {
    const d = node.querySelector('#med-stop-date').value || Store.today();
    if (d > Store.today()) { showError(node, '停用日期不能晚于今天'); return; }
    if (med.from && d < med.from) { showError(node, '停用日期不能早于开始服用日期'); return; }
    if (!stored(Store.stopMed(med.id, d))) return;
    close();
    toast(`已记为停用（吃到 ${d}）`);
    render('meds', { keepScroll: true });
  };
  const undoStopBtn = node.querySelector('#med-undo-stop');
  if (undoStopBtn) undoStopBtn.onclick = () => {
    if (!stored(Store.undoStopMed(med.id))) return;
    close();
    toast('已撤销停用，重新进入每日核对');
    render('meds', { keepScroll: true });
  };
  const newCourseBtn = node.querySelector('#med-new-course');
  if (newCourseBtn) newCourseBtn.onclick = () => {
    const nextDay = med.to && med.to >= Store.today() ? Store.addDays(med.to, 1) : Store.today();
    const seedData = { name: med.name, dose: med.dose, times: med.times, note: med.note, from: nextDay, previousCourseId: med.id };
    close.replace(() => openMedForm(null, seedData));
  };
  if (isEdit) node.querySelector('#med-del').onclick = () => {
    /* 删除 vs 停用：明确告诉用户区别，避免为了"停药"而删掉历史 */
    if (confirm(`确定删除「${med.name}」？\n\n删除会连历史记录一起消失。\n如果是遵医嘱停药，请用「吃到这天为止」，不要删除。`)) {
      if (!stored(Store.removeMed(med.id))) return;
      close();
      toast('已删除');
      render('meds', { keepScroll: true });
    }
  };
}
