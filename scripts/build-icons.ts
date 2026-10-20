import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

export const ICON_SIZES = [16, 32, 48, 128] as const;

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const defaultSvgPath = join(projectRoot, 'assets', 'icon.svg');
const defaultOutDir = join(projectRoot, 'public', 'icons');

export function renderIcon(svg: string, size: number): Buffer {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  return resvg.render().asPng();
}

export async function buildIcons(options: { svgPath: string; outDir: string }): Promise<string[]> {
  const svg = await readFile(options.svgPath, 'utf8');
  await mkdir(options.outDir, { recursive: true });
  const writtenPaths: string[] = [];
  for (const size of ICON_SIZES) {
    const outPath = join(options.outDir, `icon-${size}.png`);
    await writeFile(outPath, renderIcon(svg, size));
    writtenPaths.push(outPath);
  }
  return writtenPaths;
}

function isDirectExecution(): boolean {
  const entryPath = process.argv[1];
  if (entryPath === undefined) {
    return false;
  }
  return import.meta.url === pathToFileURL(entryPath).href;
}

if (isDirectExecution()) {
  try {
    const writtenPaths = await buildIcons({ svgPath: defaultSvgPath, outDir: defaultOutDir });
    for (const writtenPath of writtenPaths) {
      console.log(`generated: ${writtenPath}`);
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
