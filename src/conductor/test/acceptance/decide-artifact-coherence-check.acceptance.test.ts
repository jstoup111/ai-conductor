// Acceptance specs for the DECIDE artifact coherence check
// (jstoup111/ai-conductor#539, .docs/stories/decide-artifact-coherence-check.md,
// PRD .docs/specs/2026-07-22-decide-artifact-coherence-check.md FR-1..14).
//
// WHY THESE DRIVE THE REAL `landSpec` ENTRY POINT (skill §3b/§3d):
//   The coherence gate is a new rung wired INTO `landSpec` (plan Task 16 —
//   "insert one block in land-spec.ts after the existing DRAFT-ADR gate:
//   await runCoherenceGate(...)"). A unit test that called the new
//   `validateCoherence`/`runCoherenceGate` function directly would pass even
//   while the live `landSpec` still lands an incoherent spec — the exact
//   orphaned-primitive bug class the skill's §3b exists to prevent. So every
//   coherence assertion below drives the REAL production landing primitive
//   (`landSpec`) against a real on-disk per-idea worktree seeded with real
//   DECIDE artifacts, and asserts the OBSERVABLE outcome (land refused with the
//   named gap id, or a silent successful land + committed marker) — never a
//   validator return value in isolation.
//
//   These files deliberately import ONLY existing modules (`landSpec`,
//   `createEngineerWorktree`). They do NOT import the not-yet-authored
//   coherence-validator/coherence-waiver modules — importing a missing symbol
//   would ERROR the whole file at collection (a no-op, not RED). Instead each
//   spec exercises the real seam and fails because `landSpec` does not yet
//   refuse the incoherent chain (it lands it today) — correct pre-implementation
//   RED for the right reason: the gate is not wired.
//
// PRE-IMPLEMENTATION STATE: today `landSpec` has no coherence rung, so every
// "incoherent chain must be refused" spec currently RESOLVES (lands) instead of
// throwing — the `.rejects.toThrow(<gap-id>)` matcher fails. That IS the RED
// signal. The happy-path / exemption specs (S-tier lands, coherent chain lands
// silently) pass today and after — they are regression guards that must never
// flip.
//
// Layer / unit split: the outcome-staging WRITER (createEngineerWorktree side,
// FR-13 capture) and the intake-marker byte-preservation-on-rewrite (Story 1
// Task 4) are single-operation file writes covered by their own unit tests
// under /tdd (plan Tasks 1,2,4). This acceptance file owns the cross-module
// land-time flow: staged outcomes -> committed marker carries them, and the
// full coherence refusal/pass matrix at the landing boundary.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { landSpec } from '../../src/engine/engineer/land-spec.js';
import { createEngineerWorktree } from '../../src/engine/engineer/worktree-authoring.js';
import type { GhRunner } from '../../src/engine/owner-gate/identity.js';

const execFile = promisify(execFileCb);

// gh runner that resolves an owner so the fail-closed identity gate passes and
// execution reaches the (new) coherence rung. Coherent path must be silent.
const resolvingGh: GhRunner = async () => ({ stdout: 'bob\n' });

const SOURCE_REF = 'acme/app#539';
const OUTCOME_BULLETS = ['- The duplicate-spec class dies at land.', '- An unmapped outcome blocks the spec.'];

// ── Realistic DECIDE artifact fixtures (match the repo's real parsers:
//    splitStoryBlocks `## Story <id>`, plan `**Story:**`/`**Type:**`, PRD
//    `## Functional Requirements` + `FR-N`). ──────────────────────────────────

const PRD = [
  '# PRD: coherence demo',
  '',
  '**Status:** Approved',
  '**Track:** product · **Tier:** M',
  '',
  '## Functional Requirements',
  '',
  '- **FR-1 — outcome coverage.** Every outcome maps to a story.',
  '- **FR-2 — story coverage.** Every story maps to a task.',
  '',
].join('\n');

const STORIES = [
  '# Stories: coherence demo',
  '',
  '**Status:** Accepted',
  '',
  '## Story 1 — outcomes travel',
  '',
  '**Requirement:** FR-1',
  '',
  '### Acceptance Criteria',
  '#### Happy Path',
  '- Given a mapped outcome, when land validates, then it passes.',
  '#### Negative Paths',
  '- Given an unmapped outcome, when land validates, then it is rejected.',
  '',
  '## Story 2 — stories map to tasks',
  '',
  '**Requirement:** FR-2',
  '',
  '### Acceptance Criteria',
  '#### Happy Path',
  '- Given a covered story, when land validates, then it passes.',
  '#### Negative Paths',
  '- Given an uncovered story, when land validates, then it is rejected.',
  '',
].join('\n');

const PLAN = [
  '# Implementation Plan: coherence demo',
  '',
  '**Stories:** .docs/stories/coherence-demo.md',
  '',
  '### Task 1: implement outcome one',
  '**Story:** Story 1 (happy path — outcomes travel)',
  '**Type:** happy-path',
  '**Files likely touched:**',
  '- src/conductor/src/engine/engineer/outcome-staging.ts',
  '',
  '### Task 2: implement story two',
  '**Story:** Story 2 (happy path — stories map)',
  '**Type:** happy-path',
  '**Files likely touched:**',
  '- src/conductor/src/engine/engineer/coherence-validator.ts',
  '',
  '## Task Dependency Graph',
  '```',
  '1 → 2',
  '```',
  '',
  '## Coverage Check',
  '',
  '| Story | Tasks |',
  '|---|---|',
  '| 1 | 1 |',
  '| 2 | 2 |',
  '',
].join('\n');

// A plausible traceability record (plan §5a: row classes outcome/fr/story/task,
// each with cited counterpart ids + a per-row verdict). The exact table grammar
// is agreed between /coherence-check and the validator; these specs assert only
// the OBSERVABLE land outcome, so the record just needs to be present + coherent
// for happy cases and mutated for negative cases.
const COHERENCE = [
  '# Coherence: coherence demo',
  '',
  '| class   | id        | maps-to  | verdict | evidence                     |',
  '|---------|-----------|----------|---------|-------------------------------|',
  '| outcome | outcome-1 | story-1  | covered | "outcome 1 maps to story 1"  |',
  '| outcome | outcome-2 | story-1  | covered | "outcome 2 maps to story 1"  |',
  '| fr      | FR-1      | story-1  | covered | "FR-1 maps to story 1"       |',
  '| fr      | FR-2      | story-2  | covered | "FR-2 maps to story 2"       |',
  '| story   | story-1   | task-1   | covered | "story 1 maps to task 1"     |',
  '| story   | story-2   | task-2   | covered | "story 2 maps to task 2"     |',
  '| task    | task-1    | story-1  | covered | "task 1 maps to story 1"     |',
  '| task    | task-2    | story-2  | covered | "task 2 maps to story 2"     |',
  '',
].join('\n');

const APPROVED_ADR = ['# ADR: coherence placement', '', '**Status:** APPROVED', '', 'Body.', ''].join('\n');

let repoPath: string;

async function git(args: string[], cwd = repoPath): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
}

function target() {
  return { name: 'alpha', canonicalPath: repoPath };
}

interface SeedOverrides {
  prd?: string | null; // null → omit (technical track / no-PRD)
  stories?: string;
  plan?: string;
  coherence?: string | null; // null → omit the traceability record
  coherenceFilename?: string; // default: <stem>.md
  tier?: string; // 'M' | 'L' | 'S'
  track?: string; // 'product' | 'technical'
  stageOutcomes?: boolean; // write .pipeline/intake-outcomes.md
  waiver?: string | null; // .docs/coherence-waivers/<stem>.md content
}

/**
 * Seed a per-idea worktree with a full, otherwise-landable-TODAY M-tier DECIDE
 * artifact set. Callers mutate one facet via `overrides` to introduce a single
 * coherence gap; the worktree still satisfies every EXISTING land guard, so any
 * refusal must come from the (new) coherence rung.
 */
async function seedWorktree(idea: string, overrides: SeedOverrides = {}): Promise<string> {
  const {
    prd = PRD,
    stories = STORIES,
    plan = PLAN,
    coherence = COHERENCE,
    coherenceFilename = 'coherence-demo.md',
    tier = 'M',
    track = 'product',
    stageOutcomes = true,
    waiver = null,
  } = overrides;

  const wt = await createEngineerWorktree(repoPath, idea);
  const dir = wt.worktreePath;
  const w = (rel: string, content: string) => writeFile(join(dir, '.docs', rel), content);

  await mkdir(join(dir, '.docs', 'specs'), { recursive: true });
  await mkdir(join(dir, '.docs', 'stories'), { recursive: true });
  await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
  await mkdir(join(dir, '.docs', 'complexity'), { recursive: true });
  await mkdir(join(dir, '.docs', 'track'), { recursive: true });

  if (prd !== null) await w('specs/coherence-demo.md', prd);
  await w('stories/coherence-demo.md', stories);
  await w('plans/coherence-demo.md', plan);
  await w('complexity/coherence-demo.md', `# Complexity\n\nTier: ${tier}\n`);
  await w('track/coherence-demo.md', `# Track\n\nTrack: ${track}\n`);

  // Non-Small tiers require conflicts + architecture + decisions to satisfy the
  // EXISTING land completeness guard (land-spec.ts step 4d). Seed them so the
  // ONLY thing a negative test changes is coherence.
  if (tier !== 'S') {
    await mkdir(join(dir, '.docs', 'conflicts'), { recursive: true });
    await mkdir(join(dir, '.docs', 'architecture'), { recursive: true });
    await mkdir(join(dir, '.docs', 'decisions'), { recursive: true });
    await w('conflicts/coherence-demo.md', '# Conflicts\n\nClean.\n');
    // Plain markdown, NO ```mermaid block, so the render gate resolves to
    // no-diagrams and never needs mmdc.
    await w('architecture/coherence-demo.md', '# Architecture\n\nComponents A and B.\n');
    await w('decisions/adr-coherence.md', APPROVED_ADR);
  }

  // Always mark that this idea's DECIDE flow ran the /coherence-check step
  // (a `.docs/coherence/` signal in the idea-attributable diff), even when a
  // test omits the actual mapping artifact — so a "missing artifact" negative
  // test exercises the fail-closed missing-artifact rule rather than the
  // no-retroactivity legacy-change-set disengage (which is for specs whose
  // diff carries NO coherence signal at all, predating the step existing).
  if (tier !== 'S') {
    await mkdir(join(dir, '.docs', 'coherence'), { recursive: true });
    await w('coherence/.gitkeep', '');
  }

  if (coherence !== null) {
    await mkdir(join(dir, '.docs', 'coherence'), { recursive: true });
    const coherenceText =
      stageOutcomes ? coherence : coherence.split('\n').filter((line) => !line.trimStart().startsWith('| outcome')).join('\n');
    await w(`coherence/${coherenceFilename}`, coherenceText);
  }

  if (waiver !== null) {
    await mkdir(join(dir, '.docs', 'coherence-waivers'), { recursive: true });
    await w('coherence-waivers/coherence-demo.md', waiver);
  }

  if (stageOutcomes) {
    // Simulate the claim-time staging writer (FR-13 capture; the writer itself
    // is unit-covered by plan Tasks 1/2). `.pipeline/` is gitignored run state.
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline', 'intake-outcomes.md'),
      [`Source-Ref: ${SOURCE_REF}`, '', '## Desired outcome', ...OUTCOME_BULLETS, ''].join('\n'),
    );
  }

  return dir;
}

function landOpts() {
  return { ownerConfig: {}, gh: resolvingGh };
}

beforeEach(async () => {
  repoPath = await mkdtemp(join(tmpdir(), 'coherence-acc-'));
  await git(['init', '-b', 'main', '-q']);
  await git(['config', 'user.email', 'test@test.com']);
  await git(['config', 'user.name', 'Test']);
  await writeFile(join(repoPath, 'README.md'), '# repo\n');
  // `.pipeline/` is gitignored run state in the real repo — mirror that so the
  // staged intake-outcomes file never trips landSpec's dirty-worktree guard.
  await writeFile(join(repoPath, '.gitignore'), '.pipeline/\n');
  await git(['add', 'README.md', '.gitignore']);
  await git(['commit', '-m', 'init']);
});

afterEach(async () => {
  await rm(repoPath, { recursive: true, force: true });
});

// ── Story 1 (FR-13): intake outcomes travel with the spec ─────────────────────
describe('Story 1 / FR-13 — outcomes committed into the intake marker at land', () => {
  it('happy: land commits the staged Desired-outcome bullets inside .docs/intake/<stem>.md', async () => {
    const wt = await seedWorktree('coherence demo', { stageOutcomes: true });

    const result = await landSpec(target(), 'coherence demo', wt, SOURCE_REF, landOpts());

    const marker = await git(['show', `${result.branch}:.docs/intake/coherence-demo.md`], wt);
    // Marker must carry BOTH the source ref and the verbatim outcome bullets.
    expect(marker).toContain(`Source-Ref: ${SOURCE_REF}`);
    for (const bullet of OUTCOME_BULLETS) {
      expect(marker).toContain(bullet);
    }
  });

  it('negative: a chat-origin idea (no staged outcomes, no sourceRef) stages nothing and lands without error', async () => {
    const wt = await seedWorktree('coherence demo', { stageOutcomes: false, coherence: COHERENCE });

    // No staging file present.
    expect(existsSync(join(wt, '.pipeline', 'intake-outcomes.md'))).toBe(false);
    // Outcome layer is not-required → the otherwise-coherent chain still lands.
    await expect(landSpec(target(), 'coherence demo', wt, undefined, landOpts())).resolves.toMatchObject({
      slug: expect.any(String),
    });
  });
});

// ── Story 2 (FR-1): auditable mapping artifact + id cross-check ────────────────
describe('Story 2 / FR-1 — mapping artifact authored + cross-checked at land', () => {
  it('happy: a coherent M-tier chain WITH a mapping artifact lands', async () => {
    const wt = await seedWorktree('coherence demo');
    await expect(landSpec(target(), 'coherence demo', wt, SOURCE_REF, landOpts())).resolves.toBeDefined();
  });

  it('negative: a mapping row citing a nonexistent story id is refused (fabricated citation)', async () => {
    const badCoherence = COHERENCE.replace(
      '| task    | task-1    | story-1  | covered | "task 1 maps to story 1"     |',
      '| task    | task-1    | story-99 | covered | "task 1 maps to story 1"     |',
    );
    const wt = await seedWorktree('coherence demo', { coherence: badCoherence });
    await expect(
      landSpec(target(), 'coherence demo', wt, SOURCE_REF, landOpts()),
    ).rejects.toThrow(/Story 99|fabricat|nonexistent/i);
  });

  it('negative: a plan-stem with no matching coherence artifact filename is refused (stem mismatch)', async () => {
    const wt = await seedWorktree('coherence demo', { coherenceFilename: 'some-other-stem.md' });
    await expect(
      landSpec(target(), 'coherence demo', wt, SOURCE_REF, landOpts()),
    ).rejects.toThrow(/missing-coherence-artifact|coherence/i);
  });
});

// ── Story 3 (FR-2): every intake outcome maps to a story ──────────────────────
describe('Story 3 / FR-2 — outcome coverage (outcome-<n>)', () => {
  it('negative: an outcome bullet with no mapping row is refused with an outcome gap id', async () => {
    // Drop the row covering the second outcome bullet.
    const gapped = COHERENCE.replace('| outcome | outcome-2 | story-1  | covered | "outcome 2 maps to story 1"  |\n', '');
    const wt = await seedWorktree('coherence demo', { coherence: gapped });
    await expect(
      landSpec(target(), 'coherence demo', wt, SOURCE_REF, landOpts()),
    ).rejects.toThrow(/outcome-\d+/i);
  });

  it('negative: an outcome row with an affirmative verdict but a blank Cited-Ids cell is refused with an outcome gap id', async () => {
    // outcome-2's row keeps its "covered" verdict but cites zero stories.
    const blankCited = COHERENCE.replace(
      '| outcome | outcome-2 | story-1  | covered | "outcome 2 maps to story 1"  |\n',
      '| outcome | outcome-2 |          | covered | "outcome 2 maps to story 1"  |\n',
    );
    const wt = await seedWorktree('coherence demo', { coherence: blankCited });
    await expect(
      landSpec(target(), 'coherence demo', wt, SOURCE_REF, landOpts()),
    ).rejects.toThrow(/outcome-\d+/i);
  });
});

// ── Story 4 (FR-3): every PRD FR maps through stories to tasks ─────────────────
describe('Story 4 / FR-3 — FR coverage, product track (fr-<N>)', () => {
  it('negative: an FR cited by no story is refused with an fr gap id', async () => {
    // Add FR-3 to the PRD but give it no covering story.
    const prd = PRD.replace(
      '- **FR-2 — story coverage.** Every story maps to a task.',
      '- **FR-2 — story coverage.** Every story maps to a task.\n- **FR-3 — orphan requirement.** Uncovered.',
    );
    const wt = await seedWorktree('coherence demo', { prd });
    await expect(
      landSpec(target(), 'coherence demo', wt, SOURCE_REF, landOpts()),
    ).rejects.toThrow(/fr-3/i);
  });

  it('negative: an FR whose only story maps to no task is refused reporting BOTH (transitive gap)', async () => {
    // Story 2 covers FR-2 but no task cites Story 2 → FR-2 transitively uncovered.
    const plan = PLAN.replace(/### Task 2:[\s\S]*?\n\n/, '');
    const coherence = COHERENCE
      .replace('| task    | task-2    | story-2  | covered | "task 2 maps to story 2"     |\n', '')
      .replace('| story   | story-2   | task-2   | covered | "story 2 maps to task 2"     |\n', '| story   | story-2   |          | covered | "story 2 not yet covered"    |\n');
    const wt = await seedWorktree('coherence demo', { plan, coherence });
    await expect(
      landSpec(target(), 'coherence demo', wt, SOURCE_REF, landOpts()),
    ).rejects.toThrow(/fr-2/i);
  });
});

// ── Story 5 (FR-4): every story maps to at least one plan task ─────────────────
describe('Story 5 / FR-4 — story coverage (story-<id>)', () => {
  it('negative: a story cited by no task is refused with a story gap id', async () => {
    // Remove Task 2 (the only task citing Story 2).
    const plan = PLAN.replace(/### Task 2:[\s\S]*?\n\n/, '');
    const wt = await seedWorktree('coherence demo', { plan });
    await expect(
      landSpec(target(), 'coherence demo', wt, SOURCE_REF, landOpts()),
    ).rejects.toThrow(/story-\S+/i);
  });

  it('negative: a stories file with zero parseable story blocks is refused (fail-closed, not trivially covered)', async () => {
    const wt = await seedWorktree('coherence demo', {
      stories: '# Stories: coherence demo\n\n**Status:** Accepted\n\nNo story blocks here.\n',
    });
    await expect(
      landSpec(target(), 'coherence demo', wt, SOURCE_REF, landOpts()),
    ).rejects.toThrow(/unparseable-stories|no.*stor/i);
  });
});

// ── Story 6 (FR-5): no orphan plan tasks ──────────────────────────────────────
describe('Story 6 / FR-5 — orphan-task detection (task-<id>)', () => {
  it('negative: a task citing only nonexistent story ids is refused with a task gap id', async () => {
    const plan = PLAN.replace('**Story:** Story 2 (happy path — stories map)', '**Story:** Story 404 (happy path)');
    const wt = await seedWorktree('coherence demo', { plan });
    await expect(
      landSpec(target(), 'coherence demo', wt, SOURCE_REF, landOpts()),
    ).rejects.toThrow(/task-\S+/i);
  });

  it('negative: an infrastructure task with an empty **Story:** line is refused (type alone does not excuse)', async () => {
    const plan = PLAN.replace(
      '**Story:** Story 2 (happy path — stories map)\n**Type:** happy-path',
      '**Story:**\n**Type:** infrastructure',
    );
    const wt = await seedWorktree('coherence demo', { plan });
    await expect(
      landSpec(target(), 'coherence demo', wt, SOURCE_REF, landOpts()),
    ).rejects.toThrow(/task-\S+/i);
  });

  it('happy: an infrastructure task with a declared supporting purpose is covered without a story id', async () => {
    const plan = PLAN.replace(
      '**Story:** Story 2 (happy path — stories map)\n**Type:** happy-path',
      '**Story:** supports the coherence validator wiring\n**Type:** infrastructure',
    ).replace('| 2 | 2 |\n', '');
    // Story 2 now has no citing task, so also drop Story 2 + its FR to keep the
    // rest of the chain coherent; this isolates the "infra task is covered" claim.
    const stories = STORIES.replace(/## Story 2 —[\s\S]*$/, '');
    const prd = PRD.replace('- **FR-2 — story coverage.** Every story maps to a task.\n', '');
    const coherence = COHERENCE
      .replace('| fr      | FR-2      | story-2  | covered | "FR-2 maps to story 2"       |\n', '')
      .replace('| story   | story-2   | task-2   | covered | "story 2 maps to task 2"     |\n', '')
      .replace('| task    | task-2    | story-2  | covered | "task 2 maps to story 2"     |\n', '');
    const wt = await seedWorktree('coherence demo', { plan, stories, prd, coherence });
    await expect(landSpec(target(), 'coherence demo', wt, SOURCE_REF, landOpts())).resolves.toBeDefined();
  });
});

// ── Story 7 (FR-6): plan coverage claims must agree with the task tree ─────────
describe('Story 7 / FR-6 — coverage-table vs task-tree consistency (claim-<row>)', () => {
  it('negative: a coverage-table row citing a phantom task id is refused with a claim gap id', async () => {
    const plan = PLAN.replace('| 2 | 2 |', '| 2 | T9 |');
    const wt = await seedWorktree('coherence demo', { plan });
    await expect(
      landSpec(target(), 'coherence demo', wt, SOURCE_REF, landOpts()),
    ).rejects.toThrow(/claim-\S+|T9/i);
  });
});

// ── Story 8 (FR-7): a second spec cannot silently claim an already-claimed intake
describe('Story 8 / FR-7 — duplicate intake claim (duplicate:<ref>)', () => {
  it('negative: a default-branch intake marker with the same Source-Ref refuses the land', async () => {
    // A previously-landed spec's marker on main claims the same intake issue.
    await mkdir(join(repoPath, '.docs', 'intake'), { recursive: true });
    await writeFile(
      join(repoPath, '.docs', 'intake', 'earlier-spec.md'),
      `# Intake origin: earlier-spec\n\nSource-Ref: ${SOURCE_REF}\nOwner: alice\n`,
    );
    await git(['add', '.docs']);
    await git(['commit', '-m', 'earlier spec claims #539']);

    const wt = await seedWorktree('coherence demo');
    await expect(
      landSpec(target(), 'coherence demo', wt, SOURCE_REF, landOpts()),
    ).rejects.toThrow(/duplicate:|earlier-spec/i);
  });

  it('happy: a non-duplicate Source-Ref lands (offline, local git only)', async () => {
    const wt = await seedWorktree('coherence demo');
    await expect(
      landSpec(target(), 'coherence demo', wt, 'acme/app#777', landOpts()),
    ).resolves.toBeDefined();
  });
});

// ── Story 9 (FR-8): waivers name gaps, are fresh, never cover silently ─────────
describe('Story 9 / FR-8 — coherence waiver', () => {
  // Introduce a real gap (unmapped outcome-2) that the waiver must name.
  const gappedCoherence = COHERENCE.replace('| outcome | outcome-2 | story-1  | covered | "outcome 2 maps to story 1"  |\n', '');

  it('happy: a fresh-in-diff waiver naming the gap with a non-empty rationale lets the land proceed', async () => {
    const waiver = 'Waives: outcome-2\n\nRationale: outcome-2 is a deferred follow-up, tracked in #540.\n';
    const wt = await seedWorktree('coherence demo', { coherence: gappedCoherence, waiver });
    await expect(landSpec(target(), 'coherence demo', wt, SOURCE_REF, landOpts())).resolves.toBeDefined();
  });

  it('negative: a waiver covering only some gaps still blocks on the unwaived remainder', async () => {
    // Two gaps: outcome-2 unmapped AND Story 2 uncovered (drop Task 2). Waive only outcome-2.
    const plan = PLAN.replace(/### Task 2:[\s\S]*?\n\n/, '');
    const waiver = 'Waives: outcome-2\n\nRationale: only the outcome gap is intentional.\n';
    const wt = await seedWorktree('coherence demo', { coherence: gappedCoherence, plan, waiver });
    await expect(
      landSpec(target(), 'coherence demo', wt, SOURCE_REF, landOpts()),
    ).rejects.toThrow(/story-\S+/i);
  });

  it('negative: a waiver with an empty Rationale is malformed and refuses the land', async () => {
    const waiver = 'Waives: outcome-2\n\nRationale:\n';
    const wt = await seedWorktree('coherence demo', { coherence: gappedCoherence, waiver });
    await expect(
      landSpec(target(), 'coherence demo', wt, SOURCE_REF, landOpts()),
    ).rejects.toThrow(/malformed|rationale|outcome-2/i);
  });

  it('negative: a waiver committed on the base branch (not in this spec change set) does not apply (freshness)', async () => {
    // Commit the waiver to main BEFORE branching the worktree — it is present in
    // the worktree tree but not part of the idea's own diff.
    await mkdir(join(repoPath, '.docs', 'coherence-waivers'), { recursive: true });
    await writeFile(
      join(repoPath, '.docs', 'coherence-waivers', 'coherence-demo.md'),
      'Waives: outcome-2\n\nRationale: stale waiver from a prior spec.\n',
    );
    await git(['add', '.docs']);
    await git(['commit', '-m', 'stale waiver on main']);

    const wt = await seedWorktree('coherence demo', { coherence: gappedCoherence, waiver: null });
    await expect(
      landSpec(target(), 'coherence demo', wt, SOURCE_REF, landOpts()),
    ).rejects.toThrow(/outcome-2/i);
  });
});

// ── Story 10 (FR-9): rejections name every gap precisely ──────────────────────
describe('Story 10 / FR-9 — precise, aggregated gap reporting', () => {
  it('negative: a chain with gaps of three different classes reports ALL of them in one refusal', async () => {
    // outcome-2 unmapped + Story 2 uncovered (Task 2 removed) + phantom coverage claim.
    const plan = PLAN.replace(/### Task 2:[\s\S]*?\n\n/, '').replace('| 2 | 2 |', '| 2 | T9 |');
    const coherence = COHERENCE
      .replace('| outcome | outcome-2 | story-1  | covered | "outcome 2 maps to story 1"  |\n', '')
      .replace('| task    | task-2    | story-2  | covered | "task 2 maps to story 2"     |\n', '')
      .replace('| story   | story-2   | task-2   | covered | "story 2 maps to task 2"     |\n', '| story   | story-2   |          | covered | "story 2 not yet covered"    |\n');
    const wt = await seedWorktree('coherence demo', { plan, coherence });

    let caught: Error | null = null;
    try {
      await landSpec(target(), 'coherence demo', wt, SOURCE_REF, landOpts());
    } catch (e) {
      caught = e instanceof Error ? e : new Error(String(e));
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toMatch(/outcome-\d+/i);
    expect(caught!.message).toMatch(/story-\S+/i);
    expect(caught!.message).toMatch(/claim-\S+|T9/i);
    // Not a generic-only failure.
    expect(caught!.message).not.toMatch(/^coherence (check )?failed\.?$/i);
  });
});

// ── Story 11 (FR-10): technical-track specs are not held to a PRD ──────────────
describe('Story 11 / FR-10 — technical-track behavior', () => {
  it('happy: a technical-track spec (no PRD) with a coherent outcomes/stories/tasks chain lands (FR layer skipped)', async () => {
    // Technical track: no PRD, stories carry no **Requirement:** FR lines.
    const stories = STORIES.replace(/\*\*Requirement:\*\* FR-\d+\n\n/g, '');
    const coherence = COHERENCE.replace('| fr      | FR-1      | story-1  | covered | "FR-1 maps to story 1"       |\n', '').replace(
      '| fr      | FR-2      | story-2  | covered | "FR-2 maps to story 2"       |\n',
      '',
    );
    const wt = await seedWorktree('coherence demo', { prd: null, track: 'technical', stories, coherence });
    await expect(landSpec(target(), 'coherence demo', wt, SOURCE_REF, landOpts())).resolves.toBeDefined();
  });

  it('negative: a technical-track spec with an unmapped outcome is still refused on the outcome gap', async () => {
    const stories = STORIES.replace(/\*\*Requirement:\*\* FR-\d+\n\n/g, '');
    const coherence = COHERENCE
      .replace('| fr      | FR-1      | story-1  | covered | "FR-1 maps to story 1"       |\n', '')
      .replace('| fr      | FR-2      | story-2  | covered | "FR-2 maps to story 2"       |\n', '')
      .replace('| outcome | outcome-2 | story-1  | covered | "outcome 2 maps to story 1"  |\n', '');
    const wt = await seedWorktree('coherence demo', { prd: null, track: 'technical', stories, coherence });
    await expect(
      landSpec(target(), 'coherence demo', wt, SOURCE_REF, landOpts()),
    ).rejects.toThrow(/outcome-\d+/i);
  });
});

// ── Story 12 (FR-11): ideas without an intake issue skip the outcome layer ─────
describe('Story 12 / FR-11 — no-intake behavior', () => {
  it('happy: a no-intake spec (no staged outcomes) with a coherent stories/tasks chain lands', async () => {
    const wt = await seedWorktree('coherence demo', { stageOutcomes: false });
    await expect(landSpec(target(), 'coherence demo', wt, undefined, landOpts())).resolves.toBeDefined();
  });

  it('negative: a no-intake spec with an orphan task is still refused on the task gap', async () => {
    const plan = PLAN.replace('**Story:** Story 2 (happy path — stories map)', '**Story:** Story 404 (happy path)');
    const wt = await seedWorktree('coherence demo', { stageOutcomes: false, plan });
    await expect(
      landSpec(target(), 'coherence demo', wt, undefined, landOpts()),
    ).rejects.toThrow(/task-\S+/i);
  });
});

// ── Story 13 (FR-12): S-tier exempt; coherent M/L land silently ────────────────
describe('Story 13 / FR-12 — S-tier exemption + silent coherent pass', () => {
  it('happy: an S-tier spec with NO coherence artifact lands (exempt — missing artifact is not a gap)', async () => {
    const wt = await seedWorktree('coherence demo', { tier: 'S', coherence: null });
    await expect(landSpec(target(), 'coherence demo', wt, SOURCE_REF, landOpts())).resolves.toBeDefined();
  });

  it('negative: an M-tier spec missing the coherence artifact is refused (S exemption never leaks to M/L)', async () => {
    const wt = await seedWorktree('coherence demo', { tier: 'M', coherence: null });
    await expect(
      landSpec(target(), 'coherence demo', wt, SOURCE_REF, landOpts()),
    ).rejects.toThrow(/missing-coherence-artifact|coherence/i);
  });
});

// ── Story 14 (FR-14): missing/empty/unparseable evidence blocks like incoherence
describe('Story 14 / FR-14 — fail-closed on missing/empty/unparseable record', () => {
  it('negative: no coherence artifact for the plan stem is refused as missing', async () => {
    const wt = await seedWorktree('coherence demo', { coherence: null });
    await expect(
      landSpec(target(), 'coherence demo', wt, SOURCE_REF, landOpts()),
    ).rejects.toThrow(/missing-coherence-artifact|coherence/i);
  });

  it('negative: an empty (whitespace-only) coherence artifact is refused as empty', async () => {
    const wt = await seedWorktree('coherence demo', { coherence: '   \n\n' });
    await expect(
      landSpec(target(), 'coherence demo', wt, SOURCE_REF, landOpts()),
    ).rejects.toThrow(/empty-coherence-artifact|empty/i);
  });

  it('negative: an unparseable coherence artifact (no table) is refused as unparseable', async () => {
    const wt = await seedWorktree('coherence demo', { coherence: '# Coherence\n\nprose only, no table at all.\n' });
    await expect(
      landSpec(target(), 'coherence demo', wt, SOURCE_REF, landOpts()),
    ).rejects.toThrow(/unparseable|parse|coherence/i);
  });

  it('happy: S-tier ordering — a missing artifact never fires the fail-closed rejection for tier S', async () => {
    const wt = await seedWorktree('coherence demo', { tier: 'S', coherence: null });
    await expect(landSpec(target(), 'coherence demo', wt, SOURCE_REF, landOpts())).resolves.toBeDefined();
  });
});
