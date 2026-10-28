// Covers: task:31
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const sourceRoot = fileURLToPath(new URL('../../src/engine/', import.meta.url));

async function source(name: string): Promise<string> {
  return readFile(new URL(name, `file://${sourceRoot}`), 'utf8');
}

describe('stack preflight entry-point wiring', () => {
  it('runs daemon preflight after the operator-park boundary and before the one-shot re-kick', async () => {
    const daemon = await source('../daemon-cli.ts');
    const parked = daemon.indexOf('const parked = await isOperatorParked');
    const preflight = daemon.indexOf('const stackPreflight = await runDaemonRekickStackPreflight');
    const rebase = daemon.indexOf('const resume = await resumeRebaseFirst');

    expect(parked).toBeGreaterThanOrEqual(0);
    expect(preflight).toBeGreaterThan(parked);
    expect(rebase).toBeGreaterThan(preflight);

    const dispatch = daemon.slice(preflight, rebase);
    expect(dispatch).toContain("baseRefreshDue: existsSync(rekickPath)");
    expect(dispatch).toContain('consumeRekick: async () =>');
    expect(dispatch).toContain('await unlinkFile(rekickPath)');
    expect(dispatch).toContain("stackPreflight.kind === 'halted'");
  });

  it('runs resume preflight before the cursor and rebase-operation classification', async () => {
    const conductor = await source('conductor.ts');
    const resume = conductor.indexOf("} else if (this.resume) {");
    const preflight = conductor.indexOf('const preflight = await this.stackPreflight', resume);
    const cursor = conductor.indexOf('await this.activateChildRegionStateForResume(state)', resume);
    const classification = conductor.indexOf('let rebaseClassification = await classifyRebaseOperation', resume);

    expect(resume).toBeGreaterThanOrEqual(0);
    expect(preflight).toBeGreaterThan(resume);
    expect(cursor).toBeGreaterThan(preflight);
    expect(classification).toBeGreaterThan(cursor);
    expect(conductor.slice(preflight, cursor)).toContain("await supersedeHaltRecord(this.projectRoot, resumeSlug, 'stack-preflight')");
  });
});
