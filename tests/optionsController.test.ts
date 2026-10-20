// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { intervalLabel, startOptions, type OptionsElements } from '../src/options/controller';
import { INTERVAL_OPTIONS_MINUTES } from '../src/shared/constants';
import type { Settings } from '../src/shared/types';

const STORED: Settings = {
  intervalMinutes: 5,
  notificationsEnabled: false,
  gmailEnabled: true,
  icloudEnabled: false,
};

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void };

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function checkbox(id: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = id;
  return input;
}

function createElements(): OptionsElements {
  const form = document.createElement('form');
  const intervalMinutes = document.createElement('select');
  const notificationsEnabled = checkbox('notificationsEnabled');
  const gmailEnabled = checkbox('gmailEnabled');
  const icloudEnabled = checkbox('icloudEnabled');
  form.append(intervalMinutes, notificationsEnabled, gmailEnabled, icloudEnabled);
  const status = document.createElement('p');
  document.body.replaceChildren(form, status);
  return { form, intervalMinutes, notificationsEnabled, gmailEnabled, icloudEnabled, status };
}

const loadSettings = vi.fn<() => Promise<Settings>>();
const saveSettings = vi.fn<(settings: Settings) => Promise<void>>();
let elements: OptionsElements;

function start(): Promise<void> {
  return startOptions({ loadSettings, saveSettings, elements });
}

function change(element: HTMLElement): void {
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function controls(): (HTMLSelectElement | HTMLInputElement)[] {
  return [elements.intervalMinutes, elements.notificationsEnabled, elements.gmailEnabled, elements.icloudEnabled];
}

beforeEach(() => {
  elements = createElements();
  // mockClear では mock*Once の残りが消えないため、テストごとに実装ごと戻す。
  loadSettings.mockReset().mockResolvedValue(STORED);
  saveSettings.mockReset().mockResolvedValue(undefined);
});

describe('intervalLabel', () => {
  it('1 分未満は秒、それ以外は分で表す', () => {
    expect(intervalLabel(0.5)).toBe('30 秒');
    expect(intervalLabel(1)).toBe('1 分');
    expect(intervalLabel(15)).toBe('15 分');
  });
});

describe('startOptions', () => {
  it('チェック間隔の選択肢を INTERVAL_OPTIONS_MINUTES から作る', async () => {
    await start();
    const options = Array.from(elements.intervalMinutes.options);
    expect(options.map((option) => option.value)).toEqual(INTERVAL_OPTIONS_MINUTES.map(String));
    expect(options.map((option) => option.textContent)).toEqual([
      '30 秒',
      '1 分',
      '2 分',
      '5 分',
      '10 分',
      '15 分',
      '30 分',
    ]);
  });

  it('読み込みが終わるまで入力を無効にする', async () => {
    const pending = deferred<Settings>();
    loadSettings.mockReturnValue(pending.promise);
    const started = start();
    expect(controls().every((control) => control.disabled)).toBe(true);
    pending.resolve(STORED);
    await started;
    expect(controls().every((control) => !control.disabled)).toBe(true);
  });

  it('読み込んだ設定をフォームに反映する', async () => {
    await start();
    expect(elements.intervalMinutes.value).toBe('5');
    expect(elements.notificationsEnabled.checked).toBe(false);
    expect(elements.gmailEnabled.checked).toBe(true);
    expect(elements.icloudEnabled.checked).toBe(false);
    expect(elements.status.textContent).toBe('');
  });

  it('読み込みに失敗したらエラーを表示し、入力は無効のままにする', async () => {
    loadSettings.mockRejectedValue(new Error('設定の検証に失敗'));
    await start();
    expect(elements.status.textContent).toBe('設定を読み込めませんでした: 設定の検証に失敗');
    expect(elements.status.classList.contains('error')).toBe(true);
    expect(controls().every((control) => control.disabled)).toBe(true);
  });

  it('変更したらフォーム全体を保存し、保存しましたと表示する', async () => {
    await start();
    elements.icloudEnabled.checked = true;
    change(elements.icloudEnabled);
    await flush();
    expect(saveSettings).toHaveBeenCalledWith({ ...STORED, icloudEnabled: true });
    expect(elements.status.textContent).toBe('保存しました');
    expect(elements.status.classList.contains('error')).toBe(false);

    elements.intervalMinutes.value = '0.5';
    change(elements.intervalMinutes);
    await flush();
    expect(saveSettings).toHaveBeenLastCalledWith({ ...STORED, icloudEnabled: true, intervalMinutes: 0.5 });
  });

  it('保存に失敗したらエラーを表示し、入力値はそのまま残す', async () => {
    saveSettings.mockRejectedValue(new Error('QUOTA_BYTES_PER_ITEM quota exceeded'));
    await start();
    elements.gmailEnabled.checked = false;
    change(elements.gmailEnabled);
    await flush();
    expect(elements.status.textContent).toBe('保存できませんでした: QUOTA_BYTES_PER_ITEM quota exceeded');
    expect(elements.status.classList.contains('error')).toBe(true);
    expect(elements.gmailEnabled.checked).toBe(false);
  });

  it('保存が重なったら最後の保存の結果だけを表示する', async () => {
    await start();
    const first = deferred<void>();
    const second = deferred<void>();
    saveSettings.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    change(elements.gmailEnabled);
    change(elements.icloudEnabled);
    // 古い保存の成功は表示しない。
    first.resolve();
    await flush();
    expect(elements.status.textContent).toBe('保存中…');
    second.reject(new Error('新しい保存の失敗'));
    await flush();
    expect(elements.status.textContent).toBe('保存できませんでした: 新しい保存の失敗');
    expect(elements.status.classList.contains('error')).toBe(true);
  });

  it('保存を順に行い、古い保存が遅れて終わっても新しい設定が残る', async () => {
    await start();
    let stored: Settings | null = null;
    const first = deferred<void>();
    saveSettings
      .mockImplementationOnce(async (settings) => {
        await first.promise;
        stored = settings;
      })
      .mockImplementationOnce((settings) => {
        stored = settings;
        return Promise.resolve();
      });
    elements.gmailEnabled.checked = false;
    change(elements.gmailEnabled);
    elements.icloudEnabled.checked = true;
    change(elements.icloudEnabled);
    await flush();
    // 1 件目が終わるまで 2 件目は始まらない。
    expect(saveSettings).toHaveBeenCalledTimes(1);
    first.resolve();
    await flush();
    expect(saveSettings).toHaveBeenCalledTimes(2);
    expect(stored).toEqual({ ...STORED, gmailEnabled: false, icloudEnabled: true });
    expect(elements.status.textContent).toBe('保存しました');
  });

  it('前の保存が失敗しても次の保存を行い、最新の結果を表示する', async () => {
    await start();
    const first = deferred<void>();
    saveSettings.mockReturnValueOnce(first.promise).mockResolvedValueOnce(undefined);
    change(elements.gmailEnabled);
    change(elements.icloudEnabled);
    first.reject(new Error('古い保存の失敗'));
    await flush();
    expect(saveSettings).toHaveBeenCalledTimes(2);
    expect(elements.status.textContent).toBe('保存しました');
    expect(elements.status.classList.contains('error')).toBe(false);
  });

  it('保存済みの間隔が選択肢になければ、値を変えずにエラーを表示する', async () => {
    loadSettings.mockResolvedValue({ ...STORED, intervalMinutes: 3 });
    await start();
    expect(elements.intervalMinutes.selectedIndex).toBe(-1);
    expect(elements.status.textContent).toContain('3 分');
    expect(elements.status.classList.contains('error')).toBe(true);
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('間隔が未選択のまま他の項目を変えたら保存せずにエラーを表示する', async () => {
    loadSettings.mockResolvedValue({ ...STORED, intervalMinutes: 3 });
    await start();
    change(elements.gmailEnabled);
    await flush();
    expect(saveSettings).not.toHaveBeenCalled();
    expect(elements.status.textContent).toBe('チェック間隔を選んでください');

    elements.intervalMinutes.value = '2';
    change(elements.intervalMinutes);
    await flush();
    expect(saveSettings).toHaveBeenCalledWith({ ...STORED, intervalMinutes: 2 });
    expect(elements.status.textContent).toBe('保存しました');
  });
});
