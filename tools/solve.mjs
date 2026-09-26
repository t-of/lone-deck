// 手元で配りを解く道具。解けた番号だけを deals.js に入れる。
//
//   node tools/solve.mjs              番号 1 から順に解いて、3000 個たまったら deals.js と tools/solutions.txt を書く
//   node tools/solve.mjs 3000 400000  （たまる数・1 つの配りで調べる局面の上限）
//
// 解き方: 深さ優先で調べ、同じ局面は 2 度調べない。山札とめくった札は「何周でもめくれる」ので、
// どの札にもいつでも手が届く（順番は手数にだけ効く）。局面の見分けは列と置き場だけでよい。
// 間違いなく勝てる札（相手の色の 1 つ小さい札が 2 枚とも置き場にある）はすぐ置き場へ送る。
// 置き場から列に戻す手は使わない（そのぶん解けない配りが少し増えるが、入れない番号が増えるだけ）。
// 見つけた手は logic.js の play で最初から当て直し、本当に勝てると確かめてから入れる。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deal, replay, isWon, suitOf, rankOf, isRed } from '../logic.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// 解く用の場: tab[i] は列の札（下から上）、down[i] はそのうち裏の枚数、found[suit] は置き場の枚数、
// talon は山札とめくった札をめくる順に並べたもの、p はそのうちめくった枚数（talon[p-1] がめくった札の一番上）
function fromDeal(s) {
  return {
    tab: s.tab.map((t) => [...t.down, ...t.up]),
    down: s.tab.map((t) => t.down.length),
    found: [0, 0, 0, 0],
    talon: [...s.waste, ...s.stock.slice().reverse()],
    p: s.waste.length,
  };
}

const copy = (st) => ({ tab: st.tab.map((t) => t.slice()), down: st.down.slice(), found: st.found.slice(), talon: st.talon.slice(), p: st.p });
const canFound = (st, c) => st.found[suitOf(c)] === rankOf(c) - 1;
const canStack = (under, c) => rankOf(under) === rankOf(c) + 1 && isRed(under) !== isRed(c);
const safe = (st, c) => {
  const r = rankOf(c);
  if (r <= 2) return true;
  const o = isRed(c) ? [0, 2] : [1, 3];
  return st.found[o[0]] >= r - 1 && st.found[o[1]] >= r - 1;
};

function flip(st, i) {
  if (st.down[i] > 0 && st.down[i] === st.tab[i].length) st.down[i]--;
}

// talon[j] をめくった札の一番上にするまでの 'd' の手
function drawsTo(st, j, moves) {
  const len = st.talon.length;
  if (j + 1 >= st.p) {
    for (let k = st.p; k < j + 1; k++) moves.push('d');
  } else {
    for (let k = st.p; k < len; k++) moves.push('d');
    moves.push('d');                                   // めくった札を山に戻す
    for (let k = 0; k < j + 1; k++) moves.push('d');
  }
  st.p = j + 1;
}

function takeTalon(st, j, moves) {
  drawsTo(st, j, moves);
  const c = st.talon[j];
  st.talon.splice(j, 1);
  st.p--;
  return c;
}

// 間違いなく勝てる札を置き場へ送り続ける
function autoSafe(st, moves) {
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < 7; i++) {
      const t = st.tab[i];
      const c = t[t.length - 1];
      if (t.length > st.down[i] && canFound(st, c) && safe(st, c)) {
        t.pop(); st.found[suitOf(c)]++; flip(st, i);
        moves.push(`t${i}>f${suitOf(c)}`); again = true;
      }
    }
    if (st.p > 0) {
      const c = st.talon[st.p - 1];
      if (canFound(st, c) && safe(st, c)) {
        st.talon.splice(st.p - 1, 1); st.p--; st.found[suitOf(c)]++;
        moves.push(`w>f${suitOf(c)}`); again = true;
      }
    }
  }
}

function keyOf(st) {
  const cols = st.tab.map((t, i) => String.fromCharCode(...t.slice(0, st.down[i]).map((c) => 48 + c)) + '|' + String.fromCharCode(...t.slice(st.down[i]).map((c) => 48 + c)));
  return st.found.join(',') + ':' + cols.sort().join('/');
}

// 次の局面の候補（よさそうな順）
function children(st) {
  const out = [];
  const child = (fn) => {
    const s = copy(st), moves = [];
    fn(s, moves);
    autoSafe(s, moves);
    out.push({ st: s, moves });
  };
  const firstEmpty = st.tab.findIndex((t) => t.length === 0);
  const tops = st.tab.map((t) => t[t.length - 1]);

  // 列の一番上 → 置き場
  for (let i = 0; i < 7; i++) {
    const c = tops[i];
    if (st.tab[i].length > st.down[i] && canFound(st, c)) {
      child((s, m) => { s.tab[i].pop(); s.found[suitOf(c)]++; flip(s, i); m.push(`t${i}>f${suitOf(c)}`); });
    }
  }
  // 列 → 列（表のひと続きを全部。裏の札が多い列から）
  const order = [0, 1, 2, 3, 4, 5, 6].filter((i) => st.down[i] > 0).sort((a, b) => st.down[b] - st.down[a]);
  const runTo = (i, n) => {
    const t = st.tab[i], c = t[t.length - n];
    for (let j = 0; j < 7; j++) {
      if (j === i) continue;
      const u = st.tab[j];
      const ok = u.length ? canStack(u[u.length - 1], c) : (rankOf(c) === 13 && j === firstEmpty);
      if (ok) child((s, m) => { s.tab[j].push(...s.tab[i].splice(s.tab[i].length - n, n)); flip(s, i); m.push(`t${i}>t${j}${n > 1 ? `*${n}` : ''}`); });
    }
  };
  for (const i of order) runTo(i, st.tab[i].length - st.down[i]);
  // 山札・めくった札 → 置き場・列（同じ札をいくつもの道で試さないよう、札ごとに 1 回）
  for (let j = 0; j < st.talon.length; j++) {
    const c = st.talon[j];
    if (canFound(st, c)) child((s, m) => { takeTalon(s, j, m); s.found[suitOf(c)]++; m.push(`w>f${suitOf(c)}`); });
  }
  for (let j = 0; j < st.talon.length; j++) {
    const c = st.talon[j];
    for (let k = 0; k < 7; k++) {
      const u = st.tab[k];
      const ok = u.length ? canStack(u[u.length - 1], c) : (rankOf(c) === 13 && k === firstEmpty);
      if (ok) child((s, m) => { takeTalon(s, j, m); s.tab[k].push(c); m.push(`w>t${k}`); });
    }
  }
  // 列を空ける（裏の札がない列のひと続きを全部、札のある列へ）
  for (let i = 0; i < 7; i++) {
    const n = st.tab[i].length;
    if (st.down[i] === 0 && n > 0) {
      const c = st.tab[i][0];
      for (let j = 0; j < 7; j++) {
        const u = st.tab[j];
        if (j !== i && u.length && canStack(u[u.length - 1], c)) child((s, m) => { s.tab[j].push(...s.tab[i].splice(0)); m.push(`t${i}>t${j}${n > 1 ? `*${n}` : ''}`); });
      }
    }
  }
  // ひと続きの一部を動かして、残った一番上の札を置き場に積めるようにする
  for (let i = 0; i < 7; i++) {
    const t = st.tab[i], up = t.length - st.down[i];
    for (let n = 1; n < up; n++) {
      const rest = t[t.length - n - 1];
      if (!canFound(st, rest)) continue;
      const c = t[t.length - n];
      for (let j = 0; j < 7; j++) {
        const u = st.tab[j];
        if (j !== i && u.length && canStack(u[u.length - 1], c)) child((s, m) => { s.tab[j].push(...s.tab[i].splice(s.tab[i].length - n, n)); m.push(`t${i}>t${j}${n > 1 ? `*${n}` : ''}`); });
      }
    }
  }
  return out;
}

// 配りを解く。解けたら手の並び（logic.js の手の文字列）、解けない・上限に届いたら null
export function solve(seed, limit = 400000) {
  const st = fromDeal(deal(seed));
  const first = [];
  autoSafe(st, first);
  const seen = new Set();
  const path = [first];
  let nodes = 0;
  const dfs = (s) => {
    if (s.found[0] + s.found[1] + s.found[2] + s.found[3] === 52) return true;
    if (++nodes > limit) return false;
    const key = keyOf(s);
    if (seen.has(key)) return false;
    seen.add(key);
    for (const c of children(s)) {
      path.push(c.moves);
      if (dfs(c.st)) return true;
      path.pop();
      if (nodes > limit) return false;
    }
    return false;
  };
  if (!dfs(st)) return null;
  const moves = path.flat();
  const end = replay(seed, moves);
  if (!end || !isWon(end)) throw new Error(`#${seed}: 解いた手を当て直しても勝てない（解く道具の不具合）`);
  return moves;
}

// ---- 一覧を作る ----

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const want = Number(process.argv[2]) || 3000;
  const limit = Number(process.argv[3]) || 400000;
  const deals = [], lines = [];
  const t0 = Date.now();
  let tried = 0;
  for (let seed = 1; deals.length < want; seed++) {
    tried++;
    const moves = solve(seed, limit);
    if (moves) { deals.push(seed); lines.push(`${seed} ${moves.join(' ')}`); }
    if (tried % 200 === 0) console.log(`${tried} 個調べて ${deals.length} 個解けた（${Math.round((Date.now() - t0) / 1000)} 秒）`);
  }
  fs.writeFileSync(path.join(ROOT, 'deals.js'),
    `// 解けると確かめた配りの番号（tools/solve.mjs が作る。手で書き換えない）。\n` +
    `// ${tried} 個のうち ${deals.length} 個が解けた。解き方の手順は tools/solutions.txt。\n` +
    `export const DEALS = [${deals.join(',')}];\n`);
  fs.writeFileSync(path.join(ROOT, 'tools', 'solutions.txt'), lines.join('\n') + '\n');
  console.log(`${tried} 個のうち ${deals.length} 個が解けた（${(deals.length / tried * 100).toFixed(1)}%）。deals.js と tools/solutions.txt を書いた。`);
}
