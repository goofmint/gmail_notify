import { describe, expect, it } from 'vitest';
import { GmailFeedSchema } from '../src/providers/schemas';

const entry = {
  title: '件名',
  summary: '本文の抜粋',
  link: { '@_href': 'https://mail.google.com/mail?account_id=a@b.com&message_id=18f0a1b2c3d4e5f6&view=conv' },
  issued: '2026-10-20T01:02:03Z',
  author: { name: 'Bob', email: 'bob@example.com' },
};

function feedWith(feed: Record<string, string | (typeof entry)[]>) {
  return { feed: { title: 'Gmail - Inbox for a@b.com', fullcount: '1', entry: [entry], ...feed } };
}

describe('GmailFeedSchema', () => {
  it('正しい形のフィードを受け付け、fullcount を数値にする', () => {
    const result = GmailFeedSchema.safeParse(feedWith({}));
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ feed: { title: 'Gmail - Inbox for a@b.com', fullcount: 1, entry: [entry] } });
  });

  it('entry キーが無ければ空配列にする', () => {
    const result = GmailFeedSchema.safeParse({ feed: { title: 'Gmail - Inbox for a@b.com', fullcount: '0' } });
    expect(result.success).toBe(true);
    expect(result.data?.feed.entry).toEqual([]);
  });

  it.each(['', 'abc', '-1', '1.5'])('fullcount が %j なら失敗する', (fullcount) => {
    expect(GmailFeedSchema.safeParse(feedWith({ fullcount })).success).toBe(false);
  });

  it('fullcount が無ければ失敗する', () => {
    expect(GmailFeedSchema.safeParse({ feed: { title: 'Gmail - Inbox for a@b.com', entry: [] } }).success).toBe(false);
  });

  it('author.email が無ければ失敗する', () => {
    const noEmail = { ...entry, author: { name: 'Bob' } };
    const result = GmailFeedSchema.safeParse({ feed: { title: 't', fullcount: '1', entry: [noEmail] } });
    expect(result.success).toBe(false);
  });

  it('author.name が無くても受け付ける', () => {
    const noName = { ...entry, author: { email: 'bob@example.com' } };
    const result = GmailFeedSchema.safeParse({ feed: { title: 't', fullcount: '1', entry: [noName] } });
    expect(result.success).toBe(true);
    expect(result.data?.feed.entry[0]?.author).toEqual({ email: 'bob@example.com' });
  });

  it('link の href が無ければ失敗する', () => {
    const noHref = { ...entry, link: {} };
    expect(GmailFeedSchema.safeParse({ feed: { title: 't', fullcount: '1', entry: [noHref] } }).success).toBe(false);
  });
});
