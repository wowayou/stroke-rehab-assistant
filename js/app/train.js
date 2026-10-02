/* ============================================================
   训练页 → 打卡历史 → 训练引导器（全屏：计次 / 计时 / 认知游戏）
   计时按截止时刻现算、训练时屏幕常亮（硬约定 15，回归：node test/lifecycle.test.js）
   ============================================================ */

/* ============================================================
   【区】训练页
   ============================================================ */
function renderTrain() {
  const p = Store.data.profile;
  const doneIds = Store.exercisesDoneToday();
  const stage = STAGES.find(s => s.key === p.stage) || STAGES[0];

  let html = `
  ${pageHeading('康复训练', '选一个动作，按自己的节奏慢慢练。')}
  <details class="card disclosure stage-card" id="train-stage">
    <summary><span><strong>当前阶段 · ${esc(stage.name)}</strong><span class="disclosure-hint">${esc(stage.desc)}</span></span><span class="disclosure-action">更换<span class="disclosure-arrow" aria-hidden="true"></span></span></summary>
    <div class="disclosure-body">
    <div class="stage-picker" role="group" aria-label="当前康复阶段">
      ${STAGES.map(s => `<button class="stage-chip ${p.stage === s.key ? 'active' : ''}" aria-pressed="${p.stage === s.key}" data-stage="${s.key}">${s.name}</button>`).join('')}
    </div>
    <div class="muted">阶段影响「肢体运动」列表和今日推荐。</div>
    </div>
  </details>

  <h2 class="section-label">选择训练内容</h2>
  <div class="cat-tabs" role="group" aria-label="训练内容">
    ${EX_CATS.map(c => `<button class="cat-tab ${catTab === c.key ? 'active' : ''}" aria-pressed="${catTab === c.key}" aria-controls="ex-list" data-cat="${c.key}">${c.name}</button>`).join('')}
  </div>
  <div id="ex-list"></div>
  <div class="disclaimer">训练动作应经康复医生/治疗师评估后进行；站立、步行类训练必须有家属保护。</div>
  ${trainHistoryCardHTML()}`;

  $view().innerHTML = html;

  $view().querySelectorAll('[data-stage]').forEach(b => b.onclick = () => {
    if (Store.data.profile.stage === b.dataset.stage) return;
    Store.data.profile.stage = b.dataset.stage;
    if (!stored(Store.save())) return;
    render('train', { keepScroll: true });
  });
  $view().querySelectorAll('[data-cat]').forEach(b => b.onclick = () => {
    if (catTab === b.dataset.cat) return;
    catTab = b.dataset.cat;
    render('train', { keepScroll: true });
    $view().querySelector(`[data-cat="${catTab}"]`).focus({ preventScroll: true });
  });
  const histBtn = document.getElementById('btn-ex-hist');
  if (histBtn) histBtn.onclick = openExerciseHistory;

  let list = EXERCISES.filter(e => e.cat === catTab);
  if (catTab === 'limb') {
    const mine = list.filter(e => e.stage === p.stage);
    const others = list.filter(e => e.stage !== p.stage);
    const stageName = k => (STAGES.find(s => s.key === k) || {}).name || '';
    document.getElementById('ex-list').innerHTML =
      `<div class="ex-group-label">适合当前阶段（${esc(stageName(p.stage))}）</div>`
      + mine.map(e => exCardHTML(e, doneIds.includes(e.id))).join('')
      + `<div class="ex-group-label">其他阶段动作（量力选做）</div>`
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
    <div class="ex-icon" aria-hidden="true">${e.icon}</div>
    <div class="ex-body">
      <div class="ex-name">${e.name}${stageTag ? ` <span class="badge info" style="font-size:0.75rem">${stageTag}</span>` : ''}</div>
      <div class="ex-dose">${e.dose}</div>
      ${done ? '<div class="ex-done-mark">✓ 今日已完成</div>' : ''}
    </div>
    <button class="ex-start ${done ? 'done' : ''}" data-ex="${e.id}" aria-label="${done ? '再练' : '开始'}：${esc(e.name)}">${done ? '再练' : '开始'}</button>
  </div>`;
}

/* ============================================================
   【区】训练打卡历史（日历 + 每日明细 + 游戏成绩）
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
  /* 累计天数是"越攒越多"的正向数字，放在最前面；连续天数断了也先肯定历史最长 */
  let line;
  if (!total) {
    line = '<div class="muted">还没有打卡记录，今天做一个动作就开始了。</div>';
  } else {
    const best = Store.bestStreak();
    line = `<div class="ad-main">已经练了 <b>${total}</b> 天</div>`
      + (streak > 0
        ? `<div class="muted">目前连着练了 ${streak} 天</div>`
        : `<div class="muted">${best > 1 ? `之前最长连着练过 ${best} 天。` : ''}中间歇几天很正常，今天做一个动作就又接上了。</div>`);
  }
  return `
  <details class="disclosure card" id="train-history">
    <summary><span><strong>训练打卡记录</strong><span class="disclosure-hint">${total ? `已积累 ${total} 天 · 查看近四周` : '查看日历与每日明细'}</span></span><span class="disclosure-arrow" aria-hidden="true"></span></summary>
    <div class="disclosure-body">
    ${line}
    ${calendarHTML(28)}
    <div class="cal-legend">
      <span>近 4 周</span>
      <span class="cal-legend-scale">少 <i class="cal-dot"></i><i class="cal-dot lv1"></i><i class="cal-dot lv2"></i> 多</span>
    </div>
    ${hasHistory ? '<button class="btn ghost block" id="btn-ex-hist" style="margin-top:0.7rem">📄 查看每天练了什么</button>' : ''}
    </div>
  </details>`;
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
      <div class="cal-legend"><span>已经练了 ${Store.exerciseDaysTotal()} 天${Store.streak() > 0 ? ` · 目前连着 ${Store.streak()} 天` : ''}</span></div>
    </div>
    <div class="card">
      <div class="card-title">📄 每天练了什么</div>
      ${days || '<div class="empty-tip">还没有训练打卡记录，做一个动作就有了</div>'}
    </div>`);
  openModal('训练历史', node);
}

/* ============================================================
   【区】训练引导器（全屏）：reps 计次 / timer 计时 / game 认知游戏
   ============================================================ */
function openTrainer(ex) {
  /* 换一个动作（游戏里"换个不用算的"）时复用同一个历史条目：
     "训练引导页开着"始终只对应一个条目，返回键一次就退出。 */
  const hadTrainer = !!document.getElementById('trainer');
  const oldTrainer = document.getElementById('trainer');
  const trainerOrigin = oldTrainer && oldTrainer._returnFocus;
  closeTrainer();
  const wrap = document.createElement('div');
  wrap.className = 'trainer';
  wrap.id = 'trainer';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-label', ex.name);

  let modeHTML = '';
  if (ex.mode.type === 'reps') {
    /* 大数字显示「还差几次」而不是已完成次数：患者不必自己做减法 */
    modeHTML = `
    <div class="timer-wrap">
      <div class="timer-label">做完一次点一下大按钮，剩几次它会告诉您</div>
      <button class="rep-btn" id="rep-btn">
        <span class="rep-count" id="rep-count">${ex.mode.target}</span>
        <span id="rep-hint">还差这么多次</span>
      </button>
      <div class="rep-track" id="rep-track">${repTrackHTML(0, ex.mode.target)}</div>
      <div class="rep-note" id="rep-note">做了 0 次 · 目标 ${ex.mode.target} 次（做不到也没关系，做几次都算）</div>
    </div>`;
  } else if (ex.mode.type === 'timer') {
    const m = Math.floor(ex.mode.seconds / 60), s = ex.mode.seconds % 60;
    modeHTML = `
    <div class="timer-wrap">
      <div class="timer-label">建议时长</div>
      <div class="timer-num" id="timer-num">${m}:${String(s).padStart(2, '0')}</div>
      <div class="timer-plain" id="timer-plain">${plainDuration(ex.mode.seconds)}</div>
      <div class="progress-bar" style="max-width:340px;margin:0.6rem auto 0"><div id="timer-bar" style="width:0%"></div></div>
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
      <div class="t-name" tabindex="-1">${ex.name}</div>
      <button class="btn-emergency" id="trainer-emergency">急救</button>
    </div>
    <div class="trainer-body">
      ${figureHTML(ex)}
      <div class="trainer-goal">${ex.goal}</div>
      ${speakBtnHTML('trainer-speak', '听一遍动作要领') ? `<div class="speak-row">${speakBtnHTML('trainer-speak', '听一遍动作要领')}</div>` : ''}
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
  if (!hadTrainer) overlayPush();
  mountOverlay(wrap, wrap.querySelector('.t-name'));
  if (trainerOrigin) wrap._returnFocus = trainerOrigin;
  wrap.querySelector('#trainer-emergency').onclick = openEmergency;
  /* openTrainer 总是由点按触发：趁这次手势解锁提示音；之后每次点按都续一下常亮与音频 */
  unlockAudio();
  Awake.start(() => !!trainerTimer);
  wrap.addEventListener('pointerdown', () => { unlockAudio(); Awake.poke(); });

  const finish = (gameResult = null) => {
    if (dismissPending) return;
    const ok = gameResult
      ? Store.logGameExercise(ex.id, gameResult.game, gameResult.score, gameResult.detail)
      : Store.logExercise(ex.id);
    if (!stored(ok)) return;
    dismissTopOverlay();
    /* 打卡反馈说清"今天第几项"，让每一次都看得见累积 */
    const n = Store.exercisesDoneToday().length;
    toast(`已打卡：${ex.name}　今天第 ${n} 项 👍`);
    /* 保留滚动位置：刚才翻到哪一项，回来还在那里 */
    render(currentView, { keepScroll: true });
  };

  wrap.querySelector('#trainer-back').onclick = dismissTopOverlay;
  bindSpeak(wrap.querySelector('#trainer-speak'), () => exerciseSpeechText(ex));
  const doneBtn = wrap.querySelector('#trainer-done');
  if (doneBtn) doneBtn.onclick = () => finish();

  if (ex.mode.type === 'reps') {
    const target = ex.mode.target;
    let count = 0;
    const btn = wrap.querySelector('#rep-btn');
    const cnt = wrap.querySelector('#rep-count');
    const hint = wrap.querySelector('#rep-hint');
    const track = wrap.querySelector('#rep-track');
    const note = wrap.querySelector('#rep-note');
    btn.onclick = () => {
      count++;
      const left = target - count;
      /* 主数字是"还差几次"；到量后改成对勾，多做的次数当作额外收获，不报错 */
      if (left > 0) {
        cnt.textContent = left;
        hint.textContent = '还差这么多次';
        note.textContent = `做了 ${count} 次 · 目标 ${target} 次`;
      } else {
        cnt.textContent = '✓';
        hint.textContent = left === 0 ? '够了！' : '够了，多做的也算';
        note.textContent = left === 0
          ? `做满 ${target} 次了，随时可以打卡`
          : `做了 ${count} 次，比目标还多 ${-left} 次`;
      }
      track.innerHTML = repTrackHTML(Math.min(count, target), target);
      if (navigator.vibrate) navigator.vibrate(30);
      if (count === target) {
        beep();
        toast('到量了，真棒！点下方按钮打卡');
      }
    };
  } else if (ex.mode.type === 'timer') {
    /* 按"截止时刻"算剩余时间，不按"每秒减一"：手机锁屏或切到后台时定时器会被
       冻结或降到一分钟一次，每秒减一的计时就停在半路，5 分钟的动作要做十几分钟。
       现在每次刷新都用截止时刻现算，切回来立刻是对的；锁屏期间到点的，回来就报"时间到"。 */
    const total = ex.mode.seconds;
    let remain = total, running = false, deadline = 0;
    const num = wrap.querySelector('#timer-num');
    const plain = wrap.querySelector('#timer-plain');
    const bar = wrap.querySelector('#timer-bar');
    const tog = wrap.querySelector('#timer-toggle');
    const rst = wrap.querySelector('#timer-reset');
    const show = () => {
      num.textContent = `${Math.floor(remain / 60)}:${String(remain % 60).padStart(2, '0')}`;
      /* 同时给一句人话，避免患者去换算"还剩多久" */
      plain.textContent = remain <= 0 ? '时间到了' : `还剩${plainDuration(remain).replace('大约 ', '约 ')}`;
      bar.style.width = `${Math.round((total - remain) / total * 100)}%`;
    };
    const clearTick = () => { if (trainerTimer) { clearInterval(trainerTimer); trainerTimer = null; } };
    const left = () => Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    const tick = () => {
      if (!running) return;
      remain = left();
      show();
      if (remain > 0) return;
      clearTick(); running = false;
      tog.textContent = '▶ 再计一次';
      beep();
      toast('时间到！可以点下方按钮打卡');
    };
    const pause = () => {
      if (!running) return;
      remain = left();
      clearTick(); running = false;
      tog.textContent = '▶ 继续';
      show();
    };
    wrap._pause = pause;
    wrap._tick = tick;
    tog.onclick = () => {
      if (running) { pause(); return; }
      if (remain <= 0) remain = total;   // 到点后再点：从头计一次，而不是立刻又"时间到"
      running = true;
      deadline = Date.now() + remain * 1000;
      tog.textContent = '⏸ 暂停';
      show();
      clearTick();
      trainerTimer = setInterval(tick, 250);
    };
    rst.onclick = () => {
      clearTick(); running = false; remain = total; show();
      plain.textContent = plainDuration(total);
      tog.textContent = '▶ 开始计时';
    };
  } else if (ex.mode.type === 'game') {
    Games.start(ex.mode.game, wrap.querySelector('#game-box'), (score, detail) => {
      finish({ game: ex.mode.game, score, detail });
    }, {
      /* 游戏里想换一个玩（比如今天不想算数）：直接打开另一个动作，不算失败 */
      onSwitch: key => {
        const target = EXERCISES.find(x => x.mode && x.mode.type === 'game' && x.mode.game === key);
        if (target) openTrainer(target);
      },
      /* 中途收工也给打卡：参与本身就是训练 */
      onQuit: () => finish(),
    });
  }
}

function closeTrainer() {
  if (trainerTimer) { clearInterval(trainerTimer); trainerTimer = null; }
  Speech.stop();   // 不停会在 iOS 上继续念
  Games.stop();
  Awake.stop();    // 不练了就让屏幕照常熄灭
  releaseAudio();
  const t = document.getElementById('trainer');
  if (t) {
    const index = overlayStack.indexOf(t);
    if (index !== -1) overlayStack.splice(index, 1);
    t.remove();
    syncOverlays();
  }
}
