import { ICLOUD_ORIGIN } from '../shared/constants';

/** iCloud 用の dynamic rule の ID。登録し直すときは先にこの ID を削除する。 */
export const ICLOUD_RULE_ID = 1;

/**
 * iCloud の setup と mailws2 への要求の Origin と Referer を www.icloud.com に書き換えるルール（設計 §7.1）。
 * 拡張自身の要求だけに適用するため、initiatorDomains に拡張の ID を入れる。
 */
export function buildIcloudRules(extensionId: string): chrome.declarativeNetRequest.Rule[] {
  return [
    {
      id: ICLOUD_RULE_ID,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'origin', operation: 'set', value: ICLOUD_ORIGIN },
          { header: 'referer', operation: 'set', value: `${ICLOUD_ORIGIN}/` },
        ],
      },
      condition: {
        initiatorDomains: [extensionId],
        regexFilter: '^https://[^/]+\\.icloud\\.com/(setup|mailws2)/',
        resourceTypes: ['xmlhttprequest'],
      },
    },
  ];
}

/** 既存の同じ ID のルールを削除してから登録する。失敗は呼び出し元に伝える。 */
export async function registerIcloudRules(): Promise<void> {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [ICLOUD_RULE_ID],
    addRules: buildIcloudRules(chrome.runtime.id),
  });
}
