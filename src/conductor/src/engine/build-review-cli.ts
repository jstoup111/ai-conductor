import { readFile as readFileDefault, realpath as realpathDefault } from 'node:fs/promises';
import { join } from 'node:path';

import { deriveEffectiveBuildReviewVerdictWithDispositions, parseBuildReviewAggregate } from './build-review-aggregate.js';
import type { BuildReviewDispositionRecord, BuildReviewFeatureIdentity } from './build-review-dispositions.js';
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
