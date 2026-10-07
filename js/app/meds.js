/* ============================================================
   用药页：今日核对表 → 近 7 天 → 药物清单（在吃/停用）→ 服药历史·补记（openMedDay）→ 登记/停用/新疗程表单
   服药计数只走 Store.medsOn/timesOn（硬约定 8：登记日、按版本的服药时间、今天全核对才计入）。
   ============================================================ */

/* ============================================================
   【区】用药页：核对表 → 药物清单 → 服药历史 → 登记/停用/新疗程表单
   ============================================================ */

/* 服药核对清单：今日核对与补记子弹窗共用。实际时间放药名下，修改按钮与 checkbox 并列。
   过去没记过时间的只保留核对，不默认填入排定时间或当前时间。 */
function medCheckListHTML(items, date) {
  const isToday = date === Store.today();
  const slots = {};
  items.forEach(it => { (slots[it.time] = slots[it.time] || []).push(it); });
  return Object.keys(slots).sort().map(tm => `
    <div class="med-time-group">
      <div class="med-time-label">🕐 ${esc(tm)}</div>
      ${slots[tm].map(it => `
      <div class="med-line">
        <div class="med-check ${it.taken ? 'checked' : ''}" data-med="${esc(it.medId)}" data-time="${esc(it.time)}" role="checkbox" aria-checked="${it.taken}" tabindex="0">
          <div class="mc-box">${it.taken ? '✓' : ''}</div>
          <div class="mc-body">
            <div class="mc-name">${esc(it.name)}</div>
            <div class="mc-dose">${esc(it.dose || '')}${it.note ? ' · ' + esc(it.note) : ''}</div>
            ${it.taken && it.at ? `<div class="mc-taken-at">${esc(it.at)} 吃的</div>` : ''}
          </div>
        </div>
        ${it.taken && (it.at || isToday) ? `<button type="button" class="btn small ghost mc-at" data-at-med="${esc(it.medId)}" data-at-time="${esc(it.time)}" aria-label="${it.at ? '改时间' : '记下时间'}：${esc(it.name)} ${esc(it.time)} 那次，${it.at ? '现在记的是 ' + esc(it.at) + ' 吃的' : '现在没记时间'}">${it.at ? '改时间' : '记下时间'}</button>` : ''}
      </div>`).join('')}
    </div>`).join('');
}
/* 主页面与日核对弹窗都先核对屏幕快照：跨天/别处改过时先重画，不反向切换新数据。
   提示条可能晚些才点，原页面或父窗口已关闭时也不能拿旧回调重画/打开错误的页面。 */
function medScreenStale(root, date, snapshot, repaint) {
  const main = root === $view();
  const modal = main ? null : root.closest('.modal-mask');
  if (!root.isConnected || dismissPending || (main ? currentView !== 'meds' || !!topOverlay() : !modal || modal !== topOverlay())) {
    toast('请回到用药核对表再修改时间');
    return true;
  }
  const newDay = (main || modal._dayBound) && Store.today() !== date;
  const refreshed = refreshIfStale();
  if (newDay) {
    if (modal) dismissTopOverlay();
    toast('已经是新的一天了，请按今天的核对表再点一次');
    return true;
  }
  if ((main && refreshed) || snapshot !== JSON.stringify(Store.medStatusOn(date))) {
    if (!main || !refreshed) repaint();
    toast('记录刚在别的页面更新过，请看一眼再点');
    return true;
  }
  return false;
}
/* Enter/空格可核对；今天单次核对记当前时间，提示条和常驻按钮均可更正。 */
function bindMedChecks(root, date, after) {
  const snapshot = JSON.stringify(Store.medStatusOn(date));
  root.querySelectorAll('.med-check').forEach(elm => {
    const act = () => {
      if (medScreenStale(root, date, snapshot, () => after(elm))) return;
      const medId = elm.dataset.med, time = elm.dataset.time;
      if (!stored(Store.toggleMed(medId, time, date))) return;
      tick();
      after(elm);
      const at = Store.isMedTaken(medId, time, date) && Store.medTakenAt(medId, time, date);
      if (at) {
        const checked = JSON.stringify(Store.medStatusOn(date));
        toast(`已记下 ${at} 吃的`, {
          label: '改时间',
          onClick: () => {
            if (!medScreenStale(root, date, checked, () => after(elm))) openMedTimeEdit(medId, time, date, elm, () => after(elm));
          },
        });
      } else hideToast(document.getElementById('toast'));
    };
    elm.onclick = act;
    elm.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } };
  });
  root.querySelectorAll('.mc-at').forEach(b => {
    b.onclick = () => {
      if (medScreenStale(root, date, snapshot, () => after(b))) return;
      openMedTimeEdit(b.dataset.atMed, b.dataset.atTime, date, b, () => after(b));
    };
  });
}

/* 更正服药时间是独立子任务；未保存关闭不改数据，存储失败保留输入。 */
function openMedTimeEdit(medId, time, date, returnEl, onDone) {
  const status = Store.medStatusOn(date);
  const item = status.items.find(i => i.medId === medId && i.time === time);
  if (!item || !item.taken) { toast('这一次还没有核对，请先点一下核对'); return; }
  const snapshot = JSON.stringify(status);
  const isToday = date === Store.today();
  const onTimeOK = !isToday || time <= Store.timeStr();
  const node = nodeFromHTML(`
    <div class="vital-form">
      <p class="muted" style="margin-bottom:0.4rem">${esc(dayLabel(date))} · ${esc(item.name)} · ${esc(time)} 那次</p>
      <div class="today-summary">现在记的是：${item.at ? esc(item.at) + ' 吃的' : '没记时间'}</div>
      ${onTimeOK ? `<button type="button" class="btn ghost block" id="mt-ontime" style="margin-top:0.6rem">按时吃的（${esc(time)}）</button>` : ''}
      <div class="field" style="margin:0.8rem 0 0.6rem">
        <label for="mt-time">或者填几点吃的</label>
        <input id="mt-time" type="time" value="${esc(item.at || '')}">
      </div>
      <button type="button" class="btn block" id="mt-save">保存这个时间</button>
      <button type="button" class="btn outline block" id="mt-clear" style="margin-top:0.6rem">记不清了，不记时间</button>
      <div class="muted" style="margin-top:0.6rem">默认记下点核对时的时间。不是那时吃的，请改为实际时间；记不清可以不记。</div>
    </div>`);
  hideToast(document.getElementById('toast'));
  const close = openModal('几点吃的', node);
  const mask = topOverlay();
  /* 原行可能已被重画，returnFocusTarget 按药物和排定时间找回新节点。 */
  mask._returnFocus = returnEl;
  if (isToday) mask._dayBound = date;
  const commit = hhmm => {
    if (!close.active()) return;
    const crossed = isToday && date !== Store.today();
    refreshIfStale();
    if (crossed) {
      close();
      toast('已经是新的一天了，请回到今天的核对表查看');
      return;
    }
    /* 自动同步可能已经换了 Store；只靠 save() 的磁盘冲突检查拦不住旧表单覆盖新时间。 */
    if (snapshot !== JSON.stringify(Store.medStatusOn(date))) {
      showError(node, '记录刚在别的页面更新过，本次没有改时间。请关闭这个窗口，看一眼记录后再改。');
      return;
    }
    if (!stored(Store.setMedTakenAt(medId, time, date, hhmm))) return;
    close();
    onDone();
    toast(hhmm ? `已改成 ${hhmm} 吃的` : '已改为不记时间');
  };
  const onTimeBtn = node.querySelector('#mt-ontime');
  if (onTimeBtn) onTimeBtn.onclick = () => commit(time);
  const save = () => {
    clearFieldErrors(node);
    const v = node.querySelector('#mt-time').value;
    if (!v) { fieldError('mt-time', '请选择几点几分吃的。'); return; }
    commit(v);
  };
  node.querySelector('#mt-save').onclick = save;
  node.querySelector('#mt-clear').onclick = () => commit('');
  bindEnterFlow([node.querySelector('#mt-time')], save);
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
    checkHTML = medCheckListHTML(todayItems, Store.today());
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
  ${pageHeading('用药核对', '按医生处方服药。吃完点一下，默认记下现在；不是刚吃的可以改时间。')}
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
    <div class="med-day-list">${medCheckListHTML(items, date)}</div>
    <button class="btn ghost block" id="med-day-all" style="margin-top:0.6rem"${allDone ? ' hidden' : ''}>这天的都吃了</button>`;
  const close = openModal(title, node);
  /* 绑定到今天的核对弹窗：过夜到第二天再点，会记到已经过去的昨天且标题仍写“今天”。
     记下打开时的日期，跨天时由 refreshIfStale 关掉它，逼用户回到今天重开。 */
  if (isToday) topOverlay()._dayBound = date;
  const allBtn = node.querySelector('#med-day-all');
  const list = node.querySelector('.med-day-list');
  let snapshot;
  const paint = () => {
    const status = Store.medStatusOn(date);
    snapshot = JSON.stringify(status);
    list.innerHTML = medCheckListHTML(status.items, date);
    bindMedChecks(list, date, afterChange);
    allBtn.hidden = !status.items.length || status.items.every(i => i.taken);
  };
  /* 更新清单时保留当前核对行的焦点；子任务关闭后由 returnFocusTarget 找回新节点。 */
  const afterChange = elm => {
    const wasRow = elm && elm.classList.contains('med-check') && document.activeElement === elm;
    paint();
    if (wasRow) {
      const row = [...list.querySelectorAll('.med-check')].find(r => r.dataset.med === elm.dataset.med && r.dataset.time === elm.dataset.time);
      if (row) row.focus({ preventScroll: true });
    }
    render(currentView, { keepScroll: true });
  };
  paint();
  close.onResume(() => {
    if (isToday && date !== Store.today()) { refreshIfStale(); close(); return; }
    paint();
  });
  allBtn.onclick = () => {
    if (medScreenStale(list, date, snapshot, () => afterChange())) return;
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
