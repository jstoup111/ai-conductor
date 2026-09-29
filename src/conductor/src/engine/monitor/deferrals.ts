import {
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
  return JSON.parse(await deps.readFile(file, "utf-8")) as DeferralKey[];
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

/** Read deferred halt keys from the main repository's daemon state. */
export async function readDeferrals(
  startCwd: string,
  deps: DeferralDeps = {},
): Promise<DeferralKey[]> {
  const resolvedDeps = resolveDeps(deps);
  const { file } = await deferralsPath(startCwd, resolvedDeps);

  return readDeferralsAt(file, resolvedDeps);
}

/** Remove the main repository's deferred-halt record. */
export async function clearDeferrals(
  startCwd: string,
  deps: DeferralDeps = {},
): Promise<void> {
  const resolvedDeps = resolveDeps(deps);
  const { file } = await deferralsPath(startCwd, resolvedDeps);

  await resolvedDeps.rm(file, { force: true });
}
