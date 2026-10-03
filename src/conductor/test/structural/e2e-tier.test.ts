import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import defaultConfig from '../../vitest.config.js';
import e2eConfig from '../../vitest.e2e.config.js';

const packageRoot = join(__dirname, '..', '..');

function e2eFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : e2eFiles(path);
    return entry.name.endsWith('.e2e.test.ts') ? [relative(packageRoot, path)] : [];
  });
}

describe('e2e test tier', () => {
  it('excludes *.e2e.test.ts from the default suite and owns it in the e2e config', () => {
    expect(defaultConfig.test?.exclude).toContain('**/*.e2e.test.ts');
    expect(e2eConfig.test?.include).toEqual(['test/**/*.e2e.test.ts']);
    expect(e2eConfig.test?.exclude).toEqual([]);
    expect(e2eConfig.test?.setupFiles).toEqual(defaultConfig.test?.setupFiles);
    expect(e2eConfig.test?.globalSetup).toEqual(defaultConfig.test?.globalSetup);
  });

  it('keeps the tier populated and executed by CI', () => {
    expect(e2eFiles(join(packageRoot, 'test')).length).toBeGreaterThan(0);
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    expect(packageJson.scripts['test:e2e']).toContain('--config vitest.e2e.config.ts');
    const ci = readFileSync(join(packageRoot, '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ci).toContain('npm run test:e2e');
  });
});
