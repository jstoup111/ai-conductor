import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { digestArtifact, parseRunRecord, summarizeRun, type ArtifactDigest, type RunRecord, type RunStepId, type RunSummary } from './run-record.js';
import { strictSlugGithubRef } from './source-ref.js';

export type ResumeTarget =
  | { kind: 'pr'; number: number; repository?: string }
  | { kind: 'branch'; branch: string }
  | { kind: 'intake'; repository: string; number: number };

export interface ResumeContext {
  readonly slug: string;
  readonly branch: string;
  readonly nextStep: RunStepId | 'delivery';
  readonly acceptedArtifacts: readonly string[];
  readonly decisions: readonly string[];
  readonly openQuestions: readonly string[];
  readonly drafts: readonly RunStepId[];
  readonly lastActor?: string;
  readonly lastAt?: string;
}

/** Local state is explicit at resume boundaries; callers must choose, never overwrite. */
export interface ResumeLeftovers {
  readonly dirtyDocs: readonly string[];
  readonly unpushedCommits: readonly string[];
}

export type ResumeLocalChoice = 'keep-local' | 'discard-local' | 'refuse';

export function chooseResumeLocalState(input: {
  leftovers: ResumeLeftovers;
  interactive: boolean;
  choice?: 'keep-local' | 'discard-local';
  fastForwardable: boolean;
}): ResumeLocalChoice {
  if (input.leftovers.dirtyDocs.length === 0 && input.leftovers.unpushedCommits.length === 0) return 'keep-local';
  if (!input.interactive || !input.choice) return 'refuse';
  if (input.choice === 'keep-local' && !input.fastForwardable) return 'refuse';
  return input.choice;
}

/** Engine sessions cannot take over another operator's local decision branch. */
export function resumeOwnershipMode(input: {
  committedOwner?: string;
  machineOwner?: string;
  daemonSession: boolean;
  interactive: boolean;
  approved?: boolean;
}): 'unchanged' | 'taken-over' | 'local-only' {
  if (!input.machineOwner) throw new Error('compose resume: machine identity is unresolved');
  if (!input.committedOwner || input.committedOwner === input.machineOwner) return 'unchanged';
  if (input.daemonSession || !input.interactive || input.approved !== true) return 'local-only';
  return 'taken-over';
}

/** Parse the only stable resume selectors; GitHub resolution is deliberately injected. */
export function parseResumeTarget(value: string): ResumeTarget {
  if (/^\d+$/.test(value)) return { kind: 'pr', number: Number(value) };
  const url = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)$/.exec(value);
  if (url) return { kind: 'pr', repository: url[1], number: Number(url[2]) };
  if (/^spec\/[a-z0-9][a-z0-9-]*$/.test(value)) return { kind: 'branch', branch: value };
  const intake = strictSlugGithubRef(value);
  if (intake) return { kind: 'intake', repository: intake.repo, number: Number(intake.number) };
  throw new Error(`compose resume: cannot find a Composer run for "${value}" (searched PR, spec branch, and intake reference)`);
}

export function contextForRun(record: RunRecord, summary: RunSummary = summarizeRun(record)): ResumeContext {
  return {
    slug: record.slug,
    branch: `spec/${record.slug}`,
    nextStep: summary.nextStep,
    acceptedArtifacts: summary.acceptedSteps.flatMap((step) => step.artifacts.map((artifact) => artifact.path)),
    decisions: summary.decisions,
    openQuestions: summary.openQuestions,
    drafts: summary.drafts,
    ...(summary.lastActor ? { lastActor: summary.lastActor, lastAt: summary.lastAt } : {}),
  };
}

export interface ResumeDeps {
  resolveBranch(target: ResumeTarget): Promise<{ branch: string; draftPrUrl?: string } | undefined>;
  fetch?(branch: string): Promise<void>;
  attach(branch: string): Promise<{ worktree: string }>;
  readRunRecord?(worktree: string, slug: string): Promise<string>;
  /** Current committed artifact bytes make acceptance a claim about this checkout, not stale JSON. */
  readArtifact?(worktree: string, path: string): Promise<Uint8Array>;
  recordDeciding?(input: { branch: string; draftPrUrl?: string; sourceRef?: string }): Promise<void>;
  /** Reads intake identity after attach, before durable ledger reconstruction. */
  sourceRef?(worktree: string, slug: string): Promise<string | undefined>;
  /** Ownership is resolved only after the committed marker is available. */
  ownership?(input: { worktree: string; slug: string; branch: string }): Promise<'unchanged' | 'taken-over' | 'local-only'>;
  /** Applied before attach so local work is never overwritten implicitly. */
  localState?(branch: string): Promise<{ leftovers: ResumeLeftovers; interactive: boolean; choice?: 'keep-local' | 'discard-local'; fastForwardable: boolean; discard?(): Promise<void> }>;
  emit?(input: { slug: string; worktreePath: string; previousActor?: string; previousProvider?: string; ownership: 'unchanged' | 'taken-over' }): Promise<void>;
}

/** Attach an existing run. The caller chooses the project and host; this module never infers either. */
export async function resumeComposerRun(value: string, deps: ResumeDeps): Promise<{ worktree: string; context: ResumeContext }> {
  const target = parseResumeTarget(value);
  // Branch selectors still need the associated draft PR.  The ledger uses its
  // URL as the remote in-flight identity on machines with no local history.
  const resolved = await deps.resolveBranch(target) ?? (target.kind === 'branch' ? { branch: target.branch } : undefined);
  if (!resolved) throw new Error(`compose resume: no saved Composer run found for ${value} (searched the selected PR, spec branch, and intake reference)`);
  if (deps.fetch) await deps.fetch(resolved.branch);
  const local = await deps.localState?.(resolved.branch);
  if (local) {
    const choice = chooseResumeLocalState(local);
    if (choice === 'refuse') {
      const names = [...local.leftovers.dirtyDocs, ...local.leftovers.unpushedCommits];
      throw new Error(`compose resume: local leftovers (${names.join(', ')}) require interactive keep-local or discard-local; divergent commits can be preserved with the backup option.`);
    }
    if (choice === 'discard-local') await local.discard?.();
  }
  const attached = await deps.attach(resolved.branch);
  const slug = resolved.branch.slice('spec/'.length);
  const ownership = await deps.ownership?.({ worktree: attached.worktree, slug, branch: resolved.branch }) ?? 'unchanged';
  let raw: string;
  try {
    raw = await (deps.readRunRecord ?? ((worktree, name) => readFile(join(worktree, '.docs', 'composer-runs', `${name}.json`), 'utf8')))(attached.worktree, slug);
  } catch (error) {
    // land-spec intentionally strips the record. A branch which has already
    // landed resumes at delivery instead of presenting an ENOENT as corruption.
    if (error instanceof Error && /ENOENT/.test(error.message)) {
      return {
        worktree: attached.worktree,
        context: { slug, branch: resolved.branch, nextStep: 'delivery', acceptedArtifacts: [], decisions: [], openQuestions: [], drafts: [] },
      };
    }
    throw error;
  }
  const record = parseRunRecord(raw);
  const reader = deps.readArtifact;
  const known = Object.values(record.steps).flatMap((step) => step?.state === 'accepted' ? step.artifacts : []);
  const current = reader ? await Promise.all(known.map(async (artifact) => {
    try {
      const bytes = await reader(attached.worktree, artifact.path);
      return digestArtifact(artifact.path, bytes);
    } catch { return undefined; }
  })) : [];
  const currentDigests = current.filter((entry): entry is ArtifactDigest => entry !== undefined);
  // A missing artifact is a failed acceptance comparison, not permission to
  // skip all comparisons.  Passing the readable subset makes classifyArtifacts
  // surface both the changed files and the unavailable one as drafts.
  const summary = summarizeRun(record, reader ? currentDigests : undefined);
  const context = contextForRun(record, summary);
  const sourceRef = await deps.sourceRef?.(attached.worktree, slug);
  await deps.recordDeciding?.({
    branch: resolved.branch,
    draftPrUrl: resolved.draftPrUrl,
    ...(sourceRef ? { sourceRef } : {}),
  });
  const previous = summary.lastAcceptedStep;
  await deps.emit?.({ slug, worktreePath: attached.worktree, ownership: ownership === 'taken-over' ? 'taken-over' : 'unchanged', ...(previous ? { previousActor: previous.actor, previousProvider: previous.provider } : {}) });
  return { worktree: attached.worktree, context };
}
