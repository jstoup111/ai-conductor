/**
 * Dispatcher-owned maintenance scheduling policies.
 *
 * Policies that may safely run beside executors live here, rather than
 * scattering pool-state predicates through the dispatcher loop. Refreshes
 * only move the root checkout; dispatched work is pinned to its own order.
 */
export type DaemonMaintenanceOperation =
  | 'refresh'
  | 'rekick'
  | 'restart-pending'
  | 'stale-engine'
  | 'sweep'
  | 'episode-end-sweep';

/** A dispatcher-only restart request that must wait for current work to finish. */
export type DaemonDrainReason = 'restart-pending' | 'stale-engine';

/** Snapshot of the active claims held when the dispatcher stopped claiming. */
export interface DaemonDrainState {
  readonly reason: DaemonDrainReason;
  readonly slugs: readonly string[];
}

type MaintenancePolicy = 'drained' | 'busy-allowed';

const maintenancePolicies: Record<DaemonMaintenanceOperation, MaintenancePolicy> = {
  refresh: 'busy-allowed',
  rekick: 'busy-allowed',
  'restart-pending': 'drained',
  'stale-engine': 'drained',
  sweep: 'busy-allowed',
  'episode-end-sweep': 'drained',
};

/** Schedules shared dispatcher maintenance without exposing executor state. */
export class DaemonMaintenance {
  private wasEpisodeActive = false;
  private lastRefreshAt: number | null = null;
  private drainState: DaemonDrainState | undefined;

  constructor(
    private readonly activeWorkCount: () => number,
    private readonly isEpisodeActive: () => boolean = () => false,
    private readonly refreshIntervalMs = 0,
    private readonly now: () => number = Date.now,
    private readonly activeWorkSlugs: () => readonly string[] = () => [],
    private readonly effectivePoolWidth = 1,
  ) {}

  /** Busy-pool maintenance is a concurrent-only policy; N=1 keeps serial flow. */
  busyMaintenanceEnabled(): boolean {
    return this.effectivePoolWidth > 1;
  }

  isDrained(): boolean {
    return this.activeWorkCount() === 0;
  }

  /**
   * Stops the dispatcher from making further claims until the current workers
   * have reached the drained boundary. The first request wins for this process;
   * it is the action that will own the single restart at that boundary.
   */
  beginDrain(reason: DaemonDrainReason): DaemonDrainState {
    if (!this.drainState) {
      this.drainState = { reason, slugs: [...this.activeWorkSlugs()] };
    }
    return this.drainState;
  }

  isDraining(): boolean {
    return this.drainState !== undefined;
  }

  drain(): DaemonDrainState | undefined {
    return this.drainState;
  }

  async startup(rekick: () => Promise<void>, sweep: () => Promise<void>): Promise<void> {
    await this.run('rekick', rekick);
    await this.run('sweep', sweep);
  }

  async refreshAndRekick<T>(
    refresh: () => Promise<T>,
    rekick: () => Promise<void>,
  ): Promise<T | undefined> {
    if (!this.refreshDue()) return undefined;
    const refreshed = await this.run('refresh', refresh);
    if (refreshed === undefined) return undefined;
    this.lastRefreshAt = this.now();
    await this.run('rekick', rekick);
    return refreshed;
  }

  /** Runs the timer-driven sweep while executors occupy every pool slot. */
  async afterBusyPoll(sweep: () => Promise<void>): Promise<void> {
    await this.run('sweep', sweep);
  }

  /** Runs a completion-triggered sweep through the same policy gate as every other sweep. */
  async afterTerminalCollection(sweep: () => Promise<void>): Promise<void> {
    await this.run('sweep', sweep);
  }

  async idleBoundary<T extends string>(
    restartPending: (episodeActive: boolean) => Promise<T | null>,
    staleEngine: (episodeActive: boolean) => Promise<T | null>,
  ): Promise<T | null | undefined> {
    const episodeActive = this.isEpisodeActive();
    this.wasEpisodeActive = episodeActive;

    const restart = await this.run('restart-pending', () => restartPending(episodeActive));
    if (restart) return restart;
    return this.run('stale-engine', () => staleEngine(episodeActive));
  }

  async afterIdlePoll(
    sweep: () => Promise<void>,
    episodeEndSweep: () => Promise<void>,
  ): Promise<void> {
    await this.run('sweep', sweep);
    const episodeActive = this.isEpisodeActive();
    if (this.wasEpisodeActive && !episodeActive) {
      await this.run('episode-end-sweep', episodeEndSweep);
    }
    this.wasEpisodeActive = episodeActive;
  }

  async run<T>(
    operation: DaemonMaintenanceOperation,
    work: () => Promise<T>,
  ): Promise<T | undefined> {
    if (!this.permits(operation)) return undefined;
    return work();
  }

  private permits(operation: DaemonMaintenanceOperation): boolean {
    switch (maintenancePolicies[operation]) {
      case 'drained':
        return this.isDrained();
      case 'busy-allowed':
        return this.busyMaintenanceEnabled() || this.isDrained();
    }
  }

  private refreshDue(): boolean {
    if (this.lastRefreshAt === null) return true;
    return this.now() - this.lastRefreshAt >= this.refreshIntervalMs;
  }
}
