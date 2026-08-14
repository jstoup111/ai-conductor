import { readFile as readFileDefault, realpath as realpathDefault } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { join } from 'node:path';

import { deriveEffectiveBuildReviewVerdictWithDispositions, parseBuildReviewAggregate } from './build-review-aggregate.js';
import { BuildReviewDispositionStore, type BuildReviewDispositionAppendResult, type BuildReviewDispositionListResult, type BuildReviewDispositionRecord, type BuildReviewFeatureIdentity } from './build-review-dispositions.js';
import { canonicalizeBuildReviewFindingIdentity } from './build-review-finding-identity.js';
import { parseBuildReviewLapId } from './build-review-domain.js';
import { resolveMainRepoRoot } from './park-marker.js';

export interface BuildReviewFindingsCommand {
  readonly kind: 'findings';
  readonly feature: string;
  readonly format: 'human' | 'json';
}

export interface BuildReviewFindingsDeps {
  readonly cwd?: string;
  readonly resolveMainRoot?: (cwd: string) => Promise<string>;
  readonly realpath?: (path: string) => Promise<string>;
  readonly readFile?: (path: string) => Promise<string>;
  readonly print?: (output: string) => void;
}

export interface BuildReviewAcceptCommand {
  readonly kind: 'accept';
  readonly feature: string;
  readonly lapId: string;
  readonly findingId: string;
  readonly rationale: string;
}

type DispositionStore = {
  list(feature: unknown): Promise<BuildReviewDispositionListResult>;
  append(input: Parameters<BuildReviewDispositionStore['append']>[0]): Promise<BuildReviewDispositionAppendResult>;
};

export interface BuildReviewAcceptDeps extends BuildReviewFindingsDeps {
  readonly isInteractive?: boolean;
  readonly resolveOperator?: () => string | undefined;
  readonly resolveRepository?: (root: string) => string | undefined;
  readonly createStore?: (worktree: string) => DispositionStore;
}

function recordsForFeature(value: unknown, slug: string): readonly BuildReviewDispositionRecord[] | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const state = value as { version?: unknown; records?: unknown };
  if (state.version !== 'v1' || !Array.isArray(state.records)) return undefined;
  return state.records.filter((entry): entry is BuildReviewDispositionRecord =>
    typeof entry === 'object' && entry !== null && !Array.isArray(entry) &&
    (entry as { feature?: { feature?: unknown } }).feature?.feature === slug,
  );
}

function renderHuman(feature: string, aggregate: NonNullable<ReturnType<typeof parseBuildReviewAggregate>>, effective: NonNullable<ReturnType<typeof deriveEffectiveBuildReviewVerdictWithDispositions>>): string {
  return [
    `Build review findings: ${feature}`,
    `Lap: ${aggregate.lapId}`,
    `Raw verdict: ${effective.rawVerdict}`,
    `Effective verdict: ${effective.verdict}`,
    `Accepted findings: ${effective.acceptedFindingIds.join(', ') || 'none'}`,
    `Unresolved findings: ${effective.unresolvedFindingIds.join(', ') || 'none'}`,
    `Skipped rubrics: ${effective.skippedRubrics.join(', ') || 'none'}`,
    `Infrastructure failures: ${effective.infrastructureFailureRubrics.join(', ') || 'none'}`,
  ].join('\n');
}

/** Read only current feature artifacts; this deliberately never constructs a pipeline or state lease. */
export async function dispatchBuildReviewFindings(command: BuildReviewFindingsCommand, deps: BuildReviewFindingsDeps = {}): Promise<number> {
  const print = deps.print ?? console.log;
  try {
    const root = await (deps.resolveMainRoot ?? resolveMainRepoRoot)(deps.cwd ?? process.cwd());
    const worktree = await (deps.realpath ?? realpathDefault)(join(root, '.worktrees', command.feature));
    const readFile = deps.readFile ?? ((path: string) => readFileDefault(path, 'utf8'));
    const aggregate = parseBuildReviewAggregate(JSON.parse(await readFile(join(worktree, '.pipeline/build-review.json'))));
    if (!aggregate) throw new Error('aggregate is malformed');
    let records: readonly BuildReviewDispositionRecord[] = [];
    try {
      const parsed = recordsForFeature(JSON.parse(await readFile(join(worktree, '.pipeline/build-review-dispositions.json'))), command.feature);
      if (!parsed) throw new Error('dispositions are malformed');
      records = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const repository = records[0]?.feature.repository ?? 'unknown';
    const feature: BuildReviewFeatureIdentity = { version: 'v1', repository, feature: command.feature };
    const effective = deriveEffectiveBuildReviewVerdictWithDispositions(aggregate, feature, records);
    if (!effective) throw new Error('current findings are invalid');
    const output = { feature: command.feature, lapId: aggregate.lapId, snapshotDigest: aggregate.snapshotDigest, ...effective };
    print(command.format === 'json' ? JSON.stringify(output) : renderHuman(command.feature, aggregate, effective));
    return 0;
  } catch {
    print(`build-review findings: current feature state is invalid or unavailable for '${command.feature}'.`);
    return 1;
  }
}

/**
 * Accept a single current finding. The TTY and machine-user checks happen
 * before any artifact or store access: provider children and piped scripts
 * cannot turn CLI arguments into an operator disposition.
 */
export async function dispatchBuildReviewAccept(command: BuildReviewAcceptCommand, deps: BuildReviewAcceptDeps = {}): Promise<number> {
  const print = deps.print ?? console.log;
  const operator = (deps.resolveOperator ?? (() => userInfo().username))();
  if (!(deps.isInteractive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true)) || !operator?.trim()) {
    print('build-review accept: requires an interactive terminal and a verified local operator identity.');
    return 1;
  }
  const requestedLap = parseBuildReviewLapId(command.lapId);
  if (!requestedLap || !command.rationale.trim()) {
    print('build-review accept: requires an exact current lap and non-empty rationale.');
    return 1;
  }
  try {
    const root = await (deps.resolveMainRoot ?? resolveMainRepoRoot)(deps.cwd ?? process.cwd());
    const worktree = await (deps.realpath ?? realpathDefault)(join(root, '.worktrees', command.feature));
    const readFile = deps.readFile ?? ((path: string) => readFileDefault(path, 'utf8'));
    const aggregate = parseBuildReviewAggregate(JSON.parse(await readFile(join(worktree, '.pipeline/build-review.json'))));
    if (!aggregate || aggregate.lapId !== requestedLap) throw new Error('requested lap is not current');
    const identity = [...Object.values(aggregate.results)].flatMap((result) => result.kind === 'judged'
      ? result.findings.map((finding) => canonicalizeBuildReviewFindingIdentity({ rubric: result.rubric, contractVersion: result.contractVersion, concernKind: finding.concernKind, anchor: finding.anchor }))
      : []).find((candidate) => candidate?.id === command.findingId);
    if (!identity) throw new Error('finding is not a current judged finding');
    const repository = (deps.resolveRepository ?? ((projectRoot: string) => projectRoot))(root);
    if (!repository?.trim()) throw new Error('machine-scoped repository identity is unavailable');
    const feature: BuildReviewFeatureIdentity = { version: 'v1', repository, feature: command.feature };
    const store = (deps.createStore ?? ((projectRoot: string) => new BuildReviewDispositionStore(projectRoot)))(worktree);
    const listed = await store.list(feature);
    if (!listed.ok) throw new Error(listed.message);
    const effective = deriveEffectiveBuildReviewVerdictWithDispositions(aggregate, feature, listed.records);
    if (!effective || !effective.unresolvedFindingIds.includes(identity.id)) throw new Error('finding is already accepted or not actionable');
    const appended = await store.append({ feature, finding: identity, sourceLapId: requestedLap, summary: identity.canonicalPayload.concernKind, rationale: command.rationale.trim(), operator: operator.trim() });
    if (!appended.ok) throw new Error(appended.message);
    print(`build-review accept: accepted ${identity.id} for lap ${requestedLap}.`);
    return 0;
  } catch {
    print(`build-review accept: refused for '${command.feature}'; the current finding, lap, or state could not be verified.`);
    return 1;
  }
}
