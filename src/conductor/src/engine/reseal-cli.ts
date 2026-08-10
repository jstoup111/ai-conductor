import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execa } from 'execa';
import {
  PROTECTED_ARTIFACT_SEAL_PATH,
  resealProtectedArtifactSeal,
  type ProtectedArtifactSeal,
  type ResealProtectedArtifactSealOptions,
} from './protected-artifact-seal.js';
import { AuditTrailWriter } from './audit-trail.js';
import { clearMarker } from './daemon-rekick.js';
import { HALT_CLASS_MARKER, HALT_MARKER, PROTECTED_ARTIFACT_HALT_CLASS } from './halt-marker.js';
import { ConductorEventEmitter } from '../ui/events.js';

export interface ResealDispatch {
  kind: 'reseal';
  slug: string;
  paths: string[];
  reason: string;
  clearHalt: boolean;
}

export function detectResealCommand(argv: string[]): ResealDispatch | null {
  if (argv[2] !== 'reseal') return null;

  let slug: string | undefined;
  let reason: string | undefined;
  const paths: string[] = [];
  let clearHalt = false;

  for (let index = 3; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--clear-halt') {
      if (clearHalt) return null;
      clearHalt = true;
      continue;
    }

    if (flag !== '--slug' && flag !== '--path' && flag !== '--reason') return null;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) return null;
    index += 1;

    if (flag === '--slug') {
      if (slug !== undefined) return null;
      slug = value;
    } else if (flag === '--reason') {
      if (reason !== undefined) return null;
      reason = value;
    } else {
      paths.push(value);
    }
  }

  if (!slug || !reason || !reason.trim() || paths.length === 0) return null;
  if (slug.includes('/') || slug.includes('\\') || slug === '.' || slug === '..') return null;

  return { kind: 'reseal', slug, paths, reason, clearHalt };
}

export interface ResealCommandDependencies {
  cwd?: string;
  isInteractive?: boolean;
  out?: (line: string) => void;
  err?: (line: string) => void;
  access?: (path: string) => Promise<void>;
  readFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
  resolveHead?: (projectRoot: string) => Promise<string>;
  reseal?: (options: ResealProtectedArtifactSealOptions) => Promise<ProtectedArtifactSeal>;
  clearHalt?: (worktreePath: string) => Promise<void>;
  events?: ConductorEventEmitter;
}

function refusalPath(condition: string): string | undefined {
  return condition.match(/(\.docs\/(?:plans|stories)\/[^\s\n]+)/)?.[1];
}

/** Reseal one feature worktree without entering the conductor pipeline. */
export async function dispatchResealCommand(
  command: ResealDispatch,
  deps: ResealCommandDependencies = {},
): Promise<number> {
  const cwd = deps.cwd ?? process.cwd();
  const out = deps.out ?? console.log;
  const err = deps.err ?? console.error;
  // Autonomous steps reach providers via DefaultStepRunner.runAutonomous
  // (step-runners.ts:1088). The built-in provider subprocesses do not inherit
  // an operator terminal there: Claude writes its prompt through `input`
  // (execution/claude-provider.ts:560-580), while Codex does the same
  // (execution/codex-provider.ts:225-234). A `conduct reseal` child of either
  // provider therefore observes process.stdin.isTTY === false and must stop
  // at this gate.
  const isInteractive = deps.isInteractive ?? process.stdin.isTTY === true;
  const ensureAccessible = deps.access ?? access;
  const readSeal = deps.readFile ?? readFile;
  const reseal = deps.reseal ?? resealProtectedArtifactSeal;
  const clearHalt = deps.clearHalt ?? clearMarker;
  const worktree = join(cwd, '.worktrees', command.slug);

  try {
    await ensureAccessible(worktree);
  } catch {
    err(`reseal: unknown feature worktree '${command.slug}'.`);
    return 1;
  }

  const events = deps.events ?? new ConductorEventEmitter();
  if (!deps.events) new AuditTrailWriter(worktree, { throwOnWriteFailure: true }).subscribe(events);
  const refuse = async (condition: string): Promise<void> => {
    const path = refusalPath(condition);
    await events.emitOrThrow({
      type: 'protected_artifact_reseal_refused',
      condition,
      ...(path ? { path } : {}),
    });
    err(`reseal: ${condition}.`);
  };

  if (!command.reason.trim()) {
    await refuse('missing rationale');
    return 1;
  }
  if (!isInteractive) {
    await refuse('requires an interactive terminal');
    return 1;
  }

  let haltClearStatus: string | undefined;

  let seal: ProtectedArtifactSeal;
  try {
    seal = JSON.parse(await readSeal(join(worktree, PROTECTED_ARTIFACT_SEAL_PATH), 'utf8')) as ProtectedArtifactSeal;
  } catch {
    await refuse(`protected artifact seal is missing for '${command.slug}'`);
    return 1;
  }

  const resolveHead = deps.resolveHead ?? (async (projectRoot: string): Promise<string> =>
    (await execa('git', ['rev-parse', 'HEAD'], { cwd: projectRoot })).stdout.trim());

  let resealed: ProtectedArtifactSeal;
  try {
    resealed = await reseal({
      projectRoot: worktree,
      seal,
      toCommit: await resolveHead(worktree),
      trigger: 'operator-reseal',
      paths: command.paths,
    });
  } catch (error) {
    await refuse(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const priorFingerprints = new Map(
    seal.protectedArtifacts.map(({ path, fingerprint }) => [path, fingerprint]),
  );
  const nextFingerprints = new Map(
    resealed.protectedArtifacts.map(({ path, fingerprint }) => [path, fingerprint]),
  );
  await events.emitOrThrow({
    type: 'protected_artifact_reseal',
    paths: command.paths.map((path) => ({
      path,
      priorFingerprint: priorFingerprints.get(path) ?? '',
      newFingerprint: nextFingerprints.get(path) ?? '',
    })),
    reason: command.reason,
    fromCommit: seal.baselineCommit,
    toCommit: resealed.baselineCommit,
  });

  if (command.clearHalt) {
    try {
      await ensureAccessible(join(worktree, HALT_MARKER));
    } catch {
      haltClearStatus = 'No halt to clear.';
    }

    if (!haltClearStatus) {
      const haltClass = await readSeal(join(worktree, HALT_CLASS_MARKER), 'utf8').catch(() => null);
      const classification = haltClass?.trim();
      if (!classification) {
        haltClearStatus = 'Halt was not cleared: it is unclassified.';
      } else if (classification !== PROTECTED_ARTIFACT_HALT_CLASS) {
        haltClearStatus = `Halt was not cleared: its class is ${classification}.`;
      } else {
        try {
          await clearHalt(worktree);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          haltClearStatus = `Halt was not fully cleared: ${message}.`;
        }
      }
    }
  }

  out(`Resealed protected artifacts: ${command.paths.join(', ')}`);
  if (haltClearStatus) out(haltClearStatus);
  return 0;
}
