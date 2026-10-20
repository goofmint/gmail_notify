/** メールの提供元。 */
export type Provider = 'gmail' | 'icloud';

/** アカウントの状態。ok は取得成功、signedOut は未ログイン、error はそれ以外の失敗。 */
export type AccountStatus = 'ok' | 'signedOut' | 'error';

/** 未読メール 1 件。 */
export type MailItem = {
  /** gmail は message_id（16 進）、icloud は threadId。 */
  id: string;
  provider: Provider;
  /** gmail は `gmail:u/{n}`（例: `gmail:u/0`）、icloud は `icloud`。 */
  accountKey: string;
  from: string;
  subject: string;
  snippet: string;
  /** ISO8601 形式の日時。 */
  date: string;
  /** クリック時に開く URL。 */
  openUrl: string;
};

/** 1 アカウント分のチェック結果。 */
export type AccountState = {
  provider: Provider;
  /** MailItem.accountKey と同じ形式。 */
  accountKey: string;
  /** メールアドレス。status が signedOut のときは null。 */
  email: string | null;
  status: AccountStatus;
  unreadCount: number;
  items: MailItem[];
  /** status が error のときの理由。それ以外は null。 */
  errorMessage: string | null;
};

/** 1 回のチェック全体の結果。 */
export type CheckResult = {
  /** チェックした日時（ISO8601）。 */
  checkedAt: string;
  accounts: AccountState[];
};

/** ユーザー設定。 */
export type Settings = {
  /** チェック間隔（分）。0.5 以上。 */
  intervalMinutes: number;
  notificationsEnabled: boolean;
  gmailEnabled: boolean;
  icloudEnabled: boolean;
};
