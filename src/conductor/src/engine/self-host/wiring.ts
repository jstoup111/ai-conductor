// self-host/wiring.ts — the injectable bundle the daemon loop activates for a
// harness self-build (Phase 6).
//
// The six guardrail PRIMITIVES already exist and are unit-tested in isolation.
// This module is the single seam the Conductor calls them through, so the live
// wiring is:
//   - activated as ONE unit behind a single `isSelfHost` decision, and
//   - hermetically testable — the conductor integration tests inject a spy
//     bundle instead of running the real relink / sandbox / gates.
// It adds NO new behavior; every member forwards to an existing primitive.

import {
  relinkSkillsForSelfBuild,
  resolveHarnessRoot,
  resolveInstalledHarnessRoot,
  type InstalledRootResolution,
  type RelinkPreflightOptions,
} from '../install-freshness.js';
import {
  provisionSandboxBuildEnv,
  type SandboxBuildEnv,
  type ProvisionOptions,
} from './sandbox-build-env.js';
import { runVersionApprovalGate, type VersionGateOptions } from './version-gate.js';
import { runReleaseArtifactGate, type ReleaseGateOptions } from './release-gate.js';
import type { GateVerdict } from './gate-halt.js';

/**
 * The guardrail collaborators the Conductor invokes for a self-build. Bundled
 * behind one interface so the whole set is injected (real in production, spies
 * in tests) as a unit — the guardrails activate or not TOGETHER.
 */
export interface SelfHostGuardrails {
  /** Locate the installed harness root (dir with bin/install), or null. */
  resolveHarnessRoot(): Promise<string | null>;
  /**
   * Resolve the INSTALLED main-checkout root — never a worktree (#363). Used
   * only where the root authorizes operator-global writes (sandbox
   * harnessRoot); detection keeps using `resolveHarnessRoot` above.
   */
  resolveInstalledHarnessRoot(): Promise<InstalledRootResolution>;
  /** Relink harness skills before a self-build dispatch (TR-4). */
  relink(opts?: RelinkPreflightOptions): Promise<void>;
  /** Provision the throwaway CLAUDE_CONFIG_DIR sandbox (TR-5/6). */
  provisionSandbox(opts: ProvisionOptions): Promise<SandboxBuildEnv>;
  /** VERSION-approval finish gate (TR-7). */
  versionGate(opts: VersionGateOptions): Promise<GateVerdict>;
  /** Release-artifact finish gate: integrity/CHANGELOG/migration (TR-8/9/10). */
  releaseGate(opts: ReleaseGateOptions): Promise<GateVerdict>;
}

/** The production bundle: every member forwards to its real primitive. */
export const defaultSelfHostGuardrails: SelfHostGuardrails = {
  resolveHarnessRoot,
  resolveInstalledHarnessRoot,
  relink: relinkSkillsForSelfBuild,
  provisionSandbox: provisionSandboxBuildEnv,
  versionGate: runVersionApprovalGate,
  releaseGate: runReleaseArtifactGate,
};
