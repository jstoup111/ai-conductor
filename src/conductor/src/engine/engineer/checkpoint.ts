import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeIntakeMarker } from './intake-marker.js';
import {
  RUN_RECORD_SCHEMA_VERSION,
  RUN_STEP_ORDER,
  digestArtifact,
  parseRunRecord,
  recordAcceptance,
  recordDraft,
  serializeRunRecord,
  stepForArtifactPath,
  type RunRecord,
  type RunStepId,
  type StepNotes,
} from './run-record.js';
import type { OwnerResolution } from '../owner-gate/identity.js';
import { withDaemonCoAuthorTrailer } from '../bot-co-author.js';
import { renderRunBlock, upsertRunBlock } from './run-pr-block.js';

export interface CheckpointGitResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** A deliberately narrow local-git seam: checkpoints never publish remotely. */
export type CheckpointGitRunner = (args: readonly string[]) => Promise<CheckpointGitResult>;

export interface CheckpointFileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, contents: string): Promise<void>;
  mkdir(path: string): Promise<void>;
}

export interface CheckpointRequest {
  readonly worktree: string;
  readonly step: string;
  readonly state: 'accepted' | 'draft';
  readonly notesFile?: string;
}

export interface CheckpointDeps {
  readonly git: CheckpointGitRunner;
  readonly resolveOwner: () => Promise<OwnerResolution>;
  readonly fs?: CheckpointFileSystem;
  readonly writeMarker?: (worktree: string, slug: string, owner: string) => Promise<void>;
  readonly emit: (event: {
    type: 'composer_run_checkpointed'; slug: string; step: string; state: 'accepted' | 'draft';
    published: boolean; provider: string; actor: string;
  }) => Promise<void>;
  readonly now?: () => string;
  readonly provider?: string;
  /** Guarded publication seam. Keeping transport outside record mutation makes retries idempotent. */
  readonly publication?: {
    push(branch: string): Promise<void>;
    findOpenPullRequest(branch: string): Promise<{ url: string; body: string } | undefined>;
    createDraftPullRequest(input: { branch: string; base: string; title: string; body: string; draft: true }): Promise<{ url: string; body: string }>;
    editPullRequest?(input: { url: string; body: string }): Promise<void>;
    /** Called only after a branch has a durable draft PR. */
    published?(input: { slug: string; branch: string; prUrl: string }): Promise<void>;
    defaultBase?: string;
  };
}

export interface CheckpointResult {
  readonly slug: string;
  readonly state: 'accepted' | 'draft';
  readonly committed: boolean;
  readonly published: boolean;
  readonly prUrl?: string;
}

async function publishCheckpoint(
  slug: string,
  worktree: string,
  state: CheckpointRequest['state'],
  record: RunRecord,
  deps: CheckpointDeps,
  event: { type: 'composer_run_checkpointed'; slug: string; step: string; state: 'accepted' | 'draft'; published: boolean; provider: string; actor: string },
): Promise<CheckpointResult> {
  const publication = deps.publication;
  if (!publication) {
    await deps.emit(event);
    return { slug, state, committed: false, published: false };
  }
  const branch = `spec/${slug}`;
  try {
    await publication.push(branch);
  } catch (error) {
    throw new Error(`compose checkpoint: local checkpoint was saved but push failed: ${error instanceof Error ? error.message : String(error)}. Retry with compose resume ${branch}`);
  }
  let pr = await publication.findOpenPullRequest(branch);
  const block = renderRunBlock(record);
  if (!pr) {
    let sourceRef: string | undefined;
    try {
      const marker = await (deps.fs ?? defaultFs).readFile(join(worktree, '.docs', 'intake', `${slug}.md`));
      sourceRef = /^Source-Ref:\s*(.+)$/m.exec(marker)?.[1]?.trim();
    } catch { /* hand-authored runs have no intake marker */ }
    const metadata = '## Release metadata\n\nRelease-Disposition: no-note';
    const refs = sourceRef ? `\n\nRefs ${sourceRef}` : '';
    pr = await publication.createDraftPullRequest({
      branch,
      base: publication.defaultBase ?? 'main',
      title: `DECIDE: ${slug}`,
      body: `${metadata}${refs}\n\n${upsertRunBlock('', block)}`,
      draft: true,
    });
  } else if (publication.editPullRequest) {
    try { await publication.editPullRequest({ url: pr.url, body: upsertRunBlock(pr.body, block) }); } catch {
      // A presentation failure never invalidates the durable commit/push.  The
      // next checkpoint deliberately retries this edit even when it is clean.
    }
  }
  await publication.published?.({ slug, branch, prUrl: pr.url });
  await deps.emit({ ...event, published: true });
  return { slug, state, committed: false, published: true, prUrl: pr.url };
}

const defaultFs: CheckpointFileSystem = {
  readFile: (path) => readFile(path, 'utf8'),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  mkdir: async (path) => { await mkdir(path, { recursive: true }); },
};

function emptyRecord(slug: string): RunRecord {
  return {
    schemaVersion: RUN_RECORD_SCHEMA_VERSION,
    slug,
    steps: {},
    needsReconfirm: [],
    ownerHistory: [],
    notes: {},
  };
}

function parseDirtyDocs(porcelain: string): string[] {
  const paths: string[] = [];
  const outsideDocs: string[] = [];
  for (const line of porcelain.split('\n')) {
    if (!line.trim()) continue;
    const path = line.slice(3).replace(/^"|"$/g, '');
    // Git's rename representation contains two paths; both must stay within docs.
    const candidates = path.split(' -> ').map((candidate) => candidate.trim());
    for (const candidate of candidates) {
      if (!candidate.startsWith('.docs/')) outsideDocs.push(candidate);
      else paths.push(candidate);
    }
  }
  if (outsideDocs.length > 0) {
    throw new Error(`compose checkpoint: refusing dirty paths outside .docs/: ${outsideDocs.join(', ')}`);
  }
  return [...new Set(paths)];
}

async function notesFor(request: CheckpointRequest, fs: CheckpointFileSystem): Promise<StepNotes> {
  if (!request.notesFile) return { decisions: [], openQuestions: [] };
  const serialized = await fs.readFile(request.notesFile);
  let value: unknown;
  try { value = JSON.parse(serialized); } catch { throw new Error('compose checkpoint: --notes-file must contain JSON'); }
  if (
    value === null || typeof value !== 'object' || Array.isArray(value)
    || !Array.isArray((value as StepNotes).decisions) || !Array.isArray((value as StepNotes).openQuestions)
    || (value as StepNotes).decisions.some((entry) => typeof entry !== 'string')
    || (value as StepNotes).openQuestions.some((entry) => typeof entry !== 'string')
  ) throw new Error('compose checkpoint: --notes-file must contain decisions and openQuestions string arrays');
  return value as StepNotes;
}

function requireStep(step: string): RunStepId {
  if (!(RUN_STEP_ORDER as readonly string[]).includes(step)) throw new Error(`compose checkpoint: unknown DECIDE step "${step}"`);
  return step as RunStepId;
}

async function resolveSlug(git: CheckpointGitRunner): Promise<string> {
  const branch = await git(['branch', '--show-current']);
  const name = branch.stdout.trim();
  if (branch.exitCode !== 0 || !name.startsWith('spec/') || name.slice(5).length === 0) {
    throw new Error('compose checkpoint: worktree is not on a spec/<slug> branch');
  }
  return name.slice(5);
}

/**
 * Save a DECIDE boundary. A committed record remains local if guarded publication
 * fails, so a retry never re-accepts a step.
 */
export async function checkpointComposerRun(request: CheckpointRequest, deps: CheckpointDeps): Promise<CheckpointResult> {
  const step = requireStep(request.step);
  const fs = deps.fs ?? defaultFs;
  const owner = await deps.resolveOwner();
  if (!owner.resolved) throw new Error('compose checkpoint: machine identity is unresolved; configure spec_owner or authenticate with gh');

  const slug = await resolveSlug(deps.git);
  const status = await deps.git(['status', '--porcelain', '--untracked-files=all']);
  if (status.exitCode !== 0) throw new Error(`compose checkpoint: could not inspect worktree: ${status.stderr}`);
  const dirtyDocs = parseDirtyDocs(status.stdout);
  const provider = deps.provider?.trim() || 'unrecorded';
  const event = {
    type: 'composer_run_checkpointed' as const,
    slug,
    step,
    state: request.state,
    published: false,
    provider,
    actor: owner.id,
  };

  const recordPath = join(request.worktree, '.docs', 'composer-runs', `${slug}.json`);
  let record = emptyRecord(slug);
  let recordExists = true;
  try { record = parseRunRecord(await fs.readFile(recordPath)); } catch (error) {
    recordExists = false;
    if (!(error instanceof Error) || !error.message.startsWith('ENOENT')) throw error;
  }
  const acceptingSavedDraft = request.state === 'accepted' && record.steps[step]?.state === 'draft';
  // A resumed draft is already committed, so it has no dirty files. Recover its
  // paths from the checkpoint commit before recording the explicit acceptance.
  const draftPaths = acceptingSavedDraft && dirtyDocs.length === 0
    ? (await deps.git(['show', '--format=', '--name-only', 'HEAD', '--', '.docs'])).stdout
      .split('\n')
      .map((path) => path.trim())
      .filter((path) => stepForArtifactPath(path) === step)
    : [];
  const reconfirming = request.state === 'accepted'
    && record.needsReconfirm.includes(step)
    && record.steps[step]?.state === 'accepted';
  // A clean retry must still publish the previously committed checkpoint.  A
  // clean reconfirmation is the one exception: it changes the run record only.
  if (dirtyDocs.length === 0 && draftPaths.length === 0 && !reconfirming) {
    if (!recordExists) {
      await deps.emit(event);
      return { slug, state: request.state, committed: false, published: false };
    }
    const published = await publishCheckpoint(slug, request.worktree, request.state, record, deps, event);
    return { ...published, committed: false };
  }
  const notes = await notesFor(request, fs);
  if (request.state === 'accepted') {
    const paths = dirtyDocs.length > 0 ? dirtyDocs : draftPaths;
    const priorArtifacts = record.steps[step]?.state === 'accepted' ? record.steps[step].artifacts : [];
    const artifacts = paths.length > 0 ? await Promise.all(paths
      .filter((path) => !path.startsWith('.docs/composer-runs/') && !path.startsWith('.docs/intake/'))
      .map(async (path) => digestArtifact(path, Buffer.from(await fs.readFile(join(request.worktree, path)))))) : priorArtifacts;
    record = recordAcceptance(record, { step, actor: owner.id, provider, at: (deps.now ?? (() => new Date().toISOString()))(), artifacts, ...notes });
  } else {
    record = { ...recordDraft(record, step), notes: { ...record.notes, [step]: notes } };
  }

  if (!record.ownerHistory.some((entry) => entry.actor === owner.id)) {
    record = { ...record, ownerHistory: [...record.ownerHistory, { actor: owner.id, at: (deps.now ?? (() => new Date().toISOString()))() }] };
  }
  await fs.mkdir(join(request.worktree, '.docs', 'composer-runs'));
  await fs.writeFile(recordPath, serializeRunRecord(record));
  await (deps.writeMarker ?? (async (worktree, markerSlug, markerOwner) => {
    await writeIntakeMarker(worktree, markerSlug, undefined, markerOwner);
  }))(request.worktree, slug, owner.id);

  const add = await deps.git(['add', '--', '.docs']);
  if (add.exitCode !== 0) throw new Error(`compose checkpoint: could not stage .docs: ${add.stderr}`);
  const staged = await deps.git(['diff', '--cached', '--quiet']);
  const committed = staged.exitCode === 1;
  if (staged.exitCode !== 0 && staged.exitCode !== 1) throw new Error(`compose checkpoint: could not inspect staged changes: ${staged.stderr}`);
  if (committed) {
    const commit = await deps.git(['commit', '-m', withDaemonCoAuthorTrailer(`composer checkpoint: ${slug} ${step}`)]);
    if (commit.exitCode !== 0) throw new Error(`compose checkpoint: local commit failed: ${commit.stderr}`);
  }
  const published = await publishCheckpoint(slug, request.worktree, request.state, record, deps, event);
  return { ...published, committed };
}
