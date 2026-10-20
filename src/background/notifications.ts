import { GMAIL_INBOX_URL, ICLOUD_MAIL_URL } from '../shared/constants';
import { loadNotificationUrl, removeNotificationUrl, saveNotificationUrl } from '../shared/storage';
import type { AccountState } from '../shared/types';
import type { NewMailGroup } from './diff';

/** 通知に使う拡張のアイコン（128px）。manifest の icons と同じパス。 */
const NOTIFICATION_ICON_PATH = 'icons/icon-128.png';

/** 1 アカウント分の通知の内容と、クリック時に開く URL。 */
export type BuiltNotification = {
  notificationId: string;
  options: chrome.notifications.NotificationCreateOptions;
  url: string;
};

/** Gmail の accountKey `gmail:u/{n}` から n を取り出す。形式が違えば例外。 */
function gmailAccountIndex(accountKey: string): number {
  const match = /^gmail:u\/(\d+)$/.exec(accountKey);
  if (match === null) {
    throw new Error(`Gmail の accountKey の形式が不正: ${accountKey}`);
  }
  return Number(match[1]);
}

/** 複数件の新着のときに開く、アカウントの受信トレイ。 */
function inboxUrl(account: AccountState): string {
  switch (account.provider) {
    case 'gmail':
      return GMAIL_INBOX_URL(gmailAccountIndex(account.accountKey));
    case 'icloud':
      return ICLOUD_MAIL_URL;
  }
}

/** 1 アカウント分の新着から通知を組み立てる（設計 §8.4）。now は notificationId に使う時刻（ミリ秒）。 */
export function buildNotification(group: NewMailGroup, now: number): BuiltNotification {
  const { account, items } = group;
  const [first] = items;
  if (first === undefined) {
    throw new Error(`新着が 0 件のグループは通知できない: ${account.accountKey}`);
  }
  // 通知は ok のアカウントだけに出すため、email は必ずある。
  if (account.email === null) {
    throw new Error(`メールアドレスの無いアカウントは通知できない: ${account.accountKey}`);
  }
  const single = items.length === 1;
  return {
    notificationId: `mail:${account.accountKey}:${now}`,
    options: {
      type: 'basic',
      iconUrl: chrome.runtime.getURL(NOTIFICATION_ICON_PATH),
      title: single ? first.from : `${account.email}: ${items.length} 件の新着メール`,
      message: first.subject,
      contextMessage: account.email,
    },
    url: single ? first.openUrl : inboxUrl(account),
  };
}

/** アカウントごとに通知を出す。クリック時に開く URL を、通知を出す前に storage.session へ保存する。 */
export async function notifyNewMail(groups: NewMailGroup[]): Promise<void> {
  for (const group of groups) {
    const { notificationId, options, url } = buildNotification(group, Date.now());
    await saveNotificationUrl(notificationId, url);
    await chrome.notifications.create(notificationId, options);
  }
}

/** 通知がクリックされたら、保存した URL をタブで開き、URL を消して通知を閉じる。 */
export async function handleNotificationClick(notificationId: string): Promise<void> {
  const url = await loadNotificationUrl(notificationId);
  if (url === null) {
    // ブラウザの再起動などで session の URL が消えた通知。開く先が無いので閉じるだけにする。
    await chrome.notifications.clear(notificationId);
    return;
  }
  await chrome.tabs.create({ url });
  await removeNotificationUrl(notificationId);
  await chrome.notifications.clear(notificationId);
}
