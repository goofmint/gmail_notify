import * as z from 'zod';
import {
  FETCH_TIMEOUT_MS,
  ICLOUD_MAIL_URL,
  ICLOUD_MAX_RESULTS,
  ICLOUD_ORIGIN,
  ICLOUD_VALIDATE_URL,
} from '../shared/constants';
import type { AccountState, AccountStatus, MailItem } from '../shared/types';
import { GeqsSchema, ThreadSearchSchema, ValidateSchema, type IcloudThread } from './schemas';

const ACCOUNT_KEY = 'icloud';
/** iCloud にログインしていると www.icloud.com に付く Cookie。 */
const AUTH_COOKIE_NAME = 'X-APPLE-WEBAUTH-USER';
const INBOX = 'INBOX';
const SEEN_FLAG = '\\Seen';
/** signedOut とみなす HTTP ステータス（設計 §7.2）。 */
const SIGNED_OUT_STATUSES: readonly number[] = [401, 403, 421, 450];

/**
 * geqs/query の body。mailbox の一覧と未読数を問い合わせる。
 * 公開されている拡張機能の実装と同じ値（src/providers/schemas.ts の iCloud の節を参照）。T6-3 の実機テストで確定する。
 */
const GEQS_QUERY_BODY = JSON.stringify({
  domain: 'mailbox',
  predicate: { type: 'eq', expression: { type: 'property', property: 'isMboxDeleted' }, value: false },
  includeLabels: true,
  properties: [
    'identifier',
    'name',
    'uidValidity',
    'unseenCount',
    'seenDeletedCount',
    'unseenDeletedCount',
    'messageCount',
    'flags',
  ],
});

/** thread/search の body（設計 §7.2）。 */
const THREAD_SEARCH_BODY = JSON.stringify({
  responseType: 'THREAD_DIGEST',
  includeFolderStatus: false,
  maxResults: ICLOUD_MAX_RESULTS,
  sessionHeaders: { folder: INBOX, modseq: null, threadmodseq: null, condstore: 1, qresync: 1, threadmode: 1 },
});

/** 1 回の要求の結果。 */
type StepResult<T> = { kind: 'ok'; data: T } | { kind: 'signedOut' } | { kind: 'error'; message: string };

/** HTTP ステータスを判定する（設計 §7.2 の表）。2xx は ok。 */
export function judgeStatus(status: number): AccountStatus {
  if (SIGNED_OUT_STATUSES.includes(status)) {
    return 'signedOut';
  }
  if (status >= 200 && status < 300) {
    return 'ok';
  }
  return 'error';
}

/** mccgateway の URL の末尾に付く `:443` を除去する。 */
export function stripPort443(url: string): string {
  return url.replace(/:443$/, '');
}

/** `\Seen` を含まないスレッドを MailItem にする（設計 §7.2 の表）。 */
export function toMailItems(threads: IcloudThread[]): MailItem[] {
  return threads
    .filter((thread) => !thread.flags.includes(SEEN_FLAG))
    .map((thread): MailItem => {
      const [from] = thread.senders;
      // ThreadSearchSchema で senders に min(1) を付けているので、ここには来ない。
      if (from === undefined) {
        throw new Error(`iCloud のスレッド ${thread.threadId} に送信者が無い`);
      }
      return {
        id: thread.threadId,
        provider: 'icloud',
        accountKey: ACCOUNT_KEY,
        from,
        subject: thread.subject,
        snippet: thread.preview,
        date: new Date(thread.timestamp).toISOString(),
        openUrl: ICLOUD_MAIL_URL,
      };
    });
}

/** JSON を POST し、ステータスを判定して、2xx なら応答を schema で検証する。通信の例外は呼び出し元に投げる。 */
async function postJson<T>(
  url: string,
  body: string | null,
  schema: z.ZodType<T>,
  label: string,
): Promise<StepResult<T>> {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const status = judgeStatus(response.status);
  if (status === 'signedOut') {
    return { kind: 'signedOut' };
  }
  if (status === 'error') {
    return { kind: 'error', message: `HTTP ${response.status}` };
  }
  // json() の戻り値は any。変数に受けず、そのまま safeParse に渡す（library-notes §9）。
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    return {
      kind: 'error',
      message: `iCloud の ${label} の応答が想定と違う（iCloud API の仕様変更の可能性）: ${z.prettifyError(parsed.error)}`,
    };
  }
  return { kind: 'ok', data: parsed.data };
}

function okState(email: string, unreadCount: number, items: MailItem[]): AccountState {
  return {
    provider: 'icloud',
    accountKey: ACCOUNT_KEY,
    email,
    status: 'ok',
    unreadCount,
    items,
    errorMessage: null,
    errorKind: null,
  };
}

function signedOutState(): AccountState {
  return {
    provider: 'icloud',
    accountKey: ACCOUNT_KEY,
    email: null,
    status: 'signedOut',
    unreadCount: 0,
    items: [],
    errorMessage: null,
    errorKind: null,
  };
}

/** email は validate が成功していれば primaryEmail、それ以前の失敗なら null。 */
function errorState(email: string | null, message: string): AccountState {
  return {
    provider: 'icloud',
    accountKey: ACCOUNT_KEY,
    email,
    status: 'error',
    unreadCount: 0,
    items: [],
    errorMessage: message,
    errorKind: null,
  };
}

/** signedOut か error の StepResult を AccountState にする。 */
function failedState(
  result: { kind: 'signedOut' } | { kind: 'error'; message: string },
  email: string | null,
): AccountState {
  return result.kind === 'signedOut' ? signedOutState() : errorState(email, result.message);
}

/** iCloud メールの未読を取得する（設計 §7.2）。例外は投げず、status で返す。 */
export async function fetchIcloudState(): Promise<AccountState> {
  let email: string | null = null;
  try {
    const cookie = await chrome.cookies.get({ url: ICLOUD_ORIGIN, name: AUTH_COOKIE_NAME });
    if (cookie === null) {
      return signedOutState();
    }

    const validate = await postJson(ICLOUD_VALIDATE_URL, null, ValidateSchema, 'validate');
    if (validate.kind !== 'ok') {
      return failedState(validate, email);
    }
    email = validate.data.dsInfo.primaryEmail;
    const mcc = stripPort443(validate.data.webservices.mccgateway.url);
    const query = `?dsid=${encodeURIComponent(validate.data.dsInfo.dsid)}`;

    const geqs = await postJson(`${mcc}/mailws2/v1/geqs/query${query}`, GEQS_QUERY_BODY, GeqsSchema, 'geqs/query');
    if (geqs.kind !== 'ok') {
      return failedState(geqs, email);
    }
    const inbox = geqs.data.domainObjects.find((mailbox) => mailbox.name === INBOX);
    if (inbox === undefined) {
      return errorState(email, `iCloud の geqs/query の応答に ${INBOX} が無い（iCloud API の仕様変更の可能性）`);
    }
    if (inbox.unseenCount === undefined) {
      return errorState(email, `iCloud の geqs/query の応答の ${INBOX} に unseenCount が無い（iCloud API の仕様変更の可能性）`);
    }

    const search = await postJson(
      `${mcc}/mailws2/v1/thread/search${query}`,
      THREAD_SEARCH_BODY,
      ThreadSearchSchema,
      'thread/search',
    );
    if (search.kind !== 'ok') {
      return failedState(search, email);
    }
    return okState(email, inbox.unseenCount, toMailItems(search.data.threadList));
  } catch (error) {
    return errorState(email, error instanceof Error ? error.message : String(error));
  }
}
