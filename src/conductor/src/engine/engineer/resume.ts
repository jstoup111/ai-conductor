import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RUN_STEP_ORDER, parseRunRecord, type RunRecord, type RunStepId } from './run-record.js';
import { strictSlugGithubRef } from './source-ref.js';

export type ResumeTarget =
  | { kind: 'pr'; number: number }
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
  const url = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)$/.exec(value);
  if (url) return { kind: 'pr', number: Number(url[1]) };
  if (/^spec\/[a-z0-9][a-z0-9-]*$/.test(value)) return { kind: 'branch', branch: value };
  const intake = strictSlugGithubRef(value);
  if (intake) return { kind: 'intake', repository: intake.repo, number: Number(intake.number) };
  throw new Error(`compose resume: cannot find a Composer run for "${value}" (searched PR, spec branch, and intake reference)`);
}

export function contextForRun(record: RunRecord): ResumeContext {
  // A run record is sparse: track selection can intentionally omit DECIDE
  // steps.  Therefore the first *recorded* draft/reconfirmation is next, not
  // the first optional step absent from the record.
  const nextStep = RUN_STEP_ORDER.find((step) =>
    record.needsReconfirm.includes(step) || record.steps[step]?.state === 'draft',
  ) ?? 'delivery';
  const accepted = RUN_STEP_ORDER.flatMap((step) => {
    const value = record.steps[step];
    return value?.state === 'accepted' ? [value] : [];
  });
  const last = record.ownerHistory.at(-1) ?? accepted.at(-1);
  return {
    slug: record.slug,
    branch: `spec/${record.slug}`,
    nextStep,
    acceptedArtifacts: accepted.flatMap((step) => step.artifacts.map((artifact) => artifact.path)),
    decisions: RUN_STEP_ORDER.flatMap((step) => record.notes[step]?.decisions ?? []),
    openQuestions: RUN_STEP_ORDER.flatMap((step) => record.notes[step]?.openQuestions ?? []),
    drafts: RUN_STEP_ORDER.filter((step) => record.steps[step]?.state === 'draft' || record.needsReconfirm.includes(step)),
    ...(last ? { lastActor: last.actor, lastAt: last.at } : {}),
  };
}

export interface ResumeDeps {
  resolveBranch(target: ResumeTarget): Promise<{ branch: string; draftPrUrl?: string } | undefined>;
  fetch?(branch: string): Promise<void>;
  attach(branch: string): Promise<{ worktree: string }>;
  readRunRecord?(worktree: string, slug: string): Promise<string>;
  recordDeciding?(input: { branch: string; draftPrUrl?: string }): Promise<void>;
  emit?(input: { slug: string; worktreePath: string; previousActor?: string; previousProvider?: string; ownership: 'unchanged' | 'taken-over' }): Promise<void>;
}

/** Attach an existing run. The caller chooses the project and host; this module never infers either. */
export async function resumeComposerRun(value: string, deps: ResumeDeps): Promise<{ worktree: string; context: ResumeContext }> {
  const target = parseResumeTarget(value);
  const resolved = target.kind === 'branch' ? { branch: target.branch } : await deps.resolveBranch(target);
  if (!resolved) throw new Error(`compose resume: no saved Composer run found for ${value}`);
  if (deps.fetch) await deps.fetch(resolved.branch);
  const attached = await deps.attach(resolved.branch);
  const slug = resolved.branch.slice('spec/'.length);
  const raw = await (deps.readRunRecord ?? ((worktree, name) => readFile(join(worktree, '.docs', 'composer-runs', `${name}.json`), 'utf8')))(attached.worktree, slug);
  const record = parseRunRecord(raw);
  const context = contextForRun(record);
  await deps.recordDeciding?.({ branch: resolved.branch, draftPrUrl: resolved.draftPrUrl });
  const previous = [...RUN_STEP_ORDER].reverse().map((step) => record.steps[step]).find((step) => step?.state === 'accepted');
  await deps.emit?.({ slug, worktreePath: attached.worktree, ownership: 'unchanged', ...(previous?.state === 'accepted' ? { previousActor: previous.actor, previousProvider: previous.provider } : {}) });
  return { worktree: attached.worktree, context };
}
