import {
  makeTmuxSupervisor
} from "./chunk-YJ24CVIN.js";

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
//# sourceMappingURL=daemon-launch-3KJTCVOX.js.map