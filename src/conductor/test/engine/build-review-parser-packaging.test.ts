// Covers: task:9
import { describe, expect, it } from 'vitest';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const CONDUCTOR_ROOT = join(process.cwd());
const TYPESCRIPT_VERSION = '6.0.3';

interface PackageManifest {
  readonly dependencies?: Record<string, string>;
}

interface PackageLock {
  readonly packages: Record<string, {
    readonly dependencies?: Record<string, string>;
    readonly version?: string;
    readonly dev?: boolean;
  }>;
}

async function buildPublishedParser(packageRoot: string): Promise<void> {
  const { PUBLISH_WRAPPER_ENV_VAR } = await import('../../scripts/publish-guard.mjs');
  const previous = process.env[PUBLISH_WRAPPER_ENV_VAR];
  const previousTmpdir = process.env.TMPDIR;
  process.env[PUBLISH_WRAPPER_ENV_VAR] = '1';
  process.env.TMPDIR = process.env.AI_CONDUCTOR_TEST_TMP_ROOT ?? previousTmpdir;
  try {
    const { build } = await import('tsup');
    const { default: config } = await import('../../tsup.config.ts');
    if (typeof config === 'function' || Array.isArray(config)) {
      throw new Error('production tsup config must be a single build configuration');
    }
    await build({ ...config, outDir: join(packageRoot, 'dist'), dts: false, clean: true, silent: true });
  } finally {
    if (previousTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmpdir;
    if (previous === undefined) delete process.env[PUBLISH_WRAPPER_ENV_VAR];
    else process.env[PUBLISH_WRAPPER_ENV_VAR] = previous;
  }
}

async function stageRuntimeTypescript(packageRoot: string, manifest: PackageManifest): Promise<void> {
  const requested = manifest.dependencies?.typescript;
  if (requested !== TYPESCRIPT_VERSION) {
    throw new Error(`production package must declare typescript@${TYPESCRIPT_VERSION}, got ${requested ?? 'nothing'}`);
  }
  const installed = join(CONDUCTOR_ROOT, 'node_modules', 'typescript');
  await lstat(installed);
  const nodeModules = join(packageRoot, 'node_modules');
  await mkdir(nodeModules, { recursive: true });
  await symlink(installed, join(nodeModules, 'typescript'), 'junction');
}

describe('build-review parser production packaging', () => {
  it('imports the published parser through a production-only dependency tree', async () => {
    const packageRoot = await mkdtemp(join(
      process.env.AI_CONDUCTOR_TEST_TMP_ROOT ?? process.env.TMPDIR ?? '/tmp',
      'build-review-parser-production-',
    ));
    try {
      const manifest = JSON.parse(await readFile(join(CONDUCTOR_ROOT, 'package.json'), 'utf8')) as PackageManifest;
      const lock = JSON.parse(await readFile(join(CONDUCTOR_ROOT, 'package-lock.json'), 'utf8')) as PackageLock;

      expect(manifest.dependencies?.typescript).toBe(TYPESCRIPT_VERSION);
      expect(lock.packages['']?.dependencies?.typescript).toBe(TYPESCRIPT_VERSION);
      expect(lock.packages['node_modules/typescript']).toMatchObject({ version: TYPESCRIPT_VERSION });
      expect(lock.packages['node_modules/typescript']?.dev).toBeUndefined();

      await writeFile(join(packageRoot, 'package.json'), '{"type":"module"}\n');
      await stageRuntimeTypescript(packageRoot, manifest);
      await buildPublishedParser(packageRoot);

      const entry = join(packageRoot, 'dist', 'engine', 'build-review-test-declarations.js');
      const { analyzeTestDeclarations } = await import(pathToFileURL(entry).href) as typeof import('../../src/engine/build-review-test-declarations.js');
      const analysis = analyzeTestDeclarations({
        fileName: 'test/supported.test.ts',
        bytes: Buffer.from("describe('suite', () => { it('candidate', () => {}); });", 'utf8'),
      });

      expect(analysis).toMatchObject({
        kind: 'supported',
        diagnostics: [],
        declarations: expect.arrayContaining([
          expect.objectContaining({ titleChain: ['suite', 'candidate'] }),
        ]),
      });
    } finally {
      await rm(packageRoot, { recursive: true, force: true });
    }
  });
});
