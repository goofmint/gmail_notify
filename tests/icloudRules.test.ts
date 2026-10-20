import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildIcloudRules, ICLOUD_RULE_ID, registerIcloudRules } from '../src/background/icloudRules';
import { ICLOUD_ORIGIN } from '../src/shared/constants';

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';

function stubChrome(updateDynamicRules: (options: chrome.declarativeNetRequest.UpdateRuleOptions) => Promise<void>) {
  const updateMock = vi.fn(updateDynamicRules);
  vi.stubGlobal('chrome', { runtime: { id: EXTENSION_ID }, declarativeNetRequest: { updateDynamicRules: updateMock } });
  return updateMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildIcloudRules', () => {
  it('設計 §7.1 のルールを 1 件返す', () => {
    expect(buildIcloudRules(EXTENSION_ID)).toEqual([
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
          initiatorDomains: [EXTENSION_ID],
          regexFilter: '^https://[^/]+\\.icloud\\.com/(setup|mailws2)/',
          resourceTypes: ['xmlhttprequest'],
        },
      },
    ]);
  });

  it('ルール ID は 1', () => {
    expect(ICLOUD_RULE_ID).toBe(1);
  });

  describe('regexFilter', () => {
    const [rule] = buildIcloudRules(EXTENSION_ID);
    const regexFilter = rule?.condition.regexFilter;
    if (regexFilter === undefined) {
      throw new Error('regexFilter が無い');
    }
    const pattern = new RegExp(regexFilter);

    it.each([
      'https://p123-mccgateway.icloud.com/mailws2/v1/geqs/query',
      'https://p123-mccgateway.icloud.com/mailws2/v1/thread/search?dsid=1',
      'https://setup.icloud.com/setup/ws/1/validate',
    ])('%s に一致する', (url) => {
      expect(pattern.test(url)).toBe(true);
    });

    it.each([
      'https://www.icloud.com/mail/',
      'https://icloud.com/setup/ws/1/validate',
      'https://evil.example.com/mailws2/v1/geqs/query',
      'https://p123-mccgateway.icloud.com.evil.example/mailws2/',
      'http://setup.icloud.com/setup/ws/1/validate',
    ])('%s には一致しない', (url) => {
      expect(pattern.test(url)).toBe(false);
    });
  });
});

describe('registerIcloudRules', () => {
  it('同じ ID を削除してから、拡張の ID で作ったルールを 1 回で登録する', async () => {
    const updateMock = stubChrome(() => Promise.resolve());
    await registerIcloudRules();
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith({
      removeRuleIds: [ICLOUD_RULE_ID],
      addRules: buildIcloudRules(EXTENSION_ID),
    });
  });

  it('updateDynamicRules の失敗をそのまま伝える', async () => {
    stubChrome(() => Promise.reject(new Error('Rule with id 1 is invalid')));
    await expect(registerIcloudRules()).rejects.toThrow('Rule with id 1 is invalid');
  });
});
