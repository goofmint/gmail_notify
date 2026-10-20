# ライブラリ調査メモ（2026-10-20 時点）

対象: `.tmp/design.md` の技術スタック。バージョンは npm registry の `latest` を確認した。
コード例は Node 25.2.1 上のスクラッチ環境で実際に動かして確認済み（crxjs のビルド、ESLint ルール、Vitest、resvg の PNG 生成を含む）。

### 調査方法と情報源
- Context7 MCP は本セッションで接続できなかった（MCP サーバー未構成）。このため Context7 の libraryId は未取得で、本メモの内容は Context7 で確認したものではない。
- 代替の情報源は次の 3 つ。各セクションの記述はいずれかに基づく。
  1. npm registry（`https://registry.npmjs.org/<pkg>/latest`）で `version`、`peerDependencies`、`engines` を取得（2026-10-20）。
  2. 公式ドキュメント・GitHub README・リリースノート（crxjs.dev、fast-xml-parser docs、zod.dev、typescript-eslint.io、vitest.dev、github.com/thx/resvg-js、TypeScript 公式ブログ）。
  3. スクラッチ環境での実行確認（インストール、ビルド、lint、テスト、PNG 生成）。「確認済み」と書いた項目はこれに基づく。
- Web 検索由来の版番号は npm registry と一致したものだけを採用した。

## 0. 全体で押さえること（重要）

| パッケージ | latest | 備考 |
|---|---|---|
| @crxjs/vite-plugin | **3.0.0**（2026-09-24） | 2.x stable は 2.7.1 が最終。3.0.0 は ESM 専用化が唯一の破壊的変更 |
| vite | 8.3.4 | Rolldown + Oxc ベース。`build.rollupOptions` → `build.rolldownOptions` に改名（旧名も当面動く） |
| typescript | **7.0.2**（Go 製ネイティブ、API なし） / 6.0.3 | **typescript-eslint は TS 7 に非対応**（peer: `>=4.8.4 <6.1.0`）。**TS 6.0.3 を使う** |
| typescript-eslint | 8.72.0 | ESLint 10 対応。`tseslint.config()` は非推奨、`defineConfig` を使う |
| eslint | 10.13.0 | eslintrc 完全廃止。flat config のみ |
| vitest | 5.0.5 | engines は Node `^22.12 \|\| ^24 \|\| >=26`（23 と 25 は範囲外。25.2.1 で動作確認済みだが保証外）。Vite >= 6.4 が必須。`clearMocks` が既定 true に |
| fast-xml-parser | 5.11.2 | ESM で `import { XMLParser }` 可 |
| zod | 4.6.7 | `import * as z from 'zod'` で v4。`error.issues`、`z.prettifyError` |
| @resvg/resvg-js | 2.6.2 | CJS パッケージだが ESM から named import 可（動作確認済み） |
| @types/chrome | 0.3.5 | 0.3.0 で `browser` グローバル別名が追加。`types: ["chrome"]` で使う |
| @types/node | 26.6.5 | `scripts/build-icons.ts` の `node:fs` 型解決に必要 |
| tsx | 4.23.15 | Node 25 は型ストリップが既定で有効なので必須ではない（後述） |

### TypeScript のバージョン方針
- `typescript@7.0.2` は Go 製コンパイラで、**プログラム API を同梱していない**（公式ブログ: "it does not ship with an API"、7.1 で新 API 予定）。typescript-eslint の型付き lint が動かないため、本プロジェクトは **`typescript@~6.0.3`** を devDependency にする。
- 高速な型チェックだけ欲しければ、公式推奨どおり npm alias で 7 を別名インストールできるが、本プロジェクトでは不要。

## 1. @crxjs/vite-plugin 3.0.0

- インストール: `npm i -D vite @crxjs/vite-plugin`
- 3.0.0 の破壊的変更は「CommonJS 出力の廃止（ESM のみ）」だけ。`package.json` に `"type": "module"` を付ける。
- peer: `vite ^3 || ^4 || ^5 || ^6 || ^7 || ^8`。Vite 8 で動作確認済み。
- 公式ドキュメントは crxjs.dev（ソース: github.com/crxjs/website の `content/`）。

```ts
// src/manifest.ts
import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'Gmail + iCloud Unread',
  version: '0.1.0',
  description: '...',
  action: {
    default_popup: 'src/popup/index.html',
    default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
  },
  icons: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  options_page: 'src/options/index.html',
  permissions: ['alarms', 'storage', 'notifications', 'declarativeNetRequest', 'cookies', 'tabs'],
  host_permissions: ['https://mail.google.com/*', 'https://*.icloud.com/*'],
});
```

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest';

export default defineConfig({
  plugins: [crx({ manifest })],
  server: {
    // 公式ドキュメントの必須設定。dev サーバーへ拡張オリジンからのアクセスを許可する
    cors: { origin: [/chrome-extension:\/\//] },
  },
});
```

- `defineManifest` は `defineManifest(async (env) => ({...}))` の関数形式も受け付ける（`env.mode` で分岐可）。
- manifest 内のパスは **Vite の root 相対**で書く（`./` や `../` は禁止、`src/popup/index.html` の形）。
- 出力先は Vite 既定の `dist/`。`chrome://extensions` → 「パッケージ化されていない拡張機能を読み込む」で `dist` を選ぶ。
- ビルドすると `background.service_worker` は `service-worker-loader.js` に書き換わり、HTML は `dist/src/popup/index.html` のようにパスを維持して出力される（確認済み）。
- dev モード: service worker は dev サーバーから読み込まれ、background のコード変更時は **拡張全体がフルリロード**される。popup は HTML/JS 変更でページリロード。popup を開いたまま開発するには右クリック →「ポップアップを検証」。
- `server.port` / `server.hmr` の設定は公式ドキュメントに要求なし。3.0.0 で Vite 8.1+ の WebSocket 設定に追従済み、dev サーバー再起動後の再接続も修正済み。
- `crx()` のオプション: `liveReload: false` で自動リロード/HMR を止められる（ファイルは引き続き `dist` に書き出される）。`browser: 'firefox'` も指定可。
- 追加の HTML ページ（manifest に載らないもの）は `build.rolldownOptions.input` で追加する（本プロジェクトでは不要）。
- 落とし穴: `import manifest from './src/manifest'` を vite.config.ts で行うので、tsconfig の `include` に `vite.config.ts` を入れておく。

## 2. fast-xml-parser 5.11.2

- インストール: `npm i fast-xml-parser`
- `import { XMLParser } from 'fast-xml-parser'`（ESM OK）。Service Worker（DOMParser なし）でも動く純 JS。

```ts
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,        // 既定 true。false にしないと link href が消える
  attributeNamePrefix: '@_',      // 属性は "@_href" のようなキーになる
  parseTagValue: false,           // "2" → 2 への自動変換を止める（数値化は zod の coerce に任せる）
  isArray: (tagName, jPath, isLeafNode, isAttribute) => jPath === 'feed.entry', // entry を常に配列に
});
const doc = parser.parse(xmlText);
```

実際の出力（Gmail Atom を上記オプションでパース）:

```json
{
  "feed": {
    "title": "Gmail - Inbox for a@b.com",
    "fullcount": "2",
    "link": { "@_rel": "alternate", "@_href": "https://mail.google.com/mail/u/0", "@_type": "text/html" },
    "entry": [
      {
        "title": "Hi",
        "summary": "snip",
        "link": { "@_rel": "alternate", "@_href": "https://mail.google.com/mail/u/0?account_id=a@b.com&message_id=18f0abc&view=conv&extsrc=atom", "@_type": "text/html" },
        "issued": "2026-10-20T01:02:03Z",
        "id": "tag:gmail.google.com,2004:123",
        "author": { "name": "Bob", "email": "bob@x.com" }
      }
    ],
    "@_version": "0.3",
    "@_xmlns": "http://purl.org/atom/ns#"
  }
}
```

- `isArray` のシグネチャは `(tagName: string, jPath: string, isLeafNode: boolean, isAttribute: boolean) => boolean`。jPath は `feed.entry` のようなドット区切り（ルートタグ含む）。
- 属性だけの自己終了タグ `<link href="..."/>` は `{ "@_href": "..." }` のオブジェクトになる（`#text` は付かない）。属性なしの空タグは `""`。
- 属性とテキストが両方あるタグは `{ "@_id": "123", "#text": "Alice" }` のように同じオブジェクトに並ぶ（`textNodeName` 既定 `#text`）。
- `&amp;` などのエンティティは属性値でもデコード済み（href に `&` が入っている）。
- `parseTagValue` 既定 true: `<fullcount>2</fullcount>` が数値 2 になるが、数字だけの文字列も数値化されるため ID 系で事故る。**false 推奨**、数値化は `z.coerce.number()` で行う。
- `trimValues` 既定 true。`<?xml ...?>` は `"?xml"` キーとして混入するので zod で無視する（`z.object` は未知キーを除去）。

## 3. zod 4.6.7

- インストール: `npm i zod`
- `import * as z from 'zod'` で v4 が入る。`zod/v4` サブパスも残っているが、v4 パッケージでは不要（`zod/v4` は 3.25 系からの移行用）。

```ts
import * as z from 'zod';

const GmailEntrySchema = z.object({
  title: z.string(),
  summary: z.string(),
  link: z.object({ '@_href': z.string() }),
  issued: z.string(),
  author: z.object({ name: z.string().optional(), email: z.string() }), // 設計 §6.3: name が無ければ email を使う
});

export const GmailFeedSchema = z.object({
  feed: z.object({
    title: z.string(),
    fullcount: z.coerce.number().int().nonnegative(),
    entry: z.array(GmailEntrySchema),
  }),
});

export type GmailFeed = z.infer<typeof GmailFeedSchema>;

const result = GmailFeedSchema.safeParse(doc);
if (!result.success) {
  throw new Error(`Gmail feed の形式が想定と違います: ${z.prettifyError(result.error)}`);
}
const feed: GmailFeed = result.data;
```

- `safeParse` は `{ success: true, data } | { success: false, error: ZodError }` の判別共用体。`parse` は throw。
- エラーの中身は `error.issues`（`code`, `path`, `message`）。`error.errors` は v4 で削除。
- 整形: `z.prettifyError(error)`（人が読む文字列）、`z.treeifyError(error)`、`z.flattenError(error)`。`error.format()` / `error.flatten()` は非推奨。
- strictness: `z.object` は未知キーを**除去**（既定）。未知キーをエラーにしたいなら `z.strictObject({...})`、残したいなら `z.looseObject({...})`。`.strict()` / `.passthrough()` は非推奨（残っているが使わない）。外部 API 応答（iCloud）は余計なキーが来るので `z.object` で良い。
- `z.coerce.number()` の入力型は `unknown`。**キーが欠けていると coerce でもエラー**になる（確認済み: `{ u: 1 }` に対して `n` 欠落で失敗）。欠落許容なら `.optional()` を明示する。
- `z.union([z.string(), z.number()])`。失敗時 issue の `code` は `invalid_union` で、各候補のエラーが `errors` に入る。
- `z.infer<typeof Schema>` で出力型、`z.input<typeof Schema>` で入力型。
- Vitest / Service Worker ともに追加設定なしで動く。

## 4. typescript-eslint 8.72.0 + ESLint 10.13.0

- インストール: `npm i -D eslint @eslint/js typescript-eslint typescript@~6.0.3`
- ESLint 10: eslintrc 廃止、Node `^20.19 || ^22.13 || >=24`。設定ファイルは `eslint.config.js`（`"type": "module"` 前提）。
- `tseslint.config()` は非推奨。`defineConfig` / `globalIgnores` を `eslint/config` から使う。
- 型付き lint は `tseslint.configs.recommendedTypeChecked` + `parserOptions.projectService: true`。

```js
// eslint.config.js
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['dist/**', 'node_modules/**']),
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-restricted-types': ['error', {
        types: { unknown: { message: 'unknown は使わず zod で検証して型を付ける' } },
      }],
      'no-restricted-syntax': ['error',
        { selector: 'ClassDeclaration', message: 'class は使わない' },
        { selector: 'ClassExpression', message: 'class は使わない' },
      ],
    },
  },
);
```

動作確認済みの出力:

```
1:17  error  Unexpected any. Specify a different type                                   @typescript-eslint/no-explicit-any
2:17  error  Don't use `unknown` as a type. unknown は使わず zod で検証して型を付ける  @typescript-eslint/no-restricted-types
3:8   error  class は使わない                                                            no-restricted-syntax
4:20  error  class は使わない                                                            no-restricted-syntax
```

- `projectService: true` を使うと、lint 対象ファイルは tsconfig の `include` に入っている必要がある（`vite.config.ts`, `vitest.config.ts`, `scripts/**`, `tests/**` も含める）。
- `no-restricted-types` の `types` の値は文字列（メッセージ）/ `true` / `{ message, fixWith?, suggest? }`。
- `@typescript-eslint/no-explicit-any` は `recommended` で既に error。明示しても害はない。
- 利用可能な configs: `recommended`, `recommendedTypeChecked`, `strict`, `strictTypeChecked`, `stylistic`, `stylisticTypeChecked`, `disableTypeChecked` など。
- **TS 7.0.2 を入れると typescript-eslint が動かない**（peer `<6.1.0`、かつ 7.0 に API がない）。

## 5. Vitest 5.0.5

- インストール: `npm i -D vitest`（`vite` は peer 依存。本プロジェクトは vite を入れるので問題なし）
- Node `^22.12 || ^24 || >=26`。Node 25.2.1 は engines 的には外れるが動作確認済み（警告なし）。T0-2 では `package.json` の `engines.node` をこの範囲に合わせ、CI を使う場合は Node 24 系を固定する。
- 5.0 の主な変更: `clearMocks` が既定 true、ネストしたスコープ内の `vi.mock` は throw、`await` し忘れた `resolves/rejects` はテスト失敗、`vi.fn(Class)` の prototype がチェーンされる。

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',          // 既定 'node'。popup の DOM をテストするなら 'jsdom' か 'happy-dom'（別途インストール）
    include: ['tests/**/*.test.ts'],
    restoreMocks: true,           // vi.spyOn を各テスト後に復元
    unstubGlobals: true,          // vi.stubGlobal を各テスト後に復元
    // globals: true,             // 使うなら tsconfig の types に "vitest/globals" を追加
  },
});
```

```ts
// tests/gmail.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

describe('fetchFeed', () => {
  it('2xx の XML を返す', async () => {
    fetchMock.mockResolvedValue(new Response('<feed/>', { status: 200 }));
    const res = await fetch('https://mail.google.com/mail/u/0/feed/atom', { credentials: 'include' });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith('https://mail.google.com/mail/u/0/feed/atom', { credentials: 'include' });
  });

  it('spyOn', () => {
    const obj = { f: () => 1 };
    const spy = vi.spyOn(obj, 'f').mockReturnValue(2);
    expect(obj.f()).toBe(2);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
```

- `vi.fn<T extends Procedure | Constructable>(impl?: T): Mock<T>`。`vi.fn<typeof fetch>()` で型付きモックになり、`mockResolvedValue` の引数が `Response` に制限される。
- `vi.stubGlobal(name, value)` / `vi.unstubAllGlobals()`。`vi.spyOn(obj, 'method')` / `vi.restoreAllMocks()`。
- `vi.mock('./module', () => ({ fn: vi.fn() }))` はファイル先頭に hoist される。トップレベル以外で呼ぶと v5 では例外。部分モックは `vi.mock(path, async (importOriginal) => ({ ...(await importOriginal()), fn: vi.fn() }))`。
- `chrome.*` は Vitest 環境に存在しないので、`vi.stubGlobal('chrome', {...})` で必要な API だけ置く。設計どおり純粋関数と分けておけば置く量は少ない。
- `Response` / `fetch` は Node 22+ でグローバル利用可。
- `test.globals` 既定 false。

## 6. @resvg/resvg-js 2.6.2

- インストール: `npm i -D @resvg/resvg-js`（napi-rs ネイティブ。darwin-arm64 等のバイナリは optionalDependencies で入る）
- CJS パッケージ（`exports` なし、`main: index.js`）だが、ESM から `import { Resvg } from '@resvg/resvg-js'` で named import できることを確認済み。

```ts
// scripts/build-icons.ts  （実行: npx tsx scripts/build-icons.ts  または  node scripts/build-icons.ts）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

type IconSize = 16 | 32 | 48 | 128;
const SIZES: readonly IconSize[] = [16, 32, 48, 128];

const svg = readFileSync('assets/icon.svg', 'utf8');
mkdirSync('public/icons', { recursive: true });

for (const size of SIZES) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(`public/icons/icon-${size}.png`, png);
  console.log(`icon-${size}.png ${png.length} bytes`);
}
```

- `new Resvg(svg: Buffer | string, options?: ResvgRenderOptions | null)`。`fitTo` は `{ mode: 'original' } | { mode: 'width'; value } | { mode: 'height'; value } | { mode: 'zoom'; value }`。
- `render()` は `RenderedImage`（`width`, `height`, `asPng(): Buffer`, `pixels`）。16px 指定で 16x16 RGBA PNG が出ることを確認。
- テキストを含まない SVG なら `loadSystemFonts: false` を付けると速い（本プロジェクトのアイコンは不要なら省略可）。
- 出力先は Vite の `public/` 配下に置けば `dist/` にそのままコピーされ、manifest の `icons` から `icons/icon-16.png` と参照できる。

## 7. @types/chrome 0.3.5、tsconfig、スクリプトの実行方法

### @types/chrome
- インストール: `npm i -D @types/chrome @types/node`
- 0.3.0（2026-09-15）で `declare var browser: typeof chrome;` が追加された（Firefox 互換用の別名）。0.2.x → 0.3.x でそれ以外の破壊的変更は確認できず。typeScriptVersion は 5.6 以上。
- tsconfig は `types` に `chrome` を列挙する。`types` を書くと自動取り込みが止まるので、`vite/client`（`import.meta.env` 等）と `node`（scripts 用）も明示する。

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "types": ["chrome", "vite/client", "node"]
  },
  "include": ["src", "tests", "scripts", "vite.config.ts", "vitest.config.ts"]
}
```

- Service Worker 側と popup 側で `lib` を分けたくなるが、1 つの tsconfig で `DOM` を含めても実害はない。分けるなら `tsconfig.sw.json` を追加して `lib: ["ES2022", "WebWorker"]`。
- `@types/node` を入れないと `node:fs` の import が `TS2591` になる（確認済み）。

### scripts/build-icons.ts の実行（Node 25.2.1）
- Node は **v23.6 / v22.18 以降、型ストリップが既定で有効**（`--experimental-strip-types` 不要。25.2 で stable）。`node scripts/build-icons.ts` がそのまま動くことを確認済み。
- 条件: `package.json` に `"type": "module"`（ないと `Cannot use import statement outside a module`）、型 import は `import type` を付ける、相対 import は `.ts` 拡張子必須、enum / namespace（値あり）/ parameter properties / decorators は使えない、tsconfig は読まれない（paths 不可）。
- `tsx` 4.23.15 は上記制約なしで動く（`npx tsx scripts/build-icons.ts` も確認済み）。制約が気にならなければ依存を減らすため `node` 直実行で良い。package.json の script 名はタスク文書（T0-2）に合わせて `icons` にする（`"icons": "tsx scripts/build-icons.ts"`。node 直実行なら `"icons": "node scripts/build-icons.ts"`）。

## 8. package.json devDependencies 案

```json
{
  "type": "module",
  "devDependencies": {
    "@crxjs/vite-plugin": "^3.0.0",
    "@eslint/js": "^10.0.1",
    "@resvg/resvg-js": "^2.6.2",
    "@types/chrome": "^0.3.5",
    "@types/node": "^26.6.5",
    "eslint": "^10.13.0",
    "tsx": "^4.23.15",
    "typescript": "~6.0.3",
    "typescript-eslint": "^8.72.0",
    "vite": "^8.3.4",
    "vitest": "^5.0.5"
  },
  "dependencies": {
    "fast-xml-parser": "^5.11.2",
    "zod": "^4.6.7"
  }
}
```

## 9. 完了条件の扱い（T0-1）

- T0-1 は調査のみのタスクで、リポジトリに `package.json` が無い。したがって完了条件の `npm run typecheck`、`npm run lint`、`npm test` はこのタスクでは実行できず、適用対象外とする。
- テスト対象のコードを作らないため、テストも書かない。基盤（package.json、tsconfig、ESLint、Vitest）の構築は T0-2 で行い、そこで 3 コマンドを通す。
- 後続タスクへの引き継ぎ:
  - T0-2: §8 の devDependencies 案と §0 の互換条件に従って依存を決める。`vitest.config.ts` を `vite.config.ts` から分け、`crx()` をテスト設定に含めない。
  - T2（Gmail パーサ）: `XMLParser.parse` の戻り値は型定義上 `any`。これを変数に受けると `no-unsafe-assignment` に、`any` 以外の型の引数に渡すと `no-unsafe-argument` に掛かる。zod の `safeParse(data: unknown)` は引数が `unknown` なので `no-unsafe-argument` の対象外（ルール仕様で `unknown` 引数への `any` は許容）。したがって `any` の境界は「`parser.parse(xml)` を変数に受けず、式として直接 `GmailFeedSchema.safeParse(...)` に渡す」1 箇所に閉じ、成功時の `data` だけを使う（§2、§3）。この 1 行以外にアプリ側の `any`/`unknown` を置かない。
