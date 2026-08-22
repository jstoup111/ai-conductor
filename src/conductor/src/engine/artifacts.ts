import { access, lstat, mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises';
import { basename, dirname, isAbsolute, join, relative } from 'path';
import type { StepName, ComplexityTier, Track } from '../types/index.js';
import type { HarnessConfig } from '../types/config.js';
import type {
  VerdictFreshnessClassification,
  VerdictFreshnessOutcome,
} from '../types/events.js';
import { slugify } from './worktree.js';
import { parseWorkRef, formatWorkRef } from './engineer/source-ref.js';
import type { GhRunner } from './pr-labels.js';
import { makeProductionGh } from './pr-labels.js';
import {
  readFlooredBody,
  readStaleHaltBanner,
  readStaleHaltTitle,
} from './halt-pr-rehabilitation.js';
import { seedTaskStatus } from './task-seed.js';
import type { GitRunner } from './rebase.js';
import { makeGitRunner } from './rebase.js';
import { gateVerdictStillValid } from './gate-code-validity.js';
import { resolveGateCodeValidityConfig } from './config.js';
import { resolveTaskIds } from './task-progress.js';
import { FULL_SUITE_EVIDENCE_PATH } from './full-suite-evidence.js';
import {
  FullSuiteVerifier,
  type FullSuiteInspectionResult,
} from './full-suite-verifier.js';
import {
  evaluateShipmentEvidence,
  resolveImplementationPrBinding,
  type ShipmentEvidenceInput,
  type ShipmentEvidenceResult,
} from './shipment-evidence.js';
import { currentCommitSha } from './project-prelude.js';
import { extractPrdFrIds } from './prd-fr-ids.js';
import {
  deriveEffectiveBuildReviewVerdict,
  parseBuildReviewAggregate,
  type BuildReviewEffectiveVerdict,
} from './build-review-aggregate.js';
import {
  resolveEffectiveBuildReviewVerdict,
  type BuildReviewEffectiveResolution,
} from './build-review-effective.js';

export type ArtifactLifecycleScope = 'feature' | 'repository' | 'run';

export type FeatureArtifactIdentityStrategy =
  | { strategy: 'plan-stem' }
  | {
      strategy: 'normalized-stem';
      stripDatePrefix?: boolean;
      stripPrefixes?: readonly string[];
    };

export type ArtifactPatternContract =
  | {
      pattern: string;
      scope: 'feature';
      identity: FeatureArtifactIdentityStrategy;
    }
  | {
      pattern: string;
      scope: Exclude<ArtifactLifecycleScope, 'feature'>;
      identity?: never;
    };

function artifactMatchesFeatureIdentity(
  artifactPath: string,
  featureIdentity: string,
  strategy: FeatureArtifactIdentityStrategy,
): boolean {
  const artifactStem = basename(artifactPath, '.md');
  const featureStem = basename(featureIdentity, '.md');
  if (strategy.strategy === 'plan-stem') return artifactStem === featureStem;

  const normalize = (stem: string): string => {
    let normalized = stem.toLowerCase();
    let previous: string;
    do {
      previous = normalized;
      if (strategy.stripDatePrefix) {
        normalized = normalized.replace(/^\d{4}-\d{2}-\d{2}-/, '');
      }
      for (const prefix of strategy.stripPrefixes ?? []) {
        const normalizedPrefix = slugify(prefix);
        if (normalizedPrefix && normalized.startsWith(`${normalizedPrefix}-`)) {
          normalized = normalized.slice(normalizedPrefix.length + 1);
        }
      }
    } while (normalized !== previous);
    return slugify(normalized);
  };

  const normalizedArtifact = normalize(artifactStem);
  const normalizedFeature = normalize(featureStem);
  return normalizedArtifact.length > 0 && normalizedArtifact === normalizedFeature;
}

export interface ArtifactResolutionContext {
  planPath?: string;
  activePlanPath?: string;
  featureDesc?: string;
  featureIdentities: readonly string[];
  changedPaths: ReadonlySet<string>;
}

export interface ArtifactResolutionResult {
  files: string[];
  diagnostic?: ArtifactResolutionDiagnostic;
  patternResults?: ArtifactPatternResolution[];
}

export interface ArtifactResolutionDiagnostic {
  code: 'missing' | 'ambiguous';
  reason: string;
}

export interface ArtifactPatternResolution {
  pattern: string;
  files: string[];
  diagnostic?: ArtifactResolutionDiagnostic;
}

export interface BuildArtifactResolutionContextOptions {
  planPath?: string;
  featureDesc?: string;
  git?: GitRunner;
}

export async function buildArtifactResolutionContext(
  projectRoot: string,
  options: BuildArtifactResolutionContextOptions = {},
): Promise<ArtifactResolutionContext> {
  const absolutePath = (path: string): string => (isAbsolute(path) ? path : join(projectRoot, path));
  let activePlanPath: string | undefined;
  try {
    const raw = await readFile(join(projectRoot, '.pipeline', 'engine-state.json'), 'utf8');
    const state = JSON.parse(raw) as Record<string, unknown>;
    if (typeof state.activePlanPath === 'string' && state.activePlanPath.trim()) {
      activePlanPath = absolutePath(state.activePlanPath);
    }
  } catch {
    // Engine state is optional; explicit identities remain authoritative.
  }

  const planPath = options.planPath ? absolutePath(options.planPath) : undefined;
  const featureIdentities = [
    planPath ? planStem(planPath) : undefined,
    activePlanPath ? planStem(activePlanPath) : undefined,
    options.featureDesc ? slugify(options.featureDesc) : undefined,
  ].filter((identity): identity is string => Boolean(identity));
  const uniqueFeatureIdentities = [...new Set(featureIdentities)];
  const changedPaths = new Set<string>();

  try {
    const git = options.git ?? makeGitRunner(projectRoot);
    const originHead = await git(['symbolic-ref', 'refs/remotes/origin/HEAD']);
    const baseRef = originHead.stdout.trim();
    if (originHead.exitCode !== 0 || !baseRef.startsWith('refs/remotes/')) throw new Error();

    const mergeBase = await git(['merge-base', baseRef.replace(/^refs\/remotes\//, ''), 'HEAD']);
    const mergeBaseSha = mergeBase.stdout.trim();
    if (mergeBase.exitCode !== 0 || !mergeBaseSha) throw new Error();

    const results = await Promise.all([
      git(['diff', '--name-only', `${mergeBaseSha}..HEAD`]),
      git(['diff', '--name-only', 'HEAD']),
      git(['ls-files', '--others', '--exclude-standard']),
    ]);
    if (results.some(({ exitCode }) => exitCode !== 0)) throw new Error();

    for (const result of results) {
      for (const rawPath of result.stdout.split(/\r?\n/)) {
        const trimmed = rawPath.trim();
        if (!trimmed) continue;
        const repoPath = isAbsolute(trimmed) ? relative(projectRoot, trimmed) : trimmed;
        const normalized = repoPath.replaceAll('\\', '/').replace(/^\.\//, '');
        if (normalized && normalized !== '..' && !normalized.startsWith('../')) {
          changedPaths.add(normalized);
        }
      }
    }
  } catch {
    changedPaths.clear();
  }

  return {
    planPath,
    activePlanPath,
    featureDesc: options.featureDesc,
    featureIdentities: uniqueFeatureIdentities,
    changedPaths,
  };
}

/**
 * Lifecycle and identity policy for every built-in artifact pattern.
 *
 * This is introduced alongside the legacy glob registry so existing consumers
 * remain unchanged. The compatibility projection becomes derived in Task 2.
 */
export const STEP_ARTIFACT_CONTRACTS = {
  bootstrap: [],
  memory: [],
  assess: [
    {
      pattern: '.docs/decisions/technical-assessment-*.md',
      scope: 'repository',
    },
  ],
  explore: [],
  prd: [
    {
      pattern: '.docs/specs/*.md',
      scope: 'feature',
      identity: { strategy: 'normalized-stem', stripDatePrefix: true },
    },
  ],
  complexity: [],
  stories: [
    {
      pattern: '.docs/stories/**/*.md',
      scope: 'feature',
      identity: { strategy: 'normalized-stem', stripDatePrefix: true },
    },
  ],
  conflict_check: [
    {
      pattern: '.docs/conflicts/*.md',
      scope: 'feature',
      identity: { strategy: 'normalized-stem', stripDatePrefix: true },
    },
  ],
  plan: [
    {
      pattern: '.docs/plans/*.md',
      scope: 'feature',
      identity: { strategy: 'plan-stem' },
    },
  ],
  coherence_check: [
    {
      pattern: '.docs/coherence/*.md',
      scope: 'feature',
      identity: { strategy: 'plan-stem' },
    },
  ],
  architecture_diagram: [
    {
      pattern: '.docs/architecture/*.md',
      scope: 'repository',
    },
  ],
  architecture_review: [
    {
      pattern: '.docs/decisions/architecture-review-*.md',
      scope: 'feature',
      identity: {
        strategy: 'normalized-stem',
        stripDatePrefix: true,
        stripPrefixes: ['architecture-review'],
      },
    },
    {
      pattern: '.docs/decisions/adr-*.md',
      scope: 'repository',
    },
  ],
  worktree: [],
  acceptance_specs: [
    'spec/acceptance/**/*',
    'spec/requests/**/*',
    'spec/system/**/*',
    'test/acceptance/**/*',
    'test/**/*',
    'tests/**/*',
    '__tests__/**/*',
    '*.test.js',
    '*.test.ts',
    '*.test.jsx',
    '*.test.tsx',
    '*.spec.js',
    '*.spec.ts',
    '*.spec.jsx',
    '*.spec.tsx',
  ].map((pattern) => ({ pattern, scope: 'repository' as const })),
  build: [{ pattern: '.pipeline/task-status.json', scope: 'run' }],
  build_review: [{ pattern: '.pipeline/build-review.json', scope: 'run' }],
  wiring_check: [],
  test_suite: [{ pattern: FULL_SUITE_EVIDENCE_PATH, scope: 'run' }],
  manual_test: [{ pattern: '.pipeline/manual-test-results.md', scope: 'run' }],
  prd_audit: [{ pattern: '.pipeline/prd-audit.md', scope: 'run' }],
  architecture_review_as_built: [
    { pattern: '.pipeline/architecture-review-as-built.md', scope: 'run' },
  ],
  retro: [
    {
      pattern: '.docs/retros/*.md',
      scope: 'feature',
      identity: { strategy: 'normalized-stem', stripDatePrefix: true },
    },
  ],
  rebase: [],
  finish: [],
  remediate: [],
  attribution_verify: [],
} satisfies Record<StepName, readonly ArtifactPatternContract[]>;

/**
 * Artifact glob patterns per step. Each pattern is `<dir>/*.md`, `<dir>/**\/*.md`,
 * or a literal filename. Empty list = step produces no file artifacts; verification
 * is skipped.
 *
 * Compatibility projection used by:
 *   - Post-step verification gate (stepHasArtifacts)
 *   - Artifact review prompt (findArtifactFiles)
 *   - Dashboard rendering (getArtifactStatus)
 *
 * STEP_ARTIFACT_CONTRACTS is the authored source of truth. Keep this projection
 * until all legacy consumers have migrated to scoped artifact resolution.
 */
export const STEP_ARTIFACT_GLOBS: Record<StepName, string[]> = Object.fromEntries(
  (Object.entries(STEP_ARTIFACT_CONTRACTS) as [
    StepName,
    readonly ArtifactPatternContract[],
  ][]).map(([step, contracts]) => [
    step,
    contracts.map(({ pattern }) => pattern),
  ]),
) as Record<StepName, string[]>;

/**
 * True if `path` exists AND its mtime is at or after `sessionStartedAt`.
 * SHIP-phase completion predicates use this to reject artifacts left over
 * from a previous conductor session — without it, a `.docs/manual-test-
 * results.md` from a prior feature, or a stale `.pipeline/finish-choice`,
 * would silently satisfy the gate.
 *
 * When `sessionStartedAt` is undefined (legacy state without the stamp,
 * or callers that opt out), returns true on file presence — fail open
 * rather than break in-flight features on upgrade.
 */
export async function fileIsFreshSinceSession(
  path: string,
  sessionStartedAt: number | undefined,
): Promise<boolean> {
  try {
    const s = await stat(path);
    if (sessionStartedAt === undefined) return true;
    return s.mtimeMs >= sessionStartedAt;
  } catch {
    return false;
  }
}

/**
 * The freshness floor a verdict artifact must meet: the per-attempt judging
 * session start when present, else the conductor-run session start. Without
 * a per-attempt floor, a review session that fails to rewrite its verdict
 * file would silently re-score a prior session's verdict forever (incident
 * 2026-07-12-wiring-reachability-gate) — the per-attempt floor makes that
 * loud instead by scoring "no fresh verdict".
 */
export function verdictFreshnessFloor(ctx: CompletionContext): number | undefined {
  return ctx.attemptStartedAt ?? ctx.sessionStartedAt;
}

/**
 * Tolerance (ms) applied to the per-attempt verdict-freshness comparison to
 * absorb filesystem timestamp lag. `attemptStartedAt` is `Date.now()` captured
 * immediately before the review dispatch (a monotonic-ish CLOCK_REALTIME read),
 * while a verdict file's mtime comes from the kernel's coarse filesystem clock,
 * which can lag wall-clock time by up to a scheduler tick (and is second- or
 * even 2s-granular on some filesystems). Without this tolerance a verdict
 * written *during* the same dispatch — the legitimate fresh case the ADR
 * assumes "passes" — can record an mtime a few ms BEFORE the captured floor and
 * be scored a false "no fresh verdict", spuriously kicking back a genuine
 * review (observed across the gate-loop/rebase-loop suites and on WSL2 locally).
 *
 * The tolerance only relaxes the *attempt* floor. A genuinely stale verdict —
 * one left by a PRIOR judging attempt — is separated from the current attempt
 * by at least a full build+review re-dispatch (seconds to minutes; the suite's
 * negative cases use a 30s gap), so a small fixed tolerance never masks real
 * staleness. The session floor (captured at run start, ≥ seconds before any
 * write) needs no tolerance and is compared exactly.
 */
export const VERDICT_FRESHNESS_FS_TOLERANCE_MS = 2000;

/**
 * The floor a verdict artifact's mtime is actually COMPARED against (as opposed
 * to the raw floor recorded in the `verdictFreshness` trace, which stays exact —
 * see `verdictFreshnessFloor`). Applies `VERDICT_FRESHNESS_FS_TOLERANCE_MS` only
 * when the floor is the per-attempt timestamp, absorbing filesystem-clock lag
 * for a verdict written during the current dispatch.
 */
export function verdictFreshnessComparand(ctx: CompletionContext): number | undefined {
  const floor = verdictFreshnessFloor(ctx);
  if (floor === undefined) return undefined;
  return ctx.attemptStartedAt !== undefined ? floor - VERDICT_FRESHNESS_FS_TOLERANCE_MS : floor;
}

export const HALT_MARKER = '.pipeline/halt-user-input-required';

/**
 * Single source of truth for deriving a plan-stem key from a plan file path.
 * The daemon (daemon-backlog.ts), the conduct path (conductor.ts), and the
 * land gate (land-spec.ts) must all key markers by the SAME stem — this
 * helper strips only the trailing `.md` extension from the basename, leaving
 * interior dots (e.g. `phase-9.3b-intake.md`) intact.
 */
export function planStem(planFilePath: string): string {
  return basename(planFilePath, '.md');
}

/**
 * Project-declared extra artifact globs for a step, drawn from config. Only the
 * acceptance_specs step honors `config.acceptance_spec_globs` today; other steps
 * have no consumer override and return []. Kept here so the gate and the
 * dashboard resolve the same effective glob set.
 */
export function extraArtifactGlobs(
  step: StepName,
  config: HarnessConfig | undefined,
): string[] {
  if (step === 'acceptance_specs') return config?.acceptance_spec_globs ?? [];
  return [];
}

/**
 * Returns the absolute paths of files matching a step's artifact globs, rooted at `dir`.
 * Supports literal filenames, `dir/*.ext`, `dir/**\/*.ext`, `dir/**\/*`, and a
 * leading `*\/` package-prefix wildcard. `extraGlobs` (project-declared) are
 * appended to the step's built-in globs.
 */
export async function findArtifactFiles(
  dir: string,
  step: StepName,
  extraGlobs: string[] = [],
): Promise<string[]> {
  const patterns = [...(STEP_ARTIFACT_GLOBS[step] ?? []), ...extraGlobs];
  if (patterns.length === 0) return [];

  const files: string[] = [];
  for (const pattern of patterns) {
    files.push(...(await matchGlob(dir, pattern)));
  }
  return files;
}

export async function resolveArtifactFiles(
  dir: string,
  step: StepName,
  context: Pick<ArtifactResolutionContext, 'featureIdentities' | 'changedPaths'>,
  extraGlobs: string[] = [],
  includePatternResults = false,
): Promise<ArtifactResolutionResult> {
  const files = new Set<string>();
  const patternResults: ArtifactPatternResolution[] = [];
  let featureCandidateCount = 0;
  let hasFeatureContract = false;
  const activeIdentity = context.featureIdentities[0];
  const identityLabel = activeIdentity
    ? `active feature "${activeIdentity}"`
    : 'the active feature (identity unavailable)';
  const diagnosticFor = (candidateCount: number): ArtifactResolutionDiagnostic => {
    if (candidateCount === 0) {
      return {
        code: 'missing',
        reason: `${step} has no artifact candidates for ${identityLabel}`,
      };
    }
    return {
      code: 'ambiguous',
      reason: `${step} has ${candidateCount} artifact candidates and none can be associated with ${identityLabel}`,
    };
  };
  for (const contract of STEP_ARTIFACT_CONTRACTS[step]) {
    const candidates = await matchGlob(dir, contract.pattern);
    if (contract.scope !== 'feature') {
      candidates.forEach((file) => files.add(file));
      patternResults.push({ pattern: contract.pattern, files: candidates });
      continue;
    }

    hasFeatureContract = true;
    featureCandidateCount += candidates.length;
    const associated = candidates.filter((file) => {
      const repoPath = relative(dir, file).replaceAll('\\', '/');
      return (
        context.changedPaths.has(repoPath) ||
        context.featureIdentities.some((identity) =>
          artifactMatchesFeatureIdentity(file, identity, contract.identity),
        )
      );
    });
    if (associated.length > 0) {
      associated.forEach((file) => files.add(file));
      patternResults.push({ pattern: contract.pattern, files: associated });
    } else if (candidates.length === 1) {
      files.add(candidates[0]);
      patternResults.push({ pattern: contract.pattern, files: [candidates[0]] });
    } else {
      patternResults.push({
        pattern: contract.pattern,
        files: [],
        diagnostic: diagnosticFor(candidates.length),
      });
    }
  }

  for (const pattern of extraGlobs) {
    const candidates = await matchGlob(dir, pattern);
    for (const file of candidates) files.add(file);
    patternResults.push({ pattern, files: candidates });
  }
  const resolvedFiles = [...files];
  const withPatterns = (result: ArtifactResolutionResult): ArtifactResolutionResult =>
    includePatternResults ? { ...result, patternResults } : result;
  if (resolvedFiles.length > 0 || !hasFeatureContract) {
    return withPatterns({ files: resolvedFiles });
  }

  return withPatterns({
    files: [],
    diagnostic: diagnosticFor(featureCandidateCount),
  });
}

/**
 * Resolve the plan file for the CURRENT feature — never an unscoped
 * `.docs/plans/*.md`[0] guess (#407: with several features in flight the
 * shared plans directory holds many files, and the alphabetically-first one
 * belonged to a different feature entirely, poisoning task-status.json and
 * halting the build gate forever).
 *
 * Resolution order:
 * 1. `.pipeline/engine-state.json` `activePlanPath` — authoritative when the
 *    plan step recorded it (interactive runs, Task 14 of #302).
 * 2. The plan whose stem equals `featureDesc` — the daemon convention
 *    (engineer/land writes `.docs/plans/<slug>.md`, and daemon-cli seeds
 *    `feature_desc` = slug).
 * 3. A single plan file on disk — unambiguous regardless of name.
 * 4. Otherwise `undefined` — multiple plans, none provably ours: never guess.
 *    Callers fail closed (the build gate reports an actionable reason rather
 *    than evaluating someone else's task list).
 */
/**
 * Record engine-appended remediation task ids in .pipeline/engine-state.json
 * (cumulative union across remediation rounds). The build completion
 * predicate reads this list back and refuses completion while any recorded
 * id's `### Task <id>` heading is missing from the plan — closing the hole
 * where a builder deletes the appended task instead of delivering it.
 */
export async function recordAppendedRemediationTaskIds(
  projectRoot: string,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  const pipelineDir = join(projectRoot, '.pipeline');
  await mkdir(pipelineDir, { recursive: true });
  const engineStatePath = join(pipelineDir, 'engine-state.json');

  let engineState: Record<string, unknown> = {};
  try {
    const existing = await readFile(engineStatePath, 'utf-8');
    engineState = JSON.parse(existing) as Record<string, unknown>;
  } catch {
    engineState = {};
  }

  const prior = Array.isArray(engineState.appendedRemediationTaskIds)
    ? engineState.appendedRemediationTaskIds.filter((v): v is string => typeof v === 'string')
    : [];
  engineState.appendedRemediationTaskIds = Array.from(new Set([...prior, ...ids]));

  await writeFile(engineStatePath, JSON.stringify(engineState, null, 2) + '\n');
}

/**
 * Read the recorded engine-appended remediation task ids (empty when the
 * engine-state file is absent or carries none — fail-open by design: a
 * recreated worktree loses .pipeline and simply disarms the removal guard).
 */
export async function readAppendedRemediationTaskIds(projectRoot: string): Promise<string[]> {
  try {
    const raw = await readFile(join(projectRoot, '.pipeline/engine-state.json'), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (Array.isArray(parsed?.appendedRemediationTaskIds)) {
      return parsed.appendedRemediationTaskIds.filter((v: unknown): v is string => typeof v === 'string');
    }
  } catch {
    // absent/invalid → no recorded ids
  }
  return [];
}

export async function resolveFeaturePlanPath(
  projectRoot: string,
  featureDesc: string | undefined,
): Promise<string | undefined> {
  try {
    const raw = await readFile(join(projectRoot, '.pipeline', 'engine-state.json'), 'utf-8');
    const engineState = JSON.parse(raw) as Record<string, unknown>;
    if (typeof engineState.activePlanPath === 'string' && engineState.activePlanPath.trim()) {
      const recorded = engineState.activePlanPath;
      return recorded.startsWith('/') ? recorded : join(projectRoot, recorded);
    }
  } catch {
    // No engine state (daemon-preseeded runs never execute the plan step) —
    // fall through to convention-based resolution.
  }

  const planFiles = await findArtifactFiles(projectRoot, 'plan');
  if (planFiles.length === 0) return undefined;
  if (planFiles.length === 1) return planFiles[0];

  if (featureDesc) {
    const bySlug = planFiles.find((p) => planStem(p) === featureDesc);
    if (bySlug) return bySlug;
  }
  return undefined;
}

/**
 * Resolve the active feature's stories doc, mirroring resolveFeaturePlanPath's
 * ladder (#407 → #441): a singleton corpus is unambiguous; otherwise match the
 * featureDesc stem, then the resolved plan's stem. Returns undefined when the
 * doc cannot be determined — callers must fail explicitly and must NEVER fall
 * back to validating the whole corpus (legacy landed stories predate the
 * structural convention and would make the gate permanently unsatisfiable).
 */
export async function resolveFeatureStoriesPath(
  projectRoot: string,
  featureDesc: string | undefined,
): Promise<string | undefined> {
  const storyFiles = await findArtifactFiles(projectRoot, 'stories');
  if (storyFiles.length === 0) return undefined;
  if (storyFiles.length === 1) return storyFiles[0];

  if (featureDesc) {
    const byDesc = storyFiles.find((s) => planStem(s) === featureDesc);
    if (byDesc) return byDesc;
  }

  const planPath = await resolveFeaturePlanPath(projectRoot, featureDesc);
  if (planPath) {
    const stem = planStem(planPath);
    const byPlanStem = storyFiles.find((s) => planStem(s) === stem);
    if (byPlanStem) return byPlanStem;
  }
  return undefined;
}

/**
 * Resolve the approved PRD files for the active feature without ever treating
 * the whole specs corpus as that feature's denominator. The identity ladder is
 * deliberately ordered: the recorded active plan is authoritative, followed
 * by the feature description convention, then the broader identity set.
 * Superseded PRDs are never approved input.
 */
export async function resolveFeaturePrdPaths(
  projectRoot: string,
  context: ArtifactResolutionContext,
): Promise<string[]> {
  const prdFiles = (await matchGlob(projectRoot, '.docs/specs/*.md')).filter(
    (path) => !basename(path).startsWith('SUPERSEDED-'),
  );
  const prdIdentity = STEP_ARTIFACT_CONTRACTS.prd[0].identity;
  const matchesIdentity = (identity: string): string[] =>
    prdFiles.filter((path) =>
      artifactMatchesFeatureIdentity(path, identity, prdIdentity),
    );

  if (context.activePlanPath) {
    const matches = matchesIdentity(planStem(context.activePlanPath));
    if (matches.length > 0) return matches;
  }

  if (context.featureDesc) {
    const matches = matchesIdentity(slugify(context.featureDesc));
    if (matches.length > 0) return matches;
  }

  return prdFiles.filter((path) =>
    context.featureIdentities.some((identity) =>
      artifactMatchesFeatureIdentity(path, identity, prdIdentity),
    ),
  );
}

/**
 * True if the step has at least one artifact on disk. True for steps that
 * produce no artifacts (nothing to verify).
 */
export async function stepHasArtifacts(
  dir: string,
  step: StepName,
): Promise<boolean> {
  const patterns = STEP_ARTIFACT_GLOBS[step];
  if (!patterns || patterns.length === 0) return true;
  const files = await findArtifactFiles(dir, step);
  return files.length > 0;
}

/**
 * Freshness-gated SHIP re-review steps whose `.pipeline/` artifact must reflect
 * THIS session. Their completion gates reject a stale (prior-session) artifact,
 * but the gate is satisfiable only if the step's agent actually rewrites the
 * file — and an unattended (print-mode) agent sometimes judges a prior-session
 * artifact "good enough" and declines to rewrite, so the gate reads it as stale
 * and loops to a HALT (observed on a resumed feature at
 * `architecture_review_as_built`). `build` is excluded: its
 * `.pipeline/task-status.json` is cumulative run STATE, not a re-review artifact.
 */
const STALE_SWEEP_STEPS: ReadonlySet<StepName> = new Set<StepName>([
  'manual_test',
  'prd_audit',
  'architecture_review_as_built',
]);

/**
 * True when `step`'s already-stamped verdict is still preserve-worthy per
 * `gateVerdictStillValid` (gate-code-validity-on-redispatch, #817) — the SAME
 * check `CUSTOM_COMPLETION_PREDICATES` uses to decide whether to skip a
 * re-run (Task 5/6). Called by the sweep BELOW `sweepStaleReviewArtifacts`
 * before it deletes a stale artifact: without this check the sweep would
 * unconditionally delete a still-valid verdict before the completion
 * predicate ever gets a chance to preserve it, silently defeating the whole
 * feature on the resume/kickback path this sweep guards (invariant C5 —
 * sweep and predicate must never disagree about validity, or you get a
 * self-contradicting state).
 *
 * Reads the SAME codeStamp source each predicate reads for its step
 * (`manual_test`'s fail-evidence marker, `prd_audit`/
 * `architecture_review_as_built`'s sidecar) — never re-derives it. Missing/
 * unreadable/unparseable source, or no `codeStamp`, → false (delete as
 * today). `build_review` and other non-sweep steps are never asked (the
 * caller only calls this for `STALE_SWEEP_STEPS`).
 */
async function sweptArtifactStillValid(
  dir: string,
  step: StepName,
  config?: HarnessConfig,
  artifactResolution?: ArtifactResolutionContext,
): Promise<boolean> {
  if (!resolveGateCodeValidityConfig(config).enabled) return false;
  const git = makeGitRunner(dir);
  const ctx = { projectRoot: dir, git };

  try {
    if (step === 'manual_test') {
      const raw = await readFile(join(dir, MANUAL_TEST_FAIL_EVIDENCE), 'utf-8');
      const marker = JSON.parse(raw) as ManualTestFailEvidence;
      // Mirrors the predicate's own cleanPass guard (Task 6): a marker
      // carrying failRows/headSha (the whitewash-guard's unresolved-FAIL
      // shape, #367) must never be spared here, or a laundering marker
      // could bypass the guard.
      const cleanPass =
        marker.codeStamp != null &&
        marker.headSha === undefined &&
        (marker.failRows === undefined || marker.failRows.length === 0);
      if (!cleanPass) return false;
      return (
        (await gateVerdictStillValid(ctx, 'manual_test', marker.codeStamp)) === 'preserve'
      );
    }
    if (step === 'prd_audit') {
      const raw = await readFile(join(dir, PRD_AUDIT_CODE_STAMP), 'utf-8');
      const marker = JSON.parse(raw) as GateCodeStampMarker;
      if (!marker.codeStamp) return false;
      const validity = await gateVerdictStillValid(ctx, 'prd_audit', marker.codeStamp);
      if (validity !== 'preserve') return false;
      // Mirrors the predicate's own premise re-check (Task 6): the sidecar's
      // presence signals "last recorded verdict was a PASS", but the report
      // about to be swept can diverge from what it was stamped from — never
      // spare a report that does not itself currently read clean.
      const report = await readFile(join(dir, '.pipeline/prd-audit.md'), 'utf-8');
      if (findUnalignedFrRows(report).length > 0) return false;
      return (await prdAuditCoverageGap(
        dir,
        artifactResolution ?? (await buildArtifactResolutionContext(dir, { git })),
        report,
      )) === null;
    }
    if (step === 'architecture_review_as_built') {
      const raw = await readFile(join(dir, ARCHITECTURE_REVIEW_AS_BUILT_CODE_STAMP), 'utf-8');
      const marker = JSON.parse(raw) as GateCodeStampMarker;
      if (!marker.codeStamp) return false;
      const validity = await gateVerdictStillValid(
        ctx,
        'architecture_review_as_built',
        marker.codeStamp,
      );
      if (validity !== 'preserve') return false;
      // Mirrors the predicate's own premise re-check (Task 6).
      const verdict = parseAsBuiltVerdict(
        await readFile(join(dir, '.pipeline/architecture-review-as-built.md'), 'utf-8'),
      );
      return verdict !== null && /^APPROVED\b/i.test(verdict);
    }
  } catch {
    // No sidecar/marker, unreadable, or unparseable — fall through to false
    // (delete as today).
  }
  return false;
}

/**
 * Before a freshness-gated re-review step (re)runs, delete its `.pipeline/`
 * run-evidence artifact(s) when they predate this session, so the step CANNOT be
 * satisfied by reusing a stale artifact the agent declined to rewrite. With the
 * file gone the agent must regenerate it (gate passes) or produce nothing (gate
 * fails honestly as "missing" — not a false "stale"/reuse loop). This is the
 * deterministic complement to the skill-prose instruction to always rewrite.
 *
 * The conductor calls this ONLY when re-entering a step that previously failed or
 * was reworked (kicked back) — never on a clean first run, which has no prior
 * attempt to reuse. This function is policy-free: it sweeps stale artifacts for
 * the gated step whenever called.
 *
 * No-op for non-sweep steps, when `sessionStartedAt` is undefined (legacy state
 * / opt-out — fail open), and for artifacts already fresh this session (e.g. a
 * within-session retry must not lose attempt 1's output). A stale artifact
 * whose codeStamp still validates (gate-code-validity-on-redispatch, #817 —
 * `sweptArtifactStillValid` above) is also SPARED, so the completion predicate
 * can preserve it (Story 7 / invariant C5) instead of forcing a needless
 * re-run. Returns the paths removed, for logging. Best-effort: an unlink race
 * is swallowed.
 */
export async function sweepStaleReviewArtifacts(
  dir: string,
  step: StepName,
  sessionStartedAt: number | undefined,
  config?: HarnessConfig,
  artifactResolution?: ArtifactResolutionContext,
): Promise<string[]> {
  if (!STALE_SWEEP_STEPS.has(step) || sessionStartedAt === undefined) return [];
  const removed: string[] = [];
  for (const f of await findArtifactFiles(dir, step)) {
    if (await fileIsFreshSinceSession(f, sessionStartedAt)) continue; // fresh → keep
    if (await sweptArtifactStillValid(dir, step, config, artifactResolution)) continue; // still code-valid → spare
    try {
      await rm(f);
      removed.push(f);
    } catch {
      /* best-effort: a concurrent unlink / permission error must not abort the step */
    }
  }
  return removed;
}

export interface CompletionResult {
  done: boolean;
  /** Human-readable description of what's missing; injected into retry prompt. */
  reason?: string;
  /**
   * Machine-readable facet code for why `done` is false. 'recording' marks
   * misses caused by the finish skill failing to record its outcome (missing/
   * stale/invalid finish-choice marker, or missing pr_url for choice='pr');
   * 'presentation' marks a pure PUBLICATION defect — every piece of evidence
   * passed and only the recorded PR's own title/body is wrong (halt
   * boilerplate, or an engine-generated placeholder instead of a `/pr`-authored
   * body). That distinction is load-bearing: a publication defect is fixed by
   * rewriting the PR body, so the loop re-dispatches `finish` rather than
   * spending an LLM remediation turn that can only launder it into a rebuild.
   * 'uncommitted' marks a build blocked by dirty worktree paths; 'other'
   * covers everything else. Undefined for backward compat (done:true, or
   * predicates that don't classify).
   */
  missing?: 'recording' | 'presentation' | 'uncommitted' | 'other';
  /**
   * Trace of the per-attempt verdict-freshness check (Task 1,
   * session-fresh-verdict-artifacts). Populated by the three dispatched-judge
   * verdict predicates (architecture_review_as_built, prd_audit, build_review)
   * on both the pass and stale paths.
   */
  verdictFreshness?: {
    artifact: string;
    mtimeMs?: number;
    floorMs?: number;
    floorSource: 'attempt' | 'session';
  } & VerdictFreshnessClassification;
  /**
   * Route-signal facet for retry-classification (issue #646). 'named-route'
   * marks a fresh, parseable, non-passing verdict (a real reviewer decision
   * that should route rather than rerun); 'absent' marks a missing, stale, or
   * unparseable verdict (no decision yet — safe to rerun). Undefined on
   * `done:true` and on predicates that don't classify.
   */
  routeClass?: 'named-route' | 'absent';
  /**
   * Why acceptance_specs RED evidence was refused. The conductor uses this
   * machine-readable class to decide whether its bounded pre-heal can repair
   * missing or malformed recording without re-running a real observed result.
   */
  acceptanceRedRefusalClass?: 'missing' | 'unparseable' | 'shape' | 'outcome';
  /** Whether acceptance_specs completed through a recorded remediation exception. */
  viaException?: boolean;
}

async function verdictFreshnessFor(
  artifact: string,
  ctx: CompletionContext,
  outcome: VerdictFreshnessOutcome,
): Promise<NonNullable<CompletionResult['verdictFreshness']>> {
  const classification: VerdictFreshnessClassification =
    outcome === 'stale_invalidated'
      ? { outcome, fresh: false }
      : { outcome, fresh: true };
  return {
    artifact,
    mtimeMs: await stat(artifact).then((s) => s.mtimeMs).catch(() => undefined),
    floorMs: verdictFreshnessFloor(ctx),
    floorSource: ctx.attemptStartedAt !== undefined ? 'attempt' : 'session',
    ...classification,
  };
}

/**
 * Custom per-step completion predicates that go beyond glob presence.
 *
 * Mirrors the bash conductor's behavior for the `build` step, which reads
 * `.pipeline/task-status.json` and requires every task's status to be
 * `completed` (lines 775–811, 1765–1784 of bin/conduct).
 */
export const FINISH_CHOICE_MARKER = '.pipeline/finish-choice';
export const FINISH_CHOICE_VALUES = ['pr', 'merge-local', 'keep', 'discard'] as const;
export type FinishChoice = (typeof FINISH_CHOICE_VALUES)[number];

/**
 * Durable per-feature record that the finish gate has already kicked a PR back
 * once for body regeneration. Bounds the kickback to a single attempt: the
 * second time the gate sees the same PR still carrying halt/placeholder
 * presentation, it applies the deterministic floor instead of refusing again,
 * so a feature can never stall on an LLM that will not converge.
 */
export const PR_BODY_REGEN_ATTEMPT_MARKER = '.pipeline/pr-body-regen-attempt.json';

/**
 * True when this feature has already been kicked back once for PR-body
 * regeneration of THIS pr_url. Keyed by URL so a different (freshly opened) PR
 * gets its own budget. Unreadable/corrupt marker → false (fail toward the
 * kickback, which is the safe direction: it never ships a placeholder).
 */
export async function readPrBodyRegenAttempt(dir: string, prUrl: string): Promise<boolean> {
  try {
    const raw = await readFile(join(dir, PR_BODY_REGEN_ATTEMPT_MARKER), 'utf-8');
    const parsed = JSON.parse(raw) as { pr_url?: unknown };
    return String(parsed.pr_url ?? '') === prUrl;
  } catch {
    return false;
  }
}

/** Persist the one-shot PR-body regeneration kickback record. Never throws. */
export async function recordPrBodyRegenAttempt(dir: string, prUrl: string): Promise<void> {
  try {
    const path = join(dir, PR_BODY_REGEN_ATTEMPT_MARKER);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      JSON.stringify({ pr_url: prUrl, attempted_at: new Date().toISOString() }, null, 2) + '\n',
      'utf-8',
    );
  } catch {
    // Best-effort: an unwritable .pipeline degrades to "always kick back",
    // which blocks rather than ships a placeholder.
  }
}

/** Context threaded through completion predicates. Optional fields fail open. */
export interface CompletionContext {
  /**
   * Optional task-local observability. Completion predicates deliberately do
   * not read this: the independent build-review verdict remains authority.
   */
  taskAttribution?: { status: 'absent' | 'valid' | 'stale' | 'mismatched'; taskId?: string };
  /** Epoch ms; predicates reject artifacts older than this when set. */
  sessionStartedAt?: number;
  /**
   * Epoch ms captured immediately before the current review dispatch (the
   * judging session that must (re)write the verdict artifact). When set,
   * the three dispatched-judge verdict predicates
   * (architecture_review_as_built, prd_audit, build_review) require the
   * verdict artifact's mtime to be at or after THIS, not just
   * `sessionStartedAt` — see `verdictFreshnessFloor`. Absent for
   * resume/backstop/legacy callers, which fall back to `sessionStartedAt`.
   */
  attemptStartedAt?: number;
  /** Used by the retro predicate to prefer slug-matched filenames. */
  featureDesc?: string;
  /** Prepared once by callers that need feature-aware generic artifact resolution. */
  artifactResolution?: Pick<
    ArtifactResolutionContext,
    'featureIdentities' | 'changedPaths'
  >;
  /**
   * Resolved project config. The acceptance_specs gate reads
   * `config.acceptance_spec_globs` to extend its built-in artifact globs with
   * project-declared (e.g. monorepo) spec locations. Absent → defaults only.
   */
  config?: HarnessConfig;
  /**
   * Injectable HEAD reader for the manual_test whitewash guard (#367): resolve
   * the current commit sha of the project worktree, or null when there is no
   * usable repo. Absent/null → the guard is skipped entirely (fail-open), so
   * environments without git behave exactly as before the guard existed.
   */
  getHeadSha?: () => Promise<string | null>;
  /**
   * Injectable working-tree status reader. Returns `git status --porcelain`
   * output, or null when status cannot be determined. Absent/null/empty or a
   * thrown probe fail open, so environments without git retain their prior
   * completion behavior.
   */
  worktreeStatus?: () => Promise<string | null>;
  /** Whether the engine is running in daemon mode. Affects finish convergence (Story 2). */
  daemon?: boolean;
  /**
   * Evidence reader for push verification. Returns true if HEAD is pushed, false if not,
   * null if indeterminate. Injected by Conductor; returns undefined for non-git or legacy contexts.
   */
  isHeadPushed?: () => Promise<boolean | null>;
  /**
   * Strict durable shipment-evidence verifier. Absent → use the production
   * verifier against the current candidate commit.
   */
  shipmentEvidence?: (input: ShipmentEvidenceInput) => Promise<ShipmentEvidenceResult>;
  /**
   * Injectable gh runner for presentation checks (finish predicate Phase 2).
   * Used to verify the recorded PR's title is not stale (needs-remediation:).
   * Absent → falls back to makeProductionGh() (fail-open for testing).
   */
  gh?: GhRunner;
  /**
   * Project root directory. Used by the build predicate to seed task-status and derive completion.
   */
  projectRoot?: string;
  /**
   * Path to the plan file (absolute or relative to projectRoot). Used by the build
   * predicate to seed task-status and validate plan presence/emptiness.
   */
  planPath?: string;
  /**
   * Optional repair callback (Task 8, ADR D1 order-gate).
   *
   * Invoked during Phase 2, AFTER the presentation staleness reads (the
   * original "repair first" order made those reads structurally unreachable —
   * the repair rewrote exactly the content they looked for, so engine
   * placeholder bodies shipped to main unchallenged).
   *
   * `mode: 'capture-only'` preserves the halt narrative as a PR comment and
   * performs no title/body/label/draft mutation — used on the bounded kickback
   * pass so `/pr` still has to author a real body. `mode: 'full'` (the
   * default, for backward compatibility) additionally applies the
   * deterministic last-resort floor.
   *
   * If the injectable is absent, repair is skipped (backward compatible).
   * If repair throws, a warning is logged and the gate proceeds (warn-only).
   */
  repairFinishPr?: (
    prUrl: string,
    opts?: { mode?: 'capture-only' | 'full' },
  ) => Promise<void>;
  /**
   * Self-host release disposition preservation is a correctness boundary: a
   * failed repair must block finish rather than use the normal warn-only
   * presentation-repair fallback.
   */
  releaseMetadataPreservationRequired?: boolean;
  /**
   * Process-free current-PASS inspection for the native test_suite gate.
   * Conductor injects its shared verifier; standalone completion checks use a
   * verifier rooted at `dir`. This must never call ensure()/launch the suite.
   */
  fullSuiteInspect?: () => Promise<FullSuiteInspectionResult>;
  /**
   * Injectable git runner for the gate-code-validity-on-redispatch decision
   * (`gateVerdictStillValid`, #817): a judged gate's stamped PASS verdict can
   * be preserved across re-dispatch when the code hasn't changed in its
   * surface since the stamp. Absent → predicates default to
   * `makeGitRunner(dir)` (same convention as `Conductor`'s own call sites,
   * e.g. `conductor.ts`'s `const git = makeGitRunner(this.projectRoot);`),
   * so real callers need not wire this; tests inject a scratch-repo runner.
   */
  git?: GitRunner;
  /**
   * Resolves the current feature's accepted-risk state for a strict fan-out
   * build-review aggregate. Scalar legacy verdicts never call this seam.
   */
  buildReviewEffectiveResolver?: (
    projectRoot: string,
    aggregate: unknown,
  ) => Promise<BuildReviewEffectiveResolution>;
}

/**
 * Return dirty paths reported by the optional working-tree probe, or null
 * when the probe cannot establish a nonempty status. Renames report their
 * destination path so callers can inspect the current worktree filename.
 */
export async function uncommittedPathsOrNull(ctx: CompletionContext): Promise<string[] | null> {
  if (!ctx.worktreeStatus) return null;

  try {
    const porcelain = await ctx.worktreeStatus();
    if (!porcelain) return null;

    return porcelain
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .map((line) => {
        const path = line.slice(3);
        if (!/[RC]/.test(line.slice(0, 2))) return path;
        const renameSeparator = path.indexOf(' -> ');
        return renameSeparator === -1 ? path : path.slice(renameSeparator + 4);
      });
  } catch {
    return null;
  }
}

async function dirtyWorktreeCompletionOrNull(
  ctx: CompletionContext,
): Promise<CompletionResult | null> {
  const uncommittedPaths = await uncommittedPathsOrNull(ctx);
  if (!uncommittedPaths) return null;

  const names = uncommittedPaths.slice(0, 3).join(', ');
  const more = uncommittedPaths.length > 3 ? ` (+${uncommittedPaths.length - 3} more)` : '';
  return {
    done: false,
    reason: `${uncommittedPaths.length} uncommitted paths: ${names}${more}`,
    missing: 'uncommitted',
  };
}

async function verifyDurableShipmentEvidence(
  dir: string,
  ctx: CompletionContext,
  prUrl: string,
): Promise<CompletionResult | null> {
  const candidateCommit = (await (ctx.getHeadSha?.() ?? currentCommitSha(dir))) ?? '';

  try {
    const input = {
      repoDir: dir,
      slug: ctx.featureDesc ?? '',
      implementationPr: prUrl,
      candidateCommit,
    };
    const verdict = ctx.shipmentEvidence
      ? await ctx.shipmentEvidence(input)
      : await evaluateShipmentEvidence(input, {
          githubRunner: (implementationPr) =>
            resolveImplementationPrBinding(ctx.gh ?? makeProductionGh(), dir, implementationPr),
        });
    if (verdict.kind === 'valid') return null;
    const detail = verdict.kind === 'refusal' ? verdict.code : verdict.reason;
    return {
      done: false,
      reason: `durable shipment evidence refused completion: ${detail}`,
      missing: 'other',
    };
  } catch (error) {
    return {
      done: false,
      reason: `durable shipment evidence check failed: ${error instanceof Error ? error.message : String(error)}`,
      missing: 'other',
    };
  }
}

/**
 * Run-evidence marker for the manual_test whitewash guard (#367). Written by
 * the manual_test completion gate when it observes FAIL rows; a later FAIL-free
 * results file is accepted only if HEAD moved past `headSha` (i.e. fix commits
 * exist). Gitignored run evidence, not a committed design artifact.
 */
export const MANUAL_TEST_FAIL_EVIDENCE = '.pipeline/manual-test-fail-evidence.json';

/**
 * Shape of `MANUAL_TEST_FAIL_EVIDENCE`. `codeStamp` is additive
 * (gate-code-validity-on-redispatch, #817) — the HEAD SHA the surrounding
 * manual_test verdict was formed against, written alongside (not in place
 * of) the pre-existing `headSha` FAIL-laundering guard (#367). A marker
 * written before this field existed still parses (codeStamp absent).
 */
export interface ManualTestFailEvidence {
  observedAt?: number;
  headSha?: string;
  failRows?: string[];
  codeStamp?: string | null;
}

/**
 * True when a fresh (this-session) fail-evidence marker (#367) at markerPath
 * records the SAME headSha as the one passed in. Used by the manual_test
 * SKIP-sentinel path to detect laundering: a later attempt's SKIP sentinel
 * must not be honored as done while a FAIL recorded earlier at the current
 * HEAD sha is still outstanding (no fix commits exist yet).
 */
async function hasFreshFailEvidenceAtHead(
  markerPath: string,
  headSha: string,
  sessionStartedAt: number | undefined,
): Promise<boolean> {
  let marker: { observedAt?: unknown; headSha?: unknown } | null = null;
  try {
    marker = JSON.parse(await readFile(markerPath, 'utf-8')) as {
      observedAt?: unknown;
      headSha?: unknown;
    };
  } catch {
    return false;
  }
  if (!marker || typeof marker.headSha !== 'string') return false;
  const fresh =
    sessionStartedAt === undefined ||
    (typeof marker.observedAt === 'number' && marker.observedAt >= sessionStartedAt);
  return fresh && marker.headSha === headSha;
}

/**
 * The region of a manual-test results file that carries the CURRENT verdict.
 * Append-only per-attempt files (#367) record one `## Attempt N — <ts>` section
 * per run; only the newest section's rows count, so a fixed old FAIL cannot
 * block forever while history stays visible. Sectionless files (pre-#367
 * format) are evaluated whole.
 */
export function latestAttemptRegion(content: string): string {
  const matches = [...content.matchAll(/^##\s+Attempt\s+\d+\b.*$/gim)];
  if (matches.length === 0) return content;
  const last = matches[matches.length - 1];
  return content.slice(last.index ?? 0);
}

/**
 * The FAIL rows of the manual-test results file's current verdict region, or
 * [] when the file is missing/unreadable or clean. Used by the daemon's
 * manual_test→build kickback (#367) to decide whether there is concrete bug
 * evidence to hand BUILD (no evidence → no kickback, the gate's own reason
 * halts the run instead).
 */
export async function readManualTestFailRows(dir: string): Promise<string[]> {
  let content: string;
  try {
    content = await readFile(join(dir, '.pipeline/manual-test-results.md'), 'utf-8');
  } catch {
    return [];
  }
  const rows = latestAttemptRegion(content).split('\n').filter(isManualTestFailRow);
  if (rows.length > 0) return rows;

  // Whitewash guard (#367): the latest attempt itself carries no FAIL rows
  // (e.g. a SKIP sentinel appended after a FAIL, without a fix), but the
  // fail-evidence marker still records the FAIL rows observed earlier. Fall
  // back to the marker so the manual_test→build kickback path retains
  // concrete bug evidence rather than seeing a laundered "clean" result.
  try {
    const marker = JSON.parse(
      await readFile(join(dir, MANUAL_TEST_FAIL_EVIDENCE), 'utf-8'),
    ) as { failRows?: unknown };
    if (Array.isArray(marker.failRows)) {
      return marker.failRows.filter((r): r is string => typeof r === 'string');
    }
  } catch {
    /* no marker — nothing to fall back to */
  }
  return [];
}

/**
 * True when a markdown table row's Result cell is exactly "FAIL" (case-insensitive,
 * whitespace-trimmed). Checks cell boundaries, not substring presence — a Story or
 * Notes cell containing the word "FAIL" (e.g. "FAIL kicks back to build with
 * evidence", "fail-closed verdict predicate") must never be mistaken for a failing
 * result.
 */
function isManualTestFailRow(line: string): boolean {
  return line
    .split('|')
    .map((cell) => cell.trim())
    .some((cell) => /^FAIL$/i.test(cell));
}

/**
 * Fixed, greppable sentinel marking a manual-test attempt section as
 * deliberately SKIPPED (auto mode, no endpoint/UI stories to exercise) rather
 * than a normal PASS/FAIL verdict. Written on its own line inside the
 * section so `isSkipAttempt` can detect it without parsing table rows.
 */
export const MANUAL_TEST_SKIP_SENTINEL = '<!-- manual-test:skipped -->';

/**
 * True when a manual-test attempt section was deliberately skipped (auto
 * mode, no endpoint/UI stories) rather than carrying a PASS/FAIL table.
 */
export function isSkipAttempt(section: string): boolean {
  return section
    .split('\n')
    .some((line) => line.trim() === MANUAL_TEST_SKIP_SENTINEL);
}

/**
 * Pull the value off the `Verdict:` line of an as-built review report, e.g.
 * `**Verdict:** APPROVED WITH DRIFT NOTES` → `APPROVED WITH DRIFT NOTES`.
 * Tolerates optional bold markers and an accidental double colon. Returns null
 * when there is no Verdict line (fail-closed: the gate treats that as not-done).
 */
export function parseAsBuiltVerdict(content: string): string | null {
  const m = content.match(
    /^[^\S\n]*\*{0,2}\s*Verdict\s*\*{0,2}\s*:+\s*\*{0,2}\s*(.+?)\s*\*{0,2}\s*$/im,
  );
  if (!m) return null;
  const value = m[1].replace(/\*+/g, '').trim();
  return value.length > 0 ? value : null;
}

/**
 * Run-evidence file written by the writing-system-tests skill after the RED
 * run. It records the REAL result of executing the feature's freshly-generated
 * acceptance specs so the conductor can verify they actually EXECUTED and
 * FAILED — not merely that spec files exist on disk. Gitignored run evidence,
 * not a committed design artifact.
 */
export const ACCEPTANCE_SPECS_RED_EVIDENCE = '.pipeline/acceptance-specs-red.json';

export interface AcceptanceRedRemediationException {
  kind: 'remediation';
  reason: string;
  attribution: string;
}

export interface AcceptanceSpecsGeneratedEvidence {
  outcome: 'specs-generated';
  /** The exact test command run (for the audit trail / reason messages). */
  command: string;
  /** The feature's own spec files/nodeids that this run targeted. */
  targetSpecs: string[];
  /** Tests that actually ran (passed + failed); excludes skipped/errors. */
  executed: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
  /** Identifies the tests whose failures established RED. */
  failingTests: Array<{ name: string; reason: string }>;
  /** Timestamp when the RED command ran. */
  ranAt: string;
  /** Why the observed failures prove the feature remains unimplemented. */
  intentRationale: string;
  /** Recorded authorization for a remediation that could not establish RED separately. */
  exception?: AcceptanceRedRemediationException;
  /** Raw runner summary line, e.g. pytest's "5 failed in 12.3s". */
  summary?: string;
}

export interface AcceptanceDispositionOnlyEvidence {
  outcome: 'disposition-only';
  dispositions: AcceptanceCriterionDisposition[];
}

export type AcceptanceCriterionDisposition =
  | {
      criterion: string;
      disposition: 'existing-sufficient-test';
      citation: string;
    }
  | {
      criterion: string;
      disposition: 'planned-lower-layer-test';
      citation: string;
      owningTask: string;
      layer: string;
    };

export type AcceptanceRedEvidence =
  | AcceptanceSpecsGeneratedEvidence
  | AcceptanceDispositionOnlyEvidence;

/**
 * Validate a parsed acceptance-specs RED evidence object. RED is only
 * "established" when the feature's own specs actually executed and failed:
 * a run that SKIPPED them (missing testcontainer/dependency, or a unit-only
 * test scope), deselected them, or errored at collection does NOT count — that
 * silent no-op is exactly how a daemon can declare GREEN and ship a feature
 * whose own acceptance specs then fail in CI.
 */
export function validateAcceptanceRedEvidence(
  ev: unknown,
): { ok: true } | { ok: false; reason: string; class: 'shape' | 'outcome' } {
  if (typeof ev !== 'object' || ev === null) {
    return {
      ok: false,
      class: 'shape',
      reason: `${ACCEPTANCE_SPECS_RED_EVIDENCE} is not a JSON object`,
    };
  }
  const e = ev as Record<string, unknown>;
  if (e.outcome === 'disposition-only') {
    return validateDispositionOnlyEvidence(e);
  }
  if (e.outcome !== 'specs-generated') {
    return {
      ok: false,
      class: 'shape',
      reason: `${ACCEPTANCE_SPECS_RED_EVIDENCE} must record an "outcome" of "specs-generated" or "disposition-only"`,
    };
  }
  if ('dispositions' in e) {
    return {
      ok: false,
      class: 'shape',
      reason: `${ACCEPTANCE_SPECS_RED_EVIDENCE} specs-generated evidence cannot include disposition-only records`,
    };
  }
  const num = (k: string): number | null =>
    typeof e[k] === 'number' && Number.isFinite(e[k]) ? (e[k] as number) : null;
  const failed = num('failed');
  const passed = num('passed');
  const skipped = num('skipped');
  const errors = num('errors');
  const executed = num('executed');
  if (failed === null || passed === null || skipped === null || errors === null || executed === null) {
    return {
      ok: false,
      class: 'shape',
      reason: `${ACCEPTANCE_SPECS_RED_EVIDENCE} must record numeric executed/passed/failed/skipped/errors from the real RED run`,
    };
  }
  if (errors > 0) {
    return {
      ok: false,
      class: 'outcome',
      reason: `acceptance specs errored at collection (${errors}) — they never ran; fix the specs so they execute (this is not RED)`,
    };
  }
  if (skipped > 0) {
    return {
      ok: false,
      class: 'outcome',
      reason: `${skipped} acceptance spec(s) were SKIPPED — a skipped spec does not establish RED (missing testcontainer/dependency, or a unit-only test scope?). Bring up the required infra and run the feature's specs so they actually execute`,
    };
  }
  if (executed < 1) {
    return {
      ok: false,
      class: 'outcome',
      reason: `acceptance-specs RED run executed 0 tests — the command did not select the feature's specs`,
    };
  }
  const hasRemediationException = hasRecordedRemediationException(e.exception);
  if ('exception' in e && !hasRemediationException) {
    return {
      ok: false,
      class: 'shape',
      reason: `${ACCEPTANCE_SPECS_RED_EVIDENCE} must record a remediation "exception" with a non-empty reason and attribution`,
    };
  }
  if (failed < 1 && !hasRemediationException) {
    return {
      ok: false,
      class: 'outcome',
      reason: `acceptance-specs RED run shows 0 failed — RED not established; the generated specs must FAIL before implementation`,
    };
  }
  if (typeof e.command !== 'string' || e.command.trim() === '') {
    return {
      ok: false,
      class: 'shape',
      reason: `${ACCEPTANCE_SPECS_RED_EVIDENCE} must record the test "command" that was run`,
    };
  }
  if (!Array.isArray(e.targetSpecs) || e.targetSpecs.length === 0) {
    return {
      ok: false,
      class: 'shape',
      reason: `${ACCEPTANCE_SPECS_RED_EVIDENCE} must list the "targetSpecs" the RED run exercised`,
    };
  }
  if (
    (!hasRemediationException &&
      (!Array.isArray(e.failingTests) || e.failingTests.length === 0)) ||
    (Array.isArray(e.failingTests) &&
      e.failingTests.some(
        (test) =>
          typeof test !== 'object' ||
          test === null ||
          typeof test.name !== 'string' ||
          test.name.trim() === '' ||
          typeof test.reason !== 'string' ||
          test.reason.trim() === '',
      ))
  ) {
    return {
      ok: false,
      class: 'shape',
      reason: `${ACCEPTANCE_SPECS_RED_EVIDENCE} must list non-empty "failingTests" with a name and reason that established RED`,
    };
  }
  if (typeof e.ranAt !== 'string' || Number.isNaN(Date.parse(e.ranAt))) {
    return {
      ok: false,
      class: 'shape',
      reason: `${ACCEPTANCE_SPECS_RED_EVIDENCE} must record a parseable "ranAt" timestamp for the RED run`,
    };
  }
  if (typeof e.intentRationale !== 'string' || e.intentRationale.trim() === '') {
    return {
      ok: false,
      class: 'shape',
      reason: `${ACCEPTANCE_SPECS_RED_EVIDENCE} must record a non-empty "intentRationale" for why the failures establish RED`,
    };
  }
  return { ok: true };
}

function validateDispositionOnlyEvidence(
  e: Record<string, unknown>,
): { ok: true } | { ok: false; reason: string; class: 'shape' } {
  if (Object.keys(e).some((key) => key !== 'outcome' && key !== 'dispositions')) {
    return {
      ok: false,
      class: 'shape',
      reason: `${ACCEPTANCE_SPECS_RED_EVIDENCE} disposition-only evidence cannot include RED-run fields`,
    };
  }
  if (!Array.isArray(e.dispositions) || e.dispositions.length === 0) {
    return {
      ok: false,
      class: 'shape',
      reason: `${ACCEPTANCE_SPECS_RED_EVIDENCE} disposition-only evidence must list every happy and negative criterion`,
    };
  }
  const criteria = new Set<string>();
  for (const record of e.dispositions) {
    if (typeof record !== 'object' || record === null || Array.isArray(record)) {
      return invalidDispositionRecord();
    }
    const disposition = record as Record<string, unknown>;
    const criterion = disposition.criterion;
    const citation = disposition.citation;
    if (
      typeof criterion !== 'string' || criterion.trim() === '' ||
      typeof citation !== 'string' || !isVerifiableCitation(citation) ||
      criteria.has(criterion)
    ) {
      return invalidDispositionRecord();
    }
    criteria.add(criterion);
    if (disposition.disposition === 'existing-sufficient-test') {
      if (!hasOnlyKeys(disposition, ['criterion', 'disposition', 'citation'])) return invalidDispositionRecord();
      continue;
    }
    if (
      disposition.disposition !== 'planned-lower-layer-test' ||
      !hasOnlyKeys(disposition, ['criterion', 'disposition', 'citation', 'owningTask', 'layer']) ||
      typeof disposition.owningTask !== 'string' || disposition.owningTask.trim() === '' ||
      typeof disposition.layer !== 'string' || disposition.layer.trim() === ''
    ) {
      return invalidDispositionRecord();
    }
  }
  return { ok: true };
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isVerifiableCitation(value: string): boolean {
  return /\S+:\d+(?::\d+)?$/.test(value.trim());
}

function invalidDispositionRecord(): { ok: false; reason: string; class: 'shape' } {
  return {
    ok: false,
    class: 'shape',
    reason: `${ACCEPTANCE_SPECS_RED_EVIDENCE} disposition-only records must use exactly existing-sufficient-test with a test citation or planned-lower-layer-test with citation, owningTask, and layer`,
  };
}

/**
 * Filename stem of an acceptance spec, with test-framework suffixes stripped
 * (e.g. `my-feature.acceptance.test.ts` → `my-feature`), so the stem can be
 * compared against a feature identity via `artifactMatchesFeatureIdentity`.
 */
function acceptanceSpecStem(file: string): string {
  return basename(file)
    .replace(/\.[A-Za-z0-9]+$/, '')
    .replace(/[._-](test|spec)$/i, '')
    .replace(/[._-](acceptance|system|e2e|integration|request)$/i, '');
}

function dispositionGroundingRefusal(reason: string): CompletionResult {
  return { done: false, acceptanceRedRefusalClass: 'shape', reason };
}

function escapeDispositionRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Ground disposition-only evidence in the feature's authoritative artifacts
 * (rem-build-review-root-cause-2). Two checks, both fail-closed:
 *
 * 1. Exhaustiveness — the records must cover every active story's happy AND
 *    negative criteria, read from the feature's stories doc, not merely be
 *    non-empty. A record covers a story-path unit when its criterion names
 *    the path type and (for multi-story docs) references `Story <id>`.
 * 2. Citation resolution — an `existing-sufficient-test` citation must point
 *    at a test file that exists on disk; a `planned-lower-layer-test` must
 *    name an owning task that exists in the feature's plan.
 *
 * Returns a refusing CompletionResult, or null when the evidence is grounded.
 */
async function groundDispositionOnlyEvidence(
  dir: string,
  ctx: CompletionContext,
  evidence: AcceptanceDispositionOnlyEvidence,
): Promise<CompletionResult | null> {
  const storiesPath = await resolveFeatureStoriesPath(dir, ctx.featureDesc);
  if (!storiesPath) {
    const desc = ctx.featureDesc ? ` for feature "${ctx.featureDesc}"` : '';
    return dispositionGroundingRefusal(
      `disposition-only evidence cannot be validated: cannot resolve this feature's stories doc${desc} — the records must be checked against the active story criteria`,
    );
  }
  let storiesText: string;
  try {
    storiesText = await readFile(storiesPath, 'utf-8');
  } catch {
    return dispositionGroundingRefusal(
      `disposition-only evidence cannot be validated: cannot read this feature's stories doc at ${relative(dir, storiesPath)}`,
    );
  }

  // Callers without a feature identity are legacy predicate users. They have
  // no authoritative feature artifact to bind, so retain their established
  // shape-only behavior rather than guessing which stories document applies.
  if (!ctx.featureDesc && !ctx.planPath && !ctx.artifactResolution) return null;

  const authoritativeCriteria = extractAuthoritativeStoryCriteria(storiesText);
  const authoritativeSet = new Set(authoritativeCriteria);
  const recordedCriteria = evidence.dispositions.map((entry) =>
    canonicalizeDispositionCriterion(entry.criterion, authoritativeCriteria),
  );
  const recordedSet = new Set(recordedCriteria);
  const unexpected = recordedCriteria.filter((criterion) => !authoritativeSet.has(criterion));
  const omitted = authoritativeCriteria.filter((criterion) => !recordedSet.has(criterion));
  if (unexpected.length > 0 || omitted.length > 0) {
    const differences = [
      unexpected.length > 0 ? `invented: ${unexpected.join(', ')}` : '',
      omitted.length > 0 ? `omitted: ${omitted.join(', ')}` : '',
    ].filter(Boolean);
    return dispositionGroundingRefusal(
      `disposition-only records must be an exact one-to-one set of the authoritative story criteria — ${differences.join('; ')}`,
    );
  }

  let planTaskIds: Set<string> | null = null;
  for (const entry of evidence.dispositions) {
    const citationFailure = await resolveDispositionCitation(dir, entry.citation);
    if (citationFailure) return dispositionGroundingRefusal(citationFailure);
    if (entry.disposition === 'existing-sufficient-test') continue;
    if (planTaskIds === null) {
      const planPath = ctx.planPath ?? (await resolveFeaturePlanPath(dir, ctx.featureDesc));
      if (!planPath) {
        const desc = ctx.featureDesc ? ` for feature "${ctx.featureDesc}"` : '';
        return dispositionGroundingRefusal(
          `disposition-only evidence cannot be validated: cannot resolve this feature's plan${desc} to verify planned-lower-layer-test owning tasks`,
        );
      }
      let planText: string;
      try {
        planText = await readFile(isAbsolute(planPath) ? planPath : join(dir, planPath), 'utf-8');
      } catch {
        return dispositionGroundingRefusal(
          `disposition-only evidence cannot be validated: cannot read this feature's plan to verify planned-lower-layer-test owning tasks`,
        );
      }
      const { parsePlanTaskPaths } = await import('./plan-task-parse.js');
      planTaskIds = new Set(parsePlanTaskPaths(planText).keys());
    }
    const trimmedTask = entry.owningTask.trim();
    const normalizedTask = trimmedTask.replace(/^task\s+/i, '');
    if (!planTaskIds.has(normalizedTask) && !planTaskIds.has(trimmedTask)) {
      return dispositionGroundingRefusal(
        `disposition-only owning task "${entry.owningTask}" does not exist in the plan — a planned-lower-layer-test must name a real plan task`,
      );
    }
  }
  return null;
}

function extractAuthoritativeStoryCriteria(storiesText: string): string[] {
  const criteria: string[] = [];
  for (const block of splitStoryBlocks(storiesText)) {
    for (const type of ['happy', 'negative'] as const) {
      const body = sectionBody(
        block.text,
        type === 'happy' ? /happy\s*path/i : /negative\s*paths?/i,
      );
      if (body === null) continue;
      const prefix = `${block.id ? `Story ${block.id} ` : ''}${type}: `;
      for (const line of body.split('\n')) {
        const match = line.match(/^\s*(?:[-*+] |\d+[.)] )(.+?)\s*$/);
        if (!match || !/\bgiven\b/i.test(match[1]) || !/\bthen\b/i.test(match[1])) continue;
        criteria.push(`${prefix}${match[1]}`);
      }
    }
  }
  return criteria;
}

function canonicalizeDispositionCriterion(criterion: string, authoritativeCriteria: string[]): string {
  const exact = criterion.trim();
  if (authoritativeCriteria.includes(exact)) return exact;

  // Prior evidence used `Story <id> happy path: <outcome>` shorthand. It is
  // unambiguous only when that story/path has one actual G/W/T criterion; a
  // multi-criterion path must use the exact authoritative statement.
  const legacy = exact.match(/^(?:(Story\s+[A-Za-z0-9.\-]+)\s+)?(happy|negative)\s+path:\s*(.+)$/i);
  if (!legacy) return exact;
  const [, storyLabel, type, summary] = legacy;
  const prefix = `${storyLabel ? `${storyLabel} ` : ''}${type.toLowerCase()}: `;
  const candidates = authoritativeCriteria.filter((candidate) =>
    candidate.toLowerCase().startsWith(prefix.toLowerCase()),
  );
  if (candidates.length !== 1 || !criterionSummaryOccursIn(candidates[0], summary)) return exact;
  return candidates[0];
}

function criterionSummaryOccursIn(criterion: string, summary: string): boolean {
  const words = summary.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return words.length > 0 && words.every((word) => criterion.toLowerCase().includes(word));
}

async function resolveDispositionCitation(dir: string, citation: string): Promise<string | null> {
  const match = citation.trim().match(/^(.*\S):(\d+)(?::(\d+))?$/);
  if (!match) {
    return `disposition-only citation does not resolve: "${citation}" — citations must name an existing file and in-range line`;
  }
  const [, citedPath, startText, endText] = match;
  const start = Number(startText);
  const end = endText === undefined ? start : Number(endText);
  const path = isAbsolute(citedPath) ? citedPath : join(dir, citedPath);
  let citedText: string;
  try {
    citedText = await readFile(path, 'utf-8');
  } catch {
    return `disposition-only citation does not resolve: "${citation}" — cited file does not exist`;
  }
  const lineCount = citedText.split('\n').length;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end > lineCount) {
    return `disposition-only citation does not resolve: "${citation}" — cited line is outside the file`;
  }
  return null;
}

function isDispositionOnlyEvidence(ev: unknown): ev is AcceptanceDispositionOnlyEvidence {
  return typeof ev === 'object' && ev !== null && (ev as Record<string, unknown>).outcome === 'disposition-only';
}

function hasRecordedRemediationException(exception: unknown): boolean {
  if (typeof exception !== 'object' || exception === null) return false;
  const candidate = exception as Record<string, unknown>;
  return (
    candidate.kind === 'remediation' &&
    typeof candidate.reason === 'string' &&
    candidate.reason.trim() !== '' &&
    typeof candidate.attribution === 'string' &&
    candidate.attribution.trim() !== ''
  );
}

/**
 * Path to the build_review judgement gate's verdict artifact. The grader
 * writes its judgement here and the engine replaces that temporary shape with
 * the canonical public verdict before the completion predicate reads it.
 * Gitignored run evidence, not a committed design artifact.
 */
export const BUILD_REVIEW_VERDICT = '.pipeline/build-review.json';

/**
 * Deletes the build_review verdict artifact (build-review-grades-plan-vs-
 * diff-against-a-stale-o, Task 7). Called on a `stale-mirage` disposition:
 * the FAIL verdict graded a stale view of the diff, so it must be discarded
 * outright rather than routed to build rework. `build_review` is deliberately
 * NOT a member of `STALE_SWEEP_STEPS` / never consulted by
 * `sweptArtifactStillValid` (gate-code-validity-on-redispatch, #817) — its
 * verdict artifact carries no `codeStamp`-preserve path that could
 * reconstruct a deleted verdict, so this removal is final: the next
 * `build_review` dispatch must write a brand-new verdict from scratch.
 * Best-effort: a missing file (already removed, or never written) is a no-op,
 * not an error.
 */
export async function removeBuildReviewVerdict(dir: string): Promise<void> {
  await rm(join(dir, BUILD_REVIEW_VERDICT), { force: true });
}

/**
 * Which rubric category the grader flagged, when the verdict is FAIL. All
 * fields optional — a grader may flag one, several, or (rarely) none of the
 * categories while still returning FAIL with free-form `reasons`.
 */
export interface BuildReviewRubric {
  /** Test asserts against its own implementation rather than real behavior. */
  tautology: boolean;
  /** Change reaches outside the task's declared scope. */
  scope: boolean;
  /** Fix addresses a symptom rather than the underlying root cause. */
  rootCause: boolean;
  /** Implementation addresses only part of the task's declared scope. */
  completeness: boolean;
}

/**
 * Detailed, independently actionable findings grouped by the rubric item
 * that failed. This is additive: older grader artifacts continue to provide
 * only the legacy free-form `reasons` array.
 */
export type BuildReviewFindings = Partial<{
  [K in keyof BuildReviewRubric]: string[];
}>;

export interface BuildReviewVerdict {
  verdict: 'PASS' | 'FAIL';
  /** Free-form explanations; required in practice for FAIL, but not enforced
   * here — an empty/absent reasons array on FAIL still parses (fail-closed
   * validation only guards the shape needed to route PASS vs FAIL safely). */
  reasons?: string[];
  /** Every independent finding for each failed rubric item. */
  findings?: BuildReviewFindings;
  rubric: BuildReviewRubric;
  /** The HEAD SHA this verdict was formed against (gate-code-validity-on-
   * redispatch, #817). Additive/optional — absent on legacy verdicts or when
   * `stampCode` had no HEAD to record (non-git checkout). Written at judge
   * dispatch (Task 3); consumed by the re-dispatch preservation check
   * (Task 5) to decide whether a PASS verdict can be trusted without a
   * re-run. Never required for a verdict to parse. */
  codeStamp?: string | null;
}

const BUILD_REVIEW_RUBRIC_NAMES = [
  'tautology',
  'scope',
  'rootCause',
  'completeness',
] as const;

/**
 * Flatten a verdict's legacy summaries and structured findings for every
 * existing consumer that needs actionable build-review feedback. Keeping the
 * legacy reasons first preserves their prior rendering and artifact contract.
 */
export function buildReviewFailureDetails(verdict: Pick<BuildReviewVerdict, 'reasons' | 'findings'>): string[] {
  const details = [...(verdict.reasons ?? [])];
  for (const rubric of BUILD_REVIEW_RUBRIC_NAMES) {
    for (const finding of verdict.findings?.[rubric] ?? []) {
      details.push(`[${rubric}] ${finding}`);
    }
  }
  return details;
}

/**
 * Completion feedback is derived from the same effective reducer used by the
 * live runner. Accepted findings remain in the raw artifact for inspection,
 * but only unresolved findings and infrastructure failures route back to
 * build.
 */
function effectiveBuildReviewFailureDetails(
  effective: BuildReviewEffectiveVerdict,
): string[] {
  const details: string[] = [];
  if (effective.unresolvedFindingIds.length > 0) {
    details.push(`unresolved findings: ${effective.unresolvedFindingIds.join(', ')}`);
  }
  if (effective.infrastructureFailureRubrics.length > 0) {
    details.push(`infrastructure failures: ${effective.infrastructureFailureRubrics.join(', ')}`);
  }
  if (details.length === 0) {
    details.push('no judged rubric result is available');
  }
  return details;
}

/**
 * Validate a parsed build_review verdict object. Fail-closed: only the exact
 * string 'PASS' is treated as passing. Anything else recognizable as FAIL
 * (the exact string 'FAIL') is a valid parse whose reasons/rubric are
 * preserved for the kickback message; anything unrecognized (malformed JSON,
 * missing required fields, or a string other than 'PASS'/'FAIL' such as
 * 'pass', 'APPROVED', or '') is invalid — the caller must treat an invalid
 * parse as FAIL, never as PASS. Missing-file handling is the completion
 * predicate's job (Task 8), not this validator's.
 */
export function validateBuildReviewVerdict(
  ev: unknown,
):
  | {
      ok: true;
      verdict: 'PASS' | 'FAIL';
      reasons?: string[];
      findings?: BuildReviewFindings;
      rubric: BuildReviewRubric;
      codeStamp?: string | null;
    }
  | { ok: false; reason: string } {
  if (typeof ev !== 'object' || ev === null) {
    return { ok: false, reason: `${BUILD_REVIEW_VERDICT} is not a JSON object` };
  }
  const e = ev as Record<string, unknown>;
  // New fan-out aggregates carry a stricter raw-results envelope in addition
  // to the legacy top-level verdict projection. A malformed envelope must not
  // be ignored merely because its compatibility fields happen to look valid.
  if (e.aggregateVersion !== undefined && (!parseBuildReviewAggregate(e) || !deriveEffectiveBuildReviewVerdict(e))) {
    return { ok: false, reason: `${BUILD_REVIEW_VERDICT} aggregate is incomplete, malformed, or identity-mismatched` };
  }
  if (e.verdict !== 'PASS' && e.verdict !== 'FAIL') {
    return {
      ok: false,
      reason: `${BUILD_REVIEW_VERDICT} "verdict" must be exactly 'PASS' or 'FAIL' (got ${JSON.stringify(e.verdict)})`,
    };
  }
  if (typeof e.rubric !== 'object' || e.rubric === null || Array.isArray(e.rubric)) {
    return {
      ok: false,
      reason: `${BUILD_REVIEW_VERDICT} must include a "rubric" object`,
    };
  }
  const rubricSrc = e.rubric as Record<string, unknown>;
  const rubric = {} as BuildReviewRubric;
  for (const rubricName of BUILD_REVIEW_RUBRIC_NAMES) {
    if (typeof rubricSrc[rubricName] !== 'boolean') {
      return {
        ok: false,
        reason: `${BUILD_REVIEW_VERDICT} "rubric.${rubricName}" must be a boolean`,
      };
    }
    rubric[rubricName] = rubricSrc[rubricName];
  }

  let findings: BuildReviewFindings | undefined;
  if (e.findings !== undefined) {
    if (typeof e.findings !== 'object' || e.findings === null || Array.isArray(e.findings)) {
      return { ok: false, reason: `${BUILD_REVIEW_VERDICT} "findings" must be an object when present` };
    }
    const source = e.findings as Record<string, unknown>;
    findings = {};
    for (const rubricName of BUILD_REVIEW_RUBRIC_NAMES) {
      const candidate = source[rubricName];
      if (candidate === undefined) continue;
      if (!Array.isArray(candidate) || candidate.some((finding) => typeof finding !== 'string')) {
        return {
          ok: false,
          reason: `${BUILD_REVIEW_VERDICT} "findings.${rubricName}" must be a string array when present`,
        };
      }
      findings[rubricName] = candidate;
    }
  }

  const failedRubrics = BUILD_REVIEW_RUBRIC_NAMES
    .filter((name) => rubric[name] === true);
  if (e.verdict === 'PASS' && failedRubrics.length > 0) {
    return {
      ok: false,
      reason: `${BUILD_REVIEW_VERDICT} "verdict" PASS requires every rubric flag to be false (failed: ${failedRubrics.join(', ')})`,
    };
  }
  if (e.verdict === 'FAIL' && failedRubrics.length === 0) {
    return {
      ok: false,
      reason: `${BUILD_REVIEW_VERDICT} "verdict" FAIL requires at least one rubric flag to be true`,
    };
  }

  const result: {
    ok: true;
    verdict: 'PASS' | 'FAIL';
    reasons?: string[];
    findings?: BuildReviewFindings;
    rubric: BuildReviewRubric;
    codeStamp?: string | null;
  } = {
    ok: true,
    verdict: e.verdict,
    rubric,
  };
  if (Array.isArray(e.reasons)) {
    result.reasons = e.reasons as string[];
  }
  if (findings !== undefined) result.findings = findings;
  if (typeof e.codeStamp === 'string' || e.codeStamp === null) {
    result.codeStamp = e.codeStamp;
  }
  return result;
}

/**
 * Convert the grader-owned judgement contract into the canonical public
 * build-review verdict. The grader names failures explicitly; the engine
 * owns the otherwise error-prone conversion to legacy `true means failed`
 * rubric booleans. Canonical legacy artifacts remain accepted so in-flight
 * providers and redispatches retain their existing fail-closed behavior.
 */
export function canonicalizeBuildReviewGraderVerdict(
  ev: unknown,
): ReturnType<typeof validateBuildReviewVerdict> {
  if (typeof ev !== 'object' || ev === null || Array.isArray(ev)) {
    return validateBuildReviewVerdict(ev);
  }
  const source = ev as Record<string, unknown>;
  if (!Object.hasOwn(source, 'failedRubrics')) {
    return validateBuildReviewVerdict(ev);
  }
  if (source.rubric !== undefined) {
    return {
      ok: false,
      reason: `${BUILD_REVIEW_VERDICT} grader output must not include both "failedRubrics" and "rubric"`,
    };
  }
  if (source.verdict !== undefined) {
    return {
      ok: false,
      reason: `${BUILD_REVIEW_VERDICT} grader output must not include "verdict"; the engine derives it from failedRubrics`,
    };
  }
  if (!Array.isArray(source.failedRubrics)) {
    return {
      ok: false,
      reason: `${BUILD_REVIEW_VERDICT} "failedRubrics" must be an array`,
    };
  }
  const allowed = new Set<string>(BUILD_REVIEW_RUBRIC_NAMES);
  const failedRubrics = source.failedRubrics;
  if (failedRubrics.some((name) => typeof name !== 'string' || !allowed.has(name))) {
    return {
      ok: false,
      reason: `${BUILD_REVIEW_VERDICT} "failedRubrics" contains an unknown rubric`,
    };
  }
  if (new Set(failedRubrics).size !== failedRubrics.length) {
    return {
      ok: false,
      reason: `${BUILD_REVIEW_VERDICT} "failedRubrics" must not contain duplicates`,
    };
  }
  const failures = new Set(failedRubrics);
  if (typeof source.findings === 'object' && source.findings !== null && !Array.isArray(source.findings)) {
    const findings = source.findings as Record<string, unknown>;
    const unknownFinding = Object.keys(findings).find((name) => !allowed.has(name));
    if (unknownFinding !== undefined) {
      return {
        ok: false,
        reason: `${BUILD_REVIEW_VERDICT} "findings" contains unknown rubric ${JSON.stringify(unknownFinding)}`,
      };
    }
    for (const name of BUILD_REVIEW_RUBRIC_NAMES) {
      const candidate = findings[name];
      if (Array.isArray(candidate) && candidate.length > 0 && !failures.has(name)) {
        return {
          ok: false,
          reason: `${BUILD_REVIEW_VERDICT} "findings.${name}" is non-empty but ${name} is not named in failedRubrics`,
        };
      }
      if (failures.has(name) && (!Array.isArray(candidate) || candidate.length === 0)) {
        return {
          ok: false,
          reason: `${BUILD_REVIEW_VERDICT} "findings.${name}" must be non-empty when ${name} is named in failedRubrics`,
        };
      }
    }
  } else if (failedRubrics.length > 0) {
    return {
      ok: false,
      reason: `${BUILD_REVIEW_VERDICT} "findings" must name every failed rubric`,
    };
  }
  const rubric = Object.fromEntries(
    BUILD_REVIEW_RUBRIC_NAMES.map((name) => [name, failures.has(name)]),
  ) as unknown as BuildReviewRubric;
  const { failedRubrics: _failedRubrics, ...canonical } = source;
  return validateBuildReviewVerdict({
    ...canonical,
    verdict: failedRubrics.length === 0 ? 'PASS' : 'FAIL',
    rubric,
  });
}

/**
 * Return the current HEAD SHA to stamp onto a freshly-written judged-gate
 * verdict (gate-code-validity-on-redispatch, #817), or `null` when no HEAD
 * is available (non-git checkout, or `ctx.getHeadSha` is absent/throws).
 * Reuses the sanctioned HEAD-read (`CompletionContext.getHeadSha`) rather
 * than introducing a new git call site.
 * Never throws — safe to call unconditionally at every verdict write point.
 */
export async function stampCode(ctx: CompletionContext): Promise<string | null> {
  if (!ctx.getHeadSha) return null;
  try {
    return await ctx.getHeadSha();
  } catch {
    return null;
  }
}

/**
 * Sidecar code-stamp marker shape for `prd_audit` and
 * `architecture_review_as_built` (gate-code-validity-on-redispatch, #817).
 * Unlike `build_review` (a JSON verdict) or `manual_test` (which already has
 * a `headSha`-bearing JSON marker), these two gates' verdicts live in
 * markdown reports — so `codeStamp` is recorded in a small adjacent JSON
 * sidecar rather than inline in the report text. Task 4 writes this at
 * judge dispatch; Task 6 reads it on the completion check. Purely additive:
 * absence of the sidecar (or of `codeStamp` within it) means "no stamp",
 * which falls back to today's mtime-freshness behavior.
 */
export interface GateCodeStampMarker {
  codeStamp?: string | null;
}

/** Sidecar path for prd_audit's code stamp (see `GateCodeStampMarker`). */
export const PRD_AUDIT_CODE_STAMP = '.pipeline/prd-audit-code-stamp.json';

/**
 * Sidecar path for architecture_review_as_built's code stamp (see
 * `GateCodeStampMarker`).
 */
export const ARCHITECTURE_REVIEW_AS_BUILT_CODE_STAMP =
  '.pipeline/architecture-review-as-built-code-stamp.json';

/**
 * Writes `{ codeStamp }` to a `GateCodeStampMarker` sidecar at true-completion
 * exit. Best-effort — never throws, never blocks returning `done: true`.
 */
async function writeGateCodeStamp(
  dir: string,
  sidecarPath: string,
  ctx: CompletionContext,
): Promise<void> {
  const codeStamp = await stampCode(ctx);
  await writeFile(
    join(dir, sidecarPath),
    JSON.stringify({ codeStamp } satisfies GateCodeStampMarker, null, 2),
    'utf-8',
  ).catch(() => {});
}

async function writePrdAuditCodeStamp(dir: string, ctx: CompletionContext): Promise<void> {
  await writeGateCodeStamp(dir, PRD_AUDIT_CODE_STAMP, ctx);
}

async function writeArchitectureReviewAsBuiltCodeStamp(
  dir: string,
  ctx: CompletionContext,
): Promise<void> {
  await writeGateCodeStamp(dir, ARCHITECTURE_REVIEW_AS_BUILT_CODE_STAMP, ctx);
}

export const CUSTOM_COMPLETION_PREDICATES: Partial<
  Record<StepName, (dir: string, ctx: CompletionContext) => Promise<CompletionResult>>
> = {
  // Build is "done" only when (a) no halt marker is present and (b) every
  // task in .pipeline/task-status.json is completed or skipped. The halt-
  // marker check exists because a pipeline session that exits at the user's
  // explicit request (e.g. "exit to harness, continue later") may leave
  // task-status.json showing all-complete from prior tasks while the
  // user-requested blocker is still open. The pipeline skill writes
  // .pipeline/halt-user-input-required in that case (skills/pipeline/SKILL.md
  // §"User-requested exit during a run"); the conductor's stall handler
  // clears it before re-checking, so a marker that survives to gate-check
  // means a true halt that bypassed the stall handler.
  //
  // Reworked to seed and derive fresh evidence on every evaluation:
  // - Calls seedTaskStatus(projectRoot, planPath) if context provides both
  // - Ensures file exists and is in consistent state (deleted/corrupt recovery)
  // - Returns false if plan is empty/missing (no executable work)
  // - Evaluates completion based on derived state (forged rows fail)
  build: async (dir: string, ctx: CompletionContext): Promise<CompletionResult> => {
    try {
      await access(join(dir, HALT_MARKER));
      return {
        done: false,
        reason: `${HALT_MARKER} is present — pipeline halted; conductor will open a recovery REPL`,
      };
    } catch {
      // No marker — proceed.
    }

    // If context provides projectRoot and planPath, seed the task status and validate the plan.
    let planText: string | undefined;
    if (ctx.projectRoot && ctx.planPath) {
      // Task 14: Read engine-recorded plan path if available
      let enginePlanPath: string | undefined;
      try {
        const engineStatePath = join(dir, '.pipeline/engine-state.json');
        const engineStateContent = await readFile(engineStatePath, 'utf-8');
        const engineState = JSON.parse(engineStateContent);
        if (engineState.activePlanPath) {
          enginePlanPath = engineState.activePlanPath;
        }
      } catch {
        // Engine state doesn't exist yet — OK, seedTaskStatus will handle it
      }

      // Seed task-status.json from the plan, ensuring file exists and is consistent.
      try {
        await seedTaskStatus(ctx.projectRoot, ctx.planPath, enginePlanPath);
      } catch (err) {
        console.error(
          `[build] seedTaskStatus failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return {
          done: false,
          reason: `failed to seed task-status from plan: ${err instanceof Error ? err.message : 'unknown error'}`,
        };
      }

      // Validate that the plan is not empty (has tasks to execute).
      try {
        planText = await readFile(ctx.planPath, 'utf-8');
      } catch {
        return {
          done: false,
          reason: 'plan file not found or unreadable; cannot verify tasks exist',
        };
      }

      // Quick check: plan must have at least one task block. The header match
      // mirrors parsePlanTaskPaths (any heading level, H9 id grammar,
      // including the bare `T<N>` shorthand with no "Task" word — #578) —
      // the old `^### Task \d+` form rejected h2 headings and every
      // remediation id (`rem-…`), reading real plans as "empty".
      //
      // A pure-alpha id requires an explicit terminator (colon, or a
      // whitespace-preceded em/en-dash) immediately after it; only an id
      // CONTAINING A DIGIT may stand bare at end-of-line (#620 fix).
      // Without that restriction, #615's widened id grammar
      // (`[A-Za-z0-9._-]+`, any word) let structural headings like
      // `## Task Graph` / `## Task Dependency Graph` — present in many
      // committed plans — read as "the plan has a task", and downstream
      // the same over-wide grammar in parsePlanTaskPaths seeded a phantom
      // task ("Graph"/"Dependency") that can never be completed, making
      // build completion permanently unsatisfiable. Real headers are
      // either separator-terminated (`### Task rem-adr-001: x`,
      // `### Task A8 — x`) or bare title-less with a digit in the id
      // (`### Task 2`, `### Task t1`, `### T0`) — never a bare
      // `Task <digitless-word>`.
      if (
        !planText.trim() ||
        !/^#{1,6}\s+(?:Task\s+[A-Za-z0-9._-]+(?::|\s[—–])|Task\s+[A-Za-z._-]*\d[A-Za-z0-9._-]*\s*$|T\d[A-Za-z0-9._-]*(?::|\s[—–])|T\d[A-Za-z0-9._-]*\s*$)/im.test(
          planText,
        )
      ) {
        return {
          done: false,
          reason: 'plan is empty or contains no tasks (### Task <id> headings required)',
        };
      }
    }

    // Task 10 (#773, extended by #859): the build predicate no longer gates
    // on the per-task evidence-ledger (the derivation engine + createTaskEvidence's
    // evidenceStamps; the derivation engine itself was deleted in Task 11).
    // Final completion authority lives solely in the build_review step's
    // completeness rubric (a fail-closed, default-on grader verdict) plus
    // the existing outcome gates — this predicate never grants final
    // acceptance itself. Its job is routing: task-status.json rows are one
    // input, and per adr-2026-07-23-trailer-union-build-step-routing.md
    // (#859) they are unioned with the set of task ids resolved from
    // `Task:` commit trailers before the row/skip check below, so a task
    // committed with a valid trailer but not yet reflected in the row
    // (or reflected as stale/absent) still routes the build step forward
    // into build_review instead of stalling. Widening this union can only
    // ever hand the build off to build_review sooner — it cannot forge
    // final completion, because build_review independently re-judges the
    // real diff on every pass regardless of how this predicate resolved.
    // It intentionally no longer cross-checks rows against an independently
    // re-derived evidence sidecar — the H6/H7/H8 anti-forgery check ("a
    // completed row with no evidenceStamps entry is never counted") is
    // retired for the same reason: build_review, not this predicate, is
    // the backstop against a forged or stale row. The derivation engine
    // that used to re-derive task-status.json from git evidence
    // (autoheal.ts's deriveCompletion/applyDerivedCompletion, wired from
    // conductor.ts's auto-heal call) was deleted entirely (feature #773,
    // Task 11) — commit-trailer stamping now serves double duty: still
    // telemetry, but also, via the trailer-union routing above, an input
    // to this predicate's handoff decision.
    if (ctx.projectRoot && ctx.planPath) {
      let planTaskIds: string[];
      try {
        const { parsePlanTaskPaths } = await import('./plan-task-parse.js');
        planTaskIds = Array.from(parsePlanTaskPaths(planText!).keys());
      } catch (err) {
        return {
          done: false,
          reason: `failed to parse plan tasks: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      if (planTaskIds.length === 0) {
        return { done: false, reason: 'no tasks in plan' };
      }

      // Engine-appended remediation tasks must not be deleted from the plan.
      // Task ids are derived from plan text, so removing a `### Task rem-*`
      // heading would silently drop the task from this predicate — letting a
      // builder "complete" a remediation round by deleting its work item.
      // The engine records every id it appends (engine-state.json); any
      // recorded id missing from the plan blocks completion until the
      // heading is restored. Fail-open when nothing was recorded (absent
      // engine-state — e.g. a recreated worktree — simply disarms the guard).
      {
        const recorded = await readAppendedRemediationTaskIds(ctx.projectRoot);
        const removed = recorded.filter((id) => !planTaskIds.includes(id));
        if (removed.length > 0) {
          const names = removed.slice(0, 3).join(', ');
          const more = removed.length > 3 ? ` (+${removed.length - 3} more)` : '';
          return {
            done: false,
            reason: `engine-appended remediation task heading(s) removed from plan: ${names}${more} — restore the ### Task heading(s); deleting a remediation task never completes it`,
          };
        }
      }

      const statusPath = join(ctx.projectRoot, '.pipeline/task-status.json');
      let raw: string;
      try {
        raw = await readFile(statusPath, 'utf-8');
      } catch {
        return {
          done: false,
          reason: 'missing .pipeline/task-status.json — the pipeline skill must create it',
        };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return { done: false, reason: 'invalid JSON in .pipeline/task-status.json' };
      }
      // #859: union rows with Task:-trailered commits via resolveTaskIds,
      // instead of filtering task-status.json rows only. A build where every
      // task is trailer-evidenced but rows are still pending/in_progress
      // (rows never explicitly flipped) previously false-halted here at
      // 100% real completion.
      const resolvedIds = await resolveTaskIds(ctx.projectRoot, planTaskIds);
      const unresolved = planTaskIds.filter((id) => !resolvedIds.has(id));

      if (unresolved.length > 0) {
        const names = unresolved.slice(0, 3).join(', ');
        const more = unresolved.length > 3 ? ` (+${unresolved.length - 3} more)` : '';
        return {
          done: false,
          reason: `${unresolved.length}/${planTaskIds.length} tasks pending/not completed: ${names}${more}`,
        };
      }

      const dirtyWorktree = await dirtyWorktreeCompletionOrNull(ctx);
      if (dirtyWorktree) return dirtyWorktree;
      return { done: true };
    }

    // No projectRoot/planPath in context (e.g. legacy callers/tests that
    // don't wire the seed+derive context): fall back to trusting the raw
    // task-status.json rows, same as before this rework.
    const statusPath = join(dir, '.pipeline/task-status.json');
    let raw: string;
    try {
      raw = await readFile(statusPath, 'utf-8');
    } catch {
      return {
        done: false,
        reason: 'missing .pipeline/task-status.json — the pipeline skill must create it',
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { done: false, reason: 'invalid JSON in .pipeline/task-status.json' };
    }
    const tasks = extractTasks(parsed);
    if (tasks.length === 0) {
      return { done: false, reason: 'no tasks in task-status.json' };
    }
    const incomplete = tasks.filter((t) => t.status !== 'completed' && t.status !== 'skipped');
    if (incomplete.length > 0) {
      const names = incomplete.slice(0, 3).map((t) => t.id ?? '?').join(', ');
      const more = incomplete.length > 3 ? ` (+${incomplete.length - 3} more)` : '';
      return {
        done: false,
        reason: `${incomplete.length}/${tasks.length} tasks not completed: ${names}${more}`,
      };
    }
    const dirtyWorktree = await dirtyWorktreeCompletionOrNull(ctx);
    if (dirtyWorktree) return dirtyWorktree;
    return { done: true };
  },

  // Acceptance specs have two explicit outcomes. Generated specs require their
  // existing genuine-RED proof; a disposition-only outcome proves every
  // criterion below this layer and therefore must have no spec files or RED-run
  // contract. Both shapes are validated before completion.
  acceptance_specs: async (dir, ctx): Promise<CompletionResult> => {
    const files = await findArtifactFiles(
      dir,
      'acceptance_specs',
      extraArtifactGlobs('acceptance_specs', ctx.config),
    );
    const evidencePath = join(dir, ACCEPTANCE_SPECS_RED_EVIDENCE);
    let raw: string;
    try {
      raw = await readFile(evidencePath, 'utf-8');
    } catch {
      return {
        done: false,
        acceptanceRedRefusalClass: 'missing',
        reason: `${ACCEPTANCE_SPECS_RED_EVIDENCE} is missing — the writing-system-tests skill must run the new specs and record the RED result (a spec that is never executed does not establish RED)`,
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        done: false,
        acceptanceRedRefusalClass: 'unparseable',
        reason: `invalid JSON in ${ACCEPTANCE_SPECS_RED_EVIDENCE}`,
      };
    }
    const verdict = validateAcceptanceRedEvidence(parsed);
    if (!verdict.ok) {
      return { done: false, reason: verdict.reason, acceptanceRedRefusalClass: verdict.class };
    }
    if (isDispositionOnlyEvidence(parsed)) {
      // rem-build-review-task13-1: the zero-spec check counts only the
      // FEATURE's own acceptance specs — the acceptance corpus is
      // repository-scoped by design, so unrelated pre-existing tests must
      // not refuse a legitimate disposition-only completion. Attribution
      // follows resolveArtifactFiles' feature association: a spec belongs
      // to the feature when it is among the feature's changed paths or its
      // filename stem matches a feature identity. With no attribution
      // context at all (legacy callers), fall back fail-closed to the
      // whole corpus, exactly as before.
      const featureIdentities = [
        ...(ctx.artifactResolution?.featureIdentities ?? []),
        ctx.planPath ? planStem(ctx.planPath) : undefined,
        ctx.featureDesc ? slugify(ctx.featureDesc) : undefined,
      ].filter((identity): identity is string => Boolean(identity));
      const changedPaths = ctx.artifactResolution?.changedPaths ?? new Set<string>();
      const hasAttributionContext = featureIdentities.length > 0 || changedPaths.size > 0;
      const featureSpecFiles = hasAttributionContext
        ? files.filter((file) => {
            const repoPath = relative(dir, file).replaceAll('\\', '/');
            return (
              changedPaths.has(repoPath) ||
              featureIdentities.some((identity) =>
                artifactMatchesFeatureIdentity(acceptanceSpecStem(file), identity, {
                  strategy: 'normalized-stem',
                  stripDatePrefix: true,
                }),
              )
            );
          })
        : files;
      if (featureSpecFiles.length > 0) {
        const named = featureSpecFiles
          .slice(0, 3)
          .map((file) => relative(dir, file).replaceAll('\\', '/'))
          .join(', ');
        return {
          done: false,
          acceptanceRedRefusalClass: 'shape',
          reason: `disposition-only acceptance evidence requires zero acceptance spec files for this feature (found: ${named})`,
        };
      }
      try {
        await access(join(dir, '.pipeline/acceptance-specs-run.json'));
        return {
          done: false,
          acceptanceRedRefusalClass: 'shape',
          reason: 'disposition-only acceptance evidence cannot include an acceptance run contract',
        };
      } catch {
        // A disposition-only outcome intentionally has no acceptance run.
      }
      const grounding = await groundDispositionOnlyEvidence(dir, ctx, parsed);
      if (grounding) return grounding;
      return { done: true, viaException: false };
    }
    if (files.length === 0) {
      return {
        done: false,
        reason:
          'no acceptance spec files present — specs-generated evidence requires failing specs',
      };
    }
    return {
      done: true,
      viaException:
        typeof parsed === 'object' &&
        parsed !== null &&
        hasRecordedRemediationException((parsed as Record<string, unknown>).exception),
    };
  },

  // Manual-test passes only when .pipeline/manual-test-results.md exists, has
  // no FAIL rows in its LATEST attempt section, was written this session, and —
  // when a FAIL was previously recorded — HEAD has moved since (fix commits
  // exist). Previously the step had no gate at all
  // (STEP_ARTIFACT_GLOBS['manual_test'] = []) — any clean REPL exit marked it
  // done with zero proof of work; and until #367 a retry could satisfy the gate
  // by simply rewriting the file as PASS with no fix (incident PR #364). The
  // results file and fail-evidence marker are run evidence (gitignored) — NOT
  // committed design artifacts.
  manual_test: async (dir, ctx): Promise<CompletionResult> => {
    const file = join(dir, '.pipeline/manual-test-results.md');
    const markerPath = join(dir, MANUAL_TEST_FAIL_EVIDENCE);

    // gate-code-validity-on-redispatch (#817, Task 6): before falling into
    // the mtime-freshness check below, see if a stamped clean-PASS marker
    // can be trusted as-is because the code hasn't changed in manual_test's
    // (all-runtime) surface since it was formed. Only a marker that is
    // UNAMBIGUOUSLY a clean prior PASS may preserve — one carrying
    // failRows/headSha (the whitewash-guard's own unresolved-FAIL shape,
    // #367) must never be short-circuited here, or a laundering marker
    // could bypass the guard below. Missing marker, parse failure, no
    // codeStamp, or any FAIL/whitewash residue all fall through unchanged
    // to the existing logic (invariant C2/C3).
    if (resolveGateCodeValidityConfig(ctx.config).enabled) {
      try {
        const raw = await readFile(markerPath, 'utf-8');
        const marker = JSON.parse(raw) as ManualTestFailEvidence;
        const cleanPass =
          marker.codeStamp != null &&
          marker.headSha === undefined &&
          (marker.failRows === undefined || marker.failRows.length === 0);
        if (cleanPass) {
          const git = ctx.git ?? makeGitRunner(dir);
          const validity = await gateVerdictStillValid({ projectRoot: dir, git }, 'manual_test', marker.codeStamp);
          if (validity === 'preserve') {
            return {
              done: true,
              verdictFreshness: await verdictFreshnessFor(file, ctx, 'preserved_surface_miss'),
            };
          }
        }
      } catch {
        // No marker, unreadable, or unparseable — fall through to the
        // existing mtime-based logic, which handles all of those cases itself.
      }
    }

    let content: string;
    try {
      content = await readFile(file, 'utf-8');
    } catch {
      return {
        done: false,
        reason: '.pipeline/manual-test-results.md is missing — the manual-test skill must record per-story PASS/FAIL results before exiting',
      };
    }
    const headSha = ctx.getHeadSha ? await ctx.getHeadSha().catch(() => null) : null;
    const region = latestAttemptRegion(content);

    // FAIL rows in the latest attempt always take precedence over the SKIP
    // sentinel: an attempt that carries both (e.g. a sentinel left over from
    // scaffolding alongside a real FAIL table row) must not be treated as
    // done just because the sentinel is present (Task 9 — sentinel/FAIL
    // ordering bug). Compute/check FAIL rows BEFORE honoring the sentinel.
    const failRows = region.split('\n').filter(isManualTestFailRow);

    // Auto-mode SKIP sentinel (#748): the latest attempt was deliberately
    // skipped (no endpoint/UI stories to exercise) rather than carrying a
    // PASS/FAIL table. Treat it as done once it's fresh for this session —
    // same freshness bar as a real PASS/FAIL attempt — so auto mode does not
    // hang the gate forever waiting for a results table that will never be
    // written. Only applies when there are no FAIL rows in this attempt.
    //
    // Whitewash guard (#367) applies here too: a SKIP sentinel appended in a
    // LATER attempt must not launder a FAIL recorded in an earlier attempt at
    // the same HEAD sha (no fix commits means no fix). Check the fail-evidence
    // marker BEFORE honoring the sentinel — a fresh marker at the current HEAD
    // sha means the gate is still blocked; fall through to the whitewash-guard
    // done:false path below instead of returning done:true here.
    if (failRows.length === 0 && isSkipAttempt(region)) {
      if (!(await fileIsFreshSinceSession(file, ctx.sessionStartedAt))) {
        return {
          done: false,
          reason: '.pipeline/manual-test-results.md exists but is stale (mtime predates this conductor session); manual-test must re-run for the current feature',
        };
      }
      const laundered = headSha ? await hasFreshFailEvidenceAtHead(markerPath, headSha, ctx.sessionStartedAt) : false;
      if (!laundered) {
        return { done: true };
      }
      // Fall through: a fresh FAIL marker exists at the current HEAD sha, so
      // the whitewash-guard block below fires with its standard reason.
    }

    if (failRows.length > 0) {
      // Record the whitewash-guard evidence: the sha this FAIL was observed at.
      // A later FAIL-free file is only accepted once HEAD moves past it.
      if (headSha) {
        await writeFile(
          markerPath,
          JSON.stringify(
            { observedAt: Date.now(), headSha, failRows: failRows.slice(0, 20) },
            null,
            2,
          ),
          'utf-8',
        ).catch(() => {
          /* best-effort evidence — the FAIL verdict below stands regardless */
        });
      }
      return {
        done: false,
        reason: '.pipeline/manual-test-results.md contains FAIL rows (latest attempt) — fix the bugs (commits required) and re-run manual-test',
      };
    }
    if (!(await fileIsFreshSinceSession(file, ctx.sessionStartedAt))) {
      return {
        done: false,
        reason: '.pipeline/manual-test-results.md exists but is stale (mtime predates this conductor session); manual-test must re-run for the current feature',
      };
    }
    // Whitewash guard (#367): a FAIL was recorded this session and the results
    // now read clean — require the fix to exist as commits (HEAD moved).
    // Fail-open when HEAD is unreadable (no seam / no repo): behaves pre-#367.
    if (headSha) {
      let marker: { observedAt?: unknown; headSha?: unknown } | null = null;
      try {
        marker = JSON.parse(await readFile(markerPath, 'utf-8')) as {
          observedAt?: unknown;
          headSha?: unknown;
        };
      } catch {
        marker = null;
      }
      if (marker && typeof marker.headSha === 'string') {
        const freshMarker =
          ctx.sessionStartedAt === undefined ||
          (typeof marker.observedAt === 'number' && marker.observedAt >= ctx.sessionStartedAt);
        if (!freshMarker) {
          await rm(markerPath, { force: true }).catch(() => {});
        } else if (marker.headSha === headSha) {
          return {
            done: false,
            reason:
              `manual-test results flipped FAIL→PASS but HEAD (${headSha.slice(0, 12)}) has not ` +
              'moved since the recorded FAIL — no new commits means no fix (whitewash guard). ' +
              'Implement and commit the fix, then re-run manual-test',
          };
        } else {
          await rm(markerPath, { force: true }).catch(() => {});
        }
      }
    }
    // Additive PASS-path telemetry (gate-code-validity-on-redispatch, #817):
    // record the HEAD sha the current PASS verdict was formed against, in
    // the same marker file used by the FAIL-path whitewash guard above.
    // Merge onto any existing marker content (there should be none at this
    // point on the fresh-flip path, but merging is defensive) rather than
    // clobbering fields the guard depends on. Best-effort — never blocks
    // returning done:true.
    if (headSha) {
      let existing: ManualTestFailEvidence = {};
      try {
        existing = JSON.parse(await readFile(markerPath, 'utf-8')) as ManualTestFailEvidence;
      } catch {
        existing = {};
      }
      await writeFile(
        markerPath,
        JSON.stringify({ ...existing, codeStamp: headSha }, null, 2),
        'utf-8',
      ).catch(() => {});
    }
    return { done: true };
  },

  // PRD-audit passes only when a fresh audit report for THIS session exists and
  // every functional-requirement (FR-N) row is ALIGNED — or an un-ALIGNED row is
  // explicitly marked ACCEPTED (a human-accepted intended divergence). A
  // MISSING / PARTIAL / DIVERGED row that is not ACCEPTED blocks the gate, so the
  // selector cannot advance to retro/finish until the gap is closed (BUILD) or
  // the PRD is amended (DECIDE) and the audit re-run. Mirrors manual_test:
  // presence + freshness + no blocking rows.
  prd_audit: async (dir, ctx): Promise<CompletionResult> => {
    // gate-code-validity-on-redispatch (#817, Task 6): before the
    // freshness/report-parsing checks below, see if the last recorded PASS
    // (the sidecar is written ONLY on the PASS path — Task 4 — so its mere
    // presence with a codeStamp IS the "last verdict was a pass" signal) can
    // be trusted as-is because the code hasn't changed in prd_audit's
    // (feature-runtime) surface since it was formed. Missing sidecar, parse
    // failure, or no codeStamp all fall through unchanged to the existing
    // mtime-based logic (invariant C2/C3).
    if (resolveGateCodeValidityConfig(ctx.config).enabled) {
      try {
        const raw = await readFile(join(dir, PRD_AUDIT_CODE_STAMP), 'utf-8');
        const marker = JSON.parse(raw) as GateCodeStampMarker;
        if (marker.codeStamp) {
          const git = ctx.git ?? makeGitRunner(dir);
          const validity = await gateVerdictStillValid({ projectRoot: dir, git }, 'prd_audit', marker.codeStamp);
          if (validity === 'preserve') {
            // The sidecar's presence signals "last recorded verdict was a
            // PASS" (Task 4 writes it only on the PASS path), but the report
            // it was stamped from can diverge from the CURRENT report on disk
            // (a later run may have rewritten the report to a blocking
            // verdict without also rewriting/removing the sidecar) — never
            // preserve past a report that does not itself currently read
            // clean. Re-check the premise directly against present content.
            const preCheckFiles = await findArtifactFiles(dir, 'prd_audit');
            if (preCheckFiles.length > 0) {
              let stillClean = true;
              const artifactResolution =
                ctx.artifactResolution ??
                (await buildArtifactResolutionContext(dir, {
                  planPath: ctx.planPath,
                  featureDesc: ctx.featureDesc,
                  git: ctx.git,
                }));
              for (const f of preCheckFiles) {
                const report = await readFile(f, 'utf-8');
                if (
                  findUnalignedFrRows(report).length > 0 ||
                  (await prdAuditCoverageGap(dir, artifactResolution, report)) !== null
                ) {
                  stillClean = false;
                  break;
                }
              }
              if (stillClean) {
                const artifact = preCheckFiles[0];
                return {
                  done: true,
                  verdictFreshness: await verdictFreshnessFor(artifact, ctx, 'preserved_surface_miss'),
                };
              }
            }
          }
        }
      } catch {
        // No sidecar, unreadable, or unparseable — fall through.
      }
    }

    const files = await findArtifactFiles(dir, 'prd_audit');
    if (files.length === 0) {
      return {
        done: false,
        reason: 'no .pipeline/prd-audit.md present — the prd-audit skill must record a per-FR verdict table',
      };
    }
    // Only consider reports written by THIS judging attempt (falls back to
    // sessionStartedAt when no per-attempt floor is present); a stale audit
    // left over from a prior feature — or a prior attempt whose session
    // failed to rewrite the verdict — must not satisfy the gate.
    const cmpFloor = verdictFreshnessComparand(ctx);
    const fresh: string[] = [];
    for (const f of files) {
      if (await fileIsFreshSinceSession(f, cmpFloor)) fresh.push(f);
    }
    if (fresh.length === 0) {
      const f = files[0];
      return {
        done: false,
        reason:
          "prd-audit verdict was not rewritten by this judging session (mtime predates the review dispatch) — scoring 'no fresh verdict'; a prior session's verdict is never reused",
        verdictFreshness: await verdictFreshnessFor(f, ctx, 'stale_invalidated'),
      };
    }
    let blockingReason: string | undefined;
    for (const f of fresh) {
      const blocking = findUnalignedFrRows(await readFile(f, 'utf-8'));
      if (blocking.length > 0) {
        const shown = blocking.slice(0, 3).join('; ');
        const more = blocking.length > 3 ? ` (+${blocking.length - 3} more)` : '';
        blockingReason = `prd-audit found un-ALIGNED FRs: ${shown}${more} — close the gap (BUILD) or amend the PRD (DECIDE), then re-audit`;
        break;
      }
    }
    const passF = fresh[0];
    const artifactResolution =
      ctx.artifactResolution ??
      (await buildArtifactResolutionContext(dir, {
        planPath: ctx.planPath,
        featureDesc: ctx.featureDesc,
        git: ctx.git,
      }));
    const coverageGap = await prdAuditCoverageGap(
      dir,
      artifactResolution,
      await readFile(passF, 'utf-8'),
    );
    if (blockingReason || coverageGap) {
      return {
        done: false,
        reason: [blockingReason, coverageGap].filter((reason): reason is string => Boolean(reason)).join('; '),
      };
    }
    const verdictFreshness = await verdictFreshnessFor(passF, ctx, 'rewritten');
    await writePrdAuditCodeStamp(dir, ctx);
    return {
      done: true,
      verdictFreshness,
    };
  },

  // As-built architecture gate is FAIL-CLOSED: it passes only when a fresh
  // report records an explicit clean approval — `APPROVED` or `APPROVED WITH
  // DRIFT NOTES` (the as-built vocabulary; see skills/architecture-review).
  // A `BLOCKED` verdict, a missing `Verdict:` line, or any unrecognized
  // verdict keeps the gate UNSATISFIED so the SHIP tail HALTs loudly rather
  // than silently shipping. This replaces the old fail-OPEN check (passed
  // unless the literal word BLOCKED appeared), which let a no-ADR / garbled
  // verdict slip through marked `done` and the loop end without DONE or HALT.
  architecture_review_as_built: async (dir, ctx): Promise<CompletionResult> => {
    // gate-code-validity-on-redispatch (#817, Task 6): mirrors prd_audit's
    // preserve-check above — the sidecar is written ONLY on the clean-
    // APPROVED PASS path (Task 4), so its mere presence with a codeStamp IS
    // the "last verdict was a pass" signal.
    if (resolveGateCodeValidityConfig(ctx.config).enabled) {
      try {
        const raw = await readFile(join(dir, ARCHITECTURE_REVIEW_AS_BUILT_CODE_STAMP), 'utf-8');
        const marker = JSON.parse(raw) as GateCodeStampMarker;
        if (marker.codeStamp) {
          const git = ctx.git ?? makeGitRunner(dir);
          const validity = await gateVerdictStillValid(
            { projectRoot: dir, git },
            'architecture_review_as_built',
            marker.codeStamp,
          );
          if (validity === 'preserve') {
            // Mirrors prd_audit's premise re-check above: the sidecar's
            // presence signals "last recorded verdict was APPROVED", but the
            // CURRENT report on disk can diverge from what it was stamped
            // from — never preserve past a report that does not itself
            // currently parse as a clean APPROVED.
            const preCheckFiles = await findArtifactFiles(dir, 'architecture_review_as_built');
            if (preCheckFiles.length > 0) {
              const content = await readFile(preCheckFiles[0], 'utf-8');
              const verdict = parseAsBuiltVerdict(content);
              if (verdict !== null && /^APPROVED\b/i.test(verdict)) {
                const artifact = preCheckFiles[0];
                return {
                  done: true,
                  verdictFreshness: await verdictFreshnessFor(artifact, ctx, 'preserved_surface_miss'),
                };
              }
            }
          }
        }
      } catch {
        // No sidecar, unreadable, or unparseable — fall through.
      }
    }

    const files = await findArtifactFiles(dir, 'architecture_review_as_built');
    if (files.length === 0) {
      return {
        done: false,
        reason: 'no .pipeline/architecture-review-as-built.md present — the as-built review must record a verdict',
        routeClass: 'absent',
      };
    }
    const cmpFloor = verdictFreshnessComparand(ctx);
    const fresh: string[] = [];
    for (const f of files) {
      if (await fileIsFreshSinceSession(f, cmpFloor)) fresh.push(f);
    }
    if (fresh.length === 0) {
      const f = files[0];
      return {
        done: false,
        reason:
          "as-built architecture review verdict was not rewritten by this judging session (mtime predates the review dispatch) — scoring 'no fresh verdict'; a prior session's verdict is never reused",
        verdictFreshness: await verdictFreshnessFor(f, ctx, 'stale_invalidated'),
        routeClass: 'absent',
      };
    }
    for (const f of fresh) {
      const content = await readFile(f, 'utf-8');
      const verdict = parseAsBuiltVerdict(content);
      if (verdict === null) {
        return {
          done: false,
          reason: 'as-built review has no parseable `Verdict:` line — expected APPROVED / APPROVED WITH DRIFT NOTES / BLOCKED; re-run the as-built review',
          routeClass: 'absent',
        };
      }
      // Clean pass iff the verdict begins with APPROVED (covers both
      // "APPROVED" and "APPROVED WITH DRIFT NOTES"). Everything else —
      // BLOCKED or any other string — keeps the gate unsatisfied.
      if (!/^APPROVED\b/i.test(verdict)) {
        return {
          done: false,
          reason: `as-built review verdict is "${verdict}" — not a clean APPROVED (BLOCKED means shipped code violates an APPROVED ADR; an unrecognized verdict means the review may have found no ADRs to check). Fix the code or supersede the ADR (human-approved), then re-run`,
          routeClass: 'named-route',
        };
      }
    }
    const passF = fresh[0];
    const verdictFreshness = await verdictFreshnessFor(passF, ctx, 'rewritten');
    await writeArchitectureReviewAsBuiltCodeStamp(dir, ctx);
    return {
      done: true,
      verdictFreshness,
    };
  },

  // build_review judgement gate: satisfied only by a fresh, valid PASS
  // verdict at `.pipeline/build-review.json` (BUILD_REVIEW_VERDICT). Missing
  // file, stale (prior-session) file, malformed JSON, or a FAIL verdict all
  // keep the gate unsatisfied (fail-closed) — a FAIL surfaces the grader's
  // reasons so the kickback message tells `build` what to fix.
  build_review: async (dir, ctx): Promise<CompletionResult> => {
    const path = join(dir, BUILD_REVIEW_VERDICT);
    const cmpFloor = verdictFreshnessComparand(ctx);

    // gate-code-validity-on-redispatch (#817): before falling into the
    // mtime-freshness check below, see if a stamped PASS verdict can be
    // trusted as-is because the code hasn't changed in its surface since it
    // was formed — this is what lets a re-dispatched feature skip a
    // completed build_review whose evidence predates the current attempt
    // but whose stamped code is still current. Read regardless of mtime
    // freshness; only a valid stamped PASS can preserve, everything else
    // (missing file, parse failure, FAIL, no codeStamp) falls through
    // unchanged to the existing mtime-based logic (invariant C2).
    if (resolveGateCodeValidityConfig(ctx.config).enabled) {
      try {
        const raw = await readFile(path, 'utf-8');
        const parsed: unknown = JSON.parse(raw);
        const preCheck = validateBuildReviewVerdict(parsed);
        if (preCheck.ok && preCheck.verdict === 'PASS' && preCheck.codeStamp) {
          const git = ctx.git ?? makeGitRunner(dir);
          const validity = await gateVerdictStillValid({ projectRoot: dir, git }, 'build_review', preCheck.codeStamp);
          if (validity === 'preserve') {
            // A strict aggregate still has one authoritative effective
            // verdict. Code-stamp preservation skips only the mtime check;
            // it must not bypass an unavailable or failing state resolver.
            const aggregate = parseBuildReviewAggregate(parsed);
            let effectiveResolution: BuildReviewEffectiveResolution | undefined;
            if (aggregate) {
              effectiveResolution = await (
                ctx.buildReviewEffectiveResolver ?? resolveEffectiveBuildReviewVerdict
              )(dir, aggregate);
              if (!effectiveResolution.ok) {
                return {
                  done: false,
                  reason: `build_review disposition resolution failed: ${effectiveResolution.reason}`,
                  routeClass: 'named-route',
                };
              }
              if (effectiveResolution.effective.verdict === 'FAIL') {
                return {
                  done: false,
                  reason: `build_review effective FAILed: ${effectiveBuildReviewFailureDetails(effectiveResolution.effective).join('; ')} — fix in build, then the gate re-runs build_review`,
                  routeClass: 'named-route',
                };
              }
            }
            return { done: true, verdictFreshness: await verdictFreshnessFor(path, ctx, 'preserved_surface_miss') };
          }
        }
      } catch {
        // No file, unreadable, or unparseable — fall through to the existing
        // mtime-based logic, which handles all of those cases itself.
      }
    }

    // A parseable legacy verdict is an incompatible schema, irrespective of
    // when it was written. Check that before mtime freshness so a backdated
    // pre-wiring artifact is reported as "not judged", rather than being
    // indistinguishable from an otherwise-valid prior-session verdict.
    try {
      const parsed: unknown = JSON.parse(await readFile(path, 'utf-8'));
      const validation = validateBuildReviewVerdict(parsed);
      if (!validation.ok) {
        return { done: false, reason: validation.reason, routeClass: 'absent' };
      }
    } catch {
      // Missing and malformed files retain their existing freshness and JSON
      // diagnostics below.
    }

    if (!(await fileIsFreshSinceSession(path, cmpFloor))) {
      // fileIsFreshSinceSession returns false both for "missing" and "stale";
      // distinguish them so the reason message is accurate.
      const mtimeMs = await stat(path).then((s) => s.mtimeMs).catch(() => undefined);
      const exists = mtimeMs !== undefined;
      return {
        done: false,
        reason: exists
          ? "build-review verdict was not rewritten by this judging session (mtime predates the review dispatch) — scoring 'no fresh verdict'; a prior session's verdict is never reused"
          : `no build-review verdict at ${BUILD_REVIEW_VERDICT} — the build_review grader must run and record a PASS/FAIL verdict`,
        verdictFreshness: exists
          ? await verdictFreshnessFor(path, ctx, 'stale_invalidated')
          : undefined,
        routeClass: 'absent',
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, 'utf-8'));
    } catch {
      return {
        done: false,
        reason: `${BUILD_REVIEW_VERDICT} is not valid JSON — the build_review grader must rewrite it`,
        routeClass: 'absent',
      };
    }
    const result = validateBuildReviewVerdict(parsed);
    if (!result.ok) {
      return { done: false, reason: result.reason, routeClass: 'absent' };
    }
    // Fan-out evidence has a strict raw envelope. Once the existing freshness
    // and code-stamp checks above establish that this is current evidence,
    // completion must use the same accepted-risk reducer as the live runner.
    // Legacy scalar verdicts intentionally retain their historical predicate.
    const aggregate = parseBuildReviewAggregate(parsed);
    if (aggregate) {
      const effectiveResolution = await (
        ctx.buildReviewEffectiveResolver ?? resolveEffectiveBuildReviewVerdict
      )(dir, aggregate);
      if (!effectiveResolution.ok) {
        return {
          done: false,
          reason: `build_review disposition resolution failed: ${effectiveResolution.reason}`,
          routeClass: 'named-route',
        };
      }
      if (effectiveResolution.effective.verdict === 'FAIL') {
        return {
          done: false,
          reason: `build_review effective FAILed: ${effectiveBuildReviewFailureDetails(effectiveResolution.effective).join('; ')} — fix in build, then the gate re-runs build_review`,
          routeClass: 'named-route',
        };
      }
      return { done: true, verdictFreshness: await verdictFreshnessFor(path, ctx, 'rewritten') };
    }
    if (result.verdict === 'FAIL') {
      const details = buildReviewFailureDetails(result);
      const reasons = details.length > 0
        ? details.join('; ')
        : 'no reasons recorded';
      return {
        done: false,
        reason: `build_review FAILed: ${reasons} — fix in build, then the gate re-runs build_review`,
        routeClass: 'named-route',
      };
    }
    return {
      done: true,
      verdictFreshness: await verdictFreshnessFor(path, ctx, 'rewritten'),
    };
  },

  // Retained solely for topology compatibility. Wiring is evaluated by the
  // build_review rubric; this step must never inspect plans, diffs, or evidence.
  wiring_check: async (): Promise<CompletionResult> => ({ done: true }),

  test_suite: async (dir, ctx): Promise<CompletionResult> => {
    let inspection: FullSuiteInspectionResult;
    try {
      inspection = await (
        ctx.fullSuiteInspect?.() ?? new FullSuiteVerifier({ projectRoot: dir }).inspect()
      );
    } catch (error) {
      return {
        done: false,
        reason: `full-suite completion inspection failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (inspection.status === 'CURRENT') return { done: true };
    if (inspection.status === 'STALE') {
      return {
        done: false,
        reason: `full-suite PASS evidence is stale: ${inspection.reason}`,
      };
    }
    return {
      done: false,
      reason: `full-suite completion inspection failed (${inspection.reason}): ${inspection.message}`,
    };
  },

  // Retro passes when a fresh retro file exists for THIS feature. Filename
  // should contain the slug per skills/retro/SKILL.md ("Save to
  // .docs/retros/YYYY-MM-DD-<feature-name>.md"). Falls back to "any retro
  // fresh in this session" when no feature_desc is available.
  retro: async (dir, ctx): Promise<CompletionResult> => {
    const allFiles = await findArtifactFiles(dir, 'retro');
    if (allFiles.length === 0) {
      return {
        done: false,
        reason: 'no .docs/retros/*.md present (retro skill must save a report)',
      };
    }
    const slug = ctx.featureDesc ? slugify(ctx.featureDesc) : null;
    if (slug) {
      const matched = allFiles.filter(
        (f) => f.endsWith(`-${slug}.md`) || f.endsWith(`/${slug}.md`),
      );
      if (matched.length > 0) {
        for (const f of matched) {
          if (await fileIsFreshSinceSession(f, ctx.sessionStartedAt)) return { done: true };
        }
        return {
          done: false,
          reason: `slug-matched retro exists but is stale (mtime predates this session) — retro must re-run`,
        };
      }
      // No slug match — accept any retro file fresh in this session as a
      // fallback (covers very long feature_desc, slug truncation, etc.).
      for (const f of allFiles) {
        if (await fileIsFreshSinceSession(f, ctx.sessionStartedAt)) return { done: true };
      }
      return {
        done: false,
        reason: `no retro found for current feature (expected .docs/retros/*-${slug}.md OR a retro file with mtime >= session start)`,
      };
    }
    for (const f of allFiles) {
      if (await fileIsFreshSinceSession(f, ctx.sessionStartedAt)) return { done: true };
    }
    return {
      done: false,
      reason: 'retro files exist but none are fresh for this session',
    };
  },

  // Finish passes only when a fresh .pipeline/finish-choice marker is
  // present (mtime >= sessionStartedAt). The conductor sweeps stale markers
  // at session start (Conductor.run), so any marker observed here was
  // written by the finish skill in this run. For choice='pr', also require
  // state.pr_url to be set. The previous "pr_url alone passes" path was
  // dropped because pr_url from a prior feature in the same worktree could
  // satisfy the gate spuriously.
  finish: async (dir, ctx): Promise<CompletionResult> => {
    const choicePath = join(dir, FINISH_CHOICE_MARKER);
    let choice: string;
    try {
      choice = (await readFile(choicePath, 'utf-8')).trim();
    } catch {
      return {
        done: false,
        reason: `${FINISH_CHOICE_MARKER} is missing — the finish skill must record the chosen outcome (pr | merge-local | keep | discard)`,
        missing: 'recording',
      };
    }
    if (!(FINISH_CHOICE_VALUES as readonly string[]).includes(choice)) {
      return {
        done: false,
        reason: `${FINISH_CHOICE_MARKER} contains unrecognized value "${choice}" — expected one of ${FINISH_CHOICE_VALUES.join(', ')}`,
        missing: 'recording',
      };
    }
    if (!(await fileIsFreshSinceSession(choicePath, ctx.sessionStartedAt))) {
      return {
        done: false,
        reason: `${FINISH_CHOICE_MARKER} is stale (mtime predates this session) — finish must re-run`,
        missing: 'recording',
      };
    }
    // LEADING branch: Daemon mode non-convergence check.
    // Daemon mode is deterministic; operator decisions cannot be made autonomously.
    // Only 'pr' choice converges in daemon mode (autonomous ship to PR).
    if (ctx.daemon === true && (choice === 'keep' || choice === 'merge-local' || choice === 'discard')) {
      return {
        done: false,
        reason: `Daemon mode cannot converge on '${choice}': requires operator decision`,
        missing: 'other',
      };
    }
    // ---- Phase 1: evidence — all non-presentation conditions. Each miss
    // returns immediately, before any presentation (gh) call is made. ----
    let prUrl: string | undefined;
    if (choice === 'pr' || choice === 'merge-local') {
      try {
        const raw = await readFile(join(dir, '.pipeline/conduct-state.json'), 'utf-8');
        const state = JSON.parse(raw) as { pr_url?: string };
        if (!state.pr_url) {
          return {
            done: false,
            reason: `${FINISH_CHOICE_MARKER}="${choice}" but no pr_url in state — the PR URL must be recorded`,
            missing: 'recording',
          };
        }
        prUrl = state.pr_url;
      } catch {
        return {
          done: false,
          reason: `cannot read state to confirm pr_url for finish-choice="${choice}"`,
          missing: 'recording',
        };
      }

      // adr-2026-07-06-daemon-false-ship-guard (Task 5+6): Evidence check for push
      // verification. When isHeadPushed is available, verify HEAD was pushed to
      // the tracking ref before allowing convergence to DONE. Fail-closed (never
      // silently pass) on any error: false → not pushed, null → indeterminate,
      // throw → corrupt repo. Fail-open if the injectable is absent (legacy/non-git).
      if (ctx.isHeadPushed) {
        try {
          const pushed = await ctx.isHeadPushed();
          if (pushed === false) {
            return {
              done: false,
              reason: `Push evidence required: HEAD not found in refs/remotes/origin/<branch> — ${prUrl}`,
              missing: 'other',
            };
          }
          if (pushed === null) {
            return {
              done: false,
              reason: `Push evidence indeterminate: cannot verify branch was pushed — ${prUrl}`,
              missing: 'other',
            };
          }
          // pushed === true: continue to Phase 2
        } catch (error) {
          return {
            done: false,
            reason: `Push evidence check failed: ${error instanceof Error ? error.message : String(error)}`,
            missing: 'other',
          };
        }
      }

      const durableEvidence = await verifyDurableShipmentEvidence(dir, ctx, prUrl);
      if (durableEvidence) return durableEvidence;

    }

    // ---- Phase 2: presentation — only reached once every Phase 1 evidence
    // condition has been satisfied. ----
    if (choice === 'pr' && prUrl) {
      // Presentation staleness is now read BEFORE the deterministic repair
      // floor. Under the previous order (Task 8, ADR D1) the floor ran first
      // and rewrote exactly the content these reads look for, so the checks
      // below could never fire and three PRs (#1067, #1056, #1031) shipped
      // with an engine-generated placeholder body. Convergence — D1's actual
      // concern — is preserved by the bounded one-shot kickback below: the
      // floor still runs, but only as a genuine last resort.
      const ghRunner = ctx.gh ?? makeProductionGh();

      // Fail-open on any gh error (each reader returns null): network
      // unavailability never blocks a ship.
      let staleReason: string | null = null;
      try {
        // adr-2026-07-03-halt-pr-rehabilitation-at-finish (Decision 3).
        const staleTitle = await readStaleHaltTitle(ghRunner, dir, prUrl);
        if (staleTitle !== null) {
          staleReason = `is still titled "${staleTitle}"`;
        }
        if (staleReason === null) {
          // adr-2026-07-06-halt-pr-rehab-body-floor: the halt banner is a
          // stateless halt signal.
          const staleBanner = await readStaleHaltBanner(ghRunner, dir, prUrl);
          if (staleBanner !== null) {
            staleReason = `body still carries the halt banner ("${staleBanner}")`;
          }
        }
        if (staleReason === null) {
          // A body the engine floored is a placeholder, never a /pr-authored
          // body — reusing a PR must not skip body regeneration.
          const floored = await readFlooredBody(ghRunner, dir, prUrl);
          if (floored !== null) {
            staleReason = 'body is an engine-generated placeholder, not a /pr-authored body';
          }
        }
      } catch {
        // fail-open — presentation is not worth blocking a ship on gh failure
        staleReason = null;
      }

      if (staleReason !== null) {
        const attempted = await readPrBodyRegenAttempt(dir, prUrl);
        if (!attempted) {
          // Bounded one-shot kickback: capture the halt narrative into a PR
          // COMMENT (never the body) while it is still observable, record the
          // attempt durably, and refuse — /pr must author a real templated
          // body.
          if (ctx.repairFinishPr) {
            try {
              await ctx.repairFinishPr(prUrl, { mode: 'capture-only' });
            } catch (error) {
              console.warn(
                `[finish] halt-history capture failed for ${prUrl}: ${error instanceof Error ? error.message : String(error)} — continuing (warn-only)`,
              );
            }
          }
          await recordPrBodyRegenAttempt(dir, prUrl);
          return {
            done: false,
            reason: `recorded PR ${prUrl} ${staleReason} — run /pr to author a real templated body (## Why / ## What Changed / ## Testing, plus the Closes reference) before completing; halt/remediation narrative belongs in a PR comment, not the body`,
            // Publication defect, NOT unfinished work: every evidence check
            // above already passed. The loop routes this straight back to a
            // body rewrite.
            missing: 'presentation',
          };
        }
        // Regeneration budget exhausted: fall through to the deterministic
        // floor rather than stalling the feature forever. Shipping a floored
        // body is worse than a /pr-authored one, but better than never
        // converging.
        console.warn(
          `[finish] ${prUrl} ${staleReason} after a /pr regeneration kickback — applying the deterministic presentation floor as a last resort`,
        );
      }

      if (ctx.repairFinishPr) {
        try {
          await ctx.repairFinishPr(prUrl, { mode: 'full' });
        } catch (error) {
          if (ctx.releaseMetadataPreservationRequired) {
            return {
              done: false,
              reason: `release metadata preservation failed for ${prUrl}: ${error instanceof Error ? error.message : String(error)}`,
              missing: 'other',
            };
          }
          console.warn(
            `[finish] repair failed for ${prUrl}: ${error instanceof Error ? error.message : String(error)} — continuing (warn-only)`,
          );
        }
      }

      // Story 3: Ship-readiness gate — fail if the recorded PR is still in draft
      // state. A draft PR is not ready to ship (even if it has a clean title and
      // all evidence passed). The finish/pr skill must undraft the PR before
      // completing. Fail-open on any gh error: network unavailability never blocks
      // a ship.
      try {
        const { stdout } = await ghRunner(['pr', 'view', prUrl, '--json', 'isDraft'], { cwd: dir });
        const parsed = JSON.parse(stdout || '{}') as { isDraft?: unknown };
        const isDraft = Boolean(parsed.isDraft);
        if (isDraft) {
          return {
            done: false,
            reason: `recorded PR ${prUrl} is still in draft state — not ready for ship (ship-readiness: requires PR to be marked ready before completing)`,
            // Same publication class as the body checks above: fixed on the PR
            // itself (`gh pr ready`), never by re-opening the build.
            missing: 'presentation',
          };
        }
      } catch {
        // fail-open — presentation is not worth blocking a ship on gh failure
      }
    }
    return { done: true };
  },
};

/**
 * Richer gate predicates for kickback-target steps, kept SEPARATE from
 * CUSTOM_COMPLETION_PREDICATES so the existing linear conductor's completion
 * gate is unchanged. Consumed only by the gate-verdict layer (gate-verdicts.ts);
 * the loop (Phase 3) decides when to enforce them.
 */
export const GATE_ONLY_PREDICATES: Partial<
  Record<StepName, (dir: string, ctx: CompletionContext) => Promise<CompletionResult>>
> = {
  // Stories pass when every story has a Happy Path AND a Negative Path(s)
  // section (each with ≥1 Given/When/Then bullet) and no DRAFT status.
  // Structural check against the repo convention (### Happy Path / ###
  // Negative Paths headings, **Status:** marker). See gate-audit-2026-06-23.md.
  // Scoped to the FEATURE's stories doc (#441): legacy landed stories predate
  // the convention, so a corpus-wide scan is permanently unsatisfiable.
  stories: async (dir, ctx): Promise<CompletionResult> => {
    const corpus = await findArtifactFiles(dir, 'stories');
    if (corpus.length === 0) {
      return { done: false, reason: 'no .docs/stories/**/*.md present' };
    }
    const scoped = await resolveFeatureStoriesPath(dir, ctx.featureDesc);
    if (!scoped) {
      const desc = ctx.featureDesc ? ` for feature "${ctx.featureDesc}"` : '';
      return {
        done: false,
        reason: `cannot resolve this feature's stories doc${desc} among ${corpus.length} stories files — expected .docs/stories/<plan-stem>.md; refusing to validate the whole stories corpus (#441)`,
      };
    }
    const files = [scoped];
    for (const file of files) {
      const content = await readFile(file, 'utf-8');
      const rel = relative(dir, file);
      if (/^\s*\*\*Status:\*\*\s*DRAFT\b/im.test(content)) {
        return {
          done: false,
          reason: `${rel}: story is DRAFT — must be accepted before planning`,
        };
      }
      for (const block of splitStoryBlocks(content)) {
        const label = `${rel}${block.id ? ` (Story ${block.id})` : ''}`;
        const hasHappy = hasPathSection(block.text, 'happy');
        const hasNegative = hasPathSection(block.text, 'negative');
        if (!hasHappy || !hasNegative) {
          const missing =
            !hasHappy && !hasNegative
              ? 'happy and negative paths'
              : !hasHappy
                ? 'a happy path'
                : 'a negative path';
          return {
            done: false,
            reason: `${label}: missing ${missing} (each story needs a Happy Path and a Negative Path(s) section with ≥1 Given/When/Then bullet)`,
          };
        }
      }
    }
    return { done: true };
  },

  // Plan passes when every story's happy path AND negative path is covered by
  // ≥1 task. Coverage is read from task `**Story:** <id> (happy|negative path)`
  // lines and the `## Coverage Check` table. Falls back to story-level coverage
  // when a plan has no path-type markers for a story. See gate-audit-2026-06-23.md.
  // Scoped to the FEATURE's plan + stories docs (#441): a corpus-wide scan
  // both false-fails (legacy stories' units this plan can't cover) and
  // false-passes (per-file numeric story IDs collide across features, so any
  // legacy plan's "Story 1" reference covers every file's Story 1).
  plan: async (dir, ctx): Promise<CompletionResult> => {
    const anyPlans = await findArtifactFiles(dir, 'plan');
    if (anyPlans.length === 0) {
      return { done: false, reason: 'no .docs/plans/*.md present' };
    }
    const scopedPlan = await resolveFeaturePlanPath(dir, ctx.featureDesc);
    if (!scopedPlan) {
      const desc = ctx.featureDesc ? ` for feature "${ctx.featureDesc}"` : '';
      return {
        done: false,
        reason: `cannot resolve this feature's plan${desc} among ${anyPlans.length} plans — refusing corpus-wide coverage check (#441)`,
      };
    }
    const planFiles = [scopedPlan];
    const anyStories = await findArtifactFiles(dir, 'stories');
    if (anyStories.length === 0) {
      return { done: false, reason: 'no .docs/stories to check plan coverage against' };
    }
    const scopedStories = await resolveFeatureStoriesPath(dir, ctx.featureDesc);
    if (!scopedStories) {
      return {
        done: false,
        reason: `cannot resolve this feature's stories doc among ${anyStories.length} stories files — refusing corpus-wide coverage check (#441)`,
      };
    }
    const storyFiles = [scopedStories];

    // Required coverage units: (storyId, pathType) for each path a story declares.
    const required: { id: string; type: 'happy' | 'negative' }[] = [];
    for (const sf of storyFiles) {
      const content = await readFile(sf, 'utf-8');
      for (const block of splitStoryBlocks(content)) {
        const id = block.id ?? storyIdFromFilename(sf);
        if (!id) continue;
        if (hasPathSection(block.text, 'happy')) required.push({ id, type: 'happy' });
        if (hasPathSection(block.text, 'negative')) required.push({ id, type: 'negative' });
      }
    }
    // Stories exist but yield no parseable IDs/paths — plan presence suffices.
    if (required.length === 0) return { done: true };

    let planText = '';
    for (const pf of planFiles) planText += '\n' + (await readFile(pf, 'utf-8'));
    const covered = collectPlanCoverage(planText);

    const gaps: string[] = [];
    for (const r of required) {
      if (covered.has(`${r.id}|${r.type}`)) continue;
      // Fallback: if the plan declares no path-type for this story at all,
      // accept a story-level reference as covering both paths.
      const hasPathType =
        covered.has(`${r.id}|happy`) || covered.has(`${r.id}|negative`);
      if (!hasPathType && covered.has(`${r.id}|*`)) continue;
      gaps.push(`${r.id} ${r.type}`);
    }
    if (gaps.length > 0) {
      const shown = gaps.slice(0, 5).join(', ');
      const more = gaps.length > 5 ? ` (+${gaps.length - 5} more)` : '';
      return {
        done: false,
        reason: `plan does not cover: ${shown}${more} — add task(s) referencing these story paths`,
      };
    }
    // The plan must declare a task dependency tree so `build` (pipeline) can
    // order the work topologically. See skills/plan/SKILL.md (Task Dependency
    // Graph) + skills/pipeline/SKILL.md which consumes it.
    if (!planHasDependencyTree(planText)) {
      return {
        done: false,
        reason:
          'plan has no task dependency tree — add a "## Task Dependency Graph" section or per-task "**Dependencies:**" lines',
      };
    }
    return { done: true };
  },
};

/**
 * True if the plan declares task dependencies — either a `## Task Dependency
 * Graph` section or per-task `**Dependencies:**` lines. Required so `build` can
 * order tasks topologically. Exported for daemon backlog eligibility.
 */
export function planHasDependencyTree(planText: string | null | undefined): boolean {
  if (!planText) return false;
  return (
    /^##\s+task\s+dependency\s+graph/im.test(planText) ||
    /\*\*dependencies:\*\*/i.test(planText)
  );
}

/**
 * Canonical stories-approval signal shared by the land gate
 * (engineer/land-spec) and the daemon backlog vetting. Stories are approved
 * when they declare `Status: Accepted` and are NOT `Status: DRAFT`. A stories
 * file with no status line at all is therefore NOT approved.
 *
 * Single source of truth so the engineer→land→daemon chain can never disagree
 * on the token — the gap that previously let a no-status stories file land yet
 * be skipped forever by the daemon (which already required `Status: Accepted`).
 * Exported for daemon backlog eligibility and the land-time gate.
 */
export function isStoriesApproved(content: string): boolean {
  if (/\bstatus\b[\s*:]*\bdraft\b/i.test(content)) return false;
  return /\bstatus\b[\s*:]*\baccepted\b/i.test(content);
}

/**
 * Read the declared ADR status. APPROVED and SUPERSEDED ADRs satisfy the
 * approval gate; other declared statuses are retained for diagnostics.
 */
export function adrApprovalStatus(content: string): { approved: boolean; found: string | null } {
  const withoutFencedCodeBlocks = content.replace(
    /^ {0,3}(`{3,}|~{3,})[^\r\n]*(?:\r?\n|\r)[\s\S]*?^ {0,3}\1[^\r\n]*(?:\r?\n|\r|$)/gm,
    '',
  );
  const match = withoutFencedCodeBlocks.match(
    /^\s*(?:[-+*]\s+)?(?:(?:\*\*status\s*:\s*\*\*|\*\*status\*\*\s*:|status\s*:)\s*(.*?)|\*\*status\s*:\s*(.*?)\*\*)\s*$/im,
  );
  if (!match) return { approved: false, found: null };

  let found = (match[1] ?? match[2]).trim();
  if (found.startsWith('**') && found.endsWith('**')) {
    found = found.slice(2, -2).trim();
  }

  return {
    approved: /^(?:approved|superseded)\b/i.test(found),
    found,
  };
}

/**
 * Parse a complexity-tier marker file (`.docs/complexity/<slug>.md`) into its
 * `ComplexityTier`. The marker carries a `Tier: <S|M|L>` line (case-insensitive);
 * the rest of the file is free-form rationale. Returns `undefined` when the
 * content is null/absent or carries no recognizable tier line — callers fall
 * back to their own default (the daemon uses 'M', preserving legacy behavior).
 */
export function parseComplexityTier(content: string | null): ComplexityTier | undefined {
  if (!content) return undefined;
  const m = content.match(/\bTier:\s*([SML])\b/i);
  if (!m) return undefined;
  return m[1].toUpperCase() as ComplexityTier;
}

/**
 * Parse an intake-origin marker file (`.docs/intake/<slug>.md`) into the
 * originating work reference. The marker carries a `Source-Ref: <ref>` line
 * (case-insensitive); the rest is free-form. The ref may be a GitHub
 * `owner/repo#N` reference or a Jira `PROJ-123` key.
 *
 * Returns `undefined` when the content is null/absent or the ref is missing or
 * malformed (validated via the shared `parseWorkRef`, which recognizes both
 * grammars). Callers treat undefined as "no intake origin" and skip all
 * issue-linking — preserving today's behavior for hand-authored specs. The
 * matched ref is re-emitted via `formatWorkRef` so read-back is a lossless
 * round-trip through the canonical grammar (identity for already-well-formed
 * refs, both GitHub and Jira).
 */
export function parseIntakeSourceRef(content: string | null): string | undefined {
  if (!content) return undefined;
  const m = content.match(/^\s*Source-Ref:\s*(\S+)/im);
  if (!m) return undefined;
  const parsed = parseWorkRef(m[1]);
  return parsed ? formatWorkRef(parsed) : undefined;
}

/**
 * Parse a track marker file (`.docs/track/<slug>.md`) into its `Track`. The
 * marker carries a `Track: product|technical` line (case-insensitive); the rest
 * is free-form rationale. Mirrors `parseComplexityTier` / `parseIntakeSourceRef`.
 *
 * Returns `undefined` when the content is null/absent or carries no recognizable
 * track line. Callers default a missing track to `product` (adr-2026-06-29-track-marker-location): a spec
 * authored before tracks existed is a product PRD, so it must keep `prd-audit`
 * and never be silently treated as technical.
 */
export function parseTrack(content: string | null): Track | undefined {
  if (!content) return undefined;
  const m = content.match(/^\s*Track:\s*(product|technical)\b/im);
  if (!m) return undefined;
  return m[1].toLowerCase() as Track;
}

/** A PRD-audit gap-class. `unknown` = a blocking row whose class cell we could
 * not read; the daemon treats it conservatively (like a product/plan gap). */
export type PrdGapClass = 'impl-gap' | 'intended-drift' | 'plan-gap' | 'unknown';

export interface UnalignedFrRow {
  fr: string;
  gapClass: PrdGapClass;
}

interface ParsedFrRow {
  fr: string;
  /** verdict is not ALIGNED and the row is not human-ACCEPTED. */
  blocking: boolean;
  gapClass: PrdGapClass;
}

const VERDICT_RE = /\b(ALIGNED|MISSING|PARTIAL|DIVERGED)\b/i;

/**
 * Parse one PRD-audit table row into its FR id, blocking status, and gap-class.
 * Returns null for non-rows (no leading `|`) and rows with no `FR-<n>` id
 * (headers, separators, prose legends).
 *
 * The verdict is read from the VERDICT CELL — the first `|`-delimited cell AFTER
 * the FR cell that carries a verdict keyword — NOT from the row as a whole. The
 * table is `| FR | Verdict | Gap-class | Evidence | Accepted? |`, and the
 * Evidence cell routinely contains verdict words in prose (e.g. "404 for a
 * missing record"). A whole-row scan mistook that "missing" for a MISSING
 * verdict and falsely blocked an ALIGNED FR (observed live: FR-9 with evidence
 * "find_kid_for_parent → 404 foreign/missing"). Scanning cells left-to-right the
 * Verdict column precedes Evidence, so the first verdict-bearing post-FR cell is
 * the real verdict; prose in later cells can't override it.
 */
function parseFrVerdictRow(line: string): ParsedFrRow | null {
  if (!/^\s*\|/.test(line)) return null; // table rows only
  const frCellIdx = line
    .split('|')
    .map((c) => c.trim())
    .findIndex((c) => /\bFR-\d+[A-Za-z]?\b/i.test(c));
  if (frCellIdx === -1) return null; // header/separator/legend — no FR id

  const cells = line.split('|').map((c) => c.trim());
  const frId = cells[frCellIdx].match(/\bFR-\d+[A-Za-z]?\b/i)![0].toUpperCase();

  // Verdict = first verdict-bearing cell to the RIGHT of the FR cell, so neither
  // the FR cell nor trailing Evidence prose can be mistaken for the verdict.
  const verdictCell = cells.slice(frCellIdx + 1).find((c) => VERDICT_RE.test(c));
  if (!verdictCell) return null; // no recognizable verdict → not a verdict row
  const keyword = verdictCell.match(VERDICT_RE)![1].toUpperCase();

  // A human-accepted divergence (ACCEPTED in the Accepted? column) never blocks.
  const accepted = cells.some((c) => /\bACCEPTED\b/i.test(c));
  const blocking = keyword !== 'ALIGNED' && !accepted;

  // Gap-class is read from the cell that names one (the Gap-class column); order
  // matters so a multi-word note can't be misread as impl-gap. A blocking row
  // with no recognizable class cell is `unknown` (treated conservatively).
  const gapCell = cells.find((c) => /\b(plan-gap|intended-drift|impl-gap)\b/i.test(c)) ?? '';
  const gapClass: PrdGapClass = /\bplan-gap\b/i.test(gapCell)
    ? 'plan-gap'
    : /\bintended-drift\b/i.test(gapCell)
      ? 'intended-drift'
      : /\bimpl-gap\b/i.test(gapCell)
        ? 'impl-gap'
        : 'unknown';

  return { fr: frId, blocking, gapClass };
}

/** Heading that opens the authoritative verdict table, at any heading level. */
const VERDICT_TABLE_HEADING_RE = /^\s{0,3}#{1,6}\s+Verdict\s+Table\s*$/i;
const MARKDOWN_HEADING_RE = /^\s{0,3}#{1,6}\s+/;

/**
 * Return the lines a verdict-row scan may read.
 *
 * When the report carries a `## Verdict Table` heading, ONLY the lines of that
 * section (up to the next heading of any level) are in scope. Auditors routinely
 * write narrative tables elsewhere in the report — a "what moved since cycle N"
 * history table whose cells carry PRIOR-cycle verdicts is the observed case — and
 * a whole-document scan reads those history cells as current verdicts. That
 * falsely blocked an all-ALIGNED audit: a row reading
 * `| FR-15 | DIVERGED (intended-drift), blocking | **ALIGNED** | ... |` parsed as
 * a blocking DIVERGED verdict even though the real Verdict Table row said ALIGNED.
 *
 * Reports with no such heading (including the pre-heading report shape) keep the
 * whole-document scan, so this narrows nothing that was previously correct.
 */
function verdictTableLines(content: string): string[] {
  const lines = content.split('\n');
  const start = lines.findIndex((l) => VERDICT_TABLE_HEADING_RE.test(l));
  if (start === -1) return lines; // no heading — legacy whole-document scan
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => MARKDOWN_HEADING_RE.test(l));
  return end === -1 ? rest : rest.slice(0, end);
}

/** Return expected FR ids that have no parseable verdict row in the report. */
export function findFrIdsWithoutRows(content: string, expectedIds: ReadonlySet<string>): string[] {
  const present = new Set<string>();
  for (const line of verdictTableLines(content)) {
    const row = parseFrVerdictRow(line);
    if (row) present.add(row.fr);
  }
  return [...expectedIds].filter((id) => !present.has(id.toUpperCase()));
}

/** Return a diagnostic when a resolved PRD requirement lacks an audit verdict row. */
export async function prdAuditCoverageGap(
  projectRoot: string,
  context: ArtifactResolutionContext,
  reportContent: string,
): Promise<string | null> {
  // Direct predicate callers from before feature-scoped artifact resolution
  // existed have no way to identify a PRD. Preserve their established
  // presence/freshness-only contract; once any feature identity is available,
  // resolution is authoritative and an absent PRD must fail closed.
  const hasFeatureIdentity = Boolean(context.activePlanPath || context.featureDesc || context.featureIdentities.length > 0);
  if (!hasFeatureIdentity) return null;

  const prdPaths = await resolveFeaturePrdPaths(projectRoot, context);
  if (prdPaths.length === 0) {
    return 'PRD audit coverage is unresolvable: no approved PRD could be resolved for the feature.';
  }

  let frIdSets: Set<string>[];
  try {
    frIdSets = await Promise.all(
      prdPaths.map(async (path) => extractPrdFrIds(await readFile(path, 'utf8'))),
    );
  } catch {
    return 'PRD audit coverage is unreadable: a resolved approved PRD could not be read.';
  }

  const expectedIds = new Set(
    frIdSets.flatMap((ids) => [...ids]),
  );
  const missing = findFrIdsWithoutRows(reportContent, expectedIds);
  return missing.length === 0 ? null : `PRD audit report is missing verdict rows for ${missing.join(', ')}.`;
}

/**
 * Scan a PRD-audit report for functional-requirement verdict rows that are not
 * ALIGNED and not human-ACCEPTED. Returns the FR identifier of every still-
 * blocking row. Verdict is read per-cell (see {@link parseFrVerdictRow}).
 */
function findUnalignedFrRows(content: string): string[] {
  const blocking: string[] = [];
  for (const line of verdictTableLines(content)) {
    const row = parseFrVerdictRow(line);
    if (row?.blocking) blocking.push(row.fr);
  }
  return blocking;
}

/**
 * Like {@link findUnalignedFrRows}, but also reads each blocking row's
 * gap-class cell (`impl-gap | intended-drift | plan-gap`; `unknown` when the
 * class cell can't be read). Used by the daemon to decide self-heal vs HALT.
 */
function findUnalignedFrRowsWithClass(content: string): UnalignedFrRow[] {
  const rows: UnalignedFrRow[] = [];
  for (const line of verdictTableLines(content)) {
    const row = parseFrVerdictRow(line);
    if (row?.blocking) rows.push({ fr: row.fr, gapClass: row.gapClass });
  }
  return rows;
}

export interface PrdGapClassification {
  /** `clean` = no blocking rows; `impl-only` = every blocking row is impl-gap
   * (daemon can self-heal via BUILD); `needs-decide` = at least one row is a
   * product/plan gap or unclassifiable (needs a human DECIDE amendment). */
  kind: 'clean' | 'impl-only' | 'needs-decide';
  /** Human-readable FR/class list for the kickback or HALT reason. */
  summary: string;
}

/**
 * Classify the blocking rows of the fresh PRD-audit report(s) for this session
 * so the daemon can decide whether to self-heal (impl-only → BUILD) or halt
 * (any product/plan gap → human DECIDE). Only reports written this session are
 * considered; a stale audit from a prior feature is ignored.
 */
export async function classifyPrdAuditGaps(
  dir: string,
  sessionStartedAt: number | undefined,
): Promise<PrdGapClassification> {
  const files = await findArtifactFiles(dir, 'prd_audit');
  const blocking: UnalignedFrRow[] = [];
  for (const f of files) {
    if (!(await fileIsFreshSinceSession(f, sessionStartedAt))) continue;
    blocking.push(...findUnalignedFrRowsWithClass(await readFile(f, 'utf-8')));
  }
  if (blocking.length === 0) return { kind: 'clean', summary: 'no blocking FRs' };

  const summary = blocking
    .slice(0, 5)
    .map((r) => `${r.fr} (${r.gapClass})`)
    .join('; ');
  const more = blocking.length > 5 ? ` (+${blocking.length - 5} more)` : '';
  const allImpl = blocking.every((r) => r.gapClass === 'impl-gap');
  return {
    kind: allImpl ? 'impl-only' : 'needs-decide',
    summary: summary + more,
  };
}

/** Steps eligible for the retry-classify rerun-vs-route decision (issue #646). */
const RETRY_CLASSIFY_STEPS: ReadonlySet<StepName> = new Set<StepName>([
  'architecture_review_as_built',
  'prd_audit',
  'build_review',
]);

export type RetryDecision =
  | { decision: 'rerun' }
  | { decision: 'route'; signal: 'named-route' | 'identical-repeat' | 'unretryable-inputs' };

/**
 * Pure, synchronous rerun-vs-route classifier for the SHIP-tail verdict steps
 * (issue #646). Out of scope steps (e.g. `build`) always rerun. In scope,
 * signal (a) "named-route" fires when the step has a real, fresh, non-passing
 * decision to route on — `completion.routeClass === 'named-route'` for the
 * review steps, or `prdAuditNonClean` for prd_audit — regardless of attempt
 * number. Signal (b) "identical-repeat" fires only when the retry has already
 * happened once (`attempt >= 2`) and produced the exact same reason on inputs
 * that provably haven't changed. The conductor computes `inputsUnchanged` and
 * `prdAuditNonClean` and passes them in. Signal (c) "unretryable-inputs"
 * fires on the first attempt when the runner reports inputs that only another
 * step can change. This helper does no I/O.
 */
export function classifyRetryDecision(input: {
  step: StepName;
  completion: CompletionResult;
  attempt: number;
  priorReason?: string;
  inputsUnchanged: boolean;
  prdAuditNonClean?: boolean;
  unretryableInputs?: { retryAfterStep: StepName };
}): RetryDecision {
  const { step, completion, attempt, priorReason, inputsUnchanged, prdAuditNonClean, unretryableInputs } = input;
  if (!RETRY_CLASSIFY_STEPS.has(step)) return { decision: 'rerun' };

  if (unretryableInputs) return { decision: 'route', signal: 'unretryable-inputs' };

  const namedRoute = step === 'prd_audit' ? prdAuditNonClean === true : completion.routeClass === 'named-route';
  if (namedRoute) return { decision: 'route', signal: 'named-route' };

  if (
    attempt >= 2 &&
    priorReason !== undefined &&
    priorReason === completion.reason &&
    inputsUnchanged
  ) {
    return { decision: 'route', signal: 'identical-repeat' };
  }

  return { decision: 'rerun' };
}

// --- Remediation plan (the /remediate skill's structured output) -------------

/** Steps a remediation gap may be routed back to (must be earlier than prd_audit). */
export const REMEDIATION_TARGET_STEPS = [
  'build',
  'acceptance_specs',
  'architecture_review',
  'plan',
] as const;
export type RemediationTarget = (typeof REMEDIATION_TARGET_STEPS)[number];

/**
 * Disposition for a gap whose remedy is PUBLISHED PROSE, not code — the PR
 * body, its title, or its issue linkage.
 *
 * It is deliberately NOT a member of {@link REMEDIATION_TARGET_STEPS}:
 *
 *   - It routes to `finish`, the step that owns PR prose, rather than to a
 *     BUILD-phase step. Before it existed the planner's only reachable route
 *     for a presentation gap was `build`, so a 30-second `gh pr edit` re-opened
 *     an entire implementation phase.
 *   - It is excluded from the plan-append contract. A PR body fix is not plan
 *     work; appending it to `.docs/plans/<slug>.md` amends a protected artifact
 *     and trips the self-amendment guard.
 */
export const REMEDIATION_PUBLICATION_DISPOSITION = 'publication';

export type RemediationDisposition =
  | RemediationTarget
  | typeof REMEDIATION_PUBLICATION_DISPOSITION
  | 'halt';

/** The step a disposition rewinds to. `publication` is prose-only work owned by `finish`. */
export function remediationDispositionStep(
  disposition: RemediationDisposition,
): string {
  return disposition === REMEDIATION_PUBLICATION_DISPOSITION ? 'finish' : disposition;
}

/**
 * True when this disposition's tasks are appended to the plan file. Only the
 * step-valued targets are; `publication` and `halt` never amend the plan.
 */
export function remediationDispositionAppendsToPlan(
  disposition: RemediationDisposition,
): boolean {
  return (REMEDIATION_TARGET_STEPS as readonly string[]).includes(disposition);
}
export type RemediationHaltCategory = 'architectural-clarity' | 'product-scope';

export interface RemediationGap {
  id: string;
  disposition: RemediationDisposition;
  /** Set only when disposition === 'halt'. */
  category: RemediationHaltCategory | null;
  rationale: string;
  /** Concrete file-scoped tasks (for autonomous dispositions); informational. */
  tasks: { id: string; title: string }[];
}

export interface RemediationPlan {
  gaps: RemediationGap[];
  /** Ordinary BUILD dispositions rejected for lacking concrete work. */
  invalidTasklessBuild: boolean;
}

/**
 * Read + validate `.pipeline/remediation.json` (the /remediate skill's output).
 * Returns null when the file is absent, stale (predates this session), malformed,
 * or contains no recognizable gap — the caller then falls back to the
 * deterministic `classifyPrdAuditGaps` routing. Tolerant of junk: unknown
 * dispositions and non-object gaps are dropped rather than failing the whole plan.
 */
export async function readRemediationPlan(
  dir: string,
  sessionStartedAt: number | undefined,
  source?: string,
): Promise<RemediationPlan | null> {
  const path = join(dir, '.pipeline/remediation.json');
  if (!(await fileIsFreshSinceSession(path, sessionStartedAt))) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf-8'));
  } catch {
    return null;
  }
  const rawGaps = (parsed as { dispositions?: unknown })?.dispositions;
  if (!Array.isArray(rawGaps)) return null;

  const valid: RemediationDisposition[] = [
    ...REMEDIATION_TARGET_STEPS,
    REMEDIATION_PUBLICATION_DISPOSITION,
    'halt',
  ];
  const gaps: RemediationGap[] = [];
  let invalidTasklessBuild = false;
  for (const g of rawGaps) {
    if (!g || typeof g !== 'object') continue;
    const o = g as Record<string, unknown>;
    const disposition = o.disposition as RemediationDisposition;
    if (!valid.includes(disposition)) continue;
    const category =
      o.category === 'architectural-clarity' || o.category === 'product-scope'
        ? (o.category as RemediationHaltCategory)
        : null;
    // A 'halt' must name a category; an autonomous disposition must not be halt.
    if (disposition === 'halt' && category === null) continue;
    const tasks = Array.isArray(o.tasks)
      ? o.tasks
          .filter(
            (t): t is { title: string } =>
              !!t && typeof t === 'object' && typeof (t as { title?: unknown }).title === 'string',
          )
          .map((t) => ({
            id: String((t as { id?: unknown }).id ?? ''),
            title: String((t as { title: unknown }).title),
          }))
      : [];
    // A taskless BUILD disposition is only a usable answer to a build-stall
    // question. Every ordinary autonomous BUILD disposition must carry the
    // concrete work that makes the route dispatchable.
    if (
      disposition === 'build' &&
      tasks.length === 0 &&
      source !== 'build_stall' &&
      source !== 'build-stall' &&
      source !== 'build_stall_zero_work'
    ) {
      invalidTasklessBuild = true;
      continue;
    }
    gaps.push({
      id: typeof o.id === 'string' ? o.id : '?',
      disposition,
      category,
      rationale: typeof o.rationale === 'string' ? o.rationale : '',
      tasks,
    });
  }
  return gaps.length > 0 || invalidTasklessBuild ? { gaps, invalidTasklessBuild } : null;
}

// --- Story / plan structure parsing (shared by stories + plan predicates) ---

export interface StoryBlock {
  id?: string;
  text: string;
}

/**
 * Split a stories file into per-story blocks on `## Story <id>:` headings.
 * Single-story files (no such heading) return one block spanning the file.
 */
export function splitStoryBlocks(content: string): StoryBlock[] {
  const heading = /^##\s+Story\s+([A-Za-z0-9.\-]+)/i;
  const blocks: StoryBlock[] = [];
  let current: { id: string; lines: string[] } | null = null;
  for (const line of content.split('\n')) {
    const m = line.match(heading);
    if (m) {
      if (current) blocks.push({ id: current.id, text: current.lines.join('\n') });
      current = { id: m[1], lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) blocks.push({ id: current.id, text: current.lines.join('\n') });
  return blocks.length > 0 ? blocks : [{ text: content }];
}

/** True if the block has a Happy/Negative path section containing a G/W/T bullet. */
function hasPathSection(blockText: string, type: 'happy' | 'negative'): boolean {
  const body = sectionBody(
    blockText,
    type === 'happy' ? /happy\s*path/i : /negative\s*paths?/i,
  );
  if (body === null) return false;
  return /\bgiven\b/i.test(body) && /\bthen\b/i.test(body);
}

/**
 * Return the text under the first heading matching `headingRegex`, up to the
 * next heading of the same or higher level, or null if no such heading exists.
 */
function sectionBody(text: string, headingRegex: RegExp): string | null {
  let capturing = false;
  let level = 0;
  const body: string[] = [];
  for (const line of text.split('\n')) {
    const hm = line.match(/^(#{1,6})\s+(.*)$/);
    if (hm) {
      if (capturing && hm[1].length <= level) break;
      if (!capturing && headingRegex.test(hm[2])) {
        capturing = true;
        level = hm[1].length;
        continue;
      }
    }
    if (capturing) body.push(line);
  }
  return capturing ? body.join('\n') : null;
}

/** Extract a `ST-0NN` / `EP-0NN` id from a single-story filename, if present. */
function storyIdFromFilename(path: string): string | undefined {
  const base = path.split('/').pop() ?? '';
  const m = base.match(/\b(ST-\d+|EP-\d+)/i);
  return m ? m[1].toUpperCase() : undefined;
}

/**
 * Coverage set keyed `${id}|happy` / `${id}|negative` / `${id}|*` (story-level).
 *
 * Plans are parsed per task block (split on `### ...` headings) so a task's
 * story reference and its path type are associated together. Two real-world
 * formats are both accepted:
 *   - id + path-type in the parens: `**Story:** 3.2-1 (happy path — foo)`
 *   - id with an optional `Story `/`Epic ` prefix word and the path type on a
 *     separate `**Type:** happy-path` / `**Type:** negative-path` line:
 *       `**Story:** Story 1 (FR-1, FR-2)` + `**Type:** happy-path`
 * A `## Coverage Check` table (`| 1 | happy | ... |`) is also honored.
 */
export function collectPlanCoverage(planText: string): Set<string> {
  const set = new Set<string>();

  for (const block of splitOnHeadings(planText, /^###\s+/)) {
    // Story id(s) this task references. Strip an optional `Story `/`Epic `
    // prefix word so `**Story:** Story 1` and `**Story:** 1` both yield `1`.
    const ids = new Set<string>();
    const storyRef = /\*\*Story:\*\*\s*(?:story|epic)?\s*([A-Za-z0-9.\-]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = storyRef.exec(block)) !== null) {
      const id = m[1];
      if (/^(n\/?a|prerequisite|none|all)$/i.test(id)) continue;
      ids.add(id);
    }
    if (ids.size === 0) continue;

    // Path type(s) this task covers: prefer an explicit `**Type:**` line, then
    // a happy/negative qualifier inside the Story parens, then a path keyword
    // anywhere in the block.
    const types = new Set<'happy' | 'negative'>();
    const typeLine = block.match(/\*\*Type:\*\*\s*([^\n]*)/i);
    if (typeLine) {
      if (/happy/i.test(typeLine[1])) types.add('happy');
      if (/negative/i.test(typeLine[1])) types.add('negative');
    }
    const parens = block.match(/\*\*Story:\*\*[^\n]*\(([^)]*)\)/i);
    if (parens) {
      if (/happy/i.test(parens[1])) types.add('happy');
      if (/negative/i.test(parens[1])) types.add('negative');
    }
    if (types.size === 0) {
      if (/\bhappy\s*path\b/i.test(block)) types.add('happy');
      if (/\bnegative\s*path\b/i.test(block)) types.add('negative');
    }

    for (const id of ids) {
      set.add(`${id}|*`);
      for (const t of types) set.add(`${id}|${t}`);
    }
  }

  // Coverage Check table rows: `| 1 | happy | ... |` or `| 1 happy | ... |`.
  const tableRow =
    /^\|\s*(?:story\s+)?([A-Za-z0-9.\-]+)\s*\|?\s*(happy|negative)\b/gim;
  let tm: RegExpExecArray | null;
  while ((tm = tableRow.exec(planText)) !== null) {
    set.add(`${tm[1]}|*`);
    set.add(`${tm[1]}|${tm[2].toLowerCase()}`);
  }
  return set;
}

/**
 * Split `text` into blocks, each beginning at a line matching `headingRe`.
 * Content before the first heading is discarded. Used to isolate plan task
 * blocks (`### Task N`) so per-task fields stay associated.
 */
function splitOnHeadings(text: string, headingRe: RegExp): string[] {
  const blocks: string[] = [];
  let current: string[] | null = null;
  for (const line of text.split('\n')) {
    if (headingRe.test(line)) {
      if (current) blocks.push(current.join('\n'));
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) blocks.push(current.join('\n'));
  return blocks;
}

interface TaskEntry {
  id?: string;
  status?: string;
}

function extractTasks(parsed: unknown): TaskEntry[] {
  if (!parsed || typeof parsed !== 'object') return [];
  // Shape 1: { tasks: [...] } or { tasks: {id: {status}, ...} }
  const container = 'tasks' in (parsed as Record<string, unknown>)
    ? (parsed as Record<string, unknown>).tasks
    : parsed;
  if (Array.isArray(container)) {
    return container
      .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
      .map((t) => ({ id: t.id as string | undefined, status: t.status as string | undefined }));
  }
  if (container && typeof container === 'object') {
    return Object.entries(container).map(([id, v]) => ({
      id,
      status:
        v && typeof v === 'object' && 'status' in v
          ? ((v as Record<string, unknown>).status as string | undefined)
          : undefined,
    }));
  }
  return [];
}

/**
 * Decide whether a step is fully complete. Runs the custom predicate (if any),
 * otherwise falls back to artifact-glob presence. Steps with no declared
 * artifacts and no predicate are always considered complete.
 *
 * `ctx` is threaded into custom predicates that need to compare artifacts
 * against the current session (`sessionStartedAt`) or scope to the current
 * feature (`featureDesc`). When omitted, predicates fail open on freshness.
 */
export async function checkStepCompletion(
  dir: string,
  step: StepName,
  ctx: CompletionContext = {},
): Promise<CompletionResult> {
  const predicate = CUSTOM_COMPLETION_PREDICATES[step];
  if (predicate) return predicate(dir, ctx);

  const completionArtifact = ctx.config?.steps?.[step]?.completion_artifact;
  if (completionArtifact) {
    const artifact = join(dir, completionArtifact);
    const floor = verdictFreshnessFloor(ctx);
    if (floor === undefined) {
      return {
        done: false,
        reason: `configured completion artifact "${completionArtifact}" cannot be verified without an attempt or session freshness floor`,
      };
    }
    const comparand = verdictFreshnessComparand(ctx);
    const artifactStat = await lstat(artifact).catch(() => undefined);
    if (artifactStat === undefined) {
      return {
        done: false,
        reason: `configured completion artifact "${completionArtifact}" is missing — ${step} must write it after a passing review`,
      };
    }
    if (!artifactStat.isFile()) {
      return {
        done: false,
        reason: `configured completion artifact "${completionArtifact}" is not a regular file — ${step} must replace it with a file written after a passing review`,
      };
    }
    const mtimeMs = artifactStat.mtimeMs;
    if (mtimeMs < comparand!) {
      return {
        done: false,
        reason: `configured completion artifact "${completionArtifact}" is stale — ${step} must rewrite it during this attempt`,
      };
    }
    return {
      done: true,
      verdictFreshness: {
        artifact,
        mtimeMs,
        floorMs: floor,
        floorSource: ctx.attemptStartedAt !== undefined ? 'attempt' : 'session',
        outcome: 'rewritten',
        fresh: true,
      },
    };
  }

  const extra = extraArtifactGlobs(step, ctx.config);
  const patterns = [...(STEP_ARTIFACT_GLOBS[step] ?? []), ...extra];
  if (patterns.length === 0) return { done: true };

  const resolutionContext =
    ctx.artifactResolution ??
    (await buildArtifactResolutionContext(dir, {
      planPath: ctx.planPath,
      featureDesc: ctx.featureDesc,
      git: ctx.git,
    }));
  const resolution = await resolveArtifactFiles(dir, step, resolutionContext, extra);
  if (resolution.files.length > 0) return { done: true };
  return {
    done: false,
    reason: resolution.diagnostic?.reason ?? `no files matching ${patterns.join(' or ')}`,
  };
}

/**
 * For dashboard rendering: one record per pattern with the files matched and
 * a ✓/✗ flag. Returns [] for steps that produce no artifacts.
 */
export interface ArtifactPatternStatus {
  pattern: string;
  files: string[]; // relative to `dir`
  satisfied: boolean;
  diagnostic?: ArtifactResolutionResult['diagnostic'];
}

export async function getArtifactStatus(
  dir: string,
  step: StepName,
  context: Pick<ArtifactResolutionContext, 'featureIdentities' | 'changedPaths'> = {
    featureIdentities: [],
    changedPaths: new Set(),
  },
): Promise<ArtifactPatternStatus[]> {
  const patterns = STEP_ARTIFACT_GLOBS[step];
  if (!patterns || patterns.length === 0) return [];

  const resolution = await resolveArtifactFiles(dir, step, context, [], true);
  return (resolution.patternResults ?? []).map(({ pattern, files, diagnostic }) => {
    const relativeFiles = files.map((file) => relative(dir, file));
    return {
      pattern,
      files: relativeFiles,
      satisfied: relativeFiles.length > 0,
      ...(diagnostic ? { diagnostic } : {}),
    };
  });
}

// --- Glob matcher (inlined — avoids extra dependency for a narrow use case) ---

async function matchGlob(root: string, pattern: string): Promise<string[]> {
  const parts = pattern.split('/');
  const files: string[] = [];

  // Leading `*/` package-prefix wildcard: `*/rest` matches `rest` under each
  // immediate subdirectory of `root`. Skip node_modules and dot-dirs so the
  // expansion never walks dependencies or `.git` — preserving the
  // no-node_modules property documented on STEP_ARTIFACT_GLOBS. One level deep;
  // within each package the remaining pattern matches as usual.
  if (parts.length > 1 && parts[0] === '*') {
    const rest = parts.slice(1).join('/');
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      return files;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      files.push(...(await matchGlob(join(root, entry.name), rest)));
    }
    return files;
  }

  const doubleStarIdx = parts.indexOf('**');
  if (doubleStarIdx >= 0) {
    // dir/**/rest — walk recursively under dir, filter by last-segment pattern
    const baseParts = parts.slice(0, doubleStarIdx);
    const tailParts = parts.slice(doubleStarIdx + 1);
    const baseDir = join(root, ...baseParts);
    const tail = tailParts[tailParts.length - 1] ?? '*';
    const matcher = compileSegmentMatcher(tail);
    files.push(...(await walkDir(baseDir, matcher)));
    return files;
  }

  if (parts[parts.length - 1].includes('*')) {
    // dir/*.ext — list one directory
    const dirParts = parts.slice(0, -1);
    const filePattern = parts[parts.length - 1];
    const matcher = compileSegmentMatcher(filePattern);
    const dir = join(root, ...dirParts);
    try {
      const entries = await readdir(dir);
      for (const entry of entries) {
        if (matcher(entry)) files.push(join(dir, entry));
      }
    } catch {
      /* dir missing — no matches */
    }
    return files;
  }

  // Literal path (e.g., `.pipeline/task-status.json`)
  const { access } = await import('fs/promises');
  const full = join(root, pattern);
  try {
    await access(full);
    files.push(full);
  } catch {
    /* not present */
  }
  return files;
}

function compileSegmentMatcher(pattern: string): (name: string) => boolean {
  if (pattern === '*') return () => true;
  // Support `foo-*.md`, `*.md`, `foo*bar.md`
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const re = new RegExp(`^${escaped}$`);
  return (name: string): boolean => re.test(name);
}

async function walkDir(
  dir: string,
  match: (name: string) => boolean,
): Promise<string[]> {
  const found: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await walkDir(full, match)));
    } else if (match(entry.name)) {
      found.push(full);
    }
  }
  return found;
}
