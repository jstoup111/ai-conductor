import { spawn, type IOType, type StdioOptions } from 'node:child_process';
import { isAbsolute } from 'node:path';
import type { Stream } from 'node:stream';

import { classifyGhObservation } from './gh-observation-classifier.js';
import {
  prepareManagedSessionContext,
  type ManagedSessionContext,
  type ManagedSessionContextInput,
} from './managed-session-context.js';
import { SessionEventProducer, type SessionEventProducerContext } from './session-event-producer.js';

/**
 * Managed-session preparation sets this only after resolving the real binary
 * before the observer directory is prepended to PATH.
 */
export const GH_OBSERVER_REAL_EXECUTABLE_ENV = 'CONDUCT_GH_REAL_EXECUTABLE';

/**
 * The guarded GitHub-operation adapter must bypass the managed PATH observer:
 * its own authorization is already established per operation. Invalid or
 * absent context deliberately falls back to ordinary PATH resolution.
 */
export function resolvePrivateGhObserverPassthrough(environment: NodeJS.ProcessEnv = process.env): string {
  const executable = environment[GH_OBSERVER_REAL_EXECUTABLE_ENV];
  return executable !== undefined && isAbsolute(executable) ? executable : 'gh';
}

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
    // A transient producer failure is itself an occurrence. Make one bounded
    // best-effort diagnostic attempt; never let telemetry alter forwarding.
    try { await invocation.producer.append(invocation.producer.deliveryDiagnostic('write-failed')); } catch { /* diagnostic storage is degraded too */ }
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
export interface GhObserverEnvironmentDependencies {
  readonly argv?: readonly string[];
  readonly stdin?: GhObserverStream;
  readonly stdout?: GhObserverStream;
  readonly stderr?: GhObserverStream;
  readonly transport?: GhObserverTransport;
  readonly createProducer?: (context: SessionEventProducerContext) => SessionEventProducer;
  readonly diagnostic?: (message: string) => void;
}

export async function runGhObserverFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: GhObserverEnvironmentDependencies = {},
): Promise<GhObserverTerminalResult> {
  const realExecutable = environment[GH_OBSERVER_REAL_EXECUTABLE_ENV];
  const context = await validatedManagedContext(environment);
  if (!realExecutable || context === undefined) {
    throw new Error('gh observer requires provisioned managed-session context');
  }
  return runObservedGh({
    realExecutable,
    argv: dependencies.argv ?? process.argv.slice(2),
    stdin: dependencies.stdin ?? process.stdin,
    stdout: dependencies.stdout ?? process.stdout,
    stderr: dependencies.stderr ?? process.stderr,
    producer: (dependencies.createProducer ?? ((value) => new SessionEventProducer(value)))(context),
    transport: dependencies.transport ?? runRealGhTransport,
    diagnostic: dependencies.diagnostic ?? ((message) => process.stderr.write(`${message}\n`)),
  });
}

/** Do not reconstruct identity from individual environment fields. */
async function validatedManagedContext(environment: NodeJS.ProcessEnv): Promise<ManagedSessionContext | undefined> {
  const raw = environment.CONDUCT_MANAGED_SESSION_CONTEXT;
  if (typeof raw !== 'string') return undefined;
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const prepared = await prepareManagedSessionContext(candidate as ManagedSessionContextInput);
  return prepared.ok ? prepared.context : undefined;
}
