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
  errorKind: z.enum(['unreachable']).nullable(),
}) satisfies z.ZodType<AccountState, AccountState>;

export const checkResultSchema = z.object({
  checkedAt: z.string(),
  accounts: z.array(accountStateSchema),
}) satisfies z.ZodType<CheckResult, CheckResult>;

/**
 * errorKind を追加する前（Issue #62 より前）に保存した result を読むための移行。
 * errorKind キーが無いアカウントだけ null を補ってから、通常のスキーマで検証する。errorKind があって値が不正なもの、
 * 他の項目が不正なものは補わず、通常どおり例外にする（union にすると検証エラーの詳細が失われるため、前処理で補う）。
 * 更新直後の onInstalled → runCheck で新形式に上書きされるまでの間、ポップアップが保存済みの結果を表示できるようにする。
 */
const storedAccountStateSchema = z.preprocess(
  (raw) => (typeof raw === 'object' && raw !== null && !Object.hasOwn(raw, 'errorKind') ? { ...raw, errorKind: null } : raw),
  accountStateSchema,
);

/** 保存済みの result を読むときのスキーマ。旧形式は移行する。 */
const storedCheckResultSchema = z.object({
  checkedAt: z.string(),
  accounts: z.array(storedAccountStateSchema),
}) satisfies z.ZodType<CheckResult>;

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
  // 継承プロパティ（constructor など）を保存済みの値と取り違えないよう、own property で判定する。
  if (!Object.hasOwn(items, key)) {
    return null;
  }
  const raw = items[key];
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`保存済みの ${label} の形式が不正: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/** 前回のチェック結果を読む。未保存なら null。 */
export function loadResult(): Promise<CheckResult | null> {
  return loadValidated(chrome.storage.local, STORAGE_KEYS.result, storedCheckResultSchema, 'result');
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
