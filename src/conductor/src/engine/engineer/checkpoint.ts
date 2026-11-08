import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeIntakeMarker } from './intake-marker.js';
import {
  RUN_RECORD_SCHEMA_VERSION,
  RUN_STEP_ORDER,
  digestArtifact,
  parseRunRecord,
  recordAcceptance,
  serializeRunRecord,
  type RunRecord,
  type RunStepId,
  type StepNotes,
} from './run-record.js';
import type { OwnerResolution } from '../owner-gate/identity.js';

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
}

export interface CheckpointResult {
  readonly slug: string;
  readonly state: 'accepted' | 'draft';
  readonly committed: boolean;
  readonly published: false;
}

const defaultFs: CheckpointFileSystem = {
  readFile: (path) => readFile(path, 'utf8'),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }),
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
 * Save a DECIDE boundary locally. Publication is intentionally owned by Task 4;
 * this operation has no push/PR path, even when a remote exists.
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

  // Do not manufacture a record-only commit when no authored docs await a checkpoint.
  if (dirtyDocs.length === 0) {
    await deps.emit(event);
    return { slug, state: request.state, committed: false, published: false };
  }

  const recordPath = join(request.worktree, '.docs', 'composer-runs', `${slug}.json`);
  let record = emptyRecord(slug);
  try { record = parseRunRecord(await fs.readFile(recordPath)); } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('ENOENT')) throw error;
  }
  const notes = await notesFor(request, fs);
  if (request.state === 'accepted') {
    const artifacts = await Promise.all(dirtyDocs
      .filter((path) => !path.startsWith('.docs/composer-runs/') && !path.startsWith('.docs/intake/'))
      .map(async (path) => digestArtifact(path, Buffer.from(await fs.readFile(join(request.worktree, path))))));
    record = recordAcceptance(record, { step, actor: owner.id, provider, at: (deps.now ?? (() => new Date().toISOString()))(), artifacts, ...notes });
  } else {
    record = { ...record, steps: { ...record.steps, [step]: { state: 'draft' } }, notes: { ...record.notes, [step]: notes } };
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
    const commit = await deps.git(['commit', '-m', `composer checkpoint: ${slug} ${step}`]);
    if (commit.exitCode !== 0) throw new Error(`compose checkpoint: local commit failed: ${commit.stderr}`);
  }
  await deps.emit(event);
  return { slug, state: request.state, committed, published: false };
}
