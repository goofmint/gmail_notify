import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const eslint = new ESLint({ cwd: rootDir });

async function lintRuleIds(source: string): Promise<string[]> {
  const results = await eslint.lintText(source, { filePath: 'src/sample.ts' });
  const [result] = results;
  if (result === undefined) {
    throw new Error('ESLint が結果を返さなかった');
  }
  return result.messages.map((message) => {
    if (message.ruleId === null) {
      throw new Error(`ルール ID のないメッセージ: ${message.message}`);
    }
    return message.ruleId;
  });
}

describe('eslint.config.js の禁止ルール', () => {
  it('any 注釈を no-explicit-any で検出する', async () => {
    const ruleIds = await lintRuleIds('export const value: any = 1;\n');
    expect(ruleIds).toEqual(['@typescript-eslint/no-explicit-any']);
  });

  it('unknown 注釈を no-restricted-types で検出する', async () => {
    const ruleIds = await lintRuleIds('export const value: unknown = 1;\n');
    expect(ruleIds).toEqual(['@typescript-eslint/no-restricted-types']);
  });

  it('class 宣言を no-restricted-syntax で検出する', async () => {
    const ruleIds = await lintRuleIds('export class Sample {}\n');
    expect(ruleIds).toEqual(['no-restricted-syntax']);
  });

  it('class 式を no-restricted-syntax で検出する', async () => {
    const ruleIds = await lintRuleIds('export const Sample = class {};\n');
    expect(ruleIds).toEqual(['no-restricted-syntax']);
  });

  it('具体的な型と関数だけのコードはエラーにならない', async () => {
    const source = [
      'export type Count = { readonly value: number };',
      'export function increment(count: Count): Count {',
      '  return { value: count.value + 1 };',
      '}',
      '',
    ].join('\n');
    const ruleIds = await lintRuleIds(source);
    expect(ruleIds).toEqual([]);
  });
});
