import { mkdir, mkdtemp, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkStepCompletion } from '../../src/engine/artifacts.js';
import { persistPrdAuditVerdict } from '../../src/engine/prd-audit-verdict-store.js';

const fixturePlanPath = fileURLToPath(new URL('../fixtures/daemon-e2e/plan.md', import.meta.url));
const fixtureStoriesPath = fileURLToPath(new URL('../fixtures/daemon-e2e/stories.md', import.meta.url));

// The live daemon E2E seeds `.docs/plans/<slug>.md` and `.docs/stories/<slug>.md`
// from these fixtures and then runs the real prd_audit completion predicate.
// That predicate resolves the stories file and extracts its Given/When/Then
// criteria; a stories fixture the extractor cannot read makes prd_audit
// unsatisfiable, so the live run re-dispatches the audit until the 20-minute
// budget expires (release 1.0.0 smoke, run 33342803262). Pin the fixture to
// the extractor here so that drift fails fast and hermetically.
describe('daemon E2E fixture stories', () => {
  it('yield extractable criteria so a PASS prd-audit verdict completes prd_audit', async () => {
    const slug = 'daemon-e2e-live';
    const dir = await mkdtemp(join(tmpdir(), 'daemon-e2e-fixture-stories-'));
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    await mkdir(join(dir, '.docs/stories'), { recursive: true });
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await copyFile(fixturePlanPath, join(dir, `.docs/plans/${slug}.md`));
    await copyFile(fixtureStoriesPath, join(dir, `.docs/stories/${slug}.md`));
    await persistPrdAuditVerdict(dir, {
      complete: true,
      judgment: {
        version: 'v1',
        criterionJudgments: [{
          criterion: { storyId: '1', ordinal: 1 },
          criterionId: 'S1.1',
          grade: 'PASS',
          evidence: 'test/fixtures/daemon-e2e/touched.txt',
          rationale: 'The fixture task covers its declared criterion.',
          requirementAssociations: [],
          evidenceTaskIds: ['1'],
        }],
        noOwnerObservations: [],
      },
      diagnostics: [],
      recordedDispositions: [],
    }, { attemptId: 'fixture-run', codeStamp: 'fixture-head' });

    const result = await checkStepCompletion(dir, 'prd_audit', {
      planPath: join(dir, `.docs/plans/${slug}.md`),
      featureDesc: slug,
      sessionStartedAt: 0,
      // This fixture verifies criterion extraction, not code-stamp reuse.
      // It has no Git history from which a synthetic stamp can be preserved.
      config: { gate_code_validity: { enabled: false } },
    });

    expect(result, JSON.stringify(result)).toMatchObject({ done: true });
  });
});
