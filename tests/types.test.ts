import { describe, expectTypeOf, it } from 'vitest';
import type {
  AccountState,
  AccountStatus,
  CheckResult,
  MailItem,
  Provider,
  Settings,
} from '../src/shared/types';

describe('types', () => {
  it('Provider は gmail と icloud だけ', () => {
    expectTypeOf<Provider>().toEqualTypeOf<'gmail' | 'icloud'>();
    // @ts-expect-error 未定義のプロバイダは代入できない
    const invalid: Provider = 'yahoo';
    void invalid;
  });

  it('AccountStatus は ok、signedOut、error だけ', () => {
    expectTypeOf<AccountStatus>().toEqualTypeOf<'ok' | 'signedOut' | 'error'>();
    // @ts-expect-error 未定義の状態は代入できない
    const invalid: AccountStatus = 'unknownStatus';
    void invalid;
  });

  it('MailItem の形', () => {
    expectTypeOf<MailItem>().toEqualTypeOf<{
      id: string;
      provider: Provider;
      accountKey: string;
      from: string;
      subject: string;
      snippet: string;
      date: string;
      openUrl: string;
    }>();
  });

  it('AccountState の形', () => {
    expectTypeOf<AccountState>().toEqualTypeOf<{
      provider: Provider;
      accountKey: string;
      email: string | null;
      status: AccountStatus;
      unreadCount: number;
      items: MailItem[];
      errorMessage: string | null;
    }>();
  });

  it('signedOut の AccountState は email に null を持てる', () => {
    const signedOut: AccountState = {
      provider: 'gmail',
      accountKey: 'gmail:u/0',
      email: null,
      status: 'signedOut',
      unreadCount: 0,
      items: [],
      errorMessage: null,
    };
    expectTypeOf(signedOut).toEqualTypeOf<AccountState>();
  });

  it('不正な status の AccountState は作れない', () => {
    const invalid: AccountState = {
      provider: 'icloud',
      accountKey: 'icloud',
      email: 'user@icloud.com',
      // @ts-expect-error 未定義の状態は代入できない
      status: 'unknownStatus',
      unreadCount: 0,
      items: [],
      errorMessage: null,
    };
    void invalid;
  });

  it('CheckResult の形', () => {
    expectTypeOf<CheckResult>().toEqualTypeOf<{ checkedAt: string; accounts: AccountState[] }>();
  });

  it('Settings の形', () => {
    expectTypeOf<Settings>().toEqualTypeOf<{
      intervalMinutes: number;
      notificationsEnabled: boolean;
      gmailEnabled: boolean;
      icloudEnabled: boolean;
      ignoreUnreachableAccounts: boolean;
    }>();
  });

  it('Settings の項目は省略できない', () => {
    // @ts-expect-error icloudEnabled が欠けている
    const invalid: Settings = { intervalMinutes: 1, notificationsEnabled: true, gmailEnabled: true };
    void invalid;
  });
});
