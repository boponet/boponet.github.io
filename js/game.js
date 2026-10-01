/* The game: board, deal, drag and drop, win wave, and the small menu above the board. */
(function () {
  const { RANKS, RANK_NAMES, SUITS, PAL, RATIO, RADIUS, card, back, f } = window.Cards;

  // The play area is the 9 x 6 deal plus free space on every side: 3 spaces normally, 4 in easy mode.
  let easy, MARGIN, COLS, ROWS, STACK;
  function setMode(on) {
    easy = on; MARGIN = on ? 4 : 3;
    COLS = 9 + 2 * MARGIN; ROWS = 6 + 2 * MARGIN;
    STACK = { r: MARGIN, c: MARGIN + 4 };   // the empty middle space of the top row, where the deck sits
  }
  const T_UP = 45, T_SETTLE = 70, T_GLIDE = 70, T_HOME = 70;
  const DEAL_GAP = 55, DEAL_FLIGHT = 380;
  const WIN_DUR = 520, WAVE_STEP = 85, LINE_FADE = 220;

  const store = {
    get(k, d) { try { const v = localStorage.getItem('rally-solitaire.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('rally-solitaire.' + k, JSON.stringify(v)); } catch (e) {} }
  };
  setMode(store.get('easy', false));
  // wins are counted separately for each mode
  const winsKey = () => easy ? 'winsEasy' : 'wins';
  let wins = store.get(winsKey(), 0);
  Sound.setMuted(store.get('muted', false));
  Sound.setVolume(store.get('volume', .85));   // starts a little under full level

  const boardEl = document.getElementById('board');
  const stageEl = document.getElementById('stage');
  const topEl = document.getElementById('topbar');
  // the two panels over the board, each with its menu button
  const panels = {
    rules: { el: document.getElementById('rules'), btn: document.getElementById('rulesBtn') },
    settings: { el: document.getElementById('settings'), btn: document.getElementById('settingsBtn') }
  };
  const volumeEl = document.getElementById('volume');

  let grid, held = null, landing = null, pending = null, stackEl = null;
  let cursor = null, keyboard = false, busy = false, geo = null, cell = 44, resized = false;
  const wait = ms => new Promise(res => setTimeout(res, ms));

  // ---------- geometry
  function geometry(px) {
    const ch = Math.round(px * RATIO);
    // odd gap, so a 1px hairline sits on a whole pixel with equal space either side
    const gap = Math.max(5, Math.round(px * 0.16)) | 1;
    const m = gap + 5;
    return {
      px, ch, gap, m,
      W: m * 2 + COLS * px + (COLS - 1) * gap, H: m * 2 + ROWS * ch + (ROWS - 1) * gap,
      left: c => m + c * (px + gap), top: r => m + r * (ch + gap),
      arm: Math.max(3, Math.round(Math.min(px, ch) * 0.14)),
      // how far a held card rises, and where its shadow falls
      lx: -Math.max(2, Math.round(px * .05)), ly: -Math.max(3, Math.round(px * .08)),
      sx: Math.max(2, Math.round(px * .06)), sy: Math.max(3, Math.round(px * .1))
    };
  }
  // the largest card width whose board fits the space under the menu
  function fitCell() {
    const w = stageEl.clientWidth, h = stageEl.clientHeight;
    for (let p = 120; p > 14; p--) { const g = geometry(p); if (g.W <= w && g.H <= h) return p; }
    return 14;
  }

  // ---------- drawing: hairline crosses in the gaps, cards on top
  function boardSVG(cells, g, o) {
    const { ch, gap, left, top, arm, px } = g;
    const xs = [...Array(COLS + 1)].map((_, c) => left(c) - gap / 2);
    const ys = [...Array(ROWS + 1)].map((_, r) => top(r) - gap / 2);
    const isCard = (r, c) => r >= 0 && c >= 0 && r < ROWS && c < COLS && !!cells[r][c];
    // one cross per grid point; an arm between two cards is left off, as are arms outside the play area
    let d = '';
    for (let j = 0; j <= ROWS; j++) for (let i = 0; i <= COLS; i++) {
      const X = xs[i], Y = ys[j];
      const tl = isCard(j - 1, i - 1), tr = isCard(j - 1, i), bl = isCard(j, i - 1), br = isCard(j, i);
      if (j > 0 && !(tl && tr)) d += `M${X} ${Y - arm}V${Y}`;
      if (j < ROWS && !(bl && br)) d += `M${X} ${Y}V${Y + arm}`;
      if (i > 0 && !(tl && bl)) d += `M${X - arm} ${Y}H${X}`;
      if (i < COLS && !(tr && br)) d += `M${X} ${Y}H${X + arm}`;
    }
    let body = `<rect width="${g.W}" height="${g.H}" fill="${PAL.board}"/>`;
    if (d) body += `<path d="${d}" stroke="${PAL.line}" stroke-width="1" stroke-linecap="square" fill="none"/>`;

    // each card in its own group with a hidden shadow, drawn from the outside in so the
    // centre sits on top during the win wave
    const skipped = (r, c) => o.skip && o.skip.r === r && o.skip.c === c;
    const list = [];
    let r0 = ROWS, r1 = -1, c0 = COLS, c1 = -1;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (cells[r][c] && !skipped(r, c)) {
      list.push([r, c]); r0 = Math.min(r0, r); r1 = Math.max(r1, r); c0 = Math.min(c0, c); c1 = Math.max(c1, c);
    }
    const cr = (r0 + r1) / 2, cc = (c0 + c1) / 2;
    list.map(([r, c]) => [r, c, Math.hypot(r - cr, (c - cc) * px / ch)]).sort((a, b) => b[2] - a[2]).forEach(([r, c, dist]) => {
      const cd = cells[r][c];
      body += `<g class="cg" data-d="${f(dist)}"><rect class="sh" x="${left(c)}" y="${top(r)}" width="${px}" height="${ch}" rx="${f(px * RADIUS / 100)}" fill="${PAL.shadow}" opacity="0"/>` +
              `<g class="lift">${card(RANKS[cd.r], cd.s, px, { x: left(c), y: top(r), attrs: ` data-r="${r}" data-c="${c}"` })}</g></g>`;
    });
    if (o.cursor) {
      const { r, c } = o.cursor, hw = gap >= 7 ? 3 : 1;
      body += `<path d="M${Math.round(left(c) + px * .25) + .5} ${ys[r + 1]}H${Math.round(left(c) + px * .75) - .5}" stroke="${PAL.highlight}" stroke-width="${hw}" stroke-linecap="square" pointer-events="none"/>`;
    }
    return { svg: `<svg width="${g.W}" height="${g.H}" viewBox="0 0 ${g.W} ${g.H}">${body}</svg>`, lines: d };
  }

  // grid-line segments that disappear between two renders fade out on a layer of their own
  let lastLines = null, lastPx = 0;
  function fadeLost(lines) {
    const now = new Set(lines.split('M').filter(Boolean));
    if (lastLines && lastPx === geo.px) {
      const lost = [...lastLines].filter(x => !now.has(x));
      if (lost.length) {
        const el = document.createElement('div');
        el.className = 'line-fade';
        el.innerHTML = `<svg width="${geo.W}" height="${geo.H}"><path d="M${lost.join('M')}" stroke="${PAL.line}" stroke-width="1" stroke-linecap="square" fill="none"/></svg>`;
        boardEl.appendChild(el);
        el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: LINE_FADE, easing: 'ease-out', fill: 'forwards' });
        setTimeout(() => el.remove(), LINE_FADE);
      }
    }
    lastLines = now; lastPx = geo.px;
  }

  function renderBoard() {
    geo = geometry(cell);
    const cells = grid.map(row => row.slice());
    if (held) cells[held.from.r][held.from.c] = null;   // a held card leaves its cell empty
    if (pending) pending.forEach(k => { const [r, c] = k.split(',').map(Number); cells[r][c] = null; });   // not dealt yet
    const out = boardSVG(cells, geo, { skip: landing, cursor: keyboard ? cursor : null });
    [...boardEl.children].forEach(ch => { if (ch.tagName.toLowerCase() === 'svg') ch.remove(); });
    boardEl.insertAdjacentHTML('afterbegin', out.svg);
    fadeLost(out.lines);
    boardEl.style.width = geo.W + 'px';
    boardEl.style.height = geo.H + 'px';
    topEl.style.width = geo.W + 'px';
  }
  function renderMenu() {
    document.querySelector('#wins span').textContent = String(wins).padStart(2, '0');
    document.querySelectorAll('[data-difficulty]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.difficulty === 'easy') === easy)));
    const mute = document.getElementById('mute');
    mute.textContent = Sound.isMuted() ? 'unmute' : 'mute';
    mute.setAttribute('aria-pressed', String(Sound.isMuted()));
    showVolume();
    volumeEl.disabled = Sound.isMuted();
  }

  // ---------- rules of play
  const inB = (r, c) => r >= 0 && c >= 0 && r < ROWS && c < COLS;
  const at = (r, c) => inB(r, c) ? grid[r][c] : null;
  // opposite colour, one rank apart, with the ace joining both the 2 and the king
  const links = (a, b) => SUITS[a.s].light !== SUITS[b.s].light && [1, 12].includes((a.r - b.r + 13) % 13);
  const nbrs = (r, c) => [at(r - 1, c), at(r + 1, c), at(r, c - 1), at(r, c + 1)].filter(Boolean);
  // a card can move only when two of its free edges share a corner
  const movable = (r, c) => { const t = !at(r - 1, c), b = !at(r + 1, c), l = !at(r, c - 1), rt = !at(r, c + 1); return (t || b) && (l || rt); };
  const valid = (r, c) => { const n = nbrs(r, c); return n.length > 0 && n.every(o => links(grid[r][c], o)); };
  function connected() {
    let start = null, total = 0;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (grid[r][c]) { total++; start = start || [r, c]; }
    const seen = new Set([start.join()]), q = [start];
    while (q.length) {
      const [r, c] = q.pop();
      [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].forEach(([y, x]) => { if (at(y, x) && !seen.has(y + ',' + x)) { seen.add(y + ',' + x); q.push([y, x]); } });
    }
    return seen.size === total;
  }
  // the destination must be valid, and every card must be connected once the move is made
  function canPlace(from, r, c) {
    if (!inB(r, c) || (r === from.r && c === from.c)) return false;
    const cd = grid[from.r][from.c];
    grid[from.r][from.c] = null;
    let ok = !grid[r][c];
    if (ok) { grid[r][c] = cd; ok = valid(r, c) && connected(); grid[r][c] = null; }
    grid[from.r][from.c] = cd;
    return ok;
  }
  function allValid() {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (grid[r][c] && !valid(r, c)) return false;
    return true;
  }

  // ---------- the deal: 9 wide by 6 tall, the middle of the top and bottom rows left empty
  function shuffle() {
    const deck = [];
    for (const s of 'HDSC') for (let r = 0; r < 13; r++) deck.push({ r, s });
    for (let k = deck.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [deck[k], deck[j]] = [deck[j], deck[k]]; }
    grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    let n = 0;
    for (let row = 0; row < 6; row++) for (let col = 0; col < 9; col++) {
      if ((row === 0 || row === 5) && col === 4) continue;
      grid[row + MARGIN][col + MARGIN] = deck[n++];
    }
  }
  // bottom row first, left to right, finishing each row before the next
  function dealOrder() {
    const out = [];
    for (let row = 5; row >= 0; row--) for (let col = 0; col < 9; col++) {
      if ((row === 0 || row === 5) && col === 4) continue;
      out.push({ r: row + MARGIN, c: col + MARGIN });
    }
    return out;
  }
  // the face-down stack loses a layer for every four cards dealt
  const stackLayers = n => Math.min(13, Math.ceil(n / 4));
  const stackStep = px => Math.max(.5, px * .016);
  function renderStack(n) {
    if (!stackEl) { stackEl = document.createElement('div'); stackEl.className = 'stack'; boardEl.appendChild(stackEl); }
    const g = geo, o = stackStep(g.px), L = stackLayers(n);
    stackEl.style.cssText = `left:${g.left(STACK.c)}px;top:${g.top(STACK.r)}px;width:${g.px}px;height:${g.ch}px`;
    let h = n ? `<div class="stack-sh" style="background:${PAL.shadow};border-radius:${f(g.px * RADIUS / 100)}px;transform:translate(${g.sx}px,${g.sy}px)"></div>` : '';
    for (let k = 0; k < L; k++) h += `<div class="layer" style="transform:translate(${f(-k * o)}px,${f(-k * o)}px)">${back(g.px, true)}</div>`;
    stackEl.innerHTML = h;
  }
  function flyOut({ r, c }, left) {
    const g = geo, o = stackStep(g.px), topLayer = stackLayers(left) - 1;
    const x0 = g.left(STACK.c) - topLayer * o, y0 = g.top(STACK.r) - topLayer * o;
    renderStack(left - 1);
    Sound.play('leave');
    const cd = grid[r][c], el = document.createElement('div');
    el.className = 'float';
    el.style.cssText = `left:${g.left(c)}px;top:${g.top(r)}px;width:${g.px}px;height:${g.ch}px`;
    el.innerHTML = `<div class="sh" style="background:${PAL.shadow};border-radius:${f(g.px * RADIUS / 100)}px"></div><div class="fc">${card(RANKS[cd.r], cd.s, g.px)}</div>`;
    boardEl.appendChild(el);
    const dx = x0 - g.left(c), dy = y0 - g.top(r), opts = { duration: DEAL_FLIGHT, easing: 'cubic-bezier(.33,.15,.45,1)', fill: 'both' };
    el.querySelector('.fc').animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: `translate(${g.lx}px, ${g.ly}px)`, offset: .8 }, { transform: 'translate(0px, 0px)' }], opts);
    el.querySelector('.sh').animate([{ transform: `translate(${dx + g.sx}px, ${dy + g.sy}px)`, opacity: .3 }, { transform: `translate(${g.sx}px, ${g.sy}px)`, opacity: .3, offset: .8 }, { transform: 'translate(0px, 0px)', opacity: 0 }], opts);
    return wait(DEAL_FLIGHT).then(() => { pending.delete(r + ',' + c); renderBoard(); el.remove(); });
  }
  async function newGame(withSound) {
    shuffle();
    if (withSound) Sound.play('deal');
    busy = true;
    const order = dealOrder();
    pending = new Set(order.map(p => p.r + ',' + p.c));
    renderBoard();
    renderStack(order.length);
    await Promise.all(order.map((p, k) => wait(k * DEAL_GAP).then(() => flyOut(p, order.length - k))));
    stackEl.remove(); stackEl = null; pending = null; busy = false;
    afterBusy();
  }

  // ---------- holding a card
  function pickUp(r, c) {
    const cd = grid[r][c], g = geo;
    const el = document.createElement('div');
    el.className = 'float';
    el.style.cssText = `left:${g.left(c)}px;top:${g.top(r)}px;width:${g.px}px;height:${g.ch}px;--lx:${g.lx}px;--ly:${g.ly}px;--sx:${g.sx}px;--sy:${g.sy}px;--t-lift:${T_UP}ms`;
    el.innerHTML = `<div class="sh" style="background:${PAL.shadow};border-radius:${f(g.px * RADIUS / 100)}px"></div><div class="fc">${card(RANKS[cd.r], cd.s, g.px)}</div>`;
    boardEl.appendChild(el);
    held = { from: { r, c }, el };
    Sound.play('pick');
    renderBoard();
    el.getBoundingClientRect();          // commit the resting frame so the lift animates
    el.classList.add('up');
  }
  function moveHeld(x, y) {
    held.el.style.left = Math.max(0, Math.min(geo.W - geo.px, x)) + 'px';
    held.el.style.top = Math.max(0, Math.min(geo.H - geo.ch, y)) + 'px';
  }
  async function glideTo(r, c, ms, el = held.el) {
    el.style.setProperty('--t-glide', ms + 'ms');
    el.classList.add('glide');
    el.style.left = geo.left(c) + 'px';
    el.style.top = geo.top(r) + 'px';
    await wait(ms);
    el.classList.remove('glide');
  }
  async function dropAt(r, c) {
    const { from, el } = held;
    busy = true;
    const ok = canPlace(from, r, c);
    const dest = ok ? { r, c } : from;
    // commit straight away so the grid lines update on release; the floating card
    // finishes its landing on top and then hands over to the board
    if (ok) { grid[r][c] = grid[from.r][from.c]; grid[from.r][from.c] = null; }
    held = null; landing = dest;
    if (keyboard) cursor = { ...dest };
    renderBoard();
    Sound.play(ok ? 'drop' : 'back');
    el.style.setProperty('--t-lift', T_SETTLE + 'ms');
    el.classList.remove('up');
    await Promise.all([glideTo(dest.r, dest.c, ok ? T_GLIDE : T_HOME, el), wait(T_SETTLE)]);
    el.remove(); landing = null; busy = false;
    renderBoard();
    if (ok && allValid()) win();
    else afterBusy();
  }
  function shake(r, c) {
    Sound.play('locked');
    const t = boardEl.querySelector(`[data-r="${r}"][data-c="${c}"]`);
    if (!t) return;
    t.parentNode.animate([{ transform: 'translate(0px,0px)' }, { transform: 'translate(-3px,0px)' }, { transform: 'translate(3px,0px)' }, { transform: 'translate(-2px,0px)' }, { transform: 'translate(0px,0px)' }], { duration: 240, easing: 'ease-out' });
  }

  // ---------- win: every card lifts and settles, in a wave from the centre out
  function win() {
    wins++; store.set(winsKey(), wins); renderMenu();
    const w = document.getElementById('wins');
    w.classList.add('bump'); setTimeout(() => w.classList.remove('bump'), 900);
    const groups = [...boardEl.querySelectorAll('.cg')];
    const rings = [...new Set(groups.map(cg => Math.round(+cg.dataset.d)))].sort((a, b) => a - b).map(i => ({ i, t: i * WAVE_STEP / 1000 }));
    Sound.play('win', rings);
    busy = true;
    const g = geo, L = `translate(${g.lx}px, ${g.ly}px)`, S = `translate(${g.sx}px, ${g.sy}px)`, rest = 'translate(0px, 0px)';
    let end = 0;
    groups.forEach(cg => {
      const delay = +cg.dataset.d * WAVE_STEP, opts = { duration: WIN_DUR, delay, easing: 'cubic-bezier(.3,0,.3,1)' };
      cg.querySelector('.lift').animate([{ transform: rest }, { transform: L, offset: .3 }, { transform: L, offset: .6 }, { transform: rest }], opts);
      cg.querySelector('.sh').animate([{ opacity: 0, transform: rest }, { opacity: .3, transform: S, offset: .3 }, { opacity: .3, transform: S, offset: .6 }, { opacity: 0, transform: rest }], opts);
      end = Math.max(end, delay + WIN_DUR);
    });
    setTimeout(() => { busy = false; afterBusy(); }, end);
  }

  // ---------- pointer
  let press = null;
  const toBoard = e => { const b = boardEl.querySelector('svg').getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  boardEl.addEventListener('pointerdown', e => {
    if (busy || held || e.button > 0) return;
    const t = e.target.closest('[data-r]'); if (!t) return;
    const r = +t.dataset.r, c = +t.dataset.c;
    if (keyboard) { keyboard = false; renderBoard(); }
    if (!movable(r, c)) { shake(r, c); return; }
    const p = toBoard(e);
    press = { offX: p.x - geo.left(c), offY: p.y - geo.top(r), id: e.pointerId };
    boardEl.setPointerCapture(e.pointerId);
    e.preventDefault();
    pickUp(r, c);
    boardEl.classList.add('dragging');
  });
  boardEl.addEventListener('pointermove', e => {
    if (!press || e.pointerId !== press.id || !held) return;
    const p = toBoard(e);
    moveHeld(p.x - press.offX, p.y - press.offY);
  });
  const release = cancel => e => {
    if (!press || e.pointerId !== press.id) return;
    press = null;
    boardEl.classList.remove('dragging');
    if (!held) return;
    // the card goes to the space under the pointer (a gap counts toward its nearer side)
    const p = toBoard(e);
    const c = Math.floor((p.x - geo.m + geo.gap / 2) / (geo.px + geo.gap)), r = Math.floor((p.y - geo.m + geo.gap / 2) / (geo.ch + geo.gap));
    dropAt(cancel ? -1 : r, cancel ? -1 : c);
  };
  boardEl.addEventListener('pointerup', release(false));
  boardEl.addEventListener('pointercancel', release(true));

  // ---------- keyboard: cursor keys to make your selection, return to confirm
  boardEl.addEventListener('keydown', e => {
    if (busy) return;
    const mv = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (!mv && !['Enter', ' ', 'Escape'].includes(e.key)) return;
    e.preventDefault();
    if (!keyboard) { keyboard = true; cursor = cursor || { r: MARGIN, c: MARGIN }; if (!mv) { renderBoard(); return; } }
    if (mv) {
      cursor = { r: Math.min(ROWS - 1, Math.max(0, cursor.r + mv[0])), c: Math.min(COLS - 1, Math.max(0, cursor.c + mv[1])) };
      renderBoard();
      if (held) glideTo(cursor.r, cursor.c, T_GLIDE);
    } else if (e.key === 'Escape') { if (held) dropAt(-1, -1); }
    else if (held) dropAt(cursor.r, cursor.c);
    else if (grid[cursor.r][cursor.c]) { if (movable(cursor.r, cursor.c)) pickUp(cursor.r, cursor.c); else shake(cursor.r, cursor.c); }
  });
  boardEl.addEventListener('blur', () => { if (keyboard && !held) { keyboard = false; renderBoard(); } });

  // ---------- menu
  // one panel open at a time; null closes whichever is open
  let openPanel = null;
  function showPanel(name) {
    const was = openPanel;
    openPanel = name;
    Object.entries(panels).forEach(([k, p]) => { p.el.hidden = k !== name; p.btn.setAttribute('aria-expanded', String(k === name)); });
    if (name) panels[name].el.querySelector('.panel-close').focus();
    else if (was) panels[was].btn.focus();
  }
  document.getElementById('restart').addEventListener('click', () => {
    if (busy || held) return;
    showPanel(null);   // the restart sound covers the close
    newGame(true);
  });
  Object.entries(panels).forEach(([name, p]) => {
    p.btn.addEventListener('click', () => { showPanel(openPanel === name ? null : name); Sound.play('click'); });
    p.el.querySelector('.panel-close').addEventListener('click', () => { showPanel(null); Sound.play('click'); });
    p.el.addEventListener('keydown', e => { if (e.key === 'Escape') { showPanel(null); Sound.play('click'); } });
  });

  // difficulty: easy gives the deal one more space of room on every side; changing it deals a new game
  document.querySelectorAll('[data-difficulty]').forEach(b => b.addEventListener('click', () => {
    const on = b.dataset.difficulty === 'easy';
    if (on === easy || busy || held) return;
    setMode(on); store.set('easy', easy);
    wins = store.get(winsKey(), 0);
    cursor = null; lastLines = null;
    cell = fitCell();
    renderMenu();
    showPanel(null);   // close so the new deal can be seen
    newGame(true);
  }));
  // volume: the slider sets the level, mute silences without losing it
  function showVolume() {
    const v = Math.round(Sound.getVolume() * 100);
    volumeEl.value = v;
    volumeEl.style.setProperty('--fill', v + '%');
    document.getElementById('volumeOut').textContent = v;
  }
  volumeEl.addEventListener('input', () => { Sound.setVolume(volumeEl.value / 100); store.set('volume', Sound.getVolume()); showVolume(); });
  volumeEl.addEventListener('change', () => Sound.play('drop'));   // a sample at the new level
  document.getElementById('mute').addEventListener('click', () => {
    Sound.setMuted(!Sound.isMuted()); store.set('muted', Sound.isMuted()); renderMenu();
    Sound.play('click');
  });

  // a soft tick when the pointer moves onto a button that lights up white (buttons already
  // white, because they are selected or open, stay quiet)
  document.addEventListener('pointerover', e => {
    if (e.pointerType !== 'mouse') return;
    const b = e.target.closest('button');
    if (!b || b.disabled || b.contains(e.relatedTarget)) return;
    if (b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-expanded') === 'true') return;
    Sound.play('hover');
  });

  // ---------- fit the board to the window
  function afterBusy() { if (resized) { resized = false; fit(); } }
  function fit() {
    const px = fitCell();
    if (px === cell && geo) return;
    if (busy || held) { resized = true; return; }   // wait until the board is still
    cell = px;
    renderBoard();
  }
  window.addEventListener('resize', fit);

  cell = fitCell();
  renderMenu();
  newGame(false);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!busy && !held) renderBoard(); });
})();
