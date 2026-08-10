/* ============================================================
   认知训练小游戏（记忆翻牌 / 顺序点数 / 颜色辨认 / 算一算）
   Games.start(key, container, onDone)  onDone(score, detailText)
   Games.stop() 清理计时器
   ============================================================ */

const Games = (() => {
  let timerId = null;
  function stop() { if (timerId) { clearInterval(timerId); timerId = null; } }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function showResult(container, icon, text, sub, onDone, replay, onLevel) {
    stop();
    container.innerHTML = '';
    const box = el('div', 'game-result');
    box.appendChild(el('div', 'gr-icon', icon));
    box.appendChild(el('div', 'gr-text', text));
    if (sub) box.appendChild(el('div', 'muted', sub));
    const row = el('div', 'btn-row');
    const again = el('button', 'btn ghost', '再玩一次');
    again.onclick = replay;
    const ok = el('button', 'btn green', '完成打卡 ✓');
    ok.onclick = onDone;
    row.appendChild(again); row.appendChild(ok);
    box.appendChild(row);
    if (onLevel) {
      const lv = el('button', 'link-btn', '换个难度再来');
      lv.onclick = onLevel;
      box.appendChild(lv);
    }
    container.appendChild(box);
  }

  /* ---------- 1. 记忆翻牌 ---------- */
  function memory(container, onDone) {
    stop();
    container.innerHTML = '';
    const emojis = shuffle(['🍎', '🐟', '🌸', '🚗', '☂️', '🐔', '🍌', '🏠']).slice(0, 6);
    const cards = shuffle([...emojis, ...emojis]);
    let first = null, lock = false, matched = 0, moves = 0;

    const grid = el('div', 'game-grid cols-4');
    const status = el('div', 'game-status');
    const movesEl = el('span', '', '翻牌次数：0');
    status.appendChild(el('span', '', '找到相同的一对'));
    status.appendChild(movesEl);

    cards.forEach(sym => {
      const btn = el('button', 'game-cell', '❓');
      btn.dataset.sym = sym;
      btn.onclick = () => {
        if (lock || btn.classList.contains('revealed') || btn.classList.contains('matched')) return;
        btn.classList.add('revealed');
        btn.textContent = sym;
        if (!first) { first = btn; return; }
        moves++;
        movesEl.textContent = `翻牌次数：${moves}`;
        if (first.dataset.sym === sym) {
          first.classList.add('matched'); btn.classList.add('matched');
          first.classList.remove('revealed'); btn.classList.remove('revealed');
          first = null; matched++;
          if (matched === emojis.length) {
            setTimeout(() => showResult(container, '🎉', '全部配对成功！',
              `共翻牌 ${moves} 次。找的过程就是在练记忆。`, () => onDone(moves, `翻牌${moves}次`), () => memory(container, onDone)), 400);
          }
        } else {
          lock = true;
          const f = first; first = null;
          setTimeout(() => {
            f.classList.remove('revealed'); f.textContent = '❓';
            btn.classList.remove('revealed'); btn.textContent = '❓';
            lock = false;
          }, 900);
        }
      };
      grid.appendChild(btn);
    });
    container.appendChild(grid);
    container.appendChild(status);
  }

  /* ---------- 2. 顺序点数 ---------- */
  function sequence(container, onDone) {
    stop();
    container.innerHTML = '';
    const nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    let next = 1, seconds = 0;

    const grid = el('div', 'game-grid cols-3');
    const status = el('div', 'game-status');
    const target = el('span', '', '请点：1');
    const timeEl = el('span', '', '用时 0 秒');
    status.appendChild(target); status.appendChild(timeEl);
    timerId = setInterval(() => { seconds++; timeEl.textContent = `用时 ${seconds} 秒`; }, 1000);

    nums.forEach(n => {
      const btn = el('button', 'game-cell number', String(n));
      btn.onclick = () => {
        if (btn.classList.contains('hit')) return;
        if (n === next) {
          btn.classList.add('hit');
          next++;
          target.textContent = `请点：${next}`;
          if (next > 9) {
            const used = seconds;
            setTimeout(() => showResult(container, '🎉', '按顺序全部点完！',
              `用时 ${used} 秒。不用比快，点对就行。`, () => onDone(used, `用时${used}秒`), () => sequence(container, onDone)), 300);
          }
        } else {
          btn.classList.add('shake');
          setTimeout(() => btn.classList.remove('shake'), 500);
        }
      };
      grid.appendChild(btn);
    });
    container.appendChild(grid);
    container.appendChild(status);
  }

  /* ---------- 3. 颜色辨认（Stroop） ---------- */
  function stroop(container, onDone) {
    stop();
    const COLORS = [
      { name: '红', css: '#D93A3A' },
      { name: '黄', css: '#D9A404' },
      { name: '蓝', css: '#2E6FE0' },
      { name: '绿', css: '#1E8E5A' },
    ];
    const TOTAL = 10;
    let round = 0, score = 0;

    function nextRound() {
      container.innerHTML = '';
      if (round >= TOTAL) {
        /* 不按分数分档给不同表情/评语：做完一组就是做到了 */
        showResult(container, '🎉', `${TOTAL} 题都做完了`,
          `其中 ${score} 题一眼就选对了。这个练的是抗干扰，慢一点更准。`,
          () => onDone(score, `选对${score}/${TOTAL}`), () => { round = 0; score = 0; nextRound(); });
        return;
      }
      round++;
      const word = COLORS[Math.floor(Math.random() * COLORS.length)];
      let ink = COLORS[Math.floor(Math.random() * COLORS.length)];
      if (Math.random() < 0.7) {
        while (ink.name === word.name) ink = COLORS[Math.floor(Math.random() * COLORS.length)];
      }
      container.appendChild(el('div', 'game-status', `第 ${round} / ${TOTAL} 题　不管字义，选出这个字显示的颜色`));
      const w = el('div', 'stroop-word', word.name);
      w.style.color = ink.css;
      container.appendChild(w);
      const grid = el('div', 'answer-grid');
      let answered = false;
      shuffle(COLORS).forEach(c => {
        const btn = el('button', 'answer-btn', c.name + '色');
        btn.style.borderColor = c.css;
        btn.style.color = c.css;
        btn.onclick = () => {
          if (answered) return;
          answered = true;
          if (c.name === ink.name) { score++; btn.classList.add('good'); btn.style.color = '#fff'; }
          else {
            /* 选错不用红色报错，而是把正确的那个点亮，边看边学 */
            btn.classList.add('tryagain');
            grid.querySelectorAll('.answer-btn').forEach(b => {
              if (b.textContent === ink.name + '色') { b.classList.add('good'); b.style.color = '#fff'; }
            });
          }
          setTimeout(nextRound, 900);
        };
        grid.appendChild(btn);
      });
      container.appendChild(grid);
    }
    nextRound();
  }

  /* ---------- 4. 算一算 ----------
     设计要点（卒中后计算障碍很常见，这一局最容易让患者产生挫败与逆反）：
     · 三档难度自选，默认从最容易的开始，且随时可换；
     · 答错不判错、不记分：提示「再看看」可重选，第二次才给出答案与拆解思路；
     · 有「看提示」「跳过这道」，跳过不扣分、不出现红色；
     · 结果只报"做完了几道、自己算出来几道"，不显示对错比分。 */
  const MATH_LEVELS = [
    { key: 'easy', name: '容易（10 以内）', hint: '一位数加减' },
    { key: 'mid', name: '适中（整十为主）', hint: '不用进位退位' },
    { key: 'hard', name: '挑战（两位数）', hint: '含进位退位' },
  ];

  function mathQuestion(level) {
    const r = n => Math.floor(Math.random() * n);
    let a, b, op, ans;
    if (level === 'easy') {
      if (Math.random() < 0.5) {
        a = 1 + r(8); b = 1 + r(9 - a); op = '+'; ans = a + b;
      } else {
        a = 3 + r(7); b = 1 + r(a - 1); op = '−'; ans = a - b;
      }
    } else if (level === 'mid') {
      /* 整十 ± 整十 或 两位数 ± 整十：不产生进位/退位，心算负担最小 */
      if (Math.random() < 0.5) {
        a = (1 + r(6)) * 10; b = (1 + r(3)) * 10; op = '+'; ans = a + b;
      } else {
        a = (3 + r(6)) * 10 + r(10); b = (1 + r(Math.floor(a / 10) - 1)) * 10; op = '−'; ans = a - b;
      }
    } else {
      if (Math.random() < 0.5) {
        a = 10 + r(40); b = 1 + r(30); op = '+'; ans = a + b;
      } else {
        a = 20 + r(60); b = 1 + r(a - 1); op = '−'; ans = a - b;
      }
    }
    return { a, b, op, ans };
  }

  /* 拆解思路：给一步一步的算法，而不是只丢一个答案 */
  function mathExplain(q) {
    const { a, b, op, ans } = q;
    /* 一位数题：不谈"个位/凑十"，直接给最朴素的说法（数着数就行） */
    if (a < 10 && b < 10) {
      return op === '+'
        ? `从 ${a} 往上数 ${b} 个，就是 ${ans}`
        : `从 ${a} 往下数 ${b} 个，就是 ${ans}`;
    }
    /* 整十优先：加减整十最好懂，先说这个，别绕到凑十 */
    if (b % 10 === 0) {
      return op === '+'
        ? `${a} 加 ${b / 10} 个十，就是 ${ans}`
        : `${a} 减 ${b / 10} 个十，就是 ${ans}`;
    }
    if (op === '+') {
      const toTen = 10 - (a % 10);
      /* 要进位：先凑整十再加剩下的 */
      if (a % 10 !== 0 && b > toTen) {
        return `${a} 先加 ${toTen} 凑到 ${a + toTen}，还剩 ${b - toTen} 要加，${a + toTen} + ${b - toTen} = ${ans}`;
      }
      /* 不进位：个位直接相加，十位不动 */
      if (b < 10) return `十位不变，个位 ${a % 10} 加 ${b} 得 ${(a % 10) + b}，就是 ${ans}`;
      return `${a} 先加 ${b - (b % 10)} 得 ${a + b - (b % 10)}，再加 ${b % 10}，就是 ${ans}`;
    }
    const back = a % 10, bTens = b - (b % 10);
    /* a 本身就是整十：没有"退回整十"可言，改成把 b 拆开减 */
    if (back === 0) {
      if (b < 10) return `${a} 拿出一个十，10 − ${b} = ${10 - b}，再加上剩下的 ${a - 10}，就是 ${ans}`;
      return `${a} 先减 ${bTens} 得 ${a - bTens}，再减 ${b % 10}，就是 ${ans}`;
    }
    /* 要退位：先退到整十再减剩下的 */
    if (back < (b % 10) || (b < 10 && b > back)) {
      return `${a} 先减 ${back} 回到整十 ${a - back}，还要再减 ${b - back}，${a - back} − ${b - back} = ${ans}`;
    }
    /* 不退位：个位直接相减 */
    if (b < 10) return `十位不变，个位 ${back} 减 ${b} 得 ${back - b}，就是 ${ans}`;
    return `${a} 先减 ${bTens} 得 ${a - bTens}，再减 ${b % 10}，就是 ${ans}`;
  }

  function math(container, onDone, opts = {}) {
    stop();
    const TOTAL = 6;   // 6 道足够训练，10 道容易变成"考试"
    let level = 'easy';
    let round = 0, solvedSelf = 0, solvedHelp = 0, skipped = 0, missStreak = 0;

    /* 难度选择：把"选容易的"说成正常选项，而不是降级 */
    function chooseLevel() {
      container.innerHTML = '';
      container.appendChild(el('div', 'game-status', '想练哪种？随时可以换'));
      const box = el('div', 'level-list');
      MATH_LEVELS.forEach(L => {
        const btn = el('button', 'level-btn' + (L.key === level ? ' active' : ''));
        btn.appendChild(el('span', 'lv-name', L.name));
        btn.appendChild(el('span', 'lv-hint', L.hint));
        btn.onclick = () => { level = L.key; round = 0; solvedSelf = 0; solvedHelp = 0; skipped = 0; missStreak = 0; nextRound(); };
        box.appendChild(btn);
      });
      container.appendChild(box);
      const note = el('div', 'game-note', '算数对很多脑梗后的人来说都变难了，这很常见。这里没有分数，算不出来看提示也算练到了。');
      container.appendChild(note);
      if (opts.onSwitch) {
        const other = el('button', 'btn ghost block', '🎴 今天不想算数，换个不用算的');
        other.style.marginTop = '0.7rem';
        other.onclick = () => opts.onSwitch('memory');
        container.appendChild(other);
      }
    }

    function finishSet() {
      const parts = [];
      if (solvedSelf) parts.push(`自己算出 ${solvedSelf} 道`);
      if (solvedHelp) parts.push(`看提示后做对 ${solvedHelp} 道`);
      if (skipped) parts.push(`跳过 ${skipped} 道`);
      const detail = `${level === 'easy' ? '容易' : level === 'mid' ? '适中' : '挑战'}档 ${parts.join('、') || '做完一组'}`;
      showResult(container, '🎉', `${TOTAL} 道都做完了`,
        `${parts.join('　·　')}${parts.length ? '。' : ''}想一想的过程就是训练，看提示做对也一样有效。`,
        () => onDone(solvedSelf, detail),
        () => { round = 0; solvedSelf = 0; solvedHelp = 0; skipped = 0; missStreak = 0; nextRound(); },
        chooseLevel);
    }

    function nextRound() {
      container.innerHTML = '';
      if (round >= TOTAL) { finishSet(); return; }
      round++;

      /* 连错两道自动换容易的题：说成"换几道容易的"，不提"降级/答错" */
      let downgraded = false;
      if (missStreak >= 2 && level !== 'easy') {
        level = level === 'hard' ? 'mid' : 'easy';
        missStreak = 0;
        downgraded = true;
      }

      const q = mathQuestion(level);
      const status = el('div', 'game-status');
      status.appendChild(el('span', '', `第 ${round} 道（共 ${TOTAL} 道）`));
      const dots = el('span', 'q-dots');
      for (let i = 0; i < TOTAL; i++) {
        dots.appendChild(el('i', 'q-dot' + (i < round - 1 ? ' on' : '')));
      }
      status.appendChild(dots);
      container.appendChild(status);
      if (downgraded) container.appendChild(el('div', 'game-note calm', '换几道容易的，慢慢来。'));

      container.appendChild(el('div', 'math-q', `${q.a} ${q.op} ${q.b} = ?`));
      const feedback = el('div', 'math-feedback');
      container.appendChild(feedback);

      const opsSet = new Set([q.ans]);
      while (opsSet.size < 4) {
        const delta = Math.floor(Math.random() * 10) - 5;
        const v = q.ans + (delta === 0 ? 6 : delta);
        if (v >= 0) opsSet.add(v);
      }
      const grid = el('div', 'answer-grid');
      let tries = 0, settled = false;

      const advance = () => { setTimeout(nextRound, 950); };

      shuffle([...opsSet]).forEach(v => {
        const btn = el('button', 'answer-btn', String(v));
        btn.onclick = () => {
          if (settled) return;
          if (v === q.ans) {
            settled = true;
            btn.classList.add('good');
            missStreak = 0;
            if (tries === 0) { solvedSelf++; feedback.textContent = ['对了！', '很准。', '就是这个。'][Math.floor(Math.random() * 3)]; }
            else { solvedHelp++; feedback.textContent = '这次对了，就是这么算的。'; }
            feedback.className = 'math-feedback good';
            advance();
            return;
          }
          tries++;
          if (tries === 1) {
            /* 第一次不判错：橙色"再看看"，让患者自己再试，避免"我又错了"的挫败 */
            btn.classList.add('tryagain');
            btn.disabled = true;
            feedback.className = 'math-feedback calm';
            feedback.textContent = '再看看，剩下的里面有一个是对的。';
          } else {
            settled = true;
            missStreak++;
            btn.classList.add('tryagain');
            feedback.className = 'math-feedback calm';
            feedback.textContent = `答案是 ${q.ans}。${mathExplain(q)}`;
            grid.querySelectorAll('.answer-btn').forEach(b => {
              if (b.textContent === String(q.ans)) b.classList.add('good');
              b.disabled = true;
            });
            setTimeout(nextRound, 2600);
          }
        };
        grid.appendChild(btn);
      });
      container.appendChild(grid);

      /* 提示与跳过：都是正常操作，不扣分、不变红 */
      const row = el('div', 'btn-row');
      const hintBtn = el('button', 'btn outline', '💡 看提示');
      hintBtn.onclick = () => {
        feedback.className = 'math-feedback calm';
        feedback.textContent = mathExplain(q);
      };
      const skipBtn = el('button', 'btn outline', '这道先跳过');
      skipBtn.onclick = () => {
        if (settled) return;
        settled = true; skipped++; missStreak++;
        feedback.className = 'math-feedback calm';
        feedback.textContent = '跳过没关系，下一道。';
        advance();
      };
      row.appendChild(hintBtn); row.appendChild(skipBtn);
      container.appendChild(row);

      const foot = el('div', 'game-foot');
      const lvBtn = el('button', 'link-btn', '换难度');
      lvBtn.onclick = chooseLevel;
      foot.appendChild(lvBtn);
      if (opts.onQuit) {
        const quit = el('button', 'link-btn', '先打卡收工');
        quit.onclick = () => opts.onQuit();
        foot.appendChild(quit);
      }
      container.appendChild(foot);
    }

    chooseLevel();
  }

  const registry = { memory, sequence, stroop, math };
  /* opts: { onSwitch(gameKey), onQuit() } —— 供"换个不用算的""先打卡收工"使用，
     由 app.js 负责真正打开另一个动作/打卡，游戏层不碰 Store。 */
  function start(key, container, onDone, opts) {
    const fn = registry[key];
    if (fn) fn(container, onDone, opts || {});
  }
  return { start, stop };
})();
