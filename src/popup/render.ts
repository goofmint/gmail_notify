import { GMAIL_LOGIN_URL, ICLOUD_MAIL_URL } from '../shared/constants';
import type { AccountState, CheckResult, MailItem, Provider } from '../shared/types';

// ポップアップの描画。chrome API は使わず、タブを開く処理は onOpenUrl で呼び出し元に任せる。
// メール内容による XSS を防ぐため、文字列はすべて textContent で設定する（設計 §9）。

/** 画面に表示する文言。 */
export const POPUP_TEXT = {
  noTotal: '—',
  notChecked: '未取得',
  noResult: 'まだ確認していません',
  noUnread: '未読なし',
  signedOut: 'ログインしてください',
  login: 'ログインページを開く',
  unknownError: 'エラーが発生しました',
} as const;

const PROVIDER_LABELS: Record<Provider, string> = { gmail: 'G', icloud: 'iCloud' };
const LOGIN_URLS: Record<Provider, string> = { gmail: GMAIL_LOGIN_URL, icloud: ICLOUD_MAIL_URL };

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** ISO8601 の日時をブラウザのロケールで表示する。解釈できない場合は元の文字列を表示する。 */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return dateFormat.format(date);
}

function textElement<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className: string | null,
  text: string,
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  if (className !== null) {
    element.className = className;
  }
  element.textContent = text;
  return element;
}

/** ヘッダーの合計未読数と最終チェック時刻を描画する。result が null なら未取得と表示する。 */
export function renderHeader(root: { total: HTMLElement; checkedAt: HTMLElement }, result: CheckResult | null): void {
  if (result === null) {
    root.total.textContent = POPUP_TEXT.noTotal;
    root.checkedAt.textContent = POPUP_TEXT.notChecked;
    return;
  }
  const total = result.accounts.reduce((sum, account) => sum + account.unreadCount, 0);
  root.total.textContent = String(total);
  root.checkedAt.textContent = formatDate(result.checkedAt);
}

function renderHeading(doc: Document, account: AccountState): HTMLHeadingElement {
  const heading = doc.createElement('h2');
  heading.append(textElement(doc, 'span', 'badge', PROVIDER_LABELS[account.provider]));
  if (account.email !== null) {
    heading.append(textElement(doc, 'span', 'email', account.email));
  }
  heading.append(textElement(doc, 'span', 'count', String(account.unreadCount)));
  return heading;
}

function renderMail(doc: Document, item: MailItem, onOpenUrl: (url: string) => void): HTMLLIElement {
  const row = doc.createElement('li');
  row.className = 'mail';
  row.setAttribute('role', 'button');
  row.tabIndex = 0;

  const top = doc.createElement('div');
  top.className = 'row';
  top.append(textElement(doc, 'span', 'from', item.from), textElement(doc, 'span', 'date', formatDate(item.date)));
  row.append(top, textElement(doc, 'div', 'subject', item.subject), textElement(doc, 'div', 'snippet', item.snippet));

  row.addEventListener('click', () => {
    onOpenUrl(item.openUrl);
  });
  // role="button" なので、WAI-ARIA の button パターンに合わせて Enter と Space で開く。Space はページのスクロールを止める。
  // キーを押し続けると keydown が繰り返されるため、繰り返し分では開かない（タブが複数開くのを防ぐ）。
  row.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (event.repeat) {
        return;
      }
      onOpenUrl(item.openUrl);
    }
  });
  return row;
}

function renderBody(doc: Document, account: AccountState, onOpenUrl: (url: string) => void): HTMLElement[] {
  switch (account.status) {
    case 'ok': {
      if (account.unreadCount === 0) {
        return [textElement(doc, 'p', 'muted', POPUP_TEXT.noUnread)];
      }
      if (account.items.length === 0) {
        // 件数だけ分かり一覧を取得できない場合は、見出しの件数だけを表示する。
        return [];
      }
      const list = doc.createElement('ul');
      list.append(...account.items.map((item) => renderMail(doc, item, onOpenUrl)));
      return [list];
    }
    case 'signedOut': {
      const loginUrl = LOGIN_URLS[account.provider];
      const link = textElement(doc, 'a', 'login', POPUP_TEXT.login);
      link.href = loginUrl;
      link.addEventListener('click', (event) => {
        event.preventDefault();
        onOpenUrl(loginUrl);
      });
      const paragraph = textElement(doc, 'p', null, POPUP_TEXT.signedOut);
      return [paragraph, link];
    }
    case 'error': {
      const message = account.errorMessage === null ? POPUP_TEXT.unknownError : account.errorMessage;
      return [textElement(doc, 'p', 'error', message)];
    }
  }
}

/** アカウントごとのセクションを描画する。container の中身は置き換える。 */
export function renderAccounts(
  container: HTMLElement,
  result: CheckResult | null,
  onOpenUrl: (url: string) => void,
): void {
  const doc = container.ownerDocument;
  container.replaceChildren();
  if (result === null) {
    container.append(textElement(doc, 'p', null, POPUP_TEXT.noResult));
    return;
  }
  for (const account of result.accounts) {
    const section = doc.createElement('section');
    section.className = `account status-${account.status}`;
    section.append(renderHeading(doc, account), ...renderBody(doc, account, onOpenUrl));
    container.append(section);
  }
}
