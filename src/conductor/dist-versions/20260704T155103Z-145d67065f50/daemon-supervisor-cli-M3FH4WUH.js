import {
  readRegistry,
  resolveRegistryPath,
  writeRestartPending
} from "./chunk-JLFYSJF3.js";
import {
  makeTmuxSupervisor
} from "./chunk-YJ24CVIN.js";
import {
  clearStaleLockForRestart,
  ensureInstallFresh,
  isPaused,
  removePauseMarker,
  writePauseMarker
} from "./chunk-UAQEYZKC.js";

// src/engine/daemon-fleet.ts
async function runFleetAction(selection, action, deps = {}) {
  const out = deps.out ?? ((l) => console.log(l));
  const registryPath = deps.registryPath ?? resolveRegistryPath();
  const records = await readRegistry(registryPath);
  let targets;
  const unknownNames = [];
  if (selection.all) {
    targets = records;
    if (targets.length === 0) {
      out("no registered repos");
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
      return { code: unknownNames.length > 0 ? 1 : 0, outcomes: [], unknownNames };
    }
  }
  const outcomes = [];
  let anyFailed = false;
  for (const record of targets) {
    try {
      const message = await action(record);
      outcomes.push({ name: record.name, path: record.path, ok: true, message });
      out(`${record.name}: ${message}`);
    } catch (err) {
      anyFailed = true;
      const message = err.message;
      outcomes.push({ name: record.name, path: record.path, ok: false, message });
      out(`${record.name}: error: ${message}`);
    }
  }
  const code = anyFailed || unknownNames.length > 0 ? 1 : 0;
  return { code, outcomes, unknownNames };
}

// src/engine/daemon-supervisor-cli.ts
async function dispatchDaemonSupervisor(cmd, deps = {}) {
  const supervisor = deps.supervisor ?? makeTmuxSupervisor();
  const cwd = deps.cwd ?? process.cwd();
  const out = deps.out ?? ((l) => console.log(l));
  const ensureFresh = deps.ensureFresh ?? (() => ensureInstallFresh({ log: out }));
  const isInteractive = deps.isInteractive ?? Boolean(process.stdin.isTTY);
  const isBusy = deps.isBusy ?? (async () => ({ busy: false }));
  if ((cmd.verb === "pause" || cmd.verb === "resume") && (cmd.all || cmd.names)) {
    const selection = cmd.all ? { all: true } : { names: cmd.names ?? [] };
    const action = async (record) => {
      if (cmd.verb === "pause") {
        if (await isPaused(record.path)) return "already paused";
        await writePauseMarker(record.path);
        return "daemon paused";
      }
      if (!await isPaused(record.path)) return "not paused";
      await removePauseMarker(record.path);
      return "daemon resumed";
    };
    const { code } = await runFleetAction(selection, action, {
      registryPath: deps.registryPath,
      out
    });
    return code;
  }
  try {
    switch (cmd.verb) {
      case "start":
        await ensureFresh();
        await supervisor.start(cwd);
        if (cmd.detach) {
          out("daemon started (detached). Attach with 'conduct daemon connect'.");
        } else if (!isInteractive) {
          out(
            "daemon started (no interactive terminal to attach to). Attach with 'conduct daemon connect'."
          );
        } else {
          await supervisor.attach(cwd, { readOnly: true });
        }
        break;
      case "stop":
        await supervisor.stop(cwd);
        break;
      case "restart": {
        const paused = await isPaused(cwd);
        const busyCheck = paused ? { busy: false } : await isBusy(cwd);
        if (busyCheck.busy) {
          await writeRestartPending(cwd, { blockingSlug: busyCheck.blockingSlug });
          out(
            `restart queued: daemon is busy on ${busyCheck.blockingSlug ?? "(unknown feature)"}; it will restart automatically once idle.`
          );
          break;
        }
        await clearStaleLockForRestart(cwd);
        const outcome = await supervisor.restart(cwd);
        out(outcome.message);
        break;
      }
      case "connect":
        await supervisor.attach(cwd, { readOnly: true });
        break;
      case "debug":
        await supervisor.attach(cwd, { readOnly: false });
        break;
      case "pause":
        if (await isPaused(cwd)) {
          out("already paused");
        } else {
          await writePauseMarker(cwd);
          out("daemon paused");
        }
        break;
      case "resume":
        if (!await isPaused(cwd)) {
          out("not paused");
        } else {
          await removePauseMarker(cwd);
          out("daemon resumed");
        }
        break;
    }
    return 0;
  } catch (err) {
    out(err.message);
    return 1;
  }
}
export {
  dispatchDaemonSupervisor
};
//# sourceMappingURL=daemon-supervisor-cli-M3FH4WUH.js.map