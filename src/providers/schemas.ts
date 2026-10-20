import * as z from 'zod';

/** Gmail Atom フィードの entry 1 件。fast-xml-parser の出力（属性は `@_` 付きのキー）を検証する。 */
export const GmailEntrySchema = z.object({
  title: z.string(),
  summary: z.string(),
  link: z.object({ '@_href': z.string() }),
  issued: z.string(),
  // 設計 §6.3: name が無ければ email を使う。
  author: z.object({ name: z.string().optional(), email: z.string() }),
});

export type GmailEntry = z.infer<typeof GmailEntrySchema>;

/** Gmail Atom フィード全体。parseTagValue: false でパースするため、数値も文字列で届く。 */
export const GmailFeedSchema = z.object({
  feed: z.object({
    title: z.string(),
    // z.coerce.number() は '' を 0 にするため使わない。数字だけの文字列に限る。
    fullcount: z.string().regex(/^\d+$/).transform(Number),
    // 未読 0 件のフィードには <entry> が無い。これは正規の「0 件」なので空配列にする。
    entry: z.array(GmailEntrySchema).default([]),
  }),
});

export type GmailFeedDocument = z.infer<typeof GmailFeedSchema>;
