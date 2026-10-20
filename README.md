# Gmail Notify

Gmail（複数アカウント）と iCloud メール（1 アカウント）の未読件数を Chrome のツールバーにまとめて表示し、新着メールをデスクトップ通知で知らせる Chrome 拡張（Manifest V3）です。

開発者本人が使うためのもので、Chrome ウェブストアには公開しません。ビルドした `dist/` を「パッケージ化されていない拡張機能」として読み込んで使います。

- Gmail はブラウザでログインしているアカウントを自動で検出します（上限 10 アカウント、受信トレイのみ）。
- iCloud は icloud.com にログインしている 1 アカウントの受信箱を確認します。
- 認証にはブラウザのログイン済みセッション Cookie を使います。OAuth は使いません。
- 既読化、アーカイブ、削除などのメール操作と、拡張内での本文表示はできません。

## 前提

- Node.js: `package.json` の `engines.node` は `^22.13.0 || ^24.0.0 || >=26.0.0` です。開発では範囲外の Node.js 25.2.1 で `npm ci`、typecheck、lint、test、build、icons が通ることを確認しています。ただし `npm ci` で `EBADENGINE` の警告が出ます。範囲外のバージョンでの動作は保証しません。
- Chrome: Manifest V3 に対応したバージョン。

## セットアップとビルド

`package-lock.json` があるので、依存関係は `npm ci` で入れます。

```sh
npm ci
npm run build
```

`npm run build` は `dist/` に拡張を出力します。ソースを変更したら再ビルドし、`chrome://extensions` で拡張を再読み込みしてください。

### アイコンの再生成

`assets/icon.svg` を変更したときは、次のコマンドで `public/icons/icon-{16,32,48,128}.png` を生成し直します。PNG はリポジトリに含めているので、通常のビルドでは実行不要です。

```sh
npm run icons
```

### 開発サーバー

```sh
npm run dev
```

@crxjs/vite-plugin の dev サーバーが起動し、`dist/` に開発用の拡張が書き出されます。この `dist/` を読み込むと、Service Worker は dev サーバーから読み込まれます。background のコードを変更すると拡張全体がリロードされ、popup は HTML や JS の変更でページがリロードされます。この挙動は crxjs の公式ドキュメントに基づくもので、この拡張では確認していません。

## Chrome への読み込み

1. `chrome://extensions` を開く。
2. 右上の「デベロッパーモード」を有効にする。
3. 「パッケージ化されていない拡張機能を読み込む」を押し、`dist` フォルダを選ぶ。
4. 同じ Chrome で Gmail と icloud.com にログインしておく。

## 使い方

### ツールバーアイコン

- バッジには全アカウントの未読数の合計を表示します。すべてのアカウントが正常で合計が 0 のときは表示せず、1000 以上は `999+` と表示します。
- ログインしていないアカウントや取得に失敗したアカウントが 1 つでもあると、バッジの背景が警告色（赤）になります。数字は合計のままです。すべて正常なときは青です。
- 合計が 0 でも正常でないアカウントがあるときは、警告色が見えるようにバッジに `!` を表示します。

### ポップアップ

アイコンをクリックするとポップアップが開き、同時に最新の状態を確認します。

- ヘッダーに未読の合計、最終チェック時刻、「今すぐ更新」ボタン、設定画面へのリンクがあります。
- アカウントごとに、メールアドレスと未読数の見出しの下に、未読メールの差出人、件名、本文の冒頭、日時を表示します。
- 未読が無いアカウントは「未読なし」と表示します。
- ログインしていないアカウントには「ログインしてください」と、ログインページを開くリンクを表示します。
- 取得に失敗したアカウントにはエラーメッセージを表示します。
- 行をクリックすると新しいタブで開き、ポップアップを閉じます。Gmail は該当アカウントでそのメールを開きます。iCloud は個別のメールを開く URL が無いので、`https://www.icloud.com/mail/`（受信箱）を開きます。

### 通知

前回のチェック後に届いた未読メールがあると、アカウントごとにデスクトップ通知を出します。

- 新着が 1 件なら、差出人をタイトルに、件名を本文に表示します。
- 複数件なら「{メールアドレス}: N 件の新着メール」をタイトルに、先頭の件名を本文に表示します。
- 通知をクリックすると、1 件ならそのメールを開きます（iCloud は受信箱）。複数件の場合、実装では Gmail はそのアカウントの受信トレイ、iCloud は受信箱を開きます。この遷移は実機では未確認です。
- 拡張の初回チェックと、新しく検出したアカウントでは通知しません。

### 設定

ポップアップの「設定」リンク、または拡張の「オプション」から開きます。

- チェック間隔: 30 秒、1、2、5、10、15、30 分から選びます。既定は 1 分です。
- 新着メールを通知する（ON/OFF）
- Gmail を確認する（ON/OFF）
- iCloud メールを確認する（ON/OFF）

変更するとすぐに `chrome.storage.sync` に保存し、「保存しました」と表示します。保存すると、新しい間隔でチェックを登録し直し、その場で 1 回チェックします。

## 権限

`src/manifest.ts` で要求している権限と、その用途です。

| 権限 | 用途 |
|---|---|
| `alarms` | 設定した間隔で定期的にチェックする |
| `storage` | 設定（sync）、チェック結果と新着判定用のメール ID（local）、通知クリック時に開く URL（session）を保存する |
| `notifications` | 新着メールのデスクトップ通知を出す |
| `declarativeNetRequest` | iCloud への自拡張のリクエストに限り、`Origin` と `Referer` ヘッダーを書き換える |
| `cookies` | iCloud にログインしているかを `X-APPLE-WEBAUTH-USER` Cookie の有無で調べる |
| `https://mail.google.com/*` | Gmail の未読フィードを取得する |
| `https://accounts.google.com/*` | 未ログイン時の Gmail フィードのリダイレクト先を受け取って「ログインしてください」と判定するため |
| `https://*.icloud.com/*` | iCloud の API を呼び出す |

### 保存するデータ

- 設定は `chrome.storage.sync` に保存するので、Chrome の同期の対象になる場合があります。
- チェック結果は `chrome.storage.local` に保存します。結果にはメールアドレス、未読メールの差出人、件名、本文の冒頭、日時が含まれます。

## 制約と注意

### 非公式な取得方法であること

- Gmail は、ログイン済みセッション Cookie を使って Atom フィード（`https://mail.google.com/mail/u/{n}/feed/atom`）を取得します。Cookie を使ってこのフィードを利用する方法は、公式に文書化されていません。
- iCloud は、icloud.com のログイン済みセッション Cookie を使って非公開の API を呼び出します。リクエストの内容と応答の形は公開されている実装に基づく推定で、実機ではまだ確認していません。
- どちらも提供元の変更で、予告なく動かなくなる可能性があります。

### iCloud の CORS

iCloud へのリクエストは、declarativeNetRequest で `Origin` と `Referer` を `https://www.icloud.com` に書き換えて送ります。この書き換えでは fetch の実際の origin（`chrome-extension://...`）は変わらないため、ブラウザの CORS の判定で応答が拒否される可能性があります。実機での確認は T6-3 で行います（`.tmp/design.md` §7.1）。

### サードパーティ Cookie のブロック

Chrome の拡張機能のドキュメントには、ホスト権限を持つ拡張からのリクエストでの Cookie の扱いと、サードパーティ Cookie をブロックしたときの例外が記載されています。Chrome の設定やポリシー、Cookie の属性によっては、拡張からの fetch にセッション Cookie が送られない可能性があります。その場合、ログインしていても「ログインしてください」やエラーと表示されることが考えられます。この拡張での症状と対処は、実機では未確認です。

- [Storage and cookies](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)
- [Cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- [chrome.cookies](https://developer.chrome.com/docs/extensions/reference/api/cookies)

### その他

- ログアウトしている間、そのアカウントは「ログインしてください」と表示され、バッジが警告色になります。
- iCloud は受信箱のスレッドを最大 50 件取得し、その中の未読を一覧にします。未読数は受信箱の未読数を使うので、一覧の件数と一致しない場合があります。

## 開発用コマンド

| コマンド | 内容 |
|---|---|
| `npm run dev` | crxjs の開発サーバーを起動する |
| `npm run build` | `dist/` にビルドする |
| `npm run typecheck` | `tsc --noEmit` で型チェックする |
| `npm run lint` | ESLint を実行する |
| `npm test` | Vitest を 1 回実行する（watch モードではない） |
| `npm run icons` | `assets/icon.svg` から `public/icons/` の PNG を生成する |

## ディレクトリ構成

```
assets/icon.svg          アイコンの元画像
scripts/build-icons.ts   PNG を生成するスクリプト
public/icons/            生成した PNG（ビルド時に dist へコピーされる）
src/manifest.ts          manifest の定義
src/background/          Service Worker（定期チェック、バッジ、通知、iCloud のヘッダー書き換え）
src/providers/           Gmail と iCloud の取得処理、応答の zod スキーマ
src/popup/               ポップアップ
src/options/             設定画面
src/shared/              型、定数、設定と状態の読み書き、メッセージの型
tests/                   Vitest のテストと fixture
.tmp/                    要件定義、設計書、タスクリスト、ライブラリ調査メモ
```
