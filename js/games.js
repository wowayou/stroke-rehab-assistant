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
  function showResult(container, icon, text, sub, onDone, replay) {
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
              `共翻牌 ${moves} 次`, () => onDone(moves, `翻牌${moves}次`), () => memory(container, onDone)), 400);
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
              `用时 ${used} 秒`, () => onDone(used, `用时${used}秒`), () => sequence(container, onDone)), 300);
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
        showResult(container, score >= 8 ? '🎉' : '👍', `答对 ${score} / ${TOTAL} 题`,
          score >= 8 ? '非常棒！' : '继续加油！',
          () => onDone(score, `答对${score}/${TOTAL}`), () => { round = 0; score = 0; nextRound(); });
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
          else { btn.classList.add('bad'); btn.style.color = '#fff'; }
          setTimeout(nextRound, 650);
        };
        grid.appendChild(btn);
      });
      container.appendChild(grid);
    }
    nextRound();
  }

  /* ---------- 4. 算一算 ---------- */
  function math(container, onDone) {
    stop();
    const TOTAL = 10;
    let round = 0, score = 0;

    function nextRound() {
      container.innerHTML = '';
      if (round >= TOTAL) {
        showResult(container, score >= 8 ? '🎉' : '👍', `答对 ${score} / ${TOTAL} 题`,
          score >= 8 ? '头脑很灵活！' : '每天练练更熟练！',
          () => onDone(score, `答对${score}/${TOTAL}`), () => { round = 0; score = 0; nextRound(); });
        return;
      }
      round++;
      let a, b, op, ans;
      if (Math.random() < 0.5) {
        a = 10 + Math.floor(Math.random() * 40);
        b = 1 + Math.floor(Math.random() * 30);
        op = '+'; ans = a + b;
      } else {
        a = 20 + Math.floor(Math.random() * 60);
        b = 1 + Math.floor(Math.random() * (a - 1));
        op = '−'; ans = a - b;
      }
      container.appendChild(el('div', 'game-status', `第 ${round} / ${TOTAL} 题`));
      container.appendChild(el('div', 'math-q', `${a} ${op} ${b} = ?`));
      const opts = new Set([ans]);
      while (opts.size < 4) {
        const delta = Math.floor(Math.random() * 10) - 5;
        const v = ans + (delta === 0 ? 6 : delta);
        if (v >= 0) opts.add(v);
      }
      const grid = el('div', 'answer-grid');
      let answered = false;
      shuffle([...opts]).forEach(v => {
        const btn = el('button', 'answer-btn', String(v));
        btn.onclick = () => {
          if (answered) return;
          answered = true;
          if (v === ans) { score++; btn.classList.add('good'); }
          else btn.classList.add('bad');
          setTimeout(nextRound, 650);
        };
        grid.appendChild(btn);
      });
      container.appendChild(grid);
    }
    nextRound();
  }

  const registry = { memory, sequence, stroop, math };
  function start(key, container, onDone) {
    const fn = registry[key];
    if (fn) fn(container, onDone);
  }
  return { start, stop };
})();
