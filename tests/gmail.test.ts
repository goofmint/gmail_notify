import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverGmailAccounts, fetchFeed } from '../src/providers/gmail';
import { GMAIL_FEED_URL } from '../src/shared/constants';

type FetchInput = string | URL | Request;

/** count 件の未読を持つ、email 宛ての Gmail Atom フィード。 */
function feedXml(email: string, count: number): string {
  const entries = Array.from(
    { length: count },
    (_, i) => `
  <entry>
    <title>件名 ${i}</title>
    <summary>本文 ${i}</summary>
    <link rel="alternate" href="https://mail.google.com/mail?account_id=${email}&amp;message_id=18f00000000000${i}&amp;view=conv&amp;extsrc=atom" type="text/html"/>
    <modified>2026-10-20T01:00:0${i}Z</modified>
    <issued>2026-10-20T01:00:0${i}Z</issued>
    <id>tag:gmail.google.com,2004:${i}</id>
    <author><name>送信者 ${i}</name><email>sender${i}@example.com</email></author>
  </entry>`,
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed version="0.3" xmlns="http://purl.org/atom/ns#">
  <title>Gmail - Inbox for ${email}</title>
  <fullcount>${count}</fullcount>${entries}
</feed>`;
}

/** 最終 URL を指定した Response を作る。fetch のリダイレクト後の URL を再現する。 */
function respond(body: string, status: number, url: string): Response {
  const response = new Response(body, { status });
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

function feedResponse(n: number, email: string, count: number): Response {
  return respond(feedXml(email, count), 200, GMAIL_FEED_URL(n));
}

const signInUrl = 'https://accounts.google.com/v3/signin/identifier?continue=https://mail.google.com/mail/';

/** 要求 URL からアカウント番号 n を取り出し、handler に渡す fetch のモックを登録する。 */
function stubFetch(handler: (n: number) => Response | Promise<Response>) {
  // 型引数で fetch と同じシグネチャを与え、実装では input だけを使う（init は mock.calls に記録される）。
  const fetchMock = vi.fn<(input: FetchInput, init?: RequestInit) => Promise<Response>>((input) => {
    const match = /\/u\/(\d+)\/feed\/atom/.exec(String(input));
    if (match?.[1] === undefined) {
      throw new Error(`想定外の URL: ${String(input)}`);
    }
    return Promise.resolve(handler(Number(match[1])));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchFeed', () => {
  it('アカウント n のフィードを credentials 付き、キャッシュなし、タイムアウト付きで要求する', async () => {
    const fetchMock = stubFetch((n) => feedResponse(n, 'a@example.com', 0));
    await fetchFeed(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    if (firstCall === undefined) {
      throw new Error('fetch が呼ばれていない');
    }
    const [input, init] = firstCall;
    expect(String(input)).toMatch(/^https:\/\/mail\.google\.com\/mail\/u\/3\/feed\/atom\?zx=.+/);
    expect(init).toMatchObject({ credentials: 'include', cache: 'no-store' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('要求ごとに zx を変える', async () => {
    const fetchMock = stubFetch((n) => feedResponse(n, 'a@example.com', 0));
    await fetchFeed(0);
    await fetchFeed(0);
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls[0]).not.toBe(urls[1]);
  });

  it('2xx ならフィードを解析して返す', async () => {
    stubFetch((n) => feedResponse(n, 'a@example.com', 2));
    const result = await fetchFeed(1);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.feed.email).toBe('a@example.com');
      expect(result.feed.unreadCount).toBe(2);
      expect(result.feed.items.map((item) => item.accountKey)).toEqual(['gmail:u/1', 'gmail:u/1']);
    }
  });

  it('最終 URL が accounts.google.com なら signedOut', async () => {
    stubFetch(() => respond('<html></html>', 200, signInUrl));
    expect(await fetchFeed(0)).toEqual({ kind: 'signedOut' });
  });

  it('401 なら signedOut', async () => {
    stubFetch((n) => respond('', 401, GMAIL_FEED_URL(n)));
    expect(await fetchFeed(0)).toEqual({ kind: 'signedOut' });
  });

  it('最終 URL の /u/{m}/ が n と違えば notFound', async () => {
    stubFetch(() => feedResponse(0, 'a@example.com', 0));
    expect(await fetchFeed(1)).toEqual({ kind: 'notFound' });
  });

  it('最終 URL に /u/{m}/ が無ければ notFound とはみなさない', async () => {
    stubFetch(() => respond(feedXml('a@example.com', 0), 200, 'https://mail.google.com/mail/feed/atom'));
    expect((await fetchFeed(1)).kind).toBe('ok');
  });

  it('2xx 以外なら HTTP の状態コードで error', async () => {
    stubFetch((n) => respond('', 500, GMAIL_FEED_URL(n)));
    expect(await fetchFeed(0)).toEqual({ kind: 'error', message: 'HTTP 500' });
  });

  it('解析に失敗したらそのメッセージで error', async () => {
    stubFetch((n) => respond('<feed><title>x</feed>', 200, GMAIL_FEED_URL(n)));
    const result = await fetchFeed(0);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toContain('Gmail フィードの XML を解析できない');
    }
  });

  it('fetch が失敗したらそのメッセージで error', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await fetchFeed(0)).toEqual({ kind: 'error', message: 'Failed to fetch' });
  });
});

describe('discoverGmailAccounts', () => {
  it('n = 0 が accounts.google.com にリダイレクトされたら signedOut のアカウントを 1 件返す', async () => {
    const fetchMock = stubFetch(() => respond('<html></html>', 200, signInUrl));
    expect(await discoverGmailAccounts()).toEqual([
      {
        provider: 'gmail',
        accountKey: 'gmail:u/0',
        email: null,
        status: 'signedOut',
        unreadCount: 0,
        items: [],
        errorMessage: null,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('401 なら signedOut で打ち切る', async () => {
    const fetchMock = stubFetch((n) => respond('', 401, GMAIL_FEED_URL(n)));
    const accounts = await discoverGmailAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ accountKey: 'gmail:u/0', email: null, status: 'signedOut' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('/u/1/ が /u/0/ にリダイレクトされたら 1 件で打ち切る', async () => {
    // 存在しない u/1 も、Gmail は u/0 のフィードへリダイレクトする。
    const fetchMock = stubFetch(() => feedResponse(0, 'a@example.com', 1));
    const accounts = await discoverGmailAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      provider: 'gmail',
      accountKey: 'gmail:u/0',
      email: 'a@example.com',
      status: 'ok',
      unreadCount: 1,
      errorMessage: null,
    });
    expect(accounts[0]?.items).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('メールアドレスが重複したら打ち切る（大文字小文字は区別しない）', async () => {
    const fetchMock = stubFetch((n) => feedResponse(n, n === 0 ? 'a@example.com' : 'A@Example.com', 0));
    const accounts = await discoverGmailAccounts();
    expect(accounts.map((account) => account.email)).toEqual(['a@example.com']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('上限の 10 件で打ち切る（Issue #14 の契約値を固定して検証する）', async () => {
    const fetchMock = stubFetch((n) => feedResponse(n, `user${n}@example.com`, n % 3));
    const accounts = await discoverGmailAccounts();
    expect(accounts).toHaveLength(10);
    expect(accounts.map((account) => account.accountKey)).toEqual(
      Array.from({ length: 10 }, (_, n) => `gmail:u/${n}`),
    );
    expect(accounts.map((account) => account.unreadCount)).toEqual(
      Array.from({ length: 10 }, (_, n) => n % 3),
    );
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it('500 なら error のアカウントを加えて打ち切り、それまでの結果は残す', async () => {
    const fetchMock = stubFetch((n) => (n === 0 ? feedResponse(0, 'a@example.com', 0) : respond('', 500, GMAIL_FEED_URL(n))));
    const accounts = await discoverGmailAccounts();
    expect(accounts).toEqual([
      expect.objectContaining({ accountKey: 'gmail:u/0', email: 'a@example.com', status: 'ok' }),
      {
        provider: 'gmail',
        accountKey: 'gmail:u/1',
        email: null,
        status: 'error',
        unreadCount: 0,
        items: [],
        errorMessage: 'HTTP 500',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fetch が失敗したら error のアカウントを加えて打ち切る', async () => {
    const fetchMock = stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    const accounts = await discoverGmailAccounts();
    expect(accounts).toEqual([
      {
        provider: 'gmail',
        accountKey: 'gmail:u/0',
        email: null,
        status: 'error',
        unreadCount: 0,
        items: [],
        errorMessage: 'Failed to fetch',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('n ≥ 1 が signedOut なら、そのアカウントを signedOut として加えて打ち切る', async () => {
    const fetchMock = stubFetch((n) => (n === 0 ? feedResponse(0, 'a@example.com', 0) : respond('', 401, GMAIL_FEED_URL(n))));
    const accounts = await discoverGmailAccounts();
    expect(accounts.map((account) => [account.accountKey, account.status])).toEqual([
      ['gmail:u/0', 'ok'],
      ['gmail:u/1', 'signedOut'],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
