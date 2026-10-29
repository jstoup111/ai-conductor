import { access, readFile } from 'node:fs/promises';
import { writeSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { execa } from 'execa';
import {
  PROTECTED_ARTIFACT_SEAL_PATH,
  prepareProtectedArtifactReseal,
  ProtectedArtifactResealRefusal,
  resealProtectedArtifactSeal,
  type ProtectedArtifactSeal,
  type ResealProtectedArtifactSealOptions,
} from './protected-artifact-seal.js';
import { shellQuote } from './canonical-launcher.js';
import { AuditTrailWriter } from './audit-trail.js';
import { EventPersister } from './event-persister.js';
import { clearMarker } from './daemon-rekick.js';
import { HALT_CLASS_MARKER, HALT_MARKER, PROTECTED_ARTIFACT_HALT_CLASS } from './halt-marker.js';
import { makeGitRunner, originDefaultBranch } from './rebase.js';
import { ConductorEventEmitter } from './conductor-event-emitter.js';
import { resolveFeaturePlanPath } from './artifacts.js';
import { slicePositionsFromPlan, verifySlicePositions } from './slice-topology.js';

export interface ResealDispatch {
  kind: 'reseal';
  slug: string;
  paths: string[];
  reason: string;
  clearHalt: boolean;
}

/** Resolve the base branch consistently for reseal dispatch and dry-run hints. */
export async function resolveResealBaseBranch(worktree: string): Promise<string> {
  return (await originDefaultBranch(makeGitRunner(worktree))) ?? 'main';
}

function recoveryShellArgument(value: string): string {
  return /^[A-Za-z0-9._/-]+$/.test(value) ? value : shellQuote(value);
}

/**
 * Describes a reseal command only when reseal's own pre-write checks permit it.
 * This is deliberately dry-run only: it never emits events or updates the seal.
 */
export async function describeResealRecovery(
  worktreePath: string,
  namedPath: string | undefined,
): Promise<string | undefined> {
  if (!namedPath || basename(dirname(worktreePath)) !== '.worktrees') return undefined;

  try {
    const seal = JSON.parse(
      await readFile(join(worktreePath, PROTECTED_ARTIFACT_SEAL_PATH), 'utf8'),
    ) as ProtectedArtifactSeal;
    const sealedPaths = new Set(seal.protectedArtifacts.map(({ path }) => path));
    const paths = new Set([namedPath]);
    const slug = basename(worktreePath);
    const toCommit = (await execa('git', ['rev-parse', 'HEAD'], { cwd: worktreePath })).stdout.trim();
    const baseBranch = await resolveResealBaseBranch(worktreePath);

    while (true) {
      try {
        await prepareProtectedArtifactReseal({
          projectRoot: worktreePath,
          seal,
          toCommit,
          trigger: 'operator-reseal',
          paths: [...paths],
          featureDesc: slug,
          baseBranch,
        });
        const sortedPaths = [...paths].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
        // ai-conductor:session-command-context=operator-only
        return [
          `Approve this change as an operator amendment by running, from the repository root that contains .worktrees/${slug}, in an interactive terminal:`,
          `  ai-conductor reseal --slug ${recoveryShellArgument(slug)}${sortedPaths.map((path) => ` --path ${recoveryShellArgument(path)}`).join('')} --reason "«why»" --clear-halt`,
        ].join('\n');
        // /ai-conductor:session-command-context
      } catch (error) {
        if (!(error instanceof ProtectedArtifactResealRefusal) || !error.path || !sealedPaths.has(error.path) || paths.has(error.path)) {
          return undefined;
        }
        paths.add(error.path);
      }
    }
  } catch {
    return undefined;
  }
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

  // An explicitly supplied empty/whitespace rationale is syntactically a
  // reseal command. Preserve it so dispatch can refuse and audit it; omitted
  // and malformed --reason forms remain parser failures.
  if (!slug || reason === undefined || paths.length === 0) return null;
  if (slug.includes('/') || slug.includes('\\') || slug === '.' || slug === '..') return null;

  return { kind: 'reseal', slug, paths, reason, clearHalt };
}

/**
 * Detect only the one parseable reseal form whose mandatory rationale flag is
 * absent. The regular detector intentionally keeps returning null for every
 * malformed form; this lets the entry point audit that specific refusal
 * without turning parser errors into reseal attempts.
 */
export function detectMissingResealReasonCommand(argv: string[]): ResealDispatch | null {
  if (argv[2] !== 'reseal') return null;

  let slug: string | undefined;
  const paths: string[] = [];
  let clearHalt = false;

  for (let index = 3; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--clear-halt') {
      if (clearHalt) return null;
      clearHalt = true;
      continue;
    }
    if (flag === '--reason' || (flag !== '--slug' && flag !== '--path')) return null;

    const value = argv[index + 1];
    if (!value || value.startsWith('--')) return null;
    index += 1;

    if (flag === '--slug') {
      if (slug !== undefined) return null;
      slug = value;
    } else {
      paths.push(value);
    }
  }

  if (!slug || paths.length === 0) return null;
  if (slug.includes('/') || slug.includes('\\') || slug === '.' || slug === '..') return null;

  return { kind: 'reseal', slug, paths, reason: '', clearHalt };
}

export interface ResealCommandDependencies {
  cwd?: string;
  isInteractive?: boolean;
  out?: (line: string) => void;
  err?: (line: string) => void;
  access?: (path: string) => Promise<void>;
  readFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
  resolveHead?: (projectRoot: string) => Promise<string>;
  resolveBaseBranch?: (projectRoot: string) => Promise<string>;
  reseal?: (options: ResealProtectedArtifactSealOptions) => Promise<ProtectedArtifactSeal>;
  clearHalt?: (worktreePath: string) => Promise<void>;
  events?: ConductorEventEmitter;
}

function refusalPath(condition: string): string | undefined {
  return condition.match(/(\.docs\/(?:plans|stories)\/[^\s\n]+)/)?.[1];
}

function repositoryRelativePath(worktree: string, path: string): string {
  return relative(worktree, path).replaceAll('\\', '/');
}

/**
 * Child branches, closure refs, and their recorded positions are durable
 * stack state.  A reseal may change task membership within those positions,
 * but it must not change the topology under an already-created stack.
 */
async function positionChangeRefusal(
  worktree: string,
  slug: string,
  paths: readonly string[],
): Promise<string | undefined> {
  // Ownership validation in the reseal preparation path is responsible for
  // rendering malformed manifests as a normal reseal refusal. A malformed
  // manifest cannot identify a plan for this independent stack-topology
  // check, so leave it to that ownership boundary instead of throwing before
  // dispatch reaches it.
  const planPath = await resolveFeaturePlanPath(worktree, slug).catch(() => undefined);
  if (!planPath || !paths.includes(repositoryRelativePath(worktree, planPath))) return undefined;

  const planText = await readFile(planPath, 'utf8').catch(() => undefined);
  if (planText === undefined) return undefined;
  const positions = slicePositionsFromPlan(planText);
  const topology = await verifySlicePositions(
    worktree,
    slug,
    // An invalid manifest cannot establish proposed positions. Probe with an
    // empty proposal only to recover the sealed positions for a useful refusal;
    // never treat that placeholder as a valid unsliced plan.
    positions ?? [],
    makeGitRunner(worktree),
    repositoryRelativePath(worktree, planPath),
  );
  if (!topology) return undefined;
  if (positions === undefined) {
    return `cannot establish proposed sealed stack positions: recorded [${topology.recordedPositions?.join(',') ?? ''}]; cause plan-invalid`;
  }
  if (topology.cause !== 'positions-changed') {
    return `cannot verify sealed stack positions: recorded [${topology.recordedPositions?.join(',') ?? ''}], proposed [${topology.planPositions?.join(',') ?? ''}]; cause ${topology.cause}`;
  }
  return `cannot change sealed stack positions: recorded [${topology.recordedPositions?.join(',') ?? ''}] and proposed [${topology.planPositions?.join(',') ?? ''}]`;
}

/** Reseal one feature worktree without entering the conductor pipeline. */
export async function dispatchResealCommand(
  command: ResealDispatch,
  deps: ResealCommandDependencies = {},
): Promise<number> {
  const cwd = deps.cwd ?? process.cwd();
  const out = deps.out ?? console.log;
  // The command is commonly invoked as a short-lived child process with
  // stderr piped. Write synchronously so a refusal is observable before the
  // source entry point finishes and Node closes that pipe.
  const err = deps.err ?? ((line: string) => writeSync(process.stderr.fd, `${line}\n`));
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
  if (!deps.events) {
    new AuditTrailWriter(worktree, { throwOnWriteFailure: true }).subscribe(events);
    new EventPersister(join(worktree, '.pipeline', 'events.jsonl'), events).start();
  }
  const refuse = async (condition: string): Promise<void> => {
    const path = refusalPath(condition);
    await events.emitOrThrow({
      type: 'protected_artifact_reseal_refused',
      reason: command.reason,
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
  const resolveBaseBranch = deps.resolveBaseBranch ?? resolveResealBaseBranch;

  const positionRefusal = await positionChangeRefusal(worktree, command.slug, command.paths);
  if (positionRefusal) {
    await refuse(positionRefusal);
    return 1;
  }

  let resealed: ProtectedArtifactSeal;
  try {
    resealed = await reseal({
      projectRoot: worktree,
      seal,
      toCommit: await resolveHead(worktree),
      trigger: 'operator-reseal',
      paths: command.paths,
      reason: command.reason,
      featureDesc: command.slug,
      baseBranch: await resolveBaseBranch(worktree),
      onRebaseline: async (event) => {
        try {
          await events.emit(event);
        } catch {
          // Resealing has already persisted the durable seal; rendering is best-effort.
        }
      },
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
