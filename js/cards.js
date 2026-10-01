/* Card faces and the card back, drawn as SVG strings. */
(function () {
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const RANK_NAMES = ['ace', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'jack', 'queen', 'king'];
  // only the colour matters to the rules: hearts and diamonds are "light", spades and clubs "dark"
  const SUITS = { H: { name: 'hearts', light: true }, D: { name: 'diamonds', light: true }, S: { name: 'spades', light: false }, C: { name: 'clubs', light: false } };
  const PIPS = {
    H: '<path d="M50 92C30 75 4 58 4 32C4 16 16 6 29 6C39 6 46 12 50 21C54 12 61 6 71 6C84 6 96 16 96 32C96 58 70 75 50 92Z"/>',
    D: '<path d="M50 3L88 50L50 97L12 50Z"/>',
    S: '<path d="M50 4C62 22 96 38 96 62C96 76 85 84 73 84C64 84 57 80 53 73C54 83 58 90 66 96H34C42 90 46 83 47 73C43 80 36 84 27 84C15 84 4 76 4 62C4 38 38 22 50 4Z"/>',
    C: '<circle cx="50" cy="28" r="21"/><circle cx="27" cy="60" r="21"/><circle cx="73" cy="60" r="21"/><circle cx="50" cy="55" r="10"/><path d="M45 55H55C55 75 58 88 66 96H34C42 88 45 75 45 55Z"/>'
  };

  // white & coral
  const PAL = {
    board: '#9cb3b4', line: '#d7ebe1', highlight: '#ffffff', shadow: '#1e3435',
    lightFace: '#ffffff', lightInk: '#d0573c', darkFace: '#6b8586', darkInk: '#ffffff',
    back: '#56706f', backLine: '#d7ebe1'
  };
  const RATIO = 1.4;    // card height / width
  const RADIUS = 3;     // corner radius, % of card width
  const H = 100 * RATIO;

  const f = n => +n.toFixed(2);
  const DIGIT = 0.556, TRACK = -0.05;   // Arial digit advance and the menu's tight tracking, in em

  // lowercase, regular weight; every rank shares one baseline
  function rankText(rank, cx, cy, fs, fill) {
    const label = /[AJQK]/.test(rank) ? rank.toLowerCase() : rank;
    const base = cy + 0.3 * fs;
    const a = `font-size="${f(fs)}" font-weight="400" fill="${fill}" text-anchor="middle"`;
    if (label === '10') {   // set the two digits by hand so tight tracking works everywhere
      const off = (DIGIT + TRACK) * fs / 2;
      return `<text x="${f(cx - off)}" y="${f(base)}" ${a}>1</text><text x="${f(cx + off)}" y="${f(base)}" ${a}>0</text>`;
    }
    return `<text x="${f(cx)}" y="${f(base)}" ${a}>${label}</text>`;
  }
  function pip(suit, x, y, s, fill) {
    return `<g transform="translate(${f(x - s / 2)} ${f(y - s / 2)}) scale(${f(s / 100)})" fill="${fill}">${PIPS[suit]}</g>`;
  }

  // a card face; pos {x, y, attrs} nests it inside a board svg
  function card(rank, suit, px, pos) {
    const light = SUITS[suit].light;
    const face = light ? PAL.lightFace : PAL.darkFace, ink = light ? PAL.lightInk : PAL.darkInk;
    let b = `<rect width="100" height="${H}" rx="${RADIUS}" fill="${face}"/>`;
    // below 34px the pip drops out and the rank takes the middle
    if (px < 34) b += rankText(rank, 50, H / 2 - 4, 70, ink);
    else b += rankText(rank, 50, 56, 62, ink) + pip(suit, 50, 108, 26, ink);
    const at = pos ? ` x="${f(pos.x)}" y="${f(pos.y)}"${pos.attrs || ''}` : '';
    return `<svg${at} width="${px}" height="${Math.round(px * RATIO)}" viewBox="0 0 100 ${H}" role="img" aria-label="${RANK_NAMES[RANKS.indexOf(rank)]} of ${SUITS[suit].name}" font-family="Arimo, Arial, Helvetica, sans-serif">${b}</svg>`;
  }

  // the back: the board's crosses inside a hairline border; edge adds the side of a stacked layer
  function back(px, edge) {
    const i = 7, hair = `fill="none" stroke="${PAL.backLine}" stroke-width="1" vector-effect="non-scaling-stroke"`;
    let b = `<rect width="100" height="${H}" rx="${RADIUS}" fill="${PAL.back}"/>`;
    b += `<rect x="${i}" y="${i}" width="${100 - 2 * i}" height="${H - 2 * i}" rx="${f(Math.max(0, RADIUS - i / 2))}" ${hair}/>`;
    const step = 14, arm = 2.5;   // in card units, so the pattern scales with the card
    const nx = Math.floor((100 - 2 * i - 8) / step), ny = Math.floor((H - 2 * i - 8) / step);
    let d = '';
    for (let a = 0; a <= nx; a++) for (let c = 0; c <= ny; c++) {
      const x = 50 - step * nx / 2 + a * step, y = H / 2 - step * ny / 2 + c * step;
      d += `M${f(x - arm)} ${f(y)}H${f(x + arm)}M${f(x)} ${f(y - arm)}V${f(y + arm)}`;
    }
    b += `<path d="${d}" ${hair}/>`;
    if (edge) {
      const e = 50 / px;   // half a screen pixel, in card units
      b += `<rect x="${f(e)}" y="${f(e)}" width="${f(100 - 2 * e)}" height="${f(H - 2 * e)}" rx="${RADIUS}" fill="none" stroke="${PAL.shadow}" stroke-opacity=".45" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
    }
    return `<svg width="${px}" height="${Math.round(px * RATIO)}" viewBox="0 0 100 ${H}" aria-hidden="true">${b}</svg>`;
  }

  window.Cards = { RANKS, RANK_NAMES, SUITS, PAL, RATIO, RADIUS, card, back, f };
})();
