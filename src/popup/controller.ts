import type { CheckNowResponse } from '../shared/messages';
import type { CheckResult } from '../shared/types';
import { renderAccounts, renderHeader } from './render';

// ポップアップの動作（設計 §9）。chrome API は deps で受け取り、テストでは差し替える。

/** 更新ボタンの文言。 */
export const CONTROLLER_TEXT = {
  refresh: '今すぐ更新',
  refreshing: '更新中…',
} as const;

export type PopupElements = {
  total: HTMLElement;
  checkedAt: HTMLElement;
  refresh: HTMLButtonElement;
  accounts: HTMLElement;
  message: HTMLElement;
};

export type PopupDeps = {
  loadResult: () => Promise<CheckResult | null>;
  sendCheckNow: () => Promise<CheckNowResponse>;
  openUrl: (url: string) => Promise<void>;
  close: () => void;
  /** 保存済みの result が変わったときに cb を呼ぶよう登録する。 */
  onResultChanged: (cb: () => void) => void;
  elements: PopupElements;
};

/** 通知欄に出すメッセージの発生元。発生元ごとに保持し、別の処理の成功で他のエラーが消えないようにする。 */
type MessageSource = 'load' | 'check' | 'open';

/** ポップアップを起動する。保存済みの結果を描画し、変更を購読してから check-now を送る。 */
export async function startPopup(deps: PopupDeps): Promise<void> {
  const { elements } = deps;
  // 読み込みが重なったとき、最後に始めた読み込みの結果だけを描画する。
  let renderSeq = 0;
  let checking = false;

  const messages: Record<MessageSource, string | null> = { load: null, check: null, open: null };

  function setMessage(source: MessageSource, text: string | null): void {
    messages[source] = text;
    const lines = Object.values(messages).filter((line) => line !== null);
    elements.message.textContent = lines.join('\n');
    elements.message.hidden = lines.length === 0;
  }

  function openUrl(url: string): void {
    deps
      .openUrl(url)
      .then(() => {
        deps.close();
      })
      .catch((error) => {
        setMessage('open', error instanceof Error ? error.message : String(error));
      });
  }

  async function render(): Promise<void> {
    const seq = ++renderSeq;
    try {
      const result = await deps.loadResult();
      if (seq !== renderSeq) {
        return;
      }
      setMessage('load', null);
      renderHeader({ total: elements.total, checkedAt: elements.checkedAt }, result);
      renderAccounts(elements.accounts, result, openUrl);
    } catch (error) {
      if (seq === renderSeq) {
        setMessage('load', error instanceof Error ? error.message : String(error));
      }
    }
  }

  async function checkNow(): Promise<void> {
    if (checking) {
      return;
    }
    checking = true;
    elements.refresh.disabled = true;
    elements.refresh.textContent = CONTROLLER_TEXT.refreshing;
    setMessage('check', null);
    try {
      const response = await deps.sendCheckNow();
      if (!response.ok) {
        setMessage('check', response.error);
      }
    } catch (error) {
      setMessage('check', error instanceof Error ? error.message : String(error));
    } finally {
      checking = false;
      elements.refresh.disabled = false;
      elements.refresh.textContent = CONTROLLER_TEXT.refresh;
    }
  }

  await render();
  deps.onResultChanged(() => {
    void render();
  });
  elements.refresh.addEventListener('click', () => {
    void checkNow();
  });
  await checkNow();
}
