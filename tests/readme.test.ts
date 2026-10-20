import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ManifestV3Export } from '@crxjs/vite-plugin';
import type { ConfigEnv } from 'vite';
import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import manifestExport from '../src/manifest';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const readme = await readFile(join(rootDir, 'README.md'), 'utf8');

// ManifestV3 型は公開されていないので、defineManifest の戻り値の型から取り出す（tests/manifest.test.ts と同じ）。
type ManifestFn = Extract<ManifestV3Export, (env: ConfigEnv) => object>;
type Manifest = Awaited<ReturnType<ManifestFn>>;

async function resolveManifest(value: ManifestV3Export): Promise<Manifest> {
  if (typeof value === 'function') {
    return value({ command: 'build', mode: 'production' });
  }
  return value;
}

/** README に出てくる `npm run <script>` と `npm test` の script 名。 */
function mentionedScripts(text: string): string[] {
  const names = [...text.matchAll(/npm run ([\w:-]+)/g)].map((match) => match[1] ?? '');
  if (/npm test\b/.test(text)) {
    names.push('test');
  }
  return [...new Set(names)];
}

/** README の「## 権限」セクションにある表の 1 列目（`...` で囲んだ値）。 */
function listedPermissions(text: string): string[] {
  const start = text.indexOf('\n## 権限\n');
  if (start === -1) {
    throw new Error('README に「## 権限」セクションが無い');
  }
  const rest = text.slice(start + 1);
  const end = rest.indexOf('\n## ', 1);
  const section = end === -1 ? rest : rest.slice(0, end);
  return [...section.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1] ?? '');
}

describe('README', () => {
  it('記載している npm script はすべて package.json にある', () => {
    const scripts = mentionedScripts(readme);
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.filter((name) => !Object.hasOwn(pkg.scripts, name))).toEqual([]);
  });

  it('権限の一覧は manifest の permissions と host_permissions に一致する', async () => {
    const manifest = await resolveManifest(manifestExport);
    const expected = [...(manifest.permissions ?? []), ...(manifest.host_permissions ?? [])];
    expect(expected.length).toBeGreaterThan(0);
    expect([...listedPermissions(readme)].sort()).toEqual([...expected].sort());
  });
});
