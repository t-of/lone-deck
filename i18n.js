// 画面の文字。キーで引く（仕様 13「言葉」の一覧 + 画面を作るときに足したもの）。{n} などは t() で差しこむ。

export const STRINGS = {
  title: ['LONE DECK — ソリティア：クロンダイクで必ず解ける', 'LONE DECK — Solitaire (Klondike) You Can Always Win'],
  tagline: ['必ず解けるひとりトランプ', 'Solitaire you can always win'],
  'mode.daily': ['今日の配り', "Today's Deal"],
  'mode.free': ['ふだん', 'Free Play'],
  'deal.no': ['#{n}', '#{n}'],
  'hud.moves': ['{n} 手', '{n} moves'],
  'btn.undo': ['戻す', 'Undo'],
  'btn.hint': ['ヒント', 'Hint'],
  'btn.newDeal': ['新しく配る', 'New Deal'],
  'btn.autoFinish': ['全部積む', 'Finish'],
  'btn.nextDeal': ['次の配り', 'Next Deal'],
  'btn.toDaily': ['今日の配りへ', "Play Today's Deal"],
  'btn.share': ['共有', 'Share'],
  'btn.install': ['アプリにする', 'Install'],
  'btn.close': ['閉じる', 'Close'],
  'btn.cancel': ['やめる', 'Cancel'],
  'btn.start': ['はじめる', "Let's play"],
  'btn.menu': ['メニュー', 'Menu'],
  'menu.stats': ['記録', 'Stats'],
  'menu.howto': ['遊び方', 'How to Play'],
  'menu.sound': ['音', 'Sound'],
  'menu.lang': ['言葉', 'Language'],
  on: ['オン', 'On'],
  off: ['オフ', 'Off'],
  'howto.1': ['下の 7 つの列から札を動かして、上の 4 つの置き場に、マークごとに A・2・3 … K と積む。全部積めたら勝ち。',
    'Move cards from the seven columns to the four piles at the top, building each suit from A up to K. Move them all to win.'],
  'howto.2': ['列の上には、1 つ小さい数で色ちがい（赤と黒）の札を重ねられる。空いた列には K だけ置ける。',
    'In the columns, stack cards one lower in the opposite color (red on black, black on red). Only a K can go in an empty column.'],
  'howto.3': ['困ったら左上の山をめくる。この配りは必ず解ける。行きづまっても「戻す」で何手でも戻れる。',
    'Stuck? Tap the stock at top left. Every deal can be won, and you can undo as many moves as you like.'],
  'howto.tap': ['札をタップすると、行ける所へ動きます。指で持って運んでも動かせます。',
    'Tap a card to send it where it fits, or drag it with your finger.'],
  'stuck.title': ['動かせる札がありません', 'No moves left'],
  'stuck.body': ['この配りは解けるので、戻すと続けられます。', 'This deal can be won. Undo a few moves and try another way.'],
  'confirm.abandon': ['この局をやめて、新しく配りますか', 'Leave this game and deal a new one?'],
  'confirm.note': ['勝たずにやめると、連勝が 0 に戻ります。', 'Leaving without winning resets your streak.'],
  'confirm.yes': ['新しく配る', 'Deal'],
  'win.title': ['クリア', 'Cleared!'],
  'win.moves': ['手数', 'Moves'],
  'win.time': ['時間', 'Time'],
  'win.best': ['自己ベスト', 'Personal best'],
  'win.streak': ['{n} 連勝', '{n} wins in a row'],
  'win.nextDaily': ['明日の配りまで あと {h} 時間 {m} 分', 'Next deal in {h}h {m}m'],
  'win.dailyStreak': ['今日の配り {n} 日続けてクリア', "Today's Deal: {n}-day streak"],
  'stats.played': ['遊んだ数', 'Played'],
  'stats.won': ['勝った数', 'Won'],
  'stats.rate': ['勝率', 'Win rate'],
  'stats.streak': ['今の連勝', 'Current streak'],
  'stats.bestStreak': ['一番長い連勝', 'Best streak'],
  'stats.bestMoves': ['最少手数', 'Fewest moves'],
  'stats.bestTime': ['最短時間', 'Fastest time'],
  'stats.today': ['今日', 'Today'],
  'stats.dailyStreak': ['続けて勝った日数', 'Day streak'],
  'stats.recent': ['最近 14 日', 'Last 14 days'],
  'share.daily': ['LONE DECK 今日の配り #{n}（{date}）: {moves} 手・{time}でクリア', "LONE DECK Today's Deal #{n}: cleared in {moves} moves, {time}"],
  'share.free': ['LONE DECK #{n} を {moves} 手・{time}でクリア（{streak} 連勝）', 'LONE DECK #{n} cleared in {moves} moves, {time} ({streak} wins in a row)'],
  'share.app': ['必ず解けるひとりトランプ LONE DECK', 'LONE DECK — solitaire you can always win'],
  credit: ['T.OF... のアプリ', 'An app by T.OF...'],
  contact: ['問い合わせ', 'Contact'],
  'game.klondike': ['クロンダイク（1 枚めくり）', 'Klondike (draw 1)'],
  'a11y.stock': ['山札', 'Stock'],
  'a11y.waste': ['めくった札', 'Waste'],
  'a11y.found': ['置き場', 'Foundation'],
  'a11y.col': ['列 {n}', 'Column {n}'],
};

export const pickLang = (saved, nav = '') => saved === 'ja' || saved === 'en' ? saved : (/^ja/i.test(nav) ? 'ja' : 'en');

export function t(lang, key, vars = {}) {
  const s = STRINGS[key]?.[lang === 'ja' ? 0 : 1] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
}

// 時間: 日本語は「4 分 12 秒」、英語は「4:12」
export function fmtTime(lang, sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  if (lang === 'ja') return m ? `${m} 分 ${String(s).padStart(2, '0')} 秒` : `${s} 秒`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
