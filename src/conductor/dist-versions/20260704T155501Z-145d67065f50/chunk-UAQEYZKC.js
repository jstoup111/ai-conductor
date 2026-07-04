// src/engine/install-freshness.ts
import { execa } from "execa";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { access, constants } from "fs/promises";
import { createInterface } from "readline";
var __dirname = dirname(fileURLToPath(import.meta.url));
async function resolveHarnessRoot() {
  for (const rel of ["../../../", "../../../../"]) {
    const root = join(__dirname, rel);
    if (await access(join(root, "bin", "install")).then(() => true, () => false)) {
      return root;
    }
  }
  return null;
}
var realInstallRunner = async (args, harnessRoot) => {
  const r = await execa(join(harnessRoot, "bin", "install"), args, {
    cwd: harnessRoot,
    reject: false,
    stdout: "inherit",
    stderr: "inherit"
  });
  return typeof r.exitCode === "number" ? r.exitCode : 1;
};
var InstallStaleError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "InstallStaleError";
  }
};
var DRIFT_MESSAGE = "Harness install is stale \u2014 one or more skills are missing or out of date in ~/.claude/skills/. Daemon-dispatched skills (e.g. /rebase) will fail silently until `bin/install --update` is run.";
async function ensureInstallFresh(opts = {}) {
  const log = opts.log ?? ((m) => console.error(m));
  const harnessRoot = opts.harnessRoot !== void 0 ? opts.harnessRoot : await resolveHarnessRoot();
  if (!harnessRoot) {
    log("install-freshness: could not locate the harness root; skipping the staleness check.");
    return;
  }
  const runner = opts.runner ?? realInstallRunner;
  const checkCode = await runner(["--check"], harnessRoot);
  if (checkCode === 0) return;
  log(DRIFT_MESSAGE);
  const interactive = opts.interactive ?? Boolean(process.stdin.isTTY);
  if (!interactive) {
    throw new InstallStaleError(`${DRIFT_MESSAGE} Run \`bin/install --update\` and retry.`);
  }
  const prompt = opts.prompt ?? defaultPrompt;
  const yes = await prompt("Run `bin/install --update` now? [y/N] ");
  if (!yes) {
    throw new InstallStaleError(
      "Declined the harness install refresh \u2014 not starting on a stale install."
    );
  }
  const updateCode = await runner(["--update"], harnessRoot);
  if (updateCode !== 0) {
    throw new InstallStaleError(
      "`bin/install --update` failed \u2014 not starting on a stale install."
    );
  }
}
async function relinkSkillsForSelfBuild(opts = {}) {
  const log = opts.log ?? ((m) => console.error(m));
  const harnessRoot = opts.harnessRoot !== void 0 ? opts.harnessRoot : await resolveHarnessRoot();
  if (!harnessRoot) {
    log("skill-relink preflight: harness root unresolved; skipping the self-build relink.");
    return;
  }
  if (!opts.runner) await assertInstallerRunnable(harnessRoot);
  const runner = opts.runner ?? realInstallRunner;
  const code = await runner(["--update"], harnessRoot);
  if (code !== 0) {
    throw new InstallStaleError(
      `Skill relink failed for the harness self-build (\`bin/install --update\` exited ${code}). Not dispatching into a stale-symlink state \u2014 a newly added or renamed skill would HALT the build on "no parseable result".`
    );
  }
}
async function assertInstallerRunnable(harnessRoot) {
  const installer = join(harnessRoot, "bin", "install");
  try {
    await access(installer, constants.X_OK);
  } catch {
    throw new InstallStaleError(
      `Harness installer is missing or not executable: ${installer}. Cannot relink skills for the self-build.`
    );
  }
}
async function defaultPrompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await new Promise((resolve) => rl.question(question, resolve));
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

// src/engine/daemon-lock.ts
import { open, mkdir, unlink, readFile } from "fs/promises";
import { unlinkSync } from "fs";
import { join as join2, dirname as dirname2 } from "path";
import { fileURLToPath as fileURLToPath2 } from "url";
import { randomUUID } from "crypto";
var DAEMON_DIR = ".daemon";
var PIDFILE_NAME = "daemon.pid";
function pidfilePath(repoPath) {
  return join2(repoPath, DAEMON_DIR, PIDFILE_NAME);
}
function daemonDir(repoPath) {
  return join2(repoPath, DAEMON_DIR);
}
var defaultKill = (pid, signal) => {
  process.kill(pid, signal);
};
var OWN_ENGINE_DIR = dirname2(fileURLToPath2(import.meta.url));
async function writePidfileExcl(repoPath) {
  await mkdir(daemonDir(repoPath), { recursive: true });
  const record = {
    pid: process.pid,
    uuid: randomUUID(),
    startedAt: (/* @__PURE__ */ new Date()).toISOString(),
    engineDir: OWN_ENGINE_DIR
  };
  const fh = await open(pidfilePath(repoPath), "wx");
  try {
    await fh.writeFile(JSON.stringify(record), "utf8");
  } finally {
    await fh.close();
  }
  return record;
}
async function readPidRecord(repoPath) {
  let parsed;
  try {
    const raw = await readFile(pidfilePath(repoPath), "utf8");
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed?.pid !== "number" || !Number.isInteger(parsed.pid) || parsed.pid <= 0 || typeof parsed?.uuid !== "string") {
    return null;
  }
  return parsed;
}
function isLive(pid, kill = defaultKill) {
  try {
    kill(pid, 0);
    return true;
  } catch (err) {
    const code = err.code;
    if (code === "ESRCH") {
      return false;
    }
    return true;
  }
}
async function acquire(repoPath, kill = defaultKill) {
  try {
    const record = await writePidfileExcl(repoPath);
    return { acquired: true, ...record };
  } catch (err) {
    const code = err.code;
    if (code === "EEXIST") {
      const owner = await readPidRecord(repoPath);
      if (owner) {
        return { acquired: false, reason: "occupied", owner };
      }
      return {
        acquired: false,
        reason: "occupied",
        owner: { pid: -1, uuid: "", startedAt: "" }
      };
    }
    return { acquired: false, reason: "error", error: err };
  }
}
async function reclaim(repoPath, kill = defaultKill) {
  try {
    const existing = await readPidRecord(repoPath);
    if (existing && isLive(existing.pid, kill)) {
      return { reclaimed: false, acquired: false, reason: "alive", owner: existing };
    }
    try {
      await unlink(pidfilePath(repoPath));
    } catch {
    }
    try {
      const record = await writePidfileExcl(repoPath);
      return { reclaimed: true, acquired: true, ...record };
    } catch (innerErr) {
      const code = innerErr.code;
      if (code === "EEXIST") {
        const newOwner = await readPidRecord(repoPath);
        return {
          reclaimed: false,
          acquired: false,
          reason: "alive",
          owner: newOwner ?? { pid: -1, uuid: "", startedAt: "" }
        };
      }
      throw innerErr;
    }
  } catch (err) {
    return { reclaimed: false, acquired: false, reason: "error", error: err };
  }
}
function makeLockHandle(repoPath, pid, owned) {
  return {
    pid,
    owned,
    release: async () => {
      if (!owned) return;
      try {
        await unlink(pidfilePath(repoPath));
      } catch {
      }
    },
    releaseSync: () => {
      if (!owned) return;
      try {
        unlinkSync(pidfilePath(repoPath));
      } catch {
      }
    }
  };
}
async function holdLock(repoPath) {
  const result = await acquire(repoPath);
  if (result.acquired) {
    return makeLockHandle(repoPath, result.pid, true);
  }
  if (result.reason === "occupied") {
    const owner = result.owner;
    if (owner.pid > 0 && isLive(owner.pid)) {
      return null;
    }
    const r = await reclaim(repoPath, defaultKill);
    if (r.reclaimed) {
      return makeLockHandle(repoPath, r.pid, true);
    }
    if (r.reason === "alive") {
      return null;
    }
    return makeLockHandle(repoPath, process.pid, false);
  }
  return makeLockHandle(repoPath, process.pid, false);
}
async function clearStaleLockForRestart(repoPath, kill = defaultKill) {
  const owner = await readPidRecord(repoPath);
  if (!owner) {
    const result2 = await acquire(repoPath, kill);
    if (result2.acquired) {
      try {
        await unlink(pidfilePath(repoPath));
      } catch {
      }
    }
    return null;
  }
  if (owner.pid > 0 && isLive(owner.pid, kill)) {
    return owner.pid;
  }
  const result = await reclaim(repoPath, kill);
  if (result.reclaimed) {
    try {
      await unlink(pidfilePath(repoPath));
    } catch {
    }
  }
  return owner.pid > 0 ? owner.pid : null;
}
async function ensureRunning(repoPath, opts = {}) {
  void opts.registryDaemonState;
  const launchFn = opts.launch ?? (async (path) => {
    const { launchDaemon } = await import("./daemon-launch-3KJTCVOX.js");
    launchDaemon(path);
  });
  let needsSpawn = false;
  const acquireResult = await acquire(repoPath);
  if (acquireResult.acquired) {
    try {
      await unlink(pidfilePath(repoPath));
    } catch {
    }
    needsSpawn = true;
  } else if (acquireResult.reason === "occupied") {
    const owner = acquireResult.owner;
    if (owner.pid > 0 && isLive(owner.pid, defaultKill)) {
      return;
    }
    const reclaimResult = await reclaim(repoPath, defaultKill);
    if (reclaimResult.reclaimed) {
      opts.onReclaim?.();
      try {
        await unlink(pidfilePath(repoPath));
      } catch {
      }
      needsSpawn = true;
    } else if (reclaimResult.reason === "alive") {
      return;
    } else {
      needsSpawn = true;
    }
  } else {
    needsSpawn = true;
  }
  if (needsSpawn) {
    await Promise.resolve(launchFn(repoPath));
    if (opts.writeDaemonState) {
      try {
        await opts.writeDaemonState();
      } catch {
      }
    }
  }
}

// src/engine/pause-marker.ts
import { mkdir as mkdir2, readFile as readFile2, unlink as unlink2, writeFile as writeFile2 } from "fs/promises";
import { join as join3 } from "path";
var PAUSE_MARKER = ".daemon/PAUSED";
async function isPaused(projectRoot) {
  try {
    await readFile2(join3(projectRoot, PAUSE_MARKER), "utf-8");
    return true;
  } catch (err) {
    const code = err?.code;
    if (code === "ENOENT") {
      return false;
    }
    return true;
  }
}
async function readPauseMetadata(projectRoot) {
  try {
    const raw = await readFile2(join3(projectRoot, PAUSE_MARKER), "utf-8");
    return JSON.parse(raw);
  } catch {
    return void 0;
  }
}
async function writePauseMarker(projectRoot, meta = {}) {
  await mkdir2(join3(projectRoot, ".daemon"), { recursive: true });
  const payload = {
    pausedAt: (/* @__PURE__ */ new Date()).toISOString(),
    ...meta.pausedBy !== void 0 ? { pausedBy: meta.pausedBy } : {}
  };
  await writeFile2(join3(projectRoot, PAUSE_MARKER), JSON.stringify(payload), "utf-8");
}
async function removePauseMarker(projectRoot) {
  await unlink2(join3(projectRoot, PAUSE_MARKER)).catch((err) => {
    const code = err?.code;
    if (code !== "ENOENT") {
      throw err;
    }
  });
}

export {
  resolveHarnessRoot,
  ensureInstallFresh,
  relinkSkillsForSelfBuild,
  daemonDir,
  readPidRecord,
  isLive,
  holdLock,
  clearStaleLockForRestart,
  ensureRunning,
  isPaused,
  readPauseMetadata,
  writePauseMarker,
  removePauseMarker
};
//# sourceMappingURL=chunk-UAQEYZKC.js.map