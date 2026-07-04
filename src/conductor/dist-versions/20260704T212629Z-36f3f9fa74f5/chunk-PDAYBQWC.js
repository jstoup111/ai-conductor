// src/engine/daemon-tmux.ts
import { spawnSync } from "child_process";
import { createHash, randomBytes } from "crypto";
import { unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, join, resolve } from "path";
var SESSION_PREFIX = "cc-daemon-";
var DAEMON_FOREGROUND_COMMAND = "conduct-ts daemon --continuous";
var TmuxNotInstalledError = class extends Error {
  constructor() {
    super("tmux is not installed or not found on PATH. Please install tmux to use daemon hosting.");
    this.name = "TmuxNotInstalledError";
  }
};
var defaultTmuxRunner = (args, opts) => {
  const result = spawnSync("tmux", args, {
    stdio: opts.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    encoding: "utf-8"
  });
  if (result.error) {
    const err = result.error;
    if (err.code === "ENOENT") {
      throw new TmuxNotInstalledError();
    }
    throw result.error;
  }
  return { code: result.status ?? 1, stdout: result.stdout ?? "" };
};
function sessionNameForRepo(repoPath) {
  const abs = resolve(repoPath);
  const slug = basename(abs).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const hash = createHash("sha1").update(abs).digest("hex").slice(0, 6);
  return `${SESSION_PREFIX}${slug}-${hash}`;
}
async function hasSession(name, run = defaultTmuxRunner) {
  return run(["has-session", "-t", `=${name}`], { inherit: false }).code === 0;
}
async function newDetachedSession(name, command, cwd, run = defaultTmuxRunner) {
  const result = run(
    ["new-session", "-d", "-s", name, "-c", cwd, command],
    { inherit: false }
  );
  if (result.code !== 0) {
    throw new Error(`tmux new-session exited with code ${result.code} for session "${name}"`);
  }
}
async function killSession(name, run = defaultTmuxRunner) {
  run(["kill-session", "-t", `=${name}`], { inherit: false });
}
async function attachSession(name, opts = {}, run = defaultTmuxRunner) {
  const args = ["attach-session", "-t", `=${name}`];
  if (opts.readOnly) {
    args.push("-r");
  }
  run(args, { inherit: true });
}
async function capturePane(name, run = defaultTmuxRunner) {
  const result = run(["capture-pane", "-p", "-t", `=${name}:`], { inherit: false });
  return result.code === 0 ? result.stdout : "";
}
async function sendKeys(name, command, run = defaultTmuxRunner) {
  run(["send-keys", "-t", `=${name}:`, command, "Enter"], { inherit: false });
}
async function isPaneDead(name, run = defaultTmuxRunner) {
  const result = run(
    ["list-panes", "-t", `=${name}:`, "-F", "#{pane_dead}"],
    { inherit: false }
  );
  return result.code === 0 && result.stdout.trim() === "1";
}
async function setRemainOnExit(name, run = defaultTmuxRunner) {
  run(["set-option", "-t", `=${name}`, "remain-on-exit", "on"], { inherit: false });
}
async function respawnPane(name, run = defaultTmuxRunner, cmd = DAEMON_FOREGROUND_COMMAND) {
  let wrappedCmd = cmd;
  let scrollbackPreserved = false;
  let scrollbackFile;
  try {
    const capture = run(["capture-pane", "-S", "-", "-p", "-t", `=${name}:`], { inherit: false });
    if (capture.code === 0 && capture.stdout.length > 0) {
      scrollbackFile = join(
        tmpdir(),
        `cc-daemon-scrollback-${name}-${randomBytes(6).toString("hex")}.txt`
      );
      writeFileSync(scrollbackFile, capture.stdout, "utf-8");
      wrappedCmd = `cat ${scrollbackFile}; rm -f ${scrollbackFile}; exec ${cmd}`;
      scrollbackPreserved = true;
    }
  } catch {
    scrollbackPreserved = false;
    wrappedCmd = cmd;
    if (scrollbackFile) {
      try {
        unlinkSync(scrollbackFile);
      } catch {
      }
    }
  }
  const result = run(["respawn-pane", "-k", "-t", `=${name}:`, wrappedCmd], { inherit: false });
  if (result.code !== 0) {
    if (scrollbackFile) {
      try {
        unlinkSync(scrollbackFile);
      } catch {
      }
    }
    throw new Error(`tmux respawn-pane exited with code ${result.code} for session "${name}"`);
  }
  return { scrollbackPreserved };
}
async function tmuxInstalled(run = defaultTmuxRunner) {
  try {
    return run(["-V"], { inherit: false }).code === 0;
  } catch (err) {
    if (err instanceof TmuxNotInstalledError) {
      return false;
    }
    throw err;
  }
}
async function requireTmux(run = defaultTmuxRunner) {
  if (!await tmuxInstalled(run)) {
    throw new TmuxNotInstalledError();
  }
}
function makeTmuxSupervisor(run = defaultTmuxRunner) {
  return {
    async isUp(repo) {
      try {
        const name = sessionNameForRepo(repo);
        if (!await hasSession(name, run)) {
          return false;
        }
        return !await isPaneDead(name, run);
      } catch {
        return false;
      }
    },
    async hasSession(repo) {
      await requireTmux(run);
      const name = sessionNameForRepo(repo);
      return hasSession(name, run);
    },
    async start(repo) {
      await requireTmux(run);
      const name = sessionNameForRepo(repo);
      if (await hasSession(name, run)) {
        if (await isPaneDead(name, run)) {
          await setRemainOnExit(name, run);
          await respawnPane(name, run);
        }
        return;
      }
      await newDetachedSession(name, DAEMON_FOREGROUND_COMMAND, repo, run);
    },
    async stop(repo) {
      await requireTmux(run);
      const name = sessionNameForRepo(repo);
      await killSession(name, run);
    },
    async restart(repo) {
      await requireTmux(run);
      const name = sessionNameForRepo(repo);
      await setRemainOnExit(name, run);
      try {
        const { scrollbackPreserved } = await respawnPane(name, run);
        return {
          degraded: false,
          message: scrollbackPreserved ? "daemon restarted in place (session preserved, scrollback preserved)." : "daemon restarted in place (session preserved); scrollback unavailable (history capture failed, prior pane output was not carried forward)."
        };
      } catch (err) {
        await killSession(name, run);
        await newDetachedSession(name, DAEMON_FOREGROUND_COMMAND, repo, run);
        const reason = err instanceof Error ? err.message : String(err);
        return {
          degraded: true,
          message: `daemon restarted via fallback (kill-session + new-session): session continuity (scrollback/history) was lost because in-place respawn failed: ${reason}`
        };
      }
    },
    async attach(repo, opts = {}) {
      await requireTmux(run);
      const name = sessionNameForRepo(repo);
      if (!await hasSession(name, run)) {
        throw new Error(
          `No daemon session found for "${repo}". Run 'conduct-ts daemon start' first.`
        );
      }
      await attachSession(name, opts, run);
    },
    async logs(repo) {
      await requireTmux(run);
      const name = sessionNameForRepo(repo);
      return capturePane(name, run);
    },
    async exec(repo, cmd) {
      await requireTmux(run);
      const name = sessionNameForRepo(repo);
      await sendKeys(name, cmd, run);
    }
  };
}

export {
  sessionNameForRepo,
  hasSession,
  isPaneDead,
  respawnPane,
  makeTmuxSupervisor
};
//# sourceMappingURL=chunk-PDAYBQWC.js.map