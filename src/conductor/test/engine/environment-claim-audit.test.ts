/**
 * Unit specs for the claimed-environmental-blocker audit (#1106).
 *
 * The incident: a self-build `finish` dispatch halted with a write-fence
 * sandbox blocker that provably cannot exist, and completed, tested work never
 * shipped. The audit's job is to refute exactly that claim from engine-known
 * dispatch facts — and to refute NOTHING it cannot positively disprove.
 */

import { describe, expect, it } from 'vitest';
import {
  ENVIRONMENT_CLAIM_REFUTED,
  auditEnvironmentBlockerClaims,
  writeFenceDeniableOperations,
} from '../../src/engine/self-host/environment-claim-audit.js';

/** The verbatim blocker prose from `.daemon/daemon.log` (#1106). */
const INCIDENT_OUTPUT = [
  '**HALT — Environment sandbox prevents finish completion.**',
  '',
  'All verification gates passed:',
  '- ✅ GATE 0: No rebase/merge in progress',
  '- ✅ Tests: 9207 passed, 5 skipped (aggregate suite PASS)',
  '- ✅ Git status: Clean working tree',
  '',
  "**Blocker:** The environment's write-fence sandbox blocks both `git push` and `gh pr` operations.",
  '',
  'Neither path is executable in this sandbox environment.',
  '',
  'Human review required.',
].join('\n');

const CLAUDE_DISPATCH = { provider: 'claude', writeFenceInstalled: true } as const;

describe('environment claim audit', () => {
  it('refutes the incident blocker on an unsandboxed, write-fenced claude dispatch', () => {
    const audit = auditEnvironmentBlockerClaims(INCIDENT_OUTPUT, CLAUDE_DISPATCH);

    expect(audit.refuted.map((r) => r.operation).sort()).toEqual(['gh', 'git push']);
    expect(audit.message).toContain(ENVIRONMENT_CLAIM_REFUTED);
    // The refutation must quote the claim and state the disproving facts, so an
    // operator reading daemon.log is not sent hunting a misconfigured sandbox.
    expect(audit.message).toContain("The environment's write-fence sandbox blocks");
    expect(audit.message).toContain('no OS sandbox');
    expect(audit.message).toContain('outside this build worktree');
  });

  it('derives what the fence can deny from the fence generator, not from belief', () => {
    // The generated fence script carries no `push`/`gh` rule, so neither remote
    // operation is deniable. If a rule is ever added, this set grows and the
    // audit stops refuting that claim on its own.
    expect([...writeFenceDeniableOperations()]).toEqual([]);
  });

  it('never refutes a claim on a genuinely sandboxed provider', () => {
    // codex runs under `sandbox_mode="workspace-write"`, which really can
    // restrict a command — the engine cannot disprove the claim, so it does not.
    const audit = auditEnvironmentBlockerClaims(INCIDENT_OUTPUT, {
      provider: 'codex',
      writeFenceInstalled: false,
    });

    expect(audit).toEqual({ refuted: [], message: null });
  });

  it('never refutes a claim on an unrecognized provider', () => {
    const audit = auditEnvironmentBlockerClaims(INCIDENT_OUTPUT, {
      provider: 'some-future-provider',
      writeFenceInstalled: false,
    });

    expect(audit).toEqual({ refuted: [], message: null });
  });

  it('leaves a real, observed command failure alone', () => {
    const observed = [
      'Ran: git push --force-with-lease origin feat/x',
      'remote: Permission to owner/repo.git denied to bot.',
      'fatal: unable to access repository: exit 128',
    ].join('\n');

    expect(auditEnvironmentBlockerClaims(observed, CLAUDE_DISPATCH)).toEqual({
      refuted: [],
      message: null,
    });
  });

  it('leaves ordinary sandbox prose that blames nothing alone', () => {
    const chatter = [
      'The self-build sandbox provisioned a throwaway CLAUDE_CONFIG_DIR.',
      'The write fence blocks edits to the live harness checkout.',
      'Pushed the branch and opened the PR.',
    ].join('\n');

    expect(auditEnvironmentBlockerClaims(chatter, CLAUDE_DISPATCH)).toEqual({
      refuted: [],
      message: null,
    });
  });

  it('does not refute its own refutation quoted back by a later attempt', () => {
    const first = auditEnvironmentBlockerClaims(INCIDENT_OUTPUT, CLAUDE_DISPATCH);
    const echoed = `${first.message}\n\nAcknowledged; retrying.`;

    expect(auditEnvironmentBlockerClaims(echoed, CLAUDE_DISPATCH)).toEqual({
      refuted: [],
      message: null,
    });
  });

  it('returns no verdict for empty output', () => {
    expect(auditEnvironmentBlockerClaims('', CLAUDE_DISPATCH)).toEqual({ refuted: [], message: null });
    expect(auditEnvironmentBlockerClaims(null, CLAUDE_DISPATCH)).toEqual({ refuted: [], message: null });
  });

  it('refutes even when no fence was installed at all', () => {
    const audit = auditEnvironmentBlockerClaims(
      'Cannot proceed: the sandbox blocks `gh pr create`.',
      { provider: 'claude', writeFenceInstalled: false },
    );

    expect(audit.refuted.map((r) => r.operation)).toEqual(['gh']);
    expect(audit.message).toContain('write fence: NOT installed');
  });
});
