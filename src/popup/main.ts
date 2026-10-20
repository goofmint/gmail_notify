import { STORAGE_KEYS } from '../shared/constants';
import { getElement } from '../shared/dom';
import type { CheckNowMessage, CheckNowResponse } from '../shared/messages';
import { loadResult } from '../shared/storage';
import { startPopup } from './controller';

const checkNowMessage: CheckNowMessage = { type: 'check-now' };

startPopup({
  loadResult,
  sendCheckNow: () => chrome.runtime.sendMessage<CheckNowMessage, CheckNowResponse>(checkNowMessage),
  openUrl: async (url) => {
    await chrome.tabs.create({ url });
  },
  close: () => {
    window.close();
  },
  onResultChanged: (cb) => {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && STORAGE_KEYS.result in changes) {
        cb();
      }
    });
  },
  elements: {
    total: getElement(document, 'total-unread', HTMLElement),
    checkedAt: getElement(document, 'checked-at', HTMLElement),
    refresh: getElement(document, 'refresh', HTMLButtonElement),
    accounts: getElement(document, 'accounts', HTMLElement),
    message: getElement(document, 'message', HTMLElement),
  },
}).catch((error) => {
  console.error('ポップアップの起動に失敗', error);
});
