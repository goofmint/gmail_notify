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

// ---- iCloud ----
// 応答の形は公開されている拡張機能の実装に基づく（2026-10 時点）。
// https://github.com/Yang-Nankai/ExPGuard/blob/main/datasets/firefox/%7Bc98e042b-917d-4bdb-b125-dd3ace21ab71%7D_4.0.1/Source/js/scripts/icloud.js
// 実際の応答で確認したものではないため、T6-3 の実機テストで確定する。
// 未知キーは z.object の既定動作で除去する。後続の処理が使うフィールドだけを必須にする。

/** setup/ws/1/validate の応答。上記の実装は `"dsid":"(\d+)"` で読むので、dsid は文字列。 */
export const ValidateSchema = z.object({
  dsInfo: z.object({
    dsid: z.string().min(1),
    primaryEmail: z.string().min(1),
  }),
  webservices: z.object({
    // 末尾に `:443` が付くことがある。除去は icloud.ts で行う。
    mccgateway: z.object({ url: z.string().min(1) }),
  }),
});

export type IcloudValidate = z.infer<typeof ValidateSchema>;

/**
 * mailws2/v1/geqs/query（domain: mailbox）の応答。mailbox の一覧は domainObjects に入る。
 * INBOX の有無はここでは判定しない（icloud.ts の責務）。
 * 未確認: includeLabels: true のときに unseenCount を持たない要素（ラベル）が含まれる可能性があるため、unseenCount は optional にする。
 * INBOX に unseenCount が無い場合は icloud.ts で明示的にエラーにする。T6-3 の実機テストで確定する。
 */
export const GeqsSchema = z.object({
  domainObjects: z.array(
    z.object({
      name: z.string(),
      unseenCount: z.number().int().nonnegative().optional(),
    }),
  ),
});

export type IcloudGeqs = z.infer<typeof GeqsSchema>;

/** mailws2/v1/thread/search（responseType: THREAD_DIGEST）のスレッド 1 件。 */
export const IcloudThreadSchema = z.object({
  threadId: z.string().min(1),
  // 設計 §7.2: from に senders[0] を使うので、空配列はスキーマエラーにする。
  senders: z.array(z.string()).min(1),
  subject: z.string(),
  preview: z.string(),
  /** ミリ秒。 */
  timestamp: z.number().int().nonnegative(),
  // 欠落を既読扱いにも未読扱いにもしないため必須にする。既読なら `\Seen` を含む。
  flags: z.array(z.string()),
});

export type IcloudThread = z.infer<typeof IcloudThreadSchema>;

/** mailws2/v1/thread/search の応答。スレッドの一覧は threadList に入る。 */
export const ThreadSearchSchema = z.object({
  threadList: z.array(IcloudThreadSchema),
});

export type IcloudThreadSearch = z.infer<typeof ThreadSearchSchema>;
