import type { Settings } from './types';

/** 既定の設定値。既定値はここだけで定義する。 */
export const DEFAULT_SETTINGS: Settings = {
  intervalMinutes: 1,
  notificationsEnabled: true,
  gmailEnabled: true,
  icloudEnabled: true,
  ignoreUnreachableAccounts: false,
};

/** チェック間隔の最小値（分）。 */
export const MIN_INTERVAL_MINUTES = 0.5;
/** 設定画面で選べるチェック間隔（分）。設計 §10。 */
export const INTERVAL_OPTIONS_MINUTES = [0.5, 1, 2, 5, 10, 15, 30] as const;
/** プロバイダへの 1 リクエストのタイムアウト（ミリ秒）。応答が返らない場合に runCheck 全体が止まるのを防ぐ。 */
export const FETCH_TIMEOUT_MS = 15_000;
/** 検出する Gmail アカウントの上限。 */
export const MAX_GMAIL_ACCOUNTS = 10;
/** Gmail アカウント検出で、error が何件連続したら検出を打ち切るか（設計 §6.2）。 */
export const GMAIL_MAX_CONSECUTIVE_ERRORS = 2;
/** iCloud の thread/search で取得する件数。 */
export const ICLOUD_MAX_RESULTS = 50;

/** Gmail アカウント n の未読フィード。 */
export const GMAIL_FEED_URL = (n: number): string => `https://mail.google.com/mail/u/${n}/feed/atom`;
/** Gmail アカウント n のメール 1 件。 */
export const GMAIL_MESSAGE_URL = (n: number, id: string): string =>
  `https://mail.google.com/mail/u/${n}/#inbox/${id}`;
/** Gmail アカウント n の受信トレイ。 */
export const GMAIL_INBOX_URL = (n: number): string => `https://mail.google.com/mail/u/${n}/#inbox`;
/** Gmail のログインページ。ログイン後に Gmail へ戻る想定。T6-3 で実機確認する。 */
export const GMAIL_LOGIN_URL =
  'https://accounts.google.com/ServiceLogin?service=mail&continue=https://mail.google.com/mail/';

export const ICLOUD_ORIGIN = 'https://www.icloud.com';
export const ICLOUD_MAIL_URL = 'https://www.icloud.com/mail/';
/** 公開実装（pyicloud など）に基づく値。T6-3 で実機確認する。 */
export const ICLOUD_VALIDATE_URL = 'https://setup.icloud.com/setup/ws/1/validate';

/**
 * chrome.storage.local と session のキー。
 * 設定は chrome.storage.sync にトップレベルキーで保存するため、settings のキーは持たない（設計 §5 との差分）。
 */
export const STORAGE_KEYS = { result: 'result', seenIds: 'seenIds' } as const;

export const ALARM_NAME = 'mail-check';

/** バッジの背景色。全アカウントが ok なら ok、それ以外は warning。 */
export const BADGE_COLORS = { ok: '#1A73E8', warning: '#D93025' } as const;
/** 未読が 0 件で ok 以外のアカウントがあるときのバッジの文字列。空文字だとバッジ自体が消え、警告色が見えないため。 */
export const BADGE_WARNING_TEXT = '!';
/** バッジに表示する最大件数。これを超えたら `999+` と表示する。 */
export const BADGE_MAX_COUNT = 999;
