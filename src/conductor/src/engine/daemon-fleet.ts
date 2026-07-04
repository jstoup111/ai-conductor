// daemon-fleet.ts — fleet-wide selector + iterator shared by every daemon
// management verb that can target more than one repo (pause/resume here,
// restart in T32).
//
// A "fleet action" resolves a selection (a named subset, or --all) against
// the project registry, then runs an injected per-repo `action` against each
// resolved record, reporting ONE outcome line per repo. It never aggregates
// failures into a thrown error — every repo gets its own independent outcome
// so a bad apple (missing path, permission error, …) never blocks its
// siblings (FR-3/FR-17/FR-18).
//
// Selection rules:
//  - `names`: only registry records whose `name` matches are targeted. A
//    requested name absent from the registry is reported verbatim as
//    "unknown repo: <name>" and excluded from execution — but any OTHER
//    requested name that IS registered is still acted on. If every requested
//    name is unknown, the action is invoked for NO repo (zero side effects)
//    and the overall result is non-zero.
//  - `all`: every registered repo. An empty registry is not a failure — it
//    reports "no registered repos" and exits 0.
//  - A per-repo `action` that throws is caught and reported as a per-repo
//    error line; it does not stop remaining repos from running. Any failure
//    (an unknown name or a thrown action) makes the overall code non-zero,
//    so callers can distinguish a fully clean run from a partial/total one.

import { readRegistry, resolveRegistryPath, type ProjectRecord } from './registry.js';

/** One repo's outcome from a fleet action. */
export interface FleetOutcome {
  name: string;
  path: string;
  ok: boolean;
  message: string;
}

/** A fleet target selection: a named subset, or every registered repo. */
export interface FleetSelection {
  /** Named subset (registry `name` field) to target. Ignored when `all` is set. */
  names?: string[];
  /** Target every registered repo. Takes priority over `names` when both are set. */
  all?: boolean;
}

export interface FleetActionDeps {
  /** Override registry path (tests). Defaults to resolveRegistryPath(). */
  registryPath?: string;
  /** Output sink (tests capture lines; default: console.log). One line per repo. */
  out?: (line: string) => void;
}

export interface FleetRunResult {
  /** 0 when every targeted repo succeeded (or there was nothing to do); 1 otherwise. */
  code: number;
  outcomes: FleetOutcome[];
  /** Requested names that had no matching registry record. */
  unknownNames: string[];
}

/**
 * Resolve `selection` against the project registry, then invoke `action` for
 * each resolved record, reporting one outcome line per repo via `out`. Shared
 * by pause/resume (Task 16/17) and restart (Task 32) fleet-wide dispatch.
 */
export async function runFleetAction(
  selection: FleetSelection,
  action: (record: ProjectRecord) => Promise<string>,
  deps: FleetActionDeps = {},
): Promise<FleetRunResult> {
  const out = deps.out ?? ((l: string) => console.log(l));
  const registryPath = deps.registryPath ?? resolveRegistryPath();
  const records = await readRegistry(registryPath);

  let targets: ProjectRecord[];
  const unknownNames: string[] = [];

  if (selection.all) {
    targets = records;
    if (targets.length === 0) {
      out('no registered repos');
      return { code: 0, outcomes: [], unknownNames: [] };
    }
  } else {
    const requested = selection.names ?? [];
    targets = [];
    for (const name of requested) {
      const record = records.find((r) => r.name === name);
      if (record) {
        targets.push(record);
      } else {
        unknownNames.push(name);
      }
    }
    for (const name of unknownNames) {
      out(`unknown repo: ${name}`);
    }
    if (targets.length === 0) {
      // Every requested name was unknown (or none were requested at all) —
      // zero side effects: `action` is never invoked.
      return { code: unknownNames.length > 0 ? 1 : 0, outcomes: [], unknownNames };
    }
  }

  const outcomes: FleetOutcome[] = [];
  let anyFailed = false;
  for (const record of targets) {
    try {
      const message = await action(record);
      outcomes.push({ name: record.name, path: record.path, ok: true, message });
      out(`${record.name}: ${message}`);
    } catch (err) {
      anyFailed = true;
      const message = (err as Error).message;
      outcomes.push({ name: record.name, path: record.path, ok: false, message });
      out(`${record.name}: error: ${message}`);
    }
  }

  const code = anyFailed || unknownNames.length > 0 ? 1 : 0;
  return { code, outcomes, unknownNames };
}
