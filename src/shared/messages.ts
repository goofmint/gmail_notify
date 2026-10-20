/** popup から Service Worker へ、すぐにチェックするよう依頼する。 */
export type CheckNowMessage = { type: 'check-now' };

/** check-now の応答。runCheck の成否だけを伝え、結果は storage から読む。失敗時は理由を返す。 */
export type CheckNowResponse = { ok: true } | { ok: false; error: string };

/** runtime.onMessage で受け取るメッセージ。type で分岐する。 */
export type RuntimeMessage = CheckNowMessage;
