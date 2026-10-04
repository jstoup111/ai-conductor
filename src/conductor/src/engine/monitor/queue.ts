import {
  enumerateRegisteredProjectHalts,
  type ProjectHalt,
  type RegisteredHaltInventoryResult,
  type RegisteredHaltInventorySelection,
} from './halt-inventory.js';

/** Identifies the queue item currently owned by an open guided session. */
export interface OpenQueueItem {
  project: string;
  feature: string;
}

/** Selection and transient session state for one membership pass. */
export interface QueueMembershipOptions extends RegisteredHaltInventorySelection {
  openItem?: OpenQueueItem;
}

/** Inventory seam for deriving one monitor pass. */
export interface QueueMembershipDeps {
  enumerateRegisteredProjectHalts?: (
    selection: RegisteredHaltInventorySelection,
  ) => Promise<RegisteredHaltInventoryResult>;
}

function isOpenItem(halt: ProjectHalt, openItem: OpenQueueItem | undefined): boolean {
  return openItem !== undefined &&
    halt.project === openItem.project &&
    halt.slug === openItem.feature;
}

/**
 * Derive the current monitor queue from the halt inventory.
 *
 * Membership is intentionally local to this call: halt markers remain the
 * authority between passes, while a currently open session is excluded only
 * for the pass that names it.
 */
export async function deriveQueueMembership(
  options: QueueMembershipOptions = {},
  deps: QueueMembershipDeps = {},
): Promise<RegisteredHaltInventoryResult> {
  const enumerate = deps.enumerateRegisteredProjectHalts ?? enumerateRegisteredProjectHalts;
  const { code, halts, terminal } = await enumerate({ projectName: options.projectName });
  const seenFeaturesByProject = new Map<string, Set<string>>();
  const queue = halts.filter((halt) => {
    const seenFeatures = seenFeaturesByProject.get(halt.project) ?? new Set<string>();
    if (seenFeatures.has(halt.slug) || isOpenItem(halt, options.openItem)) return false;
    seenFeatures.add(halt.slug);
    seenFeaturesByProject.set(halt.project, seenFeatures);
    return true;
  });

  return terminal === true ? { code, halts: queue, terminal } : { code, halts: queue };
}
