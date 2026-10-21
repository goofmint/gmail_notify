import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../src/options/index.html', import.meta.url), 'utf8');

describe('設定画面の HTML', () => {
  it('スタイルシートとスクリプトを読み込む', () => {
    expect(html).toMatch(/<link rel="stylesheet" href="\.\/style\.css"/);
    expect(html).toMatch(/<script type="module" src="\.\/main\.ts"><\/script>/);
  });

  it('フォームと各入力があり、読み込み前は無効にしている', () => {
    expect(html).toContain('<form id="settings-form">');
    expect(html).toMatch(/<select id="intervalMinutes"[^>]*disabled><\/select>/);
    for (const id of ['notificationsEnabled', 'gmailEnabled', 'icloudEnabled', 'ignoreUnreachableAccounts']) {
      expect(html).toMatch(new RegExp(`<input id="${id}"[^>]*type="checkbox" disabled />`));
    }
  });

  it('保存結果を表示する欄がある', () => {
    expect(html).toContain('<p id="status" role="status"></p>');
  });
});
