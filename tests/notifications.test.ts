import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewMailGroup } from '../src/background/diff';
import { buildNotification, handleNotificationClick, notifyNewMail } from '../src/background/notifications';
import { GMAIL_INBOX_URL, ICLOUD_MAIL_URL } from '../src/shared/constants';
import type { AccountState, MailItem } from '../src/shared/types';

const EXTENSION_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const NOW = 1_760_000_000_000;

type StoredItems = Record<string, string>;

// chrome.storage.session をメモリ上で再現し、実際の storage.ts を通す。
function createSession() {
  const items: StoredItems = {};
  return {
    items,
    get: vi.fn((key: string): Promise<StoredItems> => {
      const value = items[key];
      return Promise.resolve(value === undefined ? {} : { [key]: value });
    }),
    set: vi.fn((values: StoredItems): Promise<void> => {
      Object.assign(items, values);
      return Promise.resolve();
    }),
    remove: vi.fn((key: string): Promise<void> => {
      delete items[key];
      return Promise.resolve();
    }),
  };
}

let session: ReturnType<typeof createSession>;
/** create が呼ばれた時点で session に保存済みだった URL。保存が通知より先であることの確認に使う。 */
let urlsAtCreate: (string | undefined)[];
const createNotification = vi.fn(
  (notificationId: string, options: chrome.notifications.NotificationCreateOptions): Promise<string> => {
    void options;
    urlsAtCreate.push(session.items[notificationId]);
    return Promise.resolve(notificationId);
  },
);
const clearNotification = vi.fn((notificationId: string): Promise<boolean> => {
  void notificationId;
  return Promise.resolve(true);
});
// 戻り値の Tab は使わないので返さない。
const createTab = vi.fn((properties: chrome.tabs.CreateProperties): Promise<void> => {
  void properties;
  return Promise.resolve();
});

beforeEach(() => {
  vi.clearAllMocks();
  session = createSession();
  urlsAtCreate = [];
  vi.stubGlobal('chrome', {
    runtime: { getURL: (path: string) => `${EXTENSION_ORIGIN}/${path}` },
    storage: { session },
    notifications: { create: createNotification, clear: clearNotification },
    tabs: { create: createTab },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function item(accountKey: string, id: string): MailItem {
  return {
    id,
    provider: accountKey === 'icloud' ? 'icloud' : 'gmail',
    accountKey,
    from: `送信者 ${id}`,
    subject: `件名 ${id}`,
    snippet: `本文 ${id}`,
    date: '2026-10-20T00:00:00.000Z',
    openUrl: `https://example.com/open/${id}`,
  };
}

function group(accountKey: string, ids: string[], email: string | null = `${accountKey}@example.com`): NewMailGroup {
  const items = ids.map((id) => item(accountKey, id));
  const account: AccountState = {
    provider: accountKey === 'icloud' ? 'icloud' : 'gmail',
    accountKey,
    email,
    status: 'ok',
    unreadCount: items.length,
    items,
    errorMessage: null,
  };
  return { account, items };
}

describe('buildNotification', () => {
  it('1 件なら差出人と件名を出し、そのメールを開く', () => {
    expect(buildNotification(group('gmail:u/0', ['a']), NOW)).toEqual({
      notificationId: `mail:gmail:u/0:${NOW}`,
      options: {
        type: 'basic',
        iconUrl: `${EXTENSION_ORIGIN}/icons/icon-128.png`,
        title: '送信者 a',
        message: '件名 a',
        contextMessage: 'gmail:u/0@example.com',
      },
      url: 'https://example.com/open/a',
    });
  });

  it('Gmail で複数件なら件数と先頭の件名を出し、そのアカウントの受信トレイを開く', () => {
    const built = buildNotification(group('gmail:u/2', ['a', 'b', 'c'], 'user@gmail.com'), NOW);
    expect(built.options.title).toBe('user@gmail.com: 3 件の新着メール');
    expect(built.options.message).toBe('件名 a');
    expect(built.options.contextMessage).toBe('user@gmail.com');
    expect(built.url).toBe(GMAIL_INBOX_URL(2));
  });

  it('iCloud で複数件なら iCloud メールを開く', () => {
    const built = buildNotification(group('icloud', ['t1', 't2'], 'user@icloud.com'), NOW);
    expect(built.notificationId).toBe(`mail:icloud:${NOW}`);
    expect(built.options.title).toBe('user@icloud.com: 2 件の新着メール');
    expect(built.url).toBe(ICLOUD_MAIL_URL);
  });

  it('iCloud で 1 件ならそのメールを開く', () => {
    expect(buildNotification(group('icloud', ['t1']), NOW).url).toBe('https://example.com/open/t1');
  });

  it('Gmail の accountKey の形式が不正なら例外', () => {
    expect(() => buildNotification(group('gmail:x', ['a', 'b']), NOW)).toThrow('gmail:x');
  });

  it('email が null なら例外', () => {
    expect(() => buildNotification(group('gmail:u/0', ['a'], null), NOW)).toThrow('gmail:u/0');
  });

  it('新着が 0 件なら例外', () => {
    expect(() => buildNotification(group('gmail:u/0', []), NOW)).toThrow('gmail:u/0');
  });
});

describe('notifyNewMail', () => {
  it('アカウントごとに URL を保存してから通知を出す', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);

    await notifyNewMail([group('gmail:u/0', ['a']), group('icloud', ['t1', 't2'])]);

    expect(createNotification).toHaveBeenCalledTimes(2);
    expect(createNotification.mock.calls.map(([id]) => id)).toEqual([`mail:gmail:u/0:${NOW}`, `mail:icloud:${NOW}`]);
    expect(urlsAtCreate).toEqual(['https://example.com/open/a', ICLOUD_MAIL_URL]);
    expect(session.items).toEqual({
      [`mail:gmail:u/0:${NOW}`]: 'https://example.com/open/a',
      [`mail:icloud:${NOW}`]: ICLOUD_MAIL_URL,
    });
  });

  it('グループが空なら何もしない', async () => {
    await notifyNewMail([]);
    expect(createNotification).not.toHaveBeenCalled();
    expect(session.set).not.toHaveBeenCalled();
  });

  it('URL の保存に失敗したら通知を出さずに reject する', async () => {
    session.set.mockRejectedValueOnce(new Error('保存失敗'));
    await expect(notifyNewMail([group('gmail:u/0', ['a'])])).rejects.toThrow('保存失敗');
    expect(createNotification).not.toHaveBeenCalled();
  });
});

describe('handleNotificationClick', () => {
  it('保存した URL をタブで開き、URL を消して通知を閉じる', async () => {
    session.items['mail:gmail:u/0:1'] = 'https://example.com/open/a';

    await handleNotificationClick('mail:gmail:u/0:1');

    expect(createTab).toHaveBeenCalledWith({ url: 'https://example.com/open/a' });
    expect(session.items).toEqual({});
    expect(clearNotification).toHaveBeenCalledWith('mail:gmail:u/0:1');
  });

  it('URL が無ければタブを開かずに通知だけ閉じる', async () => {
    await handleNotificationClick('mail:gmail:u/0:1');

    expect(createTab).not.toHaveBeenCalled();
    expect(session.remove).not.toHaveBeenCalled();
    expect(clearNotification).toHaveBeenCalledWith('mail:gmail:u/0:1');
  });

  it('タブを開けなければ reject し、URL を残す', async () => {
    session.items['mail:icloud:1'] = ICLOUD_MAIL_URL;
    createTab.mockRejectedValueOnce(new Error('タブを開けない'));

    await expect(handleNotificationClick('mail:icloud:1')).rejects.toThrow('タブを開けない');
    expect(session.items).toEqual({ 'mail:icloud:1': ICLOUD_MAIL_URL });
    expect(clearNotification).not.toHaveBeenCalled();
  });
});
