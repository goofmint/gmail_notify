import { GMAIL_INBOX_URL, ICLOUD_MAIL_URL } from './constants';
import type { AccountState } from './types';

/** Gmail の accountKey `gmail:u/{n}` から n を取り出す。形式が違えば例外。 */
function gmailAccountIndex(accountKey: string): number {
  const match = /^gmail:u\/(\d+)$/.exec(accountKey);
  if (match === null) {
    throw new Error(`Gmail の accountKey の形式が不正: ${accountKey}`);
  }
  return Number(match[1]);
}

/** アカウントのトップページ（受信トレイ）の URL。Gmail の accountKey の形式が不正なら例外。 */
export function accountHomeUrl(account: Pick<AccountState, 'provider' | 'accountKey'>): string {
  switch (account.provider) {
    case 'gmail':
      return GMAIL_INBOX_URL(gmailAccountIndex(account.accountKey));
    case 'icloud':
      return ICLOUD_MAIL_URL;
  }
}
