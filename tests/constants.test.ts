import { describe, expect, it } from 'vitest';
import {
  BADGE_COLORS,
  BADGE_MAX_COUNT,
  DEFAULT_SETTINGS,
  GMAIL_FEED_URL,
  GMAIL_INBOX_URL,
  GMAIL_LOGIN_URL,
  GMAIL_MESSAGE_URL,
  ICLOUD_MAIL_URL,
  ICLOUD_ORIGIN,
  ICLOUD_VALIDATE_URL,
  MIN_INTERVAL_MINUTES,
  STORAGE_KEYS,
} from '../src/shared/constants';

describe('Gmail の URL', () => {
  it('フィード URL にアカウント番号が入る', () => {
    expect(GMAIL_FEED_URL(0)).toBe('https://mail.google.com/mail/u/0/feed/atom');
    expect(GMAIL_FEED_URL(3)).toBe('https://mail.google.com/mail/u/3/feed/atom');
  });

  it('メール URL にアカウント番号と id が入る', () => {
    expect(GMAIL_MESSAGE_URL(1, '18c0ffee')).toBe('https://mail.google.com/mail/u/1/#inbox/18c0ffee');
  });

  it('受信トレイ URL にアカウント番号が入る', () => {
    expect(GMAIL_INBOX_URL(2)).toBe('https://mail.google.com/mail/u/2/#inbox');
  });

  it('ログイン URL は Gmail へ戻る', () => {
    const url = new URL(GMAIL_LOGIN_URL);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('continue')).toBe('https://mail.google.com/mail/');
  });
});

describe('iCloud の URL', () => {
  it('固定値を持つ', () => {
    expect(ICLOUD_ORIGIN).toBe('https://www.icloud.com');
    expect(ICLOUD_MAIL_URL).toBe('https://www.icloud.com/mail/');
    expect(ICLOUD_VALIDATE_URL).toBe('https://setup.icloud.com/setup/ws/1/validate');
  });
});

describe('DEFAULT_SETTINGS', () => {
  it('設計どおりの既定値で、間隔は最小値以上', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      intervalMinutes: 1,
      notificationsEnabled: true,
      gmailEnabled: true,
      icloudEnabled: true,
    });
    expect(DEFAULT_SETTINGS.intervalMinutes).toBeGreaterThanOrEqual(MIN_INTERVAL_MINUTES);
  });
});

describe('STORAGE_KEYS', () => {
  it('result と seenIds だけを持つ', () => {
    expect(STORAGE_KEYS).toEqual({ result: 'result', seenIds: 'seenIds' });
  });
});

describe('バッジ', () => {
  it('色は #rrggbb 形式', () => {
    for (const color of Object.values(BADGE_COLORS)) {
      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('最大表示件数は 999', () => {
    expect(BADGE_MAX_COUNT).toBe(999);
  });
});
