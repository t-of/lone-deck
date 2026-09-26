// LONE DECK の画面。決まりごとは logic.js、文字は i18n.js、解けると確かめた配りの番号は deals.js。
import * as L from './logic.js';
import { DEALS } from './deals.js';
import { t as tr, pickLang, fmtTime } from './i18n.js';

// 課金アプリなので別オリジン（lone-deck.t-of.workers.dev）に置く。localStorage は他アプリと共有しない。
// キーは念のため 'lone-deck.' で始める。
const STORE = 'lone-deck.';

function load(key, fallback) {
  try {
    const v = localStorage.getItem(STORE + key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch { /* 保存できなくても遊べる */ }
}

const URL_APP = 'https://lone-deck.t-of.workers.dev/';
const settings = L.normalize(load('settings'), { v: 1, sound: true, lang: null, coached: false });
const stats = L.normalize(load('stats'), { v: 1, played: 0, won: 0, streak: 0, bestStreak: 0, bestMoves: null, bestTime: null, seen: [] });
const daily = L.normalize(load('daily'), { v: 1, days: {} });
let lang = pickLang(settings.lang, navigator.language);
const t = (key, vars) => tr(lang, key, vars);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

// 音を使うときは、鳴らす前と音の設定を切り替えたときにこれを呼ぶ（RULES.md §5「音」）。
function setAudioSession(soundOn) {
  try { if (navigator.audioSession) navigator.audioSession.type = soundOn ? 'playback' : 'auto'; } catch { /* 対応していない */ }
}

// ---- 効果音（Web Audio で作る。音声ファイルは使わない） ----

const sfx = (() => {
  let ctx = null, out = null, noiseBuf = null;
  function ensure() {
    if (!settings.sound) return null;
    setAudioSession(true);
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      out = ctx.createGain();
      out.gain.value = 0.5;
      out.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone({ f, to, type = 'sine', at = 0, dur = 0.2, vol = 0.12 }) {
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + at + 0.005;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }
  function noise({ at = 0, dur = 0.04, vol = 0.12, freq = 2400 }) {
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + at + 0.005;
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = noiseBuf;
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.9;
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g).connect(out);
    s.start(t0);
    s.stop(t0 + dur + 0.02);
  }
  // 置き場に積む音: 同じマークで積むほど 1 段ずつ上がる（A から K で 13 段、長音階）
  const step = (n) => 392 * 2 ** ([0, 2, 4, 5, 7, 9, 11][n % 7] / 12 + Math.floor(n / 7));
  return {
    unlock: ensure,
    pick: () => noise({ dur: 0.04, vol: 0.08, freq: 3200 }),
    place: () => noise({ dur: 0.05, vol: 0.12, freq: 1500 }),
    found: (rank, at = 0) => { tone({ f: step(rank - 1), at, dur: 0.22, vol: 0.1, type: 'triangle' }); },
    flip: () => noise({ at: 0.06, dur: 0.03, vol: 0.07, freq: 900 }),
    draw: () => noise({ dur: 0.05, vol: 0.09, freq: 2600 }),
    recycle: () => noise({ dur: 0.16, vol: 0.1, freq: 1800 }),
    bad: () => tone({ f: 190, dur: 0.12, vol: 0.08, type: 'triangle' }),
    undo: () => tone({ f: 520, to: 360, dur: 0.12, vol: 0.07 }),
    hint: () => { tone({ f: 880, dur: 0.1, vol: 0.06 }); tone({ f: 1175, at: 0.1, dur: 0.14, vol: 0.06 }); },
    win: () => [523, 659, 784, 1047].forEach((f, i) => tone({ f, at: i * 0.12, dur: 1 - i * 0.12, vol: 0.09, type: 'triangle' })),
    stuck: () => { tone({ f: 440, to: 400, dur: 0.2, vol: 0.07 }); tone({ f: 350, to: 300, at: 0.2, dur: 0.3, vol: 0.07 }); },
    click: () => tone({ f: 1400, dur: 0.03, vol: 0.04, type: 'square' }),
  };
})();

// ---- 広告を入れる場所（仕様 11）。最初の版は何もしない ----

// 局の区切り: ふだんの配りの結果で「次の配り」を押したあと、新しい場が出る前に呼ぶ。
// 局の途中・行きづまりの知らせ・開いた直後・今日の配りの結果のあとには呼ばない。
async function showBreak() { /* 広告の仕組みを決めたら、ここに中身を入れる */ }

// ---- 局 ----

const $ = (id) => document.getElementById(id);
const board = $('board');
const today = () => L.dateKey();

let game = null;      // 保存する局: { v, mode, date, deal, moves, undos, time, counted, won }
let state = null;     // 今の場（game.deal と game.moves から作り直せる）
let busy = false;     // 全部積む・勝ちの演出の途中

const moveCount = () => game.moves.length + game.undos;   // 戻しても手数は減らない
const saveGame = () => save('game', game);

function startGame(mode) {
  let deal;
  if (mode === 'daily') deal = L.dailyDeal(today(), DEALS);
  else {
    let pool = DEALS.filter((d) => !stats.seen.includes(d));
    if (!pool.length) { stats.seen = []; pool = DEALS; }   // 一覧を一巡したら最初から
    deal = pool[Math.floor(Math.random() * pool.length)];
    stats.seen.push(deal);
    save('stats', stats);
  }
  game = { v: 1, mode, date: today(), deal, moves: [], undos: 0, time: 0, counted: false, won: false };
  state = L.deal(deal);
  cardEls.forEach((el) => el.classList.remove('glow'));
  saveGame();
  closeSheet();
  render();
  updateHud();
}

// 勝たずにやめたら負け（連勝が 0 に戻る）。1 手でも動かしていれば確かめる
function requestNew(mode) {
  if (busy) return;
  if (!game.counted || game.won) { sfx.click(); startGame(mode); return; }
  openSheet(`
    <p class="sheet__lead">${t('confirm.abandon')}</p>
    <p class="sheet__note">${t('confirm.note')}</p>
    <div class="sheet__row">
      <button class="btn" data-act="close">${t('btn.cancel')}</button>
      <button class="btn btn--main" data-act="abandon" data-mode="${mode}">${t('confirm.yes')}</button>
    </div>`, 'center');
}

function resume() {
  const g = load('game');
  if (g && g.v === 1 && DEALS.includes(g.deal) && Array.isArray(g.moves) && !g.won) {
    const s = L.replay(g.deal, g.moves);
    if (s) {
      game = { ...L.normalize(g, { v: 1, mode: 'free', date: today(), deal: g.deal, moves: [], undos: 0, time: 0, counted: false, won: false }) };
      state = s;
      return;
    }
  }
  startGame(daily.days[today()]?.won ? 'free' : 'daily');
}

function doMove(m) {
  const next = L.play(state, m);
  if (!next) return false;
  const before = state;
  state = next;
  game.moves.push(m);
  if (!game.counted) {   // 1 手でも動かした局を「遊んだ数」に数える
    game.counted = true;
    stats.played++;
    save('stats', stats);
  }
  // 音
  if (m === 'd') (before.stock.length ? sfx.draw : sfx.recycle)();
  else {
    const { to } = L.parseMove(m);
    if (to[0] === 'f') sfx.found(state.found[Number(to[1])].length);
    else sfx.place();
    const downs = (s) => s.tab.reduce((a, c) => a + c.down.length, 0);
    if (downs(state) < downs(before)) sfx.flip();
  }
  saveGame();
  render();
  updateHud();
  if (!busy) afterMove();
  return true;
}

function afterMove() {
  if (L.isWon(state)) return win();
  $('finishBtn').hidden = !L.canAutoFinish(state);
  if (L.isStuck(state)) showStuck();
}

function undo() {
  if (busy || game.won || !game.moves.length) return;
  game.moves.pop();
  game.undos++;
  state = L.replay(game.deal, game.moves);
  sfx.undo();
  saveGame();
  render();
  updateHud();
  $('finishBtn').hidden = !L.canAutoFinish(state);
}

async function autoFinish() {
  const moves = L.autoFinishMoves(state);
  if (!moves || busy) return;
  busy = true;
  $('finishBtn').hidden = true;
  const gap = Math.min(90, 1500 / moves.length);   // 1.5 秒まで
  for (const m of moves) {
    doMove(m);
    await new Promise((r) => setTimeout(r, gap));
  }
  busy = false;
  afterMove();
}

function showHint() {
  if (busy) return;
  const m = L.hint(state);
  if (!m) { showStuck(); return; }
  sfx.hint();
  const glow = [];
  if (m === 'd') glow.push(state.stock.length ? cardEls[state.stock[state.stock.length - 1]] : slotEls.s);
  else {
    const { from, to, n } = L.parseMove(m);
    const src = from === 'w' ? [state.waste[state.waste.length - 1]] : from[0] === 'f' ? [state.found[from[1]].at(-1)] : state.tab[from[1]].up.slice(-n);
    src.forEach((c) => glow.push(cardEls[c]));
    const dst = to[0] === 'f' ? state.found[to[1]].at(-1) : state.tab[to[1]].up.at(-1);
    glow.push(dst != null ? cardEls[dst] : slotEls[to]);
  }
  glow.forEach((el) => { el.classList.remove('hint'); void el.offsetWidth; el.classList.add('hint'); });
  setTimeout(() => glow.forEach((el) => el.classList.remove('hint')), 1600);
}

function showStuck() {
  sfx.stuck();
  openSheet(`
    <p class="sheet__lead">${t('stuck.title')}</p>
    <p class="sheet__note">${t('stuck.body')}</p>
    <div class="sheet__row">
      <button class="btn btn--main" data-act="undo">${t('btn.undo')}</button>
      <button class="btn" data-act="new">${t('btn.newDeal')}</button>
    </div>`, 'center');
}

// ---- 勝ち ----

function win() {
  game.won = true;
  saveGame();
  const moves = moveCount(), time = Math.floor(game.time);
  const best = { moves: stats.bestMoves == null || moves < stats.bestMoves, time: stats.bestTime == null || time < stats.bestTime };
  stats.won++;
  stats.streak++;
  stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
  if (best.moves) stats.bestMoves = moves;
  if (best.time) stats.bestTime = time;
  save('stats', stats);
  // 今日の配りは、最初に勝ったときの手数と時間だけを残す
  if (game.mode === 'daily' && !daily.days[game.date]?.won) {
    daily.days[game.date] = { deal: game.deal, moves, time, won: true };
    save('daily', daily);
  }
  $('finishBtn').hidden = true;
  $('undoBtn').disabled = true;
  updateHud();
  sfx.win();
  // 置き場の 4 つの山が順に光る（札が跳ね回る演出はしない）
  [0, 1, 2, 3].forEach((i) => setTimeout(() => cardEls[state.found[i].at(-1)].classList.add('glow'), i * 160));
  busy = true;
  setTimeout(() => { busy = false; showResult(moves, time, best); }, 900);
}

function showResult(moves, time, best) {
  const isDaily = game.mode === 'daily';
  const now = new Date(), next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const left = Math.max(0, Math.floor((next - now) / 60000));
  const ds = L.dailyStreak(daily.days, today());
  openSheet(`
    <h2 class="sheet__title">${t('win.title')}</h2>
    <p class="sheet__sub">${isDaily ? t('mode.daily') + ' ' : ''}${t('deal.no', { n: game.deal })}</p>
    <div class="result">
      <div><span>${t('win.moves')}</span><b>${moves}</b>${best.moves ? `<em>${t('win.best')}</em>` : ''}</div>
      <div><span>${t('win.time')}</span><b>${fmtTime(lang, time)}</b>${best.time ? `<em>${t('win.best')}</em>` : ''}</div>
    </div>
    <p class="sheet__note">${t('win.streak', { n: stats.streak })}</p>
    ${isDaily ? `<p class="sheet__note">${t('win.dailyStreak', { n: ds })}<br>${t('win.nextDaily', { h: Math.floor(left / 60), m: left % 60 })}</p>` : ''}
    <div class="sheet__row">
      <button class="btn" data-act="shareResult">${t('btn.share')}</button>
      ${isDaily ? '' : `<button class="btn" data-act="daily">${t('btn.toDaily')}</button>`}
    </div>
    <button class="btn btn--main btn--wide" data-act="next">${t('btn.nextDeal')}</button>`);
  sheet.dataset.result = JSON.stringify({ moves, time });
}

function shareResult() {
  const { moves, time } = JSON.parse(sheet.dataset.result || '{}');
  const [, m, d] = game.date.split('-').map(Number);
  const text = game.mode === 'daily'
    ? t('share.daily', { n: game.deal, date: `${m}/${d}`, moves, time: fmtTime(lang, time) })
    : t('share.free', { n: game.deal, moves, time: fmtTime(lang, time), streak: stats.streak });
  WebAppKit.share({ text, url: URL_APP });
}

// ---- 時間（最初に動かしてから勝つまで。画面が隠れている間は止める） ----

let lastTick = performance.now();
setInterval(() => {
  const now = performance.now();
  if (game && game.counted && !game.won && !document.hidden) {
    game.time += (now - lastTick) / 1000;
    updateHud();
    if (Math.floor(game.time) % 5 === 0) saveGame();
  }
  lastTick = now;
}, 250);
document.addEventListener('visibilitychange', () => { lastTick = performance.now(); if (game) saveGame(); });
addEventListener('pagehide', () => game && saveGame());

// ---- 場を描く ----

const cardEls = [];
const slotEls = {};
let geo = null;

function cardHtml(c) {
  const r = L.RANKS[L.rankOf(c)], s = L.suitOf(c);
  const use = `<use href="#s${s}"/>`;
  const center = L.rankOf(c) > 10 ? `<span class="big big--face">${r}</span>` : `<svg class="big">${use}</svg>`;
  return `<div class="face"><span class="corner"><span class="rk${r === '10' ? ' rk--10' : ''}">${r}</span><svg class="st">${use}</svg></span>${center}</div>`;
}

function buildBoard() {
  for (const id of ['s', 'w', 'f0', 'f1', 'f2', 'f3', 't0', 't1', 't2', 't3', 't4', 't5', 't6']) {
    const el = document.createElement('div');
    el.className = `slot slot--${id[0]}`;
    el.dataset.slot = id;
    if (id[0] === 'f') el.innerHTML = `<svg class="st">${`<use href="#s${id[1]}"/>`}</svg>`;
    if (id === 's') el.innerHTML = '<span class="recycle">↻</span>';
    board.appendChild(el);
    slotEls[id] = el;
  }
  for (let c = 0; c < 52; c++) {
    const el = document.createElement('div');
    el.className = `card ${L.isRed(c) ? 'red' : 'black'}`;
    el.dataset.c = c;
    el.innerHTML = cardHtml(c);
    board.appendChild(el);
    cardEls.push(el);
  }
}

function layout() {
  const W = board.clientWidth, H = board.clientHeight;
  const gap = Math.max(4, Math.min(12, Math.round(W * 0.012)));
  const w = Math.floor(Math.min((W - 6 * gap) / 7, H / 8, 96));   // PC でも札が大きくなりすぎないよう 96px まで
  const h = Math.round(w * 1.4);
  const x0 = Math.round((W - (7 * w + 6 * gap)) / 2);
  geo = { W, H, gap, w, h, x0, tabTop: h + Math.max(10, gap * 2), down: Math.round(w * 0.2), up: Math.round(w * 0.6) };
  board.style.setProperty('--cw', `${w}px`);
  board.style.setProperty('--ch', `${h}px`);
  document.documentElement.style.setProperty('--grid', `${7 * w + 6 * gap}px`);   // 上の帯・下のボタンを札の並びの幅にそろえる（PC）
  const slotPos = { s: 0, w: 1, f0: 3, f1: 4, f2: 5, f3: 6 };
  for (const [id, el] of Object.entries(slotEls)) {
    const col = id[0] === 't' ? Number(id[1]) : slotPos[id];
    el.style.transform = `translate(${colX(col)}px, ${id[0] === 't' ? geo.tabTop : 0}px)`;
  }
}
const colX = (i) => geo.x0 + i * (geo.w + geo.gap);

// 札ごとの位置。列が長くて画面からはみ出るときだけ重なりを詰める
function positions() {
  const pos = [];
  const put = (c, x, y, z, up, pile) => { pos[c] = { x, y, z, up, pile }; };
  state.stock.forEach((c, i) => put(c, colX(0), 0, i, false, 's'));
  state.waste.forEach((c, i) => put(c, colX(1), 0, i, true, 'w'));
  state.found.forEach((f, s) => f.forEach((c, i) => put(c, colX(3 + s), 0, i, true, `f${s}`)));
  const avail = geo.H - geo.tabTop - 2;
  state.tab.forEach((col, i) => {
    let down = geo.down, up = geo.up;
    const need = () => col.down.length * down + Math.max(0, col.up.length - 1) * up + geo.h;
    if (need() > avail && col.up.length > 1) up = Math.max(geo.w * 0.3, (avail - geo.h - col.down.length * down) / (col.up.length - 1));
    if (need() > avail && col.down.length) down = Math.max(3, (avail - geo.h - (col.up.length - 1) * up) / col.down.length);
    let y = geo.tabTop, z = 0;
    col.down.forEach((c) => { put(c, colX(i), y, z++, false, `t${i}`); y += down; });
    col.up.forEach((c) => { put(c, colX(i), y, z++, true, `t${i}`); y += up; });
  });
  return pos;
}

let where = [];
function render() {
  const pos = positions();
  pos.forEach((p, c) => {
    const el = cardEls[c];
    const moved = where[c] && where[c].pile !== p.pile;
    el.classList.toggle('down', !p.up);
    el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    el.style.zIndex = moved ? 200 + p.z : 10 + p.z;
    if (moved) setTimeout(() => { el.style.zIndex = 10 + where[c].z; }, 220);
  });
  where = pos;
  slotEls.s.classList.toggle('slot--empty', !state.stock.length && state.waste.length > 0);
  $('undoBtn').disabled = !game.moves.length || game.won;
}

function updateHud() {
  $('hudMoves').textContent = t('hud.moves', { n: moveCount() });
  const s = Math.floor(game.time);
  $('hudTime').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  $('dailyNo').textContent = t('deal.no', { n: L.dailyDeal(today(), DEALS) });
  $('freeNo').textContent = game.mode === 'free' ? t('deal.no', { n: game.deal }) : '';
  $('modeDaily').classList.toggle('on', game.mode === 'daily');
  $('modeFree').classList.toggle('on', game.mode === 'free');
  $('modeDaily').setAttribute('aria-pressed', game.mode === 'daily');
  $('modeFree').setAttribute('aria-pressed', game.mode === 'free');
}

function shake(els) {
  els.forEach((el) => { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); });
  sfx.bad();
}

// ---- 操作: タップで行ける先へ、ドラッグで好きな所へ ----

let drag = null;

function pickAt(target) {
  const cardEl = target.closest('.card');
  const slotEl = target.closest('.slot');
  if (!cardEl) return slotEl ? { slot: slotEl.dataset.slot } : null;
  const c = Number(cardEl.dataset.c), p = where[c];
  return { c, pile: p.pile, up: p.up };
}

board.addEventListener('pointerdown', (e) => {
  if (busy || drag || game.won || e.button > 0) return;
  sfx.unlock();
  const hit = pickAt(e.target);
  if (!hit) return;
  if (hit.slot === 's' || hit.pile === 's') { if (!doMove('d')) sfx.bad(); return; }
  if (hit.slot || !hit.up) { if (hit.c != null) shake([cardEls[hit.c]]); return; }
  const from = hit.pile;
  let cards;
  if (from === 'w') cards = [state.waste.at(-1)];
  else if (from[0] === 'f') cards = [state.found[from[1]].at(-1)];
  else { const up = state.tab[from[1]].up; cards = up.slice(up.indexOf(hit.c)); }
  if (!cards.includes(hit.c)) return;
  const r = board.getBoundingClientRect();
  drag = { from, cards, n: cards.length, x: e.clientX, y: e.clientY, r, moved: false, lift: e.pointerType === 'touch' ? geo.h * 0.35 : 0 };
  board.setPointerCapture(e.pointerId);
});

board.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 8) return;
  if (!drag.moved) { drag.moved = true; sfx.pick(); drag.cards.forEach((c) => cardEls[c].classList.add('dragging')); }
  drag.dx = dx; drag.dy = dy - drag.lift;   // 指で隠れないよう、少し上に出す
  drag.cards.forEach((c, i) => {
    const p = where[c], el = cardEls[c];
    el.style.transform = `translate(${p.x + drag.dx}px, ${p.y + drag.dy}px)`;
    el.style.zIndex = 500 + i;
  });
});

function dropTarget() {
  const p = where[drag.cards[0]];
  const cx = p.x + drag.dx + geo.w / 2, cy = p.y + drag.dy + geo.h * 0.3;
  const col = Math.max(0, Math.min(6, Math.floor((cx - geo.x0 + geo.gap / 2) / (geo.w + geo.gap))));
  if (cy < geo.tabTop - geo.gap) return col >= 3 ? `f${L.suitOf(drag.cards[0])}` : null;   // 置き場のどこに落としても、その札のマークの場所へ
  return `t${col}`;
}

function endDrag(e, cancel) {
  if (!drag) return;
  const d = drag;
  drag = null;
  d.cards.forEach((c) => cardEls[c].classList.remove('dragging'));
  if (cancel) { render(); return; }
  if (!d.moved) {   // タップ: 置き場に置けるなら置き場、だめなら列
    const to = L.bestTarget(state, d.from, d.n);
    if (!to || !doMove(L.moveStr(d.from, to, d.n))) shake(d.cards.map((c) => cardEls[c]));
    return;
  }
  drag = d;
  const to = dropTarget();
  drag = null;
  if (to && to !== d.from && doMove(L.moveStr(d.from, to, d.n))) return;
  if (to !== d.from) sfx.bad();
  render();
}
board.addEventListener('pointerup', (e) => endDrag(e, false));
board.addEventListener('pointercancel', (e) => endDrag(e, true));

// 戻す: 1 手ずつ。長押しで続けて戻る
let holdT = 0, holdI = 0;
const stopHold = () => { clearTimeout(holdT); clearInterval(holdI); };
$('undoBtn').addEventListener('pointerdown', (e) => {
  if (e.button > 0) return;
  sfx.unlock();
  undo();
  stopHold();
  holdT = setTimeout(() => { holdI = setInterval(undo, 110); }, 450);
});
['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => $('undoBtn').addEventListener(ev, stopHold));
$('undoBtn').addEventListener('click', (e) => { if (e.detail === 0) undo(); });   // キーボードで押したとき
$('hintBtn').addEventListener('click', showHint);
$('finishBtn').addEventListener('click', autoFinish);
$('newBtn').addEventListener('click', () => requestNew('free'));
$('modeDaily').addEventListener('click', () => {
  if (game.mode === 'daily' && game.date === today() && !game.won) return;
  requestNew('daily');
});
$('modeFree').addEventListener('click', () => { if (game.mode !== 'free') requestNew('free'); });
$('menuBtn').addEventListener('click', () => { sfx.click(); showMenu(); });

addEventListener('keydown', (e) => {
  if (sheet.open) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  else if (e.key.toLowerCase() === 'h' && !e.ctrlKey && !e.metaKey) showHint();
  else if (e.key === ' ') { e.preventDefault(); if (!busy) doMove('d'); }
});

// ---- シート（メニュー・記録・遊び方・知らせ・結果） ----

const sheet = $('sheet');
function openSheet(html, kind = '') {
  $('sheetBody').innerHTML = html;
  sheet.className = `sheet${kind ? ` sheet--${kind}` : ''}`;
  delete sheet.dataset.result;
  if (!sheet.open) sheet.showModal();
  sheet.querySelector('.btn--main')?.focus();   // 親指で押す一番のボタンに
}
function closeSheet() { if (sheet.open) sheet.close(); }
sheet.addEventListener('click', (e) => {
  if (e.target === sheet && !sheet.classList.contains('sheet--howto')) { closeSheet(); return; }
  const b = e.target.closest('[data-act]');
  if (!b) return;
  sfx.click();
  const act = b.dataset.act;
  if (act === 'close') closeSheet();
  else if (act === 'abandon') { stats.streak = 0; save('stats', stats); startGame(b.dataset.mode); }
  else if (act === 'undo') { closeSheet(); undo(); }
  else if (act === 'new') { closeSheet(); requestNew('free'); }
  else if (act === 'next') { closeSheet(); (game.mode === 'free' ? showBreak() : Promise.resolve()).then(() => startGame('free')); }   // 今日の配りのあとは区切りを入れない
  else if (act === 'daily') startGame('daily');
  else if (act === 'shareResult') shareResult();
  else if (act === 'stats') showStats();
  else if (act === 'howto') showHowto();
  else if (act === 'sound') { settings.sound = b.dataset.v === 'on'; save('settings', settings); setAudioSession(settings.sound); showMenu(); }
  else if (act === 'lang') { settings.lang = b.dataset.v; save('settings', settings); lang = settings.lang; applyLang(); showMenu(); }
  else if (act === 'coached') { settings.coached = true; save('settings', settings); closeSheet(); }
});

function seg(act, cur, opts) {
  return `<span class="seg">${opts.map(([v, label]) => `<button class="${v === cur ? 'on' : ''}" data-act="${act}" data-v="${v}" aria-pressed="${v === cur}">${label}</button>`).join('')}</span>`;
}

function showMenu() {
  openSheet(`
    <h2 class="sheet__title">LONE DECK</h2>
    <p class="sheet__sub">${t('tagline')} · ${t('game.klondike')}</p>
    <button class="rowbtn" data-act="stats">${t('menu.stats')}<span>›</span></button>
    <button class="rowbtn" data-act="howto">${t('menu.howto')}<span>›</span></button>
    <div class="rowset"><span>${t('menu.sound')}</span>${seg('sound', settings.sound ? 'on' : 'off', [['on', t('on')], ['off', t('off')]])}</div>
    <div class="rowset"><span>${t('menu.lang')}</span>${seg('lang', lang, [['ja', '日本語'], ['en', 'English']])}</div>
    <button class="btn btn--wide" data-act="close">${t('btn.close')}</button>`);
}

function showStats() {
  const rate = stats.played ? Math.round((stats.won / stats.played) * 100) : 0;
  const d = daily.days[today()];
  const cell = (k, v) => `<div><span>${t(k)}</span><b>${v}</b></div>`;
  openSheet(`
    <h2 class="sheet__title">${t('menu.stats')}</h2>
    <div class="grid">
      ${cell('stats.played', stats.played)}${cell('stats.won', stats.won)}${cell('stats.rate', `${rate}%`)}
      ${cell('stats.streak', stats.streak)}${cell('stats.bestStreak', stats.bestStreak)}
      ${cell('stats.bestMoves', stats.bestMoves ?? '—')}${cell('stats.bestTime', stats.bestTime == null ? '—' : fmtTime(lang, stats.bestTime))}
    </div>
    <h3 class="sheet__h">${t('mode.daily')}</h3>
    <div class="grid">
      ${cell('stats.today', d?.won ? `${t('hud.moves', { n: d.moves })} · ${fmtTime(lang, d.time)}` : '—')}
      ${cell('stats.dailyStreak', L.dailyStreak(daily.days, today()))}
    </div>
    <p class="sheet__note">${t('stats.recent')}</p>
    <div class="days">${L.recentDays(daily.days, today()).map((x) => `<i class="${x.won ? 'won' : ''}" title="${x.date}">${x.won ? '○' : '·'}</i>`).join('')}</div>
    <button class="btn btn--wide" data-act="close">${t('btn.close')}</button>`);
}

function showHowto() {
  openSheet(`
    <h2 class="sheet__title">${t('menu.howto')}</h2>
    <p class="sheet__sub">${t('game.klondike')}</p>
    <ol class="howto"><li>${t('howto.1')}</li><li>${t('howto.2')}</li><li>${t('howto.3')}</li></ol>
    <p class="sheet__note">${t('howto.tap')}</p>
    <button class="btn btn--main btn--wide" data-act="coached">${t('btn.start')}</button>`, 'howto');
}

// ---- 言葉 ----

function applyLang() {
  document.documentElement.lang = lang;
  document.title = t('title');
  WebAppKit.init({ lang, title: 'LONE DECK', text: t('share.app'), url: URL_APP });
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  document.querySelectorAll('[data-t-label]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.tLabel)));
  slotEls.s?.setAttribute('aria-label', t('a11y.stock'));
  slotEls.w?.setAttribute('aria-label', t('a11y.waste'));
  if (game) updateHud();
}

// ---- はじめる ----

buildBoard();
layout();
applyLang();
resume();
render();
updateHud();
requestAnimationFrame(() => board.classList.add('ready'));   // 最初の配りは動かさずに出す
new ResizeObserver(() => { layout(); render(); }).observe(board);
$('finishBtn').hidden = !L.canAutoFinish(state);
if (!settings.coached) showHowto();
else if (L.isStuck(state)) showStuck();
