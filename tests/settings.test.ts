import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/constants';
import { loadSettings, saveSettings } from '../src/shared/settings';
import type { Settings } from '../src/shared/types';

type StoredItems = Record<string, string | number | boolean>;

const getMock = vi.fn<(keys: Settings) => Promise<StoredItems>>();
const setMock = vi.fn<(items: Settings) => Promise<void>>();

// chrome.storage.sync.get(defaults) の挙動を再現する。保存済みの値が既定値を上書きする。
function storedAs(stored: StoredItems): void {
  getMock.mockImplementation((keys) => Promise.resolve({ ...keys, ...stored }));
}

beforeEach(() => {
  vi.stubGlobal('chrome', { storage: { sync: { get: getMock, set: setMock } } });
  getMock.mockReset();
  setMock.mockReset();
});

describe('loadSettings', () => {
  it('未保存なら既定値を返し、get に DEFAULT_SETTINGS を渡す', async () => {
    storedAs({});
    await expect(loadSettings()).resolves.toEqual(DEFAULT_SETTINGS);
    expect(getMock).toHaveBeenCalledWith(DEFAULT_SETTINGS);
  });

  it('保存済みの値を返す', async () => {
    storedAs({ intervalMinutes: 5, notificationsEnabled: false, icloudEnabled: false });
    await expect(loadSettings()).resolves.toEqual({
      intervalMinutes: 5,
      notificationsEnabled: false,
      gmailEnabled: true,
      icloudEnabled: false,
      ignoreUnreachableAccounts: false,
    });
  });

  it('取得できないアカウントを無視する設定を読む', async () => {
    storedAs({ ignoreUnreachableAccounts: true });
    await expect(loadSettings()).resolves.toEqual({ ...DEFAULT_SETTINGS, ignoreUnreachableAccounts: true });
  });

  it('型が不正ならフィールド名を含むエラーにする', async () => {
    storedAs({ intervalMinutes: '1' });
    await expect(loadSettings()).rejects.toThrow(/設定の検証に失敗[\s\S]*intervalMinutes/);
  });

  it('間隔が 0.5 未満ならエラーにする', async () => {
    storedAs({ intervalMinutes: 0.4 });
    await expect(loadSettings()).rejects.toThrow(/intervalMinutes/);
  });

  it('取得できないアカウントを無視する設定が boolean でなければエラーにする', async () => {
    storedAs({ ignoreUnreachableAccounts: 'true' });
    await expect(loadSettings()).rejects.toThrow(/設定の検証に失敗[\s\S]*ignoreUnreachableAccounts/);
  });

  it('get の reject はそのまま伝わる', async () => {
    getMock.mockRejectedValue(new Error('sync 読み込み失敗'));
    await expect(loadSettings()).rejects.toThrow('sync 読み込み失敗');
  });
});

describe('saveSettings', () => {
  const settings: Settings = {
    intervalMinutes: 0.5,
    notificationsEnabled: false,
    gmailEnabled: true,
    icloudEnabled: false,
    ignoreUnreachableAccounts: true,
  };

  it('全項目をトップレベルキーで set する', async () => {
    setMock.mockResolvedValue(undefined);
    await saveSettings(settings);
    expect(setMock).toHaveBeenCalledWith(settings);
  });

  it('不正な値は set を呼ばずにエラーにする', async () => {
    await expect(saveSettings({ ...settings, intervalMinutes: 0.1 })).rejects.toThrow(
      /保存する設定が不正[\s\S]*intervalMinutes/,
    );
    await expect(saveSettings({ ...settings, intervalMinutes: Number.POSITIVE_INFINITY })).rejects.toThrow(
      /intervalMinutes/,
    );
    expect(setMock).not.toHaveBeenCalled();
  });

  it('set の reject はそのまま伝わる', async () => {
    setMock.mockRejectedValue(new Error('QUOTA_BYTES 超過'));
    await expect(saveSettings(settings)).rejects.toThrow('QUOTA_BYTES 超過');
  });
});
