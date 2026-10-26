import { describe, expect, it } from 'vitest';
import { accountHomeUrl } from '../src/shared/accountUrl';
import { ICLOUD_MAIL_URL } from '../src/shared/constants';

describe('accountHomeUrl', () => {
  it.each([
    ['gmail:u/0', 'https://mail.google.com/mail/u/0/#inbox'],
    ['gmail:u/2', 'https://mail.google.com/mail/u/2/#inbox'],
  ])('Gmail（%s）は該当アカウントの受信トレイを返す', (accountKey, url) => {
    expect(accountHomeUrl({ provider: 'gmail', accountKey })).toBe(url);
  });

  it('iCloud は iCloud Mail の URL を返す', () => {
    expect(accountHomeUrl({ provider: 'icloud', accountKey: 'icloud' })).toBe(ICLOUD_MAIL_URL);
  });

  it('Gmail の accountKey の形式が不正なら例外を投げる', () => {
    expect(() => accountHomeUrl({ provider: 'gmail', accountKey: 'gmail:x' })).toThrow(
      'Gmail の accountKey の形式が不正: gmail:x',
    );
  });
});
