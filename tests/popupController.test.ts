// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { startPopup, type PopupDeps, type PopupElements } from '../src/popup/controller';
import type { CheckNowResponse } from '../src/shared/messages';
import type { CheckResult } from '../src/shared/types';

const OPEN_URL = 'https://mail.google.com/mail/u/0/#inbox/18c0ffee';

function resultWith(unreadCount: number): CheckResult {
  return {
    checkedAt: '2026-10-20T12:34:00.000Z',
    accounts: [
      {
        provider: 'gmail',
        accountKey: 'gmail:u/0',
        email: 'taro@example.com',
        status: 'ok',
        unreadCount,
        items: Array.from({ length: unreadCount }, (_, i) => ({
          id: `id${i}`,
          provider: 'gmail' as const,
          accountKey: 'gmail:u/0',
          from: '山田太郎',
          subject: `件名${i}`,
          snippet: '本文',
          date: '2026-10-20T10:00:00.000Z',
          openUrl: OPEN_URL,
        })),
        errorMessage: null,
      },
    ],
  };
}

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

function createElements(): PopupElements {
  const total = document.createElement('span');
  const checkedAt = document.createElement('span');
  const refresh = document.createElement('button');
  refresh.textContent = '今すぐ更新';
  const message = document.createElement('p');
  message.hidden = true;
  const accounts = document.createElement('main');
  document.body.replaceChildren(total, checkedAt, refresh, message, accounts);
  return { total, checkedAt, refresh, accounts, message };
}

const loadResult = vi.fn<() => Promise<CheckResult | null>>();
const sendCheckNow = vi.fn<() => Promise<CheckNowResponse>>();
const openUrl = vi.fn<(url: string) => Promise<void>>();
const close = vi.fn<() => void>();
const onResultChanged = vi.fn<(cb: () => void) => void>();

let elements: PopupElements;

function deps(): PopupDeps {
  return { loadResult, sendCheckNow, openUrl, close, onResultChanged, elements };
}

/** onResultChanged に登録されたコールバック。 */
function changedCallback(): () => void {
  const cb = onResultChanged.mock.calls[0]?.[0];
  if (cb === undefined) {
    throw new Error('onResultChanged が呼ばれていない');
  }
  return cb;
}

/** 保留中の Promise を処理させる。 */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  elements = createElements();
  loadResult.mockResolvedValue(null);
  sendCheckNow.mockResolvedValue({ ok: true });
  openUrl.mockResolvedValue(undefined);
});

describe('startPopup', () => {
  it('保存済みの結果を描画してから購読し、check-now を送る', async () => {
    const order: string[] = [];
    loadResult.mockImplementation(() => {
      order.push('load');
      return Promise.resolve(resultWith(2));
    });
    onResultChanged.mockImplementation(() => {
      order.push('subscribe');
    });
    sendCheckNow.mockImplementation(() => {
      order.push('check-now');
      return Promise.resolve({ ok: true });
    });
    await startPopup(deps());
    expect(order).toEqual(['load', 'subscribe', 'check-now']);
    expect(elements.total.textContent).toBe('2');
    expect(elements.accounts.querySelectorAll('li.mail')).toHaveLength(2);
    expect(elements.message.hidden).toBe(true);
  });

  it('未保存なら未取得の状態を描画する', async () => {
    await startPopup(deps());
    expect(elements.total.textContent).toBe('—');
    expect(elements.checkedAt.textContent).toBe('未取得');
    expect(elements.accounts.textContent).toBe('まだ確認していません');
  });

  it('結果が変わったら読み直して描画し直す', async () => {
    await startPopup(deps());
    loadResult.mockResolvedValue(resultWith(3));
    changedCallback()();
    await flush();
    expect(loadResult).toHaveBeenCalledTimes(2);
    expect(elements.total.textContent).toBe('3');
  });

  it('読み込みが重なったら最後の読み込みの結果だけを描画する', async () => {
    await startPopup(deps());
    const first = deferred<CheckResult | null>();
    const second = deferred<CheckResult | null>();
    loadResult.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    changedCallback()();
    changedCallback()();
    second.resolve(resultWith(5));
    await flush();
    first.resolve(resultWith(1));
    await flush();
    expect(elements.total.textContent).toBe('5');
  });

  it('読み込みに失敗したらエラーを表示し、check-now は送る', async () => {
    loadResult.mockRejectedValue(new Error('保存済みの result の形式が不正'));
    await startPopup(deps());
    expect(elements.message.hidden).toBe(false);
    expect(elements.message.textContent).toBe('保存済みの result の形式が不正');
    expect(sendCheckNow).toHaveBeenCalledTimes(1);
  });

  it('チェック中は更新ボタンを無効にし、終わったら戻す', async () => {
    const pending = deferred<CheckNowResponse>();
    sendCheckNow.mockReturnValue(pending.promise);
    const started = startPopup(deps());
    await flush();
    expect(elements.refresh.disabled).toBe(true);
    expect(elements.refresh.textContent).toBe('更新中…');
    pending.resolve({ ok: true });
    await started;
    expect(elements.refresh.disabled).toBe(false);
    expect(elements.refresh.textContent).toBe('今すぐ更新');
  });

  it('更新ボタンで check-now を送り、チェック中は重ねて送らない', async () => {
    await startPopup(deps());
    const pending = deferred<CheckNowResponse>();
    sendCheckNow.mockReturnValue(pending.promise);
    elements.refresh.click();
    // disabled のボタンは click を発火しないため、多重送信の防止は内部の状態でも確かめる。
    elements.refresh.disabled = false;
    elements.refresh.click();
    expect(sendCheckNow).toHaveBeenCalledTimes(2);
    pending.resolve({ ok: true });
    await flush();
    expect(elements.refresh.disabled).toBe(false);
  });

  it('check-now の応答が失敗ならエラーを表示する', async () => {
    sendCheckNow.mockResolvedValue({ ok: false, error: '<b>失敗</b>' });
    await startPopup(deps());
    expect(elements.message.hidden).toBe(false);
    expect(elements.message.textContent).toBe('<b>失敗</b>');
    expect(elements.message.querySelector('b')).toBeNull();
  });

  it('sendMessage が reject したらその理由を表示する', async () => {
    sendCheckNow.mockRejectedValue(new Error('Receiving end does not exist.'));
    await startPopup(deps());
    expect(elements.message.textContent).toBe('Receiving end does not exist.');
    expect(elements.refresh.disabled).toBe(false);
  });

  it('次のチェックが成功したら前回のチェックのエラーを消す', async () => {
    sendCheckNow.mockResolvedValueOnce({ ok: false, error: '失敗' });
    await startPopup(deps());
    elements.refresh.click();
    await flush();
    expect(elements.message.hidden).toBe(true);
    expect(elements.message.textContent).toBe('');
  });

  it('行をクリックしたら URL を開いてからポップアップを閉じる', async () => {
    loadResult.mockResolvedValue(resultWith(1));
    const order: string[] = [];
    openUrl.mockImplementation((url) => {
      order.push(`open:${url}`);
      return Promise.resolve();
    });
    close.mockImplementation(() => {
      order.push('close');
    });
    await startPopup(deps());
    elements.accounts.querySelector<HTMLElement>('li.mail')?.click();
    await flush();
    expect(order).toEqual([`open:${OPEN_URL}`, 'close']);
  });

  it('URL を開けなかったら閉じずにエラーを表示する', async () => {
    loadResult.mockResolvedValue(resultWith(1));
    openUrl.mockRejectedValue(new Error('タブを開けない'));
    await startPopup(deps());
    elements.accounts.querySelector<HTMLElement>('li.mail')?.click();
    await flush();
    expect(close).not.toHaveBeenCalled();
    expect(elements.message.textContent).toBe('タブを開けない');
  });
});
