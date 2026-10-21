import { FETCH_TIMEOUT_MS, GMAIL_FEED_URL, GMAIL_MAX_CONSECUTIVE_ERRORS, MAX_GMAIL_ACCOUNTS } from '../shared/constants';
import type { AccountState } from '../shared/types';
import { parseGmailFeed, type GmailFeed } from './gmailParser';

/** fetchFeed の結果。判定は設計 §6.1 の表に従う。 */
export type FeedFetchResult =
  | { kind: 'ok'; feed: GmailFeed }
  | { kind: 'signedOut' }
  | { kind: 'notFound' }
  | { kind: 'error'; message: string };

const SIGN_IN_HOST = 'accounts.google.com';
const ACCOUNT_PATH_PATTERN = /\/u\/(\d+)\//;
const FETCH_FAILED_MESSAGE = 'フィードを取得できませんでした（ネットワークエラー、または権限のない URL への転送の可能性）';

/** 最終 URL と状態コードから判定する。2xx なら null を返し、本文の解析に進む。 */
function judgeResponse(response: Response, n: number): FeedFetchResult | null {
  const finalUrl = new URL(response.url);
  if (response.status === 401 || finalUrl.host === SIGN_IN_HOST) {
    return { kind: 'signedOut' };
  }
  const account = ACCOUNT_PATH_PATTERN.exec(finalUrl.pathname)?.[1];
  // /u/{m}/ が無い URL は存在しないアカウントとはみなさない。
  if (account !== undefined && Number(account) !== n) {
    return { kind: 'notFound' };
  }
  if (!response.ok) {
    return { kind: 'error', message: `HTTP ${response.status}` };
  }
  return null;
}

/** アカウント n の未読フィードを取得して解析する。例外は投げず、結果の kind で返す。 */
export async function fetchFeed(n: number): Promise<FeedFetchResult> {
  try {
    // zx はキャッシュ回避用の乱数。signal は応答待ちと本文の読み取りの両方を期限で中断する。
    const response = await fetch(`${GMAIL_FEED_URL(n)}?zx=${crypto.randomUUID()}`, {
      credentials: 'include',
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const judged = judgeResponse(response, n);
    if (judged !== null) {
      return judged;
    }
    return { kind: 'ok', feed: parseGmailFeed(await response.text(), n) };
  } catch (error) {
    // TypeError は応答が得られなかったことしか分からないため、実機で確認した原因
    // （契約切れのアカウントで権限のない URL に転送される）を候補として補って表示する。
    if (error instanceof TypeError) {
      return { kind: 'error', message: `${FETCH_FAILED_MESSAGE}: ${error.message}` };
    }
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}

function failedAccount(accountKey: string, status: 'signedOut' | 'error', message: string | null): AccountState {
  return { provider: 'gmail', accountKey, email: null, status, unreadCount: 0, items: [], errorMessage: message };
}

/**
 * u/0 から順にフィードを取得し、Gmail アカウントを検出する（設計 §6.2）。
 * 存在しないアカウント、メールアドレスの重複、signedOut のいずれかで打ち切る。打ち切る前の結果は残す。
 * error は打ち切らず、そのアカウントを error として加えて次の番号に進む。途中の 1 アカウントだけが
 * 取得できない場合（実機で確認した契約切れのアカウント）に、後ろのアカウントが隠れないようにするため。
 * ただし error が GMAIL_MAX_CONSECUTIVE_ERRORS 件連続したら、Gmail 全体に到達できないとみなして打ち切る。
 */
export async function discoverGmailAccounts(): Promise<AccountState[]> {
  const accounts: AccountState[] = [];
  const seenEmails = new Set<string>();
  let consecutiveErrors = 0;
  for (let n = 0; n < MAX_GMAIL_ACCOUNTS; n++) {
    const accountKey = `gmail:u/${n}`;
    const result = await fetchFeed(n);
    if (result.kind === 'notFound') {
      break;
    }
    if (result.kind === 'signedOut') {
      accounts.push(failedAccount(accountKey, 'signedOut', null));
      break;
    }
    if (result.kind === 'error') {
      accounts.push(failedAccount(accountKey, 'error', result.message));
      consecutiveErrors += 1;
      if (consecutiveErrors >= GMAIL_MAX_CONSECUTIVE_ERRORS) {
        break;
      }
      continue;
    }
    consecutiveErrors = 0;
    const normalized = result.feed.email.trim().toLowerCase();
    if (seenEmails.has(normalized)) {
      break;
    }
    seenEmails.add(normalized);
    accounts.push({
      provider: 'gmail',
      accountKey,
      email: result.feed.email,
      status: 'ok',
      unreadCount: result.feed.unreadCount,
      items: result.feed.items,
      errorMessage: null,
    });
  }
  return accounts;
}
