import type { AccountState, MailItem, SeenIds } from '../shared/types';

/** 1 アカウント分の新着。通知はアカウント単位で出すため、アカウントの情報と一緒に返す。 */
export type NewMailGroup = { account: AccountState; items: MailItem[] };

/**
 * 前回の既知 id と今回の結果から新着を求める（設計 §8.2 手順 4）。
 * 初回（prevSeen が null）と、前回に無かった accountKey は新着の対象外にする。
 * status が ok のアカウントだけを見る。新着が 1 件以上あるアカウントだけを、accounts の順で返す。
 */
export function detectNewMail(prevSeen: SeenIds | null, accounts: AccountState[]): NewMailGroup[] {
  if (prevSeen === null) {
    return [];
  }
  const groups: NewMailGroup[] = [];
  for (const account of accounts) {
    if (account.status !== 'ok' || !Object.hasOwn(prevSeen, account.accountKey)) {
      continue;
    }
    const seen = new Set(prevSeen[account.accountKey]);
    const items = account.items.filter((item) => !seen.has(item.id));
    if (items.length > 0) {
      groups.push({ account, items });
    }
  }
  return groups;
}

/**
 * 次に保存する既知 id を求める（設計 §8.2 手順 5）。
 * status が ok のアカウントだけを今回の id で上書きする。signedOut、error、今回現れなかったアカウントは前回の値を残す。
 * signedOut や error のときに今回の id（空）で上書きすると、復帰したときに未読がすべて新着として扱われ、通知が大量に出るため。
 * 停止中に届いたメールは前回の値に無いので、復帰したときに新着として通知する。これは意図した動作。
 */
export function nextSeenIds(prevSeen: SeenIds | null, accounts: AccountState[]): SeenIds {
  const next: SeenIds = { ...prevSeen };
  for (const account of accounts) {
    if (account.status === 'ok') {
      // accountKey が "__proto__" でも own property として保存されるよう defineProperty を使う。
      Object.defineProperty(next, account.accountKey, {
        value: account.items.map((item) => item.id),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return next;
}
