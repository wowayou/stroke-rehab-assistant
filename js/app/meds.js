/* ============================================================
   用药页：今日核对表 → 近 7 天 → 药物清单（在吃/停用）→ 服药历史·补记（openMedDay）→ 登记/停用/新疗程表单
   服药计数只走 Store.medsOn/timesOn（硬约定 8：登记日、按版本的服药时间、今天全核对才计入）。
   ============================================================ */

/* ============================================================
   【区】用药页：核对表 → 药物清单 → 服药历史 → 登记/停用/新疗程表单
   ============================================================ */

/* 服药核对清单（今日核对与补记子弹窗共用）：按时间分组，行结构沿用 .med-check。
   items 来自 Store.medStatusOn(date).items（含 medId/name/dose/note/time/taken）。 */
function medCheckListHTML(items) {
  const slots = {};
  items.forEach(it => { (slots[it.time] = slots[it.time] || []).push(it); });
  return Object.keys(slots).sort().map(tm => `
    <div class="med-time-group">
      <div class="med-time-label">🕐 ${esc(tm)}</div>
      ${slots[tm].map(it => `
      <div class="med-check ${it.taken ? 'checked' : ''}" data-med="${esc(it.medId)}" data-time="${esc(it.time)}" role="checkbox" aria-checked="${it.taken}" tabindex="0">
        <div class="mc-box">${it.taken ? '✓' : ''}</div>
        <div>
          <div class="mc-name">${esc(it.name)}</div>
          <div class="mc-dose">${esc(it.dose || '')}${it.note ? ' · ' + esc(it.note) : ''}</div>
        </div>
      </div>`).join('')}
    </div>`).join('');
}
/* 绑定核对行：Enter/空格可操作；成功后 tick() 再 after(el)。date 决定操作哪一天。 */
function bindMedChecks(root, date, after) {
  root.querySelectorAll('.med-check').forEach(elm => {
    const act = () => {
      /* 主页面的核对表是昨天画的（开着过了零点）或别的页面刚改过记录：屏幕上的勾已经不是真相，
         点下去会记到昨天（成了补记）或记错。先换成最新的核对表让人重新看一眼，不替他做这一下。 */
      if (root === $view()) {
        const newDay = Store.today() !== date;
        if (refreshIfStale()) {
          toast(newDay ? '已经是新的一天了，请按今天的核对表再点一次' : '记录刚在别的页面更新过，请看一眼再点');
          return;
        }
      }
      if (!stored(Store.toggleMed(elm.dataset.med, elm.dataset.time, date))) return;
      tick();
      after(elm);
    };
    elm.onclick = act;
    elm.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } };
  });
}

function renderMeds() {
  const meds = Store.data.meds;
  const ad = Store.adherence7d();
  const ad7 = Store.medAdherence(7);

  /* 按时间分组的今日核对表：只列**今天在吃**的药（已停用的不出现在核对表里，
     否则会天天显示"漏服"，冤枉患者） */
  const todayItems = Store.medStatusOn(Store.today()).items;

  let checkHTML;
  if (!meds.length) {
    checkHTML = '<div class="empty-tip">还没有登记药物。<br>请按医生处方，点下方按钮添加。</div>';
  } else if (!todayItems.length) {
    checkHTML = '<div class="empty-tip">今天没有需要核对的药。<br>（清单里的药都已停用，或还没到开始服用的日期）</div>';
  } else {
    checkHTML = medCheckListHTML(todayItems);
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
        <div class="muted">已经记住大部分了。剩下容易忘的那几次，可以试试：手机设闹钟、把药盒放在饭桌上、或让家人在服药时间提一句。吃了但忘了点的，可以在「服药历史 · 补记」里补上。</div>`;
    } else {
      adBody = `<div class="ad-main">最近这几天还没有哪天全部核对上</div>
        <div class="muted">忘吃药很常见，不是您的问题，多半是没有提醒。可以试试：手机设闹钟、把药盒放在饭桌上、请家人在服药时间提一句。吃了但忘了点的，可以在「服药历史 · 补记」里补上。</div>`;
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
    <div class="muted" style="margin-top:0.5rem">坚持按医嘱服药，是预防再次中风最有效的一件事。</div>
    <details class="disclosure" id="med7-doctor" style="margin-top:0.5rem">
      <summary><span><strong>给医生看的数字</strong><span class="disclosure-hint">按次数算的完成率</span></span><span class="disclosure-arrow" aria-hidden="true"></span></summary>
      <div class="muted" style="margin-top:0.4rem">按次数算的完成率是 ${ad}%${ad7 && ad7.late > 0 ? `，其中 ${ad7.late} 次为事后补记` : ''}。</div>
    </details>
    <button class="btn ghost block" id="btn-med-hist" style="margin-top:0.7rem">📄 服药历史 · 补记（近14天）</button>
  </div>` : ''}
  ${medListHTML()}`;

  $view().innerHTML = html;

  bindMedChecks($view(), Store.today(), () => render('meds', { keepScroll: true }));
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

/* 服药历史 · 补记：每天一行（今天在最上），点某天 → 补记子弹窗 */
function openMedHistory() {
  const node = document.createElement('div');
  const close = openModal('服药历史 · 补记', node);

  const paint = () => {
    const t = Store.today();   // 每次重画重新取：过了零点 onResume 重画时，昨天那行不能仍标“·今天”
    const days = Store.medHistory(14);   // 新→旧，今天在最上
    const fd14 = Store.medFullDays(14);
    const ad14 = Store.medAdherence(14);
    const rows = days.map(d => {
      const dots = d.items.map(i =>
        `<i class="dose-dot ${i.taken ? 'taken' : ''}" aria-hidden="true"></i>`).join('');
      const label = `${dayLabel(d.date)}${d.date === t ? '·今天' : ''}`;
      if (d.beforeTracking) {
        return `<div class="day-row">
          <span class="dg-top"><span class="day-date">${esc(label)}</span><span class="day-score muted">登记前</span></span>
        </div>`;
      }
      if (!d.total) {
        return `<div class="day-row">
          <span class="dg-top"><span class="day-date">${esc(label)}</span><span class="day-score">—</span></span>
        </div>`;
      }
      const done = d.done >= d.total, missing = d.total - d.done;
      const status = done ? '全吃到 ✓' : (d.date === t ? `还有 ${missing} 次` : `${missing} 次没记上`);
      return `<button type="button" class="day-row day-go" id="med-day-${esc(d.date)}" data-day="${esc(d.date)}" aria-label="${esc(label)} ${esc(status)}，点这里补记">
        <span class="dg-top">
          <span class="day-date">${esc(label)}</span>
          <span class="day-score ${done ? 'ok' : ''}">${esc(status)}</span>
          <span class="dg-arrow" aria-hidden="true">›</span>
        </span>
        <span class="dot-row">${dots}</span>
      </button>`;
    }).join('');

    node.innerHTML = `
      <div class="card">
        <div class="card-title">📊 最近 14 天</div>
        <div class="ad-main">有 <b>${fd14.full}</b> 天该吃的全都核对到了（共 ${fd14.days} 天）</div>
        ${ad14 ? `<details class="disclosure" style="margin-top:0.4rem">
          <summary><span><strong>给医生看的数字</strong><span class="disclosure-hint">按次数算的完成率</span></span><span class="disclosure-arrow" aria-hidden="true"></span></summary>
          <div class="muted" style="margin-top:0.4rem">按次数算：${ad14.total} 次里核对了 ${ad14.done} 次，完成率 ${ad14.pct}%${ad14.late > 0 ? `，其中 ${ad14.late} 次为事后补记` : ''}。</div>
        </details>` : ''}
      </div>
      <div class="card">
        <div class="card-title">📄 每天核对情况</div>
        <div class="day-legend"><span><i class="dose-dot taken"></i>已核对</span><span><i class="dose-dot"></i>未记录</span></div>
        <div class="muted" style="margin-bottom:0.4rem">吃了但当时忘了点的，点那一天补上。</div>
        ${rows}
      </div>
      <div class="disclaimer">从在这里登记那天起才计入，登记之前的日子不算漏服；今天的药吃完才算进来；改过服药时间的，之前的日子仍按当时的时间算。这些记录仅供自我提醒，用药调整请遵医嘱。</div>`;

    node.querySelectorAll('[data-day]').forEach(b => b.onclick = () => openMedDay(b.dataset.day));
  };

  paint();
  close.onResume(paint);
}

/* 补记某天（叠加子弹窗，父窗口保留）：核对行原位更新（焦点不丢），每次改动刷新背后页面。 */
function openMedDay(date) {
  const isToday = date === Store.today();
  const title = isToday ? '今天的服药核对' : `补记 ${dayLabel(date)}`;
  const hint = isToday ? '吃完点一下。' : '当时吃了、只是忘了点的，在这里补上；没吃的不用动。';
  const node = document.createElement('div');
  const items = Store.medStatusOn(date).items;
  const allDone = items.length > 0 && items.every(i => i.taken);
  node.innerHTML = `
    <p class="muted" style="margin-bottom:0.5rem">${esc(hint)}</p>
    <div class="med-day-list">${medCheckListHTML(items)}</div>
    <button class="btn ghost block" id="med-day-all" style="margin-top:0.6rem"${allDone ? ' hidden' : ''}>这天的都吃了</button>`;
  const close = openModal(title, node);
  /* 绑定到今天的核对弹窗：过夜到第二天再点，会记到已经过去的昨天且标题仍写“今天”。
     记下打开时的日期，跨天时由 refreshIfStale 关掉它，逼用户回到今天重开。 */
  if (isToday) topOverlay()._dayBound = date;
  const allBtn = node.querySelector('#med-day-all');
  bindMedChecks(node, date, elm => {
    const taken = Store.isMedTaken(elm.dataset.med, elm.dataset.time, date);
    elm.classList.toggle('checked', taken);
    elm.setAttribute('aria-checked', String(taken));
    elm.querySelector('.mc-box').textContent = taken ? '✓' : '';
    allBtn.hidden = Store.medStatusOn(date).items.every(i => i.taken);
    render(currentView, { keepScroll: true });
  });
  allBtn.onclick = () => {
    /* 记下本次将新勾上的键，供“撤销”只回退这几项（原已核对的保留） */
    const added = Store.medStatusOn(date).items.filter(i => !i.taken).map(i => ({ medId: i.medId, time: i.time }));
    if (!added.length) return;
    if (!stored(Store.checkAllMedsOn(date))) return;
    close();
    render(currentView, { keepScroll: true });
    toast(isToday ? '今天的都核对了' : `已补记 ${dayLabel(date).replace(/（.*）/, '')}`, {
      label: '撤销',
      onClick: () => {
        /* 一次性回退并写盘；写盘失败要提示（存储满时别悄悄只撤一半）。
           撤销时补记子弹窗已关，topOverlay 是「服药历史」弹窗，_onResume 让那一行文案
           也跟着更新——否则数据退回了、历史行还写着「全吃到 ✓」（AC4.3）。 */
        if (!stored(Store.uncheckMedsOn(date, added))) return;
        render(currentView, { keepScroll: true });
        const top = topOverlay();
        if (top && top._onResume) top._onResume();
      },
    });
  };
}

const COMMON_TIMES = ['06:30', '07:30', '08:00', '11:30', '12:00', '17:30', '18:00', '20:00', '21:00'];
const COMMON_MEDS = ['阿司匹林肠溶片', '硫酸氢氯吡格雷片', '阿托伐他汀钙片', '瑞舒伐他汀钙片'];

function openMedForm(med, seed = null) {
  const isEdit = !!med;
  const stopped = isEdit && Store.isMedStopped(med);
  const formData = med || seed || {};
  const sel = new Set(Array.isArray(formData.times) && formData.times.length ? formData.times : ['08:00']);
  /* 日期输入约束：已停用药 max=停用日；后续疗程 min=上次停药次日。 */
  const prevId = seed ? (seed.previousCourseId || '') : (formData.previousCourseId || '');
  const prevMed = prevId ? Store.data.meds.find(x => x.id === prevId) : null;
  const minFrom = prevMed && prevMed.to ? Store.addDays(prevMed.to, 1) : '';
  const maxFrom = stopped ? (med.to || '') : '';

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
        <div class="time-chip-row" id="time-chips" role="group" aria-labelledby="med-time-label"></div>
        <div style="display:flex;gap:0.5rem;margin-top:0.5rem;align-items:center">
          <input id="custom-time" type="time" style="flex:1">
          <button class="btn small outline" id="add-custom-time">添加自定时间</button>
        </div>
        <div class="muted" style="margin-top:0.3rem">已选：<span id="sel-times"></span>（点时间块可取消）</div>
      </div>
      <div class="field" style="margin-bottom:0.7rem">
        <label for="med-note">备注（可不填）</label>
        <input id="med-note" type="text" placeholder="如 饭后服、别嚼碎" value="${esc(formData.note || '')}">
      </div>
      <div class="field" style="margin-bottom:0.9rem">
        <label for="med-from">从哪天开始吃</label>
        <input id="med-from" type="date" value="${esc(formData.from || Store.today())}"${minFrom ? ` min="${esc(minFrom)}"` : ''}${maxFrom ? ` max="${esc(maxFrom)}"` : ''}>
        <div class="muted" style="margin-top:0.3rem">按处方填实际开始的日子，早于今天也可以。在这里登记之前的日子不算漏服，也不用补记。</div>
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

  const timeChips = node.querySelector('#time-chips');
  /* 时间块渲染 COMMON_TIMES ∩ 已选的全集，全部可点切换（非常用时间取消后消失） */
  const refreshChips = () => {
    node.querySelector('#sel-times').textContent = [...sel].sort().join('、') || '无';
    timeChips.innerHTML = [...new Set([...COMMON_TIMES, ...sel])].sort().map(tm =>
      `<button type="button" class="time-chip ${sel.has(tm) ? 'active' : ''}" data-t="${esc(tm)}" aria-pressed="${sel.has(tm)}">${esc(tm)}</button>`).join('');
    timeChips.querySelectorAll('.time-chip').forEach(c => c.onclick = () => {
      const tm = c.dataset.t;
      if (sel.has(tm)) sel.delete(tm); else sel.add(tm);
      refreshChips();
    });
  };
  refreshChips();
  node.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => {
    node.querySelector('#med-name').value = b.dataset.preset;
  });
  node.querySelector('#add-custom-time').onclick = () => {
    const v = node.querySelector('#custom-time').value;
    if (v) { sel.add(v); refreshChips(); }
  };
  bindEnterFlow(
    [node.querySelector('#med-name'), node.querySelector('#med-dose'), node.querySelector('#med-note')],
    () => node.querySelector('#med-note').blur());
  node.querySelector('#med-save').onclick = () => {
    clearFieldErrors(node);
    const name = node.querySelector('#med-name').value.trim();
    const dose = node.querySelector('#med-dose').value.trim();
    const note = node.querySelector('#med-note').value.trim();
    if (!name) { fieldError('med-name', '请按医生处方填写药物名称。'); return; }
    if (!sel.size) { showError(node, '请至少选择一个服药时间'); return; }
    const from = node.querySelector('#med-from').value;
    if (!from) { showError(node, '请选择开始服用日期'); return; }
    if (maxFrom && from > maxFrom) { showError(node, `开始日期不能晚于停用日期（${maxFrom}）`); return; }
    if (minFrom && from < minFrom) { showError(node, `新疗程要从上次停药（${prevMed.to}）之后开始`); return; }
    const payload = { name, dose, note, times: [...sel].sort(), from, previousCourseId: prevId };
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
    /* 删除 vs 停用：应用内两步确认，不用原生 confirm（微信里弹带网址的系统框） */
    confirmInPlace(node.querySelector('#med-del'), {
      message: '删除会连历史记录一起消失。如果是遵医嘱停药，请用上面的「吃到这天为止」，不要删除。',
      confirmLabel: '确定删除',
      cancelLabel: '不删了',
      onConfirm: () => {
        if (!stored(Store.removeMed(med.id))) return false;
        close();
        toast('已删除');
        render('meds', { keepScroll: true });
      },
    });
  };
}
