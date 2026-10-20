import { describe, expectTypeOf, it } from 'vitest';
import type { CheckNowMessage, CheckNowResponse, RuntimeMessage } from '../src/shared/messages';

describe('messages', () => {
  it('CheckNowMessage は type が check-now だけ', () => {
    expectTypeOf<CheckNowMessage>().toEqualTypeOf<{ type: 'check-now' }>();
    // @ts-expect-error 未定義の type は代入できない
    const invalid: CheckNowMessage = { type: 'check-later' };
    void invalid;
  });

  it('CheckNowResponse は done: true だけ', () => {
    expectTypeOf<CheckNowResponse>().toEqualTypeOf<{ done: true }>();
    // @ts-expect-error done は true 以外にできない
    const invalid: CheckNowResponse = { done: false };
    void invalid;
  });

  it('RuntimeMessage は type で CheckNowMessage に絞り込める', () => {
    expectTypeOf<RuntimeMessage['type']>().toEqualTypeOf<'check-now'>();
    const message: RuntimeMessage = { type: 'check-now' };
    if (message.type === 'check-now') {
      expectTypeOf(message).toEqualTypeOf<CheckNowMessage>();
    }
  });
});
