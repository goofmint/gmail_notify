import { getElement } from '../shared/dom';
import { loadSettings, saveSettings } from '../shared/settings';
import { startOptions } from './controller';

startOptions({
  loadSettings,
  saveSettings,
  elements: {
    form: getElement(document, 'settings-form', HTMLFormElement),
    intervalMinutes: getElement(document, 'intervalMinutes', HTMLSelectElement),
    notificationsEnabled: getElement(document, 'notificationsEnabled', HTMLInputElement),
    gmailEnabled: getElement(document, 'gmailEnabled', HTMLInputElement),
    icloudEnabled: getElement(document, 'icloudEnabled', HTMLInputElement),
    ignoreUnreachableAccounts: getElement(document, 'ignoreUnreachableAccounts', HTMLInputElement),
    status: getElement(document, 'status', HTMLElement),
  },
}).catch((error) => {
  console.error('設定画面の起動に失敗', error);
});
