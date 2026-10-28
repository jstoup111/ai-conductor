import type { ShippedReadinessVerdict } from './shipped-readiness.js';

/**
 * Persistent state associated with a watched pull request.  This deliberately
 * lives beside the queue rather than in the sweep: dispatcher-only consumers
 * must not pull the sweep (and its daemon orchestration dependencies) into
 * their import graph merely to type a queued repair.
 */
export interface WatchEntry {
  prUrl: string;
  slug: string;
  repoCwd: string;
  resolveAttempts?: number;
  lastResolveAt?: string;
  ciFixAttempts?: number;
  lastCiFixAt?: string;
  ciFailureDetected?: boolean;
  headSha?: string;
  headFirstSeenAt?: string;
  readinessEmitted?: { verdict: ShippedReadinessVerdict; headSha: string };
  escalationCause?: 'conflict-resolution' | 'shipped-readiness';
  labelClearAttempts?: number;
}

/** Outcomes emitted only by the autoresolve adapter. */
export type AutoresolveOutcome =
  | { kind: 'refreshed' }
  | { kind: 'escalated' }
  | { kind: 'setup-stop' }
  | { kind: 'published-stack' };

/** Outcomes emitted only by the CI-fix adapter. */
export type CiFixRepairOutcome =
  | { kind: 'not-started'; provider?: string; reason?: unknown }
  | { kind: 'noop'; provider?: string }
  | { kind: 'failed'; stage: 'provider' | 'guard' | 'verification' | 'publication' | 'worktree'; provider?: string; reason?: unknown }
  | { kind: 'published'; provider?: string }
  | { kind: 'branch-gone' }
  | { kind: 'needs-human'; providerSetupExhaustion: unknown };

export type AutoresolveRepairAdapter = (entry: WatchEntry) => Promise<AutoresolveOutcome>;
export type CiFixRepairAdapter = (entry: WatchEntry) => Promise<CiFixRepairOutcome>;

interface RepairRequestBase {
  prUrl: string;
  slug?: string;
  prCreatedAt: string;
  queuedAt: string;
}

/** A bounded dispatcher-owned handoff between maintenance sweeps and workers. */
export type AutoresolveRepairRequest = RepairRequestBase & {
  kind: 'autoresolve';
  /** The only adapter permitted to execute this request after it is claimed. */
  run: AutoresolveRepairAdapter;
};

export type CiFixRepairRequest = RepairRequestBase & {
  kind: 'ci-fix';
  /** The only adapter permitted to execute this request after it is claimed. */
  run: CiFixRepairAdapter;
};

export type RepairRequest = AutoresolveRepairRequest | CiFixRepairRequest;

/** A claimed repair and the outcome emitted by its matching adapter. */
export type RepairCompletion =
  | { request: AutoresolveRepairRequest; outcome: AutoresolveOutcome }
  | { request: CiFixRepairRequest; outcome: CiFixRepairOutcome };

/**
 * In-memory repair requests. A PR has at most one outstanding request, even
 * when a sweep observes both a conflict and failing checks for it.
 */
export class RepairQueue {
  private readonly requests = new Map<string, RepairRequest>();

  enqueue(request: RepairRequest): boolean {
    if (this.requests.has(request.prUrl)) return false;
    this.requests.set(request.prUrl, request);
    return true;
  }

  list(): RepairRequest[] {
    return [...this.requests.values()];
  }

  /** Remove this exact request after the dispatcher has selected it. */
  takeByUrl(prUrl: string): RepairRequest | undefined {
    const request = this.requests.get(prUrl);
    if (request) this.requests.delete(prUrl);
    return request;
  }
}
