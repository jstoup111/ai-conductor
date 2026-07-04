// daemon-park-cli.ts — filesystem-direct, pre-boot CLI verbs for the
// operator-park marker: `conduct daemon park <slug>` and
// `conduct daemon unpark <slug>`.
//
// Both verbs act directly on `.daemon/parked/<slug>` via park-marker.ts —
// they never start the daemon/supervisor. This mirrors
// daemon-observe-cli.ts's detect/dispatch pattern (hand-rolled argv parsing,
// no heavy imports in the detector) so index.ts can decide whether to
// dispatch before the pipeline boots.

import { writeOperatorPark, removeOperatorPark } from './park-marker.js';

export type DaemonParkDispatch =
  | { kind: 'park'; slug: string }
  | { kind: 'unpark'; slug: string };

/**
 * Detect a `conduct daemon park <slug>` / `conduct daemon unpark <slug>`
 * command. Returns null for anything else — including a bare `daemon park`
 * with no slug, which is not actionable. `argv` is `process.argv`
 * (`[node, entry, 'daemon', 'park'|'unpark', slug, ...]`).
 */
export function detectDaemonParkCommand(argv: string[]): DaemonParkDispatch | null {
  const args = argv.slice(2);
  if (args[0] !== 'daemon') return null;
  const sub = args[1];
  if (sub !== 'park' && sub !== 'unpark') return null;
  const slug = args[2];
  if (!slug) return null;
  return { kind: sub, slug };
}

export interface DaemonParkDeps {
  /** Project/repo root the marker is written under (tests inject a tmp dir). */
  cwd?: string;
  /** Output sink (tests capture lines; default: console.log). */
  out?: (line: string) => void;
}

/**
 * Execute a `park`/`unpark` verb against the park-marker primitives.
 *
 * Never throws: any error (e.g. the root is unwritable) is caught, reported
 * via `out`, and surfaced as a non-zero exit code so the caller can
 * `process.exit(code)` without a thrown escape — mirroring
 * dispatchDaemonSupervisor's error handling.
 */
export async function dispatchDaemonPark(
  cmd: DaemonParkDispatch,
  deps: DaemonParkDeps = {},
): Promise<number> {
  const cwd = deps.cwd ?? process.cwd();
  const out = deps.out ?? ((l: string) => console.log(l));

  try {
    if (cmd.kind === 'park') {
      await writeOperatorPark(cwd, cmd.slug);
      out(
        `Parked '${cmd.slug}' — it will not be dispatched or re-kicked until unparked.`,
      );
    } else {
      await removeOperatorPark(cwd, cmd.slug);
      out(`Unparked '${cmd.slug}' — normal dispatch and re-kick resume.`);
    }
    return 0;
  } catch (err) {
    out(`Could not ${cmd.kind} '${cmd.slug}': ${(err as Error).message}`);
    return 1;
  }
}
