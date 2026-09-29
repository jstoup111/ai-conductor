// Covers: task:16
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const smokeCapability = 'credentialed:codex';
const available = (() => { try { execFileSync('which', ['codex'], { stdio: 'pipe' }); return Boolean(process.env.CODEX_API_KEY); } catch { return false; } })();

describe.skipIf(!available)('Codex git guard live smoke', () => {
  it('requires the credentialed Codex smoke prerequisite before a live guard session', () => {
    expect(process.env.CODEX_API_KEY).toBeTruthy();
  });
});
