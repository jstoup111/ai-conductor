/**
 * Acceptance specs for the TR-10 migration-gate waiver (fix #354,
 * .docs/stories/self-host-release-gate-bin-conduct-breaking-surfac.md,
 * adr-2026-07-06-migration-gate-waiver APPROVED).
 *
 * A waiver file lets a harness self-build with an internal-only edit to a
 * breaking-surface file satisfy TR-10 without a ```bash migration``` block.
 * These specs drive the REAL composed entry point, `runReleaseArtifactGate`
 * (exactly what `wiring.ts`'s `SelfHostGuardrails.releaseGate` forwards to),
 * across the full waiver flow described by the stories — not the isolated
 * `parseWaiver`/`findWaiverPaths`/`evaluateWaiver` units, which get their own
 * coverage in `test/engine/self-host/release-gate.test.ts` during /pipeline.
 * TR-8 (integrity) and TR-9 (changelog) are stubbed to pass trivially so each
 * spec isolates TR-10's waiver behavior.
 *
 * Canonical waiver format pinned here (not fully specified by the ADR/stories
 * beyond "a `Waives:` list of canonical surface names + non-empty rationale"):
 *   Waives: <comma-separated canonical surface names>
 *
 *   Rationale: <non-empty prose>
 * The parser implemented in /pipeline Task 2/3 must satisfy this shape.
 *
 * Pre-implementation: today's `runReleaseArtifactGate` has no waiver
 * awareness at all, so every "waiver satisfies the gate" case below currently
 * HALTs on the missing-migration-block reason — RED for the right reason.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  runReleaseArtifactGate,
  type ChangedFile,
} from '../../src/engine/self-host/release-gate.js';

const GOOD_CHANGELOG = `## [Unreleased]\n\n### Added\n- self-host guardrails\n\n## [0.99.18]\n- old\n`;
const WAIVER_PATH = '.docs/release-waivers/self-host-release-gate-bin-conduct-breaking-surfac.md';

function waiverText(waives: string, rationale = 'Internal gate refactor only; no consumer-visible CLI/hook/schema change.'): string {
  return `Waives: ${waives}\n\nRationale: ${rationale}\n`;
}

async function haltReason(projectRoot: string): Promise<string> {
  return readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf-8');
}

describe('runReleaseArtifactGate — TR-10 migration-gate waiver (acceptance)', () => {
  let projectRoot: string;
  let harnessRoot: string;
  let waiverContent: string | null;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'rg-waiver-proj-'));
    harnessRoot = await mkdtemp(join(tmpdir(), 'rg-waiver-harness-'));
    waiverContent = null;
  });
  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(harnessRoot, { recursive: true, force: true });
  });

  function readTextSeam() {
    return async (path: string): Promise<string | null> => {
      if (path === join(harnessRoot, 'CHANGELOG.md')) return GOOD_CHANGELOG;
      if (path.endsWith(WAIVER_PATH)) return waiverContent;
      return null;
    };
  }

  function run(changedFiles: ChangedFile[] | null) {
    return runReleaseArtifactGate({
      projectRoot,
      harnessRoot,
      readText: readTextSeam(),
      changedFiles: async () => changedFiles,
      access: async () => {},
      exec: async () => ({ code: 0, timedOut: false }),
    });
  }

  it('single-surface waiver in the diff satisfies the gate — pass, no HALT', async () => {
    waiverContent = waiverText('bin/conduct CLI');
    const v = await run([
      { status: 'M', path: 'bin/conduct' },
      { status: 'A', path: WAIVER_PATH },
    ]);
    expect(v.ok).toBe(true);
    expect(existsSync(join(projectRoot, '.pipeline', 'HALT'))).toBe(false);
  });

  it('multi-surface waiver covering both touched surfaces satisfies the gate', async () => {
    waiverContent = waiverText('bin/conduct CLI, hook wiring');
    const v = await run([
      { status: 'M', path: 'bin/conduct' },
      { status: 'M', path: 'hooks/claude/pre-tool.sh' },
      { status: 'A', path: WAIVER_PATH },
    ]);
    expect(v.ok).toBe(true);
    expect(existsSync(join(projectRoot, '.pipeline', 'HALT'))).toBe(false);
  });

  it('waiver covers only one of two touched surfaces — HALT names the uncovered surface', async () => {
    waiverContent = waiverText('bin/conduct CLI');
    const v = await run([
      { status: 'M', path: 'bin/conduct' },
      { status: 'M', path: 'hooks/claude/pre-tool.sh' },
      { status: 'A', path: WAIVER_PATH },
    ]);
    expect(v.ok).toBe(false);
    const reason = await haltReason(projectRoot);
    expect(reason).toMatch(/hook wiring/);
  });

  it('waiver present on disk but NOT part of the diff (stale) — HALT, ignores it', async () => {
    // readTextSeam still resolves the path (simulating "file exists on disk"),
    // but changedFiles omits it entirely — a stale waiver merged by a prior
    // feature must never satisfy a new breaking change set (W1 freshness).
    waiverContent = waiverText('bin/conduct CLI');
    const v = await run([{ status: 'M', path: 'bin/conduct' }]);
    expect(v.ok).toBe(false);
    const reason = await haltReason(projectRoot);
    expect(reason).toMatch(/waiver/i);
    expect(reason).toMatch(/not (?:part of|committed with) (?:the|this) change set|not committed/i);
  });

  it('malformed waiver in the diff (no Waives: line) — HALT names it malformed, never silently passes', async () => {
    waiverContent = 'Rationale: internal-only change.\n';
    const v = await run([
      { status: 'M', path: 'bin/conduct' },
      { status: 'A', path: WAIVER_PATH },
    ]);
    expect(v.ok).toBe(false);
    const reason = await haltReason(projectRoot);
    expect(reason).toMatch(/malformed/i);
  });

  it('breaking surface + no block + no waiver — HALT reason teaches BOTH remediation options', async () => {
    waiverContent = null;
    const v = await run([{ status: 'M', path: 'bin/conduct' }]);
    expect(v.ok).toBe(false);
    const reason = await haltReason(projectRoot);
    expect(reason).toMatch(/```bash migration```|migration block/i);
    expect(reason).toMatch(new RegExp(WAIVER_PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    expect(reason).toMatch(/internal-only|no consumer-visible/i);
  });

  it('uncertain change set (null) with a well-formed waiver ON DISK — still HALT, fail-closed, reason omits the waiver option', async () => {
    waiverContent = waiverText('bin/conduct CLI');
    const v = await run(null);
    expect(v.ok).toBe(false);
    const reason = await haltReason(projectRoot);
    expect(reason).toMatch(/undetermined|could not be determined|uncertain/i);
    expect(reason).not.toMatch(new RegExp(WAIVER_PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
});
