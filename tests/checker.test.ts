import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runCheck } from '../src/background/checker';
import type { NewMailGroup } from '../src/background/diff';
import type { AccountState, CheckResult, MailItem, SeenIds, Settings } from '../src/shared/types';

// vi.mock は hoist されるため、モック関数も vi.hoisted で先に作る。
const mocks = vi.hoisted(() => ({
  discoverGmailAccounts: vi.fn<() => Promise<AccountState[]>>(),
  fetchIcloudState: vi.fn<() => Promise<AccountState>>(),
  loadSettings: vi.fn<() => Promise<Settings>>(),
  loadSeenIds: vi.fn<() => Promise<SeenIds | null>>(),
  saveSeenIds: vi.fn<(seenIds: SeenIds) => Promise<void>>(),
  saveResult: vi.fn<(result: CheckResult) => Promise<void>>(),
  updateBadge: vi.fn<(accounts: AccountState[]) => Promise<void>>(),
  notifyNewMail: vi.fn<(groups: NewMailGroup[]) => Promise<void>>(),
}));

vi.mock('../src/providers/gmail', () => ({ discoverGmailAccounts: mocks.discoverGmailAccounts }));
vi.mock('../src/providers/icloud', () => ({ fetchIcloudState: mocks.fetchIcloudState }));
vi.mock('../src/shared/settings', () => ({ loadSettings: mocks.loadSettings }));
vi.mock('../src/shared/storage', () => ({
  loadSeenIds: mocks.loadSeenIds,
  saveSeenIds: mocks.saveSeenIds,
  saveResult: mocks.saveResult,
}));
vi.mock('../src/background/badge', () => ({ updateBadge: mocks.updateBadge }));
vi.mock('../src/background/notifications', () => ({ notifyNewMail: mocks.notifyNewMail }));

const SETTINGS: Settings = {
  intervalMinutes: 1,
  notificationsEnabled: true,
  gmailEnabled: true,
  icloudEnabled: true,
  ignoreUnreachableAccounts: false,
};

function item(accountKey: string, id: string): MailItem {
  return {
    id,
    provider: accountKey === 'icloud' ? 'icloud' : 'gmail',
    accountKey,
    from: `送信者 ${id}`,
    subject: `件名 ${id}`,
    snippet: `本文 ${id}`,
    date: '2026-10-20T00:00:00.000Z',
    openUrl: `https://example.com/${id}`,
  };
}

function okAccount(accountKey: string, ids: string[]): AccountState {
  return {
    provider: accountKey === 'icloud' ? 'icloud' : 'gmail',
    accountKey,
    email: `${accountKey}@example.com`,
    status: 'ok',
    unreadCount: ids.length,
    items: ids.map((id) => item(accountKey, id)),
    errorMessage: null,
    errorKind: null,
  };
}

const gmail0 = okAccount('gmail:u/0', ['a', 'b']);
const gmail1 = okAccount('gmail:u/1', ['x']);
const icloud = okAccount('icloud', ['t1']);

/** 呼ばれた順に名前を記録する。 */
let calls: string[];

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  mocks.loadSettings.mockResolvedValue(SETTINGS);
  mocks.discoverGmailAccounts.mockResolvedValue([gmail0, gmail1]);
  mocks.fetchIcloudState.mockResolvedValue(icloud);
  mocks.loadSeenIds.mockResolvedValue({ 'gmail:u/0': ['a', 'b'], 'gmail:u/1': ['x'], icloud: ['t1'] });
  mocks.saveSeenIds.mockImplementation(() => {
    calls.push('saveSeenIds');
    return Promise.resolve();
  });
  mocks.saveResult.mockImplementation(() => {
    calls.push('saveResult');
    return Promise.resolve();
  });
  mocks.updateBadge.mockImplementation(() => {
    calls.push('updateBadge');
    return Promise.resolve();
  });
  mocks.notifyNewMail.mockImplementation(() => {
    calls.push('notifyNewMail');
    return Promise.resolve();
  });
});

/** 外から resolve できる Promise。 */
function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('resolve が設定される前に呼ばれた');
  };
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('runCheck', () => {
  it('両方のプロバイダを並列に実行し、結果をまとめて保存する', async () => {
    const gmail = deferred<AccountState[]>();
    mocks.discoverGmailAccounts.mockReturnValue(gmail.promise);

    const running = runCheck();
    // Gmail の完了を待たずに iCloud も始まっている。
    await vi.waitFor(() => expect(mocks.fetchIcloudState).toHaveBeenCalledTimes(1));
    gmail.resolve([gmail0, gmail1]);
    await running;

    expect(mocks.saveResult).toHaveBeenCalledWith({
      checkedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      accounts: [gmail0, gmail1, icloud],
    });
    expect(mocks.updateBadge).toHaveBeenCalledWith([gmail0, gmail1, icloud]);
  });

  it('一方のプロバイダが reject したら error アカウントにし、もう一方の結果は残す', async () => {
    mocks.discoverGmailAccounts.mockRejectedValue(new Error('Gmail が落ちた'));
    mocks.fetchIcloudState.mockResolvedValue(okAccount('icloud', ['t1', 't2']));

    await runCheck();

    const gmailError: AccountState = {
      provider: 'gmail',
      accountKey: 'gmail:u/0',
      email: null,
      status: 'error',
      unreadCount: 0,
      items: [],
      errorMessage: 'Gmail が落ちた',
      errorKind: null,
    };
    const accounts = [gmailError, okAccount('icloud', ['t1', 't2'])];
    expect(mocks.saveResult).toHaveBeenCalledWith({ checkedAt: expect.any(String), accounts });
    // error の Gmail は前回の既知 id を残し、iCloud は今回の id で上書きする。
    expect(mocks.saveSeenIds).toHaveBeenCalledWith({
      'gmail:u/0': ['a', 'b'],
      'gmail:u/1': ['x'],
      icloud: ['t1', 't2'],
    });
    expect(mocks.notifyNewMail).toHaveBeenCalledWith([{ account: accounts[1], items: [item('icloud', 't2')] }]);
  });

  it('iCloud が Error 以外で reject したら文字列にして errorMessage に入れる', async () => {
    mocks.fetchIcloudState.mockRejectedValue('timeout');

    await runCheck();

    expect(mocks.saveResult).toHaveBeenCalledWith({
      checkedAt: expect.any(String),
      accounts: [
        gmail0,
        gmail1,
        {
          provider: 'icloud',
          accountKey: 'icloud',
          email: null,
          status: 'error',
          unreadCount: 0,
          items: [],
          errorMessage: 'timeout',
          errorKind: null,
        },
      ],
    });
  });

  describe('取得できないアカウントを無視する設定', () => {
    const unreachable: AccountState = {
      provider: 'gmail',
      accountKey: 'gmail:u/2',
      email: null,
      status: 'error',
      unreadCount: 0,
      items: [],
      errorMessage: 'フィードを取得できませんでした: Failed to fetch',
      errorKind: 'unreachable',
    };
    const httpError: AccountState = {
      ...unreachable,
      accountKey: 'gmail:u/3',
      errorMessage: 'HTTP 500',
      errorKind: null,
    };
    const signedOut: AccountState = {
      ...unreachable,
      accountKey: 'gmail:u/4',
      status: 'signedOut',
      errorMessage: null,
      errorKind: null,
    };

    it('ON なら unreachable のアカウントを保存結果とバッジから除き、ok のアカウントは残す', async () => {
      mocks.loadSettings.mockResolvedValue({ ...SETTINGS, ignoreUnreachableAccounts: true });
      const gmail0Empty = okAccount('gmail:u/0', []);
      mocks.discoverGmailAccounts.mockResolvedValue([gmail0Empty, unreachable]);
      mocks.fetchIcloudState.mockResolvedValue(okAccount('icloud', []));

      await runCheck();

      const accounts = [gmail0Empty, okAccount('icloud', [])];
      expect(mocks.saveResult).toHaveBeenCalledWith({ checkedAt: expect.any(String), accounts });
      // 残るのは未読 0 の ok だけなので、バッジは警告にならない。
      expect(mocks.updateBadge).toHaveBeenCalledWith(accounts);
    });

    it('OFF（既定）なら unreachable のアカウントも従来どおり保存結果とバッジに含める', async () => {
      mocks.discoverGmailAccounts.mockResolvedValue([gmail0, unreachable]);

      await runCheck();

      const accounts = [gmail0, unreachable, icloud];
      expect(mocks.saveResult).toHaveBeenCalledWith({ checkedAt: expect.any(String), accounts });
      expect(mocks.updateBadge).toHaveBeenCalledWith(accounts);
    });

    it('ON でも errorKind が null の error、signedOut、reject されたプロバイダの error は除かない', async () => {
      mocks.loadSettings.mockResolvedValue({ ...SETTINGS, ignoreUnreachableAccounts: true });
      mocks.discoverGmailAccounts.mockResolvedValue([httpError, signedOut]);
      mocks.fetchIcloudState.mockRejectedValue(new TypeError('Failed to fetch'));

      await runCheck();

      const icloudError: AccountState = {
        provider: 'icloud',
        accountKey: 'icloud',
        email: null,
        status: 'error',
        unreadCount: 0,
        items: [],
        errorMessage: 'Failed to fetch',
        errorKind: null,
      };
      const accounts = [httpError, signedOut, icloudError];
      expect(mocks.saveResult).toHaveBeenCalledWith({ checkedAt: expect.any(String), accounts });
      expect(mocks.updateBadge).toHaveBeenCalledWith(accounts);
    });

    it('ON で全件を除いたら空の結果を保存してバッジを消し、既知 id は前回の値を残して通知しない', async () => {
      mocks.loadSettings.mockResolvedValue({ ...SETTINGS, ignoreUnreachableAccounts: true, icloudEnabled: false });
      mocks.discoverGmailAccounts.mockResolvedValue([unreachable, { ...unreachable, accountKey: 'gmail:u/3' }]);
      mocks.loadSeenIds.mockResolvedValue({ 'gmail:u/2': ['p'], 'gmail:u/3': ['q'] });

      await runCheck();

      expect(mocks.saveResult).toHaveBeenCalledWith({ checkedAt: expect.any(String), accounts: [] });
      expect(mocks.updateBadge).toHaveBeenCalledWith([]);
      expect(mocks.saveSeenIds).toHaveBeenCalledWith({ 'gmail:u/2': ['p'], 'gmail:u/3': ['q'] });
      expect(mocks.notifyNewMail).not.toHaveBeenCalled();
    });
  });

  it('無効なプロバイダは実行しない', async () => {
    mocks.loadSettings.mockResolvedValue({ ...SETTINGS, icloudEnabled: false });

    await runCheck();

    expect(mocks.fetchIcloudState).not.toHaveBeenCalled();
    expect(mocks.saveResult).toHaveBeenCalledWith({ checkedAt: expect.any(String), accounts: [gmail0, gmail1] });
  });

  it('両方とも無効なら空の結果を保存する', async () => {
    mocks.loadSettings.mockResolvedValue({ ...SETTINGS, gmailEnabled: false, icloudEnabled: false });

    await runCheck();

    expect(mocks.discoverGmailAccounts).not.toHaveBeenCalled();
    expect(mocks.fetchIcloudState).not.toHaveBeenCalled();
    expect(mocks.saveResult).toHaveBeenCalledWith({ checkedAt: expect.any(String), accounts: [] });
    expect(mocks.updateBadge).toHaveBeenCalledWith([]);
  });

  it('初回（既知 id が無い）は通知せず、今回の id を保存する', async () => {
    mocks.loadSeenIds.mockResolvedValue(null);

    await runCheck();

    expect(mocks.notifyNewMail).not.toHaveBeenCalled();
    expect(mocks.saveSeenIds).toHaveBeenCalledWith({ 'gmail:u/0': ['a', 'b'], 'gmail:u/1': ['x'], icloud: ['t1'] });
  });

  it('新着があり通知が ON なら通知する', async () => {
    const gmail0New = okAccount('gmail:u/0', ['c', 'a', 'b']);
    mocks.discoverGmailAccounts.mockResolvedValue([gmail0New, gmail1]);

    await runCheck();

    expect(mocks.notifyNewMail).toHaveBeenCalledWith([{ account: gmail0New, items: [item('gmail:u/0', 'c')] }]);
    expect(calls).toEqual(['saveSeenIds', 'saveResult', 'updateBadge', 'notifyNewMail']);
  });

  it('通知が OFF なら新着があっても通知しない', async () => {
    mocks.loadSettings.mockResolvedValue({ ...SETTINGS, notificationsEnabled: false });
    mocks.discoverGmailAccounts.mockResolvedValue([okAccount('gmail:u/0', ['c']), gmail1]);

    await runCheck();

    expect(mocks.notifyNewMail).not.toHaveBeenCalled();
    expect(mocks.updateBadge).toHaveBeenCalledTimes(1);
  });

  it('新着が無ければ通知しない', async () => {
    await runCheck();

    expect(mocks.notifyNewMail).not.toHaveBeenCalled();
  });

  it('既知 id を結果より先に保存し、その後にバッジを更新する', async () => {
    await runCheck();

    expect(calls).toEqual(['saveSeenIds', 'saveResult', 'updateBadge']);
  });

  it('実行中に呼ばれたら同じ Promise を返し、プロバイダは 1 回だけ実行する', async () => {
    const gmail = deferred<AccountState[]>();
    mocks.discoverGmailAccounts.mockReturnValue(gmail.promise);

    const first = runCheck();
    const second = runCheck();
    expect(second).toBe(first);
    gmail.resolve([gmail0, gmail1]);
    await Promise.all([first, second]);

    expect(mocks.discoverGmailAccounts).toHaveBeenCalledTimes(1);
    expect(mocks.fetchIcloudState).toHaveBeenCalledTimes(1);
    expect(mocks.saveResult).toHaveBeenCalledTimes(1);
  });

  it('実行中に rerunIfInFlight で呼ばれたら、完了後に最新の設定でもう一度実行し、返した Promise はその完了まで待つ', async () => {
    // 実行中のチェックは変更前の設定（OFF）を読んでいる。実行中に ON へ変えた場合を再現する。
    const unreachable: AccountState = {
      ...okAccount('gmail:u/2', []),
      email: null,
      status: 'error',
      errorMessage: 'フィードを取得できませんでした: Failed to fetch',
      errorKind: 'unreachable',
    };
    const gmail = deferred<AccountState[]>();
    mocks.discoverGmailAccounts.mockReturnValueOnce(gmail.promise).mockResolvedValueOnce([gmail0, unreachable]);

    const first = runCheck();
    mocks.loadSettings.mockResolvedValue({ ...SETTINGS, ignoreUnreachableAccounts: true });
    const second = runCheck({ rerunIfInFlight: true });
    expect(second).toBe(first);
    // check() は設定を読んでからプロバイダを呼ぶので、呼ばれるまで待つ。
    await vi.waitFor(() => expect(mocks.discoverGmailAccounts).toHaveBeenCalledTimes(1));

    gmail.resolve([gmail0, unreachable]);
    await first;

    expect(mocks.discoverGmailAccounts).toHaveBeenCalledTimes(2);
    expect(mocks.saveResult).toHaveBeenCalledTimes(2);
    expect(mocks.saveResult.mock.calls[0]?.[0].accounts.map((account) => account.accountKey)).toEqual([
      'gmail:u/0',
      'gmail:u/2',
      'icloud',
    ]);
    expect(mocks.saveResult.mock.calls[1]?.[0].accounts.map((account) => account.accountKey)).toEqual([
      'gmail:u/0',
      'icloud',
    ]);
  });

  it('rerunIfInFlight 無しで実行中に呼ばれても、完了後の再実行はしない', async () => {
    const gmail = deferred<AccountState[]>();
    mocks.discoverGmailAccounts.mockReturnValueOnce(gmail.promise);

    const first = runCheck();
    runCheck();
    gmail.resolve([gmail0]);
    await first;
    await Promise.resolve();

    expect(mocks.discoverGmailAccounts).toHaveBeenCalledTimes(1);
  });

  it('実行中でなければ rerunIfInFlight があっても 1 回だけ実行する', async () => {
    await runCheck({ rerunIfInFlight: true });
    expect(mocks.discoverGmailAccounts).toHaveBeenCalledTimes(1);
  });

  it('再実行を予約したチェックが失敗したら予約を捨て、失敗を伝える', async () => {
    const gmail = deferred<AccountState[]>();
    mocks.discoverGmailAccounts.mockReturnValueOnce(gmail.promise);
    mocks.saveResult.mockRejectedValueOnce(new Error('保存失敗'));

    const first = runCheck();
    runCheck({ rerunIfInFlight: true });
    gmail.resolve([gmail0]);
    await expect(first).rejects.toThrow('保存失敗');

    await runCheck();
    // 失敗したチェック 1 回と、その後の通常の 1 回だけ。予約分は実行しない。
    expect(mocks.discoverGmailAccounts).toHaveBeenCalledTimes(2);
  });

  it('完了した後に呼ばれたら、もう一度実行する', async () => {
    const first = runCheck();
    await first;
    const second = runCheck();
    expect(second).not.toBe(first);
    await second;

    expect(mocks.discoverGmailAccounts).toHaveBeenCalledTimes(2);
  });

  it('設定の読み込みに失敗したら reject し、何も保存しない', async () => {
    mocks.loadSettings.mockRejectedValue(new Error('設定の検証に失敗'));

    await expect(runCheck()).rejects.toThrow('設定の検証に失敗');
    expect(mocks.discoverGmailAccounts).not.toHaveBeenCalled();
    expect(mocks.saveResult).not.toHaveBeenCalled();
  });

  it('失敗した後に呼ばれたら、もう一度実行する', async () => {
    mocks.loadSettings.mockRejectedValueOnce(new Error('一時的な失敗'));
    await expect(runCheck()).rejects.toThrow('一時的な失敗');

    await runCheck();

    expect(mocks.saveResult).toHaveBeenCalledTimes(1);
  });

  it('保存に失敗したら reject する', async () => {
    mocks.saveResult.mockRejectedValue(new Error('保存失敗'));

    await expect(runCheck()).rejects.toThrow('保存失敗');
    expect(mocks.updateBadge).not.toHaveBeenCalled();
  });

  it('通知に失敗したら reject する', async () => {
    mocks.discoverGmailAccounts.mockResolvedValue([okAccount('gmail:u/0', ['c']), gmail1]);
    mocks.notifyNewMail.mockRejectedValue(new Error('通知失敗'));

    await expect(runCheck()).rejects.toThrow('通知失敗');
  });
});
