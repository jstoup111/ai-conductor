import { spawn, type IOType, type StdioOptions } from 'node:child_process';
import { isAbsolute } from 'node:path';
import type { Stream } from 'node:stream';

import { classifyGhObservation } from './gh-observation-classifier.js';
import { SessionEventProducer, type SessionEventProducerContext } from './session-event-producer.js';

/** The already-resolved process result. It is intentionally not a remote-state claim. */
export interface GhObserverTerminalResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | undefined;
}

export type GhObserverStream = IOType | Stream | number | null | undefined;
export interface GhObserverStreams {
  readonly stdin: GhObserverStream;
  readonly stdout: GhObserverStream;
  readonly stderr: GhObserverStream;
}

export type GhObserverTransport = (
  executable: string,
  argv: readonly string[],
  streams: GhObserverStreams,
) => Promise<GhObserverTerminalResult>;

export interface ObservedGhInvocation {
  /** This is resolved before the wrapper directory enters PATH. */
  readonly realExecutable: string;
  readonly argv: readonly string[];
  readonly stdin: GhObserverStream;
  readonly stdout: GhObserverStream;
  readonly stderr: GhObserverStream;
  /** Provisioning owns this object; callers cannot choose an arbitrary ledger. */
  readonly producer: SessionEventProducer;
  readonly transport: GhObserverTransport;
  /** Bounded local diagnostic only; no transport error or argv is exposed. */
  readonly diagnostic?: (message: string) => void;
}

/**
 * Observe a raw managed-session `gh` call without changing it.  This module is
 * deliberately not an authorization boundary: it forwards every invocation
 * once, whether or not telemetry is available.
 */
export async function runObservedGh(invocation: ObservedGhInvocation): Promise<GhObserverTerminalResult> {
  if (!isAbsolute(invocation.realExecutable)) {
    throw new Error('gh observer requires a provisioned resolved executable');
  }

  const classification = classifyGhObservation(invocation.argv);
  const operation = boundedOperation(invocation.argv);
  let attempt: ReturnType<SessionEventProducer['bypassAttempt']> | undefined;

  if (classification.kind === 'mutation') {
    attempt = invocation.producer.bypassAttempt({ operation });
    await appendObserved(invocation, attempt);
  } else if (classification.kind === 'possible-bypass') {
    await appendObserved(invocation, invocation.producer.possibleBypass({ operation }));
  }

  try {
    const terminal = await invocation.transport(invocation.realExecutable, invocation.argv, streamsOf(invocation));
    if (attempt !== undefined) {
      await appendObserved(invocation, invocation.producer.bypassResult(attempt, {
        outcome: terminal.exitCode === 0 ? 'cli-succeeded' : 'cli-failed',
      }));
    }
    return terminal;
  } catch (error) {
    if (attempt !== undefined) {
      await appendObserved(invocation, invocation.producer.bypassResult(attempt, { outcome: 'unknown' }));
    }
    throw error;
  }
}

function streamsOf(invocation: ObservedGhInvocation): GhObserverStreams {
  return { stdin: invocation.stdin, stdout: invocation.stdout, stderr: invocation.stderr };
}

async function appendObserved(invocation: ObservedGhInvocation, event: Parameters<SessionEventProducer['append']>[0]): Promise<void> {
  try {
    await invocation.producer.append(event);
  } catch {
    invocation.diagnostic?.('gh observation telemetry degraded');
  }
}

function boundedOperation(argv: readonly string[]): string {
  const family = argv.find((token) => !token.startsWith('-'));
  if (family === undefined || !/^[a-z][a-z0-9-]{0,31}$/.test(family)) return 'unknown';
  const familyIndex = argv.indexOf(family);
  const action = argv.slice(familyIndex + 1).find((token) => !token.startsWith('-'));
  if (action === undefined || !/^[a-z][a-z0-9-]{0,31}$/.test(action)) return family;
  return `${family}-${action}`.slice(0, 63);
}

/** Native process adapter kept injectable so tests never call a real gh binary. */
export const runRealGhTransport: GhObserverTransport = (executable, argv, streams) => new Promise((resolve, reject) => {
  const stdio: StdioOptions = [streams.stdin ?? 'inherit', streams.stdout ?? 'inherit', streams.stderr ?? 'inherit'];
  const child = spawn(executable, argv, { stdio });
  child.once('error', reject);
  child.once('close', (exitCode, signal) => resolve({ exitCode, signal: signal ?? undefined }));
});

/**
 * Entry point used by the packaged wrapper asset. Context values are supplied
 * only by managed-session preparation; absence is an explicit setup failure.
 */
export async function runGhObserverFromEnvironment(environment: NodeJS.ProcessEnv = process.env): Promise<GhObserverTerminalResult> {
  const realExecutable = environment.CONDUCT_GH_REAL_EXECUTABLE;
  const producerRoot = environment.CONDUCT_SESSION_EVENT_ROOT;
  const dispatchId = environment.CONDUCT_SESSION_DISPATCH_ID;
  const provider = environment.CONDUCT_SESSION_PROVIDER;
  const featureSlug = environment.CONDUCT_SESSION_FEATURE_SLUG;
  if (!realExecutable || !producerRoot || !dispatchId || !provider || !featureSlug) {
    throw new Error('gh observer requires provisioned managed-session context');
  }
  const context: SessionEventProducerContext = {
    projectRoot: environment.CONDUCT_SESSION_PROJECT_ROOT ?? '',
    worktreeRoot: environment.CONDUCT_SESSION_WORKTREE_ROOT ?? '',
    producerRoot, dispatchId, provider, scope: featureSlug === 'project' ? { kind: 'project' } : { kind: 'feature', featureSlug },
  };
  return runObservedGh({
    realExecutable,
    argv: process.argv.slice(2),
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    producer: new SessionEventProducer(context),
    transport: runRealGhTransport,
    diagnostic: (message) => process.stderr.write(`${message}\n`),
  });
}
