# 設計書: Gmail + iCloud 未読通知 Chrome拡張

対応する要件: `.tmp/requirements.md`

## 1. 全体構成
```
┌──────────────┐  storage.onChanged   ┌───────────────────────────┐
│ popup        │ ◀─────────────────── │ background (Service Worker)│
│ options      │ ── runtime message ─▶│  alarms → runCheck()       │
└──────────────┘   ("check-now")      │   ├ providers/gmail        │──▶ mail.google.com
                                      │   ├ providers/icloud       │──▶ setup / mccgateway.icloud.com
                                      │   ├ badge / notifications  │
                                      │   └ storage.local に保存   │
                                      └───────────────────────────┘
```
- ネットワークアクセス、状態の保存、通知はすべて Service Worker で行う。
- popup と options は storage の内容を読んで描画し、操作は runtime メッセージで Service Worker に依頼する。

## 2. 技術スタック
| 用途 | 採用 |
|---|---|
| ビルド | Vite + @crxjs/vite-plugin（MV3 の manifest を TS で定義） |
| 言語 | TypeScript（strict） |
| XML パース | fast-xml-parser（Service Worker では DOMParser が使えないため） |
| 応答の検証 | zod（`any`/`unknown` を使わずに型を付けるため） |
| テスト | Vitest |
| Lint | ESLint（flat config）+ typescript-eslint |
| アイコン生成 | @resvg/resvg-js で SVG から PNG（16/32/48/128）を生成するスクリプト |

各ライブラリの API は、実装前に Context7 で最新版の使い方を確認する。

## 3. ディレクトリ構成
```
package.json, tsconfig.json, vite.config.ts, vitest.config.ts, eslint.config.js
scripts/build-icons.ts
assets/icon.svg
src/manifest.ts
src/shared/types.ts         型定義
src/shared/constants.ts     URL、既定値、上限値、ストレージキー
src/shared/settings.ts      設定の読み書き
src/shared/storage.ts       状態の読み書き（型付きラッパ）
src/shared/messages.ts      runtime メッセージの型
src/providers/schemas.ts    zod スキーマ
src/providers/gmailParser.ts
src/providers/gmail.ts
src/providers/icloud.ts
src/background/index.ts
src/background/checker.ts
src/background/diff.ts      新着の差分検出（純粋関数）
src/background/badge.ts
src/background/notifications.ts
src/background/icloudRules.ts
src/popup/index.html, main.ts, render.ts, style.css
src/options/index.html, main.ts, style.css
tests/fixtures/*.xml, *.json
tests/*.test.ts
```

## 4. 型定義（src/shared/types.ts）
```ts
type Provider = 'gmail' | 'icloud';
type AccountStatus = 'ok' | 'signedOut' | 'error';

type MailItem = {
  id: string;            // gmail: message_id(hex) / icloud: threadId
  provider: Provider;
  accountKey: string;    // gmail: "gmail:u/0" / icloud: "icloud"
  from: string;
  subject: string;
  snippet: string;
  date: string;          // ISO8601
  openUrl: string;
};

type AccountState = {
  provider: Provider;
  accountKey: string;
  email: string | null;  // signedOut のときは null
  status: AccountStatus;
  unreadCount: number;
  items: MailItem[];
  errorMessage: string | null;
};

type CheckResult = {
  checkedAt: string;
  accounts: AccountState[];
};

type Settings = {
  intervalMinutes: number;      // 0.5 以上
  notificationsEnabled: boolean;
  gmailEnabled: boolean;
  icloudEnabled: boolean;
};
```

## 5. 定数（src/shared/constants.ts）
- 既定の設定値: `DEFAULT_SETTINGS = { intervalMinutes: 1, notificationsEnabled: true, gmailEnabled: true, icloudEnabled: true }`
- 上限値と最小値: `MIN_INTERVAL_MINUTES = 0.5`、`MAX_GMAIL_ACCOUNTS = 10`、`ICLOUD_MAX_RESULTS = 50`
- URL:
  - `GMAIL_FEED_URL(n)`、`GMAIL_MESSAGE_URL(n, id)`、`GMAIL_LOGIN_URL`
  - `ICLOUD_VALIDATE_URL`、`ICLOUD_MAIL_URL = 'https://www.icloud.com/mail/'`、`ICLOUD_ORIGIN`
- ストレージキー: `STORAGE_KEYS = { result, seenIds, settings }`
- アラーム名: `ALARM_NAME`
- 既定値はここだけで定義する。設定を読むときは `chrome.storage.sync.get(DEFAULT_SETTINGS)` に渡して、chrome API の仕様どおりに既定値と合成する。読んだ結果は zod で検証し、型が不正ならエラーにする。

## 6. Gmail プロバイダ

### 6.1 フィードの取得（gmail.ts）
```
fetchFeed(n): fetch(GMAIL_FEED_URL(n) + '?zx=' + rand,
                    { credentials: 'include', cache: 'no-store' })
```
応答は次のように判定する。
| 応答 | 判定 |
|---|---|
| 401、または最終 URL が accounts.google.com | signedOut |
| 最終 URL の `/u/{m}/` が要求した n と違う（m ≠ n） | 存在しないアカウント。検出を打ち切る |
| 上記以外の 2xx 以外 | error（`HTTP {status}`） |
| 2xx | XML を gmailParser に渡す |

### 6.2 アカウント検出（discoverGmailAccounts）
- n = 0 から `MAX_GMAIL_ACCOUNTS - 1` まで順に取得する。
- 次のいずれかで検出を打ち切る。
  - 存在しないアカウントと判定された。
  - title が無い。
  - 既に見つかったメールアドレスと重複した。
- 結果として `AccountState[]` を返す。
- n = 0 が signedOut なら、Gmail 全体として signedOut のアカウントを 1 件返す（accountKey `gmail:u/0`、email null）。
- アカウントの検出とフィードの取得は同じ処理で行い、毎回のチェックで全件取り直す。

### 6.3 パーサ（gmailParser.ts）
- fast-xml-parser で XML をオブジェクトに変換し、zod の `GmailFeedSchema` で検証する。
  - entry は 1 件だとオブジェクト、複数件だと配列になるので、`isArray` オプションで常に配列にする。
- 取り出す値:
  | 値 | 取り出し方 |
  |---|---|
  | email | `<title>` を正規表現 `/[^\s]+@[^\s]+/` で抽出する。一致しなければエラー |
  | fullcount | 数値に変換する |
  | id | entry の link href から `/[?&]message_id=([^&#]+)/` で取る |
  | 各フィールド | from = author.name（無ければ author.email）、subject = title、snippet = summary、date = issued |
  | openUrl | `https://mail.google.com/mail/u/{n}/#inbox/{id}` |
- `unreadCount = Math.max(fullcount, entries.length)`
- 必須の要素が欠けていたらエラーとして扱う。値を補って処理を続けることはしない。

## 7. iCloud プロバイダ（icloud.ts）

### 7.1 Origin の書き換え（icloudRules.ts）
`chrome.declarativeNetRequest.updateDynamicRules` で次のルールを登録する。登録は onInstalled と onStartup のときに行い、既存の同じ ID は先に削除してから登録する。
```ts
{ id: 1, priority: 1,
  action: { type: 'modifyHeaders', requestHeaders: [
    { header: 'origin',  operation: 'set', value: 'https://www.icloud.com' },
    { header: 'referer', operation: 'set', value: 'https://www.icloud.com/' } ] },
  condition: { initiatorDomains: [chrome.runtime.id],
    regexFilter: '^https://[^/]+\\.icloud\\.com/(setup|mailws2)/',
    resourceTypes: ['xmlhttprequest'] } }
```
注意: この modifyHeaders は送信する `Origin`/`Referer` ヘッダーを書き換えるだけで、fetch の実際の origin（`chrome-extension://...`）や initiator は変わらない。応答の `Access-Control-Allow-Origin` が書き換え後の値と一致しても、ブラウザの CORS 判定で応答が拒否される可能性がある。T3-4 のユニットテストでは検証できないため、T6-3 の実機テストで Service Worker から実際に validate、geqs/query、thread/search を fetch し、HTTP ステータスと `response.json()` の結果を確認する。あわせて DevTools の Network で各 POST に対応する `OPTIONS`（preflight）が発生しているかを確認し、発生している場合はその status と応答ヘッダー（`Access-Control-Allow-Origin`、`Access-Control-Allow-Credentials`、`Access-Control-Allow-Headers` に `content-type`、`Access-Control-Allow-Methods` に `POST`）を記録する。拒否される場合の代替方式は、同じ DNR の dynamic rule に `responseHeaders` の書き換えを追加し、`Access-Control-Allow-Origin` を拡張の origin（`chrome-extension://{id}`）に、`Access-Control-Allow-Credentials` を `true` に、さらに preflight 応答向けに `Access-Control-Allow-Headers` に `content-type` を、`Access-Control-Allow-Methods` に `POST` を設定する方法を第一候補とする（`Content-Type: application/json` は CORS セーフリスト外なので、CORS が適用される場合は `OPTIONS` の preflight が発生し、その応答に `Access-Control-Allow-Headers: content-type` が無いと本体の `POST` は送信されない）（`Cookie` は Fetch の禁止リクエストヘッダーなので、`chrome.cookies` で読んだ値を `fetch` のヘッダーに付ける方式は実装できない）。方式見直しの判断基準は、実機テストで 3 つのリクエストのいずれかが CORS エラー（`TypeError: Failed to fetch`）になることとする。

### 7.2 処理の流れ
1. 事前チェック: `chrome.cookies.get({url:'https://www.icloud.com', name:'X-APPLE-WEBAUTH-USER'})` で Cookie を調べる。無ければ signedOut として終了する。
2. `POST ICLOUD_VALIDATE_URL` を body `null` で送る。`ValidateSchema` で検証し、次の値を取り出す。
   - `dsInfo.dsid`
   - `dsInfo.primaryEmail`
   - `webservices.mccgateway.url`（末尾の `:443` を除去する）
3. `POST {mcc}/mailws2/v1/geqs/query?dsid=` を送り、mailbox を問い合わせる。`GeqsSchema` で検証し、`name === 'INBOX'` の `unseenCount` を未読数にする。INBOX が無ければエラーとする。
4. `POST {mcc}/mailws2/v1/thread/search?dsid=` を送る。body は次のとおり。
   ```json
   {"responseType":"THREAD_DIGEST","includeFolderStatus":false,"maxResults":50,
    "sessionHeaders":{"folder":"INBOX","modseq":null,"threadmodseq":null,"condstore":1,"qresync":1,"threadmode":1}}
   ```
   応答を `ThreadSearchSchema` で検証し、`flags` に `\Seen` を含まないスレッドだけを MailItem にする。
   | MailItem | 値 |
   |---|---|
   | id | threadId |
   | from | senders[0]（`ThreadSearchSchema` で `senders` に `.min(1)` を付け、空配列はスキーマエラーにする） |
   | subject | subject |
   | snippet | preview |
   | date | timestamp（ミリ秒）を ISO 文字列に変換 |
   | openUrl | ICLOUD_MAIL_URL |
5. HTTP ステータスは次のように判定する。
   | ステータス | 判定 |
   |---|---|
   | 401、403、421、450 | signedOut |
   | その他の 2xx 以外 | error |
   | スキーマ検証の失敗 | error（API 仕様変更の可能性があることをメッセージに含める） |

いずれのリクエストも `credentials: 'include'` と `Content-Type: application/json` を付けて送る。

## 8. バックグラウンド

### 8.1 index.ts（イベントの配線）
| イベント | 処理 |
|---|---|
| onInstalled | ルール登録、アラーム登録、runCheck |
| onStartup | ルール登録、アラーム登録、runCheck |
| alarms.onAlarm | ALARM_NAME なら runCheck |
| runtime.onMessage `{type:'check-now'}` | runCheck を実行し、完了したら応答する |
| storage.onChanged（settings） | アラームを登録し直し、runCheck |
| notifications.onClicked | storage.session から URL を引いてタブで開き、通知を閉じる |

### 8.2 checker.ts の runCheck
1. 設定を読む。
2. 有効なプロバイダを `Promise.allSettled` で並列に実行する。一方が reject しても、もう一方の結果は使う。reject されたプロバイダは error 状態のアカウントにする。
3. 前回の seenIds（`Record<accountKey, string[]>`）を読む。
4. diff.ts の `detectNewMail(prevSeen, accounts)` で新着を求める。
   - 前回の seenIds が存在しない（初回チェック）なら、新着は空にする。
   - 前回に無かった accountKey（新しく検出したアカウント）は、新着の対象外にする。
   - それ以外は、今回の items のうち、前回の id 集合に無いものを新着とする。
5. 次の seenIds を保存する。status が ok のアカウントは今回の id で上書きする。signedOut や error のアカウントは前回の値を残す。これは、復帰したときにまとめて通知が出るのを防ぐため。
6. CheckResult を保存し、バッジを更新する。新着があり、通知が ON なら通知する。
7. 同時に複数の runCheck が動かないよう、実行中の Promise を共有する。

### 8.3 badge.ts
- `setBadgeText`: 合計が 0 なら空文字。1000 以上なら `999+` と表示する。
- `setBadgeBackgroundColor`: 全アカウントが ok なら通常色、それ以外なら警告色にする。色は constants で定義する。

### 8.4 notifications.ts
- 通知はアカウント単位で 1 つ出す。notificationId は `mail:{accountKey}:{Date.now()}`。
- 通知の内容は次のとおり。
  | 項目 | 内容 |
  |---|---|
  | title | 1 件なら差出人。複数件なら `{email}: {N} 件の新着メール` |
  | message | 1 件なら件名。複数件なら先頭の件名 |
  | contextMessage | アカウントのメールアドレス |
  | iconUrl | 拡張のアイコン（128px） |
- クリック時に開く URL: 1 件ならその openUrl を開く。複数件の場合、Gmail はそのアカウントの受信トレイ、iCloud は ICLOUD_MAIL_URL を開く。
- `chrome.storage.session` に `{[notificationId]: url}` を保存しておき、クリックされたらこれを使って開く。

## 9. ポップアップ
- 開いたら storage.local の result を描画し、続けて `check-now` を送る。storage.onChanged で結果の更新を受け取ったら描画し直す。
- 画面構成:
  - ヘッダー: 合計未読数、最終チェック時刻、更新ボタン、設定へのリンク
  - アカウントごとのセクション
    - 見出し: アイコン（G または iCloud）、メールアドレス、未読数
    - status が ok なら items の一覧
    - signedOut なら「ログインしてください」とログインページへのリンク
    - error なら errorMessage
  - 未読が 0 件のアカウントは「未読なし」と表示する
- 行をクリックしたら `chrome.tabs.create({url: openUrl})` を呼び、`window.close()` する。
- 描画では文字列を textContent で設定する。innerHTML は使わない（メール内容による XSS を防ぐため）。
- 幅は 400px 前後。日時は `Intl.DateTimeFormat` でブラウザのロケールに合わせて表示する。

## 10. 設定画面
- 項目: チェック間隔（select で 0.5、1、2、5、10、15、30 分）、通知 ON/OFF、Gmail 有効、iCloud 有効
- 変更したらすぐ `chrome.storage.sync.set` で保存し、「保存しました」と表示する。保存に失敗したらエラーを表示する。

## 11. manifest
```ts
{
  manifest_version: 3, name, version, description,
  action: { default_popup: 'src/popup/index.html', default_icon: {...} },
  icons: {...},
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  options_page: 'src/options/index.html',
  permissions: ['alarms','storage','notifications','declarativeNetRequest','cookies'],
  host_permissions: ['https://mail.google.com/*','https://*.icloud.com/*']
}
```

## 12. テスト方針
| 対象 | 内容 |
|---|---|
| gmailParser | 0 件、1 件、複数件の fixture と、title にメールアドレスが無いなどの異常系 |
| icloud | validate、geqs、thread/search の応答 fixture を、スキーマ検証から MailItem への変換まで確認する。fetch はモックし、ステータスごとの判定も確認する |
| diff | 初回、新規アカウント、通常の差分、エラーのアカウントで前回値を維持すること |
| badge | 表示文字列の生成（0、999+） |

Chrome API を使う部分は、純粋関数と分けてテストしやすくする。
