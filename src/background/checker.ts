import { discoverGmailAccounts } from '../providers/gmail';
import { fetchIcloudState } from '../providers/icloud';
import { loadSettings } from '../shared/settings';
import { loadSeenIds, saveResult, saveSeenIds } from '../shared/storage';
import type { AccountState, Provider } from '../shared/types';
import { updateBadge } from './badge';
import { detectNewMail, nextSeenIds } from './diff';
import { notifyNewMail } from './notifications';

/** プロバイダごとの取得処理。reject されたときの error アカウントの accountKey も持つ。 */
type ProviderTask = { provider: Provider; accountKey: string; run: () => Promise<AccountState[]> };

/** 実行中の runCheck。同時に複数のチェックが動かないよう、呼び出し元で共有する。 */
let inFlight: Promise<void> | null = null;

/** reject されたプロバイダを、1 件の error アカウントにする。 */
function rejectedAccount(task: ProviderTask, errorMessage: string): AccountState {
  return {
    provider: task.provider,
    accountKey: task.accountKey,
    email: null,
    status: 'error',
    unreadCount: 0,
    items: [],
    errorMessage,
    errorKind: null,
  };
}

/** 有効なプロバイダを並列に実行する。一方が reject しても、もう一方の結果は使う。 */
async function collectAccounts(tasks: ProviderTask[]): Promise<AccountState[]> {
  const results = await Promise.allSettled(tasks.map((task) => task.run()));
  return results.flatMap((result, i) => {
    const task = tasks[i];
    if (task === undefined) {
      throw new Error(`プロバイダの結果と取得処理の数が合わない: ${i}`);
    }
    if (result.status === 'fulfilled') {
      return result.value;
    }
    const { reason } = result;
    return [rejectedAccount(task, reason instanceof Error ? reason.message : String(reason))];
  });
}

/**
 * 設定 ignoreUnreachableAccounts が ON のとき、応答が得られなかった error のアカウント（errorKind が unreachable）を除く。
 * 除いたアカウントは保存結果・バッジ・通知のいずれにも渡らない。既知 id は nextSeenIds が前回の値を残す。
 */
function excludeIgnoredAccounts(accounts: AccountState[], ignoreUnreachable: boolean): AccountState[] {
  if (!ignoreUnreachable) {
    return accounts;
  }
  return accounts.filter((account) => !(account.status === 'error' && account.errorKind === 'unreachable'));
}

/** 1 回分のチェック（設計 §8.2）。 */
async function check(): Promise<void> {
  const settings = await loadSettings();
  const tasks: ProviderTask[] = [];
  if (settings.gmailEnabled) {
    tasks.push({ provider: 'gmail', accountKey: 'gmail:u/0', run: discoverGmailAccounts });
  }
  if (settings.icloudEnabled) {
    tasks.push({ provider: 'icloud', accountKey: 'icloud', run: async () => [await fetchIcloudState()] });
  }
  const accounts = excludeIgnoredAccounts(await collectAccounts(tasks), settings.ignoreUnreachableAccounts);

  const prevSeen = await loadSeenIds();
  const groups = detectNewMail(prevSeen, accounts);
  await saveSeenIds(nextSeenIds(prevSeen, accounts));
  await saveResult({ checkedAt: new Date().toISOString(), accounts });
  await updateBadge(accounts);
  if (settings.notificationsEnabled && groups.length > 0) {
    await notifyNewMail(groups);
  }
}

/** メールをチェックする。実行中に呼ばれたら、実行中の Promise を返す。失敗は呼び出し元に伝える。 */
export function runCheck(): Promise<void> {
  if (inFlight !== null) {
    return inFlight;
  }
  const current = check().finally(() => {
    if (inFlight === current) {
      inFlight = null;
    }
  });
  inFlight = current;
  return current;
}
