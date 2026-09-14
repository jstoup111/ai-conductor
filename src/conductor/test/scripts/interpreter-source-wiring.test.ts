import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

describe('interpreter-source integrity wiring', () => {
  const roots: string[] = [];
  afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

  async function invocationBlock(root: string): Promise<string> {
    const integrity = await readFile(join(process.cwd(), '..', '..', 'test', 'test_harness_integrity.sh'), 'utf8');
    const start = integrity.indexOf('# ── 27. Interpreter source transport');
    const end = integrity.indexOf('# ── Summary', start);
    const block = join(root, 'interpreter-block.sh');
    await writeFile(block, integrity.slice(start, end));
    return block;
  }

  async function runChecker(exitCode: number): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'interpreter-wiring-'));
    roots.push(root);
    const harness = join(root, 'harness');
    await mkdir(join(harness, 'test'), { recursive: true });
    await writeFile(join(harness, 'test', 'check_interpreter_source.sh'), `#!/usr/bin/env bash\necho controlled-checker-${exitCode} >&2\nexit ${exitCode}\n`, { mode: 0o755 });
    const block = await invocationBlock(root);
    return (await execa('bash', ['-c', `
      assert() { if [ "$2" -eq 0 ]; then echo "PASS: $1"; else echo "FAIL: $1"; fi; }
      BOLD=''; HARNESS_DIR="$1"; source "$2"
    `, '_', harness, block], { reject: false, all: true })).all ?? '';
  }

  it('records a checker failure and preserves its diagnostic', async () => {
    const output = await runChecker(23);
    expect(output).toContain('controlled-checker-23');
    expect(output).toContain('FAIL: shipped interpreter source contains no shell-expanded runtime data');
  });

  it('records a checker pass', async () => {
    const output = await runChecker(0);
    expect(output).toContain('PASS: shipped interpreter source contains no shell-expanded runtime data');
  });
});
