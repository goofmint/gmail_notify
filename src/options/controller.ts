import { INTERVAL_OPTIONS_MINUTES } from '../shared/constants';
import type { Settings } from '../shared/types';

// 設定画面の動作（設計 §10）。storage は deps で受け取り、テストでは差し替える。
// 設定の変更を background に反映するのは background 側の storage.onChanged が担う。

/** 状態表示の文言。 */
export const OPTIONS_TEXT = {
  loading: '読み込み中…',
  saving: '保存中…',
  saved: '保存しました',
  loadFailed: '設定を読み込めませんでした',
  saveFailed: '保存できませんでした',
  noInterval: 'チェック間隔を選んでください',
  unknownInterval: (minutes: number): string =>
    `保存されているチェック間隔（${minutes} 分）は選択肢にありません。チェック間隔を選び直してください`,
} as const;

export type OptionsElements = {
  form: HTMLFormElement;
  intervalMinutes: HTMLSelectElement;
  notificationsEnabled: HTMLInputElement;
  gmailEnabled: HTMLInputElement;
  icloudEnabled: HTMLInputElement;
  status: HTMLElement;
};

export type OptionsDeps = {
  loadSettings: () => Promise<Settings>;
  saveSettings: (settings: Settings) => Promise<void>;
  elements: OptionsElements;
};

/** 選択肢の表示名。1 分未満は秒で表す。 */
export function intervalLabel(minutes: number): string {
  return minutes < 1 ? `${minutes * 60} 秒` : `${minutes} 分`;
}

function findIntervalOption(minutes: number): number | undefined {
  return INTERVAL_OPTIONS_MINUTES.find((option) => option === minutes);
}

/** 設定画面を起動する。読み込みが終わるまで入力を無効にし、変更のたびにフォーム全体を保存する。 */
export async function startOptions(deps: OptionsDeps): Promise<void> {
  const { elements } = deps;
  const controls = [
    elements.intervalMinutes,
    elements.notificationsEnabled,
    elements.gmailEnabled,
    elements.icloudEnabled,
  ];
  // 保存が重なったとき、最後に始めた保存の結果だけを表示する。
  let saveSeq = 0;
  // 保存は 1 件ずつ順に行う。古い保存が遅れて終わり、新しい設定を上書きするのを防ぐ。
  let saveQueue: Promise<void> = Promise.resolve();

  function showStatus(text: string, isError: boolean): void {
    elements.status.textContent = text;
    elements.status.classList.toggle('error', isError);
  }

  function setDisabled(disabled: boolean): void {
    for (const control of controls) {
      control.disabled = disabled;
    }
  }

  /** フォームの値を Settings にする。チェック間隔が選ばれていなければ例外。 */
  function readForm(): Settings {
    const intervalMinutes = findIntervalOption(Number(elements.intervalMinutes.value));
    if (elements.intervalMinutes.value === '' || intervalMinutes === undefined) {
      throw new Error(OPTIONS_TEXT.noInterval);
    }
    return {
      intervalMinutes,
      notificationsEnabled: elements.notificationsEnabled.checked,
      gmailEnabled: elements.gmailEnabled.checked,
      icloudEnabled: elements.icloudEnabled.checked,
    };
  }

  async function save(): Promise<void> {
    const seq = ++saveSeq;
    let settings: Settings;
    try {
      settings = readForm();
    } catch (error) {
      showStatus(error instanceof Error ? error.message : String(error), true);
      return;
    }
    showStatus(OPTIONS_TEXT.saving, false);
    const saving = saveQueue.then(() => deps.saveSettings(settings));
    // 前の保存が失敗しても次の保存は行う。失敗の表示は各 save の catch が担う。
    saveQueue = saving.catch(() => {});
    try {
      await saving;
      if (seq === saveSeq) {
        showStatus(OPTIONS_TEXT.saved, false);
      }
    } catch (error) {
      if (seq === saveSeq) {
        showStatus(`${OPTIONS_TEXT.saveFailed}: ${error instanceof Error ? error.message : String(error)}`, true);
      }
    }
  }

  setDisabled(true);
  const doc = elements.form.ownerDocument;
  elements.intervalMinutes.replaceChildren(
    ...INTERVAL_OPTIONS_MINUTES.map((minutes) => {
      const option = doc.createElement('option');
      option.value = String(minutes);
      option.textContent = intervalLabel(minutes);
      return option;
    }),
  );
  showStatus(OPTIONS_TEXT.loading, false);

  let settings: Settings;
  try {
    settings = await deps.loadSettings();
  } catch (error) {
    // 読み込めない状態で保存すると既存の設定を上書きするため、入力は無効のままにする。
    showStatus(`${OPTIONS_TEXT.loadFailed}: ${error instanceof Error ? error.message : String(error)}`, true);
    return;
  }

  elements.notificationsEnabled.checked = settings.notificationsEnabled;
  elements.gmailEnabled.checked = settings.gmailEnabled;
  elements.icloudEnabled.checked = settings.icloudEnabled;
  if (findIntervalOption(settings.intervalMinutes) === undefined) {
    // 値を選択肢に寄せて保存し直すことはしない。未選択にして、ユーザーに選び直してもらう。
    elements.intervalMinutes.selectedIndex = -1;
    showStatus(OPTIONS_TEXT.unknownInterval(settings.intervalMinutes), true);
  } else {
    elements.intervalMinutes.value = String(settings.intervalMinutes);
    showStatus('', false);
  }

  elements.form.addEventListener('change', () => {
    void save();
  });
  elements.form.addEventListener('submit', (event) => {
    event.preventDefault();
  });
  setDisabled(false);
}
