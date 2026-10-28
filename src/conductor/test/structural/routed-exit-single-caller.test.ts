import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const productionRoot = join(process.cwd(), 'src/conductor/src');

function importsRoutedExit(source: string): boolean {
  return /^import\s+(?!type\s)\{[^}]*\brequestRoutedExit\b[^}]*\}\s+from\s+['"][^'"]*routed-exit\.js['"];?$/m.test(source);
}

describe('routed exit ownership', () => {
  it('rejects a value import outside the continuation owner', () => {
    expect(importsRoutedExit("import { requestRoutedExit } from './routing/routed-exit.js';")).toBe(true);
    expect(importsRoutedExit("import type { requestRoutedExit } from './routing/routed-exit.js';")).toBe(false);
  });

  it('keeps requestRoutedExit value ownership in round-admission', async () => {
    const paths = [
      'engine/conductor.ts',
      'engine/restack/stack-preflight.ts',
      'engine/routing/round-admission.ts',
      'engine/routing/routed-exit.ts',
    ];
    const offenders: string[] = [];
    for (const path of paths) {
      if (path.endsWith('round-admission.ts') || path.endsWith('routed-exit.ts')) continue;
      if (importsRoutedExit(await readFile(join(productionRoot, path), 'utf8'))) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });
});
