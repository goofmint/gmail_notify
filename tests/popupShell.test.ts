import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../src/popup/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/popup/style.css', import.meta.url), 'utf8');

describe('ポップアップの HTML', () => {
  it('スタイルシートとスクリプトを読み込む', () => {
    expect(html).toMatch(/<link rel="stylesheet" href="\.\/style\.css"/);
    expect(html).toMatch(/<script type="module" src="\.\/main\.ts"><\/script>/);
  });

  it('合計未読数の初期表示は未取得を示す', () => {
    expect(html).toMatch(/<span id="total-unread"[^>]*>—<\/span>/);
  });

  it('最終チェック時刻の初期表示は未取得', () => {
    expect(html).toMatch(/<span id="checked-at">未取得<\/span>/);
  });

  it('更新ボタンがある', () => {
    expect(html).toMatch(/<button id="refresh" type="button">今すぐ更新<\/button>/);
  });

  it('設定画面へのリンクを別タブで開く', () => {
    expect(html).toMatch(/<a id="open-settings" href="\.\.\/options\/index\.html" target="_blank">設定<\/a>/);
  });

  it('エラーを表示する通知欄があり、初期状態では隠す', () => {
    expect(html).toMatch(/<p id="message"[^>]*role="alert"[^>]*hidden><\/p>/);
  });

  it('アカウントの描画領域に初期メッセージがある', () => {
    expect(html).toMatch(/<main id="accounts">\s*<p id="empty"[^>]*>まだ確認していません<\/p>\s*<\/main>/);
  });
});

describe('ポップアップの CSS', () => {
  it('幅を 400px にする', () => {
    expect(css).toMatch(/width:\s*400px/);
  });

  it('状態別のスタイルがある', () => {
    expect(css).toContain('.status-signedOut');
    expect(css).toContain('.status-error');
  });
});
