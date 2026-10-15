import { access, readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { findBuiltInProviderDescriptor } from '../execution/provider-catalog.js';
import { resolveMainRepoRoot } from './park-marker.js';
import { sanitizeTranscriptLine } from './self-host/transcript-sanitize.js';

export type TranscriptsDispatch =
  | { readonly kind: 'list'; readonly slug: string }
  | { readonly kind: 'show'; readonly slug: string; readonly capture: string }
  | { readonly kind: 'guide' };

type Capture = {
  readonly path: string;
  readonly step: string;
  readonly attempt: number;
  readonly member?: string;
  readonly provider: string;
  readonly interrupted: boolean;
  readonly timestamp: number;
};

type LedgerEvent = Record<string, unknown>;

export function detectTranscriptsCommand(argv: string[]): TranscriptsDispatch | null {
  if (argv[2] !== 'transcripts') return null;
  const [slug, ...rest] = argv.slice(3);
  if (!slug || slug.startsWith('-')) return { kind: 'guide' };
  if (rest.length === 0) return { kind: 'list', slug };
  if (rest.length === 2 && rest[0] === '--show' && rest[1] && !rest[1].startsWith('-')) {
    return { kind: 'show', slug, capture: rest[1] };
  }
  return { kind: 'guide' };
}

function isEvent(value: unknown): value is LedgerEvent {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function captureFrom(event: LedgerEvent, fallbackTimestamp: number): Capture | undefined {
  if (event.type !== 'provider_transcripts_captured') return undefined;
  if (typeof event.path !== 'string' || typeof event.step !== 'string' || typeof event.attempt !== 'number'
    || typeof event.provider !== 'string' || typeof event.interrupted !== 'boolean') return undefined;
  return {
    path: event.path,
    step: event.step,
    attempt: event.attempt,
    ...(typeof event.member === 'string' ? { member: event.member } : {}),
    provider: event.provider,
    interrupted: event.interrupted,
    timestamp: typeof event.ts === 'number' ? event.ts : fallbackTimestamp,
  };
}

async function readRetainedCaptures(worktree: string): Promise<Capture[]> {
  let content: string;
  try {
    content = await readFile(join(worktree, '.pipeline', 'events.jsonl'), 'utf8');
  } catch {
    return [];
  }

  const captures = new Map<string, Capture>();
  const retained = new Set<string>();
  const removed = new Set<string>();
  for (const [index, line] of content.split('\n').entries()) {
    try {
      const event: unknown = JSON.parse(line);
      if (!isEvent(event) || typeof event.path !== 'string') continue;
      const capture = captureFrom(event, index);
      if (capture) captures.set(capture.path, capture);
      if (event.type === 'provider_transcripts_retained') retained.add(event.path);
      if (event.type === 'provider_transcripts_pruned' || event.type === 'provider_transcripts_evicted') removed.add(event.path);
    } catch {
      // An interrupted append must not make the read-only diagnostic unavailable.
    }
  }

  const result: Capture[] = [];
  for (const [path, capture] of captures) {
    if (!retained.has(path) || removed.has(path) || !isCapturePath(path)) continue;
    try {
      await access(join(worktree, path));
      result.push(capture);
    } catch {
      // The retention ledger is historical; only captures still on disk are readable.
    }
  }
  return result.sort((a, b) => b.timestamp - a.timestamp);
}

function isCapturePath(path: string): boolean {
  return path.startsWith('.pipeline/transcripts/') && !path.split('/').includes('..');
}

async function findFiles(root: string, prefix: string, files: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    const relativePath = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await findFiles(path, relativePath, files);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path);
  }
  return files;
}

async function sessionFile(worktree: string, capture: Capture): Promise<string | undefined> {
  const captureRoot = join(worktree, capture.path);
  const source = capture.provider === 'claude' ? 'projects' : 'sessions';
  const candidates = await findFiles(join(captureRoot, source), source);
  const topLevel = capture.provider === 'claude'
    ? candidates.filter((path) => !relative(captureRoot, path).split(sep).includes('subagents'))
    : candidates;
  if (topLevel.length === 0) return undefined;
  const dated = await Promise.all(topLevel.map(async (path) => ({ path, mtime: (await stat(path)).mtimeMs })));
  return dated.sort((a, b) => b.mtime - a.mtime)[0]?.path;
}

function sanitizedMessage(message: string): string {
  const line = sanitizeTranscriptLine(JSON.stringify({ message }), []);
  try {
    const parsed: unknown = JSON.parse(line);
    if (isEvent(parsed) && typeof parsed.message === 'string') return parsed.message;
  } catch {
    // The sanitizer preserves JSON for JSON inputs, but fail closed if that changes.
  }
  return '[REDACTED]';
}

export async function dispatchTranscripts(cmd: TranscriptsDispatch, cwd: string): Promise<number> {
  if (cmd.kind === 'guide') {
    console.error('ai-conductor transcripts <slug> [--show <capture>]');
    return 1;
  }
  const repoRoot = await resolveMainRepoRoot(cwd);
  const worktree = join(repoRoot, '.worktrees', cmd.slug);
  try {
    await access(worktree);
  } catch {
    console.error(`no feature worktree for ${cmd.slug}`);
    return 1;
  }
  const captures = await readRetainedCaptures(worktree);
  if (cmd.kind === 'list') {
    if (captures.length === 0) console.log(`no retained transcripts for ${cmd.slug}`);
    for (const capture of captures) {
      console.log(`step=${capture.step} attempt=${capture.attempt} member=${capture.member ?? '-'} provider=${capture.provider} interrupted=${capture.interrupted} path=${capture.path}`);
    }
    return 0;
  }
  const capture = captures.find((candidate) => candidate.path === cmd.capture || candidate.path.endsWith(`/${cmd.capture}`));
  if (!capture) {
    console.error(`no assistant message in ${cmd.capture}`);
    return 1;
  }
  const provider = findBuiltInProviderDescriptor(capture.provider);
  if (!provider?.selfHostShape) {
    console.error(`no assistant message in ${cmd.capture}`);
    return 1;
  }
  const file = await sessionFile(worktree, capture);
  if (!file) {
    console.error(`no assistant message in ${cmd.capture}`);
    return 1;
  }
  const message = provider.selfHostShape.transcripts.extractFinalAssistantMessage((await readFile(file, 'utf8')).split('\n'));
  if (message === undefined) {
    console.error(`no assistant message in ${cmd.capture}`);
    return 1;
  }
  console.log(sanitizedMessage(message));
  return 0;
}
