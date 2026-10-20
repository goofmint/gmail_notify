import { defineManifest } from '@crxjs/vite-plugin';

// アイコン（icons / action.default_icon）は T0-3、各エントリのファイルは T0-4 で追加する。
export default defineManifest({
  manifest_version: 3,
  name: 'Gmail Notify',
  version: '0.1.0',
  description: 'Gmail と iCloud メールの未読件数をツールバーに表示し、新着を通知する。',
  action: {
    default_popup: 'src/popup/index.html',
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  options_page: 'src/options/index.html',
  permissions: ['alarms', 'storage', 'notifications', 'declarativeNetRequest', 'cookies', 'tabs'],
  host_permissions: ['https://mail.google.com/*', 'https://*.icloud.com/*'],
});
