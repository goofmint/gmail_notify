import { XMLParser, type X2jOptions } from 'fast-xml-parser';
import * as z from 'zod';
import { GMAIL_MESSAGE_URL } from '../shared/constants';
import type { MailItem } from '../shared/types';
import { GmailFeedSchema } from './schemas';

/** パーサの結果。AccountState への組み立ては gmail.ts で行う。 */
export type GmailFeed = {
  email: string;
  unreadCount: number;
  items: MailItem[];
};

const EMAIL_PATTERN = /[^\s<>]+@[^\s<>]+/; // 空白と山括弧を除いた「@」の前後をメールアドレスとみなす
const MESSAGE_ID_PATTERN = /[?&]message_id=([^&#]+)/;

const parserOptions: X2jOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // 数値への自動変換を止める。数値化は GmailFeedSchema で行う。
  parseTagValue: false,
  // entry は 1 件だとオブジェクトになるので、常に配列にする。jPath は既定（true）で文字列になる。
  isArray: (_tagName, jPath) => jPath === 'feed.entry',
  trimValues: true,
};

/** XML をパースして GmailFeedSchema の safeParse 結果を返す。不正な XML は例外。 */
function parseAndValidate(xml: string) {
  try {
    // parse の戻り値は any。変数に受けず、そのまま safeParse に渡す（library-notes §9）。
    return GmailFeedSchema.safeParse(new XMLParser(parserOptions).parse(xml, true));
  } catch (error) {
    throw new Error(`Gmail フィードの XML を解析できない: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

/** XML をパースして GmailFeedSchema で検証する。不正な XML や形式違いは例外。 */
function parseDocument(xml: string) {
  const result = parseAndValidate(xml);
  if (!result.success) {
    throw new Error(`Gmail フィードの形式が想定と違う: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/** アカウント n の Atom フィードを解析する（設計 §6.3）。必須の値が欠けていたら例外。 */
export function parseGmailFeed(xml: string, n: number): GmailFeed {
  const { feed } = parseDocument(xml);

  const email = EMAIL_PATTERN.exec(feed.title)?.[0];
  if (email === undefined) {
    throw new Error(`Gmail フィードの title にメールアドレスが無い: ${feed.title}`);
  }

  const accountKey = `gmail:u/${n}`;
  const items = feed.entry.map((entry): MailItem => {
    const id = MESSAGE_ID_PATTERN.exec(entry.link['@_href'])?.[1];
    if (id === undefined) {
      throw new Error(`Gmail フィードの link に message_id が無い: ${entry.link['@_href']}`);
    }
    const name = entry.author.name;
    return {
      id,
      provider: 'gmail',
      accountKey,
      from: name === undefined || name === '' ? entry.author.email : name,
      subject: entry.title,
      snippet: entry.summary,
      date: entry.issued,
      openUrl: GMAIL_MESSAGE_URL(n, id),
    };
  });

  return { email, unreadCount: Math.max(feed.fullcount, items.length), items };
}
