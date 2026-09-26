# LONE DECK

T.OF... のアプリ。https://t-of.github.io/lone-deck/

- ルールは本部の `~/GitHub/tof/t-of.github.io/RULES.md` に従う（全アプリ共通）。ブランドは `docs/BRAND.md`。
- 直したら本部で `npm run audit:browser -- lone-deck` を通す。
- 公開は本部の `docs/RELEASE.md` の手順。大きな作業は本部で Claude を起動すると、役割を分けて進められる。
- localStorage のキーは `lone-deck.` で始める。SW のキャッシュ名は `lone-deck-` で始める。
- 自己チェックは `node tools/test.mjs`。決まり（logic.js）を変えたら通す。
- `deals.js` は `tools/solve.mjs` が作る（手で書き換えない）。`logic.js` の `deal` と乱数を変えると一覧が全部別の配りになるので、変えない。
