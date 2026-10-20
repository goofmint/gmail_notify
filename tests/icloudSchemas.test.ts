import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { GeqsSchema, ThreadSearchSchema, ValidateSchema } from '../src/providers/schemas';
import geqsFixture from './fixtures/icloud/geqs.json' with { type: 'json' };
import threadSearchFixture from './fixtures/icloud/thread-search.json' with { type: 'json' };
import validateFixture from './fixtures/icloud/validate.json' with { type: 'json' };

type ThreadInput = z.input<typeof ThreadSearchSchema>['threadList'][number];
type MailboxInput = z.input<typeof GeqsSchema>['domainObjects'][number];

const thread: ThreadInput = {
  threadId: 'thread-1',
  senders: ['Hanako <hanako@example.com>'],
  subject: '件名',
  preview: '本文の抜粋',
  timestamp: 1792461600000,
  flags: [],
};

const inbox: MailboxInput = { name: 'INBOX', unseenCount: 2 };

describe('ValidateSchema', () => {
  it('fixture を受け付け、使う値だけを残す', () => {
    const result = ValidateSchema.safeParse(validateFixture);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      dsInfo: { dsid: '12345678901', primaryEmail: 'taro@icloud.example' },
      webservices: { mccgateway: { url: 'https://p123-mccgateway.icloud.com:443' } },
    });
  });

  it('dsInfo.dsid が無ければ失敗する', () => {
    const input = { ...validateFixture, dsInfo: { primaryEmail: 'taro@icloud.example' } };
    expect(ValidateSchema.safeParse(input).success).toBe(false);
  });

  it('dsInfo.dsid が数値なら失敗する', () => {
    const input = { ...validateFixture, dsInfo: { ...validateFixture.dsInfo, dsid: 12345678901 } };
    expect(ValidateSchema.safeParse(input).success).toBe(false);
  });

  it('dsInfo.primaryEmail が無ければ失敗する', () => {
    const input = { ...validateFixture, dsInfo: { dsid: '12345678901' } };
    expect(ValidateSchema.safeParse(input).success).toBe(false);
  });

  it('webservices.mccgateway.url が無ければ失敗する', () => {
    const input = { ...validateFixture, webservices: { mccgateway: {} } };
    expect(ValidateSchema.safeParse(input).success).toBe(false);
  });
});

describe('GeqsSchema', () => {
  it('fixture を受け付け、name と unseenCount だけを残す', () => {
    const result = GeqsSchema.safeParse(geqsFixture);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      domainObjects: [
        { name: 'INBOX', unseenCount: 2 },
        { name: 'Junk', unseenCount: 5 },
        { name: 'Deleted Messages', unseenCount: 0 },
      ],
    });
  });

  it('INBOX を含まない応答も受け付ける（INBOX の判定は icloud.ts で行う）', () => {
    expect(GeqsSchema.safeParse({ domainObjects: [{ name: 'Junk', unseenCount: 1 }] }).success).toBe(true);
  });

  it('domainObjects が無ければ失敗する', () => {
    expect(GeqsSchema.safeParse({}).success).toBe(false);
  });

  it.each([-1, 1.5, '2', null])('unseenCount が %j なら失敗する', (unseenCount) => {
    expect(GeqsSchema.safeParse({ domainObjects: [{ ...inbox, unseenCount }] }).success).toBe(false);
  });

  it('unseenCount が無い要素（ラベルなど）は受け付け、unseenCount は undefined になる', () => {
    const result = GeqsSchema.safeParse({ domainObjects: [{ name: 'Work' }] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.domainObjects[0]).toEqual({ name: 'Work' });
    }
  });

  it('name が無ければ失敗する', () => {
    expect(GeqsSchema.safeParse({ domainObjects: [{ unseenCount: 2 }] }).success).toBe(false);
  });
});

describe('ThreadSearchSchema', () => {
  it('fixture を受け付け、使う値だけを残す', () => {
    const result = ThreadSearchSchema.safeParse(threadSearchFixture);
    expect(result.success).toBe(true);
    expect(result.data?.threadList).toHaveLength(3);
    expect(result.data?.threadList[2]).toEqual({
      threadId: 'thread-c3',
      senders: ['News <news@example.com>'],
      subject: '今週のお知らせ',
      preview: '既読のメールです。',
      timestamp: 1792454400000,
      flags: ['\\Seen'],
    });
  });

  it('未知キーを除去する', () => {
    const result = ThreadSearchSchema.safeParse({ threadList: [{ ...thread, messageCount: 1 }], extra: true });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ threadList: [thread] });
  });

  it('threadList が空でも受け付ける', () => {
    expect(ThreadSearchSchema.safeParse({ threadList: [] }).success).toBe(true);
  });

  it('senders が空配列なら失敗する', () => {
    expect(ThreadSearchSchema.safeParse({ threadList: [{ ...thread, senders: [] }] }).success).toBe(false);
  });

  it('flags が無ければ失敗する', () => {
    const noFlags = {
      threadId: thread.threadId,
      senders: thread.senders,
      subject: thread.subject,
      preview: thread.preview,
      timestamp: thread.timestamp,
    };
    expect(ThreadSearchSchema.safeParse({ threadList: [noFlags] }).success).toBe(false);
  });

  it.each(['1792461600000', -1, 1.5])('timestamp が %j なら失敗する', (timestamp) => {
    expect(ThreadSearchSchema.safeParse({ threadList: [{ ...thread, timestamp }] }).success).toBe(false);
  });

  it('threadList が無ければ失敗する', () => {
    expect(ThreadSearchSchema.safeParse({}).success).toBe(false);
  });
});
