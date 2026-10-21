import { afterEach, describe, expect, it, vi } from 'vitest';
import { allAccountsOk, badgeColor, badgeText, totalUnread, updateBadge } from '../src/background/badge';
import { BADGE_COLORS } from '../src/shared/constants';
import type { AccountState, AccountStatus } from '../src/shared/types';

function account(accountKey: string, unreadCount: number, status: AccountStatus = 'ok'): AccountState {
  return {
    provider: accountKey === 'icloud' ? 'icloud' : 'gmail',
    accountKey,
    email: status === 'signedOut' ? null : `${accountKey}@example.com`,
    status,
    unreadCount,
    items: [],
    errorMessage: status === 'error' ? '取得に失敗' : null,
    errorKind: null,
  };
}

/** chrome.action のバッジ API だけを置く。 */
function stubAction() {
  const setBadgeText = vi.fn((details: chrome.action.BadgeTextDetails): Promise<void> => {
    void details;
    return Promise.resolve();
  });
  const setBadgeBackgroundColor = vi.fn((details: chrome.action.BadgeColorDetails): Promise<void> => {
    void details;
    return Promise.resolve();
  });
  vi.stubGlobal('chrome', { action: { setBadgeText, setBadgeBackgroundColor } });
  return { setBadgeText, setBadgeBackgroundColor };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('totalUnread', () => {
  it('空なら 0', () => {
    expect(totalUnread([])).toBe(0);
  });

  it('全アカウントの unreadCount を合計する', () => {
    expect(totalUnread([account('gmail:u/0', 3), account('gmail:u/1', 0, 'error'), account('icloud', 5)])).toBe(8);
  });
});

describe('badgeText', () => {
  it.each([
    [0, ''],
    [1, '1'],
    [999, '999'],
    [1000, '999+'],
    [12345, '999+'],
  ])('全アカウントが ok で %i 件なら %j', (total, expected) => {
    expect(badgeText(total, true)).toBe(expected);
  });

  it.each([
    [0, '!'],
    [5, '5'],
    [1000, '999+'],
  ])('ok 以外のアカウントがあり %i 件なら %j', (total, expected) => {
    expect(badgeText(total, false)).toBe(expected);
  });
});

describe('allAccountsOk', () => {
  it('アカウントが無ければ true', () => {
    expect(allAccountsOk([])).toBe(true);
  });

  it('全アカウントが ok なら true', () => {
    expect(allAccountsOk([account('gmail:u/0', 1), account('icloud', 0)])).toBe(true);
  });

  it.each<AccountStatus>(['error', 'signedOut'])('%s のアカウントがあれば false', (status) => {
    expect(allAccountsOk([account('gmail:u/0', 1), account('icloud', 0, status)])).toBe(false);
  });
});

describe('badgeColor', () => {
  it('全アカウントが ok なら通常色', () => {
    expect(badgeColor([account('gmail:u/0', 1), account('icloud', 0)])).toBe(BADGE_COLORS.ok);
  });

  it('アカウントが無ければ通常色', () => {
    expect(badgeColor([])).toBe(BADGE_COLORS.ok);
  });

  it.each<AccountStatus>(['error', 'signedOut'])('%s のアカウントがあれば警告色', (status) => {
    expect(badgeColor([account('gmail:u/0', 1), account('icloud', 0, status)])).toBe(BADGE_COLORS.warning);
  });
});

describe('updateBadge', () => {
  it('合計の文字列と状態に応じた色を設定する', async () => {
    const { setBadgeText, setBadgeBackgroundColor } = stubAction();

    await updateBadge([account('gmail:u/0', 1000), account('icloud', 0, 'error')]);

    expect(setBadgeText).toHaveBeenCalledWith({ text: '999+' });
    expect(setBadgeBackgroundColor).toHaveBeenCalledWith({ color: BADGE_COLORS.warning });
  });

  it('未読が 0 で全アカウントが ok なら空文字と通常色', async () => {
    const { setBadgeText, setBadgeBackgroundColor } = stubAction();

    await updateBadge([account('gmail:u/0', 0)]);

    expect(setBadgeText).toHaveBeenCalledWith({ text: '' });
    expect(setBadgeBackgroundColor).toHaveBeenCalledWith({ color: BADGE_COLORS.ok });
  });

  it('未読が 0 で ok 以外のアカウントがあれば ! と警告色', async () => {
    const { setBadgeText, setBadgeBackgroundColor } = stubAction();

    await updateBadge([account('gmail:u/0', 0), account('icloud', 0, 'signedOut')]);

    expect(setBadgeText).toHaveBeenCalledWith({ text: '!' });
    expect(setBadgeBackgroundColor).toHaveBeenCalledWith({ color: BADGE_COLORS.warning });
  });
});
