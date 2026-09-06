import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { assertRealExecAllowed } from './tracker-client.js';

const execFile = promisify(execFileCb);

export const GH_VERSION_FLOOR = { major: 2, minor: 73, patch: 0 } as const;
export const GH_VERSION_PROBE_TIMEOUT_MS = 5_000;

export interface GhVersion {
  major: number;
  minor: number;
  patch: number;
  /** A prerelease is deliberately lower than its corresponding release. */
  prerelease?: string;
}

export type GhVersionFloorVerdict =
  | { kind: 'ok'; version: GhVersion }
  | { kind: 'below-floor'; version: GhVersion }
  | { kind: 'unparseable' }
  | { kind: 'absent' }
  | { kind: 'timeout' };

export type GhVersionRunner = () => Promise<{ stdout: string; exitCode?: number }>;

/** Parses only `gh --version`'s banner line; subsequent release URL text is irrelevant. */
export function parseGhVersion(output: string): GhVersion | null {
  const firstLine = output.split(/\r?\n/, 1)[0] ?? '';
  const match = /^gh version (\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?(?:\s|$)/.exec(firstLine);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    ...(match[4] ? { prerelease: match[4] } : {}),
  };
}

function compareVersions(left: GhVersion, right: GhVersion): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  if (left.prerelease && !right.prerelease) return -1;
  if (!left.prerelease && right.prerelease) return 1;
  return 0;
}

export function checkGhVersionFloor(output: string): GhVersionFloorVerdict {
  const version = parseGhVersion(output);
  if (!version) return { kind: 'unparseable' };
  return compareVersions(version, GH_VERSION_FLOOR) >= 0
    ? { kind: 'ok', version }
    : { kind: 'below-floor', version };
}

const productionRunner: GhVersionRunner = async () => {
  assertRealExecAllowed('gh');
  const result = await execFile('gh', ['--version']);
  return { stdout: String(result.stdout) };
};

/** Obtains and classifies the machine's gh version without treating failures as a pass. */
export async function probeGhVersion(
  runner: GhVersionRunner = productionRunner,
  timeoutMs = GH_VERSION_PROBE_TIMEOUT_MS,
): Promise<GhVersionFloorVerdict> {
  const timed = new Promise<GhVersionFloorVerdict>((resolve) => {
    setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
  });
  const attempted: Promise<GhVersionFloorVerdict> = runner().then(
    ({ stdout, exitCode }): GhVersionFloorVerdict =>
      exitCode && exitCode !== 0 ? { kind: 'unparseable' } : checkGhVersionFloor(stdout),
    (error: unknown): GhVersionFloorVerdict => {
      const code = (error as { code?: unknown })?.code;
      return code === 'ENOENT' ? { kind: 'absent' } : { kind: 'unparseable' };
    },
  );
  return Promise.race([attempted, timed]);
}
