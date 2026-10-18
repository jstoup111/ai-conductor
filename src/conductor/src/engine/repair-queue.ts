import type { PooledRepairAdapter } from './mergeable-sweep.js';

/** A bounded dispatcher-owned handoff between maintenance sweeps and workers. */
export interface RepairRequest {
  kind: 'ci-fix' | 'autoresolve';
  prUrl: string;
  slug?: string;
  prCreatedAt: string;
  queuedAt: string;
  /** The only adapter permitted to execute this request after it is claimed. */
  run: PooledRepairAdapter;
}

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

  has(prUrl: string): boolean {
    return this.requests.has(prUrl);
  }

  list(): RepairRequest[] {
    return [...this.requests.values()];
  }

  take(): RepairRequest | undefined {
    const first = this.requests.entries().next().value as [string, RepairRequest] | undefined;
    if (!first) return undefined;
    this.requests.delete(first[0]);
    return first[1];
  }

  /** Remove this exact request after the dispatcher has selected it. */
  takeByUrl(prUrl: string): RepairRequest | undefined {
    const request = this.requests.get(prUrl);
    if (request) this.requests.delete(prUrl);
    return request;
  }
}
