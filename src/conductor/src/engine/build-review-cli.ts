import { readFile as readFileDefault, realpath as realpathDefault } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { join } from 'node:path';

import { deriveEffectiveBuildReviewVerdictWithDispositions, parseBuildReviewAggregate } from './build-review-aggregate.js';
import { BuildReviewDispositionStore, type BuildReviewDispositionAppendResult, type BuildReviewDispositionListResult, type BuildReviewDispositionRecord, type BuildReviewFeatureIdentity } from './build-review-dispositions.js';
import { canonicalizeBuildReviewFindingIdentity } from './build-review-finding-identity.js';
import { parseBuildReviewLapId } from './build-review-domain.js';
import { resolveBuildReviewFeatureIdentity } from './build-review-effective.js';
import { resolveMainRepoRoot } from './park-marker.js';
import { appendCloseoutEvent, type BuildReviewExternalEvent } from './closeout-events.js';

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
  readonly createStore?: (worktree: string) => DispositionStore;
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
  appendIfCurrent?: BuildReviewDispositionStore['appendIfCurrent'];
};

export interface BuildReviewAcceptDeps extends BuildReviewFindingsDeps {
  readonly isInteractive?: boolean;
  readonly resolveOperator?: () => string | undefined;
  readonly resolveRepository?: (root: string) => string | undefined;
  readonly createStore?: (worktree: string) => DispositionStore;
  /** Same-schema external-process event writer (exceptions A/B of the event spine). */
  readonly appendEvent?: (worktree: string, event: Extract<BuildReviewExternalEvent, { type: 'build_review_disposition_accepted' | 'build_review_disposition_refused' }>) => void;
}

type AcceptedDisposition = {
  readonly findingId: string;
  readonly disposition: BuildReviewDispositionRecord;
};

function acceptedDispositions(
  aggregate: NonNullable<ReturnType<typeof parseBuildReviewAggregate>>,
  feature: BuildReviewFeatureIdentity,
  effective: NonNullable<ReturnType<typeof deriveEffectiveBuildReviewVerdictWithDispositions>>,
  records: readonly BuildReviewDispositionRecord[],
): readonly AcceptedDisposition[] {
  const identities = new Map<string, ReturnType<typeof canonicalizeBuildReviewFindingIdentity>>();
  for (const result of Object.values(aggregate.results)) {
    if (result.kind !== 'judged') continue;
    for (const finding of result.findings) {
      const identity = canonicalizeBuildReviewFindingIdentity({
        rubric: result.rubric, contractVersion: result.contractVersion, concernKind: finding.concernKind, anchor: finding.anchor,
      });
      if (identity) identities.set(identity.id, identity);
    }
  }
  return effective.acceptedFindingIds.flatMap((findingId) => {
    const identity = identities.get(findingId);
    const disposition = identity && records.find((record) =>
      record.feature.version === feature.version && record.feature.repository === feature.repository && record.feature.feature === feature.feature &&
      record.finding.id === identity.id && record.finding.canonicalJson === identity.canonicalJson,
    );
    return disposition ? [{ findingId, disposition }] : [];
  });
}

function renderHuman(feature: string, aggregate: NonNullable<ReturnType<typeof parseBuildReviewAggregate>>, effective: NonNullable<ReturnType<typeof deriveEffectiveBuildReviewVerdictWithDispositions>>, accepted: readonly AcceptedDisposition[]): string {
  return [
    `Build review findings: ${feature}`,
    `Lap: ${aggregate.lapId}`,
    `Raw verdict: ${effective.rawVerdict}`,
    `Effective verdict: ${effective.verdict}`,
    `Accepted findings: ${effective.acceptedFindingIds.join(', ') || 'none'}`,
    ...accepted.map(({ findingId, disposition }) => `Accepted disposition: ${findingId} (lap ${disposition.sourceLapId}; operator ${disposition.operator}; rationale: ${disposition.rationale})`),
    `Unresolved findings: ${effective.unresolvedFindingIds.join(', ') || 'none'}`,
    `Skipped rubrics: ${effective.skippedRubrics.join(', ') || 'none'}`,
    `Infrastructure failures: ${effective.infrastructureFailureRubrics.join(', ') || 'none'}`,
  ].join('\n');
}

type ResolvedCliFeature = {
  readonly worktree: string;
  readonly feature: BuildReviewFeatureIdentity;
};

/** The CLI and live runner must address the same canonical feature state. */
async function resolveCliFeature(
  command: Pick<BuildReviewFindingsCommand, 'feature'>,
  deps: Pick<BuildReviewFindingsDeps, 'cwd' | 'resolveMainRoot' | 'realpath'>,
): Promise<ResolvedCliFeature | undefined> {
  try {
    const resolveMainRoot = deps.resolveMainRoot ?? resolveMainRepoRoot;
    const realpath = deps.realpath ?? realpathDefault;
    const root = await resolveMainRoot(deps.cwd ?? process.cwd());
    const worktree = await realpath(join(root, '.worktrees', command.feature));
    const feature = await resolveBuildReviewFeatureIdentity(worktree, { resolveMainRoot, realpath });
    return feature?.feature === command.feature ? { worktree, feature } : undefined;
  } catch {
    return undefined;
  }
}

/** Read only current feature artifacts; this deliberately never constructs a pipeline or state lease. */
export async function dispatchBuildReviewFindings(command: BuildReviewFindingsCommand, deps: BuildReviewFindingsDeps = {}): Promise<number> {
  const print = deps.print ?? console.log;
  try {
    const resolved = await resolveCliFeature(command, deps);
    if (!resolved) throw new Error('feature identity is unavailable');
    const { worktree, feature } = resolved;
    const readFile = deps.readFile ?? ((path: string) => readFileDefault(path, 'utf8'));
    const aggregate = parseBuildReviewAggregate(JSON.parse(await readFile(join(worktree, '.pipeline/build-review.json'))));
    if (!aggregate) throw new Error('aggregate is malformed');
    const listed = await (deps.createStore ?? ((projectRoot: string) => new BuildReviewDispositionStore(projectRoot)))(worktree).list(feature);
    if (!listed.ok) throw new Error(listed.message);
    const records = listed.records;
    const effective = deriveEffectiveBuildReviewVerdictWithDispositions(aggregate, feature, records);
    if (!effective) throw new Error('current findings are invalid');
    const accepted = acceptedDispositions(aggregate, feature, effective, records);
    const output = { feature: command.feature, lapId: aggregate.lapId, snapshotDigest: aggregate.snapshotDigest, ...effective, acceptedDispositions: accepted };
    print(command.format === 'json' ? JSON.stringify(output) : renderHuman(command.feature, aggregate, effective, accepted));
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
  let worktree: string | undefined;
  let feature: BuildReviewFeatureIdentity | undefined;
  try {
    // Resolve the feature-owned external-event target before validating any
    // mutable review state. Every refusal can then be observed through the
    // existing same-schema writer, including argument and TTY failures.
    const resolved = await resolveCliFeature(command, deps);
    if (!resolved) throw new Error('feature identity is unavailable');
    ({ worktree, feature } = resolved);
  } catch {
    print(`build-review accept: refused for '${command.feature}'; the feature worktree could not be resolved.`);
    return 1;
  }
  const refuse = (reason: string, message: string): number => {
    try {
      (deps.appendEvent ?? appendCloseoutEvent)(worktree!, {
        type: 'build_review_disposition_refused', feature: command.feature, reason, ts: new Date().toISOString(),
      });
    } catch {
      // The refusal remains authoritative when best-effort external telemetry cannot append.
    }
    print(message);
    return 1;
  };
  const operator = (deps.resolveOperator ?? (() => userInfo().username))();
  if (!(deps.isInteractive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true)) || !operator?.trim()) {
    return refuse('non-interactive-or-unidentified-operator', 'build-review accept: requires an interactive terminal and a verified local operator identity.');
  }
  const requestedLap = parseBuildReviewLapId(command.lapId);
  if (!requestedLap || !command.rationale.trim()) {
    return refuse('invalid-lap-or-blank-rationale', 'build-review accept: requires an exact current lap and non-empty rationale.');
  }
  try {
    const readFile = deps.readFile ?? ((path: string) => readFileDefault(path, 'utf8'));
    const aggregate = parseBuildReviewAggregate(JSON.parse(await readFile(join(worktree, '.pipeline/build-review.json'))));
    if (!aggregate || aggregate.lapId !== requestedLap) throw new Error('requested lap is not current');
    const currentFinding = [...Object.values(aggregate.results)].flatMap((result) => result.kind === 'judged'
      ? result.findings.map((finding) => ({
        finding,
        identity: canonicalizeBuildReviewFindingIdentity({ rubric: result.rubric, contractVersion: result.contractVersion, concernKind: finding.concernKind, anchor: finding.anchor }),
      }))
      : []).find((candidate) => candidate.identity?.id === command.findingId);
    if (!currentFinding?.identity) throw new Error('finding is not a current judged finding');
    const identity = currentFinding.identity;
    if (!feature) throw new Error('feature identity is unavailable');
    const store = (deps.createStore ?? ((projectRoot: string) => new BuildReviewDispositionStore(projectRoot)))(worktree);
    const appendInput = { feature, finding: identity, sourceLapId: requestedLap, summary: currentFinding.finding.summary, rationale: command.rationale.trim(), operator: operator.trim() };
    const appended = store.appendIfCurrent
      ? await store.appendIfCurrent(appendInput, async (records) => {
        const current = parseBuildReviewAggregate(JSON.parse(await readFile(join(worktree!, '.pipeline/build-review.json'))));
        if (!current || current.lapId !== requestedLap || current.snapshotDigest !== aggregate.snapshotDigest || JSON.stringify(current.results) !== JSON.stringify(aggregate.results)) return false;
        const effective = deriveEffectiveBuildReviewVerdictWithDispositions(aggregate, feature, records);
        return effective?.unresolvedFindingIds.includes(identity.id) === true;
      })
      : await (async () => {
        const listed = await store.list(feature);
        if (!listed.ok) return listed;
        const current = parseBuildReviewAggregate(JSON.parse(await readFile(join(worktree!, '.pipeline/build-review.json'))));
        if (!current || current.lapId !== requestedLap || current.snapshotDigest !== aggregate.snapshotDigest || JSON.stringify(current.results) !== JSON.stringify(aggregate.results)) {
          return { ok: false as const, kind: 'invalid' as const, message: 'current review lap changed while waiting for disposition state' };
        }
        const effective = deriveEffectiveBuildReviewVerdictWithDispositions(aggregate, feature, listed.records);
        if (!effective || !effective.unresolvedFindingIds.includes(identity.id)) return { ok: false as const, kind: 'invalid' as const, message: 'finding is already accepted or not actionable' };
        return store.append(appendInput);
      })();
    if (!appended.ok) throw new Error(appended.message);
    (deps.appendEvent ?? appendCloseoutEvent)(worktree, {
      type: 'build_review_disposition_accepted', feature: command.feature, lapId: requestedLap, findingId: identity.id, operator: operator.trim(), ts: new Date().toISOString(),
    });
    print(`build-review accept: accepted ${identity.id} for lap ${requestedLap}.`);
    return 0;
  } catch {
    if (worktree) {
      try {
        (deps.appendEvent ?? appendCloseoutEvent)(worktree, {
          type: 'build_review_disposition_refused', feature: command.feature, reason: 'current-finding-lap-or-state-invalid', ts: new Date().toISOString(),
        });
      } catch {
        // CLI refusal remains authoritative even if best-effort telemetry cannot append.
      }
    }
    print(`build-review accept: refused for '${command.feature}'; the current finding, lap, or state could not be verified.`);
    return 1;
  }
}
