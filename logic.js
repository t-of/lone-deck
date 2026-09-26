// LONE DECK の決まりごと（クロンダイク 1 枚めくり、山は何度でも戻せる）。画面（DOM）に触らない部分をここに集める。
// main.js（ブラウザ）と tools/solve.mjs・tools/test.mjs（node）から読む。
//
// 札は 0〜51 の番号。suit = floor(c / 13)（0 ♠ 1 ♥ 2 ♣ 3 ♦）、rank = c % 13 + 1（1 = A … 13 = K）。赤は ♥ と ♦（suit が奇数）。
// 場の置き場所: 's' 山札、'w' めくった札、'f0'〜'f3' 置き場（マークごとに決まった場所。f{suit}）、't0'〜't6' 列。
// 手は文字列: 'd' = 山をめくる（山が空なら、めくった札を山に戻す）、'w>t3'、't2>f1'、't2>t5*3'（表の札 3 枚をまとめて）。

export const SUITS = ['♠', '♥', '♣', '♦'];
export const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const suitOf = (c) => Math.floor(c / 13);
export const rankOf = (c) => (c % 13) + 1;
export const isRed = (c) => suitOf(c) % 2 === 1;

// 決まった式の乱数（mulberry32）。同じ番号なら、どの端末でも同じ並び
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 配り: 札をまぜて、列 i に i+1 枚（一番上だけ表）、残り 24 枚が山札（配列の最後が山の一番上）
export function deal(seed) {
  const rnd = mulberry32(seed);
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  let k = 0;
  const tab = [];
  for (let i = 0; i < 7; i++) {
    const cards = deck.slice(k, k + i + 1);
    k += i + 1;
    tab.push({ down: cards.slice(0, -1), up: cards.slice(-1) });
  }
  return { stock: deck.slice(k), waste: [], found: [[], [], [], []], tab };
}

export const clone = (s) => ({
  stock: s.stock.slice(),
  waste: s.waste.slice(),
  found: s.found.map((f) => f.slice()),
  tab: s.tab.map((t) => ({ down: t.down.slice(), up: t.up.slice() })),
});

const top = (a) => a[a.length - 1];

export const parseMove = (m) => {
  if (m === 'd') return { draw: true };
  const [from, rest] = m.split('>');
  const [to, n] = rest.split('*');
  return { from, to, n: n ? Number(n) : 1 };
};
export const moveStr = (from, to, n = 1) => `${from}>${to}${n > 1 ? `*${n}` : ''}`;

// 置き場所の一番上から n 枚（動かす札）。取れなければ null
function takeable(s, from, n) {
  const k = from[0], i = Number(from.slice(1));
  if (k === 'w') return n === 1 && s.waste.length ? [top(s.waste)] : null;
  if (k === 'f') return n === 1 && s.found[i]?.length ? [top(s.found[i])] : null;
  if (k === 't') {
    const up = s.tab[i]?.up;
    return up && n >= 1 && n <= up.length ? up.slice(up.length - n) : null;
  }
  return null;
}

// 札 c（ひと続きなら一番下の札）を to に置けるか
export function fits(s, c, to, n = 1) {
  const k = to[0], i = Number(to.slice(1));
  if (k === 'f') return n === 1 && i === suitOf(c) && s.found[i].length === rankOf(c) - 1;
  if (k === 't') {
    const t = s.tab[i];
    if (!t) return false;
    if (!t.up.length && !t.down.length) return rankOf(c) === 13;
    const u = top(t.up);
    return u != null && rankOf(u) === rankOf(c) + 1 && isRed(u) !== isRed(c);
  }
  return false;
}

export function isLegal(s, m) {
  if (m === 'd') return s.stock.length > 0 || s.waste.length > 0;
  const { from, to, n } = parseMove(m);
  if (from === to) return false;
  const cards = takeable(s, from, n);
  return !!cards && fits(s, cards[0], to, n);
}

// 手を当てた新しい場を返す（決まりどおりでなければ null）。列の一番上が裏になったら表にする（手数に数えない）
export function play(s, m) {
  if (!isLegal(s, m)) return null;
  const r = clone(s);
  if (m === 'd') {
    if (r.stock.length) r.waste.push(r.stock.pop());
    else { r.stock = r.waste.reverse(); r.waste = []; }
    return r;
  }
  const { from, to, n } = parseMove(m);
  const fi = Number(from.slice(1)), ti = Number(to.slice(1));
  let cards;
  if (from === 'w') cards = [r.waste.pop()];
  else if (from[0] === 'f') cards = [r.found[fi].pop()];
  else {
    const t = r.tab[fi];
    cards = t.up.splice(t.up.length - n, n);
    if (!t.up.length && t.down.length) t.up.push(t.down.pop());
  }
  if (to[0] === 'f') r.found[ti].push(...cards);
  else r.tab[ti].up.push(...cards);
  return r;
}

// 配りの番号と手の並びから場を作り直す（途中の局の続き・戻す）。途中で決まりに合わない手があれば null
export function replay(seed, moves) {
  let s = deal(seed);
  for (const m of moves) {
    s = play(s, m);
    if (!s) return null;
  }
  return s;
}

export const foundCount = (s) => s.found.reduce((a, f) => a + f.length, 0);
export const isWon = (s) => foundCount(s) === 52;

// 決まりどおりの手をすべて（置き場から列へ、も含む）
export function legalMoves(s) {
  const out = [];
  const froms = ['w', 'f0', 'f1', 'f2', 'f3'];
  const tos = ['f0', 'f1', 'f2', 'f3', 't0', 't1', 't2', 't3', 't4', 't5', 't6'];
  for (const from of froms) for (const to of tos) if (isLegal(s, moveStr(from, to))) out.push(moveStr(from, to));
  s.tab.forEach((t, i) => {
    for (let n = 1; n <= t.up.length; n++) {
      for (const to of tos) {
        const m = moveStr(`t${i}`, to, n);
        if (isLegal(s, m)) out.push(m);
      }
    }
  });
  if (isLegal(s, 'd')) out.push('d');
  return out;
}

// 意味のある手（ヒント・行きづまりの判定用）。行ったり来たりするだけの列の移し替えは数えない。よさそうな順
export function usefulMoves(s) {
  const out = [];
  const tos = ['t0', 't1', 't2', 't3', 't4', 't5', 't6'];
  // 列 → 置き場
  s.tab.forEach((t, i) => { const c = top(t.up); if (c != null && fits(s, c, `f${suitOf(c)}`)) out.push(moveStr(`t${i}`, `f${suitOf(c)}`)); });
  // 列 → 列: 表のひと続きを全部動かして、裏の札をめくる・列を空ける／一部を動かして、残った札を置き場に積めるようにする
  s.tab.forEach((t, i) => {
    for (let n = 1; n <= t.up.length; n++) {
      const all = n === t.up.length;
      const rest = t.up[t.up.length - n - 1];
      const helps = all ? (t.down.length > 0) : fits(s, rest, `f${suitOf(rest)}`);
      for (const to of tos) {
        if (to === `t${i}`) continue;
        const empty = !s.tab[Number(to[1])].up.length;
        if (all && !t.down.length && empty) continue;    // K から始まる列を空いた列へ移すだけ
        if (!helps && !(all && !empty)) continue;         // 何も変わらない
        const m = moveStr(`t${i}`, to, n);
        if (isLegal(s, m)) out.push(m);
      }
    }
  });
  // めくった札 → 置き場・列
  const w = top(s.waste);
  if (w != null) {
    if (fits(s, w, `f${suitOf(w)}`)) out.push(moveStr('w', `f${suitOf(w)}`));
    for (const to of tos) if (fits(s, w, to)) out.push(moveStr('w', to));
  }
  return out;
}

// 山札・めくった札の中に、どこかへ置ける札があるか（山を何周してもよいので、並びの順は関係ない）
export function talonHasPlay(s) {
  const tos = ['t0', 't1', 't2', 't3', 't4', 't5', 't6'];
  return [...s.stock, ...s.waste].some((c) => fits(s, c, `f${suitOf(c)}`) || tos.some((to) => fits(s, c, to)));
}

// 行きづまり: 山を全部めくっても、どこにも置けない
export const isStuck = (s) => !isWon(s) && usefulMoves(s).length === 0 && !talonHasPlay(s);

// ヒント: 動かせる手を 1 つ（一番よい手とは限らない）。今すぐ動かせなければ、置ける札が山にあるときは 'd'
export function hint(s) {
  const u = usefulMoves(s);
  if (u.length) return u[0];
  return talonHasPlay(s) ? 'd' : null;
}

// タップしたときの行き先。置き場に置けるなら置き場、だめなら列（札のある列 → 空いた列の順）
export function bestTarget(s, from, n = 1) {
  const cards = takeable(s, from, n);
  if (!cards) return null;
  const c = cards[0];
  if (n === 1 && from[0] !== 'f' && fits(s, c, `f${suitOf(c)}`)) return `f${suitOf(c)}`;
  const tos = [0, 1, 2, 3, 4, 5, 6].map((i) => `t${i}`).filter((to) => to !== from);
  const fill = tos.filter((to) => s.tab[Number(to[1])].up.length && fits(s, c, to));
  if (fill.length) return fill[0];
  // K を空いた列へ: 列の一番下の K を動かしても変わらないので、裏の札があるか、列の途中からのときだけ
  const t = from[0] === 't' ? s.tab[Number(from[1])] : null;
  if (t && !t.down.length && n === t.up.length) return null;
  return tos.find((to) => !s.tab[Number(to[1])].up.length && fits(s, c, to)) || null;
}

// 全部積む: 列の札が全部表で、山札もめくった札もないとき
export const canAutoFinish = (s) => !isWon(s) && !s.stock.length && !s.waste.length && s.tab.every((t) => !t.down.length);

// 全部積む手の並び（一番小さい札から順に置き場へ）
export function autoFinishMoves(s) {
  const out = [];
  let cur = s;
  while (!isWon(cur)) {
    let best = null;
    cur.tab.forEach((t, i) => {
      const c = top(t.up);
      if (c != null && fits(cur, c, `f${suitOf(c)}`) && (best == null || rankOf(c) < rankOf(best.c))) best = { c, m: moveStr(`t${i}`, `f${suitOf(c)}`) };
    });
    if (!best) return null;
    out.push(best.m);
    cur = play(cur, best.m);
  }
  return out;
}

// ---- 日付（端末の時計の 0 時で変わる） ----

export function dateKey(d = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const dayNumber = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};

// 今日の配り: 日付から一覧の番号を 1 つ決める（日ごとにとびとびに選ぶ。全員同じ）
export function dailyDeal(key, deals) {
  const x = Math.imul(dayNumber(key) ^ 0x5bd1e995, 0x2c1b3c6d) >>> 0;
  return deals[((x ^ (x >>> 15)) >>> 0) % deals.length];
}

// 今日の配りを続けて勝った日数（今日がまだなら昨日まで）
export function dailyStreak(days, today) {
  const [y, m, d] = today.split('-').map(Number);
  let i = days[today]?.won ? 0 : 1, n = 0;
  while (days[dateKey(new Date(y, m - 1, d - i))]?.won) { n++; i++; }
  return n;
}

export function recentDays(days, today, count = 14) {
  const [y, m, d] = today.split('-').map(Number);
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const k = dateKey(new Date(y, m - 1, d - i));
    out.push({ date: k, won: !!days[k]?.won });
  }
  return out;
}

// ---- 保存データ（知らない項目は捨て、足りない項目ははじめの値で埋める） ----

export function normalize(value, defaults) {
  const out = { ...defaults };
  if (value && typeof value === 'object' && value.v === defaults.v) {
    for (const k of Object.keys(defaults)) if (k in value && typeof value[k] === typeof defaults[k] || (defaults[k] === null && k in value)) out[k] = value[k];
  }
  return out;
}
