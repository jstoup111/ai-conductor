import {
  ALL_STEPS,
  Conductor,
  ConductorEventEmitter,
  DefaultStepRunner,
  FINISH_CHOICE_MARKER,
  FINISH_CHOICE_VALUES,
  HALT_MARKER,
  PluginRegistry,
  addLabel,
  applyRebaseVerdicts,
  clampDaemonConcurrency,
  closeIssueOnImplementationMerge,
  createBlockerResolver,
  emitEngineerSignal,
  emitRebaseEvent,
  ensureLabel,
  ensureWorktree,
  formatDaemonLogLine,
  getStepStatus,
  isMergeable,
  isStoriesApproved,
  listShippedRecords,
  loadConfig,
  makeGitRunner,
  makeIsProcessed,
  makeMachineOwnerResolver,
  makeProductionGh,
  normalizeOwnerId,
  openDaemonLog,
  originDefaultBranch,
  parseComplexityTier,
  parseIntakeSourceRef,
  parseTrack,
  performRebase,
  planHasDependencyTree,
  planStem,
  prMergeState,
  readState,
  rebaseStateActive,
  registerBuiltins,
  rehabilitateHaltPr,
  removeLabel,
  resolveEngineerDir,
  resolveMemoryProvider,
  resolveSelfHostConfig,
  setReady,
  specHash,
  writeHalt,
  writeState
} from "./chunk-TH7YQ2SR.js";
import {
  consumeOnBoot,
  ensureInstallFresh,
  holdLock,
  isPaused,
  readRestartPending,
  resolveHarnessRoot
} from "./chunk-IPMUTBGC.js";

// src/daemon-cli.ts
import chalk2 from "chalk";
import { v4 as uuidv4 } from "uuid";
import { join as join8 } from "path";
import { mkdir as mkdir5, rm as rm2 } from "fs/promises";
import { execFile as execFileCb3 } from "child_process";
import { promisify as promisify3 } from "util";

// src/engine/self-host/detector.ts
import { realpath } from "fs/promises";
var PathSelfHostDetector = class {
  constructor(resolveRoot = resolveHarnessRoot, debug = () => {
  }) {
    this.resolveRoot = resolveRoot;
    this.debug = debug;
  }
  resolveRoot;
  debug;
  async isSelfHost(buildRepoRoot) {
    const root = await this.resolveRoot();
    if (root === null) {
      this.debug("self-host detection: harness root unresolved");
      return false;
    }
    const buildReal = await canonicalize(buildRepoRoot);
    const rootReal = await canonicalize(root);
    if (buildReal === null || rootReal === null) return false;
    return buildReal === rootReal;
  }
};
async function canonicalize(p) {
  try {
    return await realpath(p);
  } catch {
    return null;
  }
}
function defaultSelfHostDetector() {
  return new PathSelfHostDetector();
}
async function classifySelfHost(detector, config, buildRepoRoot) {
  const { activation } = resolveSelfHostConfig(config);
  if (activation === "force_on") return true;
  if (activation === "force_off") return false;
  return detector.isSelfHost(buildRepoRoot);
}

// src/engine/daemon.ts
import chalk from "chalk";
async function pickEligible(backlog, ctx) {
  for (const b of backlog.items) {
    if (ctx.inFlight.has(b.slug)) continue;
    if (ctx.parked.has(b.slug)) {
      if (!ctx.isHalted || await ctx.isHalted(b.slug)) continue;
    } else if (ctx.started.has(b.slug)) {
      continue;
    } else if (ctx.isHalted && await ctx.isHalted(b.slug)) {
      ctx.parked.add(b.slug);
      continue;
    }
    return b;
  }
  return void 0;
}
async function runDaemon(deps, options) {
  const concurrency = Math.max(1, Math.floor(options.concurrency));
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? (() => {
  });
  const sweepBestEffort = async () => {
    try {
      await deps.sweepMergeableLabels?.();
    } catch (err) {
      log(`[daemon] sweepMergeableLabels error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  let pauseErrorActive = false;
  const checkPaused = async () => {
    if (!deps.isPaused) return false;
    try {
      const result = await deps.isPaused();
      if (pauseErrorActive) {
        pauseErrorActive = false;
        log("[daemon] isPaused predicate recovered \u2014 resuming normal pause polling");
      }
      return result;
    } catch (err) {
      if (!pauseErrorActive) {
        pauseErrorActive = true;
        log(
          `[daemon] isPaused predicate threw (${err instanceof Error ? err.message : String(err)}); failing closed \u2014 treating as paused`
        );
      }
      return true;
    }
  };
  const idlePollMs = options.idlePollMs ?? 5e3;
  const maxIdlePolls = options.maxIdlePolls ?? Infinity;
  const startedAt = now();
  const processed = [];
  const inFlight = /* @__PURE__ */ new Map();
  let restartTriggeredSuccessfully = false;
  const started = /* @__PURE__ */ new Set();
  const parked = /* @__PURE__ */ new Set();
  let totalCost = 0;
  let idlePolls = 0;
  const ceilingHit = () => {
    if (options.maxItems != null && processed.length >= options.maxItems) {
      return "max_items";
    }
    if (options.maxTotalCostTokens != null && totalCost >= options.maxTotalCostTokens) {
      return "cost_ceiling";
    }
    if (options.maxRuntimeMs != null && now() - startedAt >= options.maxRuntimeMs) {
      return "time_ceiling";
    }
    return null;
  };
  const dispatch = (item) => {
    started.add(item.slug);
    parked.delete(item.slug);
    log(`${chalk.cyan("\u25B6")} start ${chalk.bold(item.slug)}`);
    const tagged = deps.runFeature(item).then((outcome) => ({ slug: item.slug, outcome })).catch((err) => ({
      slug: item.slug,
      outcome: {
        slug: item.slug,
        status: "error",
        reason: err instanceof Error ? err.message : String(err)
      }
    }));
    inFlight.set(item.slug, tagged);
  };
  const collectOne = async () => {
    const { slug, outcome } = await Promise.race(inFlight.values());
    inFlight.delete(slug);
    processed.push(outcome);
    if (outcome.costTokens) totalCost += outcome.costTokens;
    if (outcome.status === "halted" || outcome.status === "error") parked.add(slug);
    const ok = outcome.status === "done";
    const marker = ok ? chalk.green("\u25A0") : chalk.red("\u25A0");
    const status = ok ? chalk.green(outcome.status) : chalk.red(outcome.status);
    const why = !ok && outcome.reason ? ` \u2014 ${outcome.reason.split("\n")[0]}` : "";
    log(
      `${marker} done ${chalk.bold(slug)}: ${status}${why}${outcome.prUrl ? ` ${chalk.cyan(outcome.prUrl)}` : ""}`
    );
  };
  await deps.renderStartupDashboard?.();
  let lastSeenSha = deps.readPersistedBaseSha ? await deps.readPersistedBaseSha() : null;
  const maybeRekick = async (refresh) => {
    if (!deps.resolveBaseSha) return;
    if (await checkPaused()) return;
    let current = null;
    try {
      current = await deps.resolveBaseSha({ refresh });
    } catch (err) {
      log(`base-SHA resolution failed (${err instanceof Error ? err.message : String(err)}); treating as no advance`);
      return;
    }
    if (!current) return;
    if (current === lastSeenSha) return;
    if (lastSeenSha != null) {
      await deps.rekickSweep?.(current);
    }
    lastSeenSha = current;
    await deps.writePersistedBaseSha?.(current);
  };
  await maybeRekick(true);
  await sweepBestEffort();
  let stopReason = null;
  while (true) {
    stopReason = ceilingHit();
    if (stopReason) break;
    if (inFlight.size < concurrency) {
      const paused = await checkPaused();
      const pickCtx = { inFlight, parked, started, isHalted: deps.isHalted };
      let next;
      if (!paused) {
        next = await pickEligible({ items: await deps.discoverBacklog({ refresh: false }) }, pickCtx);
        if (!next && inFlight.size === 0) {
          const refreshed = await deps.discoverBacklog({ refresh: true });
          await maybeRekick(false);
          next = await pickEligible({ items: refreshed }, pickCtx);
        }
      }
      if (next) {
        idlePolls = 0;
        dispatch(next);
        continue;
      }
      if (inFlight.size === 0) {
        if (options.once) {
          stopReason = "backlog_drained";
          break;
        }
        idlePolls++;
        if (idlePolls > maxIdlePolls) {
          stopReason = "idle_timeout";
          break;
        }
        if (!restartTriggeredSuccessfully && deps.hasRestartPending && deps.triggerSelfRestart) {
          try {
            const hasRestart = await deps.hasRestartPending();
            if (hasRestart) {
              log("[daemon] self-restart marker found at idle boundary; firing trigger");
              try {
                await deps.triggerSelfRestart();
                restartTriggeredSuccessfully = true;
                log("[daemon] self-restart trigger completed (no respawn yet)");
              } catch (err) {
                log(
                  `[daemon] self-restart trigger failed: ${err instanceof Error ? err.message : String(err)}; will retry at next idle boundary`
                );
              }
            }
          } catch (err) {
            log(
              `[daemon] hasRestartPending check failed: ${err instanceof Error ? err.message : String(err)}; skipping restart check`
            );
          }
        }
        await sleep(idlePollMs);
        await sweepBestEffort();
        continue;
      }
    }
    await collectOne();
  }
  while (inFlight.size > 0) {
    await collectOne();
  }
  return { processed, stoppedReason: stopReason ?? "backlog_drained" };
}

// src/engine/daemon-backlog.ts
import { execFile as execFileCb } from "child_process";
import { basename, isAbsolute, relative } from "path";
import { promisify } from "util";

// src/engine/owner-gate/gate.ts
function decideSpecGate(input) {
  const { daemonOwner, stamp, mergeTime, cutover } = input;
  if (stamp.present) {
    return stamp.id === daemonOwner.id ? { build: true } : { build: false, reason: "other-owner", other: stamp.id };
  }
  const mergeMs = parseTime(mergeTime);
  const cutoverMs = parseTime(cutover);
  if (mergeMs === null || cutoverMs === null) {
    return { build: false, reason: "unowned-indeterminate" };
  }
  return mergeMs < cutoverMs ? { build: true, reason: "grandfathered" } : { build: false, reason: "unowned-post-cutover" };
}
function parseTime(iso) {
  if (iso == null) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

// src/engine/daemon-dashboard.ts
import { readFile, readdir } from "fs/promises";
import { join } from "path";
async function listWorktreeSlugs(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}
async function readProcessedEntries(processedDir) {
  let names;
  try {
    const entries = await readdir(processedDir, { withFileTypes: true });
    names = entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
  const out = [];
  for (const slug of names) {
    let prUrl;
    try {
      const raw = await readFile(join(processedDir, slug), "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && "prUrl" in parsed) {
        const v = parsed.prUrl;
        if (typeof v === "string" && v.length > 0) prUrl = v;
      }
    } catch {
    }
    out.push({ slug, prUrl });
  }
  return out;
}
function haltReason(content) {
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (t.length > 0) return t;
  }
  return "unknown";
}
function lastMeaningfulStep(state) {
  const order = ALL_STEPS.map((s) => s.name);
  const statusOf = (name) => {
    const v = state[name];
    return typeof v === "string" ? v : void 0;
  };
  let furthestInProgress = null;
  let furthestSettled = null;
  for (const name of order) {
    const s = statusOf(name);
    if (s === "in_progress") furthestInProgress = name;
    if (s === "done" || s === "failed") furthestSettled = name;
  }
  return furthestInProgress ?? furthestSettled ?? "unknown";
}
function stateExtras(state) {
  const tier = state.complexity_tier === "S" || state.complexity_tier === "M" || state.complexity_tier === "L" ? state.complexity_tier : void 0;
  const prUrl = typeof state.pr_url === "string" && state.pr_url.length > 0 ? state.pr_url : void 0;
  return { tier, prUrl };
}
async function loadWorktreeState(wt) {
  let raw;
  try {
    raw = await readFile(join(wt, ".pipeline/conduct-state.json"), "utf-8");
  } catch {
    return { present: false, state: null };
  }
  try {
    return { present: true, state: JSON.parse(raw) };
  } catch {
    return { present: true, state: null };
  }
}
async function scanInheritedState(deps) {
  const processed = await readProcessedEntries(deps.processedDir);
  const processedSlugs = new Set(processed.map((p) => p.slug));
  const slugs = await listWorktreeSlugs(deps.worktreeBase);
  const halted = [];
  const haltedSlugs = /* @__PURE__ */ new Set();
  const inProgress = [];
  for (const slug of slugs) {
    try {
      const wt = join(deps.worktreeBase, slug);
      const haltPath = join(wt, HALT_MARKER);
      let haltContent = null;
      try {
        haltContent = await readFile(haltPath, "utf-8");
      } catch {
        haltContent = null;
      }
      if (haltContent !== null) {
        const entry2 = { slug, reason: haltReason(haltContent) };
        const { state: state2 } = await loadWorktreeState(wt);
        if (state2) {
          entry2.step = lastMeaningfulStep(state2);
          const { tier, prUrl } = stateExtras(state2);
          if (tier) entry2.tier = tier;
          if (prUrl) entry2.prUrl = prUrl;
        }
        halted.push(entry2);
        haltedSlugs.add(slug);
        continue;
      }
      if (processedSlugs.has(slug)) continue;
      const { present, state } = await loadWorktreeState(wt);
      if (!present) continue;
      const entry = {
        slug,
        step: state ? lastMeaningfulStep(state) : "unknown"
      };
      if (state) {
        const { tier, prUrl } = stateExtras(state);
        if (tier) entry.tier = tier;
        if (prUrl) entry.prUrl = prUrl;
      }
      inProgress.push(entry);
    } catch (err) {
      deps.log?.(
        `dashboard: skipped worktree ${slug} (${err instanceof Error ? err.message : String(err)})`
      );
    }
  }
  let eligible = [];
  let waiting = [];
  let priorityResolution;
  try {
    const result = await deps.discover();
    const backlog = Array.isArray(result) ? result : result.items;
    waiting = Array.isArray(result) ? [] : result.waiting;
    const backlogItems = backlog.filter((b) => !haltedSlugs.has(b.slug) && !processedSlugs.has(b.slug));
    eligible = backlogItems.map((b) => ({
      slug: b.slug,
      tier: b.tier,
      band: b.band
    }));
    const resolutionMode = backlogItems.find((b) => b.resolutionMode)?.["resolutionMode"];
    if (resolutionMode === "banded") {
      priorityResolution = { mode: "banded", bands: new Map(eligible.filter((e) => e.band).map((e) => [e.slug, e.band])) };
    } else if (resolutionMode === "fallback") {
      priorityResolution = { mode: "fallback" };
    }
  } catch (err) {
    deps.log?.(
      `dashboard: backlog discovery failed (${err instanceof Error ? err.message : String(err)})`
    );
  }
  return { halted, inProgress, eligible, processed, processedCount: processed.length, waiting, priorityResolution };
}
function tierTag(tier) {
  return tier ? ` [${tier}]` : "";
}
function prSuffix(prUrl) {
  return prUrl ? `  \u2192 ${prUrl}` : "";
}
function bandTag(band) {
  return band ? ` [${band}]` : "";
}
function refLabel(ref) {
  return `${ref.repo}#${ref.number}`;
}
function waitingDetail(verdict) {
  switch (verdict.kind) {
    case "blocked":
      return `blocked by ${verdict.blockers.map(refLabel).join(", ")}`;
    case "cycle":
      return `cycle: ${verdict.members.map(refLabel).join(", ")}`;
    case "indeterminate":
      return `indeterminate: ${verdict.detail}`;
    case "unblocked":
      return "unblocked";
  }
}
function renderDashboard(state, priorityResolution) {
  const lines = [];
  lines.push("\u2500\u2500 inherited state \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  lines.push(`HALTED (${state.halted.length})`);
  for (const h of state.halted) {
    const step = h.step ? ` @${h.step}` : "";
    lines.push(`  \u2022 ${h.slug}${tierTag(h.tier)}${step} \u2014 ${h.reason}${prSuffix(h.prUrl)}`);
  }
  lines.push(`IN-PROGRESS (${state.inProgress.length})`);
  for (const p of state.inProgress) {
    lines.push(`  \u2022 ${p.slug}${tierTag(p.tier)} @${p.step}${prSuffix(p.prUrl)}`);
  }
  const waiting = state.waiting ?? [];
  const waitingSlugs = new Set(waiting.map((w) => w.slug));
  if (waiting.length > 0) {
    lines.push(`WAITING (${waiting.length})`);
    for (const w of waiting) {
      lines.push(`  \u2022 ${w.slug} \u2014 ${waitingDetail(w.verdict)}`);
    }
  }
  const eligible = state.eligible.filter((e) => !waitingSlugs.has(e.slug));
  lines.push(`ELIGIBLE (${eligible.length})`);
  const resolution = priorityResolution ?? state.priorityResolution;
  const isInFallbackMode = resolution?.mode === "fallback";
  const isBandedMode = resolution?.mode === "banded";
  for (const e of eligible) {
    const bandAnnotation = isBandedMode ? bandTag(e.band) : "";
    lines.push(`  \u2022 ${e.slug}${tierTag(e.tier)}${bandAnnotation}`);
  }
  if (isInFallbackMode && eligible.length > 0) {
    lines.push(`  (priority: chronological fallback)`);
  }
  lines.push(`PROCESSED (${state.processedCount})`);
  for (const p of state.processed) lines.push(`  \u2022 ${p.slug}${prSuffix(p.prUrl)}`);
  lines.push("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  return lines.join("\n");
}

// src/engine/daemon-waiting-announce.ts
var registry = /* @__PURE__ */ new Map();
function hashVerdict(verdict) {
  switch (verdict.kind) {
    case "unblocked":
      return "unblocked";
    case "blocked":
      return `blocked:${verdict.blockers.map(refLabel).join(",")}`;
    case "cycle":
      return `cycle:${verdict.members.map(refLabel).join(",")}`;
    case "indeterminate":
      return `indeterminate:${verdict.detail}`;
  }
}
function announceWaitingForRoot(projectRoot, log, waiting) {
  let announced = registry.get(projectRoot);
  if (!announced) {
    announced = /* @__PURE__ */ new Map();
    registry.set(projectRoot, announced);
  }
  const current = /* @__PURE__ */ new Set();
  for (const w of waiting) {
    current.add(w.slug);
    const hash = hashVerdict(w.verdict);
    if (announced.get(w.slug) === hash) continue;
    log(`[daemon] WAITING ${w.slug}: ${waitingDetail(w.verdict)}`);
    announced.set(w.slug, hash);
  }
  for (const slug of announced.keys()) {
    if (!current.has(slug)) announced.delete(slug);
  }
}

// src/engine/daemon-backlog.ts
var execFile = promisify(execFileCb);
function gitTreeSource(projectRoot, baseBranch) {
  return {
    async listPlanFiles() {
      try {
        const { stdout } = await execFile(
          "git",
          ["ls-tree", "--name-only", `${baseBranch}:.docs/plans`],
          { cwd: projectRoot }
        );
        return stdout.split("\n").map((l) => l.trim()).filter((l) => l.endsWith(".md")).map((l) => basename(l));
      } catch {
        return [];
      }
    },
    async listShippedFiles() {
      try {
        const { stdout } = await execFile(
          "git",
          ["ls-tree", "--name-only", `${baseBranch}:.docs/shipped`],
          { cwd: projectRoot }
        );
        return stdout.split("\n").map((l) => l.trim()).filter((l) => l.endsWith(".md")).map((l) => basename(l));
      } catch {
        return [];
      }
    },
    async readFile(relPath) {
      try {
        const { stdout } = await execFile("git", ["show", `${baseBranch}:${relPath}`], {
          cwd: projectRoot
        });
        return stdout;
      } catch {
        return null;
      }
    }
  };
}
async function fastForwardRoot(projectRoot, log = () => {
}, gitOverride) {
  const git = gitOverride ?? makeGitRunner(projectRoot);
  const remotes = await git(["remote"]);
  if (remotes.exitCode !== 0) return;
  const hasOrigin = remotes.stdout.split("\n").map((l) => l.trim()).includes("origin");
  if (!hasOrigin) return;
  let defaultBranch = await originDefaultBranch(git);
  if (!defaultBranch) {
    const show = await git(["remote", "show", "origin"]);
    if (show.exitCode === 0) {
      const m = show.stdout.match(/HEAD branch:\s*(\S+)/);
      if (m && m[1] !== "(unknown)") defaultBranch = m[1];
    }
  }
  if (!defaultBranch) return;
  const head = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const current = head.stdout.trim();
  if (head.exitCode !== 0 || current !== defaultBranch) {
    log(
      `skip fast-forward: root is on '${current || "unknown"}', not the default branch '${defaultBranch}'. Daemon discovers/builds against the local branch as-is.`
    );
    return;
  }
  const status = await git(["status", "--porcelain"]);
  if (status.exitCode !== 0 || status.stdout.trim() !== "") {
    log(
      `skip fast-forward: working tree at ${projectRoot} is not clean. Commit/stash changes so the daemon can track origin/${defaultBranch}.`
    );
    return;
  }
  const fetched = await git(["fetch", "origin", defaultBranch]);
  if (fetched.exitCode !== 0) {
    log(
      `fast-forward: fetch origin ${defaultBranch} failed (offline?); continuing on local ${defaultBranch}.`
    );
    return;
  }
  const merged = await git(["merge", "--ff-only", `origin/${defaultBranch}`]);
  if (merged.exitCode !== 0) {
    log(
      `fast-forward: local ${defaultBranch} has diverged from origin/${defaultBranch} (non-fast-forward); continuing on local ${defaultBranch}.`
    );
  }
}
async function discoverBacklog(projectRoot, isProcessed2 = async () => false, log = () => {
}, opts = {}) {
  const baseBranch = opts.baseBranch ?? "main";
  const tree = opts.treeSource ?? gitTreeSource(projectRoot, baseBranch);
  const warnOnce = async (slug, msg) => {
    if (opts.hasWarned && await opts.hasWarned(slug)) return;
    log(msg);
    await opts.markWarned?.(slug);
  };
  const IDENTITY_UNRESOLVED_WARN_KEY = "__owner-gate-identity-unresolved__";
  const NO_CUTOVER_WARN_KEY = "__owner-gate-no-cutover__";
  let identityUnresolvedWarned = false;
  const warnIdentityUnresolvedOnce = async () => {
    if (identityUnresolvedWarned) return;
    identityUnresolvedWarned = true;
    await warnOnce(
      IDENTITY_UNRESOLVED_WARN_KEY,
      "daemon identity unresolved: no spec_owner in ~/.ai-conductor/config.yml and no gh login \u2014 building NOTHING (fail-closed). Set spec_owner in ~/.ai-conductor/config.yml or authenticate gh; logged once."
    );
  };
  let gateNoCutoverWarned = false;
  const warnGateNoCutoverOnce = async () => {
    if (gateNoCutoverWarned) return;
    gateNoCutoverWarned = true;
    await warnOnce(
      NO_CUTOVER_WARN_KEY,
      "owner-gate active but no owner_gate_cutover configured \u2014 un-owned specs will be skipped; set owner_gate_cutover to grandfather pre-existing specs."
    );
  };
  const planFiles = (await tree.listPlanFiles()).filter((f) => f.endsWith(".md"));
  if (planFiles.length === 0) return { items: [], waiting: [] };
  const shippedRecords = await listShippedRecords(tree);
  const items = [];
  const malformedSourceRefs = /* @__PURE__ */ new Map();
  for (const file of [...planFiles].sort()) {
    const slug = planStem(file);
    const planRel = `.docs/plans/${file}`;
    const planContent = await tree.readFile(planRel);
    if (planContent === null) continue;
    const storiesRel = await resolveStoriesRef(projectRoot, tree, slug, planContent);
    if (!storiesRel) continue;
    if (await isProcessed2(slug)) continue;
    const storiesContent = await tree.readFile(storiesRel) ?? "";
    if (!isStoriesApproved(storiesContent)) {
      await warnOnce(
        slug,
        `skip ${slug}: merged spec cannot build \u2014 stories not approved (need "Status: Accepted", no DRAFT). Fix the spec on the default branch; logged once.`
      );
      continue;
    }
    if (!planHasDependencyTree(planContent)) {
      await warnOnce(
        slug,
        `skip ${slug}: merged spec cannot build \u2014 plan has no dependency tree ("## Task Dependency Graph" or "**Dependencies:**" lines). Fix the spec on the default branch; logged once.`
      );
      continue;
    }
    const shippedMatch = shippedRecords.find((r) => r.stem === slug);
    if (shippedMatch) {
      try {
        await opts.repairProcessed?.(slug, shippedMatch.record);
      } catch (err) {
        log(
          `shipped dedup: ${slug} already shipped (base-branch record found) but repairing the local processed-cache failed: ${err instanceof Error ? err.message : String(err)}`
        );
        continue;
      }
      await warnOnce(
        slug,
        `skip ${slug}: shipped dedup \u2014 implementation already merged (base-branch shipped record found); not re-dispatching.`
      );
      continue;
    }
    const candidateDigest = specHash(
      Buffer.from(planContent, "utf-8"),
      Buffer.from(storiesContent, "utf-8")
    ).digest;
    const hashMatch = shippedRecords.find(
      (r) => !("malformed" in r.record) && r.record.specHash === candidateDigest
    );
    if (hashMatch) {
      try {
        await opts.repairProcessed?.(slug, hashMatch.record);
      } catch (err) {
        log(
          `shipped dedup: ${slug} matches shipped content under '${hashMatch.stem}' but repairing the local processed-cache failed: ${err instanceof Error ? err.message : String(err)}`
        );
        continue;
      }
      await warnOnce(
        slug,
        `skip ${slug}: shipped dedup \u2014 shipped under '${hashMatch.stem}', candidate '${slug}' matches by content (spec_hash); not re-dispatching.`
      );
      continue;
    }
    if (opts.daemonOwner && !opts.daemonOwner.resolved) {
      await warnIdentityUnresolvedOnce();
      continue;
    }
    const tier = parseComplexityTier(await tree.readFile(`.docs/complexity/${slug}.md`));
    const intakeMarker = await tree.readFile(`.docs/intake/${slug}.md`);
    const sourceRef = parseIntakeSourceRef(intakeMarker);
    const rawSourceRefLine = intakeMarker?.match(/^\s*Source-Ref:\s*(\S+)/im)?.[1];
    if (rawSourceRefLine && !sourceRef) {
      malformedSourceRefs.set(slug, rawSourceRefLine);
    }
    const daemonOwner = opts.daemonOwner;
    if (daemonOwner?.resolved) {
      if ((opts.cutover ?? null) === null) await warnGateNoCutoverOnce();
      const stamp = opts.readStamp ? await opts.readStamp(slug) : { present: false };
      const mergeTime = opts.readMergeTime ? await opts.readMergeTime(slug) : null;
      const decision = decideSpecGate({
        daemonOwner: { id: daemonOwner.id },
        stamp,
        mergeTime,
        cutover: opts.cutover ?? null
      });
      if (!decision.build) {
        await warnOnce(slug, ownershipSkipMessage(slug, decision));
        continue;
      }
    }
    const track = parseTrack(await tree.readFile(`.docs/track/${slug}.md`));
    items.push({ slug, tier, ...sourceRef ? { sourceRef } : {}, ...track ? { track } : {} });
  }
  if (!opts.resolver) {
    return { items, waiting: [] };
  }
  const resolver = opts.resolver;
  const gated = [];
  const waiting = [];
  for (const item of items) {
    if (!item.sourceRef) {
      const rawRef = malformedSourceRefs.get(item.slug);
      if (rawRef !== void 0) {
        waiting.push({ slug: item.slug, verdict: { kind: "indeterminate", detail: `unparseable Source-Ref: ${rawRef}` } });
        continue;
      }
      gated.push(item);
      continue;
    }
    let verdict;
    try {
      verdict = await resolver.resolve(item.sourceRef);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      verdict = { kind: "indeterminate", detail };
    }
    if (verdict.kind === "unblocked") {
      gated.push(item);
    } else {
      waiting.push({ slug: item.slug, sourceRef: item.sourceRef, verdict });
    }
  }
  announceWaitingForRoot(projectRoot, log, waiting);
  return { items: gated, waiting };
}
function ownershipSkipMessage(slug, decision) {
  if (decision.build) return "";
  if (decision.reason === "other-owner") {
    return `skip ${slug}: owner-gate \u2014 spec is owned by another operator ('${decision.other}'), not this daemon; logged once.`;
  }
  const why = decision.reason === "unowned-post-cutover" ? "un-owned and merged on/after the grandfather cutover" : "un-owned with an indeterminate merge time";
  return `skip ${slug}: owner-gate \u2014 spec is ${why}. To build it, add an 'Owner:' marker to the spec on the default branch (or grandfather it via owner_gate_cutover); logged once.`;
}
async function resolveStoriesRef(projectRoot, tree, slug, planContent) {
  const m = planContent.match(/^\s*\*\*Stories:\*\*\s*`?([^\s`]+)`?/im);
  if (m) {
    const ref = toRepoRelative(projectRoot, m[1]);
    if (ref && await tree.readFile(ref) !== null) return ref;
  }
  const candidate = `.docs/stories/${slug}.md`;
  if (await tree.readFile(candidate) !== null) return candidate;
  return null;
}
function toRepoRelative(projectRoot, ref) {
  let rel = ref;
  if (isAbsolute(ref)) {
    const r = relative(projectRoot, ref);
    if (r.startsWith("..")) return null;
    rel = r;
  }
  return rel.split("\\").join("/");
}

// src/engine/backlog-priority.ts
function parsePriorityLabels(labels) {
  const priorityRank = { high: 3, medium: 2, low: 1 };
  let maxRank = 0;
  let maxPriority = void 0;
  for (const label of labels) {
    const match = label.match(/^priority: (high|medium|low)$/);
    if (match) {
      const band = match[1];
      const rank = priorityRank[band];
      if (rank > maxRank) {
        maxRank = rank;
        maxPriority = band;
      }
    }
  }
  return maxPriority;
}
function createPriorityResolver(reader, log) {
  const cache = /* @__PURE__ */ new Map();
  let inOutage = false;
  let hasWarnedThisOutage = false;
  return {
    async resolve(items, options) {
      const bands = /* @__PURE__ */ new Map();
      const sourceRefs = items.filter((item) => item.sourceRef).map((item) => item.sourceRef);
      if (options.refresh || sourceRefs.length === 0) {
        if (sourceRefs.length > 0) {
          try {
            const readerResult = await reader(sourceRefs);
            inOutage = false;
            hasWarnedThisOutage = false;
            for (const [ref, labels] of readerResult.entries()) {
              if (labels !== "not-found") {
                cache.set(ref, labels);
              } else {
                cache.delete(ref);
              }
            }
          } catch (error) {
            inOutage = true;
            cache.clear();
            if (!hasWarnedThisOutage) {
              const errorMsg = error instanceof Error ? error.message : String(error);
              log(`Priority resolution outage (reader failed): ${errorMsg}`);
              hasWarnedThisOutage = true;
            }
            return { mode: "fallback" };
          }
        }
      }
      if (inOutage) {
        return { mode: "fallback" };
      }
      for (const item of items) {
        if (!item.sourceRef) {
          bands.set(item.slug, "no-issue");
        } else {
          const labels = cache.get(item.sourceRef);
          if (labels) {
            const priority = parsePriorityLabels(labels);
            bands.set(item.sourceRef, priority || "unlabeled");
          } else {
            bands.set(item.sourceRef, "unlabeled");
          }
        }
      }
      return { mode: "banded", bands };
    }
  };
}
var BAND_RANK = {
  "no-issue": 0,
  high: 1,
  medium: 2,
  low: 3,
  unlabeled: 4
};
function orderBacklog(items, res) {
  if (res.mode === "fallback" || res.mode === "off") {
    return items.map((item) => ({
      ...item,
      resolutionMode: res.mode
    }));
  }
  const { bands } = res;
  const itemsWithBands = items.map((item, index) => {
    let band;
    if (!item.sourceRef) {
      band = "no-issue";
    } else {
      band = bands.get(item.sourceRef) || "unlabeled";
    }
    return { originalIndex: index, item, band };
  });
  itemsWithBands.sort((a, b) => {
    const rankDiff = BAND_RANK[a.band] - BAND_RANK[b.band];
    if (rankDiff !== 0) {
      return rankDiff;
    }
    return a.originalIndex - b.originalIndex;
  });
  return itemsWithBands.map(({ item, band }) => ({
    ...item,
    band,
    resolutionMode: "banded"
  }));
}
function parseIssueRef(sourceRef) {
  const hash = sourceRef.lastIndexOf("#");
  if (hash <= 0 || hash === sourceRef.length - 1) return null;
  const repo = sourceRef.slice(0, hash);
  const number = sourceRef.slice(hash + 1);
  if (!/^\d+$/.test(number)) return null;
  const slashIndex = repo.indexOf("/");
  if (slashIndex <= 0 || slashIndex === repo.length - 1) return null;
  const owner = repo.slice(0, slashIndex);
  const repoName = repo.slice(slashIndex + 1);
  return { owner, repo: repoName, number };
}
function ghIssueLabelReader(runner) {
  return async (refs) => {
    const result = /* @__PURE__ */ new Map();
    for (const ref of refs) {
      try {
        const parsed = parseIssueRef(ref);
        if (!parsed) {
          result.set(ref, "not-found");
          continue;
        }
        const { owner, repo, number } = parsed;
        const args = ["api", `repos/${owner}/${repo}/issues/${number}`];
        const { stdout } = await runner(args, { cwd: "." });
        const data = JSON.parse(stdout);
        const labels = (data.labels ?? []).map((l) => l.name ?? "").filter(Boolean);
        result.set(ref, labels);
      } catch (error) {
        const is404 = error?.status === 404 || error instanceof Error && error.message.includes("404");
        if (is404) {
          result.set(ref, "not-found");
        } else {
          throw error;
        }
      }
    }
    return result;
  };
}

// src/engine/daemon-work-source.ts
function localWorkSource(deps) {
  return {
    async discover({ refresh }) {
      if (refresh) await deps.fastForwardRoot(deps.projectRoot, deps.log);
      const daemonOwner = deps.resolveDaemonOwner ? await deps.resolveDaemonOwner() : void 0;
      const gateOpts = daemonOwner ? {
        daemonOwner,
        ...deps.readStamp ? { readStamp: deps.readStamp } : {},
        ...deps.readMergeTime ? { readMergeTime: deps.readMergeTime } : {},
        cutover: deps.cutover ?? null
      } : {};
      const resolver = deps.makeResolver?.();
      let { items, waiting } = await deps.discoverBacklog(
        deps.projectRoot,
        (slug) => deps.isProcessed(slug),
        deps.log,
        {
          baseBranch: deps.baseBranch,
          hasWarned: (slug) => deps.hasWarned(slug),
          markWarned: (slug) => deps.markWarned(slug),
          ...resolver ? { resolver } : {},
          ...deps.repairProcessed ? { repairProcessed: deps.repairProcessed } : {},
          ...gateOpts
        }
      );
      if (deps.priorityResolver) {
        const resolution = await deps.priorityResolver.resolve(items, { refresh });
        items = orderBacklog(items, resolution);
      }
      return items;
    }
  };
}

// src/engine/owner-gate/provenance.ts
async function readSpecOwnerStamp(git, baseBranch, slug) {
  const { exitCode, stdout } = await git(["show", `${baseBranch}:.docs/intake/${slug}.md`]);
  if (exitCode !== 0) return { present: false };
  for (const line of stdout.split("\n")) {
    const m = /^\s*Owner:\s*(.*)$/.exec(line);
    if (!m) continue;
    const id = normalizeOwnerId(m[1]);
    return id === null ? { present: false } : { present: true, id };
  }
  return { present: false };
}

// src/engine/owner-gate/merge-time.ts
async function firstAppearanceTime(git, baseBranch, planPath) {
  const { exitCode, stdout } = await git([
    "log",
    baseBranch,
    "--diff-filter=A",
    "--format=%cI",
    "--",
    planPath
  ]);
  if (exitCode !== 0) return null;
  const lines = stdout.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  if (lines.length === 0) return null;
  return lines[lines.length - 1];
}

// src/engine/daemon-runner.ts
import { join as join3 } from "path";
import { randomUUID } from "crypto";
import { mkdir as mkdir2, readFile as readFile3, writeFile as writeFile2 } from "fs/promises";

// src/engine/mergeable-sweep.ts
import { mkdir, readFile as readFile2, writeFile } from "fs/promises";
import { join as join2 } from "path";
var WATCH_FILE = ".daemon/mergeable-watch.jsonl";
async function enrollWatch(projectRoot, entry) {
  try {
    await mkdir(join2(projectRoot, ".daemon"), { recursive: true });
    await writeFile(join2(projectRoot, WATCH_FILE), JSON.stringify(entry) + "\n", { flag: "a" });
  } catch {
  }
}
async function readWatch(projectRoot) {
  try {
    const content = await readFile2(join2(projectRoot, WATCH_FILE), "utf-8");
    return content.split("\n").filter((line) => line.trim().length > 0).flatMap((line) => {
      try {
        const obj = JSON.parse(line);
        if (obj !== null && typeof obj === "object" && "prUrl" in obj && "slug" in obj && "repoCwd" in obj && typeof obj.prUrl === "string" && typeof obj.slug === "string" && typeof obj.repoCwd === "string") {
          return [obj];
        }
        return [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}
async function rewriteWatch(projectRoot, entries) {
  try {
    const content = entries.length > 0 ? entries.map((e) => JSON.stringify(e)).join("\n") + "\n" : "";
    await writeFile(join2(projectRoot, WATCH_FILE), content);
  } catch {
  }
}
async function sweepMergeableLabels({ projectRoot, log, runGh }) {
  const gh = runGh ?? makeProductionGh();
  try {
    const entries = await readWatch(projectRoot);
    const survivors = [];
    for (const entry of entries) {
      try {
        const state = await prMergeState(gh, entry.repoCwd, entry.prUrl, log);
        if (state.state === "MERGED" || state.state === "CLOSED" || state.state === "NOTFOUND") {
          log?.(`[mergeable-sweep] pruning ${entry.prUrl} (state: ${state.state})`);
          continue;
        }
        if (state.state === "UNKNOWN") {
          log?.(`[mergeable-sweep] skipping ${entry.prUrl} (could not read state)`);
          survivors.push(entry);
          continue;
        }
        survivors.push(entry);
        if (state.labels.includes("needs-remediation")) {
          if (state.labels.includes("mergeable")) {
            await removeLabel(gh, entry.repoCwd, entry.prUrl, "mergeable", log);
          }
          continue;
        }
        if (isMergeable(state)) {
          if (!state.labels.includes("mergeable")) {
            await ensureLabel(gh, entry.repoCwd, "mergeable", "0E8A16", log);
            await addLabel(gh, entry.repoCwd, entry.prUrl, "mergeable", log);
          }
        } else {
          if (state.labels.includes("mergeable")) {
            await removeLabel(gh, entry.repoCwd, entry.prUrl, "mergeable", log);
          }
        }
      } catch (err) {
        log?.(`[mergeable-sweep] error processing ${entry.prUrl}: ${err}`);
        survivors.push(entry);
      }
    }
    await rewriteWatch(projectRoot, survivors);
  } catch (err) {
    log?.(`[mergeable-sweep] sweep error: ${err}`);
  }
}

// src/engine/daemon-runner.ts
function makeRunFeature(deps) {
  const log = deps.log ?? (() => {
  });
  const gh = deps.runGh ?? makeProductionGh();
  const enroll = deps.enrollWatch ?? enrollWatch;
  const sweep = deps.sweepMergeableLabels ?? sweepMergeableLabels;
  const maybeSweep = async () => {
    if (!deps.projectRoot) return;
    try {
      await sweep({ projectRoot: deps.projectRoot, log, runGh: deps.runGh });
    } catch (err) {
      log(`[daemon-runner] sweep error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  return async (item) => {
    let worktree = null;
    try {
      worktree = await deps.createWorktree(item.slug);
      if (deps.prepareWorktree) await deps.prepareWorktree(worktree);
      await deps.runConductor(worktree, item);
      const outcome = await deps.readOutcome(worktree);
      if (deps.daemon) {
        await emitDaemonSignal(deps, worktree, item, outcome);
      }
      if (outcome.done) {
        if (outcome.prUrl && deps.projectRoot) {
          try {
            const state = await prMergeState(gh, deps.projectRoot, outcome.prUrl, log);
            if (state.labels.includes("needs-remediation")) {
              await removeLabel(gh, deps.projectRoot, outcome.prUrl, "needs-remediation", log);
              await setReady(gh, deps.projectRoot, outcome.prUrl, log);
            }
          } catch (err) {
            log(`[daemon-runner] clear-on-success error: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        if (outcome.prUrl && deps.projectRoot) {
          try {
            await enroll(deps.projectRoot, {
              prUrl: outcome.prUrl,
              slug: item.slug,
              repoCwd: deps.projectRoot
            });
          } catch (err) {
            log(`[daemon-runner] enrollWatch error: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        await deps.markProcessed(item.slug, outcome.prUrl);
        await deps.teardownWorktree(worktree, false);
        log(`\u2713 ${item.slug} shipped${outcome.prUrl ? ` \u2192 ${outcome.prUrl}` : ""}`);
        await maybeSweep();
        return {
          slug: item.slug,
          status: "done",
          prUrl: outcome.prUrl,
          costTokens: outcome.costTokens
        };
      }
      if (outcome.halted) {
        await deps.teardownWorktree(worktree, true);
        log(`\u270B ${item.slug} halted \u2014 worktree kept (${outcome.reason ?? "see .pipeline/HALT"})`);
        await maybeSweep();
        return {
          slug: item.slug,
          status: "halted",
          reason: outcome.reason,
          costTokens: outcome.costTokens
        };
      }
      const noMarkerReason = outcome.reason ?? "loop ended without DONE or HALT marker";
      await writeErrorHalt(worktree, noMarkerReason);
      await deps.teardownWorktree(worktree, true);
      await maybeSweep();
      return {
        slug: item.slug,
        status: "error",
        reason: noMarkerReason,
        costTokens: outcome.costTokens
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (worktree) {
        await writeErrorHalt(worktree, reason);
        await deps.teardownWorktree(worktree, true).catch(() => {
        });
      }
      return {
        slug: item.slug,
        status: "error",
        reason
      };
    }
  };
}
async function writeErrorHalt(worktree, reason) {
  const note = `feature errored \u2014 parked for human inspection
${reason}

Resume procedure:
  1. Fix the cause of the error above (project setup / config / environment / a crashed step).
  2. rm .pipeline/HALT
  3. Re-queue the feature (restart the daemon if it was excluded this run).
`;
  await mkdir2(join3(worktree.path, ".pipeline"), { recursive: true }).catch(() => {
  });
  await writeFile2(join3(worktree.path, ".pipeline", "HALT"), note, "utf-8").catch(() => {
  });
}
async function emitDaemonSignal(deps, worktree, item, outcome) {
  const featureOutcome = {
    slug: item.slug,
    status: outcome.done ? "done" : outcome.halted ? "halted" : "error",
    reason: outcome.reason,
    prUrl: outcome.prUrl,
    costTokens: outcome.costTokens
  };
  const eventsPath = join3(worktree.path, ".pipeline", "events.jsonl");
  const tierSkippedRetro = await retroTierSkipped(eventsPath);
  await emitEngineerSignal({
    engineerDir: resolveEngineerDir(),
    eventsPath,
    outcome: featureOutcome,
    project: deps.project,
    feature: item.slug,
    runId: `${Date.now()}-${randomUUID().slice(0, 8)}`,
    worktreePath: worktree.path,
    provider: deps.provider,
    tierSkippedRetro,
    log: deps.log
  });
}
async function retroTierSkipped(eventsPath) {
  try {
    const raw = await readFile3(eventsPath, "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const evt = JSON.parse(trimmed);
        if (evt.type === "tier_skip" && evt.step === "retro") return true;
      } catch {
      }
    }
  } catch {
  }
  return false;
}

// src/engine/gh-blocker-runner.ts
import { execFile as execFileCb2 } from "child_process";
import { promisify as promisify2 } from "util";
var execFile2 = promisify2(execFileCb2);
function createGhBlockerRunner() {
  return async (args) => {
    const { stdout } = await execFile2("gh", args);
    return { stdout };
  };
}

// src/engine/daemon-deps.ts
import { execa as execa2 } from "execa";
import { mkdir as mkdir3, writeFile as writeFile4, readFile as readFile5, access as access2, stat } from "fs/promises";
import { basename as basename3, join as join5 } from "path";

// src/engine/worktree-prepare.ts
import { execa } from "execa";
import { access, readFile as readFile4, writeFile as writeFile3 } from "fs/promises";
import { basename as basename2, join as join4 } from "path";
var SETUP_SCRIPT = join4("bin", "setup");
var NAMESPACE_VAR = "WORKTREE_NAMESPACE";
async function prepareWorktree(worktreePath, log) {
  const namespace = sanitizeNamespace(basename2(worktreePath));
  await writeNamespaceEnv(worktreePath, namespace, log);
  await runProjectSetup(worktreePath, namespace, log);
}
function sanitizeNamespace(raw) {
  return raw.replace(/[^A-Za-z0-9_]/g, "_");
}
async function writeNamespaceEnv(worktreePath, namespace, log) {
  const envPath = join4(worktreePath, ".env");
  let existing = "";
  try {
    existing = await readFile4(envPath, "utf-8");
  } catch {
  }
  const kept = existing.split("\n").filter((l) => !l.startsWith(`${NAMESPACE_VAR}=`));
  while (kept.length && kept[kept.length - 1].trim() === "") kept.pop();
  kept.push(`${NAMESPACE_VAR}=${namespace}`, "");
  await writeFile3(envPath, kept.join("\n"), "utf-8");
  log?.(`worktree env: ${NAMESPACE_VAR}=${namespace}`);
}
async function runProjectSetup(worktreePath, namespace, log) {
  const script = join4(worktreePath, SETUP_SCRIPT);
  try {
    await access(script);
  } catch {
    log?.("no bin/setup \u2014 skipping project setup");
    return;
  }
  log?.(`running ${SETUP_SCRIPT}`);
  try {
    const result = await execa(script, [], {
      cwd: worktreePath,
      all: true,
      env: { CI: "true", [NAMESPACE_VAR]: namespace }
    });
    if (result.all && result.all.trim()) {
      for (const line of result.all.trim().split("\n")) log?.(`setup: ${line}`);
    }
    log?.("setup: ok");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`project setup (${SETUP_SCRIPT}) failed: ${detail}`);
  }
}

// src/engine/daemon-deps.ts
var PROCESSED_SUBDIR = ".daemon/processed";
var WARNED_SUBDIR = ".daemon/warned";
function makeFeatureRunnerDeps(cfg) {
  const processedDir = join5(cfg.projectRoot, PROCESSED_SUBDIR);
  return {
    log: cfg.log,
    // The real daemon path always emits to the engineer store on completion
    // (Phase 9.1). Manual `/conduct` runs don't go through makeFeatureRunnerDeps.
    daemon: true,
    provider: cfg.provider,
    // Thread the resolved active memory provider onto run context (adr-2026-06-29-per-project-memory-provider-selection/FR-10).
    memoryProvider: cfg.memoryProvider,
    // Project key for the engineer store = the main checkout's basename (NOT the
    // worktree path, which is always `<projectRoot>/.worktrees/<slug>`).
    project: basename3(cfg.projectRoot),
    // FR-9: the MAIN checkout path — the watch registry lives here, and gh ops
    // are issued from here after the worktree is torn down on ship.
    projectRoot: cfg.projectRoot,
    // FR-16: production gh runner for clear-on-success label ops.
    runGh: makeProductionGh(),
    createWorktree: async (slug) => {
      const branch = `feat/daemon-${slug}`;
      const path = join5(cfg.worktreeBase, slug);
      const root = cfg.projectRoot;
      const { path: p, branch: b } = await ensureWorktree({
        root,
        path,
        branch,
        resolveBase: () => resolveWorktreeBase(root, cfg.baseBranch),
        log: cfg.log
      });
      return { path: p, branch: b };
    },
    // Write WORKTREE_NAMESPACE into the worktree .env and run the project's
    // bin/setup (no-op if absent). Keeps the daemon stack-agnostic while letting
    // each project translate the namespace into its own shared/namespaced infra.
    prepareWorktree: (wt) => prepareWorktree(wt.path, cfg.log),
    runConductor: (wt, item) => cfg.runConductorInWorktree(wt, item),
    readOutcome: (wt) => readWorktreeOutcome(wt.path),
    teardownWorktree: async (wt, keep) => {
      if (keep) return;
      await execa2("git", ["worktree", "remove", "--force", wt.path], {
        cwd: cfg.projectRoot
      }).catch(() => {
      });
    },
    markProcessed: async (slug, prUrl) => {
      await mkdir3(processedDir, { recursive: true });
      await writeFile4(
        join5(processedDir, slug),
        `${JSON.stringify({ status: "shipped", prUrl: prUrl ?? null })}
`,
        "utf-8"
      );
    }
    // NOTE (#204/#205, as-built review): the shipped record is NOT written
    // here. Per adr-2026-07-03-committed-shipped-record-dispatch-dedup
    // Decision 1, `/finish` commits `.docs/shipped/<slug>.md` on the
    // IMPLEMENTATION branch (via `conduct shipped-record`) before the final
    // push, so the human merge lands code + shipped-fact atomically. A
    // daemon-side write here would land on the main checkout's base branch —
    // never pushed, and it permanently breaks fastForwardRoot's --ff-only
    // advance once local main is ahead of origin.
  };
}
async function resolveWorktreeBase(projectRoot, baseBranch) {
  const remote = `origin/${baseBranch}`;
  try {
    await execa2("git", ["rev-parse", "--verify", "--quiet", remote], { cwd: projectRoot });
    return remote;
  } catch {
    return baseBranch;
  }
}
async function isProcessed(projectRoot, slug) {
  try {
    await access2(join5(projectRoot, PROCESSED_SUBDIR, slug));
    return true;
  } catch {
    return false;
  }
}
async function repairProcessed(projectRoot, slug, record) {
  const processedDir = join5(projectRoot, PROCESSED_SUBDIR);
  await mkdir3(processedDir, { recursive: true });
  const prUrl = "malformed" in record ? null : record.pr ?? null;
  await writeFile4(
    join5(processedDir, slug),
    `${JSON.stringify({ status: "shipped", prUrl })}
`,
    "utf-8"
  );
}
async function hasWarned(projectRoot, slug) {
  try {
    await access2(join5(projectRoot, WARNED_SUBDIR, slug));
    return true;
  } catch {
    return false;
  }
}
async function markWarned(projectRoot, slug) {
  const warnedDir = join5(projectRoot, WARNED_SUBDIR);
  await mkdir3(warnedDir, { recursive: true });
  await writeFile4(join5(warnedDir, slug), "warned\n", "utf-8");
}
async function isHalted(worktreeBase, slug) {
  return exists(join5(worktreeBase, slug, HALT_MARKER));
}
async function readWorktreeOutcome(worktreePath) {
  const done = await exists(join5(worktreePath, ".pipeline/DONE"));
  const haltPath = join5(worktreePath, HALT_MARKER);
  const halted = await exists(haltPath);
  let reason;
  if (halted) {
    reason = (await readFile5(haltPath, "utf-8").catch(() => "")).trim() || void 0;
  }
  let prUrl;
  try {
    const state = JSON.parse(
      await readFile5(join5(worktreePath, ".pipeline/conduct-state.json"), "utf-8")
    );
    prUrl = state.pr_url;
  } catch {
  }
  let finishChoice;
  try {
    const raw = (await readFile5(join5(worktreePath, FINISH_CHOICE_MARKER), "utf-8")).trim();
    if (FINISH_CHOICE_VALUES.includes(raw)) {
      finishChoice = raw;
    }
  } catch {
  }
  return { done, halted, reason, prUrl, finishChoice };
}
async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// src/engine/daemon-sha.ts
import { mkdir as mkdir4, readFile as readFile6, writeFile as writeFile5 } from "fs/promises";
import { dirname, join as join6 } from "path";
var LAST_BASE_SHA_PATH = ".daemon/last-base-sha";
var SHA40 = /^[0-9a-f]{40}$/;
function parseSha(raw) {
  if (raw == null) return null;
  const trimmed = raw.trim();
  return SHA40.test(trimmed) ? trimmed : null;
}
async function readBaseSha(git, ref) {
  const r = await git(["rev-parse", ref]);
  if (r.exitCode !== 0) return null;
  return parseSha(r.stdout);
}
async function readPersistedBaseSha(dir) {
  try {
    const raw = await readFile6(join6(dir, LAST_BASE_SHA_PATH), "utf-8");
    return parseSha(raw);
  } catch {
    return null;
  }
}
async function writePersistedBaseSha(dir, sha, log) {
  const target = join6(dir, LAST_BASE_SHA_PATH);
  try {
    await mkdir4(dirname(target), { recursive: true });
    await writeFile5(target, `${sha}
`, "utf-8");
  } catch (err) {
    log?.(`could not persist last-base-sha: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// src/engine/daemon-rekick.ts
import { readdir as readdir2, readFile as readFile7, rename, rm, writeFile as writeFile6, stat as stat2 } from "fs/promises";
import { join as join7 } from "path";
var HALT_CLEARED_MARKER = ".pipeline/HALT.cleared";
var REKICK_SENTINEL = ".pipeline/REKICK";
var warnedShippedByDeps = /* @__PURE__ */ new WeakMap();
async function rekickSweep(deps, sha) {
  const log = deps.log ?? (() => {
  });
  const cleared = [];
  const skipped = [];
  let slugs;
  try {
    slugs = await deps.listHaltedWorktrees();
  } catch (err) {
    log(`re-kick: could not list halted worktrees (${errMsg(err)}); skipping sweep`);
    return { cleared, skipped };
  }
  for (const slug of slugs) {
    if (deps.isProcessed) {
      let processed = false;
      try {
        processed = await deps.isProcessed(slug);
      } catch (err) {
        log(`re-kick ${slug}: isProcessed check FAILED (${errMsg(err)}); treating as unprocessed`);
        processed = false;
      }
      if (processed) {
        skipped.push(slug);
        let fallback = warnedShippedByDeps.get(deps);
        if (!fallback) {
          fallback = /* @__PURE__ */ new Set();
          warnedShippedByDeps.set(deps, fallback);
        }
        const alreadyWarned = deps.hasWarned ? await deps.hasWarned(slug) : fallback.has(slug);
        if (!alreadyWarned) {
          log(`re-kick ${slug}: skipping re-kick: ${slug} already shipped`);
          if (deps.markWarned) await deps.markWarned(slug);
          else fallback.add(slug);
        }
        continue;
      }
    }
    if (deps.lastRekickSha.get(slug) === sha) {
      skipped.push(slug);
      continue;
    }
    let reason = "unknown";
    try {
      reason = await deps.readHaltReason(slug);
    } catch {
    }
    log(`re-kick ${slug} @ ${sha.slice(0, 12)} \u2014 ${reason}`);
    try {
      if (await deps.hasRebaseInProgress(slug)) {
        await deps.abortRebase(slug);
        log(`re-kick ${slug}: aborted in-progress rebase before clearing`);
      }
    } catch (err) {
      log(`re-kick ${slug}: rebase --abort FAILED (${errMsg(err)}); leaving marker intact`);
      skipped.push(slug);
      continue;
    }
    try {
      await deps.clearMarker(slug);
    } catch (err) {
      log(`re-kick ${slug}: clear failed (${errMsg(err)}); skipped`);
      skipped.push(slug);
      continue;
    }
    deps.lastRekickSha.set(slug, sha);
    cleared.push(slug);
  }
  return { cleared, skipped };
}
function errMsg(err) {
  return err instanceof Error ? err.message : String(err);
}
async function exists2(p) {
  try {
    await stat2(p);
    return true;
  } catch {
    return false;
  }
}
async function listHaltedWorktrees(worktreeBase) {
  let entries;
  try {
    entries = await readdir2(worktreeBase, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (await exists2(join7(worktreeBase, e.name, HALT_MARKER))) out.push(e.name);
  }
  return out;
}
async function readHaltReason(worktreeBase, slug) {
  try {
    const content = await readFile7(join7(worktreeBase, slug, HALT_MARKER), "utf-8");
    for (const line of content.split("\n")) {
      const t = line.trim();
      if (t.length > 0) return t;
    }
  } catch {
  }
  return "unknown";
}
async function hasRebaseInProgress(worktreePath) {
  return rebaseStateActive(makeGitRunner(worktreePath), worktreePath);
}
async function abortRebase(worktreePath) {
  const git = makeGitRunner(worktreePath);
  const r = await git(["rebase", "--abort"]);
  if (r.exitCode !== 0) {
    throw new Error(r.stderr.trim() || `git rebase --abort exited ${r.exitCode}`);
  }
}
async function clearMarker(worktreePath) {
  const halt = join7(worktreePath, HALT_MARKER);
  const cleared = join7(worktreePath, HALT_CLEARED_MARKER);
  await rename(halt, cleared).catch(async () => {
  });
  await rm(halt, { force: true });
  await writeFile6(join7(worktreePath, REKICK_SENTINEL), `rekick
`, "utf-8");
}
async function resumeRebaseFirst(opts) {
  const sentinel = join7(opts.worktreePath, REKICK_SENTINEL);
  if (!await exists2(sentinel)) return "skipped";
  await rm(sentinel, { force: true });
  const git = makeGitRunner(opts.worktreePath);
  let outcome;
  try {
    outcome = await performRebase(git, opts.worktreePath, opts.localBase);
  } catch (err) {
    outcome = {
      kind: "conflict_halt",
      conflicts: [],
      reason: err instanceof Error ? err.message : String(err)
    };
  }
  await applyRebaseVerdicts(opts.worktreePath, outcome, opts.ranManualTest);
  await emitRebaseEvent(opts.events, outcome);
  if (outcome.kind === "conflict_halt") {
    await writeHalt(opts.worktreePath, outcome.conflicts, outcome.reason);
    opts.log?.(`re-kick ${basename4(opts.worktreePath)}: rebase re-conflicted on advanced base \u2014 re-parked`);
    return "halted";
  }
  opts.log?.(`re-kick ${basename4(opts.worktreePath)}: rebased onto latest before resuming gate`);
  return "rebased";
}
function basename4(p) {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

// src/daemon-cli.ts
var execFile3 = promisify3(execFileCb3);
var PRESEEDED_DONE = [
  "worktree",
  "memory",
  "explore",
  "prd",
  "complexity",
  "stories",
  "conflict_check",
  "plan",
  "architecture_diagram",
  "architecture_review"
];
var ANSI_SGR = /\x1b\[[0-9;]*m/g;
function stripAnsi(s) {
  return s.replace(ANSI_SGR, "");
}
async function runDaemonMode(opts) {
  const { projectRoot } = opts;
  const ensureFresh = opts.ensureFresh ?? (() => ensureInstallFresh({ interactive: false }));
  await ensureFresh();
  const baseBranch = opts.baseBranch ?? await originDefaultBranch(makeGitRunner(projectRoot)) ?? "main";
  let logSink = null;
  const log = (msg) => {
    console.log(`${chalk2.dim("[daemon]")} ${msg}`);
    logSink?.write(formatDaemonLogLine(`[daemon] ${stripAnsi(msg)}`));
  };
  const lock = await holdLock(projectRoot);
  if (lock === null) {
    log(`another daemon is already running for ${projectRoot}; exiting (1-per-repo).`);
    return;
  }
  logSink = await openDaemonLog(projectRoot);
  log(
    lock.owned ? `holding daemon lock (pid ${lock.pid}) for ${projectRoot}` : `WARNING: could not write pidfile for ${projectRoot}; liveness is not observable`
  );
  const releaseBackstop = () => {
    logSink?.closeSync();
    lock.releaseSync();
  };
  process.once("exit", releaseBackstop);
  const pausedAtBoot = await isPaused(projectRoot);
  if (pausedAtBoot) {
    log("daemon is paused \u2014 booting with zero dispatch until resumed (see `conduct daemon resume`).");
  }
  const consumedRestartIntent = await consumeOnBoot(projectRoot);
  if (consumedRestartIntent) {
    const blockingSlug = consumedRestartIntent.blockingSlug ? ` (was waiting behind ${consumedRestartIntent.blockingSlug})` : "";
    const requestedBy = consumedRestartIntent.requestedBy ? ` by ${consumedRestartIntent.requestedBy}` : "";
    log(`restart marker consumed${blockingSlug}${requestedBy} at boot.`);
  }
  const configResult = await loadConfig(projectRoot);
  const config = configResult.ok ? configResult.config : void 0;
  const isSelfHost = await classifySelfHost(defaultSelfHostDetector(), config, projectRoot);
  if (isSelfHost) {
    log("self-host mode active \u2014 harness self-build guardrails enabled for this daemon.");
  }
  const events = new ConductorEventEmitter();
  const registry2 = new PluginRegistry();
  const subscriber = registerBuiltins(
    registry2,
    events,
    (event) => renderDaemonEvent(event, log)
  );
  registry2.markInitialized();
  subscriber.start();
  const provider = registry2.get("llm_provider", config?.llm_provider ?? "claude");
  const memoryResolveCtx = { warnings: [] };
  const memoryProvider = await resolveMemoryProvider(config ?? {}, registry2, memoryResolveCtx);
  if (memoryResolveCtx.warnings.length > 0) {
    for (const w of memoryResolveCtx.warnings) log(`WARNING: ${w}`);
  }
  const worktreeBase = join8(projectRoot, ".worktrees");
  await mkdir5(worktreeBase, { recursive: true });
  const runConductorInWorktree = async (wt, item) => {
    const pipelineDir = join8(wt.path, ".pipeline");
    await mkdir5(pipelineDir, { recursive: true });
    await rm2(join8(pipelineDir, "session-created"), { force: true });
    await rm2(join8(pipelineDir, "conduct-session-id"), { force: true });
    const stateFilePath = join8(pipelineDir, "conduct-state.json");
    const existingResult = await readState(stateFilePath);
    const baseState = existingResult.ok && Object.keys(existingResult.value).length > 0 ? existingResult.value : { complexity_tier: item.tier ?? "M", track: item.track ?? "product", feature_desc: item.slug };
    for (const name of PRESEEDED_DONE) {
      baseState[name] = "done";
    }
    if (!baseState.complexity_tier) baseState.complexity_tier = item.tier ?? "M";
    if (!baseState.track) baseState.track = item.track ?? "product";
    if (baseState.track === "technical") {
      baseState["prd"] = "skipped";
    }
    if (!baseState.feature_desc) baseState.feature_desc = item.slug;
    await writeState(stateFilePath, baseState);
    const stepRunner = new DefaultStepRunner(provider, uuidv4(), wt.path, {
      featureDesc: item.slug,
      pipelineDir,
      config,
      mode: "auto"
    });
    const conductor = new Conductor({
      stateFilePath,
      stepRunner,
      events,
      mode: "auto",
      config,
      projectRoot: wt.path,
      // Self-host guardrails (Phase 6): activate the bundle only when this daemon
      // is building the harness itself. `baseBranch` feeds the release-artifact
      // migration classifier (`<base>...HEAD`).
      selfHost: isSelfHost,
      baseBranch,
      verifyArtifacts: true,
      freshContextPerStep: true,
      // Resume from the first unsatisfied step rather than hardcoding the entry
      // point. With the DECIDE steps stamped done (PRESEEDED_DONE above), a
      // FRESH feature resumes at `acceptance_specs` — the first pending step —
      // exactly as before. A RE-DISPATCH of a feature with recorded BUILD/SHIP
      // progress resumes at its real next step (e.g. prd_audit / finish) instead
      // of re-entering at acceptance_specs every cycle. (`fromStep` forced
      // acceptance_specs and, being `explicitlyTargeted`, re-ran it on every
      // resume.)
      resume: true,
      // Phase 9.1: daemon runs skip the in-loop retro; the emission step writes
      // the narrative to the engineer store instead of the repo's .docs/retros/.
      daemon: true
    });
    const ranManualTest = getStepStatus(baseState, "manual_test") !== "skipped";
    const resume = await resumeRebaseFirst({
      worktreePath: wt.path,
      localBase: baseBranch,
      events,
      ranManualTest,
      log
    });
    if (resume === "halted") return;
    await conductor.run();
    const finalState = await readState(stateFilePath);
    const ghRunner = async (args, opts2) => {
      const r = await execFile3("gh", args, { cwd: opts2.cwd });
      return { stdout: String(r.stdout) };
    };
    await closeIssueOnImplementationMerge({
      gh: ghRunner,
      sourceRef: item.sourceRef,
      prUrl: finalState.ok ? finalState.value.pr_url : void 0,
      cwd: wt.path,
      slug: item.slug,
      log
    });
    const finalPrUrl = finalState.ok ? finalState.value.pr_url : void 0;
    if (finalPrUrl) {
      const outcome = await rehabilitateHaltPr({
        gh: ghRunner,
        cwd: wt.path,
        prUrl: finalPrUrl,
        sourceRef: item.sourceRef,
        log
      });
      if (outcome !== "not-halt-pr") {
        log(`[${item.slug}] halt-pr rehabilitation: ${outcome} (${finalPrUrl})`);
      }
    }
  };
  const deps = makeFeatureRunnerDeps({
    projectRoot,
    worktreeBase,
    baseBranch,
    runConductorInWorktree,
    provider,
    memoryProvider,
    log
  });
  const runFeature = makeRunFeature(deps);
  const continuous = opts.continuous ?? false;
  const hasCeiling = opts.maxItems != null || opts.maxCostTokens != null || opts.maxRuntimeSeconds != null || opts.maxIdlePolls != null;
  if (continuous && !hasCeiling) {
    log(
      "WARNING: --continuous with no ceiling (--max-items/--max-cost/--max-runtime/--max-idle-polls) runs unbounded; Ctrl-C to stop."
    );
  }
  log(
    `scanning backlog (concurrency ${opts.concurrency}${continuous ? ", continuous" : ""})\u2026`
  );
  const ownerGh = async (args, o) => {
    const { stdout } = await execFile3("gh", args, { cwd: o.cwd });
    return { stdout: String(stdout) };
  };
  const ownerGit = makeGitRunner(projectRoot);
  const execRunnerWrapper = (args) => ownerGh(args, { cwd: projectRoot });
  const priorityResolver = createPriorityResolver(ghIssueLabelReader(execRunnerWrapper), log);
  const workSource = opts.workSource ?? localWorkSource({
    projectRoot,
    baseBranch,
    log,
    isProcessed: (slug) => isProcessed(projectRoot, slug),
    hasWarned: (slug) => hasWarned(projectRoot, slug),
    markWarned: (slug) => markWarned(projectRoot, slug),
    // ADR Decisions 2b/2c: a shipped-record skip repairs the local ledger
    // cache so later polls take the fast path (record → marker backfill).
    repairProcessed: (slug, record) => repairProcessed(projectRoot, slug, record),
    fastForwardRoot,
    discoverBacklog,
    resolveDaemonOwner: makeMachineOwnerResolver(ownerGh, projectRoot),
    readStamp: (slug) => readSpecOwnerStamp(ownerGit, baseBranch, slug),
    readMergeTime: (slug) => firstAppearanceTime(ownerGit, baseBranch, `.docs/plans/${slug}.md`),
    cutover: config?.owner_gate_cutover ?? null,
    // Dependency gate (rem-fr4-2): fresh BlockerResolver per discover() pass
    // — see LocalWorkSourceDeps.makeResolver doc — so the per-pass memo in
    // createBlockerResolver() never leaks stale verdicts across polls. The
    // real `gh` binary backs the runner in production, the only production
    // caller of createGhBlockerRunner().
    makeResolver: () => createBlockerResolver({ run: createGhBlockerRunner() }),
    // Priority resolution (Task 13): post-gate ordering by issue priority bands.
    // The resolver is constructed once per daemon run with process-local caching
    // (no disk persistence). Passed to discover() for ordering and available to
    // the dashboard for fallback-mode display.
    priorityResolver
  });
  const discoverTick = (o) => workSource.discover(o);
  const processedDir = join8(projectRoot, ".daemon/processed");
  const lastRekickSha = /* @__PURE__ */ new Map();
  const rekickDeps = {
    listHaltedWorktrees: () => listHaltedWorktrees(worktreeBase),
    readHaltReason: (slug) => readHaltReason(worktreeBase, slug),
    hasRebaseInProgress: (slug) => hasRebaseInProgress(join8(worktreeBase, slug)),
    abortRebase: (slug) => abortRebase(join8(worktreeBase, slug)),
    clearMarker: (slug) => clearMarker(join8(worktreeBase, slug)),
    lastRekickSha,
    log,
    hasWarned: (slug) => hasWarned(projectRoot, slug),
    markWarned: (slug) => markWarned(projectRoot, slug)
  };
  const result = await runDaemon(
    {
      discoverBacklog: discoverTick,
      isHalted: (slug) => isHalted(worktreeBase, slug),
      // FR-1 (Task 11): gate dispatch on the durable `.daemon/PAUSED` marker,
      // re-polled every loop iteration by runDaemon so a pause lifted mid-run
      // resumes dispatch at the next boundary (no restart required).
      isPaused: () => isPaused(projectRoot),
      runFeature,
      log,
      // ── Halt-reconciliation (ADR-013) real-I/O hooks ──────────────────────
      // FR-1: scan inherited state and render the dashboard to both sinks
      // (console + daemon.log via `log`) before any dispatch. Pass the priority
      // resolver so the dashboard can capture and display band annotations / fallback mode.
      renderStartupDashboard: async () => {
        if (pausedAtBoot) return;
        const state = await scanInheritedState({
          worktreeBase,
          processedDir,
          discover: () => discoverTick({ refresh: true }),
          log
        });
        log(`
${renderDashboard(state)}`);
      },
      // FR-4: resolve the base-branch tip SHA from the SAME local default branch
      // the backlog reads. On idle refresh we fast-forward it first so the SHA
      // reflects origin's latest (driving ADR-013 re-kick when main advances).
      resolveBaseSha: async ({ refresh }) => {
        if (refresh) await fastForwardRoot(projectRoot, log);
        return readBaseSha(makeGitRunner(projectRoot), baseBranch);
      },
      readPersistedBaseSha: () => readPersistedBaseSha(projectRoot),
      writePersistedBaseSha: (sha) => writePersistedBaseSha(projectRoot, sha, log),
      rekickSweep: async (sha) => {
        await rekickSweep(
          {
            ...rekickDeps,
            isProcessed: makeIsProcessed(processedDir, gitTreeSource(projectRoot, baseBranch))
          },
          sha
        );
      },
      // FR-14: wire the startup + per-idle-poll-tick mergeable label sweep.
      // NOTE: this binding must stay wired — removing it silently no-ops all
      // startup and idle-poll sweeps in production (daemon.ts guards with ?.()).
      sweepMergeableLabels: async () => {
        await sweepMergeableLabels({ projectRoot, log });
      },
      // Task T28: check for pending restart marker at idle boundary.
      hasRestartPending: async () => {
        const intent = await readRestartPending(projectRoot);
        return intent !== null;
      },
      // Task T28: trigger self-restart when marker is pending (injected from supervisor/bare-run).
      triggerSelfRestart: opts.triggerSelfRestart
    },
    {
      concurrency: clampDaemonConcurrency(opts.concurrency, log),
      maxItems: opts.maxItems,
      maxTotalCostTokens: opts.maxCostTokens,
      maxRuntimeMs: opts.maxRuntimeSeconds != null ? opts.maxRuntimeSeconds * 1e3 : void 0,
      once: !continuous,
      idlePollMs: opts.idlePollSeconds != null ? opts.idlePollSeconds * 1e3 : void 0,
      maxIdlePolls: opts.maxIdlePolls
    }
  );
  subscriber.stop();
  log(`finished: ${result.processed.length} feature(s) (${result.stoppedReason})`);
  for (const o of result.processed) {
    log(
      `  ${o.slug}: ${o.status}${o.prUrl ? ` ${o.prUrl}` : ""}${o.reason ? ` \u2014 ${o.reason}` : ""}`
    );
  }
  process.off("exit", releaseBackstop);
  await logSink.close();
  await lock.release();
}
function renderDaemonEvent(event, log) {
  const dot = chalk2.dim("\xB7");
  switch (event.type) {
    case "step_started":
      log(`${dot} ${chalk2.cyan("\u25B6")} ${event.step}`);
      break;
    case "step_completed":
      log(`${dot}   ${event.step} ${chalk2.green("\u2713")} ${chalk2.green(event.status)}`);
      break;
    case "step_failed":
      log(
        `${dot} ${chalk2.red("\u2717")} ${chalk2.red(`${event.step} failed (try ${event.retryCount}): ${event.error}`)}`
      );
      break;
    case "step_retry":
      log(`${dot} ${chalk2.yellow("\u21BB")} ${event.step} ${chalk2.yellow("retry")}`);
      break;
    case "gate_verdict":
      if (!event.satisfied) {
        log(
          `${dot} ${chalk2.yellow(`gate ${event.step}: unsatisfied`)}${event.reason ? chalk2.dim(` \u2014 ${event.reason}`) : ""}`
        );
      }
      break;
    case "kickback":
      log(
        `${dot} ${chalk2.yellow("\u21A9")} kickback: ${event.from} re-opened ${event.to}${event.evidence ? ` \u2014 ${event.evidence}` : ""} ${chalk2.dim(`(\xD7${event.count})`)}`
      );
      break;
    case "loop_halt":
      log(`${dot} ${chalk2.red("\u270B")} ${chalk2.red(`loop halted: ${event.reason}`)}`);
      break;
    case "loop_converged":
      log(`${dot} ${chalk2.green("\u2713")} ${chalk2.green("gate loop converged")}`);
      break;
    case "rate_limit":
      log(`${dot} ${chalk2.yellow("\u23F3")} ${chalk2.yellow(`rate limited: waiting ${event.waitSeconds}s`)}`);
      break;
    case "session_reset":
      log(`${dot} ${chalk2.dim(`session reset: ${event.reason}`)}`);
      break;
    default:
      break;
  }
}
export {
  renderDaemonEvent,
  runDaemonMode
};
//# sourceMappingURL=daemon-cli-Q6V5UJLO.js.map