import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseGmailFeed } from '../src/providers/gmailParser';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/gmail/${name}`, import.meta.url), 'utf8');
}

describe('parseGmailFeed', () => {
  it('0 件のフィードはメールアドレスと 0 件を返す', () => {
    expect(parseGmailFeed(fixture('feed-0.xml'), 0)).toEqual({ email: 'user@gmail.com', unreadCount: 0, items: [] });
  });

  it('1 件のフィードは全フィールドを取り出す', () => {
    expect(parseGmailFeed(fixture('feed-1.xml'), 2)).toEqual({
      email: 'user@gmail.com',
      unreadCount: 1,
      items: [
        {
          id: '18f0a1b2c3d4e5f6',
          provider: 'gmail',
          accountKey: 'gmail:u/2',
          from: '山田 太郎',
          subject: '会議の件',
          snippet: '明日の会議は 10 時からです & よろしくお願いします',
          date: '2026-10-20T00:58:00Z',
          openUrl: 'https://mail.google.com/mail/u/2/#inbox/18f0a1b2c3d4e5f6',
        },
      ],
    });
  });

  describe('複数件のフィード', () => {
    const feed = parseGmailFeed(fixture('feed-3.xml'), 0);

    it('フィードの順序を保つ', () => {
      expect(feed.items.map((item) => item.id)).toEqual(['18f0000000000003', '18f0000000000002', '18f0000000000001']);
      expect(feed.items.map((item) => item.subject)).toEqual(['3 通目', '2 通目', '1 通目']);
    });

    it('author に name が無ければ email を from にする', () => {
      expect(feed.items.map((item) => item.from)).toEqual(['Alice', 'noname@example.com', 'Carol']);
    });

    it('unreadCount は fullcount と件数の大きい方になる', () => {
      expect(feed.items).toHaveLength(3);
      expect(feed.unreadCount).toBe(5);
    });

    it('fullcount が件数より小さければ件数を使う', () => {
      const xml = fixture('feed-3.xml').replace('<fullcount>5</fullcount>', '<fullcount>1</fullcount>');
      expect(parseGmailFeed(xml, 0).unreadCount).toBe(3);
    });
  });

  describe('不正なフィード', () => {
    it('title にメールアドレスが無ければ例外', () => {
      expect(() => parseGmailFeed(fixture('feed-no-email-title.xml'), 0)).toThrow(
        'Gmail フィードの title にメールアドレスが無い: Gmail - Inbox',
      );
    });

    it('link に message_id が無ければ例外', () => {
      expect(() => parseGmailFeed(fixture('feed-no-message-id.xml'), 0)).toThrow(
        'Gmail フィードの link に message_id が無い',
      );
    });

    it('XML が壊れていれば元のエラーを含めて例外', () => {
      expect(() => parseGmailFeed(fixture('feed-invalid.xml'), 0)).toThrow(
        /^Gmail フィードの XML を解析できない: .*closing tag/,
      );
    });

    it('必須の要素が欠けていれば例外', () => {
      const xml = fixture('feed-1.xml').replace(/<issued>.*<\/issued>/, '');
      expect(() => parseGmailFeed(xml, 0)).toThrow('Gmail フィードの形式が想定と違う');
    });

    it('fullcount が数字でなければ例外', () => {
      const xml = fixture('feed-1.xml').replace('<fullcount>1</fullcount>', '<fullcount></fullcount>');
      expect(() => parseGmailFeed(xml, 0)).toThrow('Gmail フィードの形式が想定と違う');
    });
  });
});
