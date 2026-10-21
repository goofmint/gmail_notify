import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchIcloudState, judgeStatus, stripPort443, toMailItems } from '../src/providers/icloud';
import { ICLOUD_MAIL_URL, ICLOUD_MAX_RESULTS, ICLOUD_ORIGIN, ICLOUD_VALIDATE_URL } from '../src/shared/constants';
import type { AccountState } from '../src/shared/types';
import geqsFixture from './fixtures/icloud/geqs.json' with { type: 'json' };
import threadSearchFixture from './fixtures/icloud/thread-search.json' with { type: 'json' };
import validateFixture from './fixtures/icloud/validate.json' with { type: 'json' };

type FetchInput = string | URL | Request;
type Endpoint = 'validate' | 'geqs' | 'search';
type Handler = () => Response | Promise<Response>;

const GATEWAY = 'https://p123-mccgateway.icloud.com';
const DSID = validateFixture.dsInfo.dsid;
const EMAIL = validateFixture.dsInfo.primaryEmail;

function json(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const defaultHandlers: Record<Endpoint, Handler> = {
  validate: () => json(validateFixture),
  geqs: () => json(geqsFixture),
  search: () => json(threadSearchFixture),
};

/** 要求 URL から endpoint を決める。想定外の URL は例外にする。 */
function endpointOf(url: string): Endpoint {
  if (url.includes('/setup/ws/1/validate')) {
    return 'validate';
  }
  if (url.includes('/geqs/query')) {
    return 'geqs';
  }
  if (url.includes('/thread/search')) {
    return 'search';
  }
  throw new Error(`想定外の URL: ${url}`);
}

/** fetch を URL ごとの handler で置き換える。指定しない endpoint は fixture を返す。 */
function stubFetch(overrides: Partial<Record<Endpoint, Handler>> = {}) {
  const handlers = { ...defaultHandlers, ...overrides };
  const fetchMock = vi.fn<(input: FetchInput, init?: RequestInit) => Promise<Response>>();
  fetchMock.mockImplementation((input) => Promise.resolve(handlers[endpointOf(String(input))]()));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** chrome.cookies.get を置き換える。cookie が null なら未ログイン。 */
function stubCookie(cookie: chrome.cookies.Cookie | null) {
  const getMock = vi.fn<(details: chrome.cookies.CookieDetails) => Promise<chrome.cookies.Cookie | null>>(() =>
    Promise.resolve(cookie),
  );
  vi.stubGlobal('chrome', { cookies: { get: getMock } });
  return getMock;
}

const authCookie: chrome.cookies.Cookie = {
  name: 'X-APPLE-WEBAUTH-USER',
  value: 'v=1:s=0:d=12345678901',
  domain: '.icloud.com',
  hostOnly: false,
  path: '/',
  secure: true,
  httpOnly: false,
  sameSite: 'no_restriction',
  session: false,
  storeId: '0',
};

function signedOut(): AccountState {
  return {
    provider: 'icloud',
    accountKey: 'icloud',
    email: null,
    status: 'signedOut',
    unreadCount: 0,
    items: [],
    errorMessage: null,
    errorKind: null,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchIcloudState', () => {
  it('validate、geqs/query、thread/search から未読の状態を組み立てる', async () => {
    stubCookie(authCookie);
    stubFetch();
    expect(await fetchIcloudState()).toEqual({
      provider: 'icloud',
      accountKey: 'icloud',
      email: EMAIL,
      status: 'ok',
      unreadCount: 2,
      items: [
        {
          id: 'thread-a1',
          provider: 'icloud',
          accountKey: 'icloud',
          from: 'Hanako Example <hanako@example.com>',
          subject: '打ち合わせの件',
          snippet: '来週の打ち合わせについてご相談です。',
          date: '2026-10-20T02:00:00.000Z',
          openUrl: ICLOUD_MAIL_URL,
        },
        {
          id: 'thread-b2',
          provider: 'icloud',
          accountKey: 'icloud',
          from: 'Jiro Example <jiro@example.com>',
          subject: 'Re: 資料の送付',
          snippet: '資料を受け取りました。',
          date: '2026-10-20T01:00:00.000Z',
          openUrl: ICLOUD_MAIL_URL,
        },
      ],
      errorMessage: null,
      errorKind: null,
    } satisfies AccountState);
  });

  it('www.icloud.com の X-APPLE-WEBAUTH-USER Cookie を調べる', async () => {
    const getMock = stubCookie(authCookie);
    stubFetch();
    await fetchIcloudState();
    expect(getMock).toHaveBeenCalledWith({ url: ICLOUD_ORIGIN, name: 'X-APPLE-WEBAUTH-USER' });
  });

  it(':443 を除いた gateway に dsid を付けて、validate、geqs/query、thread/search の順に要求する', async () => {
    stubCookie(authCookie);
    const fetchMock = stubFetch();
    await fetchIcloudState();
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      ICLOUD_VALIDATE_URL,
      `${GATEWAY}/mailws2/v1/geqs/query?dsid=${DSID}`,
      `${GATEWAY}/mailws2/v1/thread/search?dsid=${DSID}`,
    ]);
  });

  it('すべての要求を POST、credentials: include、JSON の Content-Type、タイムアウトの signal 付きで送る', async () => {
    stubCookie(authCookie);
    const fetchMock = stubFetch();
    await fetchIcloudState();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('validate の body は null、geqs/query は mailbox の問い合わせ、thread/search は設計 §7.2 の body', async () => {
    stubCookie(authCookie);
    const fetchMock = stubFetch();
    await fetchIcloudState();
    const bodies = fetchMock.mock.calls.map(([, init]) => init?.body);
    expect(bodies[0]).toBeNull();
    expect(JSON.parse(String(bodies[1]))).toMatchObject({ domain: 'mailbox' });
    expect(JSON.parse(String(bodies[2]))).toEqual({
      responseType: 'THREAD_DIGEST',
      includeFolderStatus: false,
      maxResults: ICLOUD_MAX_RESULTS,
      sessionHeaders: { folder: 'INBOX', modseq: null, threadmodseq: null, condstore: 1, qresync: 1, threadmode: 1 },
    });
  });

  it('Cookie が無ければ fetch せずに signedOut を返す', async () => {
    stubCookie(null);
    const fetchMock = stubFetch();
    expect(await fetchIcloudState()).toEqual(signedOut());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 403, 421, 450])('validate が %i なら signedOut を返す', async (status) => {
    stubCookie(authCookie);
    const fetchMock = stubFetch({ validate: () => json({}, status) });
    expect(await fetchIcloudState()).toEqual(signedOut());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 421, 450])('thread/search が %i なら email も null の signedOut を返す', async (status) => {
    stubCookie(authCookie);
    stubFetch({ search: () => json({}, status) });
    expect(await fetchIcloudState()).toEqual(signedOut());
  });

  it.each([401, 403, 421, 450])('geqs/query が %i なら signedOut を返し、thread/search は呼ばない', async (status) => {
    stubCookie(authCookie);
    const fetchMock = stubFetch({ geqs: () => json({}, status) });
    expect(await fetchIcloudState()).toEqual(signedOut());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('thread/search が 500 なら HTTP 500 の error を返す', async () => {
    stubCookie(authCookie);
    stubFetch({ search: () => json({}, 500) });
    expect(await fetchIcloudState()).toEqual({
      provider: 'icloud',
      accountKey: 'icloud',
      email: EMAIL,
      status: 'error',
      unreadCount: 0,
      items: [],
      errorMessage: 'HTTP 500',
      errorKind: null,
    } satisfies AccountState);
  });

  it('geqs/query が 500 なら HTTP 500 の error を返し、thread/search は呼ばない', async () => {
    stubCookie(authCookie);
    const fetchMock = stubFetch({ geqs: () => json({}, 500) });
    expect(await fetchIcloudState()).toEqual({
      provider: 'icloud',
      accountKey: 'icloud',
      email: EMAIL,
      status: 'error',
      unreadCount: 0,
      items: [],
      errorMessage: 'HTTP 500',
      errorKind: null,
    } satisfies AccountState);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('validate が 500 なら email が null の error を返す', async () => {
    stubCookie(authCookie);
    stubFetch({ validate: () => json({}, 500) });
    const state = await fetchIcloudState();
    expect(state.status).toBe('error');
    expect(state.email).toBeNull();
    expect(state.errorMessage).toBe('HTTP 500');
  });

  it('thread/search の応答がスキーマに合わなければ仕様変更の可能性を含む error を返す', async () => {
    stubCookie(authCookie);
    stubFetch({ search: () => json({ threadList: [{ threadId: 'x', senders: [] }] }) });
    const state = await fetchIcloudState();
    expect(state).toMatchObject({ status: 'error', email: EMAIL, unreadCount: 0, items: [] });
    expect(state.errorMessage).toContain('thread/search');
    expect(state.errorMessage).toContain('iCloud API の仕様変更の可能性');
    // z.prettifyError の出力（問題のパス）を含む。
    expect(state.errorMessage).toContain('threadList[0].senders');
  });

  it('validate の応答がスキーマに合わなければ email が null の error を返す', async () => {
    stubCookie(authCookie);
    stubFetch({ validate: () => json({ dsInfo: { dsid: 1 } }) });
    const state = await fetchIcloudState();
    expect(state).toMatchObject({ status: 'error', email: null });
    expect(state.errorMessage).toContain('iCloud API の仕様変更の可能性');
  });

  it('geqs/query の応答がスキーマに合わなければ仕様変更の可能性を含む error を返し、thread/search は呼ばない', async () => {
    stubCookie(authCookie);
    const fetchMock = stubFetch({ geqs: () => json({ domainObjects: 'INBOX' }) });
    const state = await fetchIcloudState();
    expect(state).toMatchObject({ status: 'error', email: EMAIL, unreadCount: 0, items: [] });
    expect(state.errorMessage).toContain('iCloud API の仕様変更の可能性');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('geqs/query に INBOX が無ければ error を返す', async () => {
    stubCookie(authCookie);
    const fetchMock = stubFetch({ geqs: () => json({ domainObjects: [{ name: 'Junk', unseenCount: 3 }] }) });
    const state = await fetchIcloudState();
    expect(state).toMatchObject({ status: 'error', email: EMAIL, unreadCount: 0, items: [] });
    expect(state.errorMessage).toContain('INBOX');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('geqs/query の INBOX に unseenCount が無ければ error を返す', async () => {
    stubCookie(authCookie);
    const fetchMock = stubFetch({ geqs: () => json({ domainObjects: [{ name: 'INBOX' }, { name: 'Work' }] }) });
    const state = await fetchIcloudState();
    expect(state).toMatchObject({ status: 'error', email: EMAIL, unreadCount: 0, items: [] });
    expect(state.errorMessage).toContain('unseenCount');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fetch が失敗したら、その理由の error を返す', async () => {
    stubCookie(authCookie);
    stubFetch({ geqs: () => Promise.reject(new TypeError('Failed to fetch')) });
    expect(await fetchIcloudState()).toEqual({
      provider: 'icloud',
      accountKey: 'icloud',
      email: EMAIL,
      status: 'error',
      unreadCount: 0,
      items: [],
      errorMessage: 'Failed to fetch',
      errorKind: null,
    } satisfies AccountState);
  });

  it('応答が JSON でなければ error を返す', async () => {
    stubCookie(authCookie);
    stubFetch({ validate: () => new Response('<html></html>', { status: 200 }) });
    const state = await fetchIcloudState();
    expect(state).toMatchObject({ status: 'error', email: null });
    expect(state.errorMessage).not.toBeNull();
  });
});

describe('judgeStatus', () => {
  it.each([200, 204, 299])('%i は ok', (status) => {
    expect(judgeStatus(status)).toBe('ok');
  });

  it.each([401, 403, 421, 450])('%i は signedOut', (status) => {
    expect(judgeStatus(status)).toBe('signedOut');
  });

  it.each([199, 300, 302, 400, 404, 500, 503])('%i は error', (status) => {
    expect(judgeStatus(status)).toBe('error');
  });
});

describe('stripPort443', () => {
  it.each([
    ['https://p123-mccgateway.icloud.com:443', 'https://p123-mccgateway.icloud.com'],
    ['https://p123-mccgateway.icloud.com', 'https://p123-mccgateway.icloud.com'],
    ['https://p123-mccgateway.icloud.com:4430', 'https://p123-mccgateway.icloud.com:4430'],
  ])('%s を %s にする', (input, expected) => {
    expect(stripPort443(input)).toBe(expected);
  });
});

describe('toMailItems', () => {
  it('\\Seen を含むスレッドを除き、他のフラグは未読として残す', () => {
    const ids = toMailItems(threadSearchFixture.threadList).map((item) => item.id);
    expect(ids).toEqual(['thread-a1', 'thread-b2']);
  });

  it('スレッドが無ければ空配列を返す', () => {
    expect(toMailItems([])).toEqual([]);
  });
});
