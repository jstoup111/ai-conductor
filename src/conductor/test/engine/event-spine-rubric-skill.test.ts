import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseBuildReviewCustomReviewerPayload } from '../../src/engine/build-review-domain.js';

const skill = fileURLToPath(new URL('../../../../.agents/skills/event-spine/SKILL.md', import.meta.url));
const HASH = `sha256:${'a'.repeat(64)}`;

const fixtures = [
  ['new sidecar', 'bespoke-channel', 'A new sidecar ledger is a bespoke channel.', '.pipeline/reviewer-ledger.jsonl', 4],
  ['stamped artifact field', 'stamped-artifact-field', 'The stamped field in .pipeline/result.json is an out-of-band channel.', '.pipeline/result.json', 12],
  ['watcher', 'watcher-or-poller', 'The artifact watcher is a channel outside the event spine.', 'src/conductor/src/engine/artifact-watcher.ts', 8],
  ['IPC endpoint', 'out-of-band-signal', 'The IPC endpoint is an out-of-band channel.', 'src/conductor/src/engine/review-ipc.ts', 21],
  ['existing-file bespoke record', 'bespoke-channel', 'The bespoke record in events.jsonl remains a channel despite its existing file.', '.pipeline/events.jsonl', 30],
  ['exception with new format', 'exception-changes-schema', 'The exception moves the write but never changes schema; this new format violates that limit.', '.pipeline/external-events.jsonl', 6],
] as const;

const nonFindingFixtures = [
  ['new ConductorEvent variant', 'A new ConductorEvent variant is emitted through ConductorEventEmitter.'],
  ['same-schema sibling ledger', 'A single-writer sibling ledger uses the ConductorEvent schema and is merged by the existing reader under exceptions A and B.'],
  ['gate evidence artifact', 'The gate evidence artifact is durable state under exception C.'],
  ['committed design doc', 'The committed design doc is durable state under exception C.'],
  ['test fixture write', 'The write is confined to a test fixture.'],
] as const;

const DRAFT_ADR_CHANNEL = {
  concernId: 'unapproved-channel-adr',
  summary: 'The review IPC endpoint has a DRAFT ADR; missing approval, consumers, and reconciliation story.',
  evidenceLocations: ['src/conductor/src/engine/review-ipc.ts:21'],
  sourceRegions: [{
    path: 'src/conductor/src/engine/review-ipc.ts', startLine: 21, endLine: 23, contentHash: HASH, display: 'added changed hunk',
  }],
} as const;

describe('event-spine build-review skill', () => {
  it('grades only frozen diffs with a closed bypass vocabulary and architecture-review backstop', async () => {
    const content = await readFile(skill, 'utf8');
    const grading = content.split('## 7. Grading a finished diff\n')[1]?.split('\n## Output')[0] ?? '';

    expect(grading).toContain('frozen feature diff');
    for (const concernId of ['bespoke-channel', 'stamped-artifact-field', 'watcher-or-poller', 'out-of-band-signal', 'exception-changes-schema']) {
      expect(grading).toContain(`\`${concernId}\``);
    }
    expect(grading).toMatch(/summary.*(?:ledger|sidecar).*stamped field.*artifact.*watcher.*IPC endpoint/is);
    expect(grading).toMatch(/evidenceLocations.*added changed hunk/is);
    expect(grading).toMatch(/existing file.*bespoke-channel.*schema.*reader path/is);
    expect(grading).toMatch(/exception.*new format.*exception-changes-schema/is);
    expect(grading).toMatch(/exception moves the write but never changes schema/i);
    expect(grading).toMatch(/explicit non-findings/i);
    expect(grading).toMatch(/ConductorEvent.*ConductorEventEmitter/is);
    expect(grading).toMatch(/same-schema.*single-writer sibling ledger.*existing reader.*exceptions? A.*B/is);
    expect(grading).toMatch(/gate evidence artifacts.*committed design docs.*exception C/is);
    expect(grading).toMatch(/test files.*fixtures/is);
    expect(grading).toMatch(/APPROVED.*architecture decision record.*concern.*exception.*consumers.*reconciliation/is);
    expect(grading).toMatch(/`unapproved-channel-adr`/);
    expect(grading).toMatch(/summary.*channel.*missing.*approval.*element/is);
    expect(content).toMatch(/architecture-review.*build_review.*eventSpine.*backstop/is);
    expect(content).not.toContain('not at review time after the code exists');
  });

  it.each(fixtures)('parses the %s bypass fixture as its expected custom finding', (
    _name, concernId, summary, path, line,
  ) => {
    const sourceRegion = { path, startLine: line, endLine: line + 2, contentHash: HASH, display: 'added changed hunk' };
    const payload = parseBuildReviewCustomReviewerPayload({
      kind: 'custom-findings', version: 'v1', findings: [{
        concernId, summary, evidenceLocations: [`${path}:${line}`], sourceRegions: [sourceRegion],
      }],
    });

    expect(payload).toEqual({
      kind: 'custom-findings', version: 'v1', findings: [expect.objectContaining({
        concernId, summary, evidenceLocations: [`${path}:${line}`], sourceRegions: [sourceRegion],
      })],
    });
    expect(payload?.kind === 'custom-findings' && payload.findings).toHaveLength(1);
  });

  it('keeps the required exception wording in the exception/new-format fixture', () => {
    const [, , summary] = fixtures[5];
    expect(summary).toContain('exception moves the write but never changes schema');
  });

  it.each(nonFindingFixtures)('parses %s as a zero-finding event-spine result', (_name, _description) => {
    expect(parseBuildReviewCustomReviewerPayload({
      kind: 'custom-findings', version: 'v1', findings: [],
    })).toEqual({ kind: 'custom-findings', version: 'v1', findings: [] });
  });

  it('parses a DRAFT ADR channel as an unapproved-channel-adr finding', () => {
    expect(parseBuildReviewCustomReviewerPayload({
      kind: 'custom-findings', version: 'v1', findings: [DRAFT_ADR_CHANNEL],
    })).toEqual({
      kind: 'custom-findings', version: 'v1', findings: [DRAFT_ADR_CHANNEL],
    });
    expect(DRAFT_ADR_CHANNEL.summary).toMatch(/IPC endpoint.*approval.*consumers.*reconciliation story/i);
  });
});
