// node tools/test.mjs — 決まりと解く道具の自己チェック
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as L from '../logic.js';
import { DEALS } from '../deals.js';
import { solve } from './solve.mjs';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`ok ${name}`); };

// 'K♠' → 札の番号
const C = (s) => {
  const suit = L.SUITS.indexOf(s.slice(-1)), rank = L.RANKS.indexOf(s.slice(0, -1));
  assert.ok(suit >= 0 && rank >= 1, s);
  return suit * 13 + rank - 1;
};
const cards = (str) => (str ? str.split(' ').map(C) : []);
// 手で作る場。tab は [裏, 表] の組を 7 つ（足りない列は空）
function mk({ tab = [], stock = '', waste = '', found = [0, 0, 0, 0] } = {}) {
  return {
    stock: cards(stock), waste: cards(waste),
    found: found.map((k, s) => Array.from({ length: k }, (_, i) => s * 13 + i)),
    tab: Array.from({ length: 7 }, (_, i) => ({ down: cards(tab[i]?.[0] || ''), up: cards(tab[i]?.[1] || '') })),
  };
}

test('配り: 同じ番号ならいつも同じ。52 枚がそろい、列は 1〜7 枚で一番上だけ表、山札は 24 枚', () => {
  assert.deepEqual(L.deal(268), L.deal(268));
  assert.notDeepEqual(L.deal(268), L.deal(269));
  const s = L.deal(1532);
  const all = [...s.stock, ...s.tab.flatMap((t) => [...t.down, ...t.up])].sort((a, b) => a - b);
  assert.deepEqual(all, Array.from({ length: 52 }, (_, i) => i));
  s.tab.forEach((t, i) => { assert.equal(t.down.length, i); assert.equal(t.up.length, 1); });
  assert.equal(s.stock.length, 24);
  // 乱数の式が変わると配りが全部変わる（deals.js が使えなくなる）。最初の札で見張る
  assert.deepEqual([L.mulberry32(1)(), L.mulberry32(1)()], [L.mulberry32(1)(), L.mulberry32(1)()]);
  assert.equal(Math.floor(L.mulberry32(1)() * 1e6), 627073);
});

test('動かせる手: 1 つ小さい数で色ちがいだけ。同じ色・数が合わない・空いた列に K 以外は受け付けない', () => {
  const s = mk({ tab: [['', '8♠'], ['', '7♥'], ['', '7♣'], ['', '6♥'], ['', 'Q♦'], [], ['', 'K♣']] });
  assert.ok(L.isLegal(s, 't1>t0'));            // 赤 7 を黒 8 へ
  assert.ok(!L.isLegal(s, 't2>t0'));           // 黒 7 を黒 8 へ（同じ色）
  assert.ok(!L.isLegal(s, 't3>t0'));           // 6 を 8 へ（数が合わない）
  assert.ok(!L.isLegal(s, 't4>t5'));           // Q を空いた列へ
  assert.ok(L.isLegal(s, 't6>t5'));            // K は空いた列へ置ける
  assert.ok(L.isLegal(s, 't4>t6'));            // 赤 Q を黒 K へ
  assert.ok(!L.isLegal(s, 't0>t0'));
  assert.equal(L.play(s, 't2>t0'), null);
});

test('動かせる手: 表のひと続きはまとめて動かせる。裏の札は動かせない', () => {
  const s = mk({ tab: [['2♦', '9♣ 8♥ 7♠'], ['', '10♥'], ['', '10♦']] });
  assert.ok(L.isLegal(s, 't0>t1*3'));
  assert.ok(!L.isLegal(s, 't0>t1*4'));         // 裏の札まで
  assert.ok(!L.isLegal(s, 't0>t1*2'));         // 8♥ を 10♥ へ（数が合わない）
  const r = L.play(s, 't0>t1*3');
  assert.deepEqual(r.tab[1].up, cards('10♥ 9♣ 8♥ 7♠'));
});

test('裏の札: 列の一番上が裏になったら自動で表にする', () => {
  const s = mk({ tab: [['3♣ 5♦', '9♣'], ['', '10♥']] });
  const r = L.play(s, 't0>t1');
  assert.deepEqual(r.tab[0].down, cards('3♣'));
  assert.deepEqual(r.tab[0].up, cards('5♦'));
  assert.deepEqual(s.tab[0].up, cards('9♣'));   // 元の場は変えない
});

test('置き場: マークごとに A から順。置き場の一番上は列に戻せる', () => {
  const s = mk({ tab: [['', 'A♥'], ['', '3♠'], ['', '2♠'], ['', '4♦']], found: [1, 0, 0, 0] });
  assert.ok(L.isLegal(s, 't0>f1'));
  assert.ok(!L.isLegal(s, 't0>f0'));           // ♥ を ♠ の置き場へ
  assert.ok(!L.isLegal(s, 't1>f0'));           // ♠3 は ♠2 のあと
  assert.ok(L.isLegal(s, 't2>f0'));
  const r = L.play(L.play(s, 't2>f0'), 't1>f0');
  assert.equal(r.found[0].length, 3);
  assert.ok(L.isLegal(r, 'f0>t3'));            // ♠3 を ♦4 へ戻す
  assert.ok(!L.isLegal(r, 'f0>t3*2'));
});

test('山札: 1 枚ずつめくり、空になったらめくった札を同じ順で山に戻す', () => {
  let s = mk({ stock: 'A♠ 2♠ 3♠' });            // 配列の最後が一番上
  s = L.play(s, 'd'); s = L.play(s, 'd'); s = L.play(s, 'd');
  assert.deepEqual(s.waste, cards('3♠ 2♠ A♠'));
  assert.equal(s.stock.length, 0);
  s = L.play(s, 'd');                           // 戻す
  assert.deepEqual(s.stock, cards('A♠ 2♠ 3♠'));
  assert.equal(s.waste.length, 0);
  assert.equal(L.play(mk(), 'd'), null);        // どちらも空ならめくれない
  assert.ok(L.isLegal(L.play(s, 'd'), 'w>f0') === false);
});

test('戻す: 手の並びから場を作り直すと、1 手前の場と同じ。決まりに合わない並びは null', () => {
  const seed = DEALS[0];
  let s = L.deal(seed);
  const moves = [], states = [s];
  for (let i = 0; i < 60; i++) {
    const legal = L.legalMoves(s);
    const m = legal[(i * 7) % legal.length];
    moves.push(m);
    s = L.play(s, m);
    states.push(s);
  }
  for (let k = 0; k <= moves.length; k++) assert.deepEqual(L.replay(seed, moves.slice(0, k)), states[k]);
  assert.equal(L.replay(seed, ['t0>t0']), null);
});

test('全部積む: 列が全部表で山がないときだけ出る。積む手を当てると勝つ', () => {
  // ♠ と ♥ は置き場に K まで、♣ と ♦ は列に残っている
  const s = mk({ tab: [['', 'K♣ Q♦ J♣ 10♦ 9♣ 8♦ 7♣ 6♦ 5♣ 4♦ 3♣ 2♦'], ['', 'K♦ Q♣ J♦ 10♣ 9♦ 8♣ 7♦ 6♣ 5♦ 4♣ 3♦ 2♣'], ['', 'A♣'], ['', 'A♦']], found: [13, 13, 0, 0] });
  assert.ok(L.canAutoFinish(s));
  assert.ok(!L.isWon(s));
  const moves = L.autoFinishMoves(s);
  let r = s;
  for (const m of moves) r = L.play(r, m);
  assert.ok(L.isWon(r));
  assert.equal(moves.length, 26);
  assert.ok(!L.canAutoFinish(mk({ tab: [['5♠', 'K♣']] })));
  assert.ok(!L.canAutoFinish(mk({ tab: [['', 'K♣']], stock: 'A♠' })));
});

test('勝ち: 52 枚が置き場に積めたら', () => {
  assert.ok(L.isWon(mk({ found: [13, 13, 13, 13] })));
  assert.ok(!L.isWon(mk({ found: [13, 13, 13, 12], tab: [['', 'K♦']] })));
});

test('行きづまり・ヒント・タップの行き先', () => {
  const stuck = mk({ tab: [['4♠', '9♣'], ['', '9♠'], ['2♥', '5♥']], stock: '8♣ 3♦' });
  assert.ok(L.isStuck(stuck));
  assert.equal(L.hint(stuck), null);
  const deep = mk({ tab: [['4♠', '9♣']], stock: '8♥ 3♦' });   // 山の奥に置ける札がある
  assert.ok(!L.isStuck(deep));
  assert.equal(L.hint(deep), 'd');
  const s = mk({ tab: [['5♣', 'A♥'], ['', '9♠'], ['', '8♦'], []] });
  assert.equal(L.hint(s), 't0>f1');
  assert.equal(L.bestTarget(s, 't0'), 'f1');
  assert.equal(L.bestTarget(s, 't2'), 't1');
  assert.equal(L.bestTarget(s, 't1'), null);
  assert.equal(L.bestTarget(mk({ tab: [['', 'K♠'], []] }), 't0'), null);          // 列の一番下の K は動かしても同じ
  assert.equal(L.bestTarget(mk({ tab: [['3♦', 'K♠'], []] }), 't0'), 't1');
  // ヒントの手はいつも決まりどおり
  let r = L.deal(DEALS[3]);
  for (let i = 0; i < 40; i++) { const h = L.hint(r); if (!h) break; assert.ok(L.isLegal(r, h), h); r = L.play(r, h); }
});

test('今日の配り: 日付から決まり、一覧の中の番号。続けて勝った日数と最近 14 日', () => {
  assert.equal(L.dailyDeal('2026-09-25', DEALS), L.dailyDeal('2026-09-25', DEALS));
  assert.ok(DEALS.includes(L.dailyDeal('2026-09-25', DEALS)));
  const week = Array.from({ length: 7 }, (_, i) => L.dailyDeal(`2026-10-0${i + 1}`, DEALS));
  assert.ok(new Set(week).size >= 6);
  const days = { '2026-09-23': { won: true }, '2026-09-24': { won: true }, '2026-09-21': { won: true } };
  assert.equal(L.dailyStreak(days, '2026-09-25'), 2);     // 今日はまだ → 昨日まで
  assert.equal(L.dailyStreak({ ...days, '2026-09-25': { won: true } }, '2026-09-25'), 3);
  const recent = L.recentDays(days, '2026-09-25');
  assert.equal(recent.length, 14);
  assert.equal(recent.at(-1).date, '2026-09-25');
  assert.deepEqual(recent.filter((x) => x.won).map((x) => x.date), ['2026-09-21', '2026-09-23', '2026-09-24']);
});

test('保存データ: 知らない項目は捨て、足りない項目と型の違う値ははじめの値で埋める', () => {
  const def = { v: 1, sound: true, lang: null, coached: false };
  assert.deepEqual(L.normalize({ v: 1, sound: false, extra: 1 }, def), { v: 1, sound: false, lang: null, coached: false });
  assert.deepEqual(L.normalize({ v: 1, sound: 'yes', lang: 'en' }, def), { v: 1, sound: true, lang: 'en', coached: false });
  assert.deepEqual(L.normalize(null, def), def);
  assert.deepEqual(L.normalize({ v: 2, sound: false }, def), def);
});

// ---- 解く道具 ----

test('一覧: 番号は重ならず、およそ 3,000 個', () => {
  assert.equal(new Set(DEALS).size, DEALS.length);
  assert.ok(DEALS.length >= 3000, `${DEALS.length}`);
  assert.ok(DEALS.every((d) => Number.isInteger(d) && d > 0));
});

test('解き方: 一覧から 20 個選んで、保存した手順を当てると必ず勝てる', () => {
  const lines = fs.readFileSync(new URL('./solutions.txt', import.meta.url), 'utf8').trim().split('\n');
  const sol = new Map(lines.map((l) => { const [seed, ...moves] = l.split(' '); return [Number(seed), moves]; }));
  assert.deepEqual([...sol.keys()], DEALS);
  for (let i = 0; i < 20; i++) {
    const seed = DEALS[Math.floor((i * DEALS.length) / 20)];
    const end = L.replay(seed, sol.get(seed));
    assert.ok(end && L.isWon(end), `#${seed}`);
  }
});

test('解く道具: 解けた手はそのまま当てて勝てる。解けない配りは一覧に入っていない', () => {
  for (const seed of DEALS.slice(0, 3)) {
    const moves = solve(seed, 200000);
    assert.ok(moves && L.isWon(L.replay(seed, moves)));
  }
  const missing = Array.from({ length: DEALS[40] }, (_, i) => i + 1).filter((d) => !DEALS.includes(d));
  assert.ok(missing.length > 0);
  assert.equal(solve(missing[0], 200000), null);
});

console.log(`\n${n} 件すべて通った`);
