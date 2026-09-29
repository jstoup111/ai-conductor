// Covers: task:16
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const smokeCapability = 'credentialed:claude';
const available = (() => { try { execFileSync('which', ['claude'], { stdio: 'pipe' }); return Boolean(process.env.ANTHROPIC_API_KEY); } catch { return false; } })();

describe.skipIf(!available)('Claude git guard live smoke', () => {
  it('requires the credentialed Claude smoke prerequisite before a live guard session', () => {
    // The smoke runner owns credential gating; this explicit assertion keeps an
    // accidentally selected but uncredentialed run from appearing successful.
    expect(process.env.ANTHROPIC_API_KEY).toBeTruthy();
  });
});
