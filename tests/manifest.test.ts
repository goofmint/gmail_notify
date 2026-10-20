import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ManifestV3Export } from '@crxjs/vite-plugin';
import type { ConfigEnv } from 'vite';
import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import manifestExport from '../src/manifest';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const publicDir = join(rootDir, 'public');

// ManifestV3 型は公開されていないので、defineManifest の戻り値の型から取り出す。
type ManifestFn = Extract<ManifestV3Export, (env: ConfigEnv) => object>;
type Manifest = Awaited<ReturnType<ManifestFn>>;

// defineManifest はオブジェクト、Promise、関数のいずれかを返す型なので、関数なら呼んで解決する。
async function resolveManifest(value: ManifestV3Export): Promise<Manifest> {
  if (typeof value === 'function') {
    return value({ command: 'build', mode: 'production' });
  }
  return value;
}

function serviceWorkerOf(manifest: Manifest): string {
  const background = manifest.background;
  if (background === undefined || !('service_worker' in background)) {
    throw new Error('background.service_worker が manifest に無い');
  }
  return background.service_worker;
}

function requireString(value: string | undefined, label: string): string {
  if (value === undefined) {
    throw new Error(`${label} が manifest に無い`);
  }
  return value;
}

describe('manifest', () => {
  it('MV3 で、設計 §11 の項目を持つ', async () => {
    const manifest = await resolveManifest(manifestExport);

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe('Gmail Notify');
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.background).toEqual({
      service_worker: 'src/background/index.ts',
      type: 'module',
    });
    expect(manifest.action?.default_popup).toBe('src/popup/index.html');
    expect(manifest.options_page).toBe('src/options/index.html');
    expect(manifest.permissions).toEqual([
      'alarms',
      'storage',
      'notifications',
      'declarativeNetRequest',
      'cookies',
    ]);
    expect(manifest.host_permissions).toEqual([
      'https://mail.google.com/*',
      'https://accounts.google.com/*',
      'https://*.icloud.com/*',
    ]);
  });

  it('icons と action.default_icon は 4 サイズを同じパスで指す', async () => {
    const manifest = await resolveManifest(manifestExport);
    const expected = {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    };

    expect(manifest.icons).toEqual(expected);
    expect(manifest.action?.default_icon).toEqual(expected);
  });

  it('参照するファイルがすべて存在する', async () => {
    const manifest = await resolveManifest(manifestExport);
    const sourcePaths = [
      requireString(manifest.action?.default_popup, 'action.default_popup'),
      requireString(manifest.options_page, 'options_page'),
      serviceWorkerOf(manifest),
    ];
    if (manifest.icons === undefined) {
      throw new Error('icons が manifest に無い');
    }
    const iconPaths = Object.values(manifest.icons);
    expect(iconPaths).toHaveLength(4);

    for (const path of sourcePaths) {
      await expect(access(join(rootDir, path))).resolves.toBeUndefined();
    }
    for (const path of iconPaths) {
      await expect(access(join(publicDir, path))).resolves.toBeUndefined();
    }
  });
});
