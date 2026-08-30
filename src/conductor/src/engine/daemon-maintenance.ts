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

  constructor(
    private readonly activeWorkCount: () => number,
    private readonly isEpisodeActive: () => boolean = () => false,
    private readonly refreshIntervalMs = 0,
    private readonly now: () => number = Date.now,
  ) {}

  isDrained(): boolean {
    return this.activeWorkCount() === 0;
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
        return true;
    }
  }

  private refreshDue(): boolean {
    if (this.lastRefreshAt === null) return true;
    return this.now() - this.lastRefreshAt >= this.refreshIntervalMs;
  }
}
