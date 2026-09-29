import type { ConductorEvent } from '../types/events.js';
import type { OwnerResolution } from './owner-gate/identity.js';
import type { RegistryReader } from './registry.js';
import type { GhRunner } from './tracker-client.js';
import type { TrackerSelectionResult } from './tracker-selection.js';
import type { Ledger } from './engineer/intake/ledger.js';
import type { IntakePort } from './engineer/intake/port.js';
import type { IntakeSource } from './engineer/intake/source.js';
import { parseWorkRef } from './engineer/source-ref.js';

export interface IntakeRepoRegistry {
  list(): Promise<Array<{ name: string; path: string; ghRepo?: string }>>;
}

export type IntakeBackend = IntakeSource & IntakePort;

/** The portion of the canonical event spine used by intake backends. */
export interface IntakeEventEmitter {
  emit(event: Extract<ConductorEvent, {
    type: 'github_operation_refused' | 'github_write_credential_fallback' | 'tracker_backend_unavailable';
  }>): Promise<void>;
}

/**
 * The GitHub adapter's dependency contract, deliberately owned by the
 * composition port rather than imported from the concrete GitHub adapter.
 */
export interface GithubIntakeBackendDeps {
  gh: GhRunner;
  registry: IntakeRepoRegistry;
  ledger: Ledger;
  log?: (message: string) => void;
  missingRegistrationEpisodes?: Set<string>;
  resolveActor?: () => Promise<OwnerResolution>;
  events?: IntakeEventEmitter;
}

export type IntakeBackendFactory = (deps: GithubIntakeBackendDeps) => IntakeBackend;

function parseGhRepo(remote: string): string | null {
  const match = remote.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  return match ? match[1] : null;
}

/**
 * Selects backend-owned registry records lazily, then constructs the selected
 * backend exactly once. This module knows factory contracts, never adapters.
 */
export function createIntakeBackendComposite(deps: {
  backendFactories: { github: IntakeBackendFactory };
  resolveTrackerSelection: (projectPath: string) => Promise<TrackerSelectionResult>;
  registry: RegistryReader;
  ledger: Ledger;
  gh: GhRunner;
  log: (message: string) => void;
  missingRegistrationEpisodes?: Set<string>;
  resolveActor?: () => Promise<OwnerResolution>;
  events?: IntakeEventEmitter;
}): IntakeBackend {
  const excludedProjects = new Set<string>();

  const registry: IntakeRepoRegistry = {
    async list() {
      const projects = await deps.registry.listProjects();
      const selected = await Promise.all(projects.map(async (project) => ({
        project,
        selection: await deps.resolveTrackerSelection(project.path),
      })));
      for (const { project, selection } of selected) {
        if (!selection.ok) {
          if (!excludedProjects.has(project.path)) {
            excludedProjects.add(project.path);
            await deps.events?.emit({
              type: 'tracker_backend_unavailable',
              project: project.name,
              backend: 'github',
              reason: 'invalid-config',
            });
          }
          continue;
        }
        if (selection.selection.backend === 'github') {
          excludedProjects.delete(project.path);
          continue;
        }
        if (!excludedProjects.has(project.path)) {
          excludedProjects.add(project.path);
          await deps.events?.emit({
            type: 'tracker_backend_unavailable',
            project: project.name,
            backend: selection.selection.backend,
            reason: 'no-adapter',
          });
        }
      }
      return selected
        .filter(({ selection }) => selection.ok && selection.selection.backend === 'github')
        .map(({ project }) => ({
          name: project.remote ? parseGhRepo(project.remote) ?? project.name : project.name,
          ghRepo: project.remote ? parseGhRepo(project.remote) ?? undefined : undefined,
          path: project.path,
        }));
    },
  };

  const github = deps.backendFactories.github({
    gh: deps.gh,
    registry,
    ledger: deps.ledger,
    log: deps.log,
    missingRegistrationEpisodes: deps.missingRegistrationEpisodes,
    resolveActor: deps.resolveActor,
    events: deps.events,
  });

  return {
    poll: () => github.poll(),
    async report(sourceRef, status, meta) {
      const workRef = parseWorkRef(sourceRef);
      if (workRef?.kind !== 'github') return github.report(sourceRef, status, meta);

      const projects = await deps.registry.listProjects();
      const owner = projects.find((project) =>
        (project.remote ? parseGhRepo(project.remote) ?? project.name : project.name) === workRef.repo,
      );
      if (!owner) return github.report(sourceRef, status, meta);

      const selection = await deps.resolveTrackerSelection(owner.path);
      if (selection.ok && selection.selection.backend === 'github') {
        return github.report(sourceRef, status, meta);
      }

      return github.report(sourceRef, status, meta);
    },
  };
}
