/**
 * Dispatcher-owned maintenance scheduling policies.
 *
 * At the serial default every operation retains the daemon loop's former
 * `inFlight.size === 0` gate. Later concurrency work changes individual
 * policies here instead of scattering new pool-state predicates through the
 * dispatcher loop.
 */
export type DaemonMaintenanceOperation =
  | 'refresh'
  | 'rekick'
  | 'restart-pending'
  | 'stale-engine'
  | 'sweep'
  | 'episode-end-sweep';

type MaintenancePolicy = 'drained';

const serialPolicies: Record<DaemonMaintenanceOperation, MaintenancePolicy> = {
  refresh: 'drained',
  rekick: 'drained',
  'restart-pending': 'drained',
  'stale-engine': 'drained',
  sweep: 'drained',
  'episode-end-sweep': 'drained',
};

/** Schedules shared dispatcher maintenance without exposing executor state. */
export class DaemonMaintenance {
  private wasEpisodeActive = false;

  constructor(
    private readonly activeWorkCount: () => number,
    private readonly isEpisodeActive: () => boolean = () => false,
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
    const refreshed = await this.run('refresh', refresh);
    if (refreshed === undefined) return undefined;
    await this.run('rekick', rekick);
    return refreshed;
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
    switch (serialPolicies[operation]) {
      case 'drained':
        return this.isDrained();
    }
  }
}
