import * as z from 'zod';
import { ALARM_NAME, DEFAULT_SETTINGS } from '../shared/constants';
import type { CheckNowMessage, CheckNowResponse } from '../shared/messages';
import { loadSettings } from '../shared/settings';
import { runCheck } from './checker';
import { registerIcloudRules } from './icloudRules';
import { handleNotificationClick } from './notifications';

// Service Worker の再起動後もイベントを受け取れるよう、リスナーはトップレベルで同期的に登録する（設計 §8.1）。

const checkNowMessageSchema = z.object({ type: z.literal('check-now') }) satisfies z.ZodType<
  CheckNowMessage,
  CheckNowMessage
>;

/** 設定のキー。storage.onChanged で設定の変更かどうかを判定する。 */
const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS);

/** リスナーからは reject を伝えられないため、失敗をログに出す。 */
function report(promise: Promise<void>): void {
  promise.catch((error) => {
    console.error('バックグラウンド処理に失敗', error);
  });
}

/**
 * アラーム登録の直列化用キュー。initialize() と storage.onChanged が同時に scheduleAlarm() を
 * 呼ぶと、古い設定を読んだ処理が後から登録して新しい間隔を上書きしうるため、順番に実行する。
 * 失敗しても後続を止めないよう、キュー自体は常に resolve する。
 */
let alarmQueue: Promise<void> = Promise.resolve();

/** 設定のチェック間隔でアラームを登録する。同じ名前で登録し直すと置き換わる。 */
function scheduleAlarm(): Promise<void> {
  const next = alarmQueue.then(async () => {
    const settings = await loadSettings();
    await chrome.alarms.create(ALARM_NAME, {
      periodInMinutes: settings.intervalMinutes,
      delayInMinutes: settings.intervalMinutes,
    });
  });
  alarmQueue = next.catch(() => undefined);
  return next;
}

/**
 * インストール時と起動時の処理。iCloud のルールを登録してからチェックする。
 * ルールの登録に失敗しても Gmail の確認は続けるため（NFR-3）、失敗はログに出してチェックは実行する。
 */
function initialize(): void {
  report(scheduleAlarm());
  report(
    registerIcloudRules()
      .catch((error) => {
        console.error('iCloud 用ルールの登録に失敗', error);
      })
      .then(() => runCheck()),
  );
}

/** check-now を処理し、成否を応答する。 */
async function handleCheckNow(sendResponse: (response: CheckNowResponse) => void): Promise<void> {
  try {
    await runCheck();
    sendResponse({ ok: true });
  } catch (error) {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  initialize();
});

chrome.runtime.onStartup.addListener(() => {
  initialize();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    report(runCheck());
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!checkNowMessageSchema.safeParse(message).success) {
    return false;
  }
  report(handleCheckNow(sendResponse));
  // 非同期に応答するため、チャネルを開いたままにする。
  return true;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync' || !SETTINGS_KEYS.some((key) => Object.hasOwn(changes, key))) {
    return;
  }
  report(scheduleAlarm().then(() => runCheck()));
});

chrome.notifications.onClicked.addListener((notificationId) => {
  report(handleNotificationClick(notificationId));
});
