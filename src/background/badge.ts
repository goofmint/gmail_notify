import { BADGE_COLORS, BADGE_MAX_COUNT, BADGE_WARNING_TEXT } from '../shared/constants';
import type { AccountState } from '../shared/types';

/** 全アカウントの未読数の合計。 */
export function totalUnread(accounts: AccountState[]): number {
  return accounts.reduce((sum, account) => sum + account.unreadCount, 0);
}

/** 全アカウントが ok か。アカウントが無ければ true。 */
export function allAccountsOk(accounts: AccountState[]): boolean {
  return accounts.every((account) => account.status === 'ok');
}

/**
 * バッジの文字列。0 なら空文字、BADGE_MAX_COUNT を超えたら `999+`。
 * 0 でも allOk が false なら `!` にする。空文字だとバッジが消え、警告色が見えなくなるため。
 */
export function badgeText(total: number, allOk: boolean): string {
  if (total === 0) {
    return allOk ? '' : BADGE_WARNING_TEXT;
  }
  if (total > BADGE_MAX_COUNT) {
    return `${BADGE_MAX_COUNT}+`;
  }
  return `${total}`;
}

/** バッジの背景色。全アカウントが ok なら通常色、それ以外なら警告色。 */
export function badgeColor(accounts: AccountState[]): string {
  return allAccountsOk(accounts) ? BADGE_COLORS.ok : BADGE_COLORS.warning;
}

/** チェック結果でバッジの文字列と背景色を更新する。 */
export async function updateBadge(accounts: AccountState[]): Promise<void> {
  await chrome.action.setBadgeText({ text: badgeText(totalUnread(accounts), allAccountsOk(accounts)) });
  await chrome.action.setBadgeBackgroundColor({ color: badgeColor(accounts) });
}
