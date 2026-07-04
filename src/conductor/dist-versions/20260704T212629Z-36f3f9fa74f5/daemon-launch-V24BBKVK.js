import {
  makeTmuxSupervisor
} from "./chunk-PDAYBQWC.js";

// src/engine/engineer/daemon-launch.ts
var NO_AUTOLAUNCH_ENV = "AI_CONDUCTOR_NO_DAEMON_AUTOLAUNCH";
function launchDaemon(project, opts = {}) {
  if (!opts.supervisor && process.env[NO_AUTOLAUNCH_ENV] === "1") {
    return;
  }
  const supervisor = opts.supervisor ?? makeTmuxSupervisor();
  return supervisor.start(project);
}
export {
  NO_AUTOLAUNCH_ENV,
  launchDaemon
};
//# sourceMappingURL=daemon-launch-V24BBKVK.js.map