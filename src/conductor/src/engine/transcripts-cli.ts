import { access, readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { findBuiltInProviderDescriptor } from '../execution/provider-catalog.js';
import { resolveMainRepoRoot } from './park-marker.js';
import { sanitizeTranscriptLine } from './self-host/transcript-sanitize.js';
import { foldTranscriptLedger, transcriptOwnerStep } from './self-host/transcript-retention.js';

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

function isEvent(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

async function readRetainedCaptures(worktree: string): Promise<Capture[]> {
  let content: string;
  try {
    content = await readFile(join(worktree, '.pipeline', 'events.jsonl'), 'utf8');
  } catch {
    return [];
  }

  const result: Capture[] = [];
  for (const capture of foldTranscriptLedger(content).values()) {
    if (capture.state !== 'retained' || !isCapturePath(capture.path)) continue;
    try {
      await access(join(worktree, capture.path));
      result.push({
        path: capture.path, step: transcriptOwnerStep(capture.owner), attempt: capture.attempt,
        ...(capture.member === undefined ? {} : { member: capture.member }),
        provider: capture.provider, interrupted: capture.interrupted,
        timestamp: capture.capturedAt ?? capture.order,
      });
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
  const provider = findBuiltInProviderDescriptor(capture.provider);
  const selection = provider?.selfHostShape?.transcripts.sessionFile;
  if (!selection) return undefined;
  const candidates = await findFiles(join(captureRoot, selection.root), selection.root);
  const excluded: readonly string[] = 'excludedPathSegments' in selection ? selection.excludedPathSegments : [];
  const topLevel = candidates.filter((path) =>
    !relative(captureRoot, path).split(sep).some((segment) => excluded.includes(segment)),
  );
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
  // ai-conductor:session-command-context=operator-only
  if (cmd.kind === 'guide') {
    console.error('ai-conductor transcripts <slug> [--show <capture>]');
    return 1;
  }
  // /ai-conductor:session-command-context
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
  const matches = captures.filter((candidate) => candidate.path === cmd.capture || candidate.path.endsWith(`/${cmd.capture}`));
  if (matches.length === 0) {
    console.error(`no assistant message in ${cmd.capture}`);
    return 1;
  }
  if (matches.length > 1) {
    console.error(`ambiguous capture «${cmd.capture}»: ${matches.map((candidate) => candidate.path).join(', ')}`);
    return 1;
  }
  const [capture] = matches;
  if (!capture) throw new Error('capture match invariant violated');
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
