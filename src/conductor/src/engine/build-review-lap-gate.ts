import {
  captureBuildReviewInputDigest,
  diffBuildReviewInputDigests,
  type BuildReviewInputDigest,
  type BuildReviewInputDigestRoots,
} from './build-review-input-integrity.js';

/** One protected root set and the digest it had when it became a lap input. */
export interface BuildReviewLapInputRecord {
  readonly roots: BuildReviewInputDigestRoots;
  readonly before: BuildReviewInputDigest;
}

/** The whole-lap integrity settlement, written as build-review evidence. */
export interface BuildReviewLapInputSettlement {
  readonly records: ReadonlyArray<BuildReviewLapInputRecord & {
    readonly after: BuildReviewInputDigest;
    readonly changedInputs: readonly string[];
  }>;
  readonly changedInputs: readonly string[];
}

type CacheWriteOutcome = { readonly ok: true } | { readonly ok: false; readonly error: unknown };

/**
 * adr-2026-09-10-portable-build-review-policy D5.3 / D6: the lap-level
 * boundary of a custom-policy build_review lap.
 *
 * Every member resolves and captures its policy inside its own prepared
 * candidate (D6) and registers the captured bytes here. No reviewer is
 * invoked until every expected member has either registered and arrived or
 * finished without reaching a reviewer, so every protected baseline exists
 * before any reviewer can write. Reviewer invocations then share one
 * `maxParallel` bound; waiting members never hold a reviewer slot, so a
 * bound smaller than the membership cannot deadlock the barrier.
 *
 * Verdict-cache writes are withheld until the whole-lap digest settles: a
 * mutated lap leaves no reusable verdict behind.
 */
export class BuildReviewLapGate {
  private readonly pending = new Set<string>();
  private readonly records: BuildReviewLapInputRecord[] = [];
  private readonly registeredPolicies = new Set<string>();
  private readonly deferredCacheWrites: Array<{ readonly member: string; readonly write: () => Promise<CacheWriteOutcome> }> = [];
  private readonly slotWaiters: Array<() => void> = [];
  private readonly baseline: Promise<void>;
  private openBaseline!: () => void;
  private opened = false;
  private activeReviewers = 0;

  get hasOpened(): boolean { return this.opened; }

  private constructor(
    private readonly maxParallel: number,
    members: readonly string[],
  ) {
    this.baseline = new Promise<void>((resolve) => { this.openBaseline = resolve; });
    for (const member of members) this.pending.add(member);
    if (this.pending.size === 0) this.open();
  }

  /** Captures the frozen trees and pre-existing evidence before any member starts. */
  static async begin(input: {
    readonly roots: BuildReviewInputDigestRoots;
    readonly maxParallel: number;
    readonly members: readonly string[];
  }): Promise<BuildReviewLapGate> {
    const before = await captureBuildReviewInputDigest(input.roots);
    const gate = new BuildReviewLapGate(Math.max(1, input.maxParallel), input.members);
    gate.records.push({ roots: input.roots, before });
    return gate;
  }

  /** Adds members discovered after the lap started (built-in dispatch plan). */
  expect(members: readonly string[]): void {
    if (this.opened) return;
    for (const member of members) this.pending.add(member);
  }

  /** Idempotent: a member that will not (or no longer) reach a reviewer. */
  arrive(member: string): void {
    if (!this.pending.delete(member)) return;
    if (this.pending.size === 0) this.open();
  }

  /**
   * Records a candidate's captured policy bytes and installed package as lap inputs.
   *
   * A fallback candidate or model rung that follows a failed attempt captures
   * its policy into fresh material after the barrier has opened. Its baseline
   * is still taken before that candidate's own reviewer starts, and the engine
   * created the material moments earlier, so it joins the settlement rather
   * than aborting the lap.
   */
  async registerPolicy(materialPath: string, packageRoot: string): Promise<void> {
    const key = `${materialPath}\u0000${packageRoot}`;
    if (this.registeredPolicies.has(key)) return;
    const roots: BuildReviewInputDigestRoots = {
      frozenHead: [],
      frozenBaseline: [],
      capturedPolicyMaterial: materialPath,
      installedPolicyPackage: packageRoot,
      evidenceRoot: [],
    };
    this.records.push({ roots, before: await captureBuildReviewInputDigest(roots) });
    this.registeredPolicies.add(key);
  }

  /** Arrives and waits until every member's baseline exists. */
  async waitForBaseline(member: string): Promise<void> {
    this.arrive(member);
    await this.baseline;
  }

  /** Runs one reviewer invocation under the lap's shared parallelism bound. */
  async withReviewerSlot<T>(run: () => Promise<T>): Promise<T> {
    while (this.activeReviewers >= this.maxParallel) {
      await new Promise<void>((resolve) => { this.slotWaiters.push(resolve); });
    }
    this.activeReviewers += 1;
    try {
      return await run();
    } finally {
      this.activeReviewers -= 1;
      this.slotWaiters.shift()?.();
    }
  }

  /** Withholds a verdict-cache write until the lap's digest has settled unchanged. */
  deferCacheWrite(member: string, write: () => Promise<CacheWriteOutcome>): void {
    this.deferredCacheWrites.push({ member, write });
  }

  /** Discards every withheld cache write (mutated or abandoned lap). */
  discardCacheWrites(): void {
    this.deferredCacheWrites.splice(0);
  }

  /** Persists withheld cache writes; returns each member whose write failed. */
  async flushCacheWrites(): Promise<ReadonlyMap<string, unknown>> {
    const failures = new Map<string, unknown>();
    for (const { member, write } of this.deferredCacheWrites.splice(0)) {
      let outcome: CacheWriteOutcome;
      try {
        outcome = await write();
      } catch (error) {
        outcome = { ok: false, error };
      }
      if (!outcome.ok && !failures.has(member)) failures.set(member, outcome.error);
    }
    return failures;
  }

  /** Re-digests every registered input and lists what changed during the lap. */
  async settle(): Promise<BuildReviewLapInputSettlement> {
    const records = await Promise.all(this.records.map(async ({ roots, before }) => {
      const after = await captureBuildReviewInputDigest(roots);
      return { roots, before, after, changedInputs: await diffBuildReviewInputDigests(before, after) };
    }));
    return {
      records,
      changedInputs: [...new Set(records.flatMap((record) => record.changedInputs))].sort(),
    };
  }

  private open(): void {
    if (this.opened) return;
    this.opened = true;
    this.openBaseline();
  }
}
