import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type * as z from 'zod';
import {
  checkResultSchema,
  loadNotificationUrl,
  loadResult,
  loadSeenIds,
  removeNotificationUrl,
  saveNotificationUrl,
  saveResult,
  saveSeenIds,
} from '../src/shared/storage';
import type { CheckResult } from '../src/shared/types';

type StoredValue = string | number | boolean | null | StoredValue[] | { [key: string]: StoredValue };
type StoredItems = Record<string, StoredValue>;

// chrome.storage の 1 領域をメモリ上で再現する。
function createArea() {
  const items: StoredItems = {};
  return {
    items,
    get: vi.fn((key: string): Promise<StoredItems> => {
      // chrome.storage と同じく、保存済みのキーだけを返す（継承プロパティは返さない）。
      if (!Object.hasOwn(items, key)) {
        return Promise.resolve({});
      }
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

let local: ReturnType<typeof createArea>;
let session: ReturnType<typeof createArea>;

beforeEach(() => {
  local = createArea();
  session = createArea();
  vi.stubGlobal('chrome', { storage: { local, session } });
});

const result: CheckResult = {
  checkedAt: '2026-10-20T00:00:00.000Z',
  accounts: [
    {
      provider: 'gmail',
      accountKey: 'gmail:u/0',
      email: 'user@gmail.com',
      status: 'ok',
      unreadCount: 1,
      items: [
        {
          id: '18c0ffee',
          provider: 'gmail',
          accountKey: 'gmail:u/0',
          from: '送信者',
          subject: '件名',
          snippet: '本文の抜粋',
          date: '2026-10-19T23:59:00Z',
          openUrl: 'https://mail.google.com/mail/u/0/#inbox/18c0ffee',
        },
      ],
      errorMessage: null,
    },
    {
      provider: 'icloud',
      accountKey: 'icloud',
      email: null,
      status: 'signedOut',
      unreadCount: 0,
      items: [],
      errorMessage: null,
    },
  ],
};

describe('スキーマと型', () => {
  it('checkResultSchema の入出力は CheckResult と一致する', () => {
    expectTypeOf<z.infer<typeof checkResultSchema>>().toEqualTypeOf<CheckResult>();
    expectTypeOf<z.input<typeof checkResultSchema>>().toEqualTypeOf<CheckResult>();
  });
});

describe('result', () => {
  it('未保存なら null を返し、get に result キーを渡す', async () => {
    await expect(loadResult()).resolves.toBeNull();
    expect(local.get).toHaveBeenCalledWith('result');
  });

  it('保存した値を読み戻せる', async () => {
    await saveResult(result);
    expect(local.set).toHaveBeenCalledWith({ result });
    await expect(loadResult()).resolves.toEqual(result);
  });

  it('形式が不正なら例外にする', async () => {
    local.items.result = { checkedAt: '2026-10-20T00:00:00.000Z', accounts: [{ status: 'unknownStatus' }] };
    await expect(loadResult()).rejects.toThrow(/result の形式が不正[\s\S]*accounts/);
  });
});

describe('seenIds', () => {
  it('未保存なら null を返し、get に seenIds キーを渡す', async () => {
    await expect(loadSeenIds()).resolves.toBeNull();
    expect(local.get).toHaveBeenCalledWith('seenIds');
  });

  it('空オブジェクトは null ではなく {} として返す', async () => {
    await saveSeenIds({});
    await expect(loadSeenIds()).resolves.toEqual({});
  });

  it('保存した値を読み戻せる', async () => {
    const seenIds = { 'gmail:u/0': ['a', 'b'], icloud: [] };
    await saveSeenIds(seenIds);
    expect(local.set).toHaveBeenCalledWith({ seenIds });
    await expect(loadSeenIds()).resolves.toEqual(seenIds);
  });

  it('形式が不正なら例外にする', async () => {
    local.items.seenIds = { 'gmail:u/0': 'a' };
    await expect(loadSeenIds()).rejects.toThrow(/seenIds の形式が不正/);
  });
});

describe('通知の URL', () => {
  const notificationId = 'mail:gmail:u/0:1760918400000';
  const url = 'https://mail.google.com/mail/u/0/#inbox';

  it('notificationId をキーにして session に保存し、読み戻せる', async () => {
    await saveNotificationUrl(notificationId, url);
    expect(session.set).toHaveBeenCalledWith({ [notificationId]: url });
    await expect(loadNotificationUrl(notificationId)).resolves.toBe(url);
    expect(session.get).toHaveBeenCalledWith(notificationId);
    expect(local.set).not.toHaveBeenCalled();
  });

  it('未保存なら null を返す', async () => {
    await expect(loadNotificationUrl(notificationId)).resolves.toBeNull();
  });

  it('継承プロパティ名のキー（constructor）も未保存として null を返す', async () => {
    await expect(loadNotificationUrl('constructor')).resolves.toBeNull();
  });

  it('文字列でなければ例外にする', async () => {
    session.items[notificationId] = 1;
    await expect(loadNotificationUrl(notificationId)).rejects.toThrow(/URL の形式が不正/);
  });

  it('削除すると null に戻る', async () => {
    await saveNotificationUrl(notificationId, url);
    await removeNotificationUrl(notificationId);
    expect(session.remove).toHaveBeenCalledWith(notificationId);
    await expect(loadNotificationUrl(notificationId)).resolves.toBeNull();
  });
});
