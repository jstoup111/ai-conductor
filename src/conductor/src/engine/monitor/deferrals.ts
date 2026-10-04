import {
  copyFile as nodeCopyFile,
  mkdir as nodeMkdir,
  readFile as nodeReadFile,
  rename as nodeRename,
  rm as nodeRm,
  writeFile as nodeWriteFile,
} from "node:fs/promises";
import { join } from "node:path";

import type { HaltMarkerSnapshot } from "../halt-marker.js";
import { resolveMainRepoRoot } from "../park-marker.js";

/** Identifies one monitor halt that an operator has deferred. */
export interface DeferralKey {
  project: string;
  feature: string;
  haltIdentity: HaltMarkerSnapshot;
}

/** Whether a stored deferral still identifies the currently halted work. */
export function isDeferred(deferrals: readonly DeferralKey[], current: DeferralKey): boolean {
  if (!current.haltIdentity.present) return false;

  return deferrals.some((deferred) =>
    deferred.project === current.project &&
    deferred.feature === current.feature &&
    deferred.haltIdentity.present &&
    deferred.haltIdentity.mtimeMs === current.haltIdentity.mtimeMs &&
    deferred.haltIdentity.size === current.haltIdentity.size,
  );
}

/** Filesystem and repository-root seams used by the deferral store. */
export interface DeferralDeps {
  resolveMainRoot?: (startCwd: string) => string | Promise<string>;
  mkdir?: (path: string, options: { recursive: true }) => Promise<unknown>;
  writeFile?: (
    path: string,
    contents: string,
    encoding: "utf-8",
  ) => Promise<unknown>;
  rename?: (from: string, to: string) => Promise<unknown>;
  readFile?: (path: string, encoding: "utf-8") => Promise<string>;
  rm?: (path: string, options: { force: true }) => Promise<unknown>;
  copyFile?: (from: string, to: string) => Promise<unknown>;
  report?: (message: string) => void;
}

const DEFERRALS_FILE = "deferrals.json";
const DEFERRALS_TEMP_FILE = "deferrals.json.tmp";

function resolveDeps(deps: DeferralDeps): Required<DeferralDeps> {
  return {
    resolveMainRoot: deps.resolveMainRoot ?? resolveMainRepoRoot,
    mkdir:
      deps.mkdir ??
      ((path, options) => nodeMkdir(path, options)),
    writeFile:
      deps.writeFile ??
      ((path, contents, encoding) => nodeWriteFile(path, contents, encoding)),
    rename: deps.rename ?? ((from, to) => nodeRename(from, to)),
    readFile:
      deps.readFile ??
      ((path, encoding) => nodeReadFile(path, encoding)),
    rm: deps.rm ?? ((path, options) => nodeRm(path, options)),
    copyFile: deps.copyFile ?? ((from, to) => nodeCopyFile(from, to)),
    report: deps.report ?? ((message) => console.error(message)),
  };
}

async function deferralsPath(
  startCwd: string,
  deps: Required<DeferralDeps>,
): Promise<{ directory: string; file: string; temporaryFile: string }> {
  const mainRoot = await deps.resolveMainRoot(startCwd);
  const directory = join(mainRoot, ".daemon");

  return {
    directory,
    file: join(directory, DEFERRALS_FILE),
    temporaryFile: join(directory, DEFERRALS_TEMP_FILE),
  };
}

async function readDeferralsAt(
  file: string,
  deps: Required<DeferralDeps>,
): Promise<DeferralKey[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await deps.readFile(file, "utf-8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
    throw new UnreadableDeferralRecordError(error);
  }
  if (!Array.isArray(parsed) || !parsed.every(isDeferralKey)) {
    throw new UnreadableDeferralRecordError(new Error("record is not a deferral array"));
  }
  return parsed;
}

class UnreadableDeferralRecordError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "UnreadableDeferralRecordError";
  }
}

function isDeferralKey(value: unknown): value is DeferralKey {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const key = value as Record<string, unknown>;
  const identity = key.haltIdentity;
  return typeof key.project === "string" &&
    typeof key.feature === "string" &&
    identity !== null &&
    typeof identity === "object" &&
    !Array.isArray(identity) &&
    typeof (identity as Record<string, unknown>).present === "boolean" &&
    typeof (identity as Record<string, unknown>).mtimeMs === "number" &&
    typeof (identity as Record<string, unknown>).size === "number";
}

function report(deps: Required<DeferralDeps>, message: string): void {
  try {
    deps.report(message);
  } catch {
    // Diagnostics must not turn a failed deferral record into a stalled monitor.
  }
}

async function recoverUnreadableDeferrals(
  paths: Awaited<ReturnType<typeof deferralsPath>>,
  error: unknown,
  deps: Required<DeferralDeps>,
): Promise<void> {
  let copyFailure: unknown;
  try {
    await deps.copyFile(paths.file, `${paths.file}.corrupt-${Date.now()}`);
  } catch (copyError) {
    copyFailure = copyError;
  }
  const detail = error instanceof Error ? error.message : String(error);
  const copyDetail = copyFailure === undefined
    ? "preserved by copy"
    : `copy failed: ${copyFailure instanceof Error ? copyFailure.message : String(copyFailure)}`;
  report(deps, `deferral record unreadable: ${paths.file}: ${detail}; ${copyDetail}`);
}

/** Persist a deferred halt key in the main repository's daemon state. */
export async function recordDeferral(
  startCwd: string,
  key: DeferralKey,
  deps: DeferralDeps = {},
): Promise<void> {
  const resolvedDeps = resolveDeps(deps);
  const paths = await deferralsPath(startCwd, resolvedDeps);
  const deferrals = await readDeferralsAt(paths.file, resolvedDeps).catch(
    (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [] as DeferralKey[];
      throw error;
    },
  );

  deferrals.push(key);
  await resolvedDeps.mkdir(paths.directory, { recursive: true });
  await resolvedDeps.writeFile(
    paths.temporaryFile,
    JSON.stringify(deferrals),
    "utf-8",
  );
  await resolvedDeps.rename(paths.temporaryFile, paths.file);
}

/** Record a deferral without allowing storage failure to stop the monitor. */
export async function recordDeferralSafely(
  startCwd: string,
  key: DeferralKey,
  deps: DeferralDeps = {},
): Promise<boolean> {
  const resolvedDeps = resolveDeps(deps);
  try {
    await recordDeferral(startCwd, key, resolvedDeps);
    return true;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    report(resolvedDeps, `deferral record unavailable: ${detail}`);
    return false;
  }
}

/** Read deferred halt keys from the main repository's daemon state. */
export async function readDeferrals(
  startCwd: string,
  deps: DeferralDeps = {},
): Promise<DeferralKey[]> {
  const resolvedDeps = resolveDeps(deps);
  const paths = await deferralsPath(startCwd, resolvedDeps);
  try {
    return await readDeferralsAt(paths.file, resolvedDeps);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    await recoverUnreadableDeferrals(paths, error, resolvedDeps);
    return [];
  }
}
