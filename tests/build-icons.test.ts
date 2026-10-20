import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { ICON_SIZES, buildIcons, renderIcon } from '../scripts/build-icons';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const svgPath = join(rootDir, 'assets', 'icon.svg');
const committedIconsDir = join(rootDir, 'public', 'icons');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readPngSize(png: Buffer): { width: number; height: number } {
  if (png.length < 24) {
    throw new Error(`PNG として短すぎる: ${png.length} バイト`);
  }
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('PNG シグネチャが一致しない');
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe('assets/icon.svg', () => {
  it('存在し、正方形の viewBox を持つ', async () => {
    await access(svgPath);
    const svg = await readFile(svgPath, 'utf8');
    const match = /viewBox="\s*(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*"/.exec(svg);
    if (match === null) {
      throw new Error('viewBox が見つからない');
    }
    const width = Number(match[3]);
    const height = Number(match[4]);
    expect(width).toBeGreaterThan(0);
    expect(width).toBe(height);
  });
});

describe('renderIcon', () => {
  it('必須のアイコンサイズ（16 / 32 / 48 / 128）を定義する', () => {
    expect(ICON_SIZES).toEqual([16, 32, 48, 128]);
  });

  it.each(ICON_SIZES)('%ipx の PNG を返す', async (size) => {
    const svg = await readFile(svgPath, 'utf8');
    const png = renderIcon(svg, size);
    expect(readPngSize(png)).toEqual({ width: size, height: size });
  });
});

describe('buildIcons', () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir !== undefined) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('全サイズの PNG を書き出してパスを返す', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'build-icons-'));
    const outDir = join(tempDir, 'icons');
    const writtenPaths = await buildIcons({ svgPath, outDir });
    const svg = await readFile(svgPath, 'utf8');

    expect(writtenPaths).toEqual(ICON_SIZES.map((size) => join(outDir, `icon-${size}.png`)));
    for (const [index, size] of ICON_SIZES.entries()) {
      const writtenPath = writtenPaths[index];
      if (writtenPath === undefined) {
        throw new Error(`${size}px のパスが返されていない`);
      }
      expect(basename(writtenPath)).toBe(`icon-${size}.png`);
      const png = await readFile(writtenPath);
      expect(readPngSize(png)).toEqual({ width: size, height: size });
      expect(png.equals(renderIcon(svg, size))).toBe(true);
    }
  });
});

describe('コミット済みの public/icons', () => {
  it.each(ICON_SIZES)('icon-%i.png が assets/icon.svg からの生成結果と一致する', async (size) => {
    const png = await readFile(join(committedIconsDir, `icon-${size}.png`));
    const svg = await readFile(svgPath, 'utf8');
    expect(readPngSize(png)).toEqual({ width: size, height: size });
    expect(png.equals(renderIcon(svg, size))).toBe(true);
  });
});
