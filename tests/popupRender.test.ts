// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderAccounts, renderHeader } from '../src/popup/render';
import { GMAIL_LOGIN_URL, ICLOUD_MAIL_URL } from '../src/shared/constants';
import type { AccountState, CheckResult, MailItem } from '../src/shared/types';

const CHECKED_AT = '2026-10-20T12:34:00.000Z';
const format = (iso: string): string =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

function mail(overrides: Partial<MailItem> = {}): MailItem {
  return {
    id: '18c0ffee',
    provider: 'gmail',
    accountKey: 'gmail:u/0',
    from: '山田太郎',
    subject: '会議の件',
    snippet: '明日の会議について',
    date: '2026-10-20T10:00:00.000Z',
    openUrl: 'https://mail.google.com/mail/u/0/#inbox/18c0ffee',
    ...overrides,
  };
}

function account(overrides: Partial<AccountState> = {}): AccountState {
  return {
    provider: 'gmail',
    accountKey: 'gmail:u/0',
    email: 'taro@example.com',
    status: 'ok',
    unreadCount: 0,
    items: [],
    errorMessage: null,
    ...overrides,
  };
}

function result(accounts: AccountState[]): CheckResult {
  return { checkedAt: CHECKED_AT, accounts };
}

let container: HTMLElement;
const onOpenUrl = vi.fn<(url: string) => void>();

beforeEach(() => {
  document.body.replaceChildren();
  container = document.createElement('main');
  document.body.append(container);
});

function sections(): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('section.account'));
}

function firstSection(): HTMLElement {
  const section = sections()[0];
  if (section === undefined) {
    throw new Error('section がない');
  }
  return section;
}

describe('renderHeader', () => {
  const total = (): HTMLElement => document.createElement('span');

  it('result が null なら未取得と表示する', () => {
    const root = { total: total(), checkedAt: total() };
    renderHeader(root, null);
    expect(root.total.textContent).toBe('—');
    expect(root.checkedAt.textContent).toBe('未取得');
  });

  it('全アカウントの未読数を合計し、時刻を整形して表示する', () => {
    const root = { total: total(), checkedAt: total() };
    renderHeader(
      root,
      result([account({ unreadCount: 3 }), account({ provider: 'icloud', accountKey: 'icloud', unreadCount: 4 })]),
    );
    expect(root.total.textContent).toBe('7');
    expect(root.checkedAt.textContent).toBe(format(CHECKED_AT));
  });

  it('時刻を解釈できなければ元の文字列を表示する', () => {
    const root = { total: total(), checkedAt: total() };
    renderHeader(root, { checkedAt: 'not-a-date', accounts: [] });
    expect(root.total.textContent).toBe('0');
    expect(root.checkedAt.textContent).toBe('not-a-date');
  });
});

describe('renderAccounts', () => {
  it('result が null ならまだ確認していないと表示する', () => {
    renderAccounts(container, null, onOpenUrl);
    expect(container.children).toHaveLength(1);
    expect(container.querySelector('p')?.textContent).toBe('まだ確認していません');
  });

  it('前回の描画内容を置き換える', () => {
    renderAccounts(container, null, onOpenUrl);
    renderAccounts(container, result([account()]), onOpenUrl);
    expect(container.querySelectorAll('p')).toHaveLength(1);
    expect(sections()).toHaveLength(1);
    renderAccounts(container, result([]), onOpenUrl);
    expect(container.children).toHaveLength(0);
  });

  it('見出しにアイコン、メールアドレス、未読数を表示する', () => {
    renderAccounts(container, result([account({ unreadCount: 0 })]), onOpenUrl);
    const heading = firstSection().querySelector('h2');
    expect(heading?.querySelector('.badge')?.textContent).toBe('G');
    expect(heading?.querySelector('.email')?.textContent).toBe('taro@example.com');
    expect(heading?.querySelector('.count')?.textContent).toBe('0');
  });

  it('iCloud のアイコンは iCloud と表示する', () => {
    renderAccounts(container, result([account({ provider: 'icloud', accountKey: 'icloud' })]), onOpenUrl);
    expect(firstSection().querySelector('h2 .badge')?.textContent).toBe('iCloud');
  });

  it('メールアドレスが null なら要素を出さない', () => {
    renderAccounts(container, result([account({ status: 'signedOut', email: null })]), onOpenUrl);
    expect(firstSection().querySelector('h2 .email')).toBeNull();
  });

  it('ok で未読 0 件なら未読なしと表示する', () => {
    renderAccounts(container, result([account()]), onOpenUrl);
    const section = firstSection();
    expect(section.className).toBe('account status-ok');
    expect(section.querySelector('p.muted')?.textContent).toBe('未読なし');
    expect(section.querySelector('ul')).toBeNull();
  });

  it('ok で未読があれば一覧を表示する', () => {
    const item = mail();
    renderAccounts(container, result([account({ unreadCount: 1, items: [item] })]), onOpenUrl);
    const row = firstSection().querySelector<HTMLElement>('ul > li.mail');
    expect(row?.getAttribute('role')).toBe('button');
    expect(row?.tabIndex).toBe(0);
    expect(row?.querySelector('.from')?.textContent).toBe('山田太郎');
    expect(row?.querySelector('.subject')?.textContent).toBe('会議の件');
    expect(row?.querySelector('.snippet')?.textContent).toBe('明日の会議について');
    expect(row?.querySelector('.date')?.textContent).toBe(format(item.date));
  });

  it('メールの日時を解釈できなければ元の文字列を表示する', () => {
    renderAccounts(container, result([account({ unreadCount: 1, items: [mail({ date: '不明' })] })]), onOpenUrl);
    expect(firstSection().querySelector('li .date')?.textContent).toBe('不明');
  });

  it('ok で未読数があっても一覧が空なら見出しの件数だけを表示する', () => {
    renderAccounts(container, result([account({ unreadCount: 5, items: [] })]), onOpenUrl);
    const section = firstSection();
    expect(section.children).toHaveLength(1);
    expect(section.querySelector('h2 .count')?.textContent).toBe('5');
  });

  it('行のクリックと Enter キーで openUrl を渡す', () => {
    const item = mail();
    renderAccounts(container, result([account({ unreadCount: 1, items: [item] })]), onOpenUrl);
    const row = firstSection().querySelector<HTMLElement>('li.mail');
    row?.click();
    row?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    row?.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(onOpenUrl.mock.calls).toEqual([[item.openUrl], [item.openUrl]]);
  });

  it('行で Space キーを押したら openUrl を渡し、スクロールを止める', () => {
    const item = mail();
    renderAccounts(container, result([account({ unreadCount: 1, items: [item] })]), onOpenUrl);
    const row = firstSection().querySelector<HTMLElement>('li.mail');
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    row?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(onOpenUrl).toHaveBeenCalledExactlyOnceWith(item.openUrl);
  });

  it('メールとアカウントの順序を保つ', () => {
    const items = [mail({ id: 'a', subject: '1' }), mail({ id: 'b', subject: '2' }), mail({ id: 'c', subject: '3' })];
    renderAccounts(
      container,
      result([
        account({ provider: 'icloud', accountKey: 'icloud', email: 'b@icloud.com' }),
        account({ email: 'a@example.com', unreadCount: 3, items }),
      ]),
      onOpenUrl,
    );
    expect(sections().map((section) => section.querySelector('.email')?.textContent)).toEqual([
      'b@icloud.com',
      'a@example.com',
    ]);
    expect(Array.from(container.querySelectorAll('li .subject')).map((el) => el.textContent)).toEqual(['1', '2', '3']);
  });

  it.each([
    ['gmail', GMAIL_LOGIN_URL],
    ['icloud', ICLOUD_MAIL_URL],
  ] as const)('signedOut（%s）ならログインを促し、リンクのクリックで URL を渡す', (provider, url) => {
    renderAccounts(
      container,
      result([account({ provider, accountKey: provider, status: 'signedOut', email: null })]),
      onOpenUrl,
    );
    const section = firstSection();
    expect(section.className).toBe('account status-signedOut');
    expect(section.querySelector('p')?.textContent).toBe('ログインしてください');
    const link = section.querySelector('a');
    expect(link?.getAttribute('href')).toBe(url);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(onOpenUrl).toHaveBeenCalledWith(url);
  });

  it('error なら errorMessage を表示する', () => {
    renderAccounts(container, result([account({ status: 'error', errorMessage: 'HTTP 500' })]), onOpenUrl);
    const section = firstSection();
    expect(section.className).toBe('account status-error');
    expect(section.querySelector('p.error')?.textContent).toBe('HTTP 500');
  });

  it('error で errorMessage が null なら既定の文言を表示する', () => {
    renderAccounts(container, result([account({ status: 'error' })]), onOpenUrl);
    expect(firstSection().querySelector('p.error')?.textContent).toBe('エラーが発生しました');
  });

  it('HTML を含む文字列をテキストとして表示する', () => {
    const xss = '<img src=x onerror=alert(1)>';
    renderAccounts(
      container,
      result([
        account({
          email: xss,
          unreadCount: 1,
          items: [mail({ from: xss, subject: xss, snippet: xss, date: xss })],
        }),
        account({ status: 'error', errorMessage: xss }),
      ]),
      onOpenUrl,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(firstSection().querySelector('.email')?.textContent).toBe(xss);
    expect(firstSection().querySelector('.subject')?.textContent).toBe(xss);
    expect(container.querySelector('p.error')?.textContent).toBe(xss);
  });
});
