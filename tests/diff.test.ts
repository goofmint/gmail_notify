import { describe, expect, it } from 'vitest';
import { detectNewMail, nextSeenIds } from '../src/background/diff';
import type { AccountState, AccountStatus, MailItem, SeenIds } from '../src/shared/types';

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

function account(accountKey: string, ids: string[], status: AccountStatus = 'ok'): AccountState {
  return {
    provider: accountKey === 'icloud' ? 'icloud' : 'gmail',
    accountKey,
    email: status === 'signedOut' ? null : `${accountKey}@example.com`,
    status,
    unreadCount: ids.length,
    items: ids.map((id) => item(accountKey, id)),
    errorMessage: status === 'error' ? '取得に失敗' : null,
    errorKind: null,
  };
}

describe('detectNewMail', () => {
  it('初回（prevSeen が null）は新着なし', () => {
    expect(detectNewMail(null, [account('gmail:u/0', ['a', 'b'])])).toEqual([]);
  });

  it('前回に無かったアカウントは新着の対象外', () => {
    const prev: SeenIds = { 'gmail:u/0': ['a'] };
    expect(detectNewMail(prev, [account('gmail:u/0', ['a']), account('gmail:u/1', ['x', 'y'])])).toEqual([]);
  });

  it('前回の id に無いものだけを、アカウントの順で返す', () => {
    const gmail = account('gmail:u/0', ['c', 'a', 'b']);
    const icloud = account('icloud', ['t2', 't1']);
    const prev: SeenIds = { icloud: ['t1'], 'gmail:u/0': ['a', 'b'] };
    expect(detectNewMail(prev, [gmail, icloud])).toEqual([
      { account: gmail, items: [item('gmail:u/0', 'c')] },
      { account: icloud, items: [item('icloud', 't2')] },
    ]);
  });

  it('新着が無いアカウントはグループに含めない', () => {
    const prev: SeenIds = { 'gmail:u/0': ['a'], icloud: [] };
    const icloud = account('icloud', ['t1']);
    expect(detectNewMail(prev, [account('gmail:u/0', ['a']), icloud])).toEqual([
      { account: icloud, items: [item('icloud', 't1')] },
    ]);
  });

  it('ok 以外のアカウントは新着の対象外', () => {
    const prev: SeenIds = { 'gmail:u/0': [], icloud: [] };
    const accounts = [account('gmail:u/0', ['a'], 'error'), account('icloud', ['t1'], 'signedOut')];
    expect(detectNewMail(prev, accounts)).toEqual([]);
  });

  it('同じ id が複数あっても、前回の id にあれば新着にしない', () => {
    const prev: SeenIds = { 'gmail:u/0': ['a', 'a'] };
    expect(detectNewMail(prev, [account('gmail:u/0', ['a', 'a'])])).toEqual([]);
  });

  it('prevSeen に継承されたプロパティ名と同じ accountKey は新しいアカウントとして扱う', () => {
    expect(detectNewMail({}, [account('constructor', ['a'])])).toEqual([]);
  });
});

describe('nextSeenIds', () => {
  it('accountKey が __proto__ でも own property として保存し、detectNewMail が既知アカウントと認識する', () => {
    const next = nextSeenIds({}, [account('__proto__', ['a'])]);
    expect(Object.hasOwn(next, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(next, '__proto__')?.value).toEqual(['a']);
    const groups = detectNewMail(next, [account('__proto__', ['a', 'b'])]);
    expect(groups.map((group) => group.items.map((mail) => mail.id))).toEqual([['b']]);
  });

  it('初回は ok のアカウントの id だけを保存する', () => {
    const accounts = [account('gmail:u/0', ['a', 'b']), account('icloud', ['t1'], 'error')];
    expect(nextSeenIds(null, accounts)).toEqual({ 'gmail:u/0': ['a', 'b'] });
  });

  it('ok のアカウントは今回の id で上書きする', () => {
    const prev: SeenIds = { 'gmail:u/0': ['a', 'b'] };
    expect(nextSeenIds(prev, [account('gmail:u/0', ['c'])])).toEqual({ 'gmail:u/0': ['c'] });
  });

  it('error と signedOut のアカウントは前回の値を残す', () => {
    const prev: SeenIds = { 'gmail:u/0': ['a'], icloud: ['t1'] };
    const accounts = [account('gmail:u/0', [], 'error'), account('icloud', [], 'signedOut')];
    expect(nextSeenIds(prev, accounts)).toEqual({ 'gmail:u/0': ['a'], icloud: ['t1'] });
  });

  it('今回現れなかったアカウントは前回の値を残す', () => {
    const prev: SeenIds = { 'gmail:u/0': ['a'], 'gmail:u/1': ['x'] };
    expect(nextSeenIds(prev, [account('gmail:u/0', ['b'])])).toEqual({ 'gmail:u/0': ['b'], 'gmail:u/1': ['x'] });
  });

  it('同じ id が複数あってもそのまま保存する', () => {
    expect(nextSeenIds({}, [account('gmail:u/0', ['a', 'a'])])).toEqual({ 'gmail:u/0': ['a', 'a'] });
  });

  it('prevSeen を書き換えない', () => {
    const prev: SeenIds = { 'gmail:u/0': ['a'] };
    nextSeenIds(prev, [account('gmail:u/0', ['b'])]);
    expect(prev).toEqual({ 'gmail:u/0': ['a'] });
  });
});
