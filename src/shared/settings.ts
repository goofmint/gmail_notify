import * as z from 'zod';
import { DEFAULT_SETTINGS, MIN_INTERVAL_MINUTES } from './constants';
import type { Settings } from './types';

// satisfies で Settings とのずれを typecheck で検出する。注釈と違い z.object の型はそのまま残る。
const settingsSchema = z.object({
  // zod 4 の z.number() は NaN と Infinity を拒否する（.finite() は非推奨の no-op）。
  intervalMinutes: z.number().min(MIN_INTERVAL_MINUTES),
  notificationsEnabled: z.boolean(),
  gmailEnabled: z.boolean(),
  icloudEnabled: z.boolean(),
}) satisfies z.ZodType<Settings, Settings>;

/** chrome.storage.sync から設定を読む。未保存の項目は DEFAULT_SETTINGS で補われる（chrome API の仕様）。 */
export async function loadSettings(): Promise<Settings> {
  const raw = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`設定の検証に失敗: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/** 設定を検証してから chrome.storage.sync にトップレベルキーで保存する。 */
export async function saveSettings(settings: Settings): Promise<void> {
  const parsed = settingsSchema.safeParse(settings);
  if (!parsed.success) {
    throw new Error(`保存する設定が不正: ${z.prettifyError(parsed.error)}`);
  }
  await chrome.storage.sync.set(parsed.data);
}
