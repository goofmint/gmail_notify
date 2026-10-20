import * as z from 'zod';
import { STORAGE_KEYS } from './constants';
import type { AccountState, CheckResult, MailItem } from './types';

// satisfies で types.ts とのずれを typecheck で検出する。双方向の一致は checkResultSchema の型テストで確認する。
const providerSchema = z.enum(['gmail', 'icloud']);

const mailItemSchema = z.object({
  id: z.string(),
  provider: providerSchema,
  accountKey: z.string(),
  from: z.string(),
  subject: z.string(),
  snippet: z.string(),
  date: z.string(),
  openUrl: z.string(),
}) satisfies z.ZodType<MailItem, MailItem>;

const accountStateSchema = z.object({
  provider: providerSchema,
  accountKey: z.string(),
  email: z.string().nullable(),
  status: z.enum(['ok', 'signedOut', 'error']),
  unreadCount: z.number().int().nonnegative(),
  items: z.array(mailItemSchema),
  errorMessage: z.string().nullable(),
}) satisfies z.ZodType<AccountState, AccountState>;

export const checkResultSchema = z.object({
  checkedAt: z.string(),
  accounts: z.array(accountStateSchema),
}) satisfies z.ZodType<CheckResult, CheckResult>;

/** accountKey ごとの既読 id。 */
const seenIdsSchema = z.record(z.string(), z.array(z.string()));

/** key の値を schema で検証して返す。未保存なら null、不正なら例外。 */
async function loadValidated<T>(
  area: chrome.storage.StorageArea,
  key: string,
  schema: z.ZodType<T>,
  label: string,
): Promise<T | null> {
  const items = await area.get(key);
  const raw = items[key];
  if (raw === undefined) {
    return null;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`保存済みの ${label} の形式が不正: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/** 前回のチェック結果を読む。未保存なら null。 */
export function loadResult(): Promise<CheckResult | null> {
  return loadValidated(chrome.storage.local, STORAGE_KEYS.result, checkResultSchema, 'result');
}

export async function saveResult(result: CheckResult): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.result]: result });
}

/** 前回の既読 id を読む。初回（未保存）なら null。 */
export function loadSeenIds(): Promise<Record<string, string[]> | null> {
  return loadValidated(chrome.storage.local, STORAGE_KEYS.seenIds, seenIdsSchema, 'seenIds');
}

export async function saveSeenIds(seenIds: Record<string, string[]>): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.seenIds]: seenIds });
}

/** 通知クリック時に開く URL を、notificationId をキーにして session に保存する。 */
export async function saveNotificationUrl(notificationId: string, url: string): Promise<void> {
  await chrome.storage.session.set({ [notificationId]: url });
}

/** 通知に対応する URL を読む。未保存なら null。 */
export function loadNotificationUrl(notificationId: string): Promise<string | null> {
  return loadValidated(chrome.storage.session, notificationId, z.string(), `通知 ${notificationId} の URL`);
}

/** 通知に対応する URL を消す。クリック後に session のキーを残さないために使う。 */
export async function removeNotificationUrl(notificationId: string): Promise<void> {
  await chrome.storage.session.remove(notificationId);
}
