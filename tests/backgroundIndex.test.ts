import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ALARM_NAME } from '../src/shared/constants';
import type { CheckNowResponse } from '../src/shared/messages';
import type { Settings } from '../src/shared/types';

type Listener<E> = E extends chrome.events.Event<infer L> ? L : never;
type OnMessageListener = Listener<typeof chrome.runtime.onMessage>;
type OnChangedListener = Listener<typeof chrome.storage.onChanged>;
type OnAlarmListener = Listener<typeof chrome.alarms.onAlarm>;

// index.ts は import 時にリスナーを登録するため、chrome とモックは vi.hoisted で import より先に置く。
// clearMocks で消えないよう、登録されたリスナーは vi.fn ではなく普通の関数で受け取る。
const h = vi.hoisted(() => {
  const listeners: {
    onInstalled: (() => void)[];
    onStartup: (() => void)[];
    onAlarm: OnAlarmListener[];
    onMessage: OnMessageListener[];
    onChanged: OnChangedListener[];
    onClicked: ((notificationId: string) => void)[];
  } = { onInstalled: [], onStartup: [], onAlarm: [], onMessage: [], onChanged: [], onClicked: [] };
  const createAlarm = vi.fn((name: string, info: chrome.alarms.AlarmCreateInfo): Promise<void> => {
    void name;
    void info;
    return Promise.resolve();
  });
  vi.stubGlobal('chrome', {
    runtime: {
      onInstalled: { addListener: (cb: () => void) => listeners.onInstalled.push(cb) },
      onStartup: { addListener: (cb: () => void) => listeners.onStartup.push(cb) },
      onMessage: { addListener: (cb: OnMessageListener) => listeners.onMessage.push(cb) },
    },
    alarms: { create: createAlarm, onAlarm: { addListener: (cb: OnAlarmListener) => listeners.onAlarm.push(cb) } },
    storage: { onChanged: { addListener: (cb: OnChangedListener) => listeners.onChanged.push(cb) } },
    notifications: { onClicked: { addListener: (cb: (id: string) => void) => listeners.onClicked.push(cb) } },
  });
  return {
    listeners,
    createAlarm,
    runCheck: vi.fn<() => Promise<void>>(),
    registerIcloudRules: vi.fn<() => Promise<void>>(),
    loadSettings: vi.fn<() => Promise<Settings>>(),
    handleNotificationClick: vi.fn<(notificationId: string) => Promise<void>>(),
  };
});

vi.mock('../src/background/checker', () => ({ runCheck: h.runCheck }));
vi.mock('../src/background/icloudRules', () => ({ registerIcloudRules: h.registerIcloudRules }));
vi.mock('../src/shared/settings', () => ({ loadSettings: h.loadSettings }));
vi.mock('../src/background/notifications', () => ({ handleNotificationClick: h.handleNotificationClick }));

await import('../src/background/index');

const SETTINGS: Settings = { intervalMinutes: 5, notificationsEnabled: true, gmailEnabled: true, icloudEnabled: true };
const SENDER: chrome.runtime.MessageSender = { id: 'abcdefghijklmnopabcdefghijklmnop' };

/** 登録されたリスナーが 1 つだけであることを確かめて返す。 */
function only<T>(listeners: T[]): T {
  expect(listeners).toHaveLength(1);
  const [listener] = listeners;
  if (listener === undefined) {
    throw new Error('リスナーが登録されていない');
  }
  return listener;
}

/** 呼ばれた順に名前を記録する。 */
let calls: string[];
// clearMocks は呼び出し履歴だけを消すので、ログを抑える実装はテストをまたいで残る。
const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

beforeEach(() => {
  calls = [];
  h.loadSettings.mockResolvedValue(SETTINGS);
  h.runCheck.mockImplementation(() => {
    calls.push('runCheck');
    return Promise.resolve();
  });
  h.registerIcloudRules.mockImplementation(() => {
    calls.push('registerIcloudRules');
    return Promise.resolve();
  });
  h.createAlarm.mockImplementation(() => {
    calls.push('createAlarm');
    return Promise.resolve();
  });
  h.handleNotificationClick.mockResolvedValue();
});

/** エラーが label 付きでログに出るまで待つ。 */
async function expectLogged(message: string, label = 'バックグラウンド処理に失敗'): Promise<void> {
  await vi.waitFor(() => expect(consoleError).toHaveBeenCalledWith(label, new Error(message)));
}

function alarm(name: string): chrome.alarms.Alarm {
  return { name, scheduledTime: 0, persistAcrossSessions: true };
}

function storageChange(): chrome.storage.StorageChange {
  return { oldValue: 1, newValue: 2 };
}

describe('background index', () => {
  it.each(['onInstalled', 'onStartup'] as const)('%s でルールとアラームを登録し、チェックする', async (event) => {
    const listener = only(h.listeners[event]);
    listener();

    await vi.waitFor(() => expect(h.runCheck).toHaveBeenCalledTimes(1));
    expect(h.registerIcloudRules).toHaveBeenCalledTimes(1);
    expect(h.createAlarm).toHaveBeenCalledWith(ALARM_NAME, { periodInMinutes: 5, delayInMinutes: 5 });
    // iCloud のルールが登録されてからチェックする。
    expect(calls.indexOf('registerIcloudRules')).toBeLessThan(calls.indexOf('runCheck'));
  });

  it('ルールの登録に失敗してもログを出してチェックは実行する', async () => {
    h.registerIcloudRules.mockRejectedValue(new Error('ルール登録失敗'));

    only(h.listeners.onInstalled)();

    await expectLogged('ルール登録失敗', 'iCloud 用ルールの登録に失敗');
    await vi.waitFor(() => expect(h.runCheck).toHaveBeenCalledTimes(1));
    expect(h.createAlarm).toHaveBeenCalledTimes(1);
  });

  it('ALARM_NAME のアラームでチェックする', async () => {
    only(h.listeners.onAlarm)(alarm(ALARM_NAME));
    await vi.waitFor(() => expect(h.runCheck).toHaveBeenCalledTimes(1));
  });

  it('別の名前のアラームではチェックしない', () => {
    only(h.listeners.onAlarm)(alarm('other'));
    expect(h.runCheck).not.toHaveBeenCalled();
  });

  it('チェックの失敗はログに出す', async () => {
    h.runCheck.mockRejectedValue(new Error('チェック失敗'));
    only(h.listeners.onAlarm)(alarm(ALARM_NAME));
    await expectLogged('チェック失敗');
  });

  it('check-now でチェックし、完了したら ok: true を返す', async () => {
    const sendResponse = vi.fn((response: CheckNowResponse) => {
      void response;
    });

    const keepOpen = only(h.listeners.onMessage)({ type: 'check-now' }, SENDER, sendResponse);

    expect(keepOpen).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
    expect(h.runCheck).toHaveBeenCalledTimes(1);
  });

  it('check-now のチェックが失敗したら ok: false と理由を返す', async () => {
    h.runCheck.mockRejectedValue(new Error('チェック失敗'));
    const sendResponse = vi.fn((response: CheckNowResponse) => {
      void response;
    });

    only(h.listeners.onMessage)({ type: 'check-now' }, SENDER, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'チェック失敗' }));
  });

  it.each([{ type: 'other' }, 'check-now', null])('check-now 以外のメッセージ %j は無視する', (message) => {
    const sendResponse = vi.fn();

    const keepOpen = only(h.listeners.onMessage)(message, SENDER, sendResponse);

    expect(keepOpen).toBe(false);
    expect(h.runCheck).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('sync の設定が変わったらアラームを登録し直してからチェックする', async () => {
    only(h.listeners.onChanged)({ intervalMinutes: storageChange() }, 'sync');

    await vi.waitFor(() => expect(h.runCheck).toHaveBeenCalledTimes(1));
    expect(calls).toEqual(['createAlarm', 'runCheck']);
    expect(h.createAlarm).toHaveBeenCalledWith(ALARM_NAME, { periodInMinutes: 5, delayInMinutes: 5 });
  });

  it('sync 以外の変更や設定以外のキーの変更は無視する', async () => {
    const listener = only(h.listeners.onChanged);
    listener({ result: storageChange() }, 'local');
    listener({ intervalMinutes: storageChange() }, 'local');
    listener({ unrelated: storageChange() }, 'sync');

    await Promise.resolve();
    expect(h.createAlarm).not.toHaveBeenCalled();
    expect(h.runCheck).not.toHaveBeenCalled();
  });

  it('通知のクリックを handleNotificationClick に渡す', () => {
    only(h.listeners.onClicked)('mail:gmail:u/0:1');
    expect(h.handleNotificationClick).toHaveBeenCalledWith('mail:gmail:u/0:1');
  });

  it('通知クリックの処理の失敗はログに出す', async () => {
    h.handleNotificationClick.mockRejectedValue(new Error('タブを開けない'));
    only(h.listeners.onClicked)('mail:gmail:u/0:1');
    await expectLogged('タブを開けない');
  });
});
