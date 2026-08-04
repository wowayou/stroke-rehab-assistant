/* ============================================================
   主应用：视图渲染 / 训练引导 / 弹窗 / 设置
   ============================================================ */

const App = (() => {
  let currentView = 'today';
  let recTab = 'bp';      // 记录页当前标签
  let catTab = 'limb';    // 训练页当前分类
  let trainerTimer = null;

  const $view = () => document.getElementById('view');

  /* ---------- 工具 ---------- */
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._tid);
    t._tid = setTimeout(() => t.classList.remove('show'), 2200);
  }
  function beep() {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const o = ac.createOscillator(), g = ac.createGain();
      o.connect(g); g.connect(ac.destination);
      o.frequency.value = 880; g.gain.value = 0.12;
      o.start();
      setTimeout(() => { o.stop(); ac.close(); }, 350);
    } catch (e) { /* 忽略 */ }
    if (navigator.vibrate) navigator.vibrate(300);
  }

  /* ---------- 弹窗 ---------- */
  function openModal(title, contentNode, { center = false } = {}) {
    const mask = document.createElement('div');
    mask.className = 'modal-mask' + (center ? ' center' : '');
    const panel = document.createElement('div');
    panel.className = 'modal-panel';
    const head = document.createElement('div');
    head.className = 'modal-head';
    head.innerHTML = `<div class="m-title">${esc(title)}</div>`;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', '关闭');
    head.appendChild(closeBtn);
    panel.appendChild(head);
    panel.appendChild(contentNode);
    mask.appendChild(panel);
    document.getElementById('modal-root').appendChild(mask);
    const close = () => mask.remove();
    closeBtn.onclick = close;
    mask.addEventListener('click', e => { if (e.target === mask) close(); });
    return close;
  }
  function nodeFromHTML(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    return d;
  }

  /* ============================================================
     今日页
     ============================================================ */
  function renderToday() {
    const p = Store.data.profile;
    const now = new Date();
    const h = now.getHours();
    const greet = h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好';
    const name = p.name ? `，${esc(p.name)}` : '';
    const rd = Store.rehabDay();
    const streak = Store.streak();

    const plan = (DAILY_PLAN[p.stage] || DAILY_PLAN.sitting)
      .map(id => EXERCISES.find(e => e.id === id)).filter(Boolean);
    const doneIds = Store.exercisesDoneToday();
    const planDone = plan.filter(e => doneIds.includes(e.id)).length;
    const mp = Store.medProgressToday();
    const bpDone = Store.bpToday();

    const stageName = (STAGES.find(s => s.key === p.stage) || {}).name || '';

    let html = `
    <div class="today-hero">
      <div class="date-line">${now.getMonth() + 1}月${now.getDate()}日 ${Store.weekdayCN(now)}</div>
      <div class="greet">${greet}${name} 🌱</div>
      ${rd ? `<div class="rehab-day">今天是康复第 <b>${rd}</b> 天，每一天都算数</div>`
           : `<div class="rehab-day">坚持康复，每一天都算数</div>`}
      ${streak > 0 ? `<div class="streak-chip">🔥 已连续坚持训练 ${streak} 天</div>` : ''}
    </div>

    <div class="card">
      <div class="card-title">📋 今日三件事</div>
      <div class="check-item ${bpDone ? 'done' : ''}">
        <div class="ci-icon">🩺</div>
        <div class="ci-body">
          <div class="ci-name">测量血压</div>
          <div class="ci-sub">${bpDone ? '今天已记录 ✓' : '每天固定时间测量并记录'}</div>
        </div>
        <button class="ci-action ${bpDone ? 'done' : ''}" data-go="records" data-rec="bp">${bpDone ? '已完成' : '去记录'}</button>
      </div>
      <div class="check-item ${mp.total > 0 && mp.done >= mp.total ? 'done' : ''}">
        <div class="ci-icon">💊</div>
        <div class="ci-body">
          <div class="ci-name">按时服药</div>
          <div class="ci-sub">${mp.total ? `今日已核对 ${mp.done} / ${mp.total} 次` : '先到「用药」页登记药物'}</div>
        </div>
        <button class="ci-action ${mp.total > 0 && mp.done >= mp.total ? 'done' : ''}" data-go="meds">${mp.total > 0 && mp.done >= mp.total ? '已完成' : '去核对'}</button>
      </div>
      <div class="check-item ${planDone >= plan.length ? 'done' : ''}">
        <div class="ci-icon">💪</div>
        <div class="ci-body">
          <div class="ci-name">康复训练</div>
          <div class="ci-sub">今日推荐 ${plan.length} 项，已完成 ${planDone} 项</div>
          <div class="progress-bar"><div style="width:${plan.length ? Math.round(planDone / plan.length * 100) : 0}%"></div></div>
        </div>
        <button class="ci-action ${planDone >= plan.length ? 'done' : ''}" data-go="train">${planDone >= plan.length ? '已完成' : '去训练'}</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">🎯 今日推荐训练 <span class="muted" style="font-weight:400">（${esc(stageName)}）</span></div>
      ${plan.map(e => exItemHTML(e, doneIds.includes(e.id))).join('')}
      <div class="muted" style="margin-top:0.5rem">阶段不符？到「训练」页可切换康复阶段。</div>
    </div>

    <div class="disclaimer">本应用是家庭康复辅助工具，不能替代医生的诊断和治疗。<br>训练内容请经康复医生评估后进行，身体不适立即停止并就医。</div>`;

    $view().innerHTML = html;

    $view().querySelectorAll('[data-go]').forEach(b => b.onclick = () => {
      if (b.dataset.rec) recTab = b.dataset.rec;
      go(b.dataset.go);
    });
    bindExItems($view());
  }

  /* 训练条目公共 HTML（今日推荐 & 训练库共用） */
  function exItemHTML(e, done) {
    return `
    <div class="ex-item" style="box-shadow:none;padding:0.6rem 0;margin-bottom:0;border-bottom:1px solid var(--border);border-radius:0">
      <div class="ex-icon">${e.icon}</div>
      <div class="ex-body">
        <div class="ex-name">${e.name}</div>
        <div class="ex-dose">${e.dose}</div>
        ${done ? '<div class="ex-done-mark">✓ 今日已完成</div>' : ''}
      </div>
      <button class="ex-start ${done ? 'done' : ''}" data-ex="${e.id}">${done ? '再练一次' : '开始'}</button>
    </div>`;
  }
  function bindExItems(root) {
    root.querySelectorAll('[data-ex]').forEach(b => b.onclick = () => {
      const ex = EXERCISES.find(x => x.id === b.dataset.ex);
      if (ex) openTrainer(ex);
    });
  }

  /* ============================================================
     训练页
     ============================================================ */
  function renderTrain() {
    const p = Store.data.profile;
    const doneIds = Store.exercisesDoneToday();

    let html = `
    <div class="card" style="margin-bottom:0.9rem">
      <div class="card-title">🧭 当前康复阶段</div>
      <div class="stage-picker" style="margin-bottom:0.3rem">
        ${STAGES.map(s => `<button class="stage-chip ${p.stage === s.key ? 'active' : ''}" data-stage="${s.key}">${s.name}</button>`).join('')}
      </div>
      <div class="muted">${esc((STAGES.find(s => s.key === p.stage) || {}).desc || '')}。阶段影响「肢体运动」列表和今日推荐。</div>
    </div>

    ${trainHistoryCardHTML()}

    <div class="cat-tabs">
      ${EX_CATS.map(c => `<button class="cat-tab ${catTab === c.key ? 'active' : ''}" data-cat="${c.key}">${c.icon} ${c.name}</button>`).join('')}
    </div>
    <div id="ex-list"></div>
    <div class="disclaimer">训练动作应经康复医生/治疗师评估后进行；站立、步行类训练必须有家属保护。</div>`;

    $view().innerHTML = html;

    $view().querySelectorAll('[data-stage]').forEach(b => b.onclick = () => {
      Store.data.profile.stage = b.dataset.stage;
      Store.save();
      renderTrain();
    });
    $view().querySelectorAll('[data-cat]').forEach(b => b.onclick = () => {
      catTab = b.dataset.cat;
      renderTrain();
    });
    const histBtn = document.getElementById('btn-ex-hist');
    if (histBtn) histBtn.onclick = openExerciseHistory;

    let list = EXERCISES.filter(e => e.cat === catTab);
    if (catTab === 'limb') {
      const mine = list.filter(e => e.stage === p.stage);
      const others = list.filter(e => e.stage !== p.stage);
      const stageName = k => (STAGES.find(s => s.key === k) || {}).name || '';
      document.getElementById('ex-list').innerHTML =
        `<div class="muted" style="margin-bottom:0.4rem">适合当前阶段（${esc(stageName(p.stage))}）：</div>`
        + mine.map(e => exCardHTML(e, doneIds.includes(e.id))).join('')
        + `<div class="muted" style="margin:0.7rem 0 0.4rem">其他阶段动作（量力选做）：</div>`
        + others.map(e => exCardHTML(e, doneIds.includes(e.id), stageName(e.stage))).join('');
    } else {
      document.getElementById('ex-list').innerHTML =
        list.map(e => exCardHTML(e, doneIds.includes(e.id))).join('');
    }
    bindExItems($view());
  }

  function exCardHTML(e, done, stageTag) {
    return `
    <div class="ex-item">
      <div class="ex-icon">${e.icon}</div>
      <div class="ex-body">
        <div class="ex-name">${e.name}${stageTag ? ` <span class="badge info" style="font-size:0.75rem">${stageTag}</span>` : ''}</div>
        <div class="ex-dose">${e.dose}</div>
        ${done ? '<div class="ex-done-mark">✓ 今日已完成</div>' : ''}
      </div>
      <button class="ex-start ${done ? 'done' : ''}" data-ex="${e.id}">${done ? '再练' : '开始'}</button>
    </div>`;
  }

  /* ============================================================
     训练打卡历史（日历 + 每日明细 + 游戏成绩）
     ============================================================ */

  /* 打卡日历：最近 n 天，按周几对齐，颜色深浅表示当天训练项数 */
  function calendarHTML(n) {
    const cells = Store.exerciseCalendar(n);
    const t = Store.today();
    const head = '日一二三四五六'.split('').map(w => `<div class="cal-head">${w}</div>`).join('');
    const lead = '<div class="cal-cell blank"></div>'.repeat(new Date(cells[0].date + 'T00:00:00').getDay());
    const body = cells.map(c => {
      const lv = c.count >= 3 ? 'lv2' : c.count > 0 ? 'lv1' : '';
      return `<div class="cal-cell ${lv}${c.date === t ? ' today' : ''}" aria-label="${c.date} 训练 ${c.count} 项">
        <span class="cal-d">${+c.date.slice(8)}</span>
        <span class="cal-n">${c.count || ''}</span>
      </div>`;
    }).join('');
    return `<div class="cal-grid">${head}${lead}${body}</div>`;
  }

  function trainHistoryCardHTML() {
    const total = Store.exerciseDaysTotal();
    const streak = Store.streak();
    const hasHistory = Store.activeDates().length > 0;
    return `
    <div class="card" style="margin-bottom:0.9rem">
      <div class="card-title">📅 训练打卡记录</div>
      ${total
        ? `<div class="muted">累计打卡 <b>${total}</b> 天　·　当前连续 <b>${streak}</b> 天</div>`
        : '<div class="muted">还没有打卡记录，今天做一个动作就开始了。</div>'}
      ${calendarHTML(28)}
      <div class="cal-legend">
        <span>近 4 周</span>
        <span class="cal-legend-scale">少 <i class="cal-dot"></i><i class="cal-dot lv1"></i><i class="cal-dot lv2"></i> 多</span>
      </div>
      ${hasHistory ? '<button class="btn ghost block" id="btn-ex-hist" style="margin-top:0.7rem">📄 查看每天练了什么</button>' : ''}
    </div>`;
  }

  function exName(id) {
    const e = EXERCISES.find(x => x.id === id);
    return e ? e.name : id;
  }
  function gameName(key) {
    const e = EXERCISES.find(x => x.mode && x.mode.type === 'game' && x.mode.game === key);
    return e ? e.name : key;
  }
  function weekdayOf(date) {
    return Store.weekdayCN(new Date(date + 'T00:00:00'));
  }

  function openExerciseHistory() {
    const dates = Store.activeDates();
    const days = dates.map(d => {
      const ids = Store.exercisesOn(d);
      const games = Store.gamesOn(d);
      return `
      <div class="hist-day">
        <div class="hd-date">${esc(d)} ${weekdayOf(d)}<span class="hd-count">${ids.length} 项</span></div>
        ${ids.length ? `<div class="chip-row">${ids.map(i => `<span class="chip">${esc(exName(i))}</span>`).join('')}</div>` : ''}
        ${games.length ? `<div class="hd-games">🎮 ${games.map(g => `${esc(gameName(g.game))} ${esc(g.detail || g.score)}`).join('　·　')}</div>` : ''}
      </div>`;
    }).join('');

    const node = nodeFromHTML(`
      <div class="card">
        <div class="card-title">📅 最近 4 周</div>
        ${calendarHTML(28)}
        <div class="cal-legend"><span>累计打卡 ${Store.exerciseDaysTotal()} 天 · 当前连续 ${Store.streak()} 天</span></div>
      </div>
      <div class="card">
        <div class="card-title">📄 每天练了什么</div>
        ${days || '<div class="empty-tip">还没有训练打卡记录</div>'}
      </div>`);
    openModal('训练历史', node);
  }

  /* ============================================================
     训练引导器（全屏）
     ============================================================ */
  function openTrainer(ex) {
    closeTrainer();
    const wrap = document.createElement('div');
    wrap.className = 'trainer';
    wrap.id = 'trainer';

    let modeHTML = '';
    if (ex.mode.type === 'reps') {
      modeHTML = `
      <div class="timer-wrap">
        <div class="timer-label">目标 ${ex.mode.target} 次 · 做完一次点一下大按钮</div>
        <button class="rep-btn" id="rep-btn"><span class="rep-count" id="rep-count">0</span><span>点我计数</span></button>
      </div>`;
    } else if (ex.mode.type === 'timer') {
      const m = Math.floor(ex.mode.seconds / 60), s = ex.mode.seconds % 60;
      modeHTML = `
      <div class="timer-wrap">
        <div class="timer-label">建议时长</div>
        <div class="timer-num" id="timer-num">${m}:${String(s).padStart(2, '0')}</div>
        <div class="btn-row" style="max-width:340px;margin:0.6rem auto 0">
          <button class="btn" id="timer-toggle">▶ 开始计时</button>
          <button class="btn outline" id="timer-reset">重置</button>
        </div>
      </div>`;
    } else if (ex.mode.type === 'game') {
      modeHTML = `<div id="game-box"></div>`;
    }

    wrap.innerHTML = `
      <div class="trainer-head">
        <button class="modal-close" id="trainer-back" aria-label="返回">←</button>
        <div class="t-name">${ex.name}</div>
      </div>
      <div class="trainer-body">
        <div class="trainer-icon-big">${ex.icon}</div>
        <div class="trainer-goal">${ex.goal}</div>
        <div class="trainer-steps">
          <div class="card-title" style="margin-bottom:0.4rem">动作要领</div>
          <ol>${ex.steps.map(s => `<li>${s}</li>`).join('')}</ol>
          <div class="muted" style="margin-top:0.4rem">建议量：${ex.dose}</div>
        </div>
        ${ex.caution ? `<div class="trainer-caution">⚠️ ${ex.caution}</div>` : ''}
        ${modeHTML}
        ${ex.mode.type !== 'game' ? `<button class="btn green block huge" id="trainer-done" style="margin-top:0.8rem">✓ 完成训练，打卡</button>` : ''}
      </div>`;

    document.body.appendChild(wrap);

    const finish = () => {
      Store.logExercise(ex.id);
      closeTrainer();
      toast('已打卡：' + ex.name);
      render(currentView);
    };

    wrap.querySelector('#trainer-back').onclick = () => { closeTrainer(); };
    const doneBtn = wrap.querySelector('#trainer-done');
    if (doneBtn) doneBtn.onclick = finish;

    if (ex.mode.type === 'reps') {
      let count = 0;
      const btn = wrap.querySelector('#rep-btn');
      const cnt = wrap.querySelector('#rep-count');
      btn.onclick = () => {
        count++;
        cnt.textContent = count;
        if (navigator.vibrate) navigator.vibrate(30);
        if (count === ex.mode.target) {
          beep();
          toast('达到目标次数，真棒！');
        }
      };
    } else if (ex.mode.type === 'timer') {
      let remain = ex.mode.seconds, running = false;
      const num = wrap.querySelector('#timer-num');
      const tog = wrap.querySelector('#timer-toggle');
      const rst = wrap.querySelector('#timer-reset');
      const show = () => {
        num.textContent = `${Math.floor(remain / 60)}:${String(remain % 60).padStart(2, '0')}`;
      };
      const stopT = () => { if (trainerTimer) { clearInterval(trainerTimer); trainerTimer = null; } running = false; tog.textContent = '▶ 继续'; };
      tog.onclick = () => {
        if (running) { stopT(); return; }
        running = true; tog.textContent = '⏸ 暂停';
        trainerTimer = setInterval(() => {
          remain--;
          if (remain <= 0) {
            remain = 0; show(); stopT(); beep(); toast('时间到！可以点下方按钮打卡');
            tog.textContent = '▶ 开始计时';
            return;
          }
          show();
        }, 1000);
      };
      rst.onclick = () => { stopT(); remain = ex.mode.seconds; show(); tog.textContent = '▶ 开始计时'; };
    } else if (ex.mode.type === 'game') {
      Games.start(ex.mode.game, wrap.querySelector('#game-box'), (score, detail) => {
        Store.logGame(ex.mode.game, score, detail);
        finish();
      });
    }
  }

  function closeTrainer() {
    if (trainerTimer) { clearInterval(trainerTimer); trainerTimer = null; }
    Games.stop();
    const t = document.getElementById('trainer');
    if (t) t.remove();
  }

  /* ============================================================
     记录页
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
    return [cls, `BMI ${bmi.toFixed(1)} · ${txt}`];
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
      html += `<div class="vt-v"><span style="color:#D93A3A">${esc(v.sys)}</span>/<span style="color:#2E6FE0">${esc(v.dia)}</span> mmHg${v.pulse ? ' · ♥ ' + esc(v.pulse) : ''}</div>`;
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

  /* 历史弹窗：趋势图 + 全部记录（每条带红黄绿状态点），可删除 */
  function openVitalHistory(kind) {
    const meta = REC_KINDS[kind];
    const node = document.createElement('div');
    openModal(`${meta.icon} ${meta.name}历史`, node);

    const paint = () => {
      const sorted = Store.vitalsSorted(kind);
      if (!sorted.length) {
        node.innerHTML = '<div class="empty-tip">没有记录了</div>';
        return;
      }
      const recent = sorted.slice(-30);
      const rows = [...sorted].reverse().map(v => {
        const [cls, txt] = vitalStatus(kind, v);
        return `
        <div class="rec-row">
          <span class="rec-dot ${cls}"></span>
          <span class="rec-date">${esc(v.date)}<br>${esc(v.time || '')}</span>
          <span class="rec-val">${VITAL_FMT[kind](v)}${txt ? `<br><span class="rec-note ${cls}">${txt}</span>` : ''}</span>
          <button class="rec-del" data-del="${v.id}" aria-label="删除">🗑</button>
        </div>`;
      }).join('');

      node.innerHTML = `
      ${recent.length >= 2 ? `
      <div class="card">
        <div class="card-title">📈 趋势（近 ${recent.length} 条）</div>
        <div class="chart-box"><canvas id="vh-chart"></canvas></div>
        ${chartLegendHTML(kind)}
      </div>` : ''}
      <div class="card">
        <div class="card-title">📄 全部记录（${sorted.length} 条）</div>
        <div class="rec-list">${rows}</div>
      </div>`;

      node.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
        if (confirm('删除这条记录？')) {
          Store.removeVital(kind, b.dataset.del);
          paint();
          renderRecords();
        }
      });
      drawVitalChart(kind, node.querySelector('#vh-chart'), recent);
    };
    paint();
  }

  function renderRecords() {
    let html = `
    <div class="rec-tabs">
      ${Object.entries(REC_KINDS).map(([k, v]) =>
        `<button class="rec-tab ${recTab === k ? 'active' : ''}" data-rectab="${k}">${v.icon} ${v.name}</button>`).join('')}
    </div>
    <div id="rec-body"></div>
    <button class="btn ghost block" id="btn-export" style="margin-top:0.2rem">📤 导出记录给医生看</button>
    <div class="disclaimer">浅绿为目标区（遵医嘱，可在设置里调整）；140/90 为一般提示线。指南建议多数患者在能耐受时降至 130/80 以下（部分情况例外），你的控制目标以医生要求为准。</div>`;
    $view().innerHTML = html;

    $view().querySelectorAll('[data-rectab]').forEach(b => b.onclick = () => {
      recTab = b.dataset.rectab;
      renderRecords();
    });
    document.getElementById('btn-export').onclick = openExport;

    const body = document.getElementById('rec-body');
    if (recTab === 'bp') renderBP(body);
    else if (recTab === 'glucose') renderGlucose(body);
    else renderWeight(body);
  }

  function formDefaults() {
    return { d: Store.today(), t: Store.timeStr() };
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
      <div class="muted">最近记录：${esc(latest.date)} ${esc(latest.time || '')}${latest.pulse ? ' · 脉搏 ' + esc(latest.pulse) + ' 次/分' : ''}</div>`;
    }

    body.innerHTML = `
    <div class="card">
      <div class="card-title">➕ 记一次血压</div>
      <div class="vital-form">
        <div class="form-row">
          <div class="field"><label>高压（收缩压）</label><input id="bp-sys" type="number" inputmode="numeric" placeholder="如 135"></div>
          <div class="field"><label>低压（舒张压）</label><input id="bp-dia" type="number" inputmode="numeric" placeholder="如 85"></div>
        </div>
        <div class="form-row">
          <div class="field"><label>脉搏（可不填）</label><input id="bp-pulse" type="number" inputmode="numeric" placeholder="次/分"></div>
          <div class="field"><label>日期</label><input id="bp-date" type="date" value="${d}"></div>
          <div class="field"><label>时间</label><input id="bp-time" type="time" value="${t}"></div>
        </div>
        <button class="btn block" id="bp-save">保存血压记录</button>
      </div>
    </div>
    <div class="card">
      <div class="card-title">🩺 最近血压</div>
      ${latestHTML}
      ${sorted.length >= 2 ? `<div class="chart-box"><canvas id="bp-chart"></canvas></div>${chartLegendHTML('bp')}` : ''}
      ${histBtnHTML('bp', sorted.length)}
    </div>`;

    document.getElementById('bp-save').onclick = () => {
      const sys = +document.getElementById('bp-sys').value;
      const dia = +document.getElementById('bp-dia').value;
      const pulse = document.getElementById('bp-pulse').value;
      const date = document.getElementById('bp-date').value;
      const time = document.getElementById('bp-time').value;
      if (!sys || !dia || sys < 50 || sys > 300 || dia < 30 || dia > 200) { toast('请输入有效的血压数值'); return; }
      if (!date) { toast('请选择日期'); return; }
      Store.addVital('bp', { date, time, sys, dia, pulse: pulse ? +pulse : '' });
      const [cls, txt] = bpBadge(sys, dia);
      toast(cls === 'bad' ? '已保存。' + txt : '已保存 ✓');
      renderRecords();
    };
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
      <div class="muted">最近记录：${esc(latest.date)} ${esc(latest.time || '')}</div>`;
    }

    body.innerHTML = `
    <div class="card">
      <div class="card-title">➕ 记一次血糖</div>
      <div class="vital-form">
        <div class="form-row">
          <div class="field"><label>测量类型</label>
            <select id="glu-type"><option>空腹</option><option>餐后2小时</option><option>随机</option></select>
          </div>
          <div class="field"><label>数值 mmol/L</label><input id="glu-val" type="number" step="0.1" inputmode="decimal" placeholder="如 6.2"></div>
        </div>
        <div class="form-row">
          <div class="field"><label>日期</label><input id="glu-date" type="date" value="${d}"></div>
          <div class="field"><label>时间</label><input id="glu-time" type="time" value="${t}"></div>
        </div>
        <button class="btn block" id="glu-save">保存血糖记录</button>
      </div>
    </div>
    <div class="card">
      <div class="card-title">🩸 最近血糖</div>
      ${latestHTML}
      ${sorted.length >= 2 ? `<div class="chart-box"><canvas id="glu-chart"></canvas></div>${chartLegendHTML('glucose')}` : ''}
      ${histBtnHTML('glucose', sorted.length)}
    </div>`;

    document.getElementById('glu-save').onclick = () => {
      const gtype = document.getElementById('glu-type').value;
      const value = +document.getElementById('glu-val').value;
      const date = document.getElementById('glu-date').value;
      const time = document.getElementById('glu-time').value;
      if (!value || value < 1 || value > 40) { toast('请输入有效的血糖数值'); return; }
      if (!date) { toast('请选择日期'); return; }
      Store.addVital('glucose', { date, time, gtype, value });
      toast('已保存 ✓');
      renderRecords();
    };
    bindHist(body);
    drawVitalChart('glucose', document.getElementById('glu-chart'), sorted.slice(-14));
  }

  function renderWeight(body) {
    const { d } = formDefaults();
    const sorted = Store.vitalsSorted('weight');
    const latest = sorted[sorted.length - 1];
    const height = +Store.data.profile.height;
    let latestHTML = '<div class="empty-tip">还没有体重记录，每周记 1～2 次即可</div>';
    if (latest) {
      let bmiHTML = '';
      if (height) {
        const bmi = +latest.value / Math.pow(height / 100, 2);
        const [cls, txt] = bmiBadge(bmi);
        bmiHTML = `<span class="badge ${cls}">BMI ${bmi.toFixed(1)} · ${txt}</span>`;
      } else {
        bmiHTML = '<span class="muted">在「设置」里填身高可算BMI</span>';
      }
      latestHTML = `
      <div class="latest-value">
        <span class="big">${esc(latest.value)}</span><span class="muted">公斤</span>
        ${bmiHTML}
      </div>
      <div class="muted">最近记录：${esc(latest.date)}</div>`;
    }

    body.innerHTML = `
    <div class="card">
      <div class="card-title">➕ 记一次体重</div>
      <div class="vital-form">
        <div class="form-row">
          <div class="field"><label>体重（公斤）</label><input id="wt-val" type="number" step="0.1" inputmode="decimal" placeholder="如 62.5"></div>
          <div class="field"><label>日期</label><input id="wt-date" type="date" value="${d}"></div>
        </div>
        <button class="btn block" id="wt-save">保存体重记录</button>
      </div>
    </div>
    <div class="card">
      <div class="card-title">⚖️ 最近体重</div>
      ${latestHTML}
      ${sorted.length >= 2 ? `<div class="chart-box"><canvas id="wt-chart"></canvas></div>${chartLegendHTML('weight')}` : ''}
      ${histBtnHTML('weight', sorted.length)}
    </div>`;

    document.getElementById('wt-save').onclick = () => {
      const value = +document.getElementById('wt-val').value;
      const date = document.getElementById('wt-date').value;
      if (!value || value < 20 || value > 300) { toast('请输入有效的体重'); return; }
      if (!date) { toast('请选择日期'); return; }
      Store.addVital('weight', { date, value });
      toast('已保存 ✓');
      renderRecords();
    };
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

  /* ============================================================
     用药页
     ============================================================ */
  function renderMeds() {
    const meds = Store.data.meds;
    const ad = Store.adherence7d();

    /* 按时间分组的今日核对表 */
    const slots = {};
    meds.forEach(m => (m.times || []).forEach(t => {
      if (!slots[t]) slots[t] = [];
      slots[t].push(m);
    }));
    const times = Object.keys(slots).sort();

    let checkHTML;
    if (!meds.length) {
      checkHTML = '<div class="empty-tip">还没有登记药物。<br>请按医生处方，点下方按钮添加。</div>';
    } else {
      checkHTML = times.map(t => `
        <div class="med-time-group">
          <div class="med-time-label">🕐 ${t}</div>
          ${slots[t].map(m => {
            const taken = Store.isMedTaken(m.id, t);
            return `
            <div class="med-check ${taken ? 'checked' : ''}" data-med="${m.id}" data-time="${t}" role="button" tabindex="0">
              <div class="mc-box">${taken ? '✓' : ''}</div>
              <div>
                <div class="mc-name">${esc(m.name)}</div>
                <div class="mc-dose">${esc(m.dose || '')}${m.note ? ' · ' + esc(m.note) : ''}</div>
              </div>
            </div>`;
          }).join('')}
        </div>`).join('');
    }

    let html = `
    <div class="card">
      <div class="card-title">✅ 今日服药核对 <span class="muted" style="font-weight:400">（吃完点一下）</span></div>
      ${checkHTML}
    </div>
    ${ad !== null ? `
    <div class="card">
      <div class="card-title">📊 近7天服药完成率</div>
      <div class="adherence-ring">
        <div class="ring-num">${ad}%</div>
        <div class="muted">${ad >= 90 ? '非常好，请保持！' : ad >= 70 ? '还不错，争取一次不落。' : '漏服较多。研究显示：坚持服药的患者，再次中风的风险只有不坚持者的约三分之一。可设手机闹钟配合本页核对。'}</div>
      </div>
      <button class="btn ghost block" id="btn-med-hist" style="margin-top:0.7rem">📄 查看服药历史（近14天）</button>
    </div>` : ''}
    <div class="card">
      <div class="card-title">💊 我的药物清单</div>
      ${meds.length ? meds.map(m => `
        <div class="med-item">
          <div class="mi-body">
            <div class="mi-name">${esc(m.name)}</div>
            <div class="mi-sub">${esc(m.dose || '')} · 每日${(m.times || []).length}次（${(m.times || []).join('、')}）${m.note ? ' · ' + esc(m.note) : ''}</div>
          </div>
          <button class="btn small outline" data-edit-med="${m.id}">修改</button>
        </div>`).join('') : ''}
      <button class="btn ghost block" id="btn-add-med" style="margin-top:0.7rem">＋ 添加药物</button>
      <div class="muted" style="margin-top:0.5rem">请严格按医生处方登记。任何加药、减药、停药都要先问医生。</div>
    </div>`;

    $view().innerHTML = html;

    $view().querySelectorAll('.med-check').forEach(elm => {
      const act = () => {
        Store.toggleMed(elm.dataset.med, elm.dataset.time);
        renderMeds();
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

  /* 服药历史：每天一行，一个圆点代表一次应服的药 */
  function openMedHistory() {
    const days = Store.medHistory(14);
    const sum = days.reduce((a, d) => ({ total: a.total + d.total, done: a.done + d.done }), { total: 0, done: 0 });
    const pct = sum.total ? Math.round(sum.done / sum.total * 100) : 0;
    const t = Store.today();

    const rows = days.map(d => `
      <div class="day-row">
        <span class="day-date">${esc(d.date.slice(5))}${d.date === t ? '（今天）' : ''}<br>${weekdayOf(d.date)}</span>
        <span class="dot-row">${d.items.map(i =>
          `<i class="dose-dot ${i.taken ? 'taken' : ''}" aria-label="${esc(i.time)} ${esc(i.name)} ${i.taken ? '已服' : '未记录'}"></i>`).join('')}</span>
        <span class="day-score ${d.total && d.done >= d.total ? 'ok' : ''}">${d.done}/${d.total}</span>
      </div>`).join('');

    const node = nodeFromHTML(`
      <div class="card">
        <div class="card-title">📊 近14天完成率</div>
        <div class="adherence-ring">
          <div class="ring-num">${pct}%</div>
          <div class="muted">共 ${sum.total} 次应服，已核对 ${sum.done} 次</div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">📄 每天核对情况</div>
        <div class="day-legend"><i class="dose-dot taken"></i> 已核对　<i class="dose-dot"></i> 未记录</div>
        ${rows}
      </div>
      <div class="disclaimer">应服次数按「当前药物清单」计算；如果最近改过处方，更早日期的次数会按新处方显示。漏服记录仅供自我提醒，用药调整请遵医嘱。</div>`);
    openModal('服药历史', node);
  }

  const COMMON_TIMES = ['06:30', '07:30', '08:00', '11:30', '12:00', '17:30', '18:00', '20:00', '21:00'];
  const COMMON_MEDS = ['阿司匹林肠溶片', '硫酸氢氯吡格雷片', '阿托伐他汀钙片', '瑞舒伐他汀钙片'];

  function openMedForm(med) {
    const isEdit = !!med;
    const sel = new Set(isEdit ? med.times : ['08:00']);

    const node = nodeFromHTML(`
      <div class="vital-form">
        <div class="field" style="margin-bottom:0.7rem">
          <label>药物名称（按处方填写）</label>
          <input id="med-name" type="text" placeholder="如 阿司匹林肠溶片" value="${isEdit ? esc(med.name) : ''}">
          <div class="time-chip-row" style="margin-top:0.4rem">
            ${COMMON_MEDS.map(n => `<button class="time-chip" data-preset="${esc(n)}" style="min-height:42px;font-size:0.88rem">${esc(n)}</button>`).join('')}
          </div>
        </div>
        <div class="field" style="margin-bottom:0.7rem">
          <label>每次用量</label>
          <input id="med-dose" type="text" placeholder="如 100mg，1片" value="${isEdit ? esc(med.dose || '') : ''}">
        </div>
        <div class="field" style="margin-bottom:0.7rem">
          <label>每天服药时间（可多选）</label>
          <div class="time-chip-row" id="time-chips">
            ${COMMON_TIMES.map(t => `<button class="time-chip ${sel.has(t) ? 'active' : ''}" data-t="${t}">${t}</button>`).join('')}
          </div>
          <div style="display:flex;gap:0.5rem;margin-top:0.5rem;align-items:center">
            <input id="custom-time" type="time" style="flex:1">
            <button class="btn small outline" id="add-custom-time">添加自定时间</button>
          </div>
          <div class="muted" style="margin-top:0.3rem">已选：<span id="sel-times">${[...sel].sort().join('、') || '无'}</span></div>
        </div>
        <div class="field" style="margin-bottom:0.9rem">
          <label>备注（可不填）</label>
          <input id="med-note" type="text" placeholder="如 饭后服、别嚼碎" value="${isEdit ? esc(med.note || '') : ''}">
        </div>
        <button class="btn block" id="med-save">${isEdit ? '保存修改' : '添加药物'}</button>
        ${isEdit ? '<button class="btn red block" id="med-del" style="margin-top:0.6rem">删除这个药物</button>' : ''}
      </div>`);

    const close = openModal(isEdit ? '修改药物' : '添加药物', node);

    const refreshSel = () => {
      node.querySelector('#sel-times').textContent = [...sel].sort().join('、') || '无';
      node.querySelectorAll('#time-chips .time-chip').forEach(c =>
        c.classList.toggle('active', sel.has(c.dataset.t)));
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
      const name = node.querySelector('#med-name').value.trim();
      const dose = node.querySelector('#med-dose').value.trim();
      const note = node.querySelector('#med-note').value.trim();
      if (!name) { toast('请填写药物名称'); return; }
      if (!sel.size) { toast('请至少选择一个服药时间'); return; }
      const payload = { name, dose, note, times: [...sel].sort() };
      if (isEdit) Store.updateMed(med.id, payload);
      else Store.addMed(payload);
      close();
      toast(isEdit ? '已保存修改' : '已添加药物');
      renderMeds();
    };
    if (isEdit) node.querySelector('#med-del').onclick = () => {
      if (confirm(`确定删除「${med.name}」？\n（如果是遵医嘱停药才删除）`)) {
        Store.removeMed(med.id);
        close();
        toast('已删除');
        renderMeds();
      }
    };
  }

  /* ============================================================
     知识页
     ============================================================ */
  function renderLearn() {
    const groups = [];
    ARTICLES.forEach(a => { if (!groups.includes(a.group)) groups.push(a.group); });

    let html = `
    <div class="card" style="border:2px solid var(--red)">
      <div class="card-title" style="color:var(--red)">🚨 出现这些情况，立即拨打120</div>
      <div class="muted" style="margin-bottom:0.5rem">口角歪斜 · 单侧肢体无力 · 说话不清 · 突然看不清 · 走不稳</div>
      <button class="btn red block" id="btn-open-emergency">查看急救指引 + 拨打120</button>
    </div>
    ${groups.map(g => `
      <div class="card-title" style="margin:0.9rem 0 0.5rem 0.2rem">${esc(g)}</div>
      ${ARTICLES.filter(a => a.group === g).map(a => `
        <div class="art-item" data-art="${a.id}" role="button" tabindex="0">
          <div class="art-icon">${a.icon}</div>
          <div class="art-body">
            <div class="art-title">${a.title}</div>
            <div class="art-sub">${a.sub}</div>
          </div>
          <div class="art-arrow">›</div>
        </div>`).join('')}
    `).join('')}
    <div class="disclaimer">内容参考国内卒中防治与康复指南整理，仅作健康教育用途，<br>不能替代医生的诊断和治疗建议。</div>`;

    $view().innerHTML = html;

    document.getElementById('btn-open-emergency').onclick = openEmergency;
    $view().querySelectorAll('[data-art]').forEach(elm => {
      const open = () => {
        const a = ARTICLES.find(x => x.id === elm.dataset.art);
        if (a) {
          const node = nodeFromHTML(`<div class="article-view">${a.body}</div>`);
          openModal(a.title, node);
        }
      };
      elm.onclick = open;
      elm.onkeydown = e => { if (e.key === 'Enter') open(); };
    });
  }

  /* ============================================================
     紧急弹窗
     ============================================================ */
  function openEmergency() {
    const node = nodeFromHTML(`
      <div class="emergency-view">
        <div class="ev-title">疑似中风，立即行动！</div>
        <div class="card" style="margin-bottom:0.8rem">
          ${BEFAST.map(b => `
            <div class="befast-item">
              <div class="bf-letter">${b.letter}</div>
              <div><div class="bf-name">${b.name}</div><div class="bf-desc">${b.desc}</div></div>
            </div>`).join('')}
        </div>
        <div class="card">
          <div class="card-title">同时要做的事</div>
          <ul style="padding-left:1.3rem">
            <li><b>记下发病时间</b>（最后一次看起来正常是几点）</li>
            <li>让患者平卧，头偏向一侧，解开衣领</li>
            <li><b>不要喂水、喂药、喂任何东西</b></li>
            <li>症状缓解了也要就医，不要"再观察观察"</li>
          </ul>
        </div>
        <a class="call-120" href="tel:120">📞 立即拨打 120</a>
      </div>`);
    openModal('紧急识别', node, { center: false });
  }

  /* ============================================================
     设置弹窗
     ============================================================ */
  function openSettings() {
    const p = Store.data.profile;
    const node = nodeFromHTML(`
      <div class="card">
        <div class="setting-row">
          <div class="sr-label">怎么称呼您</div>
          <input id="set-name" type="text" value="${esc(p.name)}" placeholder="如 王叔叔"
            style="width:9em;min-height:48px;border:1.5px solid var(--border);border-radius:10px;padding:0 0.6rem;font-size:1rem">
        </div>
        <div class="setting-row">
          <div class="sr-label">发病日期</div>
          <input id="set-stroke-date" type="date" value="${esc(p.strokeDate)}"
            style="min-height:48px;border:1.5px solid var(--border);border-radius:10px;padding:0 0.6rem;font-size:1rem">
        </div>
        <div class="setting-row">
          <div class="sr-label">身高(cm)</div>
          <input id="set-height" type="number" inputmode="numeric" value="${esc(p.height)}" placeholder="算BMI用"
            style="width:7em;min-height:48px;border:1.5px solid var(--border);border-radius:10px;padding:0 0.6rem;font-size:1rem">
        </div>
        <div class="setting-row">
          <div class="sr-label">字体大小</div>
          <div class="font-chips">
            <button class="font-chip f1 ${p.font === 'normal' ? 'active' : ''}" data-font="normal">标准</button>
            <button class="font-chip f2 ${p.font === 'large' ? 'active' : ''}" data-font="large">大</button>
            <button class="font-chip f3 ${p.font === 'xlarge' ? 'active' : ''}" data-font="xlarge">特大</button>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">🎯 个人目标值（遵医嘱）</div>
        <div class="setting-row">
          <div class="sr-label">血压高压目标</div>
          <input id="set-bpsys" type="number" inputmode="numeric" value="${esc(p.targets.bpSys)}"
            style="width:6em;min-height:48px;border:1.5px solid var(--border);border-radius:10px;padding:0 0.6rem;font-size:1rem"><span class="muted"> mmHg</span>
        </div>
        <div class="setting-row">
          <div class="sr-label">血压低压目标</div>
          <input id="set-bpdia" type="number" inputmode="numeric" value="${esc(p.targets.bpDia)}"
            style="width:6em;min-height:48px;border:1.5px solid var(--border);border-radius:10px;padding:0 0.6rem;font-size:1rem"><span class="muted"> mmHg</span>
        </div>
        <div class="setting-row">
          <div class="sr-label">血糖空腹目标</div>
          <input id="set-glufast" type="number" step="0.1" inputmode="decimal" value="${esc(p.targets.gluFast)}"
            style="width:6em;min-height:48px;border:1.5px solid var(--border);border-radius:10px;padding:0 0.6rem;font-size:1rem"><span class="muted"> mmol/L</span>
        </div>
        <div class="setting-row">
          <div class="sr-label">血糖餐后2h目标</div>
          <input id="set-glupost" type="number" step="0.1" inputmode="decimal" value="${esc(p.targets.gluPost)}"
            style="width:6em;min-height:48px;border:1.5px solid var(--border);border-radius:10px;padding:0 0.6rem;font-size:1rem"><span class="muted"> mmol/L</span>
        </div>
        <div class="muted" style="margin-top:0.4rem">目标值按医生要求填写，图上会画出目标区、超过会提示"偏高"；血压 180/110、血糖极低/明显偏高等危险情况仍会单独警示。默认 140/90、空腹 7.0、餐后 10.0 仅为一般参考，以医嘱为准。</div>
      </div>
      <div class="card">
        <button class="btn ghost block" id="set-guide">❓ 查看使用指引</button>
        <button class="btn ghost block" id="set-export" style="margin-top:0.6rem">📤 导出健康记录（给医生）</button>
        <button class="btn ghost block" id="set-backup" style="margin-top:0.6rem">📦 备份全部数据（下载文件）</button>
        <button class="btn ghost block" id="set-restore" style="margin-top:0.6rem">♻️ 从备份恢复</button>
        <input type="file" id="set-restore-input" accept=".json,application/json" style="display:none">
        <button class="btn outline block" id="set-reset" style="margin-top:0.6rem;color:var(--red)">清空全部数据</button>
        <div class="muted" style="margin-top:0.6rem">所有数据只保存在这台设备上，不会上传到任何地方。清空缓存或换手机会丢数据，请定期用「备份全部数据」下载保存；换新设备时用「从备份恢复」迁回。</div>
      </div>
      <button class="btn block" id="set-save">保存设置</button>`);

    const close = openModal('设置', node);

    node.querySelectorAll('[data-font]').forEach(b => b.onclick = () => {
      node.querySelectorAll('[data-font]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      applyFont(b.dataset.font);
    });
    node.querySelector('#set-guide').onclick = () => { close(); openGuide(); };
    node.querySelector('#set-export').onclick = () => { close(); openExport(); };
    node.querySelector('#set-backup').onclick = () => { close(); downloadBackup(); };
    node.querySelector('#set-restore').onclick = () => { node.querySelector('#set-restore-input').click(); };
    node.querySelector('#set-restore-input').onchange = () => {
      const file = node.querySelector('#set-restore-input').files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        let parsed;
        try { parsed = Store.parseBackup(String(reader.result)); }
        catch (e) { toast('恢复失败：' + e.message); return; }
        const s = Store.backupSummary(parsed.data);
        const confirmNode = nodeFromHTML(`
          <p class="muted" style="margin-bottom:0.5rem">备份文件：<b>${esc(file.name)}</b>${parsed.exportedAt ? '<br>导出时间：' + esc(parsed.exportedAt) : ''}</p>
          <div class="card" style="margin-bottom:0.7rem">
            <div class="card-title">恢复后将包含</div>
            <div class="guide-line">💊 药物 ${s.meds} 种　·　🩺 血压 ${s.bp} 条</div>
            <div class="guide-line">🩸 血糖 ${s.glucose} 条　·　⚖️ 体重 ${s.weight} 条</div>
            <div class="guide-line">💪 训练打卡 ${s.checkinDays} 天</div>
          </div>
          <div class="disclaimer" style="padding:0.2rem 0 0.6rem">恢复会用备份<b>覆盖本机现有全部数据</b>，无法撤销。</div>
          <button class="btn block" id="restore-confirm">确认恢复</button>`);
        close();
        const closeConfirm = openModal('从备份恢复', confirmNode, { center: true });
        confirmNode.querySelector('#restore-confirm').onclick = () => {
          Store.applyBackup(parsed.data);
          applyFont(Store.data.profile.font);
          closeConfirm();
          render(currentView);
          toast('已从备份恢复 ✓');
        };
      };
      reader.readAsText(file);
    };
    node.querySelector('#set-reset').onclick = () => {
      if (confirm('确定清空全部数据？此操作无法恢复！')) {
        if (confirm('再次确认：血压记录、用药、训练打卡都会被删除。')) {
          Store.resetAll();
          close();
          applyFont('normal');
          render(currentView);
          toast('已清空');
        }
      }
    };
    node.querySelector('#set-save').onclick = () => {
      const p2 = Store.data.profile;
      p2.name = node.querySelector('#set-name').value.trim();
      p2.strokeDate = node.querySelector('#set-stroke-date').value;
      p2.height = node.querySelector('#set-height').value;
      const active = node.querySelector('[data-font].active');
      p2.font = active ? active.dataset.font : 'normal';
      const g = id => +node.querySelector(id).value;
      const bs = g('#set-bpsys'), bd = g('#set-bpdia'), gf = g('#set-glufast'), gp = g('#set-glupost');
      if (!(bs >= 60 && bs <= 260) || !(bd >= 30 && bd <= 200)) { toast('请输入有效的血压目标值'); return; }
      if (bs <= bd) { toast('高压目标应高于低压目标'); return; }
      if (!(gf >= 3 && gf <= 20) || !(gp >= 3 && gp <= 30)) { toast('请输入有效的血糖目标值'); return; }
      p2.targets = { bpSys: bs, bpDia: bd, gluFast: gf, gluPost: gp };
      Store.save();
      close();
      render(currentView);
      toast('设置已保存');
    };
  }

  function applyFont(f) {
    if (f === 'large' || f === 'xlarge') document.documentElement.dataset.font = f;
    else delete document.documentElement.dataset.font;
  }

  /* ============================================================
     首次使用指引
     ============================================================ */
  function openGuide() {
    const node = nodeFromHTML(`
      <div class="guide">
        <div class="guide-hero">🌱 欢迎使用<br>脑梗康复助手</div>
        <p class="guide-sub">帮脑梗恢复期的家人一起坚持康复。<br><b>所有数据只保存在这台设备</b>，不会上传到任何地方。</p>
        <div class="card">
          <div class="card-title">📋 每天先做这三件事</div>
          <div class="guide-step"><span class="gs-num">1</span><div><b>测血压</b><br><span class="muted">固定时间测量，「今日」页点「去记录」</span></div></div>
          <div class="guide-step"><span class="gs-num">2</span><div><b>按时服药</b><br><span class="muted">按医嘱吃完，在「用药」页点一下核对</span></div></div>
          <div class="guide-step"><span class="gs-num">3</span><div><b>康复训练</b><br><span class="muted">「训练」页按阶段选动作，做完点打卡</span></div></div>
        </div>
        <div class="card">
          <div class="card-title">🔧 还要会用</div>
          <div class="guide-line">📈 「记录」页：血压/血糖/体重，复诊时一键导出给医生</div>
          <div class="guide-line">📚 「知识」页：防复发科普；🚨 急救卡，疑似中风立即拨 120</div>
          <div class="guide-line">⚙️ 「设置」：填发病日期、身高，可调大字体</div>
        </div>
        <div class="disclaimer">本应用是家庭康复辅助工具，不能替代医生的诊断和治疗。<br>训练前请经康复医生评估，身体不适立即停止并就医。</div>
        <button class="btn green block huge" id="guide-done" style="margin-top:0.7rem">我知道了，开始使用</button>
      </div>`);
    const close = openModal('首次使用指引', node, { center: true });
    node.querySelector('#guide-done').onclick = () => {
      Store.markGuideSeen();
      close();
      toast('可以开始了！按「今日」页的提示做就行');
    };
  }

  /* ============================================================
     备份下载
     ============================================================ */
  function downloadBackup() {
    const text = Store.exportBackup();
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `脑梗康复助手-备份-${Store.today()}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
    toast('备份已下载，请妥善保存该文件');
  }

  /* ============================================================
     导航与初始化
     ============================================================ */
  const RENDERERS = {
    today: renderToday,
    train: renderTrain,
    records: renderRecords,
    meds: renderMeds,
    learn: renderLearn,
  };

  function render(view) {
    (RENDERERS[view] || renderToday)();
    window.scrollTo(0, 0);
  }

  function go(view) {
    currentView = view;
    document.querySelectorAll('.nav-item').forEach(b =>
      b.classList.toggle('active', b.dataset.view === view));
    render(view);
  }

  function init() {
    Store.load();
    applyFont(Store.data.profile.font);
    document.querySelectorAll('.nav-item').forEach(b => b.onclick = () => go(b.dataset.view));
    document.getElementById('btn-emergency').onclick = openEmergency;
    document.getElementById('btn-settings').onclick = openSettings;
    const urlView = new URLSearchParams(location.search).get('view');
    go(RENDERERS[urlView] ? urlView : 'today');
    if (!Store.guideSeen()) openGuide();
  }

  return { init, go };
})();

document.addEventListener('DOMContentLoaded', App.init);
