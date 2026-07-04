import {
  daemonDir,
  relinkSkillsForSelfBuild,
  resolveHarnessRoot
} from "./chunk-UUHCLINK.js";

// src/types/plugin.ts
var VALID_PLUGIN_KINDS = [
  "llm_provider",
  "ui_renderer",
  "step",
  "hook",
  "visualizer",
  "memory_provider"
];
var PluginManifestError = class extends Error {
  constructor(message, filePath) {
    super(message);
    this.filePath = filePath;
    this.name = "PluginManifestError";
  }
  filePath;
};
var PluginVersionError = class extends Error {
  constructor(message, harnessVersion, requiredRange) {
    super(message);
    this.harnessVersion = harnessVersion;
    this.requiredRange = requiredRange;
    this.name = "PluginVersionError";
  }
  harnessVersion;
  requiredRange;
};
var PluginLoadError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "PluginLoadError";
  }
};
var PluginNotFoundError = class extends Error {
  constructor(message, kind, name) {
    super(message);
    this.kind = kind;
    this.name = name;
    this.name = "PluginNotFoundError";
  }
  kind;
  name;
};
var PluginRegistryError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "PluginRegistryError";
  }
};

// src/engine/state.ts
import { readFile, writeFile } from "fs/promises";
async function readState(path) {
  let raw;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") {
      return { ok: true, value: {} };
    }
    return {
      ok: false,
      error: { type: "io_error", message: `Failed to read state: ${err}` }
    };
  }
  if (!raw.trim()) {
    return {
      ok: false,
      error: { type: "corrupted", message: "State file is empty" }
    };
  }
  try {
    const parsed = JSON.parse(raw);
    return { ok: true, value: migrateState(parsed) };
  } catch {
    return {
      ok: false,
      error: { type: "corrupted", message: "Invalid JSON in state file" }
    };
  }
}
function migrateState(state) {
  const brainstorm = state["brainstorm"];
  if (!brainstorm) return state;
  const migrated = { ...state };
  const m = migrated;
  if (m["explore"] === void 0) m["explore"] = brainstorm;
  if (m["prd"] === void 0) m["prd"] = brainstorm;
  return migrated;
}
async function writeState(path, state) {
  await writeFile(path, JSON.stringify(state, null, 2) + "\n", "utf-8");
}
async function saveStepStatus(path, step, status) {
  const result = await readState(path);
  const state = result.ok ? result.value : {};
  state[step] = status;
  state.last_step = step;
  await writeState(path, state);
}
function getStepStatus(state, step) {
  return state[step] ?? "pending";
}
function stepSatisfied(state, step) {
  const status = getStepStatus(state, step);
  return status === "done" || status === "skipped" || status === "stale";
}
async function savePrUrl(path, url) {
  const result = await readState(path);
  const state = result.ok ? result.value : {};
  state.pr_url = url;
  await writeState(path, state);
}
function extractPrUrl(output) {
  if (!output) return null;
  const match = output.match(/https?:\/\/\S+/);
  if (!match) return null;
  let url = match[0];
  url = url.replace(/[),.;'"!\]]+$/, "");
  return url;
}
function markDownstreamStale(state, targetStep, allStepNames) {
  const targetIndex = allStepNames.indexOf(targetStep);
  const updated = { ...state };
  for (let i = targetIndex + 1; i < allStepNames.length; i++) {
    const step = allStepNames[i];
    if (updated[step] === "done") {
      updated[step] = "stale";
    }
  }
  return updated;
}

// src/engine/steps.ts
var ALL_STEPS = [
  {
    name: "worktree",
    label: "Worktree",
    phase: "SETUP",
    enforcement: "structural",
    prerequisites: [],
    skippableForTiers: [],
    isCheckpoint: false,
    skillName: "worktree"
  },
  {
    name: "memory",
    label: "Memory",
    phase: "UNDERSTAND",
    enforcement: "advisory",
    prerequisites: [],
    skippableForTiers: [],
    isCheckpoint: false,
    skillName: "memory"
  },
  {
    // `explore` (divergent: context, questions, approaches) — always runs,
    // advisory. Working notes are ephemeral (.pipeline/); the selected approach
    // + rejected alternatives are promoted to .memory/decisions/. It emits the
    // operator-confirmed Track (product|technical) → .docs/track/<slug>.md.
    name: "explore",
    label: "Explore",
    phase: "DECIDE",
    enforcement: "advisory",
    prerequisites: [],
    skippableForTiers: [],
    isCheckpoint: false,
    skillName: "explore"
  },
  {
    name: "complexity",
    label: "Complexity",
    phase: "DECIDE",
    enforcement: "advisory",
    prerequisites: ["explore"],
    skippableForTiers: [],
    isCheckpoint: false
  },
  {
    // `prd` (convergent: product-only design doc) — gating, PRODUCT track only.
    // Skipped on the technical track (no product requirements to spec). A
    // conflict rooted in contradictory FRs can re-open it (kickbackTarget).
    name: "prd",
    label: "PRD",
    phase: "DECIDE",
    enforcement: "gating",
    prerequisites: ["explore"],
    skippableForTiers: [],
    skippableForTracks: ["technical"],
    isCheckpoint: false,
    skillName: "prd",
    kickbackTarget: true
  },
  {
    name: "architecture_diagram",
    label: "Architecture Diagram",
    phase: "DECIDE",
    enforcement: "advisory",
    prerequisites: ["complexity"],
    skippableForTiers: ["S"],
    isCheckpoint: false,
    skillName: "architecture-diagram"
  },
  {
    // adr-2026-06-29-architecture-before-stories-convergent-kickback: architecture precedes stories so stories derive from the approved
    // design (+ PRD when product) and architecture-induced failure modes become
    // negative-path stories. Re-openable as a targeted amendment (kickbackTarget).
    name: "architecture_review",
    label: "Architecture Review",
    phase: "DECIDE",
    enforcement: "advisory",
    prerequisites: ["architecture_diagram"],
    skippableForTiers: ["S"],
    isCheckpoint: false,
    skillName: "architecture-review",
    kickbackTarget: true
  },
  {
    name: "stories",
    label: "Stories",
    phase: "DECIDE",
    enforcement: "gating",
    prerequisites: ["architecture_review"],
    skippableForTiers: [],
    isCheckpoint: false,
    skillName: "stories",
    kickbackTarget: true
  },
  {
    name: "conflict_check",
    label: "Conflict Check",
    phase: "DECIDE",
    enforcement: "gating",
    prerequisites: ["stories"],
    skippableForTiers: ["S"],
    isCheckpoint: false,
    skillName: "conflict-check"
  },
  {
    name: "plan",
    label: "Plan",
    phase: "DECIDE",
    enforcement: "gating",
    prerequisites: ["conflict_check"],
    skippableForTiers: [],
    isCheckpoint: false,
    skillName: "plan",
    kickbackTarget: true
  },
  {
    name: "acceptance_specs",
    label: "Acceptance Specs",
    phase: "BUILD",
    enforcement: "gating",
    prerequisites: ["plan"],
    skippableForTiers: ["S"],
    isCheckpoint: false,
    skillName: "writing-system-tests"
  },
  {
    name: "build",
    label: "Build",
    phase: "BUILD",
    enforcement: "structural",
    prerequisites: ["plan"],
    skippableForTiers: [],
    isCheckpoint: true,
    skillName: "pipeline",
    loopGate: true
  },
  {
    name: "manual_test",
    label: "Manual Test",
    phase: "SHIP",
    enforcement: "advisory",
    prerequisites: ["build"],
    skippableForTiers: [],
    isCheckpoint: true,
    skillName: "manual-test",
    loopGate: true
  },
  {
    // SHIP-tail compliance gate: audits the shipped implementation against the
    // PRD's functional requirements (FR-N). A non-ALIGNED FR blocks the gate
    // and kicks back to BUILD (impl gap) or DECIDE (intended drift). loopGate
    // so it joins the selector-driven tail; gating so a FAIL cannot advance.
    name: "prd_audit",
    label: "PRD Audit",
    phase: "SHIP",
    enforcement: "gating",
    prerequisites: ["manual_test"],
    skippableForTiers: [],
    // No PRD on the technical track → nothing to audit (adr-2026-06-29-explore-prd-split-track-in-explore/adr-2026-06-29-track-marker-location).
    skippableForTracks: ["technical"],
    isCheckpoint: false,
    skillName: "prd-audit",
    loopGate: true
  },
  {
    // SHIP-tail compliance gate: as-built drift sweep of shipped code vs the
    // APPROVED ADRs / approved architecture. A BLOCKED verdict (code violates
    // an APPROVED ADR) halts for a human — fix the code or supersede the ADR.
    // Runs the architecture-review skill in --as-built mode (one skill, one
    // model-table row); see STEP_PROMPTS in step-runners.ts.
    name: "architecture_review_as_built",
    label: "Architecture Review (as-built)",
    phase: "SHIP",
    enforcement: "gating",
    prerequisites: ["prd_audit"],
    // Mirror the DECIDE-phase architecture_review's tier skip: Small features
    // produce no ADRs, so there is nothing for the as-built sweep to audit.
    skippableForTiers: ["S"],
    // And skip on ANY skip of the review (config-disable / when: on M/L), not
    // just the tier case — no APPROVED ADRs means no as-built compliance check.
    skipWhenSkipped: "architecture_review",
    isCheckpoint: false,
    skillName: "architecture-review",
    loopGate: true
  },
  {
    name: "retro",
    label: "Retro",
    phase: "SHIP",
    enforcement: "advisory",
    prerequisites: ["architecture_review_as_built"],
    skippableForTiers: ["S"],
    isCheckpoint: false,
    skillName: "retro",
    loopGate: true
  },
  {
    // Engine-native loop gate (like `complexity`, no skillName): rebase the
    // feature branch onto the discovered base before finish. Its objective
    // verdict is "branch is current with base" — the conductor runs the rebase
    // natively (see conductor.ts) rather than dispatching a Claude skill.
    name: "rebase",
    label: "Rebase",
    phase: "SHIP",
    enforcement: "structural",
    prerequisites: ["manual_test"],
    skippableForTiers: [],
    isCheckpoint: false,
    loopGate: true
  },
  {
    name: "finish",
    label: "Finish",
    phase: "SHIP",
    enforcement: "gating",
    prerequisites: ["rebase"],
    skippableForTiers: [],
    isCheckpoint: false,
    skillName: "finish",
    loopGate: true
  }
];
var OUT_OF_BAND_STEPS = {
  remediate: {
    name: "remediate",
    label: "Remediate",
    phase: "SHIP",
    enforcement: "advisory",
    prerequisites: ["prd_audit"],
    skippableForTiers: [],
    isCheckpoint: false,
    skillName: "remediate"
  }
};
var stepMap = new Map(ALL_STEPS.map((s) => [s.name, s]));
var stepIndexMap = new Map(ALL_STEPS.map((s, i) => [s.name, i]));
function getStepDefinition(name) {
  const def = stepMap.get(name) ?? OUT_OF_BAND_STEPS[name];
  if (!def) throw new Error(`Unknown step: ${name}`);
  return def;
}
function tryGetStepIndex(name) {
  const idx = stepIndexMap.get(name);
  return idx === void 0 ? null : idx;
}
var STEPS_SKIPPED_WHEN_NEW = /* @__PURE__ */ new Set([
  "assess"
]);
function shouldSkipForBootstrapMode(step, mode) {
  if (mode !== "new") return false;
  return STEPS_SKIPPED_WHEN_NEW.has(step);
}
function shouldSkipForUpstreamSkip(step, state) {
  const dep = step.skipWhenSkipped;
  if (!dep) return false;
  return state[dep] === "skipped";
}
function buildStepRegistry(config) {
  const result = [...ALL_STEPS];
  const builtInNames = new Set(result.map((s) => s.name));
  const additions = [];
  for (const [name, cfg] of Object.entries(config.steps ?? {})) {
    if (builtInNames.has(name)) continue;
    if (!cfg || typeof cfg !== "object") continue;
    const c = cfg;
    if (!c.after || !c.skill) continue;
    additions.push({
      name,
      after: c.after,
      skill: c.skill,
      enforcement: c.enforcement ?? "advisory",
      gate: c.gate,
      kickbackTarget: c.kickback_target
    });
  }
  const pending = [...additions];
  let progress = true;
  while (pending.length > 0 && progress) {
    progress = false;
    const stillPending = [];
    const lastInsertByTarget = /* @__PURE__ */ new Map();
    for (const custom of pending) {
      const existingIdx = result.findIndex((s) => s.name === custom.after);
      if (existingIdx === -1) {
        stillPending.push(custom);
        continue;
      }
      const siblingAnchor = lastInsertByTarget.get(custom.after);
      const insertAt = (siblingAnchor !== void 0 ? siblingAnchor : existingIdx) + 1;
      const targetStep = result[existingIdx];
      const newStep = {
        name: custom.name,
        label: custom.name,
        phase: targetStep.phase,
        enforcement: custom.enforcement,
        prerequisites: [custom.after],
        skippableForTiers: [],
        isCheckpoint: false,
        skillName: custom.skill,
        // A custom step joins the gate loop iff it's inserted among loop steps:
        // it inherits the `after` target's loopGate (explicit config `gate`
        // overrides). kickbackTarget is opt-in only (explicit `kickback_target`).
        loopGate: custom.gate ?? targetStep.loopGate,
        kickbackTarget: custom.kickbackTarget ?? false
      };
      result.splice(insertAt, 0, newStep);
      lastInsertByTarget.set(custom.after, insertAt);
      progress = true;
    }
    pending.length = 0;
    pending.push(...stillPending);
  }
  return result;
}

// src/engine/worktree.ts
import { mkdir, readdir, readFile as readFile2, stat } from "fs/promises";
import { join } from "path";
import { execFile as execFileCb } from "child_process";
import { promisify } from "util";
var execFile = promisify(execFileCb);
async function git(cwd, ...args) {
  const { stdout } = await execFile("git", args, { cwd });
  return stdout.trim();
}
function slugify(name) {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-{2,}/g, "-").replace(/-$/g, "").slice(0, 50);
}
var WorktreeManager = class {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
  }
  projectRoot;
  async create(featureDesc) {
    const baseSlug = slugify(featureDesc);
    const worktreesDir = join(this.projectRoot, ".worktrees");
    await mkdir(worktreesDir, { recursive: true });
    let slug = baseSlug;
    let worktreePath = join(worktreesDir, slug);
    let branch = `feature/${slug}`;
    if (await this.dirExists(worktreePath)) {
      try {
        const existingBranch = await git(worktreePath, "rev-parse", "--abbrev-ref", "HEAD");
        if (existingBranch === branch) {
          return { path: worktreePath, branch };
        }
      } catch {
      }
      let suffix = 2;
      while (await this.dirExists(join(worktreesDir, `${baseSlug}-${suffix}`))) {
        suffix++;
      }
      slug = `${baseSlug}-${suffix}`;
      worktreePath = join(worktreesDir, slug);
      branch = `feature/${slug}`;
    }
    await git(this.projectRoot, "worktree", "add", "-b", branch, worktreePath);
    return { path: worktreePath, branch };
  }
  async cleanup(name) {
    const worktreePath = join(this.projectRoot, ".worktrees", name);
    const branch = `feature/${name}`;
    try {
      await git(this.projectRoot, "worktree", "remove", "--force", worktreePath);
    } catch {
      const { rm: rm3 } = await import("fs/promises");
      await rm3(worktreePath, { recursive: true, force: true });
      await git(this.projectRoot, "worktree", "prune");
    }
    try {
      await git(this.projectRoot, "branch", "-D", branch);
    } catch {
    }
  }
  async dirExists(path) {
    try {
      const s = await stat(path);
      return s.isDirectory();
    } catch {
      return false;
    }
  }
  /**
   * Check if a PR is merged and clean up the worktree if so.
   * Returns true if the worktree was cleaned up.
   */
  async cleanupIfMerged(name, prUrl, ghRunner) {
    const merged = await checkPrMerged(prUrl, ghRunner);
    if (merged) {
      await this.cleanup(name);
      return true;
    }
    return false;
  }
  async scan() {
    const worktreesDir = join(this.projectRoot, ".worktrees");
    let entries;
    try {
      const dirents = await readdir(worktreesDir, { withFileTypes: true });
      entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      return [];
    }
    const results = [];
    for (const name of entries) {
      const wtPath = join(worktreesDir, name);
      const branch = `feature/${name}`;
      let featureStatus;
      try {
        const stateRaw = await readFile2(join(wtPath, "conduct-state.json"), "utf-8");
        const state = JSON.parse(stateRaw);
        featureStatus = state.feature_status;
      } catch {
      }
      if (featureStatus !== "complete") {
        results.push({ name, path: wtPath, branch, featureStatus });
      }
    }
    return results;
  }
};
async function checkPrMerged(prUrl, ghRunner) {
  try {
    const runner = ghRunner ?? defaultGhRunner;
    const output = await runner(prUrl);
    const data = JSON.parse(output);
    return data.state === "MERGED";
  } catch {
    return false;
  }
}
async function defaultGhRunner(prUrl) {
  const { stdout } = await execFile("gh", ["pr", "view", prUrl, "--json", "state"]);
  return stdout;
}

// src/engine/engineer/issue-ref.ts
function parseSourceRef(sourceRef) {
  if (!sourceRef) return null;
  const hash = sourceRef.lastIndexOf("#");
  if (hash <= 0 || hash === sourceRef.length - 1) return null;
  const repo = sourceRef.slice(0, hash);
  const number = sourceRef.slice(hash + 1);
  if (!/^\d+$/.test(number)) return null;
  return { repo, number };
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function bodyReferencesIssue(body, keyword, parsed) {
  const token = `(?:${escapeRegExp(parsed.repo)})?#${parsed.number}(?!\\d)`;
  const family = keyword === "Closes" ? "(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)" : "(?:refs?|references?)";
  return new RegExp(`\\b${family}\\b\\s+${token}`, "i").test(body);
}
async function injectIssueRef(opts) {
  const { gh, prUrl, keyword, sourceRef, cwd } = opts;
  const log = opts.log ?? (() => {
  });
  const parsed = parseSourceRef(sourceRef);
  if (!parsed) {
    log(`injectIssueRef: no usable sourceRef ("${sourceRef ?? ""}") \u2014 skipping ${keyword}`);
    return false;
  }
  const line = `${keyword} ${parsed.repo}#${parsed.number}`;
  try {
    const { stdout } = await gh(["pr", "view", prUrl, "--json", "body"], { cwd });
    let body = "";
    try {
      body = String(JSON.parse(stdout || "{}").body ?? "");
    } catch {
      body = "";
    }
    if (bodyReferencesIssue(body, keyword, parsed)) {
      return false;
    }
    const newBody = body.trim() === "" ? line : `${body.replace(/\s+$/, "")}

${line}`;
    await gh(["pr", "edit", prUrl, "--body", newBody], { cwd });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`injectIssueRef: non-fatal write-back failure for ${prUrl} (${line}) \u2014 ${msg}`);
    return false;
  }
}
async function closeIssueOnImplementationMerge(deps) {
  const log = deps.log ?? (() => {
  });
  if (!deps.sourceRef) return "no-source-ref";
  if (!deps.prUrl) {
    log(
      `issue-link: ${deps.slug ?? "(feature)"} carries sourceRef ${deps.sourceRef} but no implementation PR was recorded (build halted?) \u2014 skipping Closes injection`
    );
    return "no-pr-url";
  }
  await injectIssueRef({
    gh: deps.gh,
    prUrl: deps.prUrl,
    keyword: "Closes",
    sourceRef: deps.sourceRef,
    cwd: deps.cwd,
    log: deps.log
  });
  return "attempted";
}

// src/engine/pr-labels.ts
import { execFile as execFileCb2 } from "child_process";
import { promisify as promisify2 } from "util";
var execFileP = promisify2(execFileCb2);
function assertRealExecAllowed(bin) {
  if (process.env.AI_CONDUCTOR_NO_REAL_EXEC) {
    throw new Error(
      `pr-labels: real '${bin}' exec blocked under AI_CONDUCTOR_NO_REAL_EXEC (test env). Inject a fake runner instead of using makeProduction${bin === "gh" ? "Gh" : "Git"}().`
    );
  }
}
function makeProductionGh() {
  return async (args, opts) => {
    assertRealExecAllowed("gh");
    const result = await execFileP("gh", args, { cwd: opts.cwd });
    return { stdout: String(result.stdout) };
  };
}
function makeProductionGit() {
  return async (args, opts) => {
    assertRealExecAllowed("git");
    const result = await execFileP("git", args, { cwd: opts.cwd });
    return { stdout: String(result.stdout) };
  };
}
function parseIssueRef(url) {
  const m = url.match(/github\.com\/([^/]+\/[^/]+)\/(?:pull|issues)\/(\d+)/);
  if (!m) return null;
  return { repo: m[1], number: m[2] };
}
function restAddLabelArgs(repo, number, name) {
  return [
    "api",
    "--method",
    "POST",
    `repos/${repo}/issues/${number}/labels`,
    "-f",
    `labels[]=${name}`
  ];
}
function restRemoveLabelArgs(repo, number, name) {
  return [
    "api",
    "--method",
    "DELETE",
    `repos/${repo}/issues/${number}/labels/${encodeURIComponent(name)}`
  ];
}
async function ensureLabel(runGh = makeProductionGh(), cwd, name, color, log) {
  try {
    await runGh(["label", "create", name, "--color", color, "--force"], { cwd });
  } catch (err) {
    log?.(`[pr-labels] ensureLabel(${name}) error: ${err}`);
  }
}
async function addLabel(runGh = makeProductionGh(), cwd, prUrl, name, log) {
  const ref = parseIssueRef(prUrl);
  if (!ref) {
    log?.(`[pr-labels] addLabel: unparseable PR URL "${prUrl}"`);
    return;
  }
  try {
    await runGh(restAddLabelArgs(ref.repo, ref.number, name), { cwd });
  } catch (err) {
    log?.(`[pr-labels] addLabel(${prUrl}, ${name}) error: ${err}`);
  }
}
async function removeLabel(runGh = makeProductionGh(), cwd, prUrl, name, log) {
  const ref = parseIssueRef(prUrl);
  if (!ref) {
    log?.(`[pr-labels] removeLabel: unparseable PR URL "${prUrl}"`);
    return;
  }
  try {
    await runGh(restRemoveLabelArgs(ref.repo, ref.number, name), { cwd });
  } catch (err) {
    log?.(`[pr-labels] removeLabel(${prUrl}, ${name}) error: ${err}`);
  }
}
var ERROR_SENTINEL = {
  state: "UNKNOWN",
  mergeable: "UNKNOWN",
  hasFailingOrPendingChecks: true,
  labels: []
};
var NOTFOUND_SENTINEL = {
  state: "NOTFOUND",
  mergeable: "UNKNOWN",
  hasFailingOrPendingChecks: true,
  labels: []
};
var NOT_FOUND_PATTERNS = [
  "not found",
  "could not resolve to",
  // gh GraphQL: "Could not resolve to a PullRequest with the number N"
  "no pull requests",
  "404",
  "no such"
];
function isNotFoundError(err) {
  const msg = String(err instanceof Error ? err.message : err).toLowerCase();
  return NOT_FOUND_PATTERNS.some((p) => msg.includes(p));
}
var FAILING_OR_PENDING = /* @__PURE__ */ new Set([
  "FAILURE",
  "ERROR",
  "PENDING",
  "TIMED_OUT",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
  "CANCELLED"
]);
function isCheckFailingOrPending(c) {
  const status = (c.status ?? "").toUpperCase();
  const conclusion = (c.conclusion ?? "").toUpperCase();
  if (FAILING_OR_PENDING.has(status)) return true;
  if (FAILING_OR_PENDING.has(conclusion)) return true;
  if (!c.conclusion) return true;
  return false;
}
async function prMergeState(runGh = makeProductionGh(), cwd, prUrl, log) {
  try {
    const { stdout } = await runGh(
      ["pr", "view", prUrl, "--json", "state,mergeable,statusCheckRollup,labels"],
      { cwd }
    );
    const data = JSON.parse(stdout);
    const state = data.state ?? "UNKNOWN";
    const mergeable = data.mergeable ?? "UNKNOWN";
    const checks = data.statusCheckRollup ?? [];
    const hasFailingOrPendingChecks = checks.length > 0 && checks.some(isCheckFailingOrPending);
    const labels = (data.labels ?? []).map((l) => l.name ?? "").filter(Boolean);
    return { state, mergeable, hasFailingOrPendingChecks, labels };
  } catch (err) {
    log?.(`[pr-labels] prMergeState(${prUrl}) error: ${err}`);
    if (isNotFoundError(err)) {
      return { ...NOTFOUND_SENTINEL };
    }
    return { ...ERROR_SENTINEL };
  }
}
function isMergeable(s) {
  return s.state === "OPEN" && s.mergeable === "MERGEABLE" && !s.hasFailingOrPendingChecks;
}
async function findOrCreatePr(runGh = makeProductionGh(), cwd, opts, log) {
  try {
    try {
      const { stdout } = await runGh(
        ["pr", "view", opts.branch, "--json", "url,state"],
        { cwd }
      );
      const data = JSON.parse(stdout);
      if (data.state === "OPEN" && data.url) {
        return { prUrl: data.url };
      }
      log?.(
        `[pr-labels] findOrCreatePr: existing PR for ${opts.branch} is ${data.state ?? "unknown"} \u2014 creating new`
      );
    } catch {
    }
    const createArgs = [
      "pr",
      "create",
      "--head",
      opts.branch,
      "--base",
      opts.base,
      "--title",
      opts.title,
      "--body",
      opts.body
    ];
    if (opts.draft) createArgs.push("--draft");
    const { stdout: createOut } = await runGh(createArgs, { cwd });
    const prUrl = extractPrUrl(createOut);
    if (prUrl) return { prUrl };
    log?.(`[pr-labels] findOrCreatePr: could not parse URL from output: ${createOut}`);
    return {};
  } catch (err) {
    log?.(`[pr-labels] findOrCreatePr(${opts.branch}) error: ${err}`);
    return {};
  }
}
async function comment(runGh = makeProductionGh(), cwd, prUrl, body, log) {
  try {
    await runGh(["pr", "comment", prUrl, "--body", body], { cwd });
  } catch (err) {
    log?.(`[pr-labels] comment(${prUrl}) error: ${err}`);
  }
}
var NEEDS_REMEDIATION_MARKER = "<!-- conductor:needs-remediation -->";
function parseCommentUrl(url) {
  const m = url.match(
    /github\.com\/([^/]+)\/([^/]+)\/(?:pull|issues)\/\d+#issuecomment-(\d+)/
  );
  if (!m) return null;
  return { owner: m[1], repo: m[2], commentId: m[3] };
}
async function upsertComment(runGh = makeProductionGh(), cwd, prUrl, marker, body, log) {
  const taggedBody = `${marker}
${body}`;
  let matchedUrl;
  try {
    const { stdout } = await runGh(["pr", "view", prUrl, "--json", "comments"], { cwd });
    const data = JSON.parse(stdout);
    const matched = (data.comments ?? []).find(
      (c) => typeof c?.body === "string" && c.body.includes(marker)
    );
    matchedUrl = matched?.url;
  } catch (err) {
    log?.(`[pr-labels] upsertComment(${prUrl}) lookup failed: ${err} \u2014 creating new comment`);
    await comment(runGh, cwd, prUrl, taggedBody, log);
    return;
  }
  if (matchedUrl) {
    const ref = parseCommentUrl(matchedUrl);
    if (ref) {
      try {
        await runGh(
          [
            "api",
            "--method",
            "PATCH",
            `repos/${ref.owner}/${ref.repo}/issues/comments/${ref.commentId}`,
            "-f",
            `body=${taggedBody}`
          ],
          { cwd }
        );
      } catch (err) {
        log?.(
          `[pr-labels] upsertComment(${prUrl}) PATCH failed: ${err} \u2014 leaving existing comment as-is`
        );
      }
      return;
    }
    log?.(
      `[pr-labels] upsertComment(${prUrl}) marked comment url unparseable (${matchedUrl}) \u2014 creating new comment`
    );
  }
  await comment(runGh, cwd, prUrl, taggedBody, log);
}
async function setReady(runGh = makeProductionGh(), cwd, prUrl, log) {
  try {
    await runGh(["pr", "ready", prUrl], { cwd });
  } catch (err) {
    log?.(`[pr-labels] setReady(${prUrl}) error: ${err}`);
  }
}

// src/engine/halt-pr-rehabilitation.ts
var NEEDS_REMEDIATION_TITLE_PREFIX = "needs-remediation:";
var NEEDS_REMEDIATION_LABEL = "needs-remediation";
function parsePrView(stdout) {
  let raw;
  try {
    raw = JSON.parse(stdout || "{}");
  } catch {
    raw = {};
  }
  const labels = Array.isArray(raw.labels) ? raw.labels.map((l) => String(l?.name ?? "")) : [];
  return {
    title: String(raw.title ?? ""),
    isDraft: Boolean(raw.isDraft),
    labels
  };
}
async function rehabilitateHaltPr(deps) {
  const { gh, cwd, prUrl, sourceRef } = deps;
  const log = deps.log ?? (() => {
  });
  let view;
  try {
    const { stdout } = await gh(["pr", "view", prUrl, "--json", "title,isDraft,labels"], { cwd });
    view = parsePrView(stdout);
  } catch (err) {
    log(`[halt-pr-rehab] gh pr view failed for ${prUrl} \u2014 skipping rehabilitation: ${err}`);
    return "gh-unavailable";
  }
  const hasHaltTitle = view.title.startsWith(NEEDS_REMEDIATION_TITLE_PREFIX);
  const hasHaltLabel = view.labels.includes(NEEDS_REMEDIATION_LABEL);
  if (!hasHaltTitle && !hasHaltLabel) return "not-halt-pr";
  let anyFailed = false;
  if (view.isDraft) {
    try {
      await gh(["pr", "ready", prUrl], { cwd });
    } catch (err) {
      anyFailed = true;
      log(`[halt-pr-rehab] ready-flip failed for ${prUrl}: ${err}`);
    }
  }
  if (hasHaltLabel) {
    const ref = parseIssueRef(prUrl);
    if (!ref) {
      anyFailed = true;
      log(`[halt-pr-rehab] unparseable PR URL "${prUrl}" \u2014 cannot clear label`);
    } else {
      try {
        await gh(restRemoveLabelArgs(ref.repo, ref.number, NEEDS_REMEDIATION_LABEL), { cwd });
      } catch (err) {
        anyFailed = true;
        log(`[halt-pr-rehab] label clear failed for ${prUrl}: ${err}`);
      }
    }
  }
  await injectIssueRef({ gh, prUrl, keyword: "Closes", sourceRef, cwd, log });
  return anyFailed ? "partial" : "rehabilitated";
}
async function readStaleHaltTitle(gh, cwd, prUrl, log) {
  try {
    const { stdout } = await gh(["pr", "view", prUrl, "--json", "title"], { cwd });
    const title = String(JSON.parse(stdout || "{}").title ?? "");
    return title.startsWith(NEEDS_REMEDIATION_TITLE_PREFIX) ? title : null;
  } catch (err) {
    log?.(`[halt-pr-rehab] gate read failed for ${prUrl} \u2014 fail-open: ${err}`);
    return null;
  }
}

// src/engine/rebase.ts
import { execa } from "execa";
import { writeFile as writeFile4, readFile as readFile5, access as access2 } from "fs/promises";
import { join as join5, isAbsolute } from "path";

// src/engine/gate-verdicts.ts
import { join as join3 } from "path";
import { mkdir as mkdir2, readFile as readFile4, readdir as readdir3, writeFile as writeFile2 } from "fs/promises";

// src/engine/artifacts.ts
import { access, readdir as readdir2, readFile as readFile3, rm, stat as stat2 } from "fs/promises";
import { basename, join as join2, relative } from "path";
var STEP_ARTIFACT_GLOBS = {
  bootstrap: [],
  memory: [],
  assess: [".docs/decisions/technical-assessment-*.md"],
  // `explore` is advisory + ephemeral (notes → .pipeline/, decision → .memory/);
  // it writes no committed .docs artifact, so it has no completion glob.
  explore: [],
  // `prd` writes the product-only design doc (product track only).
  prd: [".docs/specs/*.md"],
  complexity: [],
  stories: [".docs/stories/**/*.md"],
  conflict_check: [".docs/conflicts/*.md"],
  plan: [".docs/plans/*.md"],
  architecture_diagram: [".docs/architecture/*.md"],
  architecture_review: [
    ".docs/decisions/architecture-review-*.md",
    ".docs/decisions/adr-*.md"
  ],
  worktree: [],
  // Acceptance/system specs land in stack-specific places. Cover the common
  // conventions so the completion check doesn't false-fail on a non-Rails
  // project (e.g. a Node app whose tests are `app.test.js` at the root). The
  // patterns avoid recursing node_modules (root globs are non-recursive; the
  // `**` ones are scoped to test dirs).
  //
  // A monorepo with several packages (e.g. separate `api/` and `frontend/`)
  // puts specs under arbitrary package prefixes that no fixed root pattern can
  // anticipate. Rather than guess, a project declares its own locations via the
  // `acceptance_spec_globs` config key — those globs are appended here at
  // check time (see checkStepCompletion). They may use a leading `*/` to match
  // any immediate subdirectory without naming each package (matchGlob skips
  // node_modules / dot-dirs when expanding `*/`, preserving the no-node_modules
  // property above).
  acceptance_specs: [
    "spec/acceptance/**/*",
    "spec/requests/**/*",
    "spec/system/**/*",
    "test/acceptance/**/*",
    "test/**/*",
    "tests/**/*",
    "__tests__/**/*",
    "*.test.js",
    "*.test.ts",
    "*.test.jsx",
    "*.test.tsx",
    "*.spec.js",
    "*.spec.ts",
    "*.spec.jsx",
    "*.spec.tsx"
  ],
  build: [".pipeline/task-status.json"],
  // Run evidence (gitignored, stable filename, overwritten each run) — NOT
  // committed. These are regenerated every run; tracking them caused date-stamp
  // sprawl, rebase/merge conflicts, and dirty-tree HALTs at the finish-time
  // rebase. `.pipeline/` is already gitignored in consumer repos, so the gate
  // still finds them on disk while git never sees them.
  manual_test: [".pipeline/manual-test-results.md"],
  // SHIP-tail compliance gates (see CUSTOM_COMPLETION_PREDICATES below).
  prd_audit: [".pipeline/prd-audit.md"],
  architecture_review_as_built: [".pipeline/architecture-review-as-built.md"],
  retro: [".docs/retros/*.md"],
  // Engine-native; its verdict is computed from git state, not a file artifact.
  rebase: [],
  finish: [],
  // Conductor reads .pipeline/remediation.json directly to route; not a gate artifact.
  remediate: []
};
async function fileIsFreshSinceSession(path, sessionStartedAt) {
  try {
    const s = await stat2(path);
    if (sessionStartedAt === void 0) return true;
    return s.mtimeMs >= sessionStartedAt;
  } catch {
    return false;
  }
}
var HALT_MARKER = ".pipeline/halt-user-input-required";
function planStem(planFilePath) {
  return basename(planFilePath, ".md");
}
function extraArtifactGlobs(step, config) {
  if (step === "acceptance_specs") return config?.acceptance_spec_globs ?? [];
  return [];
}
async function findArtifactFiles(dir, step, extraGlobs = []) {
  const patterns = [...STEP_ARTIFACT_GLOBS[step] ?? [], ...extraGlobs];
  if (patterns.length === 0) return [];
  const files = [];
  for (const pattern of patterns) {
    files.push(...await matchGlob(dir, pattern));
  }
  return files;
}
var STALE_SWEEP_STEPS = /* @__PURE__ */ new Set([
  "manual_test",
  "prd_audit",
  "architecture_review_as_built"
]);
async function sweepStaleReviewArtifacts(dir, step, sessionStartedAt) {
  if (!STALE_SWEEP_STEPS.has(step) || sessionStartedAt === void 0) return [];
  const removed = [];
  for (const f of await findArtifactFiles(dir, step)) {
    if (await fileIsFreshSinceSession(f, sessionStartedAt)) continue;
    try {
      await rm(f);
      removed.push(f);
    } catch {
    }
  }
  return removed;
}
var FINISH_CHOICE_MARKER = ".pipeline/finish-choice";
var FINISH_CHOICE_VALUES = ["pr", "merge-local", "keep", "discard"];
function parseAsBuiltVerdict(content) {
  const m = content.match(
    /^[^\S\n]*\*{0,2}\s*Verdict\s*\*{0,2}\s*:+\s*\*{0,2}\s*(.+?)\s*\*{0,2}\s*$/im
  );
  if (!m) return null;
  const value = m[1].replace(/\*+/g, "").trim();
  return value.length > 0 ? value : null;
}
var ACCEPTANCE_SPECS_RED_EVIDENCE = ".pipeline/acceptance-specs-red.json";
function validateAcceptanceRedEvidence(ev) {
  if (typeof ev !== "object" || ev === null) {
    return { ok: false, reason: `${ACCEPTANCE_SPECS_RED_EVIDENCE} is not a JSON object` };
  }
  const e = ev;
  const num = (k) => typeof e[k] === "number" && Number.isFinite(e[k]) ? e[k] : null;
  const failed = num("failed");
  const skipped = num("skipped");
  const errors = num("errors");
  const executed = num("executed");
  if (failed === null || skipped === null || errors === null || executed === null) {
    return {
      ok: false,
      reason: `${ACCEPTANCE_SPECS_RED_EVIDENCE} must record numeric executed/passed/failed/skipped/errors from the real RED run`
    };
  }
  if (typeof e.command !== "string" || e.command.trim() === "") {
    return {
      ok: false,
      reason: `${ACCEPTANCE_SPECS_RED_EVIDENCE} must record the test "command" that was run`
    };
  }
  if (!Array.isArray(e.targetSpecs) || e.targetSpecs.length === 0) {
    return {
      ok: false,
      reason: `${ACCEPTANCE_SPECS_RED_EVIDENCE} must list the "targetSpecs" the RED run exercised`
    };
  }
  if (errors > 0) {
    return {
      ok: false,
      reason: `acceptance specs errored at collection (${errors}) \u2014 they never ran; fix the specs so they execute (this is not RED)`
    };
  }
  if (skipped > 0) {
    return {
      ok: false,
      reason: `${skipped} acceptance spec(s) were SKIPPED \u2014 a skipped spec does not establish RED (missing testcontainer/dependency, or a unit-only test scope?). Bring up the required infra and run the feature's specs so they actually execute`
    };
  }
  if (executed < 1) {
    return {
      ok: false,
      reason: `acceptance-specs RED run executed 0 tests \u2014 the command did not select the feature's specs`
    };
  }
  if (failed < 1) {
    return {
      ok: false,
      reason: `acceptance-specs RED run shows 0 failed \u2014 RED not established; the generated specs must FAIL before implementation`
    };
  }
  return { ok: true };
}
var CUSTOM_COMPLETION_PREDICATES = {
  // Build is "done" only when (a) no halt marker is present and (b) every
  // task in .pipeline/task-status.json is completed or skipped. The halt-
  // marker check exists because a pipeline session that exits at the user's
  // explicit request (e.g. "exit to harness, continue later") may leave
  // task-status.json showing all-complete from prior tasks while the
  // user-requested blocker is still open. The pipeline skill writes
  // .pipeline/halt-user-input-required in that case (skills/pipeline/SKILL.md
  // §"User-requested exit during a run"); the conductor's stall handler
  // clears it before re-checking, so a marker that survives to gate-check
  // means a true halt that bypassed the stall handler.
  build: async (dir) => {
    try {
      await access(join2(dir, HALT_MARKER));
      return {
        done: false,
        reason: `${HALT_MARKER} is present \u2014 pipeline halted; conductor will open a recovery REPL`
      };
    } catch {
    }
    const statusPath = join2(dir, ".pipeline/task-status.json");
    let raw;
    try {
      raw = await readFile3(statusPath, "utf-8");
    } catch {
      return {
        done: false,
        reason: "missing .pipeline/task-status.json \u2014 the pipeline skill must create it"
      };
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { done: false, reason: "invalid JSON in .pipeline/task-status.json" };
    }
    const tasks = extractTasks(parsed);
    if (tasks.length === 0) {
      return { done: false, reason: "no tasks in task-status.json" };
    }
    const incomplete = tasks.filter((t) => t.status !== "completed" && t.status !== "skipped");
    if (incomplete.length > 0) {
      const names = incomplete.slice(0, 3).map((t) => t.id ?? "?").join(", ");
      const more = incomplete.length > 3 ? ` (+${incomplete.length - 3} more)` : "";
      return {
        done: false,
        reason: `${incomplete.length}/${tasks.length} tasks not completed: ${names}${more}`
      };
    }
    return { done: true };
  },
  // Acceptance-specs is "done" only when (a) at least one spec file exists AND
  // (b) a RED execution-evidence file proves the feature's own specs actually
  // RAN and FAILED — not that they were skipped/deselected/collection-errored.
  // The step previously had only a file-existence glob, so a generated spec that
  // never executed (an integration spec `importorskip`-ed away for want of a
  // testcontainer, or a suite scoped to a unit-only dir) satisfied the gate; the
  // daemon then declared GREEN and opened a PR whose own acceptance specs failed
  // in CI. Evidence is written by the writing-system-tests skill from the real
  // RED run (gitignored run evidence, not a committed design artifact).
  acceptance_specs: async (dir, ctx) => {
    const files = await findArtifactFiles(
      dir,
      "acceptance_specs",
      extraArtifactGlobs("acceptance_specs", ctx.config)
    );
    if (files.length === 0) {
      return {
        done: false,
        reason: "no acceptance spec files present \u2014 the writing-system-tests skill must generate failing specs"
      };
    }
    const evidencePath = join2(dir, ACCEPTANCE_SPECS_RED_EVIDENCE);
    let raw;
    try {
      raw = await readFile3(evidencePath, "utf-8");
    } catch {
      return {
        done: false,
        reason: `${ACCEPTANCE_SPECS_RED_EVIDENCE} is missing \u2014 the writing-system-tests skill must run the new specs and record the RED result (a spec that is never executed does not establish RED)`
      };
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { done: false, reason: `invalid JSON in ${ACCEPTANCE_SPECS_RED_EVIDENCE}` };
    }
    const verdict = validateAcceptanceRedEvidence(parsed);
    if (!verdict.ok) return { done: false, reason: verdict.reason };
    return { done: true };
  },
  // Manual-test passes only when .pipeline/manual-test-results.md exists, has
  // no FAIL rows, and was written this session. Previously the step had no
  // gate at all (STEP_ARTIFACT_GLOBS['manual_test'] = []) — any clean REPL
  // exit marked it done with zero proof of work. The results file is run
  // evidence (gitignored) — it is NOT a committed design artifact.
  manual_test: async (dir, ctx) => {
    const file = join2(dir, ".pipeline/manual-test-results.md");
    let content;
    try {
      content = await readFile3(file, "utf-8");
    } catch {
      return {
        done: false,
        reason: ".pipeline/manual-test-results.md is missing \u2014 the manual-test skill must record per-story PASS/FAIL results before exiting"
      };
    }
    if (/\|\s*FAIL/i.test(content)) {
      return {
        done: false,
        reason: ".pipeline/manual-test-results.md contains FAIL rows \u2014 fix the bugs and re-run manual-test"
      };
    }
    if (!await fileIsFreshSinceSession(file, ctx.sessionStartedAt)) {
      return {
        done: false,
        reason: ".pipeline/manual-test-results.md exists but is stale (mtime predates this conductor session); manual-test must re-run for the current feature"
      };
    }
    return { done: true };
  },
  // PRD-audit passes only when a fresh audit report for THIS session exists and
  // every functional-requirement (FR-N) row is ALIGNED — or an un-ALIGNED row is
  // explicitly marked ACCEPTED (a human-accepted intended divergence). A
  // MISSING / PARTIAL / DIVERGED row that is not ACCEPTED blocks the gate, so the
  // selector cannot advance to retro/finish until the gap is closed (BUILD) or
  // the PRD is amended (DECIDE) and the audit re-run. Mirrors manual_test:
  // presence + freshness + no blocking rows.
  prd_audit: async (dir, ctx) => {
    const files = await findArtifactFiles(dir, "prd_audit");
    if (files.length === 0) {
      return {
        done: false,
        reason: "no .pipeline/prd-audit.md present \u2014 the prd-audit skill must record a per-FR verdict table"
      };
    }
    const fresh = [];
    for (const f of files) {
      if (await fileIsFreshSinceSession(f, ctx.sessionStartedAt)) fresh.push(f);
    }
    if (fresh.length === 0) {
      return {
        done: false,
        reason: "prd-audit report exists but is stale (mtime predates this session) \u2014 re-run the prd-audit for the current feature"
      };
    }
    for (const f of fresh) {
      const blocking = findUnalignedFrRows(await readFile3(f, "utf-8"));
      if (blocking.length > 0) {
        const shown = blocking.slice(0, 3).join("; ");
        const more = blocking.length > 3 ? ` (+${blocking.length - 3} more)` : "";
        return {
          done: false,
          reason: `prd-audit found un-ALIGNED FRs: ${shown}${more} \u2014 close the gap (BUILD) or amend the PRD (DECIDE), then re-audit`
        };
      }
    }
    return { done: true };
  },
  // As-built architecture gate is FAIL-CLOSED: it passes only when a fresh
  // report records an explicit clean approval — `APPROVED` or `APPROVED WITH
  // DRIFT NOTES` (the as-built vocabulary; see skills/architecture-review).
  // A `BLOCKED` verdict, a missing `Verdict:` line, or any unrecognized
  // verdict keeps the gate UNSATISFIED so the SHIP tail HALTs loudly rather
  // than silently shipping. This replaces the old fail-OPEN check (passed
  // unless the literal word BLOCKED appeared), which let a no-ADR / garbled
  // verdict slip through marked `done` and the loop end without DONE or HALT.
  architecture_review_as_built: async (dir, ctx) => {
    const files = await findArtifactFiles(dir, "architecture_review_as_built");
    if (files.length === 0) {
      return {
        done: false,
        reason: "no .pipeline/architecture-review-as-built.md present \u2014 the as-built review must record a verdict"
      };
    }
    const fresh = [];
    for (const f of files) {
      if (await fileIsFreshSinceSession(f, ctx.sessionStartedAt)) fresh.push(f);
    }
    if (fresh.length === 0) {
      return {
        done: false,
        reason: "as-built architecture review exists but is stale (mtime predates this session) \u2014 re-run for the current feature"
      };
    }
    for (const f of fresh) {
      const content = await readFile3(f, "utf-8");
      const verdict = parseAsBuiltVerdict(content);
      if (verdict === null) {
        return {
          done: false,
          reason: "as-built review has no parseable `Verdict:` line \u2014 expected APPROVED / APPROVED WITH DRIFT NOTES / BLOCKED; re-run the as-built review"
        };
      }
      if (!/^APPROVED\b/i.test(verdict)) {
        return {
          done: false,
          reason: `as-built review verdict is "${verdict}" \u2014 not a clean APPROVED (BLOCKED means shipped code violates an APPROVED ADR; an unrecognized verdict means the review may have found no ADRs to check). Fix the code or supersede the ADR (human-approved), then re-run`
        };
      }
    }
    return { done: true };
  },
  // Retro passes when a fresh retro file exists for THIS feature. Filename
  // should contain the slug per skills/retro/SKILL.md ("Save to
  // .docs/retros/YYYY-MM-DD-<feature-name>.md"). Falls back to "any retro
  // fresh in this session" when no feature_desc is available.
  retro: async (dir, ctx) => {
    const allFiles = await findArtifactFiles(dir, "retro");
    if (allFiles.length === 0) {
      return {
        done: false,
        reason: "no .docs/retros/*.md present (retro skill must save a report)"
      };
    }
    const slug = ctx.featureDesc ? slugify(ctx.featureDesc) : null;
    if (slug) {
      const matched = allFiles.filter(
        (f) => f.endsWith(`-${slug}.md`) || f.endsWith(`/${slug}.md`)
      );
      if (matched.length > 0) {
        for (const f of matched) {
          if (await fileIsFreshSinceSession(f, ctx.sessionStartedAt)) return { done: true };
        }
        return {
          done: false,
          reason: `slug-matched retro exists but is stale (mtime predates this session) \u2014 retro must re-run`
        };
      }
      for (const f of allFiles) {
        if (await fileIsFreshSinceSession(f, ctx.sessionStartedAt)) return { done: true };
      }
      return {
        done: false,
        reason: `no retro found for current feature (expected .docs/retros/*-${slug}.md OR a retro file with mtime >= session start)`
      };
    }
    for (const f of allFiles) {
      if (await fileIsFreshSinceSession(f, ctx.sessionStartedAt)) return { done: true };
    }
    return {
      done: false,
      reason: "retro files exist but none are fresh for this session"
    };
  },
  // Finish passes only when a fresh .pipeline/finish-choice marker is
  // present (mtime >= sessionStartedAt). The conductor sweeps stale markers
  // at session start (Conductor.run), so any marker observed here was
  // written by the finish skill in this run. For choice='pr', also require
  // state.pr_url to be set. The previous "pr_url alone passes" path was
  // dropped because pr_url from a prior feature in the same worktree could
  // satisfy the gate spuriously.
  finish: async (dir, ctx) => {
    const choicePath = join2(dir, FINISH_CHOICE_MARKER);
    let choice;
    try {
      choice = (await readFile3(choicePath, "utf-8")).trim();
    } catch {
      return {
        done: false,
        reason: `${FINISH_CHOICE_MARKER} is missing \u2014 the finish skill must record the chosen outcome (pr | merge-local | keep | discard)`
      };
    }
    if (!FINISH_CHOICE_VALUES.includes(choice)) {
      return {
        done: false,
        reason: `${FINISH_CHOICE_MARKER} contains unrecognized value "${choice}" \u2014 expected one of ${FINISH_CHOICE_VALUES.join(", ")}`
      };
    }
    if (!await fileIsFreshSinceSession(choicePath, ctx.sessionStartedAt)) {
      return {
        done: false,
        reason: `${FINISH_CHOICE_MARKER} is stale (mtime predates this session) \u2014 finish must re-run`
      };
    }
    if (choice === "pr") {
      let prUrl;
      try {
        const raw = await readFile3(join2(dir, ".pipeline/conduct-state.json"), "utf-8");
        const state = JSON.parse(raw);
        if (!state.pr_url) {
          return {
            done: false,
            reason: `${FINISH_CHOICE_MARKER}="pr" but no pr_url in state \u2014 the PR URL must be recorded`
          };
        }
        prUrl = state.pr_url;
      } catch {
        return {
          done: false,
          reason: 'cannot read state to confirm pr_url for finish-choice="pr"'
        };
      }
      try {
        const staleTitle = await readStaleHaltTitle(makeProductionGh(), dir, prUrl);
        if (staleTitle !== null) {
          return {
            done: false,
            reason: `recorded PR ${prUrl} is still titled "${staleTitle}" \u2014 the finish/pr skill must rewrite the reused halt PR's title/body before completing`
          };
        }
      } catch {
      }
    }
    return { done: true };
  }
};
var GATE_ONLY_PREDICATES = {
  // Stories pass when every story has a Happy Path AND a Negative Path(s)
  // section (each with ≥1 Given/When/Then bullet) and no DRAFT status.
  // Structural check against the repo convention (### Happy Path / ###
  // Negative Paths headings, **Status:** marker). See gate-audit-2026-06-23.md.
  stories: async (dir) => {
    const files = await findArtifactFiles(dir, "stories");
    if (files.length === 0) {
      return { done: false, reason: "no .docs/stories/**/*.md present" };
    }
    for (const file of files) {
      const content = await readFile3(file, "utf-8");
      const rel = relative(dir, file);
      if (/^\s*\*\*Status:\*\*\s*DRAFT\b/im.test(content)) {
        return {
          done: false,
          reason: `${rel}: story is DRAFT \u2014 must be accepted before planning`
        };
      }
      for (const block of splitStoryBlocks(content)) {
        const label = `${rel}${block.id ? ` (Story ${block.id})` : ""}`;
        const hasHappy = hasPathSection(block.text, "happy");
        const hasNegative = hasPathSection(block.text, "negative");
        if (!hasHappy || !hasNegative) {
          const missing = !hasHappy && !hasNegative ? "happy and negative paths" : !hasHappy ? "a happy path" : "a negative path";
          return {
            done: false,
            reason: `${label}: missing ${missing} (each story needs a Happy Path and a Negative Path(s) section with \u22651 Given/When/Then bullet)`
          };
        }
      }
    }
    return { done: true };
  },
  // Plan passes when every story's happy path AND negative path is covered by
  // ≥1 task. Coverage is read from task `**Story:** <id> (happy|negative path)`
  // lines and the `## Coverage Check` table. Falls back to story-level coverage
  // when a plan has no path-type markers for a story. See gate-audit-2026-06-23.md.
  plan: async (dir) => {
    const planFiles = await findArtifactFiles(dir, "plan");
    if (planFiles.length === 0) {
      return { done: false, reason: "no .docs/plans/*.md present" };
    }
    const storyFiles = await findArtifactFiles(dir, "stories");
    if (storyFiles.length === 0) {
      return { done: false, reason: "no .docs/stories to check plan coverage against" };
    }
    const required = [];
    for (const sf of storyFiles) {
      const content = await readFile3(sf, "utf-8");
      for (const block of splitStoryBlocks(content)) {
        const id = block.id ?? storyIdFromFilename(sf);
        if (!id) continue;
        if (hasPathSection(block.text, "happy")) required.push({ id, type: "happy" });
        if (hasPathSection(block.text, "negative")) required.push({ id, type: "negative" });
      }
    }
    if (required.length === 0) return { done: true };
    let planText = "";
    for (const pf of planFiles) planText += "\n" + await readFile3(pf, "utf-8");
    const covered = collectPlanCoverage(planText);
    const gaps = [];
    for (const r of required) {
      if (covered.has(`${r.id}|${r.type}`)) continue;
      const hasPathType = covered.has(`${r.id}|happy`) || covered.has(`${r.id}|negative`);
      if (!hasPathType && covered.has(`${r.id}|*`)) continue;
      gaps.push(`${r.id} ${r.type}`);
    }
    if (gaps.length > 0) {
      const shown = gaps.slice(0, 5).join(", ");
      const more = gaps.length > 5 ? ` (+${gaps.length - 5} more)` : "";
      return {
        done: false,
        reason: `plan does not cover: ${shown}${more} \u2014 add task(s) referencing these story paths`
      };
    }
    if (!planHasDependencyTree(planText)) {
      return {
        done: false,
        reason: 'plan has no task dependency tree \u2014 add a "## Task Dependency Graph" section or per-task "**Dependencies:**" lines'
      };
    }
    return { done: true };
  }
};
function planHasDependencyTree(planText) {
  return /^##\s+task\s+dependency\s+graph/im.test(planText) || /\*\*dependencies:\*\*/i.test(planText);
}
function isStoriesApproved(content) {
  if (/\bstatus\b[\s*:]*\bdraft\b/i.test(content)) return false;
  return /\bstatus\b[\s*:]*\baccepted\b/i.test(content);
}
function hasDraftAdr(content) {
  return /status[^:\n]*:\s*[\*_]*\s*draft/i.test(content);
}
function parseComplexityTier(content) {
  if (!content) return void 0;
  const m = content.match(/\bTier:\s*([SML])\b/i);
  if (!m) return void 0;
  return m[1].toUpperCase();
}
function parseIntakeSourceRef(content) {
  if (!content) return void 0;
  const m = content.match(/^\s*Source-Ref:\s*(\S+)/im);
  if (!m) return void 0;
  return parseSourceRef(m[1]) ? m[1] : void 0;
}
function parseTrack(content) {
  if (!content) return void 0;
  const m = content.match(/^\s*Track:\s*(product|technical)\b/im);
  if (!m) return void 0;
  return m[1].toLowerCase();
}
var VERDICT_RE = /\b(ALIGNED|MISSING|PARTIAL|DIVERGED)\b/i;
function parseFrVerdictRow(line) {
  if (!/^\s*\|/.test(line)) return null;
  const frCellIdx = line.split("|").map((c) => c.trim()).findIndex((c) => /\bFR-\d+[A-Za-z]?\b/i.test(c));
  if (frCellIdx === -1) return null;
  const cells = line.split("|").map((c) => c.trim());
  const frId = cells[frCellIdx].match(/\bFR-\d+[A-Za-z]?\b/i)[0].toUpperCase();
  const verdictCell = cells.slice(frCellIdx + 1).find((c) => VERDICT_RE.test(c));
  if (!verdictCell) return null;
  const keyword = verdictCell.match(VERDICT_RE)[1].toUpperCase();
  const accepted = cells.some((c) => /\bACCEPTED\b/i.test(c));
  const blocking = keyword !== "ALIGNED" && !accepted;
  const gapCell = cells.find((c) => /\b(plan-gap|intended-drift|impl-gap)\b/i.test(c)) ?? "";
  const gapClass = /\bplan-gap\b/i.test(gapCell) ? "plan-gap" : /\bintended-drift\b/i.test(gapCell) ? "intended-drift" : /\bimpl-gap\b/i.test(gapCell) ? "impl-gap" : "unknown";
  return { fr: frId, blocking, gapClass };
}
function findUnalignedFrRows(content) {
  const blocking = [];
  for (const line of content.split("\n")) {
    const row = parseFrVerdictRow(line);
    if (row?.blocking) blocking.push(row.fr);
  }
  return blocking;
}
function findUnalignedFrRowsWithClass(content) {
  const rows = [];
  for (const line of content.split("\n")) {
    const row = parseFrVerdictRow(line);
    if (row?.blocking) rows.push({ fr: row.fr, gapClass: row.gapClass });
  }
  return rows;
}
async function classifyPrdAuditGaps(dir, sessionStartedAt) {
  const files = await findArtifactFiles(dir, "prd_audit");
  const blocking = [];
  for (const f of files) {
    if (!await fileIsFreshSinceSession(f, sessionStartedAt)) continue;
    blocking.push(...findUnalignedFrRowsWithClass(await readFile3(f, "utf-8")));
  }
  if (blocking.length === 0) return { kind: "clean", summary: "no blocking FRs" };
  const summary = blocking.slice(0, 5).map((r) => `${r.fr} (${r.gapClass})`).join("; ");
  const more = blocking.length > 5 ? ` (+${blocking.length - 5} more)` : "";
  const allImpl = blocking.every((r) => r.gapClass === "impl-gap");
  return {
    kind: allImpl ? "impl-only" : "needs-decide",
    summary: summary + more
  };
}
var REMEDIATION_TARGET_STEPS = [
  "build",
  "acceptance_specs",
  "architecture_review",
  "plan"
];
async function readRemediationPlan(dir, sessionStartedAt) {
  const path = join2(dir, ".pipeline/remediation.json");
  if (!await fileIsFreshSinceSession(path, sessionStartedAt)) return null;
  let parsed;
  try {
    parsed = JSON.parse(await readFile3(path, "utf-8"));
  } catch {
    return null;
  }
  const rawGaps = parsed?.dispositions;
  if (!Array.isArray(rawGaps)) return null;
  const valid = [...REMEDIATION_TARGET_STEPS, "halt"];
  const gaps = [];
  for (const g of rawGaps) {
    if (!g || typeof g !== "object") continue;
    const o = g;
    const disposition = o.disposition;
    if (!valid.includes(disposition)) continue;
    const category = o.category === "architectural-clarity" || o.category === "product-scope" ? o.category : null;
    if (disposition === "halt" && category === null) continue;
    const tasks = Array.isArray(o.tasks) ? o.tasks.filter(
      (t) => !!t && typeof t === "object" && typeof t.title === "string"
    ).map((t) => ({
      id: String(t.id ?? ""),
      title: String(t.title)
    })) : [];
    gaps.push({
      id: typeof o.id === "string" ? o.id : "?",
      disposition,
      category,
      rationale: typeof o.rationale === "string" ? o.rationale : "",
      tasks
    });
  }
  return gaps.length > 0 ? { gaps } : null;
}
function splitStoryBlocks(content) {
  const heading = /^##\s+Story\s+([A-Za-z0-9.\-]+)/i;
  const blocks = [];
  let current = null;
  for (const line of content.split("\n")) {
    const m = line.match(heading);
    if (m) {
      if (current) blocks.push({ id: current.id, text: current.lines.join("\n") });
      current = { id: m[1], lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) blocks.push({ id: current.id, text: current.lines.join("\n") });
  return blocks.length > 0 ? blocks : [{ text: content }];
}
function hasPathSection(blockText, type) {
  const body = sectionBody(
    blockText,
    type === "happy" ? /happy\s*path/i : /negative\s*paths?/i
  );
  if (body === null) return false;
  return /\bgiven\b/i.test(body) && /\bthen\b/i.test(body);
}
function sectionBody(text, headingRegex) {
  let capturing = false;
  let level = 0;
  const body = [];
  for (const line of text.split("\n")) {
    const hm = line.match(/^(#{1,6})\s+(.*)$/);
    if (hm) {
      if (capturing && hm[1].length <= level) break;
      if (!capturing && headingRegex.test(hm[2])) {
        capturing = true;
        level = hm[1].length;
        continue;
      }
    }
    if (capturing) body.push(line);
  }
  return capturing ? body.join("\n") : null;
}
function storyIdFromFilename(path) {
  const base = path.split("/").pop() ?? "";
  const m = base.match(/\b(ST-\d+|EP-\d+)/i);
  return m ? m[1].toUpperCase() : void 0;
}
function collectPlanCoverage(planText) {
  const set = /* @__PURE__ */ new Set();
  for (const block of splitOnHeadings(planText, /^###\s+/)) {
    const ids = /* @__PURE__ */ new Set();
    const storyRef = /\*\*Story:\*\*\s*(?:story|epic)?\s*([A-Za-z0-9.\-]+)/gi;
    let m;
    while ((m = storyRef.exec(block)) !== null) {
      const id = m[1];
      if (/^(n\/?a|prerequisite|none|all)$/i.test(id)) continue;
      ids.add(id);
    }
    if (ids.size === 0) continue;
    const types = /* @__PURE__ */ new Set();
    const typeLine = block.match(/\*\*Type:\*\*\s*([^\n]*)/i);
    if (typeLine) {
      if (/happy/i.test(typeLine[1])) types.add("happy");
      if (/negative/i.test(typeLine[1])) types.add("negative");
    }
    const parens = block.match(/\*\*Story:\*\*[^\n]*\(([^)]*)\)/i);
    if (parens) {
      if (/happy/i.test(parens[1])) types.add("happy");
      if (/negative/i.test(parens[1])) types.add("negative");
    }
    if (types.size === 0) {
      if (/\bhappy\s*path\b/i.test(block)) types.add("happy");
      if (/\bnegative\s*path\b/i.test(block)) types.add("negative");
    }
    for (const id of ids) {
      set.add(`${id}|*`);
      for (const t of types) set.add(`${id}|${t}`);
    }
  }
  const tableRow = /^\|\s*(?:story\s+)?([A-Za-z0-9.\-]+)\s*\|?\s*(happy|negative)\b/gim;
  let tm;
  while ((tm = tableRow.exec(planText)) !== null) {
    set.add(`${tm[1]}|*`);
    set.add(`${tm[1]}|${tm[2].toLowerCase()}`);
  }
  return set;
}
function splitOnHeadings(text, headingRe) {
  const blocks = [];
  let current = null;
  for (const line of text.split("\n")) {
    if (headingRe.test(line)) {
      if (current) blocks.push(current.join("\n"));
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) blocks.push(current.join("\n"));
  return blocks;
}
function extractTasks(parsed) {
  if (!parsed || typeof parsed !== "object") return [];
  const container = "tasks" in parsed ? parsed.tasks : parsed;
  if (Array.isArray(container)) {
    return container.filter((t) => typeof t === "object" && t !== null).map((t) => ({ id: t.id, status: t.status }));
  }
  if (container && typeof container === "object") {
    return Object.entries(container).map(([id, v]) => ({
      id,
      status: v && typeof v === "object" && "status" in v ? v.status : void 0
    }));
  }
  return [];
}
async function checkStepCompletion(dir, step, ctx = {}) {
  const predicate = CUSTOM_COMPLETION_PREDICATES[step];
  if (predicate) return predicate(dir, ctx);
  const extra = extraArtifactGlobs(step, ctx.config);
  const patterns = [...STEP_ARTIFACT_GLOBS[step] ?? [], ...extra];
  if (patterns.length === 0) return { done: true };
  const files = await findArtifactFiles(dir, step, extra);
  if (files.length > 0) return { done: true };
  return {
    done: false,
    reason: `no files matching ${patterns.join(" or ")}`
  };
}
async function getArtifactStatus(dir, step) {
  const patterns = STEP_ARTIFACT_GLOBS[step];
  if (!patterns || patterns.length === 0) return [];
  const out = [];
  for (const pattern of patterns) {
    const matched = await matchGlob(dir, pattern);
    const rel = matched.map((f) => relative(dir, f));
    out.push({
      pattern,
      files: rel,
      satisfied: rel.length > 0
    });
  }
  return out;
}
async function matchGlob(root, pattern) {
  const parts = pattern.split("/");
  const files = [];
  if (parts.length > 1 && parts[0] === "*") {
    const rest = parts.slice(1).join("/");
    let entries;
    try {
      entries = await readdir2(root, { withFileTypes: true });
    } catch {
      return files;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      files.push(...await matchGlob(join2(root, entry.name), rest));
    }
    return files;
  }
  const doubleStarIdx = parts.indexOf("**");
  if (doubleStarIdx >= 0) {
    const baseParts = parts.slice(0, doubleStarIdx);
    const tailParts = parts.slice(doubleStarIdx + 1);
    const baseDir = join2(root, ...baseParts);
    const tail = tailParts[tailParts.length - 1] ?? "*";
    const matcher = compileSegmentMatcher(tail);
    files.push(...await walkDir(baseDir, matcher));
    return files;
  }
  if (parts[parts.length - 1].includes("*")) {
    const dirParts = parts.slice(0, -1);
    const filePattern = parts[parts.length - 1];
    const matcher = compileSegmentMatcher(filePattern);
    const dir = join2(root, ...dirParts);
    try {
      const entries = await readdir2(dir);
      for (const entry of entries) {
        if (matcher(entry)) files.push(join2(dir, entry));
      }
    } catch {
    }
    return files;
  }
  const { access: access6 } = await import("fs/promises");
  const full = join2(root, pattern);
  try {
    await access6(full);
    files.push(full);
  } catch {
  }
  return files;
}
function compileSegmentMatcher(pattern) {
  if (pattern === "*") return () => true;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const re = new RegExp(`^${escaped}$`);
  return (name) => re.test(name);
}
async function walkDir(dir, match) {
  const found = [];
  let entries;
  try {
    entries = await readdir2(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join2(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...await walkDir(full, match));
    } else if (match(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

// src/engine/gate-verdicts.ts
async function checkGateCompletion(dir, step, ctx = {}) {
  const gatePredicate = GATE_ONLY_PREDICATES[step];
  if (gatePredicate) return gatePredicate(dir, ctx);
  return checkStepCompletion(dir, step, ctx);
}
var GATES_DIR = ".pipeline/gates";
function verdictPath(dir, step) {
  return join3(dir, GATES_DIR, `${step}.json`);
}
async function computeAndWriteVerdict(dir, step, ctx = {}) {
  const result = await checkGateCompletion(dir, step, ctx);
  const verdict = {
    satisfied: result.done,
    reason: result.reason,
    checkedAt: Date.now()
  };
  await writeVerdict(dir, step, verdict);
  return verdict;
}
async function writeVerdict(dir, step, verdict) {
  await mkdir2(join3(dir, GATES_DIR), { recursive: true });
  await writeFile2(
    verdictPath(dir, step),
    JSON.stringify(verdict, null, 2) + "\n",
    "utf-8"
  );
}
async function readVerdict(dir, step) {
  try {
    const parsed = JSON.parse(await readFile4(verdictPath(dir, step), "utf-8"));
    if (!parsed || typeof parsed.satisfied !== "boolean") return null;
    return parsed;
  } catch {
    return null;
  }
}
async function readAllVerdicts(dir) {
  const out = {};
  let entries;
  try {
    entries = await readdir3(join3(dir, GATES_DIR));
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const step = entry.slice(0, -".json".length);
    const v = await readVerdict(dir, step);
    if (v) out[step] = v;
  }
  return out;
}

// src/engine/halt-marker.ts
import { mkdir as mkdir3, writeFile as writeFile3 } from "fs/promises";
import { join as join4 } from "path";
var HALT_MARKER2 = ".pipeline/HALT";
async function writeHaltMarker(projectRoot, body) {
  await mkdir3(join4(projectRoot, ".pipeline"), { recursive: true }).catch(() => {
  });
  await writeFile3(join4(projectRoot, HALT_MARKER2), body, "utf-8").catch(() => {
  });
}

// src/engine/rebase.ts
function makeGitRunner(cwd) {
  return async (args) => {
    try {
      const r = await execa("git", args, { cwd, reject: false });
      if (!r || typeof r !== "object") {
        return { exitCode: 1, stdout: "", stderr: "" };
      }
      return {
        exitCode: typeof r.exitCode === "number" ? r.exitCode : 1,
        stdout: typeof r.stdout === "string" ? r.stdout : "",
        stderr: typeof r.stderr === "string" ? r.stderr : ""
      };
    } catch {
      return { exitCode: 1, stdout: "", stderr: "" };
    }
  };
}
async function originDefaultBranch(git2) {
  const head = await git2(["symbolic-ref", "refs/remotes/origin/HEAD"]);
  if (head.exitCode === 0 && head.stdout.trim()) {
    const m = head.stdout.trim().match(/^refs\/remotes\/origin\/(.+)$/);
    if (m) return m[1];
  }
  return null;
}
async function resolveBase(git2, localBase) {
  const remotes = await git2(["remote"]);
  const hasOrigin = remotes.exitCode === 0 && remotes.stdout.split("\n").map((l) => l.trim()).includes("origin");
  if (!hasOrigin) {
    return { ref: localBase, kind: "local", branch: localBase };
  }
  let defaultBranch = await originDefaultBranch(git2);
  if (!defaultBranch) {
    const show = await git2(["remote", "show", "origin"]);
    if (show.exitCode === 0) {
      const m = show.stdout.match(/HEAD branch:\s*(\S+)/);
      if (m && m[1] !== "(unknown)") defaultBranch = m[1];
    }
  }
  if (!defaultBranch) {
    return { ref: localBase, kind: "local", branch: localBase };
  }
  const fetched = await git2(["fetch", "origin", defaultBranch]);
  if (fetched.exitCode !== 0) {
    return { ref: localBase, kind: "local", branch: localBase };
  }
  return { ref: `origin/${defaultBranch}`, kind: "remote", branch: defaultBranch };
}
async function isBranchCurrent(git2, baseRef) {
  const r = await git2(["rev-list", "--count", `HEAD..${baseRef}`]);
  if (r.exitCode !== 0) return false;
  return Number.parseInt(r.stdout.trim(), 10) === 0;
}
function isCodeOrTestPath(path) {
  const p = path.trim();
  if (!p) return false;
  if (p === "CHANGELOG.md") return false;
  if (p.startsWith(".docs/")) return false;
  if (p.startsWith("docs/")) return false;
  if (/(^|\/)README(\.[A-Za-z]+)?$/i.test(p)) return false;
  if (/\.(md|mdx|txt|rst)$/i.test(p)) return false;
  return true;
}
function filterCodeOrTestPaths(paths) {
  return paths.filter(isCodeOrTestPath);
}
async function changedPathsBetween(git2, fromRef, toRef) {
  const r = await git2(["diff", "--name-only", fromRef, toRef]);
  if (r.exitCode !== 0) return [];
  return r.stdout.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
}
async function conflictedFiles(git2) {
  const r = await git2(["diff", "--name-only", "--diff-filter=U"]);
  if (r.exitCode !== 0) return [];
  return r.stdout.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
}
async function rebaseStateActive(git2, projectRoot) {
  for (const name of ["rebase-merge", "rebase-apply"]) {
    const r = await git2(["rev-parse", "--git-path", name]);
    if (r.exitCode !== 0) continue;
    const p = r.stdout.trim();
    if (!p) continue;
    const abs = isAbsolute(p) ? p : join5(projectRoot, p);
    if (await access2(abs).then(() => true, () => false)) return true;
  }
  return false;
}
var CHANGELOG = "CHANGELOG.md";
var UNRELEASED_HEADING = /^##\s+\[Unreleased\]/im;
function unreleasedAdditions(baseContent, headContent) {
  const baseBlock = unreleasedBlockLines(baseContent);
  const headBlock = unreleasedBlockLines(headContent);
  const baseSet = new Set(baseBlock.map((l) => l.trim()));
  return headBlock.filter((line) => {
    const t = line.trim();
    if (t.length === 0) return false;
    if (/^#{2,3}\s/.test(t)) return false;
    return !baseSet.has(t);
  });
}
function unreleasedBlockLines(content) {
  const lines = content.split("\n");
  const out = [];
  let capturing = false;
  for (const line of lines) {
    if (UNRELEASED_HEADING.test(line)) {
      capturing = true;
      continue;
    }
    if (capturing && /^##\s+/.test(line)) break;
    if (capturing) out.push(line);
  }
  return out;
}
function buildResolvedChangelog(baseContent, featureAdditions) {
  if (!UNRELEASED_HEADING.test(baseContent)) return null;
  const baseBlock = unreleasedBlockLines(baseContent);
  const present = new Set(baseBlock.map((l) => l.trim()));
  const toAppend = featureAdditions.filter((l) => !present.has(l.trim()));
  if (toAppend.length === 0) return baseContent;
  const lines = baseContent.split("\n");
  let headingIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (UNRELEASED_HEADING.test(lines[i])) {
      headingIdx = i;
      break;
    }
  }
  let insertAt = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      insertAt = i;
      break;
    }
  }
  let tail = insertAt;
  while (tail > headingIdx + 1 && lines[tail - 1].trim() === "") tail--;
  const before = lines.slice(0, tail);
  const after = lines.slice(insertAt);
  const block = [...before, ...toAppend, "", ...after];
  return block.join("\n");
}
async function writeHalt(projectRoot, conflicts, extraReason) {
  const fileList = conflicts.length > 0 ? conflicts.join(", ") : "(unknown)";
  const note = `rebase conflict \u2014 parked for human resolution
` + (extraReason ? `${extraReason}
` : "") + `Conflicted files: ${fileList}

Resume procedure:
  1. Resolve the conflicts in the listed file(s).
  2. git rebase --continue
  3. rm .pipeline/HALT
  4. Re-queue the feature for the daemon.
`;
  await writeHaltMarker(projectRoot, note);
}
async function performRebase(git2, projectRoot, localBase) {
  const inRepo = await git2(["rev-parse", "--is-inside-work-tree"]);
  if (inRepo.exitCode !== 0 || inRepo.stdout.trim() !== "true") {
    return { kind: "noop" };
  }
  const preexistingConflicts = await conflictedFiles(git2);
  if (preexistingConflicts.length > 0 || await rebaseStateActive(git2, projectRoot)) {
    return {
      kind: "conflict_halt",
      conflicts: preexistingConflicts,
      reason: "rebase already in progress \u2014 finish resolving and run `git rebase --continue`, then clear .pipeline/HALT before re-queueing"
    };
  }
  const base = await resolveBase(git2, localBase);
  if (await isBranchCurrent(git2, base.ref)) {
    return { kind: "noop" };
  }
  const preTree = (await git2(["rev-parse", "HEAD"])).stdout.trim();
  const mergeBase = (await git2(["merge-base", "HEAD", base.ref])).stdout.trim();
  const featureAdditions = await captureFeatureChangelog(git2, mergeBase || base.ref);
  const rebase = await git2(["rebase", "--autostash", base.ref]);
  if (rebase.exitCode === 0) {
    return classifyClean(git2, preTree);
  }
  const conflicts = await conflictedFiles(git2);
  if (conflicts.length === 0) {
    return {
      kind: "conflict_halt",
      conflicts: [],
      reason: rebase.stderr.trim() || "rebase failed without reported conflicts"
    };
  }
  if (conflicts.length === 1 && conflicts[0] === CHANGELOG) {
    const resolved = await tryResolveChangelogConflict(
      git2,
      projectRoot,
      featureAdditions
    );
    if (resolved) return { kind: "changelog_resolved" };
    return {
      kind: "conflict_halt",
      conflicts,
      reason: "CHANGELOG conflict is outside the [Unreleased] block \u2014 cannot auto-resolve"
    };
  }
  return {
    kind: "conflict_halt",
    conflicts,
    reason: conflicts.includes(CHANGELOG) ? "CHANGELOG conflicts alongside other files \u2014 not auto-resolving" : "rebase conflict requires human resolution"
  };
}
async function captureFeatureChangelog(git2, baseRef) {
  const head = await git2(["show", `HEAD:${CHANGELOG}`]);
  if (head.exitCode !== 0) return [];
  const base = await git2(["show", `${baseRef}:${CHANGELOG}`]);
  const baseContent = base.exitCode === 0 ? base.stdout : "";
  return unreleasedAdditions(baseContent, head.stdout);
}
async function classifyClean(git2, preTree) {
  const changed = await changedPathsBetween(git2, preTree, "HEAD");
  const codePaths = filterCodeOrTestPaths(changed);
  if (codePaths.length === 0) return { kind: "noop" };
  return { kind: "changed", changedCodePaths: codePaths };
}
async function tryResolveChangelogConflict(git2, projectRoot, featureAdditions) {
  const baseSide = await git2(["show", `:2:${CHANGELOG}`]);
  if (baseSide.exitCode !== 0) return false;
  const resolved = buildResolvedChangelog(baseSide.stdout, featureAdditions);
  if (resolved === null) return false;
  await writeFile4(join5(projectRoot, CHANGELOG), resolved, "utf-8");
  const add = await git2(["add", CHANGELOG]);
  if (add.exitCode !== 0) return false;
  const cont = await git2(["-c", "core.editor=true", "rebase", "--continue"]);
  if (cont.exitCode !== 0) {
    return false;
  }
  return true;
}
async function featureCommitsPreserved(git2, baseRef, subjectsBefore) {
  if (subjectsBefore.length === 0) return true;
  const r = await git2(["log", "--format=%s", `${baseRef}..HEAD`]);
  if (r.exitCode !== 0) return false;
  const currentSubjects = new Set(
    r.stdout.split("\n").map((l) => l.trim()).filter((l) => l.length > 0)
  );
  return subjectsBefore.every((s) => currentSubjects.has(s));
}
async function resolveRebaseConflicts(git2, projectRoot, conflictOutcome, resolver, cap) {
  if (cap <= 0) return conflictOutcome;
  let onto = null;
  for (const name of ["rebase-merge/onto", "rebase-apply/onto"]) {
    const r = await git2(["rev-parse", "--git-path", name]);
    if (r.exitCode !== 0) continue;
    const filePath = r.stdout.trim();
    if (!filePath) continue;
    const absPath = isAbsolute(filePath) ? filePath : join5(projectRoot, filePath);
    try {
      const content = await readFile5(absPath, "utf-8");
      onto = content.trim();
      break;
    } catch {
    }
  }
  if (onto === null) {
    return conflictOutcome;
  }
  const subjR = await git2(["log", "--format=%s", `${onto}..ORIG_HEAD`]);
  const subjectsBefore = subjR.exitCode === 0 ? subjR.stdout.split("\n").map((l) => l.trim()).filter((l) => l.length > 0) : [];
  const conflicts = conflictOutcome.kind === "conflict_halt" ? conflictOutcome.conflicts : await conflictedFiles(git2);
  for (let attempt = 1; attempt <= cap; attempt++) {
    const attemptConflicts = await conflictedFiles(git2);
    const ctxConflicts = attemptConflicts.length > 0 ? attemptConflicts : conflicts;
    const result = await resolver({ conflicts: ctxConflicts, projectRoot, baseRef: onto });
    if (!result.resolved) {
      return {
        kind: "conflict_halt",
        conflicts,
        reason: result.reason || "resolver gave up"
      };
    }
    const stillActive = await rebaseStateActive(git2, projectRoot);
    const currentConflicts = await conflictedFiles(git2);
    if (stillActive || currentConflicts.length > 0) {
      continue;
    }
    if (!await isBranchCurrent(git2, onto)) {
      return {
        kind: "conflict_halt",
        conflicts,
        reason: "rebase resolution left the branch not current with base"
      };
    }
    if (!await featureCommitsPreserved(git2, onto, subjectsBefore)) {
      return {
        kind: "conflict_halt",
        conflicts,
        reason: "rebase resolution dropped feature commit(s)"
      };
    }
    const changed = filterCodeOrTestPaths(await changedPathsBetween(git2, onto, "HEAD"));
    return changed.length > 0 ? { kind: "changed", changedCodePaths: changed } : { kind: "noop" };
  }
  return {
    kind: "conflict_halt",
    conflicts,
    reason: `rebase resolution failed after ${cap} attempt(s)`
  };
}
async function applyRebaseVerdicts(projectRoot, outcome, ranManualTest) {
  if (outcome.kind === "conflict_halt") {
    await writeVerdict(projectRoot, "rebase", {
      satisfied: false,
      reason: `rebase conflict: ${outcome.reason}`,
      checkedAt: Date.now()
    });
    return { satisfied: false, kickedBack: [] };
  }
  const satisfiedVerdict = {
    satisfied: true,
    reason: outcome.kind === "noop" ? "branch already current with base" : outcome.kind === "changelog_resolved" ? "CHANGELOG-only conflict auto-resolved; branch current" : "rebased onto base (code changed \u2014 downstream re-verify)",
    checkedAt: Date.now()
  };
  await writeVerdict(projectRoot, "rebase", satisfiedVerdict);
  if (outcome.kind !== "changed") {
    return { satisfied: true, kickedBack: [] };
  }
  const evidence = `rebase changed code/test paths: ${outcome.changedCodePaths.slice(0, 5).join(", ")}` + (outcome.changedCodePaths.length > 5 ? ` (+${outcome.changedCodePaths.length - 5} more)` : "");
  const kickedBack = [];
  const targets = ranManualTest ? ["build", "manual_test"] : ["build"];
  for (const target of targets) {
    await writeVerdict(projectRoot, target, {
      satisfied: false,
      reason: "invalidated by file-changing rebase",
      checkedAt: Date.now(),
      kickback: { from: "rebase", evidence }
    });
    kickedBack.push(target);
  }
  return { satisfied: true, kickedBack };
}
async function emitRebaseEvent(events, outcome) {
  try {
    switch (outcome.kind) {
      case "noop":
        await events.emit({ type: "rebase_noop" });
        break;
      case "changed":
        await events.emit({
          type: "rebase_changed",
          changedPaths: outcome.changedCodePaths
        });
        break;
      case "changelog_resolved":
        await events.emit({ type: "rebase_changelog_resolved" });
        break;
      case "conflict_halt":
        await events.emit({
          type: "rebase_conflict_halt",
          reason: outcome.reason,
          conflicts: outcome.conflicts
        });
        break;
    }
  } catch {
  }
}

// src/engine/owner-gate/identity.ts
function normalizeOwnerId(raw) {
  if (raw == null) return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed === "" ? null : trimmed;
}
function configuredOwner(config) {
  const id = normalizeOwnerId(config.spec_owner);
  return id === null ? { resolved: false } : { resolved: true, id };
}
async function ghLoginOwner(gh, cwd) {
  let login;
  try {
    const { stdout } = await gh(["api", "user", "--jq", ".login"], { cwd });
    login = normalizeOwnerId(stdout);
  } catch {
    return { resolved: false };
  }
  if (login === null || login === "null" || login === "undefined") return { resolved: false };
  return { resolved: true, id: login };
}
async function resolveDaemonOwner(config, gh, cwd) {
  const configured = configuredOwner(config);
  if (configured.resolved) return configured;
  return ghLoginOwner(gh, cwd);
}

// src/engine/user-config.ts
import { readFile as readFile6, writeFile as writeFile5, mkdir as mkdir4, rename } from "fs/promises";
import { existsSync } from "fs";
import { homedir } from "os";
import { join as join6, dirname } from "path";
import { load as loadYaml, dump as dumpYaml } from "js-yaml";
var USER_CONFIG_DIR = ".ai-conductor";
var USER_CONFIG_FILE = "config.yml";
var LEGACY_JSON_FILE = join6(".claude", "ai-conductor.config.json");
function userConfigPath(home = homedir()) {
  return join6(home, USER_CONFIG_DIR, USER_CONFIG_FILE);
}
async function readUserConfig(path = userConfigPath()) {
  if (!existsSync(path)) {
    return { config: {}, existed: false };
  }
  let raw;
  try {
    raw = await readFile6(path, "utf-8");
  } catch (e) {
    return {
      config: {},
      existed: true,
      parseError: e instanceof Error ? e.message : String(e)
    };
  }
  if (raw.trim() === "") {
    return { config: {}, existed: true };
  }
  try {
    const parsed = loadYaml(raw);
    if (parsed === null || parsed === void 0) {
      return { config: {}, existed: true };
    }
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        config: {},
        existed: true,
        parseError: "Root of user config must be a YAML mapping"
      };
    }
    return { config: parsed, existed: true };
  } catch (e) {
    return {
      config: {},
      existed: true,
      parseError: e instanceof Error ? e.message : String(e)
    };
  }
}

// src/engine/owner-gate/machine-identity.ts
function resolveMachineSpecOwner(userConfig) {
  return { spec_owner: userConfig.spec_owner ?? null };
}
async function readMachineOwnerConfig(readUser = readUserConfig) {
  const { config } = await readUser();
  return resolveMachineSpecOwner(config);
}
function makeMachineOwnerResolver(gh, cwd, readUser = readUserConfig) {
  return async () => resolveDaemonOwner(await readMachineOwnerConfig(readUser), gh, cwd);
}

// src/engine/conductor.ts
import {
  readFile as readFile12,
  writeFile as writeFile10,
  mkdir as mkdir7,
  readdir as readdir4,
  access as accessFile,
  unlink as unlinkFile,
  stat as stat4
} from "fs/promises";
import { createHash } from "crypto";
import { relative as relative2, join as join14 } from "path";
import { homedir as homedir3 } from "os";

// src/engine/when-expression.ts
function evaluateWhen(expression, state) {
  const expr = expression.trim();
  const andIdx = expr.indexOf("&&");
  if (andIdx !== -1) {
    const left = expr.slice(0, andIdx).trim();
    const right = expr.slice(andIdx + 2).trim();
    const leftResult = evaluateWhen(left, state);
    if (!leftResult.result) return leftResult;
    const rightResult = evaluateWhen(right, state);
    return rightResult;
  }
  const inMatch = expr.match(/^tier\s+in\s+\[([^\]]+)\]$/);
  if (inMatch) {
    const members = inMatch[1].split(",").map((s) => s.trim());
    const tier = state.complexity_tier ?? "";
    return { result: members.includes(tier) };
  }
  const tierEqMatch = expr.match(/^tier\s*==\s*(\S+)$/);
  if (tierEqMatch) {
    const expected = tierEqMatch[1];
    const tier = state.complexity_tier ?? "";
    return { result: tier === expected };
  }
  const phaseEqMatch = expr.match(/^phase\s*==\s*(\S+)$/);
  if (phaseEqMatch) {
    const expected = phaseEqMatch[1];
    const currentPhase = state["current_phase"];
    if (currentPhase === void 0) {
      return { result: false, undefinedKey: "current_phase" };
    }
    return { result: String(currentPhase) === expected };
  }
  const stateKeyMatch = expr.match(/^\$\{([^}]+)\}\s*==\s*(.+)$/);
  if (stateKeyMatch) {
    const key = stateKeyMatch[1].trim();
    const expected = stateKeyMatch[2].trim();
    const value = state[key];
    if (value === void 0) {
      return { result: false, undefinedKey: key };
    }
    return { result: String(value) === expected };
  }
  return { result: false };
}
function validateWhenSyntax(expression) {
  const expr = expression.trim();
  if (!expr) return "when expression must not be empty";
  return validateWhenAtom(expr);
}
function validateWhenAtom(expr) {
  const andIdx = expr.indexOf("&&");
  if (andIdx !== -1) {
    const left = expr.slice(0, andIdx).trim();
    const right = expr.slice(andIdx + 2).trim();
    if (!left) return '"&&" must have a left-hand operand';
    if (!right) return '"&&" must have a right-hand operand';
    const leftErr = validateWhenAtom(left);
    if (leftErr) return leftErr;
    const rightErr = validateWhenAtom(right);
    if (rightErr) return rightErr;
    return null;
  }
  if (/^tier\s+in\s+\[([^\]]+)\]$/.test(expr)) return null;
  if (/^tier\s*==\s*\S+$/.test(expr)) return null;
  if (/^phase\s*==\s*\S+$/.test(expr)) return null;
  if (/^\$\{[^}]+\}\s*==\s*.+$/.test(expr)) return null;
  return `unsupported when expression: "${expr}". Supported forms: "tier == L", "tier in [M, L]", "phase == BUILD", "\${key} == value", "A && B"`;
}

// src/engine/gates.ts
function checkGate(step, state) {
  const def = typeof step === "string" ? getStepDefinition(step) : step;
  const unsatisfied = def.prerequisites.filter(
    (prereq) => !stepSatisfied(state, prereq)
  );
  if (unsatisfied.length === 0) {
    return { passed: true };
  }
  const names = unsatisfied.join(", ");
  return {
    passed: false,
    reason: `Prerequisites not satisfied: ${names}`
  };
}

// src/engine/resolved-config.ts
var DEFAULT_STEP_MODELS = {
  bootstrap: "sonnet",
  // authors the project CLAUDE.md every later step depends on
  memory: "haiku",
  assess: "sonnet",
  // dispatches 9 specialists + drives structure verification; synthesis is the opus cto-orchestrator agent
  explore: "fable",
  // divergent discovery via Fable: approach trade-offs + product/technical track classification — mistakes here cascade downstream
  prd: "fable",
  // product-only PRD authoring via Fable — reasoning-heavy
  complexity: "sonnet",
  // assigns S/M/L, which gates every downstream model/effort decision — a wrong tier cascades
  stories: "sonnet",
  conflict_check: "sonnet",
  plan: "sonnet",
  architecture_diagram: "sonnet",
  architecture_review: "fable",
  // architectural design validation via Fable
  worktree: "haiku",
  acceptance_specs: "sonnet",
  build: "haiku",
  manual_test: "sonnet",
  prd_audit: "opus",
  // cross-reference PRD intent vs shipped implementation
  architecture_review_as_built: "sonnet",
  // pattern-match code vs approved design
  retro: "sonnet",
  rebase: "fable",
  // Fable guards semantic merges; wrong merge silently reverts merged work
  finish: "haiku",
  remediate: "fable"
  // Fable guards failure disposition; wrong disposition misroutes rework
};
var DEFAULT_STEP_EFFORT = {
  bootstrap: "low",
  memory: "low",
  assess: "high",
  // orchestrator sets env var that cascades to subagents
  explore: "xhigh",
  // divergent approach trade-offs + track classification — reasoning-heavy
  prd: "xhigh",
  // product-only PRD authoring — reasoning-heavy
  complexity: "low",
  stories: "medium",
  conflict_check: "medium",
  plan: "high",
  architecture_diagram: "medium",
  architecture_review: "high",
  worktree: "low",
  acceptance_specs: "medium",
  build: "low",
  // dispatcher; intelligence is in per-task sub-sessions
  manual_test: "medium",
  prd_audit: "high",
  // FR-by-FR intent vs implementation reasoning
  architecture_review_as_built: "medium",
  retro: "medium",
  rebase: "max",
  // conflict resolution dispatch reasons over both sides of a hunk
  finish: "low",
  remediate: "high"
  // gap reasoning + concrete task planning
};
var DEFAULT_STEP_RETRIES = {
  bootstrap: 1,
  memory: 1,
  assess: 3,
  explore: 5,
  prd: 5,
  complexity: 1,
  stories: 3,
  conflict_check: 3,
  plan: 5,
  architecture_diagram: 3,
  architecture_review: 5,
  worktree: 1,
  acceptance_specs: 3,
  build: 5,
  manual_test: 3,
  prd_audit: 3,
  architecture_review_as_built: 3,
  retro: 3,
  rebase: 1,
  finish: 1,
  remediate: 3
};
var DEFAULT_STEP_REVIEW = {
  bootstrap: "auto",
  memory: "auto",
  assess: "manual",
  explore: "manual",
  prd: "manual",
  complexity: "auto",
  stories: "manual",
  conflict_check: "conditional",
  plan: "manual",
  architecture_diagram: "auto",
  architecture_review: "conditional",
  worktree: "auto",
  acceptance_specs: "auto",
  build: "auto",
  manual_test: "auto",
  prd_audit: "conditional",
  // marker written only when an FR is non-ALIGNED
  architecture_review_as_built: "conditional",
  // marker written only on drift/BLOCKED
  retro: "manual",
  rebase: "auto",
  finish: "auto",
  remediate: "auto"
  // conductor routes deterministically from remediation.json
};
var DEFAULT_STEP_TIER_OVERRIDES = {
  stories: {
    S: { effort: "low" },
    L: { effort: "high" }
  },
  plan: {
    S: { effort: "medium", max_retries: 3 },
    L: { effort: "xhigh", model: "fable" }
    // task sequencing/dependency reasoning at scale needs fable
  },
  conflict_check: {
    L: { model: "fable" }
    // subtle cross-story contradictions at ≥15 stories need fable
  }
};
var FALLBACK_MODEL = "sonnet";
var FALLBACK_EFFORT = "medium";
var FALLBACK_RETRIES = 3;
var FALLBACK_REVIEW = "manual";
function resolveStepConfig(step, phase, config, options = {}) {
  const stepCfg = config?.steps?.[step];
  const phaseCfg = config?.phases?.[phase];
  const defaultsCfg = config?.defaults;
  const tier = options.tier;
  const stepTier = tier ? stepCfg?.by_tier?.[tier] : void 0;
  const phaseTier = tier ? phaseCfg?.by_tier?.[tier] : void 0;
  const hardcodedStepTier = tier ? DEFAULT_STEP_TIER_OVERRIDES[step]?.[tier] : void 0;
  const model = options.modelCliOverride ?? stepTier?.model ?? stepCfg?.model ?? phaseTier?.model ?? phaseCfg?.model ?? defaultsCfg?.model ?? hardcodedStepTier?.model ?? DEFAULT_STEP_MODELS[step] ?? FALLBACK_MODEL;
  const effort = options.effortCliOverride ?? stepTier?.effort ?? stepCfg?.effort ?? phaseTier?.effort ?? phaseCfg?.effort ?? defaultsCfg?.effort ?? hardcodedStepTier?.effort ?? DEFAULT_STEP_EFFORT[step] ?? FALLBACK_EFFORT;
  const max_retries = stepTier?.max_retries ?? stepCfg?.max_retries ?? phaseTier?.max_retries ?? phaseCfg?.max_retries ?? defaultsCfg?.max_retries ?? hardcodedStepTier?.max_retries ?? DEFAULT_STEP_RETRIES[step] ?? FALLBACK_RETRIES;
  const review = DEFAULT_STEP_REVIEW[step] ?? FALLBACK_REVIEW;
  return {
    step,
    model,
    effort,
    max_retries,
    review,
    skill: stepCfg?.skill,
    hooks: {
      before: stepCfg?.hooks?.before,
      after: stepCfg?.hooks?.after
    },
    disabled: stepCfg?.disable === true
  };
}
function phaseForStep(step) {
  return getStepDefinition(step).phase;
}
var DEFAULT_REBASE_RESOLUTION_ATTEMPTS = 3;
function resolveRebaseResolutionAttempts(config) {
  const override = config?.rebase_resolution_attempts;
  if (override === void 0 || override === null) {
    return DEFAULT_REBASE_RESOLUTION_ATTEMPTS;
  }
  if (typeof override !== "number" || !Number.isFinite(override) || override < 0) {
    return DEFAULT_REBASE_RESOLUTION_ATTEMPTS;
  }
  return override;
}
var DEFAULT_SELF_HOST_ACTIVATION = "auto";
function resolveSelfHostConfig(config) {
  const block = config?.harness_self_host;
  let timeoutMinutes = block?.auth_park_timeout_minutes ?? 60;
  if (!Number.isInteger(timeoutMinutes) || timeoutMinutes < 0) {
    timeoutMinutes = 60;
  }
  return {
    activation: block?.activation ?? DEFAULT_SELF_HOST_ACTIVATION,
    skillRelinkPreflight: block?.skill_relink_preflight ?? true,
    sandboxBuildEnv: block?.sandbox_build_env ?? true,
    versionApprovalGate: block?.version_approval_gate ?? true,
    releaseArtifactGate: block?.release_artifact_gate ?? true,
    // Blank/whitespace normalizes to null so a freeze can never "match" an
    // empty VERSION read — safe-by-default like every other field here.
    versionFreeze: block?.version_freeze?.trim() || null,
    authParkTimeoutMinutes: timeoutMinutes
  };
}

// src/engine/self-host/sandbox-build-env.ts
import * as fsp from "fs/promises";
import { join as join7 } from "path";
import { tmpdir, homedir as homedir2 } from "os";
var realSandboxFs = {
  mkdtemp: (prefix) => fsp.mkdtemp(prefix),
  symlink: (target, path) => fsp.symlink(target, path),
  rm: (path, opts) => fsp.rm(path, opts),
  realpath: (path) => fsp.realpath(path),
  pathExists: (path) => fsp.access(path).then(() => true, () => false),
  readFile: (path) => fsp.readFile(path, "utf-8").then((t) => t, () => null),
  writeFile: (path, data) => fsp.writeFile(path, data, "utf-8"),
  copyFile: (src, dest) => fsp.copyFile(src, dest)
};
var SandboxProvisionError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "SandboxProvisionError";
  }
};
var LINKED_DIRS = ["skills", "hooks"];
var CREDENTIALS_FILE = ".credentials.json";
var SETTINGS_FILE = "settings.json";
var STATE_FILE = ".claude.json";
var ThrowawaySandbox = class {
  constructor(configDir, parentEnv, fs) {
    this.configDir = configDir;
    this.parentEnv = parentEnv;
    this.fs = fs;
  }
  configDir;
  parentEnv;
  fs;
  tornDown = false;
  childEnv() {
    return { ...this.parentEnv, CLAUDE_CONFIG_DIR: this.configDir };
  }
  async teardown() {
    if (this.tornDown) return;
    this.tornDown = true;
    await this.fs.rm(this.configDir, { recursive: true, force: true });
  }
};
async function provisionSandboxBuildEnv(opts) {
  const fs = opts.fs ?? realSandboxFs;
  const base = opts.baseDir ?? tmpdir();
  const parentEnv = opts.parentEnv ?? process.env;
  const globalConfigDir = opts.globalConfigDir ?? parentEnv.CLAUDE_CONFIG_DIR ?? join7(homedir2(), ".claude");
  let configDir = null;
  try {
    configDir = await fs.mkdtemp(join7(base, "harness-selfbuild-"));
    for (const name of LINKED_DIRS) {
      const target = join7(opts.worktreeRoot, name);
      if (!await fs.pathExists(target)) {
        throw new SandboxProvisionError(
          `Harness self-build worktree is missing '${name}/' (expected ${target}). Refusing to provision a sandbox with a dangling link; the build was NOT launched.`
        );
      }
      await fs.symlink(target, join7(configDir, name));
    }
    await copyIfPresent(
      fs,
      join7(globalConfigDir, CREDENTIALS_FILE),
      join7(configDir, CREDENTIALS_FILE)
    );
    await provisionSettings(fs, {
      src: join7(globalConfigDir, SETTINGS_FILE),
      dest: join7(configDir, SETTINGS_FILE),
      harnessRoot: opts.harnessRoot,
      worktreeRoot: opts.worktreeRoot
    });
    await provisionTrustState(fs, {
      src: opts.globalStateFile ?? defaultGlobalStateFile(parentEnv),
      dest: join7(configDir, STATE_FILE),
      harnessRoot: opts.harnessRoot,
      worktreeRoot: opts.worktreeRoot
    });
  } catch (err) {
    if (configDir) {
      await fs.rm(configDir, { recursive: true, force: true }).catch(() => {
      });
    }
    if (err instanceof SandboxProvisionError) throw err;
    const e = err;
    const failedPath = e.path ? ` (failed at ${e.path})` : "";
    throw new SandboxProvisionError(
      `Failed to provision the harness self-build sandbox${failedPath}: ${e.message}. The build was NOT launched.`
    );
  }
  return new ThrowawaySandbox(configDir, parentEnv, fs);
}
async function copyIfPresent(fs, src, dest) {
  if (await fs.pathExists(src)) await fs.copyFile(src, dest);
}
async function provisionSettings(fs, args) {
  const raw = await fs.readFile(args.src);
  if (raw === null) return;
  const rewritten = await retargetHarnessPaths(fs, raw, args.harnessRoot, args.worktreeRoot);
  await fs.writeFile(args.dest, rewritten);
}
async function retargetHarnessPaths(fs, settingsText, harnessRoot, worktreeRoot) {
  const from = await canonicalize(fs, harnessRoot);
  const to = await canonicalize(fs, worktreeRoot);
  if (from === null || to === null || from === to) return settingsText;
  return settingsText.split(`${from}/`).join(`${to}/`);
}
async function canonicalize(fs, p) {
  try {
    return await fs.realpath(p);
  } catch {
    return null;
  }
}
function defaultGlobalStateFile(parentEnv) {
  return parentEnv.CLAUDE_CONFIG_DIR ? join7(parentEnv.CLAUDE_CONFIG_DIR, STATE_FILE) : join7(homedir2(), STATE_FILE);
}
async function provisionTrustState(fs, args) {
  const raw = await fs.readFile(args.src);
  if (raw === null) return;
  let state;
  try {
    state = JSON.parse(raw);
  } catch {
    return;
  }
  const projects = state.projects;
  if (projects === null || typeof projects !== "object") return;
  const trustedByOperator = (p) => p !== null && projects[p]?.hasTrustDialogAccepted === true;
  const canonHarness = await canonicalize(fs, args.harnessRoot);
  if (!trustedByOperator(args.harnessRoot) && !trustedByOperator(canonHarness)) return;
  const canonWorktree = await canonicalize(fs, args.worktreeRoot);
  const seeded = {};
  for (const p of [args.harnessRoot, canonHarness, args.worktreeRoot, canonWorktree]) {
    if (p !== null) seeded[p] = { hasTrustDialogAccepted: true };
  }
  const onboarded = state.hasCompletedOnboarding === true;
  await fs.writeFile(
    args.dest,
    `${JSON.stringify(
      { ...onboarded ? { hasCompletedOnboarding: true } : {}, projects: seeded },
      null,
      2
    )}
`
  );
}
async function refreshSandboxCredentials(sourceConfigDir, sandboxConfigDir) {
  const src = join7(sourceConfigDir, CREDENTIALS_FILE);
  const dest = join7(sandboxConfigDir, CREDENTIALS_FILE);
  await copyIfPresent(realSandboxFs, src, dest);
}

// src/engine/self-host/version-gate.ts
import { writeFile as writeFile7 } from "fs/promises";
import { join as join8 } from "path";

// src/engine/self-host/gate-halt.ts
async function writeSelfHostHalt(projectRoot, reason) {
  const body = `${reason}

Harness self-build gate HALT \u2014 the daemon never merges (ADR-005/ADR-010).
Resume procedure:
  1. Address the gate reason above.
  2. Re-install the harness (bin/install --update) and run /verify.
  3. rm .pipeline/HALT, then merge the PR yourself.
`;
  await writeHaltMarker(projectRoot, body);
}
function firstNonEmptyLine(text) {
  if (text == null) return null;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t !== "") return t;
  }
  return null;
}

// src/engine/self-host/version-gate.ts
var VERSION_APPROVAL_MARKER = ".pipeline/version-approval";
function evaluateVersionApproval(input) {
  const approved = firstNonEmptyLine(input.approvalMarker);
  const repo = firstNonEmptyLine(input.repoVersion) ?? "";
  if (approved === null) {
    const freeze = firstNonEmptyLine(input.versionFreeze);
    if (freeze !== null) {
      if (freeze === repo) return { ok: true };
      return {
        ok: false,
        reason: `VERSION-bump approval required (self-host version gate) \u2014 version_freeze is "${freeze}" but VERSION is "${repo}"; a freeze never approves a bump. Record the approved bump in ${VERSION_APPROVAL_MARKER} (or update the freeze), then resume.`
      };
    }
    return {
      ok: false,
      reason: `VERSION-bump approval required (self-host version gate) \u2014 record the approved bump in ${VERSION_APPROVAL_MARKER}, then resume. The daemon does not invent a version.`
    };
  }
  if (approved !== repo) {
    return {
      ok: false,
      reason: `VERSION-bump approval mismatch (self-host version gate) \u2014 approved "${approved}" but VERSION is "${repo}". Reconcile the bump, then resume.`
    };
  }
  return { ok: true };
}
async function runVersionApprovalGate(opts) {
  const writeHalt2 = opts.writeHalt ?? writeSelfHostHalt;
  const writeText = opts.writeText ?? ((p, c) => writeFile7(p, c, "utf-8"));
  const markerPath = join8(opts.projectRoot, VERSION_APPROVAL_MARKER);
  const approvalMarker = await opts.readText(markerPath);
  const repoVersion = await opts.readText(join8(opts.harnessRoot, "VERSION")) ?? "";
  const verdict = evaluateVersionApproval({
    approvalMarker,
    repoVersion,
    versionFreeze: opts.versionFreeze ?? null
  });
  if (!verdict.ok) {
    await writeHalt2(opts.projectRoot, verdict.reason);
    return verdict;
  }
  if (firstNonEmptyLine(approvalMarker) === null) {
    const frozen = firstNonEmptyLine(opts.versionFreeze) ?? "";
    try {
      await writeText(markerPath, `${frozen}
`);
    } catch {
    }
  }
  return verdict;
}

// src/engine/self-host/release-gate.ts
import { execa as execa2 } from "execa";
import { access as fsAccess, constants } from "fs/promises";
import { join as join9 } from "path";
var INTEGRITY_SCRIPT = "test/test_harness_integrity.sh";
var DEFAULT_INTEGRITY_TIMEOUT_MS = 12e4;
var realIntegrityExec = async (harnessRoot, timeoutMs) => {
  const r = await execa2("bash", [join9(harnessRoot, INTEGRITY_SCRIPT)], {
    cwd: harnessRoot,
    reject: false,
    timeout: timeoutMs
  });
  return { code: typeof r.exitCode === "number" ? r.exitCode : 1, timedOut: Boolean(r.timedOut) };
};
async function runIntegritySuite(opts) {
  const access6 = opts.access ?? ((p, m) => fsAccess(p, m));
  const scriptPath = join9(opts.harnessRoot, INTEGRITY_SCRIPT);
  try {
    await access6(scriptPath, constants.F_OK);
  } catch {
    return {
      ok: false,
      reason: `harness integrity suite not found: ${scriptPath} (self-host release gate) \u2014 refusing to open a PR without running it.`
    };
  }
  const exec = opts.exec ?? realIntegrityExec;
  const { code, timedOut } = await exec(opts.harnessRoot, opts.timeoutMs ?? DEFAULT_INTEGRITY_TIMEOUT_MS);
  if (timedOut) {
    return {
      ok: false,
      reason: "harness integrity suite timed out (self-host release gate) \u2014 treated as failure, not an indefinite block."
    };
  }
  if (code !== 0) {
    return {
      ok: false,
      reason: `harness integrity suite failed (exit ${code}) (self-host release gate).`
    };
  }
  return { ok: true };
}
var HEADER_RE = /^##\s+\[([^\]]+)\]/;
function extractUnreleasedBody(changelog) {
  if (changelog == null) return null;
  const lines = changelog.split("\n");
  let i = 0;
  for (; i < lines.length; i++) {
    const m = lines[i].trim().match(HEADER_RE);
    if (m && m[1].toLowerCase() === "unreleased") break;
  }
  if (i >= lines.length) return null;
  const body = [];
  for (i += 1; i < lines.length; i++) {
    const m = lines[i].trim().match(HEADER_RE);
    if (m) {
      if (m[1].toLowerCase() === "unreleased") continue;
      break;
    }
    body.push(lines[i]);
  }
  return body.join("\n");
}
function hasChangelogEntry(body) {
  return body.split("\n").some((l) => /^\s*-\s+\S/.test(l));
}
function changelogVerdictFromBody(body) {
  if (body === null) {
    return {
      ok: false,
      reason: "CHANGELOG has no `## [Unreleased]` section (self-host release gate) \u2014 add one with the change under Added/Changed/Fixed/Removed."
    };
  }
  if (!hasChangelogEntry(body)) {
    return {
      ok: false,
      reason: "CHANGELOG `## [Unreleased]` is empty (self-host release gate) \u2014 a header alone does not satisfy the gate; add at least one entry."
    };
  }
  return { ok: true };
}
function classifyBreakingSurfaces(changed) {
  if (changed === null) return { breaking: false, uncertain: true, surfaces: [] };
  const surfaces = /* @__PURE__ */ new Set();
  for (const { status, path, origPath } of changed) {
    const removedOrRenamed = status.startsWith("D") || status.startsWith("R");
    for (const p of origPath ? [path, origPath] : [path]) {
      if (p === "bin/conduct") surfaces.add("bin/conduct CLI");
      if (p === "bin/install") surfaces.add("skill symlink targets");
      if (p.startsWith("hooks/") || p.includes("/hooks/")) surfaces.add("hook wiring");
      if (/(^|\/)settings(\.local)?\.json$/.test(p)) surfaces.add("settings.json schema");
      if (p.startsWith("skills/") && removedOrRenamed) surfaces.add("skill symlink targets");
    }
  }
  return { breaking: surfaces.size > 0, uncertain: false, surfaces: [...surfaces] };
}
var MIGRATION_SECTION_RE = /(?:^|\n)###?\s+Migration\s*\n([\s\S]*?)(?=\n##\s|$)/;
var MIGRATION_FENCE_RE = /```bash migration\s*\n[\s\S]*?```/;
function hasRunnableMigrationBlock(text) {
  if (text == null) return false;
  const section = text.match(MIGRATION_SECTION_RE);
  if (!section) return false;
  return MIGRATION_FENCE_RE.test(section[1]);
}
function evaluateMigration(input) {
  const { surfaces, hasBlock } = input;
  if (!surfaces.breaking && !surfaces.uncertain) return { ok: true };
  if (hasBlock) return { ok: true };
  const which = surfaces.uncertain ? "the change set could not be determined (fail-closed)" : `breaking surface(s): ${surfaces.surfaces.join(", ")}`;
  return {
    ok: false,
    reason: `Migration block required (self-host release gate) \u2014 ${which}, but CHANGELOG has no runnable \`\`\`bash migration\`\`\` block under a \`## Migration\` section for \`bin/migrate\`.`
  };
}
async function runReleaseArtifactGate(opts) {
  const writeHalt2 = opts.writeHalt ?? writeSelfHostHalt;
  const integrity = await runIntegritySuite({
    harnessRoot: opts.harnessRoot,
    timeoutMs: opts.timeoutMs,
    access: opts.access,
    exec: opts.exec
  });
  if (!integrity.ok) {
    await writeHalt2(opts.projectRoot, integrity.reason);
    return integrity;
  }
  const changelog = await opts.readText(join9(opts.harnessRoot, "CHANGELOG.md"));
  const unreleasedBody = extractUnreleasedBody(changelog);
  const changelogVerdict = changelogVerdictFromBody(unreleasedBody);
  if (!changelogVerdict.ok) {
    await writeHalt2(opts.projectRoot, changelogVerdict.reason);
    return changelogVerdict;
  }
  const surfaces = classifyBreakingSurfaces(await opts.changedFiles());
  const migration = evaluateMigration({
    surfaces,
    hasBlock: hasRunnableMigrationBlock(unreleasedBody)
  });
  if (!migration.ok) {
    await writeHalt2(opts.projectRoot, migration.reason);
    return migration;
  }
  return { ok: true };
}

// src/engine/self-host/wiring.ts
var defaultSelfHostGuardrails = {
  resolveHarnessRoot,
  relink: relinkSkillsForSelfBuild,
  provisionSandbox: provisionSandboxBuildEnv,
  versionGate: runVersionApprovalGate,
  releaseGate: runReleaseArtifactGate
};

// src/engine/self-host/operator-credentials.ts
import { readFile as readFile8, stat as stat3 } from "fs/promises";
import { join as join10 } from "path";
var IMMINENT_EXPIRY_MARGIN_MS = 5 * 60 * 1e3;
async function readOperatorCredentialsState(globalConfigDir, now) {
  try {
    const credPath = join10(globalConfigDir, ".credentials.json");
    const contents = await readFile8(credPath, "utf-8");
    const creds = JSON.parse(contents);
    if (!creds.claudeAiOauth || typeof creds.claudeAiOauth !== "object") {
      return "unknown";
    }
    const { expiresAt } = creds.claudeAiOauth;
    if (typeof expiresAt !== "number") {
      return "unknown";
    }
    const imminentWindowStart = now + IMMINENT_EXPIRY_MARGIN_MS;
    if (expiresAt <= imminentWindowStart) {
      return "expired";
    }
    return "fresh";
  } catch {
    return "unknown";
  }
}
async function waitForCredentialsChange(config) {
  const {
    initialState,
    credentialsPath,
    globalConfigDir,
    timeoutMs,
    pollIntervalMs = 1e3,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = () => Date.now()
  } = config;
  const startTime = now();
  let lastObservedExpiresAt;
  let lastMtime;
  try {
    const stats = await stat3(credentialsPath);
    lastMtime = stats.mtimeMs;
  } catch {
  }
  try {
    const contents = await readFile8(credentialsPath, "utf-8");
    const creds = JSON.parse(contents);
    if (creds.claudeAiOauth?.expiresAt !== void 0) {
      lastObservedExpiresAt = String(creds.claudeAiOauth.expiresAt);
    }
  } catch {
  }
  while (true) {
    const elapsed = now() - startTime;
    if (elapsed >= timeoutMs) {
      return {
        type: "timeout",
        credentialsPath,
        credentialsState: initialState,
        expiresAt: lastObservedExpiresAt
      };
    }
    await sleep(pollIntervalMs);
    let mtimeAdvanced = false;
    let currentMtime;
    try {
      const stats = await stat3(credentialsPath);
      currentMtime = stats.mtimeMs;
      if (lastMtime !== void 0 && currentMtime > lastMtime) {
        mtimeAdvanced = true;
        lastMtime = currentMtime;
      } else if (lastMtime === void 0) {
        lastMtime = currentMtime;
        mtimeAdvanced = true;
      }
    } catch {
      mtimeAdvanced = false;
    }
    if (mtimeAdvanced) {
      const newState = await readOperatorCredentialsState(globalConfigDir, now());
      try {
        const contents = await readFile8(credentialsPath, "utf-8");
        const creds = JSON.parse(contents);
        if (creds.claudeAiOauth?.expiresAt !== void 0) {
          lastObservedExpiresAt = String(creds.claudeAiOauth.expiresAt);
        }
      } catch {
      }
      if (newState === "fresh") {
        return {
          type: "refreshed",
          credentialsState: newState,
          credentialsPath
        };
      }
    }
  }
}

// src/engine/selector.ts
function gateSatisfied(step, state, verdicts) {
  if (getStepStatus(state, step) === "stale") return false;
  const v = verdicts[step];
  if (v) return v.satisfied;
  const status = getStepStatus(state, step);
  return status === "done" || status === "skipped";
}
function isSkipped(step, state) {
  if (getStepStatus(state, step.name) === "skipped") return true;
  if (state.complexity_tier && step.skippableForTiers.includes(state.complexity_tier)) {
    return true;
  }
  if (shouldSkipForBootstrapMode(step.name, state.bootstrap_mode)) return true;
  if (shouldSkipForUpstreamSkip(step, state)) return true;
  return false;
}
function selectNextGate(input) {
  const { steps, state, verdicts, regionStart } = input;
  const startIdx = steps.findIndex((s) => s.name === regionStart);
  if (startIdx === -1) {
    throw new Error(
      `selectNextGate: regionStart "${regionStart}" is not in the resolved step list`
    );
  }
  for (let i = startIdx; i < steps.length; i++) {
    const step = steps[i];
    if (isSkipped(step, state)) continue;
    if (gateSatisfied(step.name, state, verdicts)) continue;
    const v = verdicts[step.name];
    const reason = v?.kickback ? `kickback from ${v.kickback.from}: ${v.kickback.evidence}` : v?.reason ?? `${step.name} not yet satisfied`;
    return { kind: "run", step: step.name, reason };
  }
  return { kind: "done", reason: "all gates in the looped region are satisfied" };
}

// src/engine/autoheal.ts
import { readFile as readFile9, writeFile as writeFile8, mkdir as mkdir5 } from "fs/promises";
import { join as join11 } from "path";
import { execa as execa3 } from "execa";
async function attemptAutoHeal(projectRoot) {
  const result = { healed: [], skipped: [] };
  try {
    const status = await readTaskStatus(projectRoot);
    if (!status) return result;
    const pendingTasks = status.tasks.filter((t) => t.status === "pending");
    if (pendingTasks.length === 0) return result;
    const commits = await listCommits(projectRoot);
    if (commits.length === 0) {
      for (const t of pendingTasks) {
        result.skipped.push({ taskId: t.id, reason: "no git commits available" });
      }
      await writeAuditFile(projectRoot, result);
      return result;
    }
    const planPaths = await readPlanPaths(projectRoot, status.planRef);
    for (const task of pendingTasks) {
      const match = await findMatchingCommit(projectRoot, task, commits, planPaths);
      if (!match) {
        result.skipped.push({ taskId: task.id, reason: "no unambiguous commit match" });
        continue;
      }
      task.rawEntry.status = "completed";
      if ("commit" in task.rawEntry || !("commit" in task.rawEntry)) {
        task.rawEntry.commit = match.commit.slice(0, 7);
      }
      result.healed.push({
        taskId: task.id,
        commit: match.commit.slice(0, 7),
        subject: match.subject,
        matchedFiles: match.matchedFiles
      });
    }
    if (result.healed.length > 0) {
      await writeTaskStatus(status);
    }
    await writeAuditFile(projectRoot, result);
    return result;
  } catch {
    return result;
  }
}
async function readTaskStatus(projectRoot) {
  const statusPath = join11(projectRoot, ".pipeline/task-status.json");
  let raw;
  try {
    raw = await readFile9(statusPath, "utf-8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const root = parsed;
  const tasks = extractTaskRecords(root);
  if (tasks.length === 0) return null;
  const planRef = typeof root.plan_ref === "string" ? root.plan_ref : void 0;
  return { parsed: root, tasks, planRef, statusPath };
}
function extractTaskRecords(root) {
  const container = "tasks" in root ? root.tasks : root;
  if (Array.isArray(container)) {
    return container.filter((t) => typeof t === "object" && t !== null).map((entry) => ({
      id: typeof entry.id === "string" ? entry.id : String(entry.id ?? ""),
      name: typeof entry.name === "string" ? entry.name : void 0,
      status: typeof entry.status === "string" ? entry.status : void 0,
      rawEntry: entry
    })).filter((t) => t.id !== "");
  }
  if (container && typeof container === "object" && !Array.isArray(container)) {
    return Object.entries(container).filter((e) => typeof e[1] === "object" && e[1] !== null).map(([id, entry]) => ({
      id,
      name: typeof entry.name === "string" ? entry.name : void 0,
      status: typeof entry.status === "string" ? entry.status : void 0,
      rawEntry: entry
    }));
  }
  return [];
}
async function writeTaskStatus(status) {
  const serialized = JSON.stringify(status.parsed, null, 2) + "\n";
  await writeFile8(status.statusPath, serialized);
}
async function listCommits(projectRoot) {
  const mergeBase = await execa3("git", ["merge-base", "origin/main", "HEAD"], {
    cwd: projectRoot,
    reject: false
  });
  let range;
  if (mergeBase.exitCode === 0 && typeof mergeBase.stdout === "string" && mergeBase.stdout.trim()) {
    range = `${mergeBase.stdout.trim()}..HEAD`;
  } else {
    range = "HEAD";
  }
  const args = range === "HEAD" ? ["log", "-n", "100", "--format=%H%x09%s", "HEAD"] : ["log", "--format=%H%x09%s", range];
  const log = await execa3("git", args, { cwd: projectRoot, reject: false });
  if (log.exitCode !== 0 || typeof log.stdout !== "string") return [];
  return log.stdout.split("\n").map((line) => line.trim()).filter((line) => line.length > 0).map((line) => {
    const tab = line.indexOf("	");
    if (tab < 0) return { sha: line, subject: "" };
    return { sha: line.slice(0, tab), subject: line.slice(tab + 1) };
  });
}
async function filesForCommit(projectRoot, sha) {
  const out = await execa3("git", ["diff-tree", "--name-only", "-r", sha], {
    cwd: projectRoot,
    reject: false
  });
  if (out.exitCode !== 0 || typeof out.stdout !== "string") return [];
  return out.stdout.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
}
async function readPlanPaths(projectRoot, planRef) {
  const empty = /* @__PURE__ */ new Map();
  if (!planRef) return empty;
  const planPath = resolvePlanPath(projectRoot, planRef);
  let text;
  try {
    text = await readFile9(planPath, "utf-8");
  } catch {
    return empty;
  }
  return parsePlanTaskPaths(text);
}
function resolvePlanPath(projectRoot, planRef) {
  const trimmed = planRef.trim();
  const withExt = /\.md$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
  if (withExt.startsWith("/")) return withExt;
  if (withExt.startsWith(".docs/") || withExt.startsWith("./")) {
    return join11(projectRoot, withExt);
  }
  return join11(projectRoot, ".docs/plans", withExt);
}
var PATH_EXTENSIONS = /\.(?:ts|tsx|js|jsx|mjs|cjs|md|json|yml|yaml|sh|rb|py|go|rs|html|css|scss|vue|toml)$/i;
var BACKTICK_TOKEN = /`([^`\s]+)`/g;
function parsePlanTaskPaths(text) {
  const result = /* @__PURE__ */ new Map();
  const lines = text.split("\n");
  let currentTaskIds = [];
  const taskHeader = /^#{1,6}\s+Task\s+([\d.,\s-]+?)(?::|\s|$)/i;
  for (const line of lines) {
    const headerMatch = line.match(taskHeader);
    if (headerMatch) {
      currentTaskIds = expandTaskIds(headerMatch[1]);
      for (const id of currentTaskIds) {
        if (!result.has(id)) result.set(id, /* @__PURE__ */ new Set());
      }
      continue;
    }
    if (currentTaskIds.length === 0) continue;
    let m;
    while ((m = BACKTICK_TOKEN.exec(line)) !== null) {
      const token = m[1];
      if (!PATH_EXTENSIONS.test(token) && !token.includes("/")) continue;
      const normalized = token.replace(/^\.\//, "");
      if (!normalized || normalized.startsWith("-")) continue;
      for (const id of currentTaskIds) {
        result.get(id).add(normalized);
      }
    }
  }
  return result;
}
function expandTaskIds(raw) {
  const ids = [];
  for (const piece of raw.split(",")) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      for (let n = start; n <= end; n++) ids.push(String(n));
    } else if (/^\d+$/.test(trimmed)) {
      ids.push(trimmed);
    }
  }
  return ids;
}
async function findMatchingCommit(projectRoot, task, commits, planPaths) {
  const taskPaths = planPaths.get(task.id);
  const hasPlanFiles = !!(taskPaths && taskPaths.size > 0);
  for (const commit of commits) {
    const { idMatch, nameMatch } = matchSubject(commit.subject, task);
    if (!idMatch && !nameMatch) continue;
    if (!hasPlanFiles) {
      if (!(idMatch && nameMatch)) continue;
      return { commit: commit.sha, subject: commit.subject, matchedFiles: [] };
    }
    const files = await filesForCommit(projectRoot, commit.sha);
    const overlap = files.filter((f) => taskPaths.has(f.replace(/^\.\//, "")));
    if (overlap.length === 0) continue;
    return { commit: commit.sha, subject: commit.subject, matchedFiles: overlap };
  }
  return null;
}
function matchSubject(subject, task) {
  const idRe = new RegExp(`(?:^|[^0-9A-Za-z])(?:T${escapeRegex(task.id)}|#${escapeRegex(task.id)})(?![0-9A-Za-z])`);
  const idMatch = idRe.test(subject);
  let nameMatch = false;
  if (task.name && task.name.trim().length > 0) {
    const name = task.name.trim();
    if (name.length < 12) {
      const wordRe = new RegExp(`(?:^|\\W)${escapeRegex(name)}(?:\\W|$)`, "i");
      nameMatch = wordRe.test(subject);
    } else {
      nameMatch = subject.toLowerCase().includes(name.toLowerCase());
    }
  }
  return { idMatch, nameMatch };
}
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
async function writeAuditFile(projectRoot, result) {
  const dir = join11(projectRoot, ".pipeline", "audit-trail");
  await mkdir5(dir, { recursive: true }).catch(() => {
  });
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const path = join11(dir, `autoheal-${stamp}.json`);
  await writeFile8(path, JSON.stringify(result, null, 2) + "\n").catch(() => {
  });
}

// src/engine/task-progress.ts
import { readFile as readFile10, unlink } from "fs/promises";
import { join as join12 } from "path";
async function countResolvedTasks(projectRoot) {
  const statusPath = join12(projectRoot, ".pipeline/task-status.json");
  let raw;
  try {
    raw = await readFile10(statusPath, "utf-8");
  } catch {
    return 0;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 0;
  }
  return countFromParsed(parsed);
}
function countFromParsed(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return 0;
  const container = "tasks" in parsed ? parsed.tasks : parsed;
  const isResolved = (status) => typeof status === "string" && (status === "completed" || status === "skipped");
  if (Array.isArray(container)) {
    return container.filter(
      (t) => typeof t === "object" && t !== null && isResolved(t.status)
    ).length;
  }
  if (container && typeof container === "object") {
    let n = 0;
    for (const v of Object.values(container)) {
      if (v && typeof v === "object" && isResolved(v.status)) n++;
    }
    return n;
  }
  return 0;
}
var HALT_MARKER_RELATIVE = ".pipeline/halt-user-input-required";
function haltMarkerPath(projectRoot) {
  return join12(projectRoot, HALT_MARKER_RELATIVE);
}
async function haltMarkerExists(projectRoot) {
  try {
    await readFile10(haltMarkerPath(projectRoot), "utf-8");
    return true;
  } catch {
    return false;
  }
}
async function clearHaltMarker(projectRoot) {
  await unlink(haltMarkerPath(projectRoot)).catch(() => {
  });
}

// src/engine/build-failure-escalation.ts
var LABEL_NAME = "needs-remediation";
var LABEL_COLOR = "B60205";
var COMMENT_MAX_LEN = 4e3;
async function escalateBuildFailure(opts) {
  const { projectRoot, failureReason, log } = opts;
  const runGit = opts.runGit ?? makeProductionGit();
  const runGh = opts.runGh ?? makeProductionGh();
  const cwd = projectRoot;
  let branch;
  try {
    const { stdout } = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
    branch = stdout.trim();
    if (!branch || branch === "HEAD") {
      log?.("[escalate] could not determine current branch (detached HEAD or empty)");
      return {};
    }
  } catch (err) {
    log?.(`[escalate] failed to derive current branch: ${err}`);
    return {};
  }
  let base = "main";
  try {
    const { stdout } = await runGit(
      ["symbolic-ref", "refs/remotes/origin/HEAD"],
      { cwd }
    );
    const ref = stdout.trim();
    const match = ref.match(/^refs\/remotes\/origin\/(.+)$/);
    if (match) {
      base = match[1];
    }
  } catch {
    log?.('[escalate] symbolic-ref unavailable, falling back to "main" as base');
  }
  let commitCount;
  try {
    const { stdout: mergeBaseOut } = await runGit(["merge-base", base, "HEAD"], { cwd });
    const mergeBase = mergeBaseOut.trim();
    if (!mergeBase) {
      log?.("[escalate] merge-base returned empty \u2014 conservative no-op");
      return {};
    }
    const { stdout: countOut } = await runGit(
      ["rev-list", "--count", `${mergeBase}..HEAD`],
      { cwd }
    );
    const parsed = parseInt(countOut.trim(), 10);
    if (isNaN(parsed)) {
      log?.("[escalate] could not parse commit count \u2014 conservative no-op");
      return {};
    }
    commitCount = parsed;
  } catch (err) {
    log?.(`[escalate] error computing commit count: ${err} \u2014 conservative no-op`);
    return {};
  }
  if (commitCount === 0) {
    log?.("[escalate] zero commits on branch \u2014 no GitHub artifacts created (FR-6)");
    return {};
  }
  try {
    await runGit(["push", "-u", "origin", branch], { cwd });
  } catch (err) {
    log?.(`[escalate] push failed \u2014 skipping PR creation: ${err}`);
    return {};
  }
  const { prUrl } = await findOrCreatePr(
    runGh,
    cwd,
    {
      branch,
      base,
      draft: true,
      title: `needs-remediation: ${branch} \u2014 manual remediation required`,
      body: [
        "This PR was opened automatically after an irrecoverable daemon HALT.",
        "",
        "Manual remediation is required to unblock this feature.",
        "See the comment below for the failure reason."
      ].join("\n")
    },
    log
  );
  if (!prUrl) {
    log?.("[escalate] could not find or create PR \u2014 skipping label and comment");
    return {};
  }
  await ensureLabel(runGh, cwd, LABEL_NAME, LABEL_COLOR, log);
  await addLabel(runGh, cwd, prUrl, LABEL_NAME, log);
  const truncatedReason = failureReason.length > COMMENT_MAX_LEN ? failureReason.slice(0, COMMENT_MAX_LEN) + "\n\u2026(truncated)" : failureReason;
  const commentBody = [
    "## Daemon halt",
    "",
    truncatedReason,
    "",
    "Manual remediation is required."
  ].join("\n");
  await upsertComment(runGh, cwd, prUrl, NEEDS_REMEDIATION_MARKER, commentBody, log);
  return { prUrl };
}

// src/engine/engineer/intake-marker.ts
import { writeFile as writeFile9, mkdir as mkdir6, readFile as readFile11 } from "fs/promises";
import { join as join13 } from "path";

// src/engine/engineer/authoring-guard.ts
import { normalize, isAbsolute as isAbsolute2 } from "path";
var PathEscapeError = class extends Error {
  constructor(writePath, canonicalPath) {
    super(
      `PathEscapeError: write path "${writePath}" escapes the target repo boundary "${canonicalPath}". All writes must be descendants of the canonical target path.`
    );
    this.name = "PathEscapeError";
  }
};
var AuthoringGuard = class {
  /** Canonical prefix — every allowed write must start with this + separator. */
  prefix;
  /**
   * @param canonicalPath - The realpath-resolved absolute path to the target
   *   repo root. Must be an absolute path (no trailing slash normalisation is
   *   assumed by the caller — this constructor normalises internally).
   */
  constructor(canonicalPath) {
    const normalised = normalize(canonicalPath);
    this.prefix = normalised.length > 1 ? normalised.replace(/\/+$/, "") : normalised;
  }
  /**
   * Assert that `writePath` is a descendant of (or equal to) the canonical
   * target prefix. Throws {@link PathEscapeError} if the path escapes.
   *
   * The check is purely string-based (no filesystem calls), so it is
   * synchronous and safe to call before any I/O.
   *
   * @param writePath - The absolute path about to be written.
   * @throws {PathEscapeError} When `writePath` escapes the prefix.
   */
  assertWriteAllowed(writePath) {
    if (!writePath || !isAbsolute2(writePath)) {
      throw new PathEscapeError(writePath, this.prefix);
    }
    const normalised = normalize(writePath);
    const sep = "/";
    if (normalised !== this.prefix && !normalised.startsWith(this.prefix + sep)) {
      throw new PathEscapeError(writePath, this.prefix);
    }
  }
};

// src/engine/engineer/intake-marker.ts
async function writeIntakeMarker(repoPath, slug, sourceRef, ownerIdentity, guard = new AuthoringGuard(repoPath)) {
  const hasSourceRef = parseSourceRef(sourceRef) !== null;
  const owner = ownerIdentity == null ? "" : ownerIdentity.trim();
  const hasOwner = owner !== "";
  if (!hasSourceRef && !hasOwner) return null;
  const intakeDir = join13(repoPath, ".docs", "intake");
  const markerFile = join13(intakeDir, `${slug}.md`);
  guard.assertWriteAllowed(intakeDir);
  guard.assertWriteAllowed(markerFile);
  const lines = [`# Intake origin: ${slug}`, ""];
  let existingSourceRef = null;
  try {
    const existing = await readFile11(markerFile, "utf-8");
    const sourceRefMatch = existing.match(/^Source-Ref: (.+)$/m);
    if (sourceRefMatch) {
      existingSourceRef = sourceRefMatch[1];
    }
  } catch {
  }
  const finalSourceRef = hasSourceRef ? sourceRef : existingSourceRef;
  if (finalSourceRef) {
    lines.push(`Source-Ref: ${finalSourceRef}`);
  }
  if (hasOwner) lines.push(`Owner: ${owner}`);
  const body = `${lines.join("\n")}
`;
  await mkdir6(intakeDir, { recursive: true });
  await writeFile9(markerFile, body, "utf8");
  return markerFile;
}

// src/engine/conductor.ts
var MAX_RECOVERY_RETRIES = 2;
function deriveGateTopology(steps) {
  const verdictSteps = /* @__PURE__ */ new Set();
  const kickbackTargets = [];
  let firstLoopIndex = steps.length;
  steps.forEach((s, i) => {
    if (s.loopGate) {
      verdictSteps.add(s.name);
      if (i < firstLoopIndex) firstLoopIndex = i;
    }
    if (s.kickbackTarget) {
      verdictSteps.add(s.name);
      kickbackTargets.push(s.name);
    }
  });
  const regionStart = kickbackTargets[0] ?? steps.find((s) => s.phase === "DECIDE")?.name ?? steps[0]?.name;
  return { verdictSteps, kickbackTargets, firstLoopIndex, regionStart };
}
var MAX_KICKBACKS_PER_GATE = 2;
var MAX_GATE_SELECTIONS = 6;
var DONE_MARKER = ".pipeline/DONE";
var LOOP_HALT_MARKER = HALT_MARKER2;
function navigateBack(state, target, steps = ALL_STEPS) {
  const allStepNames = steps.map((s) => s.name);
  const updated = markDownstreamStale(state, target, allStepNames);
  updated[target] = "pending";
  const index = steps.findIndex((s) => s.name === target);
  return { state: updated, index };
}
function getNavigableSteps(state, steps = ALL_STEPS) {
  return steps.filter((step) => {
    const status = state[step.name];
    return status === "done" || status === "stale";
  }).map((step) => ({
    name: step.name,
    label: step.label,
    status: state[step.name],
    phase: step.phase
  }));
}
async function snapshotArtifactMtimes(projectRoot, step) {
  const snapshot = /* @__PURE__ */ new Map();
  const files = await findArtifactFiles(projectRoot, step);
  for (const file of files) {
    try {
      const s = await stat4(file);
      snapshot.set(file, s.mtimeMs);
    } catch {
    }
  }
  return snapshot;
}
async function selectChangedArtifacts(files, snapshot) {
  if (snapshot === null) return files;
  const changed = [];
  for (const file of files) {
    const before = snapshot.get(file);
    if (before === void 0) {
      changed.push(file);
      continue;
    }
    try {
      const s = await stat4(file);
      if (s.mtimeMs !== before) changed.push(file);
    } catch {
    }
  }
  return changed;
}
function stepHasCompletionCheck(step) {
  if (CUSTOM_COMPLETION_PREDICATES[step]) return true;
  return (STEP_ARTIFACT_GLOBS[step] ?? []).length > 0;
}
function parseNameStatus(stdout) {
  const out = [];
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;
    const parts = line.split("	");
    const status = parts[0];
    if (status.startsWith("R") || status.startsWith("C")) {
      if (parts.length < 3) continue;
      out.push({ status, origPath: parts[1], path: parts[2] });
    } else {
      if (parts.length < 2 || parts[1] === "") continue;
      out.push({ status, path: parts[1] });
    }
  }
  return out;
}
var Conductor = class {
  stateFilePath;
  stepRunner;
  events;
  resume;
  fromStep;
  mode;
  config;
  projectRoot;
  featureDesc;
  onCheckpoint;
  onNavigate;
  verifyArtifacts;
  freshContextPerStep;
  daemon;
  selfHost;
  baseBranch;
  guardrails;
  /**
   * The self-build's throwaway CLAUDE_CONFIG_DIR sandbox, provisioned lazily on
   * the first `build` dispatch and torn down (idempotently) in `run()`'s finally.
   */
  activeSandbox = null;
  /** Guards the one-time skill relink so it runs before the first build only. */
  relinkDone = false;
  sleep;
  onReviewArtifacts;
  onRecovery;
  onComplexityAssessment;
  /** Escalation function — see ConductorOptions.escalateBuildFailure. */
  escalateBuildFailure;
  /** gh CLI runner for owner identity resolution (plan-step stamping, Slice B D4). */
  gh;
  /**
   * The most recent engine-native rebase outcome. The `rebase` step is special:
   * its gate verdict is computed by the native handler (not from a file
   * artifact), so `advanceTail` must NOT recompute/overwrite it. A
   * `conflict_halt` outcome here drives the loop to HALT.
   */
  lastRebaseOutcome = null;
  constructor(opts) {
    this.stateFilePath = opts.stateFilePath;
    this.stepRunner = opts.stepRunner;
    this.events = opts.events;
    this.resume = opts.resume ?? false;
    this.fromStep = opts.fromStep;
    this.mode = opts.mode ?? "default";
    this.config = opts.config ?? {};
    if (!opts.projectRoot) throw new Error("Conductor requires an explicit projectRoot \u2014 refusing to default to process.cwd()");
    this.projectRoot = opts.projectRoot;
    this.featureDesc = opts.featureDesc;
    this.verifyArtifacts = opts.verifyArtifacts ?? false;
    this.freshContextPerStep = opts.freshContextPerStep ?? false;
    this.daemon = opts.daemon ?? false;
    this.selfHost = opts.selfHost ?? false;
    this.baseBranch = opts.baseBranch;
    this.guardrails = opts.selfHostGuardrails ?? defaultSelfHostGuardrails;
    if (opts.maxRetries !== void 0) {
      this.config = {
        ...this.config,
        defaults: { ...this.config.defaults ?? {}, max_retries: opts.maxRetries }
      };
    }
    this.sleep = opts.sleepFn ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.onCheckpoint = opts.onCheckpoint ?? (async () => "continue");
    this.onNavigate = opts.onNavigate ?? (async () => null);
    this.onReviewArtifacts = opts.onReviewArtifacts ?? (async () => "approved");
    this.onRecovery = opts.onRecovery;
    this.onComplexityAssessment = opts.onComplexityAssessment;
    this.escalateBuildFailure = opts.escalateBuildFailure ?? escalateBuildFailure;
    this.gh = opts.gh ?? makeProductionGh();
  }
  /**
   * Best-effort wrapper around escalateBuildFailure. Returns the prUrl on
   * success, or undefined on any error or when mode is not 'auto'. Called at
   * every irrecoverable daemon HALT (except rebase-conflict HALTs where pushing
   * mid-rebase is unsafe). Never throws — a failing escalation must never
   * affect the HALT/return path (C1).
   */
  async surfaceRemediationPr(reason) {
    if (!this.daemon) return void 0;
    try {
      const r = await this.escalateBuildFailure({
        projectRoot: this.projectRoot,
        failureReason: reason
      });
      return r?.prUrl;
    } catch {
      return void 0;
    }
  }
  /**
   * Pre-flight credential expiry check (TR-2). Called before sandbox provisioning
   * for self-host builds. If operator credentials are expired:
   * - If auth_park_timeout_minutes <= 0: HALT immediately with credentials-specific reason
   * - If > 0: Park and poll until credentials are refreshed or timeout elapses
   * If credentials state is unknown (missing/malformed): fail-open, proceed normally.
   * Returns a StepRunResult with success=false + a HALT reason if timeout occurs or
   * opt-out is configured; otherwise returns undefined (caller proceeds normally).
   */
  async preflightCredentialsCheck(operatorConfigDir) {
    const sh = resolveSelfHostConfig(this.config);
    const now = Date.now();
    const credState = await readOperatorCredentialsState(operatorConfigDir, now);
    if (credState === "unknown") {
      return void 0;
    }
    if (credState === "fresh") {
      return void 0;
    }
    const credPath = join14(operatorConfigDir, ".credentials.json");
    if (sh.authParkTimeoutMinutes <= 0) {
      let expiresAtStr = "";
      try {
        const contents = await readFile12(credPath, "utf-8");
        const creds = JSON.parse(contents);
        if (creds.claudeAiOauth?.expiresAt !== void 0) {
          expiresAtStr = String(creds.claudeAiOauth.expiresAt);
        }
      } catch {
      }
      const haltReason = `Operator OAuth token is expired.

Credentials file: ${credPath}
Expires at: ${expiresAtStr}

Please refresh your credentials by running:

  export CLAUDE_CONFIG_DIR=~/.claude && claude auth`;
      const haltPath = join14(this.projectRoot, HALT_MARKER2);
      const haltExists = await accessFile(haltPath).then(() => true).catch(() => false);
      if (!haltExists) {
        await writeFile10(haltPath, haltReason + "\n", "utf-8").catch(() => {
        });
      }
      return {
        success: false,
        output: haltReason
      };
    }
    const timeoutMs = sh.authParkTimeoutMinutes * 60 * 1e3;
    while (true) {
      const result = await waitForCredentialsChange({
        initialState: credState,
        credentialsPath: credPath,
        globalConfigDir: operatorConfigDir,
        timeoutMs,
        sleep: this.sleep,
        now: () => Date.now()
      });
      if (result.type === "refreshed") {
        return void 0;
      }
      const expiresAtStr = result.expiresAt ?? "unparseable";
      const haltReason = `Operator credentials expired and refresh timed out after ${sh.authParkTimeoutMinutes} minutes.
Credentials file: ${result.credentialsPath}
Expires at: ${expiresAtStr}
Please refresh your OAuth token and re-queue this feature.`;
      const haltPath = join14(this.projectRoot, HALT_MARKER2);
      const haltExists = await accessFile(haltPath).then(() => true).catch(() => false);
      if (!haltExists) {
        await writeFile10(haltPath, haltReason + "\n", "utf-8").catch(() => {
        });
      }
      return { success: false, output: haltReason };
    }
  }
  /**
   * Dispatch the /remediate planner over a blocking SHIP gate and translate its
   * structured plan into a loop decision. One planner serves every gate — only
   * the dispatch context and the hint's gap-artifact pointer differ. Mixed
   * plans route the autonomous fixes first (the human gaps re-surface on the
   * next gate pass and halt then). A missing/stale/unusable plan is `none` —
   * the caller falls through to its deterministic fallback or the generic HALT.
   */
  async planRemediation(state, steps, dispatchContext, hintSource) {
    await this.stepRunner.run("remediate", state, { retryReason: dispatchContext });
    const plan = await readRemediationPlan(this.projectRoot, state.session_started_at);
    if (!plan) return { kind: "none" };
    const fixes = plan.gaps.filter((g) => g.disposition !== "halt");
    const halts = plan.gaps.filter((g) => g.disposition === "halt");
    if (fixes.length > 0) {
      return {
        kind: "route",
        target: earliestRemediationTarget(fixes, steps),
        hint: buildRemediationHint(fixes, hintSource.source, hintSource.evidenceFile),
        evidence: fixes.map((g) => `${g.id}\u2192${g.disposition}`).join("; ")
      };
    }
    if (halts.length > 0) {
      return {
        kind: "halt",
        detail: halts.map((g) => `${g.id} (${g.category}: ${g.rationale})`).join("; ")
      };
    }
    return { kind: "none" };
  }
  /** True when a `.pipeline/` terminal marker (DONE / HALT) exists on disk. */
  async markerExists(relPath) {
    try {
      await accessFile(join14(this.projectRoot, relPath));
      return true;
    } catch {
      return false;
    }
  }
  /**
   * True only for a harness SELF-BUILD: the autonomous builder (`daemon`) is
   * building the harness repo itself (`selfHost`). This single decision gates the
   * whole guardrail bundle — for any other repo, or any non-daemon run, it is
   * false and the build path is byte-for-byte unchanged (TR-13).
   */
  isSelfBuild() {
    return this.daemon && this.selfHost;
  }
  /** Read a file's text, or null when it does not exist (gate readText seam). */
  readTextOrNull(path) {
    return readFile12(path, "utf-8").then(
      (t) => t,
      () => null
    );
  }
  /**
   * Dispatch the `build` step for a self-build under the guardrail bundle:
   *   1. relink harness skills ONCE before the first build (TR-4) — a failure
   *      throws InstallStaleError, which aborts the run before any child build;
   *   2. provision a throwaway CLAUDE_CONFIG_DIR sandbox ONCE (TR-5/6) — a
   *      provisioning failure throws SandboxProvisionError, aborting before build;
   *   3. scope `process.env.CLAUDE_CONFIG_DIR` to the sandbox for EXACTLY this
   *      child dispatch and restore it afterwards on BOTH the pass and throw
   *      branches, so no env bleeds into later steps (e.g. finish).
   * The sandbox is torn down in `run()`'s finally. Every throw propagates to
   * `run()`'s catch, which writes `.pipeline/HALT` — the build never runs against
   * a half-provisioned sandbox or stale skill links.
   */
  async runSelfBuildDispatch(name, state, retryHint) {
    const sh = resolveSelfHostConfig(this.config);
    if (sh.skillRelinkPreflight && !this.relinkDone) {
      this.relinkDone = true;
      await this.guardrails.relink({ log: (m) => console.error(m) });
    }
    if (!sh.sandboxBuildEnv) {
      return this.stepRunner.run(name, state, { retryReason: retryHint });
    }
    const operatorConfigDir = process.env.CLAUDE_CONFIG_DIR ?? join14(homedir3(), ".claude");
    const preflight = await this.preflightCredentialsCheck(operatorConfigDir);
    if (preflight !== void 0) {
      return preflight;
    }
    if (!this.activeSandbox) {
      const harnessRoot = await this.guardrails.resolveHarnessRoot() ?? this.projectRoot;
      this.activeSandbox = await this.guardrails.provisionSandbox({
        worktreeRoot: this.projectRoot,
        harnessRoot
      });
    }
    const hadKey = "CLAUDE_CONFIG_DIR" in process.env;
    const prior = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = this.activeSandbox.configDir;
    try {
      return await this.stepRunner.run(name, state, { retryReason: retryHint });
    } finally {
      if (hadKey) process.env.CLAUDE_CONFIG_DIR = prior;
      else delete process.env.CLAUDE_CONFIG_DIR;
    }
  }
  /**
   * The self-host finish gates (TR-7/8/9/10), run BEFORE the `finish` step is
   * dispatched because the auto-mode finish prompt opens the PR itself — a gate
   * that fires after finish would be too late. On the first failure the gate
   * primitive has already written `.pipeline/HALT`; this returns the verdict so
   * the caller parks the feature without dispatching finish (no PR). Reads the
   * VERSION/CHANGELOG/integrity artifacts of the build worktree (`projectRoot`),
   * which IS the harness being shipped.
   */
  async runSelfHostFinishGates() {
    const sh = resolveSelfHostConfig(this.config);
    if (sh.versionApprovalGate) {
      const verdict = await this.guardrails.versionGate({
        projectRoot: this.projectRoot,
        harnessRoot: this.projectRoot,
        readText: (p) => this.readTextOrNull(p),
        versionFreeze: sh.versionFreeze
      });
      if (!verdict.ok) return verdict;
    }
    if (sh.releaseArtifactGate) {
      const verdict = await this.guardrails.releaseGate({
        projectRoot: this.projectRoot,
        harnessRoot: this.projectRoot,
        readText: (p) => this.readTextOrNull(p),
        changedFiles: () => this.selfBuildChangedFiles()
      });
      if (!verdict.ok) return verdict;
    }
    return { ok: true };
  }
  /**
   * The self-build's changed files as `git diff --name-status <base>...HEAD`,
   * parsed for the migration-block classifier. Returns null (→ fail-closed:
   * require a migration block) when the base branch is unknown or git fails, so
   * an undeterminable change set never silently skips the gate.
   */
  async selfBuildChangedFiles() {
    if (!this.baseBranch) return null;
    const git2 = makeGitRunner(this.projectRoot);
    const r = await git2(["diff", "--name-status", `${this.baseBranch}...HEAD`]);
    if (r.exitCode !== 0) return null;
    return parseNameStatus(r.stdout);
  }
  async run() {
    const stateResult = await readState(this.stateFilePath);
    let state = stateResult.ok ? stateResult.value : {};
    const sessionStartedAt = Date.now();
    state.session_started_at = sessionStartedAt;
    if (!state.run_started_at) state.run_started_at = sessionStartedAt;
    await writeState(this.stateFilePath, state);
    await unlinkFile(join14(this.projectRoot, ".pipeline/finish-choice")).catch(() => {
    });
    const steps = buildStepRegistry(this.config);
    const indexOf = (name) => steps.findIndex((s) => s.name === name);
    let startIndex = 0;
    if (this.fromStep) {
      startIndex = indexOf(this.fromStep);
    } else if (this.resume) {
      startIndex = this.findResumeIndex(state, steps);
    }
    const sigintHandler = async () => {
      await writeState(this.stateFilePath, state);
      process.exit(130);
    };
    process.on("SIGINT", sigintHandler);
    const recoveryRetries = /* @__PURE__ */ new Map();
    const autoHealAttempted = /* @__PURE__ */ new Set();
    const kickbackCounts = /* @__PURE__ */ new Map();
    const stuckGate = /* @__PURE__ */ new Map();
    let prdAuditSelfHeals = 0;
    let remediationRounds = 0;
    const pendingRetryHints = /* @__PURE__ */ new Map();
    try {
      for (let i = startIndex; i < steps.length; i++) {
        const step = steps[i];
        const currentStatus = state[step.name];
        const alreadyResolved = currentStatus === "done" || currentStatus === "skipped";
        const explicitlyTargeted = this.fromStep === step.name;
        if (alreadyResolved && !explicitlyTargeted) {
          continue;
        }
        const tier = state.complexity_tier ?? "L";
        if (step.skippableForTiers.includes(tier)) {
          await saveStepStatus(this.stateFilePath, step.name, "skipped");
          state[step.name] = "skipped";
          await this.events.emit({ type: "tier_skip", step: step.name, tier });
          continue;
        }
        if (step.skippableForTracks && step.skippableForTracks.length > 0) {
          const track = await this.resolveTrack(state);
          if (step.skippableForTracks.includes(track)) {
            await saveStepStatus(this.stateFilePath, step.name, "skipped");
            state[step.name] = "skipped";
            await this.events.emit({ type: "config_skip", step: step.name });
            continue;
          }
        }
        if (this.daemon && step.name === "retro") {
          await saveStepStatus(this.stateFilePath, step.name, "skipped");
          state[step.name] = "skipped";
          await this.events.emit({ type: "config_skip", step: step.name });
          continue;
        }
        if (shouldSkipForBootstrapMode(step.name, state.bootstrap_mode)) {
          await saveStepStatus(this.stateFilePath, step.name, "skipped");
          state[step.name] = "skipped";
          await this.events.emit({
            type: "mode_skip",
            step: step.name,
            mode: state.bootstrap_mode,
            reason: `bootstrap mode '${state.bootstrap_mode}' \u2014 no codebase to act on`
          });
          continue;
        }
        if (shouldSkipForUpstreamSkip(step, state)) {
          await saveStepStatus(this.stateFilePath, step.name, "skipped");
          state[step.name] = "skipped";
          await this.events.emit({ type: "config_skip", step: step.name });
          continue;
        }
        const resolved = resolveStepConfig(step.name, step.phase, this.config, {
          tier: state.complexity_tier
        });
        if (resolved.disabled) {
          await saveStepStatus(this.stateFilePath, step.name, "skipped");
          state[step.name] = "skipped";
          await this.events.emit({ type: "config_skip", step: step.name });
          continue;
        }
        const stepCfg = this.config?.steps?.[step.name];
        if (stepCfg?.when) {
          const whenResult = evaluateWhen(stepCfg.when, state);
          if (!whenResult.result) {
            await saveStepStatus(this.stateFilePath, step.name, "skipped");
            state[step.name] = "skipped";
            await this.events.emit({
              type: "when_skip",
              step: step.name,
              expression: stepCfg.when,
              undefinedKey: whenResult.undefinedKey
            });
            if (stepCfg.parallel) {
              for (const branch of stepCfg.parallel) {
                const syntheticKey = `${step.name}__${branch.name}`;
                state[syntheticKey] = "skipped";
              }
              await writeState(this.stateFilePath, state);
            }
            continue;
          }
        }
        if (stepCfg?.parallel) {
          await this.runParallelGroup(step.name, stepCfg.parallel, state);
          if (state[step.name] === "failed") {
            await this.events.emit({
              type: "step_failed",
              step: step.name,
              error: `Parallel group "${step.name}" had a gating branch failure`,
              retryCount: 0
            });
            await writeState(this.stateFilePath, state);
            process.off("SIGINT", sigintHandler);
            return;
          }
          continue;
        }
        const gate = checkGate(step, state);
        if (!gate.passed) {
          await this.events.emit({ type: "gate_blocked", step: step.name, reason: gate.reason });
          await writeState(this.stateFilePath, state);
          process.off("SIGINT", sigintHandler);
          return;
        }
        if (this.isSelfBuild() && step.name === "finish") {
          const verdict = await this.runSelfHostFinishGates();
          if (!verdict.ok) {
            state[step.name] = "stale";
            await writeState(this.stateFilePath, state);
            await this.events.emit({ type: "loop_halt", reason: verdict.reason });
            process.off("SIGINT", sigintHandler);
            return;
          }
        }
        await saveStepStatus(this.stateFilePath, step.name, "in_progress");
        state[step.name] = "in_progress";
        await this.events.emit({ type: "step_started", step: step.name, index: i });
        if (currentStatus === "failed" || currentStatus === "stale") {
          await sweepStaleReviewArtifacts(
            this.projectRoot,
            step.name,
            state.session_started_at
          );
        }
        if (this.freshContextPerStep && this.stepRunner.resetSession) {
          await this.stepRunner.resetSession();
        }
        let attempt = 0;
        let lastError = "";
        let succeeded = false;
        let retryHint = pendingRetryHints.get(step.name);
        pendingRetryHints.delete(step.name);
        let successOutput;
        const planSnapshot = step.name === "plan" ? await snapshotArtifactMtimes(this.projectRoot, "plan") : null;
        const stepMaxRetries = resolved.max_retries;
        let resolvedTasksBefore = step.name === "build" ? await countResolvedTasks(this.projectRoot) : 0;
        while (attempt < stepMaxRetries) {
          attempt++;
          const result = step.name === "complexity" ? await this.runComplexityStep(state) : step.name === "worktree" ? await this.runWorktreeStep(state) : step.name === "rebase" ? await this.runRebaseStep(state) : this.isSelfBuild() && step.name === "build" ? await this.runSelfBuildDispatch(step.name, state, retryHint) : await this.stepRunner.run(step.name, state, { retryReason: retryHint });
          if (result.rateLimited) {
            const waitSeconds = result.waitSeconds ?? 300;
            await this.events.emit({ type: "rate_limit", waitSeconds });
            await this.sleep(waitSeconds * 1e3);
            attempt--;
            continue;
          }
          if (result.sessionExpired) {
            await this.events.emit({
              type: "session_reset",
              reason: "session unavailable (expired or in use) \u2014 resetting to a fresh session"
            });
            if (this.stepRunner.resetSession) {
              await this.stepRunner.resetSession();
            }
            attempt--;
            continue;
          }
          if (result.authFailure) {
            const operatorConfigDir = process.env.CLAUDE_CONFIG_DIR ?? join14(homedir3(), ".claude");
            const credPath = join14(operatorConfigDir, ".credentials.json");
            const credState = await readOperatorCredentialsState(
              operatorConfigDir,
              Date.now()
            );
            await this.events.emit({
              type: "credentials_park",
              reason: "operator OAuth token expired or invalid \u2014 waiting for refresh"
            });
            const shPark = resolveSelfHostConfig(this.config);
            const parkResult = await waitForCredentialsChange({
              initialState: credState,
              credentialsPath: credPath,
              globalConfigDir: operatorConfigDir,
              timeoutMs: shPark.authParkTimeoutMinutes * 60 * 1e3,
              sleep: this.sleep,
              now: () => Date.now()
            });
            if (parkResult.type === "refreshed" && this.activeSandbox) {
              await refreshSandboxCredentials(operatorConfigDir, this.activeSandbox.configDir);
            }
            if (parkResult.type === "timeout") {
              const expiresAtStr = parkResult.expiresAt ?? "unparseable";
              const credReason = `Operator credentials expired and refresh timed out.
Credentials file: ${parkResult.credentialsPath}
Expires at: ${expiresAtStr}
Please refresh your OAuth token and re-queue this feature.`;
              await mkdir7(join14(this.projectRoot, ".pipeline"), { recursive: true }).catch(
                () => {
                }
              );
              await writeFile10(
                join14(this.projectRoot, LOOP_HALT_MARKER),
                credReason + "\n",
                "utf-8"
              ).catch(() => {
              });
              await writeState(this.stateFilePath, state);
              const prUrl = await this.surfaceRemediationPr(credReason);
              await this.events.emit({ type: "loop_halt", reason: credReason, prUrl });
              process.off("SIGINT", sigintHandler);
              return;
            }
            attempt--;
            continue;
          }
          if (!result.success) {
            lastError = result.output ?? `Step '${step.name}' session ended with error`;
            retryHint = `Previous attempt failed: ${lastError}. Finish the work now.`;
            if (this.isSelfBuild() && step.name === "build") {
              const haltPath = join14(this.projectRoot, HALT_MARKER2);
              const haltExists = await accessFile(haltPath).then(() => true).catch(() => false);
              if (haltExists) {
                break;
              }
            }
            if (attempt < stepMaxRetries) {
              await this.events.emit({
                type: "step_retry",
                step: step.name,
                attempt: attempt + 1,
                maxAttempts: stepMaxRetries,
                reason: lastError
              });
              continue;
            }
            break;
          }
          if (this.verifyArtifacts && stepHasCompletionCheck(step.name) && step.name !== "complexity") {
            let completion = await checkStepCompletion(this.projectRoot, step.name, {
              sessionStartedAt: state.session_started_at,
              featureDesc: state.feature_desc,
              config: this.config
            });
            if (!completion.done && step.name === "build" && !autoHealAttempted.has("build")) {
              autoHealAttempted.add("build");
              const heal = await attemptAutoHeal(this.projectRoot).catch(() => ({
                healed: [],
                skipped: []
              }));
              await this.events.emit({
                type: "auto_heal",
                step: "build",
                healed: heal.healed.length,
                skipped: heal.skipped.length
              });
              if (heal.healed.length > 0) {
                completion = await checkStepCompletion(this.projectRoot, step.name, {
                  sessionStartedAt: state.session_started_at,
                  featureDesc: state.feature_desc,
                  config: this.config
                });
              }
            }
            if (!completion.done) {
              lastError = `Step '${step.name}' completed but completion check failed: ${completion.reason ?? "unknown"}`;
              retryHint = buildRetryHint(step.name, completion.reason);
              if (this.daemon && step.name === "prd_audit") {
                const cls = await classifyPrdAuditGaps(
                  this.projectRoot,
                  state.session_started_at
                );
                if (cls.kind !== "clean") break;
              }
              let stalled = null;
              if (step.name === "build") {
                const resolvedTasksAfter = await countResolvedTasks(this.projectRoot);
                const markerSet = await haltMarkerExists(this.projectRoot);
                if (markerSet) {
                  stalled = "halt_marker";
                } else if (attempt >= 2 && resolvedTasksAfter <= resolvedTasksBefore) {
                  stalled = "no_task_progress";
                }
                if (stalled) {
                  await this.events.emit({
                    type: "build_stall",
                    step: step.name,
                    reason: stalled,
                    resolvedBefore: resolvedTasksBefore,
                    resolvedAfter: resolvedTasksAfter
                  });
                  await clearHaltMarker(this.projectRoot);
                  if (this.mode !== "auto" && this.stepRunner.runInteractive) {
                    await this.stepRunner.runInteractive(step.name);
                  }
                  const recheck = await checkStepCompletion(this.projectRoot, step.name, {
                    sessionStartedAt: state.session_started_at,
                    featureDesc: state.feature_desc,
                    config: this.config
                  });
                  if (recheck.done) {
                    succeeded = true;
                    successOutput = result.output;
                  }
                  break;
                }
                resolvedTasksBefore = resolvedTasksAfter;
              }
              if (attempt < stepMaxRetries) {
                await this.events.emit({
                  type: "step_retry",
                  step: step.name,
                  attempt: attempt + 1,
                  maxAttempts: stepMaxRetries,
                  reason: completion.reason ?? "completion check failed"
                });
                continue;
              }
              break;
            }
          }
          succeeded = true;
          successOutput = result.output;
          break;
        }
        if (!succeeded) {
          await saveStepStatus(this.stateFilePath, step.name, "failed");
          state[step.name] = "failed";
          await this.events.emit({
            type: "step_failed",
            step: step.name,
            error: lastError,
            retryCount: attempt
          });
          if (this.mode === "auto") {
            if (step.enforcement === "advisory") {
              await saveStepStatus(this.stateFilePath, step.name, "skipped");
              state[step.name] = "skipped";
              continue;
            }
            if (this.daemon && step.name === "prd_audit") {
              if (remediationRounds < MAX_KICKBACKS_PER_GATE) {
                const outcome = await this.planRemediation(
                  state,
                  steps,
                  "A blocking prd-audit is at .pipeline/prd-audit.md (an as-built review may be at .pipeline/architecture-review-as-built.md). Plan remediation per the /remediate skill and write .pipeline/remediation.json.",
                  { source: "prd-audit", evidenceFile: ".pipeline/prd-audit.md" }
                );
                if (outcome.kind === "route") {
                  remediationRounds++;
                  await this.events.emit({
                    type: "kickback",
                    from: "prd_audit",
                    to: outcome.target,
                    evidence: outcome.evidence,
                    count: remediationRounds
                  });
                  pendingRetryHints.set(outcome.target, outcome.hint);
                  const nav = navigateBack(state, outcome.target, steps);
                  state = nav.state;
                  state.prd_audit = "stale";
                  await writeState(this.stateFilePath, state);
                  i = nav.index - 1;
                  continue;
                }
                if (outcome.kind === "halt") {
                  const reason3 = "prd-audit halted: needs human DECIDE \u2014 " + outcome.detail;
                  await mkdir7(join14(this.projectRoot, ".pipeline"), {
                    recursive: true
                  }).catch(() => {
                  });
                  await writeFile10(
                    join14(this.projectRoot, LOOP_HALT_MARKER),
                    reason3 + "\n",
                    "utf-8"
                  ).catch(() => {
                  });
                  await writeState(this.stateFilePath, state);
                  const prUrl3 = await this.surfaceRemediationPr(reason3);
                  await this.events.emit({ type: "loop_halt", reason: reason3, prUrl: prUrl3 });
                  process.off("SIGINT", sigintHandler);
                  return;
                }
              }
              const cls = await classifyPrdAuditGaps(
                this.projectRoot,
                state.session_started_at
              );
              if (cls.kind === "impl-only" && prdAuditSelfHeals < MAX_KICKBACKS_PER_GATE) {
                prdAuditSelfHeals++;
                await this.events.emit({
                  type: "kickback",
                  from: "prd_audit",
                  to: "build",
                  evidence: cls.summary,
                  count: prdAuditSelfHeals
                });
                pendingRetryHints.set(
                  "build",
                  `prd-audit BLOCKED on un-ALIGNED FRs: ${cls.summary}. The plan's task list is already complete, but these functional requirements are NOT satisfied in the shipped code. Read .pipeline/prd-audit.md for the per-FR gap-class and file:line evidence, then make the code changes needed to close each gap and commit them \u2014 do NOT rely on the task list being done. The as-built code is re-audited after this build; an unaddressed gap will re-block.`
                );
                const nav = navigateBack(state, "build", steps);
                state = nav.state;
                state.prd_audit = "stale";
                await writeState(this.stateFilePath, state);
                i = nav.index - 1;
                continue;
              }
              const reason2 = cls.kind === "impl-only" ? `prd-audit impl-gap unresolved after ${prdAuditSelfHeals} build attempt(s) (cap ${MAX_KICKBACKS_PER_GATE}): ${cls.summary}` : `prd-audit halted: product/plan gap needs human DECIDE \u2014 ${cls.summary}`;
              await mkdir7(join14(this.projectRoot, ".pipeline"), { recursive: true }).catch(
                () => {
                }
              );
              await writeFile10(
                join14(this.projectRoot, LOOP_HALT_MARKER),
                reason2 + "\n",
                "utf-8"
              ).catch(() => {
              });
              await writeState(this.stateFilePath, state);
              const prUrl2 = await this.surfaceRemediationPr(reason2);
              await this.events.emit({ type: "loop_halt", reason: reason2, prUrl: prUrl2 });
              process.off("SIGINT", sigintHandler);
              return;
            }
            if (this.daemon && (step.name === "finish" || step.name === "architecture_review_as_built") && remediationRounds < MAX_KICKBACKS_PER_GATE) {
              const finishGate = step.name === "finish";
              const outcome = await this.planRemediation(
                state,
                steps,
                finishGate ? `The finish step's fresh verification failed: ${lastError}. Failing-test evidence, when the finish skill recorded it, is at .pipeline/test-failures.md. Plan remediation per the /remediate skill and write .pipeline/remediation.json.` : "A blocking as-built architecture review is at .pipeline/architecture-review-as-built.md. Plan remediation per the /remediate skill and write .pipeline/remediation.json.",
                finishGate ? { source: "finish-verification", evidenceFile: ".pipeline/test-failures.md" } : {
                  source: "as-built architecture review",
                  evidenceFile: ".pipeline/architecture-review-as-built.md"
                }
              );
              if (outcome.kind === "route") {
                remediationRounds++;
                await this.events.emit({
                  type: "kickback",
                  from: step.name,
                  to: outcome.target,
                  evidence: outcome.evidence,
                  count: remediationRounds
                });
                pendingRetryHints.set(outcome.target, outcome.hint);
                const nav = navigateBack(state, outcome.target, steps);
                state = nav.state;
                state[step.name] = "stale";
                await writeState(this.stateFilePath, state);
                i = nav.index - 1;
                continue;
              }
              if (outcome.kind === "halt") {
                const reason2 = `${finishGate ? "finish" : "as-built architecture review"} halted: needs human DECIDE \u2014 ${outcome.detail}`;
                await mkdir7(join14(this.projectRoot, ".pipeline"), { recursive: true }).catch(
                  () => {
                  }
                );
                await writeFile10(
                  join14(this.projectRoot, LOOP_HALT_MARKER),
                  reason2 + "\n",
                  "utf-8"
                ).catch(() => {
                });
                await writeState(this.stateFilePath, state);
                const prUrl2 = await this.surfaceRemediationPr(reason2);
                await this.events.emit({ type: "loop_halt", reason: reason2, prUrl: prUrl2 });
                process.off("SIGINT", sigintHandler);
                return;
              }
            }
            const existingHalt = await readFile12(
              join14(this.projectRoot, LOOP_HALT_MARKER),
              "utf-8"
            ).catch(() => null);
            const reason = existingHalt && existingHalt.trim().length > 0 ? existingHalt.trim() : `step '${step.name}' failed in auto mode (retries exhausted)`;
            await mkdir7(join14(this.projectRoot, ".pipeline"), { recursive: true }).catch(
              () => {
              }
            );
            await writeFile10(
              join14(this.projectRoot, LOOP_HALT_MARKER),
              reason + "\n",
              "utf-8"
            ).catch(() => {
            });
            await writeState(this.stateFilePath, state);
            const prUrl = await this.surfaceRemediationPr(`${reason}
${lastError}`);
            await this.events.emit({ type: "loop_halt", reason, prUrl });
            process.off("SIGINT", sigintHandler);
            return;
          }
          if (this.onRecovery) {
            const gating = step.enforcement === "gating";
            let action;
            while (true) {
              const count = recoveryRetries.get(step.name) ?? 0;
              const retriesExhausted = count >= MAX_RECOVERY_RETRIES;
              action = await this.onRecovery(step.name, gating, {
                recoveryCount: count,
                retriesExhausted
              });
              if (action === "retry" && retriesExhausted) continue;
              break;
            }
            if (action === "retry") {
              recoveryRetries.set(step.name, (recoveryRetries.get(step.name) ?? 0) + 1);
              i--;
              continue;
            }
            if (action === "skip" && !gating) {
              await saveStepStatus(this.stateFilePath, step.name, "skipped");
              state[step.name] = "skipped";
              continue;
            }
            if (action === "back") {
              const navigable = getNavigableSteps(state, steps);
              const target = await this.onNavigate(navigable);
              if (target) {
                const nav = navigateBack(state, target, steps);
                await this.events.emit({ type: "navigation_back", from: step.name, to: target });
                state = nav.state;
                await writeState(this.stateFilePath, state);
                i = nav.index - 1;
                continue;
              }
            }
            if (action === "interactive") {
              if (this.stepRunner.runInteractive) {
                await this.stepRunner.runInteractive(step.name);
              }
              i--;
              continue;
            }
          }
          await writeState(this.stateFilePath, state);
          process.off("SIGINT", sigintHandler);
          return;
        }
        {
          if (stepHasCompletionCheck(step.name) && this.mode !== "auto") {
            const allFiles = await findArtifactFiles(this.projectRoot, step.name);
            if (allFiles.length > 0) {
              const unapproved = await filterUnapprovedArtifacts(
                allFiles,
                state.artifact_approvals ?? {},
                this.projectRoot
              );
              if (unapproved.length > 0) {
                let reviewResult = "approved";
                let shouldPrompt = false;
                if (resolved.review === "manual") {
                  shouldPrompt = true;
                } else if (resolved.review === "conditional") {
                  const markerPath = join14(
                    this.projectRoot,
                    ".pipeline",
                    `review-required-${step.name}`
                  );
                  try {
                    await accessFile(markerPath);
                    shouldPrompt = true;
                  } catch {
                  }
                }
                if (shouldPrompt) {
                  reviewResult = await this.onReviewArtifacts(step.name, unapproved);
                }
                if (reviewResult === "rejected") {
                  i--;
                  continue;
                }
                state.artifact_approvals = await recordApprovals(
                  state.artifact_approvals ?? {},
                  unapproved,
                  this.projectRoot
                );
                await writeState(this.stateFilePath, state);
                if (resolved.review === "conditional") {
                  const markerPath = join14(
                    this.projectRoot,
                    ".pipeline",
                    `review-required-${step.name}`
                  );
                  await unlinkFile(markerPath).catch(() => {
                  });
                }
              }
            }
          }
          if (step.name === "plan") {
            const planFiles = await findArtifactFiles(this.projectRoot, "plan");
            const authoredPlans = await selectChangedArtifacts(planFiles, planSnapshot);
            if (authoredPlans.length > 0) {
              const ownerConfig = await readMachineOwnerConfig();
              const ownerResolution = await resolveDaemonOwner(
                ownerConfig,
                this.gh,
                this.projectRoot
              );
              if (!ownerResolution.resolved) {
                throw new Error(
                  "Unresolved operator identity \u2014 cannot stamp owner marker. Configure spec_owner in ~/.ai-conductor/config.yml, or run `gh auth login` to authenticate with GitHub."
                );
              }
              for (const planFile of authoredPlans) {
                const stem = planStem(planFile);
                let sourceRef;
                const markerPath = join14(this.projectRoot, ".docs", "intake", `${stem}.md`);
                try {
                  const existingMarker = await readFile12(markerPath, "utf-8");
                  sourceRef = parseIntakeSourceRef(existingMarker) ?? void 0;
                } catch {
                  sourceRef = void 0;
                }
                await writeIntakeMarker(
                  this.projectRoot,
                  stem,
                  sourceRef,
                  ownerResolution.id
                );
              }
            }
          }
          if (step.name !== "complexity" && step.name !== "worktree") {
            await saveStepStatus(this.stateFilePath, step.name, "done");
          }
          state[step.name] = "done";
          const tail = successOutput ? successOutput.split("\n").slice(-200) : void 0;
          await this.events.emit({ type: "step_completed", step: step.name, status: "done", tail });
          if (step.name === "finish") {
            const current = await readState(this.stateFilePath);
            if (current.ok && current.value.pr_url) {
              state.pr_url = current.value.pr_url;
            } else if (successOutput) {
              const scraped = extractPrUrl(successOutput);
              if (scraped) {
                state.pr_url = scraped;
                await savePrUrl(this.stateFilePath, scraped);
              }
            }
          }
          if (step.isCheckpoint && this.mode !== "auto") {
            await this.events.emit({ type: "checkpoint_reached", step: step.name });
            const response = await this.onCheckpoint(step.name);
            if (response === "quit") {
              await writeState(this.stateFilePath, state);
              process.off("SIGINT", sigintHandler);
              return;
            }
            if (response === "back") {
              const navigable = getNavigableSteps(state, steps);
              const target = await this.onNavigate(navigable);
              if (target) {
                const nav = navigateBack(state, target, steps);
                await this.events.emit({ type: "navigation_back", from: step.name, to: target });
                state = nav.state;
                await writeState(this.stateFilePath, state);
                i = nav.index - 1;
                continue;
              }
            }
          }
          const advance = await this.advanceTail(
            step,
            state,
            kickbackCounts,
            stuckGate,
            steps,
            indexOf
          );
          if (advance === "halt") {
            await writeState(this.stateFilePath, state);
            process.off("SIGINT", sigintHandler);
            return;
          }
          if (advance !== null) {
            i = advance - 1;
            continue;
          }
        }
      }
      process.off("SIGINT", sigintHandler);
      await this.events.emit({
        type: "feature_complete",
        prUrl: state.pr_url,
        featureDesc: state.feature_desc,
        sessionStartedAt: state.session_started_at
      });
      state.feature_status = "complete";
      await writeState(this.stateFilePath, state);
      if (this.daemon && !await this.markerExists(DONE_MARKER)) {
        await mkdir7(join14(this.projectRoot, ".pipeline"), { recursive: true }).catch(() => {
        });
        await writeFile10(
          join14(this.projectRoot, DONE_MARKER),
          "gate-driven loop converged\n",
          "utf-8"
        ).catch(() => {
        });
      }
    } catch (err) {
      const reason = `conductor error: ${err instanceof Error ? err.message : String(err)}`;
      await writeState(this.stateFilePath, state).catch(() => {
      });
      await mkdir7(join14(this.projectRoot, ".pipeline"), { recursive: true }).catch(() => {
      });
      await writeFile10(join14(this.projectRoot, LOOP_HALT_MARKER), reason + "\n", "utf-8").catch(
        () => {
        }
      );
      const prUrl = await this.surfaceRemediationPr(reason);
      await this.events.emit({ type: "loop_halt", reason, prUrl });
    } finally {
      process.off("SIGINT", sigintHandler);
      if (this.activeSandbox) {
        await this.activeSandbox.teardown().catch(() => {
        });
        this.activeSandbox = null;
      }
      if (this.daemon && !await this.markerExists(DONE_MARKER) && !await this.markerExists(LOOP_HALT_MARKER)) {
        const reason = `loop exited without a terminal verdict (last step: ${state.last_step ?? "unknown"}) \u2014 no DONE/HALT marker was written; parking for inspection`;
        await mkdir7(join14(this.projectRoot, ".pipeline"), { recursive: true }).catch(() => {
        });
        await writeFile10(join14(this.projectRoot, LOOP_HALT_MARKER), reason + "\n", "utf-8").catch(
          () => {
          }
        );
        const prUrl = await this.surfaceRemediationPr(reason);
        await this.events.emit({ type: "loop_halt", reason, prUrl });
      }
    }
  }
  /**
   * Gate-driven tail advance (Phase 3). Called after a step succeeds to decide
   * the next index:
   *   - Front half (before `build`): returns null → caller does linear i++.
   *   - Tail (`build`…`finish`): recompute the step's objective verdict, route
   *     any kickback (a step that re-opened an upstream gate) back via
   *     navigateBack + downstream-stale cascade, then ask the selector for the
   *     next unsatisfied gate. Returns ALL_STEPS.length when the loop is done.
   *   - 'halt': a gate exceeded the kickback cap; caller writes state and stops.
   */
  async advanceTail(step, state, kickbackCounts, stuckGate, steps, indexOf) {
    if (!this.verifyArtifacts) return null;
    const topo = deriveGateTopology(steps);
    if (step.name === "rebase") {
      if (this.lastRebaseOutcome?.kind === "conflict_halt") {
        const reason = `rebase conflict \u2014 parked for human resolution: ${this.lastRebaseOutcome.reason}`;
        await this.events.emit({ type: "loop_halt", reason });
        return "halt";
      }
      if (this.lastRebaseOutcome?.kind === "changed") {
        const verdicts2 = await readAllVerdicts(this.projectRoot);
        for (const target of ["build", "manual_test"]) {
          const v = verdicts2[target];
          if (v && v.satisfied === false && v.kickback?.from === "rebase") {
            await this.events.emit({
              type: "kickback",
              from: "rebase",
              to: target,
              evidence: v.kickback.evidence,
              count: 1
            });
            const nav = navigateBack(state, target, steps);
            Object.assign(state, nav.state);
            await writeState(this.stateFilePath, state);
          }
        }
      }
    } else if (topo.verdictSteps.has(step.name)) {
      const verdict = await computeAndWriteVerdict(this.projectRoot, step.name, {
        sessionStartedAt: state.session_started_at,
        featureDesc: state.feature_desc,
        config: this.config
      });
      await this.events.emit({
        type: "gate_verdict",
        step: step.name,
        satisfied: verdict.satisfied,
        reason: verdict.reason
      });
    }
    if (indexOf(step.name) < topo.firstLoopIndex) {
      return null;
    }
    let markedSkip = false;
    const tier = state.complexity_tier ?? "L";
    const track = await this.resolveTrack(state);
    for (const s of steps) {
      if (getStepStatus(state, s.name) === "pending" && (s.skippableForTiers.includes(tier) || (s.skippableForTracks ?? []).includes(track) || shouldSkipForBootstrapMode(s.name, state.bootstrap_mode) || shouldSkipForUpstreamSkip(s, state))) {
        state[s.name] = "skipped";
        markedSkip = true;
      }
    }
    if (markedSkip) await writeState(this.stateFilePath, state);
    const verdicts = await readAllVerdicts(this.projectRoot);
    for (const target of topo.kickbackTargets) {
      const v = verdicts[target];
      if (v && v.satisfied === false && v.kickback?.from === step.name) {
        const count = (kickbackCounts.get(target) ?? 0) + 1;
        kickbackCounts.set(target, count);
        await this.events.emit({
          type: "kickback",
          from: step.name,
          to: target,
          evidence: v.kickback?.evidence,
          count
        });
        if (count > MAX_KICKBACKS_PER_GATE) {
          const reason = `kickback ping-pong: ${target} re-opened ${count} times (cap ${MAX_KICKBACKS_PER_GATE})`;
          await writeFile10(
            join14(this.projectRoot, LOOP_HALT_MARKER),
            reason + "\n",
            "utf-8"
          );
          await writeState(this.stateFilePath, state).catch(() => {
          });
          const prUrl = await this.surfaceRemediationPr(reason);
          await this.events.emit({ type: "loop_halt", reason, prUrl });
          return "halt";
        }
        const nav = navigateBack(state, target, steps);
        Object.assign(state, nav.state);
        await writeState(this.stateFilePath, state);
      }
    }
    const decision = selectNextGate({
      steps,
      state,
      verdicts,
      regionStart: topo.regionStart
    });
    if (decision.kind === "done") {
      await writeFile10(
        join14(this.projectRoot, DONE_MARKER),
        "gate-driven loop converged\n",
        "utf-8"
      ).catch(() => {
      });
      await this.events.emit({ type: "loop_converged" });
      return steps.length;
    }
    const sel = (stuckGate.get(decision.step) ?? 0) + 1;
    stuckGate.set(decision.step, sel);
    if (sel > MAX_GATE_SELECTIONS) {
      const reason = `gate '${decision.step}' selected ${sel} times without satisfying: ${decision.reason}`;
      await writeState(this.stateFilePath, state).catch(() => {
      });
      await writeFile10(join14(this.projectRoot, LOOP_HALT_MARKER), reason + "\n", "utf-8");
      const prUrl = await this.surfaceRemediationPr(reason);
      await this.events.emit({ type: "loop_halt", reason, prUrl });
      return "halt";
    }
    if (getStepStatus(state, decision.step) === "done") {
      state[decision.step] = "pending";
      await writeState(this.stateFilePath, state);
    }
    return indexOf(decision.step);
  }
  /**
   * Execute a parallel branch group via Promise.all (T15).
   *
   * Each branch is dispatched concurrently. Synthetic state keys of the form
   * `<groupName>__<branchName>` are written to conduct-state.json (T16).
   *
   * Failure semantics (T18 / T19):
   *   - advisory=false (default): branch failure → parallel_failure event →
   *     group fails → downstream blocked (T10 gate).
   *   - advisory=true: branch failure is logged (parallel_failure) but the
   *     group continues to success.
   *
   * SIGINT during a parallel group saves state and exits (T20).
   */
  async runParallelGroup(groupName, branches, state) {
    const branchNames = branches.map((b) => b.name);
    await this.events.emit({ type: "parallel_started", step: groupName, branches: branchNames });
    let groupFailed = false;
    const results = await Promise.all(
      branches.map(async (branch) => {
        const syntheticKey = `${groupName}__${branch.name}`;
        try {
          const result = await this.stepRunner.run(
            groupName,
            state,
            { retryReason: void 0 }
          );
          if (!result.success) {
            state[syntheticKey] = "failed";
            return { branch, success: false, error: result.output ?? `branch ${branch.name} failed` };
          }
          state[syntheticKey] = "done";
          return { branch, success: true, error: void 0 };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          state[syntheticKey] = "failed";
          return { branch, success: false, error: errMsg };
        }
      })
    );
    await writeState(this.stateFilePath, state);
    for (const outcome of results) {
      if (!outcome.success) {
        await this.events.emit({
          type: "parallel_failure",
          step: groupName,
          branch: outcome.branch.name,
          error: outcome.error ?? "unknown error"
        });
        if (!outcome.branch.advisory) {
          groupFailed = true;
        }
      }
    }
    if (groupFailed) {
      await saveStepStatus(this.stateFilePath, groupName, "failed");
      state[groupName] = "failed";
    } else {
      await saveStepStatus(this.stateFilePath, groupName, "done");
      state[groupName] = "done";
      await this.events.emit({
        type: "parallel_completed",
        step: groupName,
        branches: branchNames
      });
    }
  }
  /**
   * Handle the `worktree` step entirely in the engine via `WorktreeManager`
   * (deterministic `git worktree add -b`), instead of dispatching the
   * `/conduct worktree` skill to Claude. The skill path let Claude run a broad
   * self-directed orchestration (skipping `explore`, botching git so the main
   * repo ended up on the feature branch). A direct call keeps main untouched and
   * lets the per-step engine drive `explore` etc. normally.
   *
   * With no feature description (e.g. tests, or a resume without one) it records
   * the step done without creating a worktree — nothing to isolate yet.
   */
  async runWorktreeStep(state) {
    const featureDesc = this.featureDesc ?? state.feature_desc;
    if (!featureDesc) {
      state.worktree = "done";
      state.last_step = "worktree";
      await writeState(this.stateFilePath, state);
      return { success: true };
    }
    try {
      const { path, branch } = await new WorktreeManager(this.projectRoot).create(featureDesc);
      state.feature_desc = featureDesc;
      state.worktree_dir = path;
      state.worktree_branch = branch;
    } catch (err) {
      console.warn(
        `[worktree] could not create an isolated worktree (${err instanceof Error ? err.message : String(err)}); continuing in-place.`
      );
      state.feature_desc = featureDesc;
    }
    state.worktree = "done";
    state.last_step = "worktree";
    await writeState(this.stateFilePath, state);
    return { success: true };
  }
  /**
   * Handle the `rebase` step entirely in the engine (ADR-001 / Phase 9.0):
   * rebase the feature branch onto the discovered base, classify the outcome,
   * write the authoritative gate verdicts (including FR-5 kickbacks), emit the
   * structured outcome event, and — on a conflict that isn't a CHANGELOG-only
   * auto-resolve — write `.pipeline/HALT` and leave the rebase paused. The
   * outcome is stashed on `lastRebaseOutcome` so `advanceTail` doesn't recompute
   * the verdict and so a HALT routes the loop to stop.
   */
  async runRebaseStep(state) {
    if (!this.daemon) {
      const outcome2 = { kind: "noop" };
      this.lastRebaseOutcome = outcome2;
      const ranManualTest2 = getStepStatus(state, "manual_test") !== "skipped";
      await applyRebaseVerdicts(this.projectRoot, outcome2, ranManualTest2);
      await emitRebaseEvent(this.events, outcome2);
      return { success: true };
    }
    const git2 = makeGitRunner(this.projectRoot);
    const localBase = await this.discoverLocalBase(git2);
    let outcome;
    try {
      outcome = await performRebase(git2, this.projectRoot, localBase);
    } catch (err) {
      outcome = {
        kind: "conflict_halt",
        conflicts: [],
        reason: err instanceof Error ? err.message : String(err)
      };
    }
    if (outcome.kind === "conflict_halt") {
      const cap = resolveRebaseResolutionAttempts(this.config);
      if (cap > 0 && this.stepRunner.resolveRebaseConflict) {
        let attempt = 0;
        const resolver = async (ctx) => {
          attempt += 1;
          try {
            await this.events.emit({ type: "rebase_resolution_attempt", index: attempt, cap });
          } catch {
          }
          try {
            return await this.stepRunner.resolveRebaseConflict(ctx);
          } catch (err) {
            return {
              resolved: false,
              reason: err instanceof Error ? err.message : String(err)
            };
          }
        };
        outcome = await resolveRebaseConflicts(git2, this.projectRoot, outcome, resolver, cap);
        try {
          await this.events.emit(
            outcome.kind === "conflict_halt" ? { type: "rebase_resolution_exhausted" } : { type: "rebase_resolution_succeeded" }
          );
        } catch {
        }
      }
    }
    this.lastRebaseOutcome = outcome;
    const ranManualTest = getStepStatus(state, "manual_test") !== "skipped";
    await applyRebaseVerdicts(this.projectRoot, outcome, ranManualTest);
    await emitRebaseEvent(this.events, outcome);
    if (outcome.kind === "conflict_halt") {
      await writeHalt(this.projectRoot, outcome.conflicts, outcome.reason);
    }
    return { success: true };
  }
  /**
   * Discover a sensible LOCAL base branch name for the rebase fallback, without
   * hardcoding 'main'. Prefers origin's default branch name; else a local
   * main/master/trunk if present; else the first local branch that isn't the
   * current HEAD. Returns 'main' only as a last resort when nothing is found.
   */
  async discoverLocalBase(git2) {
    const fromOrigin = await originDefaultBranch(git2);
    if (fromOrigin) return fromOrigin;
    const current = (await git2(["symbolic-ref", "--short", "HEAD"])).stdout.trim();
    const branchesOut = await git2(["branch", "--format=%(refname:short)"]);
    const branches = branchesOut.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const candidate of ["main", "master", "trunk"]) {
      if (branches.includes(candidate) && candidate !== current) return candidate;
    }
    const other = branches.find((b) => b !== current);
    return other ?? "main";
  }
  /**
   * Handle the `complexity` step entirely in the engine:
   * 1. Ask Claude (--print mode) for a recommended tier.
   * 2. Let the UI confirm or override via onComplexityAssessment(recommended).
   * 3. Write tier + step status atomically.
   * On callback error (e.g., Ctrl-C), leave the step pending — no stuck state.
   */
  /**
   * Resolve the work track (adr-2026-06-29-explore-prd-split-track-in-explore/adr-2026-06-29-track-marker-location). Prefers `state.track` (daemon-seeded);
   * otherwise reads the committed `.docs/track/<slug>.md` marker that `/explore`
   * wrote in the interactive flow (newest file wins — one feature per worktree),
   * caches it into `state.track`, and persists. Defaults to `product` when no
   * usable marker exists, so PRD / prd-audit run unless the work was explicitly
   * classified `technical`. Best-effort: any fs error falls back to `product`.
   */
  async resolveTrack(state) {
    if (state.track) return state.track;
    try {
      const dir = join14(this.projectRoot, ".docs", "track");
      const entries = (await readdir4(dir)).filter((f) => f.endsWith(".md")).sort();
      if (entries.length > 0) {
        const content = await readFile12(join14(dir, entries[entries.length - 1]), "utf-8");
        const parsed = parseTrack(content);
        if (parsed) {
          state.track = parsed;
          await writeState(this.stateFilePath, state);
          return parsed;
        }
      }
    } catch {
    }
    return "product";
  }
  async runComplexityStep(state) {
    if (this.mode === "auto") {
      state.complexity_tier = state.complexity_tier ?? "L";
      state.complexity = "done";
      state.last_step = "complexity";
      await writeState(this.stateFilePath, state);
      return { success: true };
    }
    let recommended = state.complexity_tier ?? null;
    if (!recommended && this.stepRunner.assessComplexity) {
      try {
        recommended = await this.stepRunner.assessComplexity();
      } catch {
        recommended = null;
      }
    }
    if (!this.onComplexityAssessment) {
      state.complexity_tier = recommended ?? state.complexity_tier ?? "L";
      state.complexity = "done";
      state.last_step = "complexity";
      await writeState(this.stateFilePath, state);
      return { success: true };
    }
    let tier;
    try {
      tier = await this.onComplexityAssessment(recommended);
    } catch (err) {
      return {
        success: false,
        output: err instanceof Error ? err.message : "complexity prompt cancelled"
      };
    }
    state.complexity_tier = tier;
    state.complexity = "done";
    state.last_step = "complexity";
    await writeState(this.stateFilePath, state);
    return { success: true };
  }
  /**
   * Find the index to resume from: first in_progress step,
   * or first pending step after the last done step.
   */
  findResumeIndex(state, steps = ALL_STEPS) {
    if (state.feature_status === "complete") {
      return 0;
    }
    for (let i = 0; i < steps.length; i++) {
      if (getStepStatus(state, steps[i].name) === "in_progress") {
        return i;
      }
    }
    let lastDoneIndex = -1;
    for (let i = 0; i < steps.length; i++) {
      if (getStepStatus(state, steps[i].name) === "done") {
        lastDoneIndex = i;
      }
    }
    return lastDoneIndex + 1;
  }
};
function earliestRemediationTarget(fixes, steps) {
  let best = "build";
  let bestIdx = steps.length;
  for (const g of fixes) {
    const idx = steps.findIndex((s) => s.name === g.disposition);
    if (idx >= 0 && idx < bestIdx) {
      bestIdx = idx;
      best = g.disposition;
    }
  }
  return best;
}
function buildRemediationHint(fixes, source = "prd-audit", evidenceFile = ".pipeline/prd-audit.md") {
  const lines = fixes.map((g) => {
    const tasks = g.tasks.length ? ` Tasks: ${g.tasks.map((t) => t.title).join("; ")}` : "";
    return `- ${g.id} [${g.disposition}]: ${g.rationale}.${tasks}`;
  });
  return `Remediating blocking ${source} gaps (see .pipeline/remediation.json and ${evidenceFile}). The task list may already show complete, but the following are NOT satisfied \u2014 make the code/spec changes and commit them; the as-built code is re-audited after this step:
` + lines.join("\n");
}
function buildRetryHint(step, reason) {
  const r = reason ?? "unknown";
  if (step === "build" && /tasks? not completed/i.test(r)) {
    return `Previous attempt did not satisfy the completion check: ${r}. The implementation may already be done \u2014 verify each listed task ID against git log and files on disk before rewriting. If the work is complete, update .pipeline/task-status.json to mark those tasks "completed" (with their commit SHAs) instead of re-implementing.`;
  }
  return `Previous attempt did not satisfy the completion check: ${r}. Finish the work now.`;
}
async function hashFile(path) {
  try {
    const buf = await readFile12(path);
    return createHash("sha256").update(buf).digest("hex");
  } catch {
    return null;
  }
}
function approvalKey(projectRoot, file) {
  const rel = relative2(projectRoot, file);
  return rel.startsWith("..") ? file : rel;
}
async function filterUnapprovedArtifacts(files, approvals, projectRoot) {
  const out = [];
  for (const file of files) {
    const key = approvalKey(projectRoot, file);
    const prior = approvals[key];
    if (!prior) {
      out.push(file);
      continue;
    }
    const hash = await hashFile(file);
    if (hash !== prior.sha256) {
      out.push(file);
    }
  }
  return out;
}
async function recordApprovals(approvals, files, projectRoot) {
  const out = { ...approvals };
  const now = (/* @__PURE__ */ new Date()).toISOString();
  for (const file of files) {
    const hash = await hashFile(file);
    if (!hash) continue;
    const key = approvalKey(projectRoot, file);
    out[key] = { sha256: hash, approved_at: now };
  }
  return out;
}

// src/engine/step-runners.ts
import { writeFile as writeFile11, access as access4 } from "fs/promises";
import { join as join15 } from "path";

// src/engine/model-availability.ts
var DEFAULT_MODEL_FALLBACK_LADDER = ["fable", "opus", "sonnet"];
var ModelAvailability = class {
  ladder;
  warn;
  dead = /* @__PURE__ */ new Set();
  constructor(ladder, warn) {
    this.ladder = ladder === void 0 ? DEFAULT_MODEL_FALLBACK_LADDER : ladder;
    this.warn = warn;
  }
  markDead(model) {
    this.dead.add(model);
  }
  emitWarn(configured, fallback, reason) {
    this.warn?.(`Downgraded from ${configured} to ${fallback}: ${reason}`);
  }
  effectiveModel(configured) {
    if (!this.dead.has(configured)) {
      return { model: configured, downgraded: false };
    }
    for (const candidate of this.ladder) {
      if (!this.dead.has(candidate)) {
        this.emitWarn(configured, candidate, `${configured} is not available (unavailable)`);
        return { model: candidate, downgraded: true };
      }
    }
    return { model: configured, downgraded: true };
  }
  /**
   * Invokes the provider with the requested model, walking the fallback ladder
   * in-attempt when the provider reports modelUnavailable. Each unavailable
   * model is marked dead so subsequent invocations (in this process) skip it
   * via effectiveModel(). Any other result (success or ordinary failure, e.g.
   * rate-limited) is returned immediately without further ladder walking.
   *
   * Ordering: authFailure is checked first (transient auth issue, not a model problem)
   * before modelUnavailable (model is permanently unavailable). This prevents auth
   * failures from poisoning the ladder.
   */
  async invokeWithLadder(provider, options) {
    const requested = options.model ?? "";
    const result = await provider.invoke({ ...options, model: requested });
    if (result.authFailure) {
      return result;
    }
    if (!result.modelUnavailable) {
      return result;
    }
    if (this.ladder.length === 0) {
      return result;
    }
    this.markDead(requested);
    const { model: nextModel } = this.effectiveModel(requested);
    if (nextModel === requested) {
      return result;
    }
    return this.invokeWithLadder(provider, { ...options, model: nextModel });
  }
};

// src/engine/complexity.ts
var THRESHOLDS = {
  models: { s: 3, m: 7 },
  integrations: { s: 0, m: 2 },
  auth: { s: 0, m: 1 },
  stateMachines: { s: 0, m: 1 },
  stories: { s: 5, m: 15 }
};
function classifySignal(signal, count) {
  const t = THRESHOLDS[signal];
  if (count <= t.s) return "S";
  if (count <= t.m) return "M";
  return "L";
}
function hasInsufficientInfo(signalCount) {
  return signalCount < 3;
}

// src/engine/step-runners.ts
var STEP_PROMPTS = {
  bootstrap: "/bootstrap",
  memory: "/memory",
  assess: "/assess",
  explore: "/explore",
  prd: "/prd",
  complexity: "/conduct complexity",
  stories: "/stories",
  conflict_check: "/conflict-check",
  plan: "/plan",
  architecture_diagram: "/architecture-diagram",
  architecture_review: "/architecture-review",
  worktree: "/conduct worktree",
  acceptance_specs: "/writing-system-tests",
  build: "/pipeline",
  manual_test: "/manual-test",
  prd_audit: "/prd-audit",
  // Runs the architecture-review skill in its as-built compliance-gate mode.
  architecture_review_as_built: "/architecture-review --as-built",
  retro: "/retro",
  // Engine-native (like complexity) — never dispatched; present only to keep
  // the Record<StepName, string> exhaustive.
  rebase: "/conduct rebase",
  finish: "/finish",
  // Conditional SHIP sub-routine: plans remediation for a blocking audit.
  remediate: "/remediate"
};
var AUTONOMOUS_STEPS = /* @__PURE__ */ new Set([
  "bootstrap",
  "memory",
  "assess",
  "worktree",
  "acceptance_specs",
  "build",
  "remediate"
  // conductor-dispatched gap-remediation planner — runs unattended
]);
var INTERACTIVE_STEPS = /* @__PURE__ */ new Set([
  "explore",
  // divergent Q&A + approach selection + track confirmation
  "prd",
  // product-only design doc with operator approval
  "stories",
  "plan",
  "architecture_review",
  "manual_test",
  "finish"
]);
function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function parseTierFromOutput(output) {
  if (!output) return null;
  const markerMatches = [...output.matchAll(/TIER:\s*([SML])/gi)];
  if (markerMatches.length > 0) {
    const letter = markerMatches[markerMatches.length - 1][1].toUpperCase();
    return letter;
  }
  const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^([SML])[.!\s]*$/i);
    if (m) return m[1].toUpperCase();
  }
  return null;
}
function parseSignalCountsFromOutput(output) {
  if (!output) return {};
  const counts = {};
  const patterns = [
    ["models", /^\s*MODELS?\s*:\s*(\d+)/im],
    ["integrations", /^\s*INTEGRATIONS?\s*:\s*(\d+)/im],
    ["auth", /^\s*AUTH\s*:\s*(\d+)/im],
    ["stateMachines", /^\s*STATE[_\s-]?MACHINES?\s*:\s*(\d+)/im],
    ["stories", /^\s*STORIES\s*:\s*(\d+)/im]
  ];
  for (const [signal, pattern] of patterns) {
    const match = output.match(pattern);
    if (match) {
      const n = parseInt(match[1], 10);
      if (Number.isFinite(n) && n >= 0) counts[signal] = n;
    }
  }
  return counts;
}
function scoreComplexityFromCounts(counts) {
  const entries = Object.entries(counts);
  if (hasInsufficientInfo(entries.length)) return null;
  const presentTiers = {};
  for (const [signal, count] of entries) {
    presentTiers[signal] = classifySignal(signal, count);
  }
  return assessTierPartial(presentTiers);
}
function assessTierPartial(signals) {
  const counts = { S: 0, M: 0, L: 0 };
  for (const tier of Object.values(signals)) {
    if (tier) counts[tier]++;
  }
  const maxCount = Math.max(counts.S, counts.M, counts.L);
  const candidates = ["S", "M", "L"].filter(
    (t) => counts[t] === maxCount
  );
  const order = { S: 0, M: 1, L: 2 };
  return candidates.reduce((a, b) => order[b] > order[a] ? b : a);
}
function parseRebaseResolutionOutput(output) {
  if (!output || output.trim().length === 0) {
    return { resolved: false, reason: "rebase skill returned no parseable result" };
  }
  const lines = output.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed !== null && typeof parsed === "object" && "resolved" in parsed && typeof parsed.resolved === "boolean") {
        const obj = parsed;
        if (obj.resolved === true) {
          return { resolved: true };
        }
        const reason = typeof obj.reason === "string" && obj.reason.length > 0 ? obj.reason : "unspecified";
        return { resolved: false, reason };
      }
    } catch {
    }
  }
  return { resolved: false, reason: "rebase skill returned no parseable result" };
}
var DefaultStepRunner = class {
  constructor(provider, sessionId, projectDir, options) {
    this.provider = provider;
    this.sessionId = sessionId;
    this.projectDir = projectDir;
    this.featureDesc = options?.featureDesc ?? "";
    this.totalSteps = options?.totalSteps ?? ALL_STEPS.length;
    this.pipelineDir = options?.pipelineDir ?? null;
    this.stepCooldown = options?.stepCooldown ?? 0;
    this.sleepFn = options?.sleepFn ?? defaultSleep;
    this.config = options?.config;
    this.modelOverride = options?.modelOverride;
    this.effortOverride = options?.effortOverride;
    this.mode = options?.mode ?? "default";
    this.modelAvailability = new ModelAvailability(
      this.config?.model_fallback_ladder,
      (line) => console.warn(line)
    );
  }
  provider;
  sessionId;
  projectDir;
  sessionStarted = false;
  sessionStartedInitialized = false;
  featureDesc;
  totalSteps;
  pipelineDir;
  stepCooldown;
  sleepFn;
  config;
  modelOverride;
  effortOverride;
  mode;
  modelAvailability;
  callCount = 0;
  resolvedConfigFor(step, tier) {
    return resolveStepConfig(step, phaseForStep(step), this.config, {
      modelCliOverride: this.modelOverride,
      effortCliOverride: this.effortOverride,
      tier
    });
  }
  modelForStep(step) {
    return this.resolvedConfigFor(step).model;
  }
  async run(step, state, opts) {
    if (step === "complexity") {
      throw new Error(
        "complexity is handled by the engine via assessComplexity(); it must not be dispatched to run()"
      );
    }
    if (step === "rebase") {
      throw new Error(
        "rebase is handled by the engine (native git rebase-on-latest); it must not be dispatched to run()"
      );
    }
    if (!this.sessionStartedInitialized && this.pipelineDir) {
      this.sessionStarted = await this.fileExists(join15(this.pipelineDir, "session-created"));
      this.sessionStartedInitialized = true;
    }
    if (this.callCount > 0 && this.stepCooldown > 0) {
      const multiplier = this.callCount >= 20 ? 3 : this.callCount >= 10 ? 2 : 1;
      await this.sleepFn(this.stepCooldown * 1e3 * multiplier);
    }
    const prompt = STEP_PROMPTS[step];
    const resume = this.sessionStarted;
    const autonomous = AUTONOMOUS_STEPS.has(step);
    const resolved = this.resolvedConfigFor(step, state.complexity_tier);
    const systemPrompt = this.buildSystemPrompt(step, autonomous, opts?.retryReason);
    if (autonomous) {
      return this.runAutonomous(step, prompt, resume, systemPrompt, resolved);
    }
    const interactive = this.mode !== "auto" && INTERACTIVE_STEPS.has(step);
    const { model: effectiveModel } = this.modelAvailability.effectiveModel(resolved.model);
    try {
      await this.provider.invokeInteractive({
        prompt,
        sessionId: this.sessionId,
        resume,
        interactive,
        cwd: this.projectDir,
        // In auto mode there is no human to approve permissions, and the spawned
        // `claude` would otherwise launch in the user's default permission mode
        // (which may be `plan` → ALL writes blocked, so e.g. prd can never
        // save its `.docs/specs/` PRD and the step loops). Skip permissions so the
        // step can write, like autonomous steps. Interactive REPL mode (non-auto)
        // keeps prompts so the user approves.
        dangerouslySkipPermissions: this.mode === "auto",
        systemPrompt,
        model: effectiveModel,
        effort: resolved.effort
      });
      this.sessionStarted = true;
      this.callCount++;
      if (this.pipelineDir) {
        await writeFile11(join15(this.pipelineDir, "session-created"), "1", "utf-8");
        await writeFile11(join15(this.pipelineDir, "conduct-session-id"), this.sessionId, "utf-8");
      }
      return { success: true };
    } catch {
      this.callCount++;
      return { success: false, output: `Session for ${step} exited with error` };
    }
  }
  async runAutonomous(step, prompt, resume, systemPrompt, resolved) {
    const { model: effectiveModel } = this.modelAvailability.effectiveModel(resolved.model);
    const attemptedModels = [];
    const trackingProvider = {
      invoke: (opts) => {
        attemptedModels.push(opts.model ?? "");
        return this.provider.invoke(opts);
      },
      invokeInteractive: (opts) => this.provider.invokeInteractive(opts)
    };
    const result = await this.modelAvailability.invokeWithLadder(trackingProvider, {
      prompt,
      sessionId: this.sessionId,
      resume,
      dangerouslySkipPermissions: true,
      systemPrompt,
      model: effectiveModel,
      effort: resolved.effort,
      cwd: this.projectDir
    });
    this.callCount++;
    if (result.authFailure) {
      return { success: false, output: result.output, authFailure: true };
    }
    if (result.rateLimited) {
      const waitSeconds = await this.readRateLimitWait();
      return {
        success: false,
        output: result.output,
        rateLimited: true,
        waitSeconds
      };
    }
    if (result.sessionExpired) {
      return { success: false, output: result.output, sessionExpired: true };
    }
    if (result.success) {
      this.sessionStarted = true;
      if (this.pipelineDir) {
        await writeFile11(join15(this.pipelineDir, "session-created"), "1", "utf-8");
        await writeFile11(join15(this.pipelineDir, "conduct-session-id"), this.sessionId, "utf-8");
      }
      return { success: true, output: result.output };
    }
    if (result.modelUnavailable && attemptedModels.length > 1) {
      return {
        success: false,
        output: `${result.output} (model fallback ladder exhausted, tried: ${attemptedModels.join(", ")})`
      };
    }
    return { success: false, output: result.output };
  }
  /**
   * Read a pending rate-limit wait-seconds value. Mirrors bin/conduct:2252–2258:
   * `${PIPELINE_DIR}/rate-limit-hit` has the wait seconds on line 2. Returns
   * 300 (the bash default) when the marker is absent or unparseable.
   */
  async readRateLimitWait() {
    const DEFAULT = 300;
    if (!this.pipelineDir) return DEFAULT;
    try {
      const { readFile: readFile17 } = await import("fs/promises");
      const raw = await readFile17(join15(this.pipelineDir, "rate-limit-hit"), "utf-8");
      const line2 = raw.split("\n")[1]?.trim();
      const n = Number.parseInt(line2 ?? "", 10);
      return Number.isFinite(n) && n > 0 ? n : DEFAULT;
    } catch {
      return DEFAULT;
    }
  }
  async resetSession() {
    const { v4: uuidv4 } = await import("uuid");
    this.sessionId = uuidv4();
    this.sessionStarted = false;
    this.sessionStartedInitialized = true;
    if (this.pipelineDir) {
      const { unlink: unlink2 } = await import("fs/promises");
      await unlink2(join15(this.pipelineDir, "session-created")).catch(() => {
      });
      await writeFile11(join15(this.pipelineDir, "conduct-session-id"), this.sessionId, "utf-8");
    }
  }
  async runInteractive(step) {
    const resolved = this.resolvedConfigFor(step);
    await this.provider.invokeInteractive({
      prompt: `Fix issues from the failed ${step} step, then exit when done.`,
      sessionId: this.sessionId,
      resume: true,
      interactive: true,
      dangerouslySkipPermissions: false,
      model: resolved.model,
      effort: resolved.effort,
      cwd: this.projectDir
    });
  }
  async assessComplexity() {
    if (!this.sessionStartedInitialized && this.pipelineDir) {
      this.sessionStarted = await this.fileExists(join15(this.pipelineDir, "session-created"));
      this.sessionStartedInitialized = true;
    }
    const systemPrompt = "You are assessing complexity for the current feature. Read .docs/specs/*.md (most recent). Count the signals from the design doc. Auth uses a level: 0=none/basic, 1=role-based, 2=multi-tenant/OAuth. State machines = number of distinct state machines implied (complex or multi-state counts as 2+). Output exactly these six lines, each on its own line, then stop:\nMODELS: <integer>\nINTEGRATIONS: <integer>\nAUTH: <0|1|2>\nSTATE_MACHINES: <integer>\nSTORIES: <integer estimate>\nTIER: <S|M|L>   # your best letter judgement, used only as a fallback";
    const resolved = this.resolvedConfigFor("complexity");
    const result = await this.provider.invoke({
      prompt: "/conduct complexity",
      sessionId: this.sessionId,
      resume: this.sessionStarted,
      dangerouslySkipPermissions: true,
      systemPrompt,
      model: resolved.model,
      effort: resolved.effort,
      cwd: this.projectDir
    });
    if (!result.success) return null;
    const counts = parseSignalCountsFromOutput(result.output);
    const scored = scoreComplexityFromCounts(counts);
    if (scored) return scored;
    return parseTierFromOutput(result.output);
  }
  /**
   * Dispatch the `rebase` skill in print mode to resolve a paused rebase
   * conflict in the feature worktree and parse its structured JSON result.
   *
   * Uses a fresh session (never resumes the main conductor session) and runs
   * with cwd set to ctx.projectRoot so the skill operates in the right worktree.
   * Model and effort are resolved from the `rebase` step config (default: opus/high —
   * conflict resolution is semantic merge judgment, not deterministic git work).
   *
   * Returns `{resolved: true}` when the skill signals success, or
   * `{resolved: false, reason}` on failure or when stdout contains no
   * parseable `{resolved:...}` JSON — NEVER returns `{resolved: true}` on
   * garbage output (fail-safe).
   */
  async resolveRebaseConflict(ctx) {
    const resolved = this.resolvedConfigFor("rebase");
    const conflictList = ctx.conflicts.length > 0 ? ctx.conflicts.join(", ") : "(run `git diff --name-only --diff-filter=U` to discover)";
    const systemPrompt = `You are resolving a paused git rebase conflict. The rebase is stopped mid-flight.
Project root: ${ctx.projectRoot}
Base ref: ${ctx.baseRef}
Conflicted files: ${conflictList}

Resolve the conflicts, stage the fixes, and run \`git rebase --continue\` until the rebase completes or you reach an unsafe hunk.
Your FINAL output line MUST be exactly one of:
{"resolved": true}
{"resolved": false, "reason": "<explanation>"}`;
    const { v4: uuidv4 } = await import("uuid");
    const sessionId = uuidv4();
    const result = await this.provider.invoke({
      prompt: "/rebase",
      sessionId,
      resume: false,
      dangerouslySkipPermissions: true,
      systemPrompt,
      model: resolved.model,
      effort: resolved.effort,
      cwd: ctx.projectRoot
    });
    return parseRebaseResolutionOutput(result.output);
  }
  async fileExists(path) {
    try {
      await access4(path);
      return true;
    } catch {
      return false;
    }
  }
  buildSystemPrompt(step, autonomous, retryReason) {
    const stepDef = getStepDefinition(step);
    const stepIdx = tryGetStepIndex(step);
    const header = stepIdx !== null ? `[Conduct step ${stepIdx + 1}/${this.totalSteps}]` : `[Conduct: ${stepDef.label}]`;
    const featurePart = this.featureDesc ? ` Feature: ${this.featureDesc}` : "";
    let prompt = `${header}${featurePart}`;
    if (!autonomous) {
      prompt = `You are running step: ${stepDef.label}. Complete ONLY this step, then stop and let the user /quit to return to the conductor.
${prompt}`;
    }
    if (step === "finish" && this.mode === "auto") {
      const choicePath = this.pipelineDir ? join15(this.pipelineDir, "finish-choice") : ".pipeline/finish-choice";
      const statePath = this.pipelineDir ? join15(this.pipelineDir, "conduct-state.json") : ".pipeline/conduct-state.json";
      prompt += `

UNATTENDED (auto) MODE \u2014 no user is present to choose a finish outcome, so do NOT prompt. Decide deterministically and ACT (do not merely describe):
- If the repo has a configured git remote and \`gh\` is authenticated: push the branch and open a PR with \`gh pr create\` (NEVER merge). If a PR for this branch already exists, reuse it instead of failing (\`gh pr view --json url -q .url\`). Record the PR URL as the \`pr_url\` field in \`${statePath}\`, then write the single word \`pr\` to \`${choicePath}\`.
- Otherwise (no remote, or \`gh\` unavailable/unauthenticated): leave the work committed on the branch and write the single word \`keep\` to \`${choicePath}\`.
IMPORTANT: write these two files at the EXACT absolute paths shown above (\`${choicePath}\` and \`${statePath}\`). Do NOT use relative paths and do NOT \`cd\` elsewhere first \u2014 branch/PR/worktree cleanup may change the working directory, and the completion gate only reads these absolute worktree paths. Write the marker(s) BEFORE any merge/cleanup step. The step is NOT complete until \`${choicePath}\` exists with one of those exact values (and, for \`pr\`, \`pr_url\` is set in \`${statePath}\`).`;
    }
    if (retryReason) {
      prompt = `RETRY: ${retryReason}
${prompt}`;
    }
    return prompt;
  }
};

// src/ui/events.ts
var ConductorEventEmitter = class {
  handlers = /* @__PURE__ */ new Map();
  /**
   * Dispatch `event` to every registered handler and await any Promises they
   * return. Handler errors are swallowed so one failing subscriber doesn't
   * crash the engine.
   */
  async emit(event) {
    const handlers = this.handlers.get(event.type);
    if (!handlers || handlers.size === 0) return;
    const snapshot = [...handlers];
    const pending = [];
    for (const handler of snapshot) {
      try {
        const out = handler(event);
        if (out && typeof out.then === "function") {
          pending.push(
            out.catch(() => {
            })
          );
        }
      } catch {
      }
    }
    if (pending.length > 0) await Promise.all(pending);
  }
  on(type, handler) {
    let set = this.handlers.get(type);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
  }
  off(type, handler) {
    this.handlers.get(type)?.delete(handler);
  }
  once(type, handler) {
    const wrapped = (event) => {
      this.off(type, wrapped);
      return handler(event);
    };
    this.on(type, wrapped);
  }
  waitFor(type) {
    return new Promise((resolve) => {
      this.once(type, resolve);
    });
  }
};

// src/engine/config.ts
import { readFile as readFile13, rename as rename2, mkdir as mkdir8 } from "fs/promises";
import { existsSync as existsSync2 } from "fs";
import { join as join16, isAbsolute as isAbsolute3, resolve as resolvePath, dirname as dirname2 } from "path";
import { load as loadYaml2 } from "js-yaml";

// src/engine/md-viewer-presets.ts
var MARKDOWN_VIEWER_PRESETS = [
  {
    name: "glow",
    command: "glow",
    args: ["-p", "-w", "80", "{file}"],
    mode: "inline",
    label: "glow",
    notes: "Terminal, paged, ANSI styled"
  },
  {
    name: "bat",
    command: "bat",
    args: ["--style=plain", "--paging=never", "{file}"],
    mode: "inline",
    label: "bat",
    notes: "Terminal, syntax-highlighted"
  },
  {
    name: "mdcat",
    command: "mdcat",
    args: ["{file}"],
    mode: "inline",
    label: "mdcat",
    notes: "Terminal, Sixel image support"
  },
  {
    name: "cat",
    command: "cat",
    args: ["{file}"],
    mode: "inline",
    label: "cat",
    notes: "Universal fallback"
  },
  {
    name: "code",
    command: "code",
    args: ["--wait", "{file}"],
    mode: "blocking",
    label: "VSCode",
    notes: "GUI editor, waits until file is closed"
  },
  {
    name: "typora",
    command: "typora",
    args: ["--wait", "{file}"],
    mode: "blocking",
    label: "Typora",
    notes: "GUI editor (Typora \u22651.3 supports --wait)"
  },
  {
    name: "marktext",
    command: "marktext",
    args: ["{file}"],
    mode: "external",
    label: "MarkText",
    notes: "GUI editor \u2014 press-enter to continue"
  },
  {
    name: "nvim",
    command: "nvim",
    args: ["{file}"],
    mode: "blocking",
    label: "neovim",
    notes: "Terminal editor, headless-friendly"
  },
  {
    name: "obsidian",
    command: "obsidian",
    args: ["{file}"],
    mode: "external",
    label: "Obsidian",
    notes: "GUI \u2014 press-enter to continue"
  }
];
var PRESET_NAMES = MARKDOWN_VIEWER_PRESETS.map((p) => p.name);
var VALID_MARKDOWN_VIEWER_MODES = /* @__PURE__ */ new Set([
  "inline",
  "blocking",
  "external"
]);

// src/engine/mermaid-renderer-presets.ts
var MERMAID_RENDERER_PRESETS = [
  {
    name: "html",
    command: "",
    args: ["{file}"],
    mode: "external",
    label: "HTML preview (browser)",
    notes: "Self-contained HTML rendered with mermaid.js, opened in the default browser. No native dependencies \u2014 works on any platform."
  },
  {
    name: "mmdc-png",
    command: "mmdc",
    args: ["-i", "{file}", "-o", "{out}"],
    mode: "external",
    label: "PNG images (mermaid-cli)",
    notes: "Renders each diagram to PNG via @mermaid-js/mermaid-cli (needs Chromium)."
  },
  {
    name: "mmdc-svg",
    command: "mmdc",
    args: ["-i", "{file}", "-o", "{out}"],
    mode: "external",
    label: "SVG images (mermaid-cli)",
    notes: "Renders each diagram to SVG via @mermaid-js/mermaid-cli (needs Chromium)."
  },
  {
    name: "none",
    command: "",
    args: ["{file}"],
    mode: "external",
    label: "disabled (raw Markdown)",
    notes: "No rendering \u2014 diagrams are reviewed as raw Markdown."
  }
];
var MERMAID_PRESET_NAMES = MERMAID_RENDERER_PRESETS.map((p) => p.name);
var VALID_MERMAID_RENDERER_MODES = /* @__PURE__ */ new Set(["inline", "blocking", "external"]);

// src/engine/config.ts
var VALID_PHASES = /* @__PURE__ */ new Set(["SETUP", "UNDERSTAND", "DECIDE", "BUILD", "SHIP"]);
var VALID_EFFORTS = /* @__PURE__ */ new Set(["low", "medium", "high", "xhigh", "max"]);
var VALID_ENFORCEMENTS = /* @__PURE__ */ new Set(["structural", "advisory", "gating"]);
var PROJECT_CONFIG_DIR = ".ai-conductor";
var PROJECT_CONFIG_FILE = "config.yml";
var LEGACY_PROJECT_CONFIG_DIR = ".harness";
function projectConfigPath(projectRoot) {
  return join16(projectRoot, PROJECT_CONFIG_DIR, PROJECT_CONFIG_FILE);
}
function legacyProjectConfigPath(projectRoot) {
  return join16(projectRoot, LEGACY_PROJECT_CONFIG_DIR, PROJECT_CONFIG_FILE);
}
async function migrateLegacyProjectConfig(projectRoot) {
  const newPath = projectConfigPath(projectRoot);
  const oldPath = legacyProjectConfigPath(projectRoot);
  if (existsSync2(newPath) || !existsSync2(oldPath)) return false;
  try {
    await mkdir8(dirname2(newPath), { recursive: true });
    await rename2(oldPath, newPath);
    return true;
  } catch {
    return false;
  }
}
async function loadConfig(projectRoot, harnessVersion) {
  await migrateLegacyProjectConfig(projectRoot);
  const configPath = projectConfigPath(projectRoot);
  let raw;
  try {
    raw = await readFile13(configPath, "utf-8");
  } catch {
    return {
      ok: false,
      error: {
        type: "missing",
        message: `Config file not found: ${configPath}. Run bin/migrate to create it.`
      }
    };
  }
  let parsed;
  try {
    parsed = loadYaml2(raw);
  } catch (e) {
    let message = "Failed to parse YAML";
    if (e instanceof Error) {
      message = e.message;
      const yamlErr = e;
      if (yamlErr.mark && typeof yamlErr.mark.line === "number") {
        message = `YAML parse error at line ${yamlErr.mark.line + 1}: ${e.message}`;
      }
    }
    return { ok: false, error: { type: "parse_error", message } };
  }
  const validation = validateConfig(parsed, projectRoot, { source: "project" });
  if (!validation.ok) return validation;
  if (harnessVersion && validation.config.harness_version) {
    if (!satisfiesVersion(harnessVersion, validation.config.harness_version)) {
      return {
        ok: false,
        error: {
          type: "version_mismatch",
          message: `Harness version ${harnessVersion} does not satisfy constraint ${validation.config.harness_version}`
        }
      };
    }
  }
  return validation;
}
function validateConfig(raw, projectRoot, opts = {}) {
  if (raw === null || raw === void 0) {
    return { ok: true, config: {}, warnings: [] };
  }
  if (typeof raw !== "object") {
    return {
      ok: false,
      error: { type: "validation_error", message: "Config must be an object" }
    };
  }
  const obj = raw;
  const warnings = [];
  const knownTopLevelKeys = /* @__PURE__ */ new Set([
    "harness_version",
    "defaults",
    "phases",
    "steps",
    "complexity",
    "conductor",
    "markdown_viewer",
    "mermaid_renderer",
    "assess",
    "acceptance_spec_globs",
    // Plugin selections (adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration/adr-2026-06-29-per-project-memory-provider-selection)
    "llm_provider",
    "ui_renderer",
    "memory_provider",
    // Observability
    "otel",
    // Owner-gate (adr-2026-06-30-*): operator identity + grandfather cutover.
    "spec_owner",
    "owner_gate_cutover",
    // Rebase auto-resolution attempt cap (rebase-resolution-skill).
    "rebase_resolution_attempts",
    // Self-host guardrails (adr-2026-06-30-self-host-detection-seam).
    "harness_self_host",
    // Model availability fallback ladder.
    "model_fallback_ladder"
  ]);
  for (const key of Object.keys(obj)) {
    if (!knownTopLevelKeys.has(key)) {
      return errVal(`Unknown top-level key: "${key}"`);
    }
  }
  if (obj.defaults !== void 0) {
    const err = validateEffortAndModelBag(obj.defaults, "defaults");
    if (err) return { ok: false, error: err };
  }
  if (obj.phases !== void 0) {
    if (!isPlainObject(obj.phases)) {
      return {
        ok: false,
        error: { type: "validation_error", message: "phases must be an object" }
      };
    }
    for (const [phase, value] of Object.entries(obj.phases)) {
      if (!VALID_PHASES.has(phase)) {
        return errVal(`Unknown phase: "${phase}"`);
      }
      const err = validateEffortAndModelBag(value, `phases.${phase}`);
      if (err) return { ok: false, error: err };
    }
  }
  if (obj.steps !== void 0) {
    if (!isPlainObject(obj.steps)) {
      return {
        ok: false,
        error: { type: "validation_error", message: "steps must be an object" }
      };
    }
    const builtInNames = new Set(ALL_STEPS.map((s) => s.name));
    const stepDefs = new Map(ALL_STEPS.map((s) => [s.name, s]));
    const customStepNames = /* @__PURE__ */ new Set();
    for (const [n, v] of Object.entries(obj.steps)) {
      if (!builtInNames.has(n) && isPlainObject(v)) {
        customStepNames.add(n);
      }
    }
    for (const [name, value] of Object.entries(obj.steps)) {
      if (!isPlainObject(value)) {
        return {
          ok: false,
          error: {
            type: "validation_error",
            message: `steps.${name} must be an object`
          }
        };
      }
      const cfg = value;
      const knownStepKeys = /* @__PURE__ */ new Set([
        "model",
        "effort",
        "max_retries",
        "disable",
        "skill",
        "hooks",
        "by_tier",
        "after",
        "enforcement",
        "when",
        "parallel"
      ]);
      for (const k of Object.keys(cfg)) {
        if (!knownStepKeys.has(k)) {
          return errVal(`Unknown key in steps.${name}: "${k}"`);
        }
      }
      if (cfg.effort !== void 0 && !VALID_EFFORTS.has(cfg.effort)) {
        return errVal(`steps.${name}.effort must be low|medium|high|xhigh|max`);
      }
      if (cfg.by_tier !== void 0) {
        const byTierErr = validateByTier(cfg.by_tier, `steps.${name}.by_tier`);
        if (byTierErr) return { ok: false, error: byTierErr };
      }
      if (cfg.max_retries !== void 0 && typeof cfg.max_retries !== "number") {
        return errVal(`steps.${name}.max_retries must be a number`);
      }
      if (cfg.disable !== void 0 && typeof cfg.disable !== "boolean") {
        return errVal(`steps.${name}.disable must be a boolean`);
      }
      if (cfg.model !== void 0 && typeof cfg.model !== "string") {
        return errVal(`steps.${name}.model must be a string`);
      }
      if (cfg.skill !== void 0 && typeof cfg.skill !== "string") {
        return errVal(`steps.${name}.skill must be a string path`);
      }
      if (cfg.hooks !== void 0) {
        if (!isPlainObject(cfg.hooks)) {
          return errVal(`steps.${name}.hooks must be an object`);
        }
        const hooks = cfg.hooks;
        for (const h of ["before", "after"]) {
          if (hooks[h] !== void 0 && typeof hooks[h] !== "string") {
            return errVal(`steps.${name}.hooks.${h} must be a string path`);
          }
        }
      }
      if (cfg.when !== void 0) {
        if (typeof cfg.when !== "string") {
          return errVal(`steps.${name}.when must be a string expression`);
        }
        const syntaxErr = validateWhenSyntax(cfg.when);
        if (syntaxErr) {
          return errVal(`steps.${name}.when: ${syntaxErr}`);
        }
      }
      if (cfg.parallel !== void 0) {
        if (!Array.isArray(cfg.parallel)) {
          return errVal(`steps.${name}.parallel must be an array`);
        }
        if (cfg.skill !== void 0) {
          return errVal(
            `steps.${name}: "skill" and "parallel" are mutually exclusive`
          );
        }
        const branchNames = /* @__PURE__ */ new Set();
        for (let bi = 0; bi < cfg.parallel.length; bi++) {
          const branch = cfg.parallel[bi];
          if (!isPlainObject(branch)) {
            return errVal(`steps.${name}.parallel[${bi}] must be an object`);
          }
          const b = branch;
          const knownBranchKeys = /* @__PURE__ */ new Set(["name", "skill", "model", "effort", "advisory"]);
          for (const bk of Object.keys(b)) {
            if (!knownBranchKeys.has(bk)) {
              return errVal(`Unknown key in steps.${name}.parallel[${bi}]: "${bk}"`);
            }
          }
          if (typeof b.name !== "string" || !b.name) {
            return errVal(`steps.${name}.parallel[${bi}].name must be a non-empty string`);
          }
          if (branchNames.has(b.name)) {
            return errVal(
              `steps.${name}.parallel has duplicate branch name: "${b.name}"`
            );
          }
          branchNames.add(b.name);
          if (b.skill !== void 0 && typeof b.skill !== "string") {
            return errVal(`steps.${name}.parallel[${bi}].skill must be a string`);
          }
          if (b.model !== void 0 && typeof b.model !== "string") {
            return errVal(`steps.${name}.parallel[${bi}].model must be a string`);
          }
          if (b.effort !== void 0 && !VALID_EFFORTS.has(b.effort)) {
            return errVal(`steps.${name}.parallel[${bi}].effort must be low|medium|high|xhigh|max`);
          }
          if (b.advisory !== void 0 && typeof b.advisory !== "boolean") {
            return errVal(`steps.${name}.parallel[${bi}].advisory must be a boolean`);
          }
        }
      }
      const isCustom = !builtInNames.has(name);
      if (isCustom) {
        if (typeof cfg.after !== "string") {
          return errVal(`Custom step "${name}" requires 'after: <existing-step>'`);
        }
        const afterTarget = cfg.after;
        const isBuiltIn = builtInNames.has(afterTarget);
        const isSiblingCustom = customStepNames.has(afterTarget) && afterTarget !== name;
        if (!isBuiltIn && !isSiblingCustom) {
          return errVal(
            `Custom step "${name}" references unknown after target: "${afterTarget}"`
          );
        }
        if (typeof cfg.skill !== "string") {
          return errVal(`Custom step "${name}" requires 'skill: <path-to-SKILL.md>'`);
        }
        if (cfg.enforcement !== void 0 && !VALID_ENFORCEMENTS.has(cfg.enforcement)) {
          return errVal(
            `Custom step "${name}".enforcement must be structural|advisory|gating`
          );
        }
        if (projectRoot && typeof cfg.skill === "string") {
          const skillPath = isAbsolute3(cfg.skill) ? cfg.skill : resolvePath(projectRoot, cfg.skill);
          if (!existsSync2(skillPath)) {
            return errVal(
              `Custom step "${name}" skill file not found: ${skillPath}`
            );
          }
        }
      } else {
        if (cfg.after !== void 0) {
          return errVal(`steps.${name}.after is not valid for built-in steps`);
        }
        if (cfg.enforcement !== void 0) {
          return errVal(`steps.${name}.enforcement is not valid for built-in steps`);
        }
        const def = stepDefs.get(name);
        if (cfg.disable === true && def) {
          if (def.enforcement === "gating" || def.enforcement === "structural") {
            return errVal(
              `Cannot disable ${def.enforcement} step: "${name}". Only advisory steps may be disabled.`
            );
          }
        }
      }
    }
  }
  if (obj.complexity !== void 0) {
    if (!isPlainObject(obj.complexity)) {
      return errVal("complexity must be an object");
    }
    const cx = obj.complexity;
    const VALID_TIERS = /* @__PURE__ */ new Set(["S", "M", "L"]);
    if (cx.default_tier !== void 0 && !VALID_TIERS.has(cx.default_tier)) {
      return errVal("complexity.default_tier must be S|M|L");
    }
  }
  if (obj.conductor !== void 0) {
    const err = validateConductorBlock(obj.conductor);
    if (err) return { ok: false, error: err };
  }
  if (obj.markdown_viewer !== void 0) {
    const err = validateMarkdownViewerBlock(obj.markdown_viewer);
    if (err) return { ok: false, error: err };
  }
  if (obj.mermaid_renderer !== void 0) {
    const err = validateMermaidRendererBlock(obj.mermaid_renderer);
    if (err) return { ok: false, error: err };
  }
  if (obj.assess !== void 0) {
    const err = validateAssessBlock(obj.assess);
    if (err) return { ok: false, error: err };
  }
  if (obj.acceptance_spec_globs !== void 0) {
    if (!Array.isArray(obj.acceptance_spec_globs)) {
      return errVal("acceptance_spec_globs must be an array of strings");
    }
    if (!obj.acceptance_spec_globs.every((g) => typeof g === "string")) {
      return errVal("acceptance_spec_globs must contain only strings");
    }
  }
  if (opts.source === "project") {
    if ("spec_owner" in obj) {
      return errVal(
        `spec_owner must not be set in a project config (${projectConfigPath(
          projectRoot ?? "."
        )}): it would leak your operator identity to everyone who pulls the repo. Move spec_owner to your user config at ~/.ai-conductor/config.yml.`
      );
    }
  } else if (obj.spec_owner !== void 0 && typeof obj.spec_owner !== "string") {
    return errVal("spec_owner must be a string");
  }
  if (obj.owner_gate_cutover !== void 0) {
    if (typeof obj.owner_gate_cutover !== "string") {
      return errVal("owner_gate_cutover must be an ISO-8601 date string");
    }
    if (Number.isNaN(Date.parse(obj.owner_gate_cutover))) {
      return errVal(
        `owner_gate_cutover is not a parseable date: "${obj.owner_gate_cutover}". Use an ISO-8601 instant (e.g. 2026-06-30T00:00:00Z).`
      );
    }
  }
  if (obj.harness_self_host !== void 0) {
    const err = validateSelfHostBlock(obj.harness_self_host);
    if (err) return { ok: false, error: err };
  }
  if (obj.model_fallback_ladder !== void 0) {
    if (!Array.isArray(obj.model_fallback_ladder)) {
      return errVal("model_fallback_ladder must be an array of strings");
    }
    for (const entry of obj.model_fallback_ladder) {
      if (typeof entry !== "string" || entry === "") {
        return errVal("model_fallback_ladder must contain only non-empty strings");
      }
    }
  }
  return { ok: true, config: obj, warnings };
}
var SELF_HOST_ACTIVATIONS = /* @__PURE__ */ new Set(["auto", "force_on", "force_off"]);
var SELF_HOST_GATE_KEYS = [
  "skill_relink_preflight",
  "sandbox_build_env",
  "version_approval_gate",
  "release_artifact_gate"
];
function validateSelfHostBlock(raw) {
  if (!isPlainObject(raw)) {
    return { type: "validation_error", message: "harness_self_host must be an object" };
  }
  const obj = raw;
  const allowed = /* @__PURE__ */ new Set(["activation", "version_freeze", ...SELF_HOST_GATE_KEYS]);
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      return { type: "validation_error", message: `Unknown key in harness_self_host: "${k}"` };
    }
  }
  if (obj.version_freeze !== void 0 && (typeof obj.version_freeze !== "string" || obj.version_freeze.trim() === "")) {
    return {
      type: "validation_error",
      message: "harness_self_host.version_freeze must be a non-empty string (the frozen version)"
    };
  }
  if (obj.activation !== void 0 && !SELF_HOST_ACTIVATIONS.has(obj.activation)) {
    return {
      type: "validation_error",
      message: "harness_self_host.activation must be auto | force_on | force_off"
    };
  }
  for (const k of SELF_HOST_GATE_KEYS) {
    if (obj[k] !== void 0 && typeof obj[k] !== "boolean") {
      return {
        type: "validation_error",
        message: `harness_self_host.${k} must be a boolean`
      };
    }
  }
  return null;
}
function validateConductorBlock(raw) {
  if (!isPlainObject(raw)) {
    return { type: "validation_error", message: "conductor must be an object" };
  }
  const obj = raw;
  const allowed = /* @__PURE__ */ new Set(["update_channel", "auto_check", "current_version", "last_checked_at"]);
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      return {
        type: "validation_error",
        message: `Unknown key in conductor: "${k}"`
      };
    }
  }
  if (obj.update_channel !== void 0 && obj.update_channel !== "tagged" && obj.update_channel !== "main") {
    return {
      type: "validation_error",
      message: 'conductor.update_channel must be "tagged" or "main"'
    };
  }
  if (obj.auto_check !== void 0 && typeof obj.auto_check !== "boolean") {
    return { type: "validation_error", message: "conductor.auto_check must be a boolean" };
  }
  if (obj.current_version !== void 0 && typeof obj.current_version !== "string") {
    return { type: "validation_error", message: "conductor.current_version must be a string" };
  }
  if (obj.last_checked_at !== void 0 && typeof obj.last_checked_at !== "string") {
    return { type: "validation_error", message: "conductor.last_checked_at must be a string" };
  }
  return null;
}
function validateAssessBlock(raw) {
  if (!isPlainObject(raw)) {
    return { type: "validation_error", message: "assess must be an object" };
  }
  const obj = raw;
  const allowed = /* @__PURE__ */ new Set(["stale_after_days", "stale_after_commits"]);
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      return { type: "validation_error", message: `Unknown key in assess: "${k}"` };
    }
  }
  for (const k of ["stale_after_days", "stale_after_commits"]) {
    const v = obj[k];
    if (v !== void 0) {
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
        return {
          type: "validation_error",
          message: `assess.${k} must be a non-negative number`
        };
      }
    }
  }
  return null;
}
function validateMarkdownViewerBlock(raw) {
  if (!isPlainObject(raw)) {
    return { type: "validation_error", message: "markdown_viewer must be an object" };
  }
  const obj = raw;
  const allowed = /* @__PURE__ */ new Set(["preset", "command", "args", "mode"]);
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      return {
        type: "validation_error",
        message: `Unknown key in markdown_viewer: "${k}"`
      };
    }
  }
  if (obj.preset !== void 0 && typeof obj.preset !== "string") {
    return { type: "validation_error", message: "markdown_viewer.preset must be a string" };
  }
  if (obj.command !== void 0 && typeof obj.command !== "string") {
    return { type: "validation_error", message: "markdown_viewer.command must be a string" };
  }
  if (obj.args !== void 0) {
    if (!Array.isArray(obj.args) || obj.args.some((a) => typeof a !== "string")) {
      return {
        type: "validation_error",
        message: "markdown_viewer.args must be an array of strings"
      };
    }
    if (!obj.args.includes("{file}")) {
      return {
        type: "validation_error",
        message: 'markdown_viewer.args must include "{file}" placeholder'
      };
    }
  }
  if (obj.mode !== void 0 && !VALID_MARKDOWN_VIEWER_MODES.has(obj.mode)) {
    return {
      type: "validation_error",
      message: "markdown_viewer.mode must be inline|blocking|external"
    };
  }
  return null;
}
function validateMermaidRendererBlock(raw) {
  if (!isPlainObject(raw)) {
    return { type: "validation_error", message: "mermaid_renderer must be an object" };
  }
  const obj = raw;
  const allowed = /* @__PURE__ */ new Set(["preset", "command", "args", "mode"]);
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      return {
        type: "validation_error",
        message: `Unknown key in mermaid_renderer: "${k}"`
      };
    }
  }
  if (obj.preset !== void 0 && typeof obj.preset !== "string") {
    return { type: "validation_error", message: "mermaid_renderer.preset must be a string" };
  }
  if (obj.command !== void 0 && typeof obj.command !== "string") {
    return { type: "validation_error", message: "mermaid_renderer.command must be a string" };
  }
  if (obj.args !== void 0) {
    if (!Array.isArray(obj.args) || obj.args.some((a) => typeof a !== "string")) {
      return {
        type: "validation_error",
        message: "mermaid_renderer.args must be an array of strings"
      };
    }
    if (!obj.args.includes("{file}")) {
      return {
        type: "validation_error",
        message: 'mermaid_renderer.args must include "{file}" placeholder'
      };
    }
  }
  if (obj.mode !== void 0 && !VALID_MERMAID_RENDERER_MODES.has(obj.mode)) {
    return {
      type: "validation_error",
      message: "mermaid_renderer.mode must be inline|blocking|external"
    };
  }
  return null;
}
function validateEffortAndModelBag(raw, path) {
  if (!isPlainObject(raw)) {
    return { type: "validation_error", message: `${path} must be an object` };
  }
  const obj = raw;
  const allowed = /* @__PURE__ */ new Set(["model", "effort", "max_retries", "by_tier"]);
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      return {
        type: "validation_error",
        message: `Unknown key in ${path}: "${k}"`
      };
    }
  }
  if (obj.effort !== void 0 && !VALID_EFFORTS.has(obj.effort)) {
    return {
      type: "validation_error",
      message: `${path}.effort must be low|medium|high|xhigh|max`
    };
  }
  if (obj.max_retries !== void 0 && typeof obj.max_retries !== "number") {
    return { type: "validation_error", message: `${path}.max_retries must be a number` };
  }
  if (obj.model !== void 0 && typeof obj.model !== "string") {
    return { type: "validation_error", message: `${path}.model must be a string` };
  }
  if (obj.by_tier !== void 0) {
    return validateByTier(obj.by_tier, `${path}.by_tier`);
  }
  return null;
}
function validateByTier(raw, path) {
  if (!isPlainObject(raw)) {
    return { type: "validation_error", message: `${path} must be an object` };
  }
  const obj = raw;
  const VALID_TIERS = /* @__PURE__ */ new Set(["S", "M", "L"]);
  for (const [tier, value] of Object.entries(obj)) {
    if (!VALID_TIERS.has(tier)) {
      return {
        type: "validation_error",
        message: `${path}.${tier} \u2014 tier must be S, M, or L`
      };
    }
    if (!isPlainObject(value)) {
      return {
        type: "validation_error",
        message: `${path}.${tier} must be an object`
      };
    }
    const tierCfg = value;
    const allowed = /* @__PURE__ */ new Set(["model", "effort", "max_retries"]);
    for (const k of Object.keys(tierCfg)) {
      if (!allowed.has(k)) {
        return {
          type: "validation_error",
          message: `Unknown key in ${path}.${tier}: "${k}"`
        };
      }
    }
    if (tierCfg.effort !== void 0 && !VALID_EFFORTS.has(tierCfg.effort)) {
      return {
        type: "validation_error",
        message: `${path}.${tier}.effort must be low|medium|high|xhigh|max`
      };
    }
    if (tierCfg.max_retries !== void 0 && typeof tierCfg.max_retries !== "number") {
      return {
        type: "validation_error",
        message: `${path}.${tier}.max_retries must be a number`
      };
    }
    if (tierCfg.model !== void 0 && typeof tierCfg.model !== "string") {
      return {
        type: "validation_error",
        message: `${path}.${tier}.model must be a string`
      };
    }
  }
  return null;
}
function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function mergeConfigs(user, project) {
  return deepMerge(user, project);
}
function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, bv] of Object.entries(b)) {
    const av = out[k];
    if (isPlainObject(av) && isPlainObject(bv)) {
      out[k] = deepMerge(av, bv);
    } else {
      out[k] = bv;
    }
  }
  return out;
}
async function loadMergedConfig(projectRoot, harnessVersion) {
  const projectResult = await loadConfig(projectRoot, harnessVersion);
  if (!projectResult.ok) return projectResult;
  const userResult = await readUserConfig();
  if (userResult.parseError) {
    return {
      ok: false,
      error: {
        type: "parse_error",
        message: `user config parse error: ${userResult.parseError}`
      }
    };
  }
  const merged = mergeConfigs(userResult.config, projectResult.config);
  const validated = validateConfig(merged, projectRoot, { source: "merged" });
  if (!validated.ok) return validated;
  return {
    ok: true,
    config: validated.config,
    warnings: [...projectResult.warnings, ...validated.warnings]
  };
}
function errVal(message) {
  return { ok: false, error: { type: "validation_error", message } };
}
function satisfiesVersion(installed, constraint) {
  const match = constraint.match(/^>=(\d+\.\d+\.\d+)$/);
  if (!match) return true;
  const required = match[1];
  return compareVersions(installed, required) >= 0;
}
function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}
async function resolveMemoryProvider(config, registry, ctx = { warnings: [] }) {
  const selection = config.memory_provider;
  if (!selection || typeof selection !== "string") {
    return registry.tryGet("memory_provider", "local");
  }
  const found = registry.tryGet("memory_provider", selection);
  if (found !== void 0) {
    return found;
  }
  if (!ctx._seenBadMemoryProviders) {
    ctx._seenBadMemoryProviders = /* @__PURE__ */ new Set();
  }
  if (!ctx._seenBadMemoryProviders.has(selection)) {
    ctx._seenBadMemoryProviders.add(selection);
    ctx.warnings.push(
      `memory_provider "${selection}" is not installed; falling back to local.`
    );
  }
  return registry.tryGet("memory_provider", "local");
}

// src/ui/live-region.ts
var ANSI_CURSOR_UP = (n) => `\x1B[${n}A`;
var ANSI_CLEAR_LINE = "\x1B[2K";
var ANSI_CURSOR_START = "\r";
function createLiveRegion(options = {}) {
  const stream = options.stream ?? process.stdout;
  const isTTY = options.forceTTY ?? Boolean(stream.isTTY);
  let lastLines = [];
  let suspended = false;
  function write(s) {
    stream.write(s);
  }
  function renderLines(lines) {
    for (const line of lines) {
      write(line);
      write("\n");
    }
  }
  function eraseRegion() {
    if (lastLines.length === 0) return;
    write(ANSI_CURSOR_START);
    write(ANSI_CURSOR_UP(lastLines.length));
    for (let i = 0; i < lastLines.length; i++) {
      write(ANSI_CLEAR_LINE);
      if (i < lastLines.length - 1) write("\n");
    }
    write(ANSI_CURSOR_START);
    if (lastLines.length > 1) write(ANSI_CURSOR_UP(lastLines.length - 1));
  }
  return {
    update(lines) {
      if (suspended) {
        lastLines = lines;
        return;
      }
      if (!isTTY) {
        if (arraysEqual(lines, lastLines)) return;
        renderLines(lines);
        lastLines = lines;
        return;
      }
      if (arraysEqual(lines, lastLines)) return;
      eraseRegion();
      renderLines(lines);
      lastLines = lines;
    },
    clear() {
      if (suspended) {
        lastLines = [];
        return;
      }
      if (isTTY) eraseRegion();
      lastLines = [];
    },
    log(line) {
      if (suspended || !isTTY) {
        write(line);
        write("\n");
        return;
      }
      const snapshot = lastLines;
      eraseRegion();
      lastLines = [];
      write(line);
      write("\n");
      if (snapshot.length > 0) {
        renderLines(snapshot);
        lastLines = snapshot;
      }
    },
    suspend() {
      if (suspended) return;
      if (isTTY) eraseRegion();
      suspended = true;
    },
    resume() {
      if (!suspended) return;
      suspended = false;
      if (isTTY && lastLines.length > 0) {
        const snapshot = lastLines;
        lastLines = [];
        renderLines(snapshot);
        lastLines = snapshot;
      }
    },
    stop() {
      suspended = false;
    }
  };
}
function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// src/engine/plugin-loader.ts
import { readdirSync, existsSync as existsSync3 } from "fs";
import { join as join18 } from "path";

// src/engine/plugin-manifest.ts
import { satisfies } from "semver";
import { readFileSync } from "fs";
import { dirname as dirname3, join as join17 } from "path";
import { fileURLToPath } from "url";
import { load } from "js-yaml";
var __dirname = dirname3(fileURLToPath(import.meta.url));
function resolveHarnessVersion() {
  for (const rel of ["../../../VERSION", "../../../../VERSION"]) {
    try {
      const v = readFileSync(join17(__dirname, rel), "utf-8").trim();
      if (/^\d+\.\d+\.\d+/.test(v)) return v;
    } catch {
    }
  }
  return "0.0.0";
}
var HARNESS_VERSION = resolveHarnessVersion();
function validateManifest(raw) {
  if (typeof raw !== "object" || raw === null) {
    throw new PluginManifestError("Manifest must be an object");
  }
  const manifest = raw;
  if (!("kind" in manifest)) {
    throw new PluginManifestError("Manifest must have required field: kind");
  }
  if (!("name" in manifest)) {
    throw new PluginManifestError("Manifest must have required field: name");
  }
  if (!("entrypoint" in manifest)) {
    throw new PluginManifestError("Manifest must have required field: entrypoint");
  }
  const kind = manifest.kind;
  if (!VALID_PLUGIN_KINDS.includes(kind)) {
    throw new PluginManifestError(
      `Invalid kind "${kind}". Valid kinds are: ${VALID_PLUGIN_KINDS.join(", ")}`
    );
  }
  const name = manifest.name;
  const namePattern = /^[a-z0-9-]+$/;
  if (typeof name !== "string" || !namePattern.test(name)) {
    throw new PluginManifestError(
      `Invalid name "${name}". Name must match pattern [a-z0-9-]+`
    );
  }
  if ("harness_version" in manifest && manifest.harness_version !== void 0) {
    const requiredRange = manifest.harness_version;
    if (!satisfies(HARNESS_VERSION, requiredRange)) {
      throw new PluginVersionError(
        `Plugin requires harness ${requiredRange}, but harness is ${HARNESS_VERSION}`,
        HARNESS_VERSION,
        requiredRange
      );
    }
  }
  return manifest;
}
function loadManifestFromFile(filePath) {
  let content;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new PluginManifestError(`Failed to read manifest file ${filePath}: ${message}`, filePath);
  }
  let raw;
  try {
    raw = load(content);
  } catch (err) {
    const yamlError = err instanceof Error ? err.message : String(err);
    throw new PluginManifestError(`Invalid YAML in ${filePath}: ${yamlError}`, filePath);
  }
  try {
    return validateManifest(raw);
  } catch (err) {
    if (err instanceof PluginManifestError) {
      throw new PluginManifestError(`${err.message} (from ${filePath})`, filePath);
    }
    throw err;
  }
}

// src/execution/claude-provider.ts
import { execa as execa4 } from "execa";
var RATE_LIMIT_RE = /rate limit|429|overloaded|usage limit/i;
var STALE_SESSION_RE = /No conversation found/i;
var SESSION_IN_USE_RE = /\balready in use\b|\b(session|conversation)\b[^\n]{0,60}\bin use\b/i;
var AUTH_FAILURE_RE = /not logged in|invalid api key|please run \/login/i;
var MODEL_UNAVAILABLE_RE = /not_found_error.{0,80}model|model not found|invalid model( name)?|issue with the selected model|may not exist or you may not have access/i;
function parseTokenUsage(stdout) {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.type === "usage" && typeof parsed.input_tokens === "number" && typeof parsed.output_tokens === "number") {
        const usage = {
          input: parsed.input_tokens,
          output: parsed.output_tokens
        };
        if (typeof parsed.cache_read_input_tokens === "number") {
          usage.cacheRead = parsed.cache_read_input_tokens;
        }
        if (typeof parsed.cache_creation_input_tokens === "number") {
          usage.cacheCreation = parsed.cache_creation_input_tokens;
        }
        return usage;
      }
    } catch {
    }
  }
  return void 0;
}
var ClaudeProvider = class {
  /**
   * Run Claude with --print mode. Captures output for analysis.
   * Used only for truly non-interactive one-shot queries.
   */
  async invoke(options) {
    const args = this.buildArgs(options);
    if (options.prompt) {
      args.push("--print", "--output-format", "text", "-p", options.prompt);
    }
    const result = await execa4("claude", args, {
      reject: false,
      stdin: "ignore",
      stdout: ["pipe", "inherit"],
      stderr: ["pipe", "inherit"],
      env: this.buildEnv(options),
      cwd: options.cwd
    });
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    const exitCode = result.exitCode ?? 1;
    const output = stderr ? `${stdout}
${stderr}`.trim() : stdout;
    if (exitCode === 127 || /ENOENT|not found/i.test(stderr)) {
      return {
        success: false,
        output: "LLM provider 'claude' not found. Install it or check your PATH.",
        exitCode
      };
    }
    const authFailure = exitCode !== 0 && AUTH_FAILURE_RE.test(output);
    const modelUnavailable = exitCode !== 0 && MODEL_UNAVAILABLE_RE.test(output);
    const rateLimited = exitCode !== 0 && RATE_LIMIT_RE.test(output);
    const sessionExpired = STALE_SESSION_RE.test(output) || SESSION_IN_USE_RE.test(output);
    const tokenUsage = parseTokenUsage(stdout);
    return {
      success: exitCode === 0,
      output,
      exitCode,
      authFailure: authFailure || void 0,
      rateLimited: rateLimited || void 0,
      sessionExpired: sessionExpired || void 0,
      modelUnavailable: modelUnavailable || void 0,
      tokenUsage
    };
  }
  /**
   * Run Claude with stdio inherited — user sees output live.
   *
   * Default: every step uses `-p` (print mode) so the session exits when the
   * skill completes. Matches bin/conduct; prevents the harness from hanging
   * waiting for `/quit`. The autonomous vs. collaborative distinction is
   * purely about the `--dangerously-skip-permissions` flag — collaborative
   * steps still see Claude's permission prompts on the shared terminal.
   *
   * `interactive: true` is a deliberate opt-in (used by the recovery menu's
   * "interactive fix" option) that opens a REPL instead of auto-exiting, so
   * the user can debug with Claude manually.
   */
  async invokeInteractive(options) {
    const args = this.buildArgs(options);
    if (options.prompt) {
      if (options.interactive) {
        args.push(options.prompt);
      } else {
        args.push("-p", options.prompt);
      }
    }
    await execa4("claude", args, {
      stdio: options.interactive ? "inherit" : ["ignore", "inherit", "inherit"],
      reject: false,
      env: this.buildEnv(options),
      cwd: options.cwd
    });
  }
  buildArgs(options) {
    const args = [];
    if (options.resume) {
      args.push("--resume", options.sessionId);
    } else {
      args.push("--session-id", options.sessionId);
    }
    if (options.dangerouslySkipPermissions) {
      args.push("--dangerously-skip-permissions");
    }
    if (options.sessionName) {
      args.push("--name", options.sessionName);
    }
    if (options.systemPrompt) {
      args.push("--append-system-prompt", options.systemPrompt);
    }
    if (options.model) {
      args.push("--model", options.model);
    }
    return args;
  }
  /**
   * Build an env overlay for the Claude subprocess. We pass effort via
   * CLAUDE_CODE_EFFORT_LEVEL because (a) it overrides settings.json + skill
   * frontmatter, and (b) it cascades to subagents spawned inside the session
   * (so e.g. assess's CTO subagents inherit the parent step's effort).
   *
   * Returns undefined when no override is needed so execa uses the default
   * inherited environment.
   */
  buildEnv(options) {
    if (!options.effort) return void 0;
    return { ...process.env, CLAUDE_CODE_EFFORT_LEVEL: options.effort };
  }
};

// src/ui/subscriber.ts
var TerminalSubscriber = class {
  eventEmitter;
  onRender;
  handlers = [];
  constructor(eventEmitter, onRender) {
    this.eventEmitter = eventEmitter;
    this.onRender = onRender;
  }
  start() {
    const eventTypes = [
      "step_started",
      "step_completed",
      "step_failed",
      "step_retry",
      "checkpoint_reached",
      "recovery_needed",
      "dashboard_refresh",
      "tier_skip",
      "config_skip",
      "gate_blocked",
      "rate_limit",
      "session_reset",
      "feature_complete",
      "auto_heal",
      "mode_skip",
      "build_stall"
    ];
    for (const type of eventTypes) {
      const handler = (event) => this.onRender(event);
      this.handlers.push({ type, handler });
      this.eventEmitter.on(type, handler);
    }
  }
  stop() {
    for (const { type, handler } of this.handlers) {
      this.eventEmitter.off(type, handler);
    }
    this.handlers = [];
  }
};

// src/ui/terminal-renderer.ts
import chalk2 from "chalk";
import ora from "ora";

// src/ui/dashboard-text.ts
import chalk from "chalk";

// src/ui/dashboard-snapshot.ts
function buildDashboardSnapshot(state, steps, featureName, artifacts) {
  const stepSnapshots = steps.map((step) => {
    const status = state[step.name] ?? "pending";
    const stepArtifacts = artifacts?.[step.name];
    const snap = {
      name: step.name,
      label: step.label,
      phase: step.phase,
      status
    };
    if (stepArtifacts && hasAttempted(status)) {
      snap.artifacts = stepArtifacts;
    }
    return snap;
  });
  return {
    featureName,
    complexityTier: state.complexity_tier,
    steps: stepSnapshots
  };
}
function hasAttempted(status) {
  return status === "done" || status === "failed" || status === "stale" || status === "in_progress";
}

// src/ui/dashboard-text.ts
var ICONS = {
  done: chalk.green("\u2713"),
  in_progress: chalk.cyan("\u25B6"),
  pending: chalk.dim("\u2B1A"),
  skipped: chalk.gray("\u2192"),
  stale: chalk.yellow("\u26A0"),
  failed: chalk.red("\u2717")
};
var SEPARATOR = chalk.dim("\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501");
function formatDashboardSnapshot(snapshot, opts = {}) {
  const viewMode = opts.viewMode ?? "full";
  const tailLines = opts.tailLines ?? 20;
  if (viewMode === "log") {
    return formatLogPane(snapshot, tailLines);
  }
  const lines = [];
  lines.push(...formatHeader(snapshot));
  if (snapshot.currentStep) {
    lines.push(...formatCurrentStep(snapshot.currentStep));
    lines.push("");
  }
  if (viewMode === "full") {
    lines.push(...formatStepList(snapshot));
  }
  if (snapshot.lastStepTail && tailLines > 0) {
    lines.push(...formatLastStepTail(snapshot.lastStepTail, tailLines));
  }
  return lines;
}
function formatHeader(snapshot) {
  const lines = [];
  const name = snapshot.featureName ?? "(resuming)";
  const headerParts = [`  ${chalk.bold("Conductor:")} ${name}`];
  if (snapshot.complexityTier) {
    headerParts.push(`Tier: ${chalk.bold(snapshot.complexityTier)}`);
  }
  lines.push(SEPARATOR);
  lines.push(headerParts.join("  |  "));
  lines.push(SEPARATOR);
  lines.push("");
  return lines;
}
function formatCurrentStep(current) {
  const started = new Date(current.startedAtMs);
  const hh = String(started.getHours()).padStart(2, "0");
  const mm = String(started.getMinutes()).padStart(2, "0");
  const ss = String(started.getSeconds()).padStart(2, "0");
  return [`  ${chalk.cyan("\u25B6")} ${chalk.bold(current.label)} ${chalk.dim(`\u2014 started ${hh}:${mm}:${ss}`)}`];
}
function formatStepList(snapshot) {
  const lines = [];
  let currentPhase = null;
  for (const step of snapshot.steps) {
    if (step.phase !== currentPhase) {
      currentPhase = step.phase;
      lines.push(`  ${chalk.bold(currentPhase)}`);
    }
    lines.push(...formatStep(step));
  }
  return lines;
}
function formatStep(step) {
  const icon = ICONS[step.status] ?? ICONS.pending;
  const suffix = step.status === "in_progress" ? chalk.dim(" \u2014 running...") : "";
  const lines = [`    ${icon} ${step.label}${suffix}`];
  if (step.artifacts) {
    for (const a of step.artifacts) {
      lines.push(...renderArtifactPattern(a));
    }
  }
  return lines;
}
function renderArtifactPattern(status) {
  if (!status.satisfied) {
    return [`        ${chalk.red("\u2717")} ${status.pattern} \u2014 missing`];
  }
  if (status.files.length === 1) {
    return [`        ${chalk.green("\u2713")} ${status.files[0]}`];
  }
  const lines = [`        ${chalk.green("\u2713")} ${status.pattern} (${status.files.length} files)`];
  for (const f of status.files.slice(0, 3)) {
    lines.push(`            \u2022 ${f}`);
  }
  if (status.files.length > 3) {
    lines.push(chalk.dim(`            \u2026 +${status.files.length - 3} more`));
  }
  return lines;
}
function formatLastStepTail(tail, tailLines) {
  const lines = [];
  lines.push("");
  lines.push(chalk.dim(`  Last step output (${tail.step}), last ${Math.min(tail.lines.length, tailLines)} line(s):`));
  for (const line of tail.lines.slice(-tailLines)) {
    lines.push(chalk.dim(`    > ${line}`));
  }
  return lines;
}
function formatLogPane(snapshot, tailLines) {
  if (!snapshot.lastStepTail || tailLines <= 0) {
    return [chalk.dim("  (no step output yet)")];
  }
  const lines = [];
  lines.push(chalk.dim(`  ${snapshot.lastStepTail.step} \u2014 last ${Math.min(snapshot.lastStepTail.lines.length, tailLines)} line(s):`));
  for (const line of snapshot.lastStepTail.lines.slice(-tailLines)) {
    lines.push(chalk.dim(`  > ${line}`));
  }
  return lines;
}

// src/ui/terminal-renderer.ts
var TerminalRenderer = class {
  name = "terminal";
  stateFilePath;
  featureDesc;
  steps;
  readStateFn;
  notifyFn;
  projectRoot;
  region;
  viewMode;
  tailLines;
  currentStep;
  lastStepTail;
  spinner = null;
  constructor(opts) {
    this.stateFilePath = opts.stateFilePath;
    this.featureDesc = opts.featureDesc;
    this.steps = opts.steps;
    this.readStateFn = opts.readStateFn;
    this.notifyFn = opts.notifyFn;
    this.projectRoot = opts.projectRoot;
    this.region = opts.liveRegion ?? createLiveRegion();
    this.viewMode = opts.viewMode ?? "full";
    this.tailLines = opts.tailLines ?? 20;
  }
  stopSpinner() {
    if (this.spinner) {
      this.spinner.stop();
      this.spinner = null;
    }
  }
  notify(title, message) {
    if (this.notifyFn) this.notifyFn(title, message).catch(() => {
    });
  }
  async collectArtifacts() {
    if (!this.projectRoot) return void 0;
    const out = {};
    for (const step of this.steps) {
      const globs = STEP_ARTIFACT_GLOBS[step.name];
      if (!globs || globs.length === 0) continue;
      out[step.name] = await getArtifactStatus(this.projectRoot, step.name);
    }
    return out;
  }
  async renderDashboard() {
    const stateResult = await this.readStateFn(this.stateFilePath);
    const state = stateResult.ok ? stateResult.value : {};
    const artifacts = await this.collectArtifacts();
    const base = buildDashboardSnapshot(state, this.steps, this.featureDesc, artifacts);
    const snapshot = { ...base, currentStep: this.currentStep, lastStepTail: this.lastStepTail };
    const lines = formatDashboardSnapshot(snapshot, { viewMode: this.viewMode, tailLines: this.tailLines });
    this.region.update(lines);
  }
  async handle(event) {
    if (event.type !== "rate_limit" && this.spinner) {
      this.stopSpinner();
    }
    switch (event.type) {
      case "step_started": {
        const def = this.steps.find((s) => s.name === event.step);
        this.currentStep = {
          name: event.step,
          label: def?.label ?? event.step,
          startedAtMs: Date.now()
        };
        this.region.log(`  ${chalk2.cyan("\u25B6")} ${def?.label ?? event.step} ${chalk2.dim("\u2014 running...")}`);
        this.region.suspend();
        break;
      }
      case "step_completed":
        this.currentStep = void 0;
        if (event.tail && event.tail.length > 0) {
          this.lastStepTail = { step: event.step, lines: event.tail };
        }
        this.region.resume();
        await this.renderDashboard();
        this.notify("Conductor", `Step completed: ${event.step}`);
        break;
      case "step_failed":
        this.currentStep = void 0;
        this.region.resume();
        this.region.log("");
        this.region.log(chalk2.bold.red("\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501"));
        this.region.log(chalk2.bold.red(`  \u2717 STEP FAILED: ${event.step}`));
        this.region.log(chalk2.bold.red("\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501"));
        if (event.error) {
          this.region.log(chalk2.red("  Error output:"));
          for (const line of event.error.split("\n")) this.region.log(chalk2.red(`    ${line}`));
        }
        this.region.log("");
        await this.renderDashboard();
        this.notify("Conductor", `Step failed: ${event.step}`);
        break;
      case "step_retry":
        this.region.log(
          chalk2.yellow(`  \u21BB ${event.step} \u2014 retry ${event.attempt}/${event.maxAttempts}: ${event.reason}`)
        );
        break;
      case "rate_limit": {
        const mins = Math.ceil(event.waitSeconds / 60);
        this.stopSpinner();
        this.region.suspend();
        this.spinner = ora(chalk2.yellow(`Rate limited \u2014 resuming in ~${mins}m (${event.waitSeconds}s)`)).start();
        this.notify("Conductor", `Rate limited \u2014 resuming in ~${mins}m`);
        break;
      }
      case "session_reset":
        this.region.log(chalk2.yellow(`  \u27F3  Session reset: ${event.reason}`));
        break;
      case "tier_skip":
      case "config_skip":
      case "gate_blocked":
        this.currentStep = void 0;
        await this.renderDashboard();
        break;
      case "feature_complete": {
        this.currentStep = void 0;
        await this.renderDashboard();
        const title = event.featureDesc ? `   FEATURE COMPLETE: ${event.featureDesc}   ` : "   FEATURE COMPLETE   ";
        const minWidth = Math.max(title.length, 44);
        const bar = " ".repeat(minWidth);
        const padded = title.padEnd(minWidth, " ");
        const lines = [
          "",
          chalk2.bold.bgGreen.black(bar),
          chalk2.bold.bgGreen.black(padded),
          chalk2.bold.bgGreen.black(bar),
          "",
          chalk2.green(
            event.prUrl ? `  PR: ${event.prUrl}` : "  No PR (chosen outcome was merge-local / keep / discard)."
          ),
          chalk2.dim(
            "  All 14 steps verified. Re-run with --fresh to start a new feature."
          ),
          ""
        ];
        this.region.log(lines.join("\n"));
        this.notify(
          "Conductor",
          event.featureDesc ? `Feature complete: ${event.featureDesc}` : "Pipeline complete!"
        );
        break;
      }
      case "dashboard_refresh":
        await this.renderDashboard();
        break;
      case "checkpoint_reached":
        this.region.log(chalk2.dim(`
\u2500\u2500 Checkpoint: ${event.step} complete \u2500\u2500`));
        break;
      case "renderer_error":
        this.region.log(chalk2.yellow(`  \u26A0 Renderer error [${event.rendererName}]: ${event.error}`));
        break;
      case "gate_verdict":
        if (!event.satisfied) {
          this.region.log(
            chalk2.dim(`  gate ${event.step}: unsatisfied${event.reason ? ` \u2014 ${event.reason}` : ""}`)
          );
        }
        break;
      case "kickback":
        this.region.log(
          chalk2.yellow(
            `  \u21A9 kickback: ${event.from} re-opened ${event.to}${event.evidence ? ` \u2014 ${event.evidence}` : ""} (\xD7${event.count})`
          )
        );
        break;
      case "loop_halt":
        this.region.log(chalk2.red(`  \u270B loop halted: ${event.reason}`));
        break;
      case "loop_converged":
        this.region.log(chalk2.green("  \u2713 gate loop converged"));
        break;
    }
  }
  stop() {
    this.stopSpinner();
    this.region.clear();
  }
};

// src/engine/local-memory-provider.ts
var LocalMemoryProvider = {
  /** Plugin kind — identifies this as a memory provider. */
  kind: "memory_provider",
  /** Provider name — used as the registry key. */
  name: "local"
};

// src/engine/plugin-loader.ts
async function loadPluginModule(pluginDir, manifest) {
  const entrypointPath = join18(pluginDir, manifest.entrypoint);
  try {
    const mod = await import(entrypointPath);
    const plugin = mod.default || mod;
    if (manifest.kind === "llm_provider") {
      if (typeof plugin.invoke !== "function") {
        throw new PluginLoadError(
          `Plugin ${manifest.name} missing required method: invoke`
        );
      }
      if (typeof plugin.invokeInteractive !== "function") {
        throw new PluginLoadError(
          `Plugin ${manifest.name} missing required method: invokeInteractive`
        );
      }
    }
    return plugin;
  } catch (err) {
    if (err instanceof PluginLoadError) {
      throw err;
    }
    throw new PluginLoadError(
      `Failed to load plugin ${manifest.name} from ${entrypointPath}: ${String(err)}`
    );
  }
}
async function discoverPlugins(globalDir, projectDir, registry) {
  if (existsSync3(globalDir)) {
    const entries = readdirSync(globalDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const pluginPath = join18(globalDir, entry.name);
        const manifestPath = join18(pluginPath, "plugin.yml");
        try {
          const manifest = loadManifestFromFile(manifestPath);
          const plugin = await loadPluginModule(pluginPath, manifest);
          registry.register(manifest.kind, manifest.name, plugin);
        } catch (err) {
          if (err instanceof PluginManifestError) {
            console.warn(`Skipping plugin ${entry.name}: ${err.message}`);
          } else if (err instanceof PluginVersionError || err instanceof PluginLoadError) {
            throw err;
          }
        }
      }
    }
  }
  if (existsSync3(projectDir)) {
    const entries = readdirSync(projectDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const pluginPath = join18(projectDir, entry.name);
        const manifestPath = join18(pluginPath, "plugin.yml");
        try {
          const manifest = loadManifestFromFile(manifestPath);
          const plugin = await loadPluginModule(pluginPath, manifest);
          const globalPlugins = registry.list(manifest.kind);
          if (globalPlugins.includes(manifest.name)) {
            console.debug(
              `Plugin shadowing: kind=${manifest.kind}, name=${manifest.name}; project-local at ${projectDir} overrides global at ${globalDir}`
            );
          }
          registry.register(manifest.kind, manifest.name, plugin);
        } catch (err) {
          if (err instanceof PluginManifestError) {
            console.warn(`Skipping plugin ${entry.name}: ${err.message}`);
          } else if (err instanceof PluginVersionError || err instanceof PluginLoadError) {
            throw err;
          }
        }
      }
    }
  }
}
function registerBuiltins(registry, events, renderEvent, rendererOpts) {
  registry.register("llm_provider", "claude", new ClaudeProvider());
  const subscriber = new TerminalSubscriber(events, renderEvent);
  registry.register("ui_renderer", "terminal", subscriber);
  if (rendererOpts) {
    const terminalRenderer = new TerminalRenderer(rendererOpts);
    registry.register("ui_renderer", "terminal_renderer", terminalRenderer);
  }
  registry.register("memory_provider", "local", LocalMemoryProvider);
  return subscriber;
}

// src/engine/plugin-registry.ts
var PluginRegistry = class {
  plugins = /* @__PURE__ */ new Map();
  initialized = false;
  /**
   * Registers a plugin instance with a specific kind and name.
   * Can be called multiple times with the same kind+name to override (overwrite).
   *
   * @param kind The plugin kind (e.g., 'llm_provider', 'ui_renderer')
   * @param name The plugin name (e.g., 'claude', 'terminal')
   * @param instance The plugin instance
   */
  register(kind, name, instance) {
    if (!this.plugins.has(kind)) {
      this.plugins.set(kind, /* @__PURE__ */ new Map());
    }
    const kindMap = this.plugins.get(kind);
    kindMap.set(name, instance);
  }
  /**
   * Retrieves a registered plugin by kind and name.
   *
   * @param kind The plugin kind
   * @param name The plugin name
   * @returns The registered plugin instance, typed as T
   * @throws PluginRegistryError if registry has not been initialized
   * @throws PluginNotFoundError if the plugin is not registered
   */
  get(kind, name) {
    if (!this.initialized) {
      throw new PluginRegistryError("Cannot get plugin before registry is initialized via markInitialized()");
    }
    const kindMap = this.plugins.get(kind);
    if (!kindMap || !kindMap.has(name)) {
      const available = this.list(kind);
      throw new PluginNotFoundError(
        `Plugin not found: ${kind}:${name}. Available: ${available.join(", ") || "(none)"}`,
        kind,
        name
      );
    }
    return kindMap.get(name);
  }
  /**
   * Retrieves a registered plugin by kind and name WITHOUT requiring the registry
   * to be initialized. Returns `undefined` when the plugin is not found.
   *
   * This is the lookup used by total resolver functions (e.g. `resolveMemoryProvider`)
   * that must return a safe default even when the registry is still being built.
   * For normal consumption after initialization, use `get()` instead.
   *
   * @param kind The plugin kind
   * @param name The plugin name
   * @returns The registered plugin instance, or `undefined` if not found
   */
  tryGet(kind, name) {
    const kindMap = this.plugins.get(kind);
    if (!kindMap || !kindMap.has(name)) return void 0;
    return kindMap.get(name);
  }
  /**
   * Lists all registered plugin names for a given kind.
   *
   * @param kind The plugin kind
   * @returns Array of registered plugin names for the kind, in registration order
   */
  list(kind) {
    const kindMap = this.plugins.get(kind);
    if (!kindMap) {
      return [];
    }
    return Array.from(kindMap.keys());
  }
  /**
   * Marks the registry as initialized and read-only.
   * After this is called, new plugins cannot be registered.
   *
   * @throws PluginRegistryError if already initialized
   */
  markInitialized() {
    if (this.initialized) {
      throw new PluginRegistryError("Registry is already initialized");
    }
    this.initialized = true;
  }
};

// src/engine/report-renderer.ts
import { readFileSync as readFileSync2 } from "fs";
var ReportError = class extends Error {
  constructor(filePath, cause) {
    super(
      `No event log found at ${filePath}` + (cause instanceof Error ? `: ${cause.message}` : "")
    );
    this.name = "ReportError";
  }
};
function parseEvents(raw) {
  const events = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
    }
  }
  return events;
}
function aggregateDurations(events) {
  const startTimes = /* @__PURE__ */ new Map();
  const completeTimes = /* @__PURE__ */ new Map();
  for (const evt of events) {
    if (!evt.step) continue;
    if (evt.type === "step_started") {
      startTimes.set(evt.step, new Date(evt.ts).getTime());
    } else if (evt.type === "step_completed") {
      completeTimes.set(evt.step, new Date(evt.ts).getTime());
    }
  }
  const out = {};
  for (const [step, startMs] of startTimes.entries()) {
    const endMs = completeTimes.get(step);
    if (endMs !== void 0) out[step] = endMs - startMs;
  }
  return out;
}
function aggregateRetryHotspots(events) {
  const retryCounts = /* @__PURE__ */ new Map();
  const retryReasons = /* @__PURE__ */ new Map();
  for (const evt of events) {
    if (!evt.step || evt.type !== "step_retry") continue;
    retryCounts.set(evt.step, (retryCounts.get(evt.step) ?? 0) + 1);
    const reason = evt.reason ?? "unknown";
    let reasons = retryReasons.get(evt.step);
    if (!reasons) {
      reasons = /* @__PURE__ */ new Map();
      retryReasons.set(evt.step, reasons);
    }
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  const out = [];
  for (const [step, count] of retryCounts.entries()) {
    const reasons = retryReasons.get(step) ?? /* @__PURE__ */ new Map();
    let topReason = "";
    let topCount = 0;
    for (const [r, c] of reasons.entries()) {
      if (c > topCount) {
        topCount = c;
        topReason = r;
      }
    }
    out.push({ step, count, topReason });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}
function aggregateTokens(events) {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  for (const evt of events) {
    if (evt.type === "step_completed" && evt.step && evt.tokenUsage) {
      const u = evt.tokenUsage;
      totals.input += u.input ?? 0;
      totals.output += u.output ?? 0;
      totals.cacheRead += u.cacheRead ?? 0;
      totals.cacheCreation += u.cacheCreation ?? 0;
    }
  }
  return totals;
}
function aggregateKickbacks(events) {
  const out = [];
  for (const evt of events) {
    if (evt.type !== "kickback") continue;
    const from = typeof evt.from === "string" ? evt.from : "";
    const to = typeof evt.to === "string" ? evt.to : "";
    const count = typeof evt.count === "number" ? evt.count : 1;
    const entry = { from, to, count };
    if (typeof evt.evidence === "string") entry.evidence = evt.evidence;
    out.push(entry);
  }
  return out;
}
function aggregateHalts(events) {
  const out = [];
  for (const evt of events) {
    if (evt.type !== "loop_halt") continue;
    out.push({ reason: typeof evt.reason === "string" ? evt.reason : "unknown" });
  }
  return out;
}
function renderReport(eventsJsonlPath) {
  let raw;
  try {
    raw = readFileSync2(eventsJsonlPath, "utf-8");
  } catch (err) {
    throw new ReportError(eventsJsonlPath, err);
  }
  const events = parseEvents(raw);
  const sections = [];
  sections.push(renderDurations(events));
  sections.push(renderRetries(events));
  sections.push(renderTokenSpend(events));
  return sections.join("\n\n");
}
function renderDurations(events) {
  const startTimes = /* @__PURE__ */ new Map();
  const completeTimes = /* @__PURE__ */ new Map();
  for (const evt of events) {
    if (!evt.step) continue;
    if (evt.type === "step_started") {
      startTimes.set(evt.step, new Date(evt.ts).getTime());
    } else if (evt.type === "step_completed") {
      completeTimes.set(evt.step, new Date(evt.ts).getTime());
    }
  }
  const rows = [];
  for (const [step, startMs] of startTimes.entries()) {
    const endMs = completeTimes.get(step);
    rows.push({
      step,
      durationMs: endMs !== void 0 ? endMs - startMs : null
    });
  }
  rows.sort((a, b) => {
    if (a.durationMs === null && b.durationMs === null) return 0;
    if (a.durationMs === null) return 1;
    if (b.durationMs === null) return -1;
    return b.durationMs - a.durationMs;
  });
  const lines = ["## Step Durations", ""];
  lines.push(padRow(["Step", "Duration (ms)"]));
  lines.push(padRow(["----", "-------------"]));
  for (const row of rows) {
    lines.push(padRow([row.step, row.durationMs !== null ? String(row.durationMs) : "\u2014"]));
  }
  return lines.join("\n");
}
function renderRetries(events) {
  const retryCounts = /* @__PURE__ */ new Map();
  const retryReasons = /* @__PURE__ */ new Map();
  const failedSteps = /* @__PURE__ */ new Set();
  const completedSteps = /* @__PURE__ */ new Set();
  for (const evt of events) {
    if (!evt.step) continue;
    if (evt.type === "step_retry") {
      retryCounts.set(evt.step, (retryCounts.get(evt.step) ?? 0) + 1);
      const reason = evt.reason ?? "unknown";
      let reasons = retryReasons.get(evt.step);
      if (!reasons) {
        reasons = /* @__PURE__ */ new Map();
        retryReasons.set(evt.step, reasons);
      }
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    } else if (evt.type === "step_failed") {
      failedSteps.add(evt.step);
    } else if (evt.type === "step_completed") {
      completedSteps.add(evt.step);
    }
  }
  const lines = ["## Retry Hotspots", ""];
  if (retryCounts.size === 0) {
    lines.push("No retries recorded");
    return lines.join("\n");
  }
  lines.push(padRow(["Step", "Retries", "Top Reason", "Status"]));
  lines.push(padRow(["----", "-------", "----------", "------"]));
  const rows = [];
  for (const [step, count] of retryCounts.entries()) {
    const reasons = retryReasons.get(step) ?? /* @__PURE__ */ new Map();
    let topReason = "";
    let topCount = 0;
    for (const [r, c] of reasons.entries()) {
      if (c > topCount) {
        topCount = c;
        topReason = r;
      }
    }
    const failed = failedSteps.has(step) && !completedSteps.has(step);
    rows.push({ step, count, topReason, failed });
  }
  rows.sort((a, b) => b.count - a.count);
  for (const row of rows) {
    const statusLabel = row.failed ? "(failed)" : "ok";
    lines.push(padRow([row.step, String(row.count), row.topReason, statusLabel]));
  }
  return lines.join("\n");
}
function renderTokenSpend(events) {
  const rows = [];
  for (const evt of events) {
    if (evt.type === "step_completed" && evt.step && evt.tokenUsage) {
      const usage = evt.tokenUsage;
      rows.push({
        step: evt.step,
        input: usage.input,
        output: usage.output,
        cacheRead: usage.cacheRead ?? 0,
        cacheCreation: usage.cacheCreation ?? 0
      });
    }
  }
  const lines = ["## Token Spend", ""];
  if (rows.length === 0) {
    lines.push("No token data recorded");
    return lines.join("\n");
  }
  lines.push(padRow(["Step", "Input", "Output", "CacheRead", "CacheCreation"]));
  lines.push(padRow(["----", "-----", "------", "---------", "-------------"]));
  rows.sort((a, b) => b.input + b.output - (a.input + a.output));
  for (const row of rows) {
    lines.push(padRow([
      row.step,
      String(row.input),
      String(row.output),
      String(row.cacheRead),
      String(row.cacheCreation)
    ]));
  }
  return lines.join("\n");
}
function padRow(cols) {
  return cols.map((c) => c.padEnd(20)).join("  ").trimEnd();
}

// src/engine/blocker-resolver.ts
function refKey(ref) {
  return `${ref.repo}#${ref.number}`;
}
function createBlockerResolver(deps) {
  const memo = /* @__PURE__ */ new Map();
  async function resolveOne(sourceRef) {
    const cached = memo.get(sourceRef);
    if (cached) {
      return cached;
    }
    const verdict = await resolveUncached(sourceRef, deps);
    memo.set(sourceRef, verdict);
    return verdict;
  }
  async function findCycleMembers(startKey, currentRef, visiting) {
    const currentKey = refKey(currentRef);
    if (visiting.has(currentKey)) {
      return null;
    }
    visiting.add(currentKey);
    const verdict = await resolveOne(`${currentRef.repo}#${currentRef.number}`);
    if (verdict.kind !== "blocked") {
      return null;
    }
    for (const blocker of verdict.blockers) {
      const blockerKey = refKey(blocker);
      if (blockerKey === startKey) {
        return [currentRef, blocker];
      }
      const nested = await findCycleMembers(startKey, blocker, visiting);
      if (nested) {
        return [currentRef, ...nested];
      }
    }
    return null;
  }
  return {
    async resolve(sourceRef) {
      const verdict = await resolveOne(sourceRef);
      if (verdict.kind !== "blocked") {
        return verdict;
      }
      const parsed = parseSourceRef(sourceRef);
      if (!parsed) {
        return verdict;
      }
      const startRef = { repo: parsed.repo, number: parsed.number };
      const startKey = refKey(startRef);
      for (const blocker of verdict.blockers) {
        if (refKey(blocker) === startKey) {
          return memoizeCycle(sourceRef, [startRef, blocker]);
        }
        const chain = await findCycleMembers(startKey, blocker, /* @__PURE__ */ new Set([startKey]));
        if (chain) {
          return memoizeCycle(sourceRef, [startRef, ...chain]);
        }
      }
      return verdict;
    }
  };
  function memoizeCycle(sourceRef, rawMembers) {
    const seen = /* @__PURE__ */ new Set();
    const members = rawMembers.filter((m) => {
      const key = refKey(m);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const cycleVerdict = { kind: "cycle", members };
    memo.set(sourceRef, cycleVerdict);
    for (const member of members) {
      memo.set(refKey(member), cycleVerdict);
    }
    return cycleVerdict;
  }
}
async function resolveUncached(sourceRef, deps) {
  const parsed = parseSourceRef(sourceRef);
  if (!parsed) {
    return { kind: "indeterminate", detail: `unparseable sourceRef: ${sourceRef}` };
  }
  const { repo, number } = parsed;
  let stdout;
  try {
    ({ stdout } = await deps.run(["api", `repos/${repo}/issues/${number}/dependencies/blocked_by`]));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { kind: "indeterminate", detail };
  }
  let blockedBy;
  try {
    blockedBy = JSON.parse(stdout);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { kind: "indeterminate", detail: `unparseable blocked_by response: ${detail}` };
  }
  if (!Array.isArray(blockedBy) || blockedBy.length === 0) {
    return { kind: "unblocked" };
  }
  const openBlockers = [];
  for (const item of blockedBy) {
    const entry = item;
    if (entry.state === "closed") continue;
    const repositoryUrl = typeof entry.repository_url === "string" ? entry.repository_url : "";
    const match = repositoryUrl.match(/repos\/([^/]+\/[^/]+)$/);
    const repo2 = match ? match[1] : repositoryUrl;
    const number2 = String(entry.number ?? "");
    openBlockers.push({ repo: repo2, number: number2 });
  }
  if (openBlockers.length > 0) {
    return { kind: "blocked", blockers: openBlockers };
  }
  return { kind: "unblocked" };
}

// src/engine/daemon-command.ts
function flagValue(argv, flag) {
  const idx = argv.indexOf(flag);
  if (idx === -1 || idx >= argv.length - 1) return null;
  const val = argv[idx + 1];
  if (!val || val.startsWith("--")) return null;
  return val;
}
function intFlag(argv, flag, fallback) {
  const raw = flagValue(argv, flag);
  if (raw == null) return fallback;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? fallback : n;
}
var MANAGEMENT_VERBS = /* @__PURE__ */ new Set([
  "start",
  "stop",
  "restart",
  "connect",
  "debug",
  "pause",
  "resume"
]);
function detectDaemonSupervisorCommand(argv) {
  if (argv[2] !== "daemon") return null;
  const verb = argv[3];
  if (!verb || !MANAGEMENT_VERBS.has(verb)) return null;
  const rest = argv.slice(4);
  const detach = rest.some((a) => a === "-D" || a === "--detach");
  const all = rest.includes("--all");
  const names = rest.filter((a) => !a.startsWith("-"));
  return {
    verb,
    ...detach ? { detach: true } : {},
    ...all ? { all: true } : {},
    ...names.length > 0 ? { names } : {}
  };
}
var DAEMON_SUBVERBS = /* @__PURE__ */ new Set(["status", "logs", ...MANAGEMENT_VERBS]);
function detectUnknownDaemonSubcommand(argv) {
  if (argv[2] !== "daemon") return null;
  const token = argv[3];
  if (!token || token.startsWith("-")) return null;
  return DAEMON_SUBVERBS.has(token) ? null : token;
}
function clampDaemonConcurrency(requested, log) {
  if (requested === void 0 || requested <= 1) return 1;
  log(
    `concurrency clamped to 1 (serial \u2014 real concurrency is out of scope; see .docs/plans/2026-06-29-daemon-tmux-supervisor.md)`
  );
  return 1;
}
function detectDaemonCommand(argv) {
  if (argv[2] !== "daemon") return null;
  if (argv[3] === "status" || argv[3] === "logs") return null;
  if (MANAGEMENT_VERBS.has(argv[3])) return null;
  return {
    concurrency: intFlag(argv, "--concurrency", 1) ?? 1,
    maxItems: intFlag(argv, "--max-items"),
    continuous: argv.includes("--continuous"),
    maxCostTokens: intFlag(argv, "--max-cost"),
    maxRuntimeSeconds: intFlag(argv, "--max-runtime"),
    // Mirrors the former flag's default of 5 (commander applied it eagerly).
    idlePollSeconds: intFlag(argv, "--idle-poll", 5),
    maxIdlePolls: intFlag(argv, "--max-idle-polls")
  };
}

// src/engine/shipped-record.ts
import { createHash as createHash2 } from "crypto";
import { access as access5, readFile as readFile14, writeFile as writeFile12, mkdir as mkdir9 } from "fs/promises";
import { basename as basename2, dirname as dirname4, join as join19 } from "path";
function specHash(planBytes, storiesBytes) {
  const storiesIncluded = storiesBytes != null;
  const canonicalPlan = trimTrailingNewlines(planBytes);
  const canonicalStories = storiesIncluded ? trimTrailingNewlines(storiesBytes) : Buffer.alloc(0);
  const hash = createHash2("sha256");
  hash.update(canonicalPlan);
  hash.update(Buffer.from([0]));
  hash.update(canonicalStories);
  return {
    digest: hash.digest("hex"),
    storiesIncluded
  };
}
function trimTrailingNewlines(bytes) {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 10) {
    end -= 1;
  }
  return bytes.subarray(0, end);
}
var DEFAULT_PR = "https://github.com/acme/repo/pull/0";
function todayIso() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
function renderShippedRecord(fields) {
  const pr = fields.pr ?? DEFAULT_PR;
  const shipped = fields.shipped ?? todayIso();
  return `---
slug: ${fields.slug}
spec_hash: ${fields.specHash}
pr: ${pr}
shipped: ${shipped}
---
`;
}
var FRONTMATTER_LINE = /^([a-zA-Z_]+):\s*(.*)$/;
function parseShippedRecord(content) {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") {
    return { malformed: true };
  }
  const fields = {};
  let closed = false;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "---") {
      closed = true;
      break;
    }
    const match = FRONTMATTER_LINE.exec(line);
    if (!match) {
      continue;
    }
    fields[match[1]] = match[2].trim();
  }
  if (!closed) {
    return { malformed: true };
  }
  const { slug, spec_hash: specHash2, pr, shipped } = fields;
  if (!slug || !specHash2) {
    return { malformed: true };
  }
  return {
    slug,
    specHash: specHash2,
    pr: pr ?? DEFAULT_PR,
    shipped: shipped ?? todayIso()
  };
}
async function writeShippedRecord(filePath, content) {
  let existing;
  try {
    existing = await readFile14(filePath, "utf8");
  } catch {
    existing = void 0;
  }
  if (existing === content) {
    return;
  }
  await mkdir9(dirname4(filePath), { recursive: true });
  await writeFile12(filePath, content, "utf8");
}
async function listShippedRecords(treeSource) {
  const files = await treeSource.listShippedFiles();
  const results = [];
  for (const file of files) {
    const content = await treeSource.readFile(`.docs/shipped/${file}`);
    if (content === null) {
      continue;
    }
    const stem = basename2(file, ".md");
    results.push({ stem, record: parseShippedRecord(content) });
  }
  return results;
}
function makeIsProcessed(processedDir, treeSource) {
  let cachedRecords = null;
  const getRecords = () => {
    if (!cachedRecords) {
      cachedRecords = listShippedRecords(treeSource);
    }
    return cachedRecords;
  };
  return async (slug) => {
    try {
      await access5(join19(processedDir, slug));
      return true;
    } catch {
    }
    const records = await getRecords();
    return records.some((r) => r.stem === slug);
  };
}

// src/engine/daemon-log.ts
import { createWriteStream } from "fs";
import { mkdir as mkdir10, stat as stat5, rename as rename3, readFile as readFile15, open } from "fs/promises";
import { join as join20 } from "path";
var DAEMON_LOG_NAME = "daemon.log";
var ROTATED_LOG_NAME = "daemon.log.1";
var ROTATE_SIZE_BYTES = 1e6;
function daemonLogPath(repoPath) {
  return join20(daemonDir(repoPath), DAEMON_LOG_NAME);
}
function formatDaemonLogLine(line, now = /* @__PURE__ */ new Date()) {
  return `${now.toISOString()} ${line}`;
}
async function openDaemonLog(repoPath) {
  const dir = daemonDir(repoPath);
  await mkdir10(dir, { recursive: true });
  const logPath = daemonLogPath(repoPath);
  try {
    const st = await stat5(logPath);
    if (st.size > ROTATE_SIZE_BYTES) {
      await rename3(logPath, join20(dir, ROTATED_LOG_NAME));
    }
  } catch {
  }
  const stream = createWriteStream(logPath, { flags: "a" });
  return {
    write(line) {
      stream.write(line.endsWith("\n") ? line : `${line}
`);
    },
    close() {
      return new Promise((resolve) => stream.end(resolve));
    },
    closeSync() {
      stream.end();
    }
  };
}
async function tailDaemonLog(repoPath, n) {
  const logPath = daemonLogPath(repoPath);
  let mtime;
  try {
    mtime = (await stat5(logPath)).mtime;
  } catch (err) {
    return classifyReadError(err);
  }
  let content;
  try {
    content = await readFile15(logPath, "utf8");
  } catch (err) {
    return classifyReadError(err);
  }
  const allLines = content.split("\n").filter((l) => l.length > 0);
  const lines = n > 0 ? allLines.slice(-n) : allLines;
  return { status: "ok", lines, mtime };
}
function classifyReadError(err) {
  const code = err.code;
  if (code === "ENOENT") return { status: "missing" };
  return { status: "unreadable", error: err.message };
}
function followDaemonLog(repoPath, onLine, opts = {}) {
  const logPath = daemonLogPath(repoPath);
  const intervalMs = opts.intervalMs ?? 1e3;
  let offset = opts.startOffset ?? 0;
  let timer = null;
  const poll = async () => {
    let size;
    try {
      size = (await stat5(logPath)).size;
    } catch {
      return;
    }
    if (size < offset) offset = 0;
    if (size === offset) return;
    let fh;
    try {
      fh = await open(logPath, "r");
    } catch {
      return;
    }
    try {
      const len = size - offset;
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, offset);
      offset = size;
      for (const line of buf.toString("utf8").split("\n")) {
        if (line.length > 0) onLine(line);
      }
    } finally {
      await fh.close();
    }
  };
  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };
  if (opts.auto ?? true) {
    timer = setInterval(() => {
      void poll();
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
  }
  return { stop, poll };
}

// src/engine/engineer-store.ts
import { mkdir as mkdir11, readFile as readFile16, writeFile as writeFile13, appendFile } from "fs/promises";
import { homedir as homedir4 } from "os";
import { join as join21, dirname as dirname5 } from "path";
var SCHEMA_VERSION = 1;
var SIGNALS_LOG = "signals.jsonl";
var NARRATIVES_DIR = "narratives";
function resolveEngineerDir(opts = {}) {
  const env = opts.env ?? process.env;
  const override = env.AI_CONDUCTOR_ENGINEER_DIR;
  if (override && override.trim() !== "") return override;
  const home = opts.home ?? homedir4();
  return join21(home, ".ai-conductor", "engineer");
}
function serializeSignal(sig) {
  const record = {
    schemaVersion: sig.schemaVersion,
    ts: sig.ts,
    project: sig.project,
    feature: sig.feature,
    runId: sig.runId,
    outcome: sig.outcome,
    kickbacks: sig.kickbacks ?? [],
    halts: sig.halts ?? [],
    retryHotspots: sig.retryHotspots ?? [],
    tokens: sig.tokens,
    durationByStep: sig.durationByStep ?? {}
  };
  if (sig.narrativeRef != null) record.narrativeRef = sig.narrativeRef;
  return JSON.stringify(record);
}
async function assembleSignal(args) {
  let raw = "";
  try {
    raw = await readFile16(args.eventsPath, "utf-8");
  } catch {
    raw = "";
  }
  const events = parseEvents(raw);
  return {
    schemaVersion: SCHEMA_VERSION,
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    project: args.project,
    feature: args.feature,
    runId: args.runId,
    outcome: args.outcome.status,
    kickbacks: aggregateKickbacks(events),
    halts: aggregateHalts(events),
    retryHotspots: aggregateRetryHotspots(events),
    tokens: aggregateTokens(events),
    durationByStep: aggregateDurations(events)
  };
}
async function appendSignal(engineerDir, sig) {
  await mkdir11(engineerDir, { recursive: true });
  const line = serializeSignal(sig) + "\n";
  await appendFile(join21(engineerDir, SIGNALS_LOG), line, "utf-8");
}
async function produceNarrative(args) {
  if (args.outcome.status === "halted") {
    return renderHaltNarrative(args);
  }
  if (args.tierSkippedRetro) return void 0;
  const prompt = buildRetroPrompt(args);
  const result = await args.provider.invoke({
    prompt,
    sessionId: `engineer-retro-${args.feature}-${args.runId}`,
    resume: false,
    cwd: args.worktreePath
  });
  if (!result.success) return void 0;
  return result.output;
}
function renderHaltNarrative(args) {
  const reason = args.outcome.reason && args.outcome.reason.trim() !== "" ? args.outcome.reason.trim() : "reason unavailable";
  return [
    `# Halt: ${args.feature}`,
    "",
    `- **Project:** ${args.project}`,
    `- **Run:** ${args.runId}`,
    `- **Outcome:** halted`,
    `- **Reason:** ${reason}`,
    "",
    `The gate loop halted before completion. ${reason === "reason unavailable" ? "No halt reason was captured (reason unavailable)." : `It halted because: ${reason}.`}`,
    ""
  ].join("\n");
}
function buildRetroPrompt(args) {
  return [
    `Write a concise retrospective for the completed feature "${args.feature}" in project`,
    `"${args.project}" (run ${args.runId}). The feature finished with outcome "done".`,
    `Base it on the worktree at ${args.worktreePath} (its .pipeline/events.jsonl and the diff).`,
    `Cover: what went well, what was hard, retries/kickbacks if any, and one improvement.`,
    `Output Markdown only.`
  ].join(" ");
}
async function writeNarrative(engineerDir, project, feature, runId, content) {
  const relative3 = join21(NARRATIVES_DIR, project, `${feature}-${runId}.md`);
  const absolute = join21(engineerDir, relative3);
  await mkdir11(dirname5(absolute), { recursive: true });
  await writeFile13(absolute, content, "utf-8");
  return relative3;
}
async function emitEngineerSignal(args) {
  const log = args.log ?? (() => {
  });
  try {
    const signal = await assembleSignal({
      eventsPath: args.eventsPath,
      outcome: args.outcome,
      project: args.project,
      feature: args.feature,
      runId: args.runId
    });
    try {
      const narrative = await produceNarrative({
        outcome: args.outcome,
        project: args.project,
        feature: args.feature,
        runId: args.runId,
        worktreePath: args.worktreePath,
        provider: args.provider,
        tierSkippedRetro: args.tierSkippedRetro
      });
      if (narrative != null) {
        signal.narrativeRef = await writeNarrative(
          args.engineerDir,
          args.project,
          args.feature,
          args.runId,
          narrative
        );
      }
    } catch (err) {
      log(
        `engineer: narrative emission failed for ${args.feature} \u2014 ${err instanceof Error ? err.message : String(err)} (signal still recorded)`
      );
    }
    await appendSignal(args.engineerDir, signal);
  } catch (err) {
    log(
      `engineer: signal emission failed for ${args.feature} \u2014 ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

// src/engine/worktree-shared.ts
import { execa as execa5 } from "execa";
import { basename as basename3, join as join22 } from "path";
async function ensureWorktree(opts) {
  const { root, path, branch, resolveBase: resolveBase2, log } = opts;
  if (await isRegisteredWorktree(root, path)) {
    log?.(`reusing worktree ${path} (resume)`);
    return { path, branch, reconcile: "reused" };
  }
  if (await branchExists(root, branch)) {
    log?.(`attaching worktree to existing branch ${branch}`);
    await execa5("git", ["worktree", "add", path, branch], { cwd: root });
    return { path, branch, reconcile: "attached" };
  }
  const base = await resolveBase2();
  await execa5("git", ["worktree", "add", "-b", branch, path, base], { cwd: root });
  return { path, branch, reconcile: "created" };
}
async function removeWorktree(root, path) {
  await execa5("git", ["worktree", "remove", "--force", path], { cwd: root });
}
async function worktreeStatus(path) {
  const { stdout } = await execa5("git", ["status", "--porcelain"], { cwd: path });
  return stdout.trim();
}
async function isRegisteredWorktree(root, path) {
  try {
    const { stdout } = await execa5("git", ["worktree", "list", "--porcelain"], { cwd: root });
    const suffix = path.slice(path.indexOf(join22(".worktrees", basename3(path))));
    return stdout.split("\n").filter((l) => l.startsWith("worktree ")).some((l) => {
      const wt = l.slice("worktree ".length);
      return wt === path || wt.endsWith(suffix);
    });
  } catch {
    return false;
  }
}
async function branchExists(root, branch) {
  try {
    await execa5("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: root });
    return true;
  } catch {
    return false;
  }
}

export {
  VALID_PLUGIN_KINDS,
  PluginManifestError,
  PluginVersionError,
  PluginLoadError,
  PluginNotFoundError,
  PluginRegistryError,
  HALT_MARKER2 as HALT_MARKER,
  readState,
  writeState,
  getStepStatus,
  extractPrUrl,
  ALL_STEPS,
  slugify,
  WorktreeManager,
  checkPrMerged,
  parseSourceRef,
  injectIssueRef,
  closeIssueOnImplementationMerge,
  makeProductionGh,
  restAddLabelArgs,
  restRemoveLabelArgs,
  ensureLabel,
  addLabel,
  removeLabel,
  prMergeState,
  isMergeable,
  setReady,
  rehabilitateHaltPr,
  STEP_ARTIFACT_GLOBS,
  planStem,
  FINISH_CHOICE_MARKER,
  FINISH_CHOICE_VALUES,
  planHasDependencyTree,
  isStoriesApproved,
  hasDraftAdr,
  parseComplexityTier,
  parseIntakeSourceRef,
  parseTrack,
  checkStepCompletion,
  getArtifactStatus,
  resolveSelfHostConfig,
  makeGitRunner,
  originDefaultBranch,
  rebaseStateActive,
  writeHalt,
  performRebase,
  applyRebaseVerdicts,
  emitRebaseEvent,
  AuthoringGuard,
  writeIntakeMarker,
  normalizeOwnerId,
  resolveDaemonOwner,
  readMachineOwnerConfig,
  makeMachineOwnerResolver,
  Conductor,
  DefaultStepRunner,
  ConductorEventEmitter,
  loadConfig,
  loadMergedConfig,
  resolveMemoryProvider,
  buildDashboardSnapshot,
  formatDashboardSnapshot,
  createLiveRegion,
  discoverPlugins,
  registerBuiltins,
  PluginRegistry,
  ReportError,
  renderReport,
  resolveEngineerDir,
  emitEngineerSignal,
  ensureWorktree,
  removeWorktree,
  worktreeStatus,
  createBlockerResolver,
  detectDaemonSupervisorCommand,
  detectUnknownDaemonSubcommand,
  clampDaemonConcurrency,
  detectDaemonCommand,
  specHash,
  renderShippedRecord,
  writeShippedRecord,
  listShippedRecords,
  makeIsProcessed,
  daemonLogPath,
  formatDaemonLogLine,
  openDaemonLog,
  tailDaemonLog,
  followDaemonLog
};
//# sourceMappingURL=chunk-JB4POPRT.js.map