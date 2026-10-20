import { defineManifest } from '@crxjs/vite-plugin';
import pkg from '../package.json' with { type: 'json' };

// アイコンは public/icons/ に置き、Vite が dist のルートへコピーする。
const icons = {
  16: 'icons/icon-16.png',
  32: 'icons/icon-32.png',
  48: 'icons/icon-48.png',
  128: 'icons/icon-128.png',
};

export default defineManifest({
  manifest_version: 3,
  name: 'Gmail Notify',
  version: pkg.version,
  description: 'Gmail と iCloud メールの未読件数をツールバーに表示し、新着を通知する。',
  icons,
  action: {
    default_popup: 'src/popup/index.html',
    default_icon: icons,
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  options_page: 'src/options/index.html',
  permissions: ['alarms', 'storage', 'notifications', 'declarativeNetRequest', 'cookies'],
  host_permissions: ['https://mail.google.com/*', 'https://*.icloud.com/*'],
});
