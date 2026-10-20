/** popup から Service Worker へ、すぐにチェックするよう依頼する。 */
export type CheckNowMessage = { type: 'check-now' };

/** check-now の応答。runCheck の完了だけを伝え、結果は storage から読む。 */
export type CheckNowResponse = { done: true };

/** runtime.onMessage で受け取るメッセージ。type で分岐する。 */
export type RuntimeMessage = CheckNowMessage;
