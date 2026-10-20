// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { getElement } from '../src/shared/dom';

beforeEach(() => {
  const button = document.createElement('button');
  button.id = 'refresh';
  document.body.replaceChildren(button);
});

describe('getElement', () => {
  it('id と種類が合う要素を返す', () => {
    expect(getElement(document, 'refresh', HTMLButtonElement).tagName).toBe('BUTTON');
  });

  it('見つからなければ id を含むエラーにする', () => {
    expect(() => getElement(document, 'missing', HTMLElement)).toThrow('#missing');
  });

  it('種類が違えば id を含むエラーにする', () => {
    expect(() => getElement(document, 'refresh', HTMLSelectElement)).toThrow('#refresh');
  });
});
