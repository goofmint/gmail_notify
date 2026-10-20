# タスクリスト: Gmail + iCloud 未読通知 Chrome拡張

対応する設計: `.tmp/design.md`
各タスクの完了条件として、関連するテストを書き、`npm run typecheck`、`npm run lint`、`npm test` が通ることを確認する。ただし T0-1 は調査のみで `package.json` が存在しないため、この完了条件は T0-2 以降に適用する。

## Phase 0: 準備
- [ ] T0-1 Context7 で次のライブラリの最新の使い方を確認し、要点を `.tmp/library-notes.md` にメモする。
  - @crxjs/vite-plugin
  - fast-xml-parser
  - zod
  - typescript-eslint
  - Vitest
  - @resvg/resvg-js
- [ ] T0-2 プロジェクトの雛形を作る。
  - package.json（scripts: dev / build / typecheck / lint / test / icons）
  - tsconfig.json（strict）
  - vite.config.ts
  - vitest.config.ts
  - eslint.config.js（`no-explicit-any` を error にする。`unknown` と `class` も禁止するルールを設定する）
  - .gitignore（node_modules、dist）
- [ ] T0-3 `assets/icon.svg`（封筒のアイコン）と `scripts/build-icons.ts` を作り、`public/icons/icon-{16,32,48,128}.png` を生成する。
- [ ] T0-4 `src/manifest.ts` と空の background、popup、options を作る。`npm run build` が成功し、dist を Chrome に読み込めることを確認する。

## Phase 1: 共通基盤
- [ ] T1-1 `src/shared/types.ts` に型を定義する（設計 §4）。
- [ ] T1-2 `src/shared/constants.ts` に URL、既定値、上限値、ストレージキー、色、アラーム名を定義する（設計 §5）。
- [ ] T1-3 `src/shared/settings.ts` に loadSettings と saveSettings を実装する。読んだ値は zod で検証する。
- [ ] T1-4 `src/shared/storage.ts` に result、seenIds、通知の URL 対応の型付き読み書きを実装する。
- [ ] T1-5 `src/shared/messages.ts` に runtime メッセージの型（`check-now`）を定義する。

## Phase 2: Gmail プロバイダ
- [ ] T2-1 `src/providers/schemas.ts` に `GmailFeedSchema` を定義する。
- [ ] T2-2 `src/providers/gmailParser.ts` を実装する（設計 §6.3）。
- [ ] T2-3 fixture（0 件、1 件、複数件、不正な XML）を用意し、`tests/gmailParser.test.ts` を書く。
- [ ] T2-4 `src/providers/gmail.ts` に fetchFeed と discoverGmailAccounts を実装する（設計 §6.1、§6.2）。
- [ ] T2-5 `tests/gmail.test.ts` を書く。fetch をモックし、次を確認する。
  - リダイレクトで検出が打ち切られる。
  - 401 で signedOut になる。
  - メールアドレスが重複したら打ち切られる。
  - 上限の 10 件で打ち切られる。

## Phase 3: iCloud プロバイダ
- [ ] T3-1 `schemas.ts` に `ValidateSchema`、`GeqsSchema`、`ThreadSearchSchema` を追加する。
- [ ] T3-2 `src/background/icloudRules.ts` に DNR の dynamic rule の登録を実装する（設計 §7.1）。
- [ ] T3-3 `src/providers/icloud.ts` に Cookie の確認、validate、geqs/query、thread/search、ステータスの判定を実装する（設計 §7.2）。
- [ ] T3-4 fixture を用意し、`tests/icloud.test.ts` を書く。次を確認する。
  - 正常系
  - Cookie が無いとき
  - 421 と 450 で signedOut になる
  - スキーマ検証の失敗
  - INBOX が無いとき

## Phase 4: バックグラウンド
- [ ] T4-1 `src/background/diff.ts` に detectNewMail と nextSeenIds を純粋関数として実装し、`tests/diff.test.ts` を書く。
- [ ] T4-2 `src/background/badge.ts` を実装する。文字列を生成する関数はテストする。
- [ ] T4-3 `src/background/notifications.ts` に通知の作成、URL 対応の保存、クリックの処理を実装する。
- [ ] T4-4 `src/background/checker.ts` の runCheck を実装する。allSettled で並列に実行し、多重実行を防ぐ。
- [ ] T4-5 `src/background/index.ts` でイベントを配線する（設計 §8.1）。

## Phase 5: UI
- [ ] T5-1 `src/popup` に HTML/CSS の骨組みとヘッダー（合計、最終チェック時刻、更新ボタン、設定へのリンク）を作る。
- [ ] T5-2 `src/popup/render.ts` でアカウントごとのセクションを描画する。状態は ok、signedOut、error、未読なしを扱い、textContent だけで描画する。
- [ ] T5-3 ポップアップの動作を作る。
  - 開いたら check-now を送る。
  - storage.onChanged で描画し直す。
  - 行をクリックしたらタブを開いてポップアップを閉じる。
- [ ] T5-4 `src/options` に設定フォームを作る。即時に保存し、保存結果を表示する。

## Phase 6: 検証
- [ ] T6-1 `npm run typecheck`、`npm run lint`、`npm test`、`npm run build` がすべて通ることを確認する。
- [ ] T6-2 `README.md` にセットアップ手順、ビルド手順、読み込み手順、制約（非公式 API であること、サードパーティ Cookie のブロック）を書く。
- [ ] T6-3 実機での受け入れテストをユーザーが行う（requirements §6 の 1〜5）。不具合があれば修正する。

## 依存関係
- T0 → T1 → T2-1 → (T2-2〜T2-5 ∥ T3) → T4 → T5 → T6
- T2-1 と T3-1 はどちらも `src/providers/schemas.ts` を変更するので、T3-1 は T2-1 の後に行う。それ以外の T2 と T3 は互いに独立しているので、並行して進められる。
