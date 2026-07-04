import {
  SCHEMA_VERSION,
  createRegistryReader,
  readRegistry,
  redactRemote,
  resolveRegistryPath,
  upsertProject
} from "./chunk-6DCTOB56.js";
import {
  hasSession,
  isPaneDead,
  sessionNameForRepo
} from "./chunk-YJ24CVIN.js";
import {
  ALL_STEPS,
  AuthoringGuard,
  Conductor,
  ConductorEventEmitter,
  DefaultStepRunner,
  PluginLoadError,
  PluginManifestError,
  PluginNotFoundError,
  PluginRegistry,
  PluginRegistryError,
  PluginVersionError,
  ReportError,
  STEP_ARTIFACT_GLOBS,
  VALID_PLUGIN_KINDS,
  WorktreeManager,
  buildDashboardSnapshot,
  checkPrMerged,
  checkStepCompletion,
  createBlockerResolver,
  createLiveRegion,
  daemonLogPath,
  detectDaemonCommand,
  detectDaemonSupervisorCommand,
  detectUnknownDaemonSubcommand,
  discoverPlugins,
  ensureWorktree,
  extractPrUrl,
  followDaemonLog,
  formatDashboardSnapshot,
  getArtifactStatus,
  hasDraftAdr,
  injectIssueRef,
  isStoriesApproved,
  loadConfig,
  loadMergedConfig,
  parseComplexityTier,
  parseSourceRef,
  parseTrack,
  planStem,
  readMachineOwnerConfig,
  readState,
  registerBuiltins,
  removeWorktree,
  renderReport,
  renderShippedRecord,
  resolveDaemonOwner,
  resolveEngineerDir,
  restAddLabelArgs,
  restRemoveLabelArgs,
  slugify,
  specHash,
  tailDaemonLog,
  worktreeStatus,
  writeIntakeMarker,
  writeShippedRecord,
  writeState
} from "./chunk-TH7YQ2SR.js";
import {
  ensureRunning,
  isLive,
  isPaused,
  readPauseMetadata,
  readPidRecord,
  readRestartPending
} from "./chunk-IPMUTBGC.js";

// src/cli.ts
import { Command } from "commander";
function applyPipelineOptions(cmd) {
  return cmd.argument("[feature]", "Feature description").option("--resume", "Resume from last state").option("--fresh", "Start a new feature; skip auto-resume even if a worktree for this feature description already exists").option("--auto", "Auto mode (skip checkpoints)").option("--status", "Show dashboard only").option("--from <step>", "Start from specific step").option("--cleanup", "Clean up worktrees").option("--step <step>", "Run single step").option("--reset", "Clear state").option("--output", "Raw output mode").option("--cooldown <seconds>", "Cooldown between steps in seconds", "10").option("--model <name>", "Override Claude model for every step (e.g. haiku, sonnet, opus, or full model ID)").option("--view <mode>", "Dashboard layout: full | focus | log", "full").option("--tail-lines <n>", "Max lines to show in post-step tail pane (0 disables)", "20").option("--interactive", "Run every step in interactive Claude REPL mode (no -p flag)").option("--diagnose", "Diagnose conductor state (non-mutating); reports SHIP-phase evidence gaps and exits non-zero if state is marked complete but evidence is missing").option("--report", "Print run summary from .pipeline/events.jsonl (step durations, retry hotspots, token spend) and exit");
}
function createBaseProgram() {
  const program = new Command();
  program.name("conduct").description("Orchestrate SDLC pipeline");
  return applyPipelineOptions(program);
}
function detectInline(argv) {
  if (argv[2] === "inline") {
    return { isInline: true, rest: [argv[0], argv[1], ...argv.slice(3)] };
  }
  return { isInline: false, rest: argv };
}
function createProgram() {
  const program = createBaseProgram();
  applyPipelineOptions(
    program.command("inline").description("Run the SDLC pipeline inline, in the foreground (the default mode)")
  );
  program.command("register [path]").description("Register an existing git repository in the project registry (~/.ai-conductor/registry.json)");
  program.command("create <name>").description("Scaffold a new project (git init + skeleton CLAUDE.md + .gitignore) and register it").option("--remote <url>", "Add an origin remote (add-only, no push)");
  const engineer = program.command("engineer").description("Supervisor engineer: launch the interactive idea\u2192spec loop (run bare), or call a primitive below");
  engineer.command("projects").description("List registered projects as JSON (name, path, description, tags)");
  engineer.command("land").description("Commit the already-authored .docs spec artifacts onto a spec/<slug> branch").option("--project <name>", "Target project name (resolved from the registry)").option("--idea <idea>", "The idea/spec being landed (slug + commit message)");
  engineer.command("handoff").description("Open the spec PR (local-commit fallback when no remote) and nudge the target daemon").option("--project <name>", "Target project name (resolved from the registry)").option("--branch <branch>", "The spec/<slug> branch produced by `engineer land`");
  const daemon = program.command("daemon").description("Daemon mode: drain the backlog of features with existing stories+plan, each in its own worktree, opening a PR on finish").option("--concurrency <n>", "Parallel workers in daemon mode", "1").option("--max-items <n>", "Stop daemon after this many features (default: drain backlog once)").option("--continuous", "Keep idle-polling for new features instead of draining once and exiting (honors --max-* ceilings)").option("--max-cost <tokens>", "Ceiling: stop starting features after this many total output tokens").option("--max-runtime <seconds>", "Ceiling: stop starting features after this much wall-clock time").option("--idle-poll <seconds>", "Continuous mode: seconds to wait between polls when the backlog is empty", "5").option("--max-idle-polls <n>", "Continuous mode: stop after this many consecutive empty polls");
  daemon.command("status").description("Show each registered repo's daemon liveness (running/stale/stopped) and last activity");
  daemon.command("logs").description("Print or follow a repo's .daemon/daemon.log").option("--repo <path>", "Target repo (default: current directory)").option("--follow", "Stream new log lines (tail -f); single repo only").option("--all", "Show logs for every registered repo");
  daemon.command("start").description("Start the tmux-supervised daemon for this repo; auto-attaches read-only unless -D").option("-D, --detach", "Start detached: do not auto-attach to the tmux session (default attaches when interactive)");
  daemon.command("stop").description("Stop this repo's tmux-supervised daemon");
  daemon.command("restart").description("Restart this repo's tmux-supervised daemon");
  daemon.command("connect").description("Attach READ-ONLY to this repo's daemon tmux session (Ctrl-b d to detach)");
  daemon.command("debug").description("Attach READ-WRITE to this repo's daemon tmux session (Ctrl-b d to detach)");
  return program;
}
function renderFullHelp(program = createProgram()) {
  const sections = [program.helpInformation().trimEnd()];
  const rule = "\u2500".repeat(72);
  const walk = (cmd, path) => {
    for (const sub of cmd.commands) {
      if (sub.name() === "help") continue;
      const fullPath = ["conduct", ...path, sub.name()].join(" ");
      sections.push(`${rule}
${fullPath}
${rule}
${sub.helpInformation().trimEnd()}`);
      walk(sub, [...path, sub.name()]);
    }
  };
  walk(program, []);
  return sections.join("\n\n") + "\n";
}
function renderDaemonHelp(program = createProgram()) {
  const daemon = program.commands.find((c) => c.name() === "daemon");
  if (!daemon) return "";
  const rule = "\u2500".repeat(72);
  const sections = [daemon.helpInformation().trimEnd()];
  for (const sub of daemon.commands) {
    if (sub.name() === "help") continue;
    sections.push(
      `${rule}
conduct daemon ${sub.name()}
${rule}
${sub.helpInformation().trimEnd()}`
    );
  }
  return sections.join("\n\n") + "\n";
}
function parseArgs(argv) {
  const program = createBaseProgram();
  program.exitOverride();
  program.parse(argv);
  const opts = program.opts();
  const featureDesc = program.args[0];
  const view = opts.view === "focus" || opts.view === "log" ? opts.view : "full";
  const result = {
    featureDesc,
    resume: opts.resume ?? false,
    fresh: opts.fresh ?? false,
    auto: opts.auto ?? false,
    status: opts.status ?? false,
    from: opts.from,
    cleanup: opts.cleanup ?? false,
    step: opts.step,
    reset: opts.reset ?? false,
    output: opts.output ?? false,
    cooldown: parseInt(opts.cooldown ?? "10", 10),
    model: opts.model,
    view,
    tailLines: parseInt(opts.tailLines ?? "20", 10),
    interactive: opts.interactive ?? false,
    diagnose: opts.diagnose ?? false,
    report: opts.report ?? false
  };
  const hasStateFlag = result.resume || result.status || result.cleanup || result.reset || result.diagnose || result.report || !!result.step || !!result.from;
  if (!result.featureDesc && !hasStateFlag) {
    throw new Error("Feature description is required when no state flags are provided");
  }
  return result;
}

// src/index.ts
import { dirname as dirname5, join as join22 } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { mkdir as mkdir12, readFile as readFile12 } from "fs/promises";
import { v4 as uuidv42 } from "uuid";

// src/engine/mermaid-renderer.ts
import { execa } from "execa";
import { writeFile, mkdir } from "fs/promises";
import { readFileSync, existsSync } from "fs";
import { tmpdir, homedir } from "os";
import { join } from "path";
async function detectOpenerCommand(opts) {
  const { platform, isWsl: isWsl2, hasTool } = opts;
  if (isWsl2) {
    if (await hasTool("wslview")) return "wslview";
    if (await hasTool("explorer.exe")) return "explorer.exe";
    if (await hasTool("xdg-open")) return "xdg-open";
    return null;
  }
  if (platform === "darwin") return "open";
  if (await hasTool("xdg-open")) return "xdg-open";
  return null;
}
function extractMermaidBlocks(content) {
  const re = /^[^\S\n]*```mermaid[^\n]*\n([\s\S]*?)^[^\S\n]*```/gm;
  const blocks = [];
  for (const m of content.matchAll(re)) {
    blocks.push(m[1].replace(/\s+$/, ""));
  }
  return blocks;
}
function stem(file) {
  const base = file.split("/").pop() ?? file;
  return base.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]/g, "_") || "diagram";
}
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function buildHtml(title, blocks) {
  const sections = blocks.map((b) => `<pre class="mermaid">
${escapeHtml(b)}
</pre>`).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; background: #fff; }
  h1 { font-size: 1.25rem; color: #333; }
  pre.mermaid { background: #fafafa; padding: 1rem; border-radius: 6px; overflow: auto; }
</style>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
  mermaid.initialize({ startOnLoad: true, theme: 'default' });
</script>
</head>
<body>
<h1>${title}</h1>
${sections}
</body>
</html>
`;
}
async function renderDiagramsForFile(file, content, config, deps) {
  const empty = { status: "no-diagrams", rendered: 0, failed: 0, outputs: [] };
  const safeLog = (msg) => {
    try {
      deps.log(msg);
    } catch {
    }
  };
  try {
    const blocks = extractMermaidBlocks(content);
    if (blocks.length === 0) return empty;
    const preset = config?.preset;
    if (!config || !preset || preset === "none") {
      return {
        status: "disabled",
        rendered: 0,
        failed: 0,
        outputs: [],
        notice: "diagram rendering disabled \u2014 showing raw Markdown (configure mermaid_renderer to enable)"
      };
    }
    if (preset === "html") {
      const out = await deps.writeTemp(`${stem(file)}.html`, buildHtml(stem(file), blocks));
      await deps.open(out);
      return { status: "rendered", rendered: 1, failed: 0, outputs: [out] };
    }
    if (preset === "mmdc-png" || preset === "mmdc-svg") {
      if (!await deps.hasTool("mmdc")) {
        return {
          status: "tool-missing",
          rendered: 0,
          failed: 0,
          outputs: [],
          notice: "mermaid renderer 'mmdc' not found \u2014 showing raw Markdown (install @mermaid-js/mermaid-cli, or set mermaid_renderer.preset: html)"
        };
      }
      const ext = preset === "mmdc-svg" ? "svg" : "png";
      let rendered = 0;
      let failed = 0;
      const outputs = [];
      for (let i = 0; i < blocks.length; i++) {
        try {
          const inPath = await deps.writeTemp(`${stem(file)}-${i + 1}.mmd`, blocks[i]);
          const outPath = `${inPath.replace(/\.mmd$/, "")}.${ext}`;
          const res = await deps.runMmdc(inPath, outPath);
          if (!res.ok) throw new Error(res.error ?? "render failed");
          await deps.open(outPath);
          outputs.push(outPath);
          rendered += 1;
        } catch (e) {
          failed += 1;
          safeLog(`  \u26A0 could not render diagram ${i + 1} of ${stem(file)}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      const total = blocks.length;
      if (rendered === 0 && failed > 0) {
        return {
          status: "error",
          rendered,
          failed,
          outputs,
          notice: `all ${total} diagram(s) failed to render \u2014 showing raw Markdown`
        };
      }
      return {
        status: "rendered",
        rendered,
        failed,
        outputs,
        notice: failed > 0 ? `${failed} of ${total} diagram(s) failed to render \u2014 showing raw Markdown for those` : void 0
      };
    }
    return {
      status: "disabled",
      rendered: 0,
      failed: 0,
      outputs: [],
      notice: `unknown mermaid_renderer preset '${preset}' \u2014 showing raw Markdown`
    };
  } catch (err) {
    safeLog(`  \u26A0 diagram rendering failed: ${err instanceof Error ? err.message : String(err)}`);
    return { status: "error", rendered: 0, failed: 0, outputs: [], notice: "diagram rendering error \u2014 showing raw Markdown" };
  }
}
async function checkDiagramsForFile(content, deps, stemName = "diagram") {
  const blocks = extractMermaidBlocks(content);
  if (blocks.length === 0) return { status: "no-diagrams", total: 0, failures: [] };
  if (!await deps.hasTool("mmdc")) {
    return { status: "tool-missing", total: blocks.length, failures: [] };
  }
  const failures = [];
  for (let i = 0; i < blocks.length; i++) {
    try {
      const inPath = await deps.writeTemp(`check-${stemName}-${i + 1}.mmd`, blocks[i]);
      const outPath = `${inPath.replace(/\.mmd$/, "")}.svg`;
      const res = await deps.runMmdc(inPath, outPath);
      if (!res.ok) failures.push({ index: i + 1, error: res.error ?? "render failed" });
    } catch (e) {
      failures.push({ index: i + 1, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return {
    status: failures.length > 0 ? "errors" : "ok",
    total: blocks.length,
    failures
  };
}
function isWsl() {
  if (process.env.WSL_DISTRO_NAME) return true;
  try {
    return readFileSync("/proc/version", "utf-8").toLowerCase().includes("microsoft");
  } catch {
    return false;
  }
}
var USER_PUPPETEER_CONFIG = join(homedir(), ".ai-conductor", "puppeteer.json");
function needsNoSandbox(env) {
  return env.isWsl || env.uid === 0;
}
function mmdcArgs(inputFile, outputFile, puppeteerConfigPath) {
  const args = [];
  if (puppeteerConfigPath) args.push("-p", puppeteerConfigPath);
  args.push("-i", inputFile, "-o", outputFile);
  return args;
}
function defaultRenderDeps(log) {
  const hasTool = async (cmd) => {
    try {
      const r = await execa("sh", ["-c", `command -v ${cmd}`], { reject: false });
      return r.exitCode === 0;
    } catch {
      return false;
    }
  };
  let openerCache;
  const resolveOpener = async () => {
    if (openerCache === void 0) {
      openerCache = await detectOpenerCommand({ platform: process.platform, isWsl: isWsl(), hasTool });
    }
    return openerCache;
  };
  const resolveChromePath = async () => {
    for (const bin of ["google-chrome", "google-chrome-stable", "chromium-browser", "chromium"]) {
      const r = await execa("sh", ["-c", `command -v ${bin}`], { reject: false });
      if (r.exitCode === 0 && r.stdout.trim()) return r.stdout.trim();
    }
    return null;
  };
  let puppeteerCfgCache;
  const resolvePuppeteerConfig = async () => {
    if (puppeteerCfgCache !== void 0) return puppeteerCfgCache;
    if (existsSync(USER_PUPPETEER_CONFIG)) {
      puppeteerCfgCache = USER_PUPPETEER_CONFIG;
      return puppeteerCfgCache;
    }
    const uid = typeof process.getuid === "function" ? process.getuid() : void 0;
    if (!needsNoSandbox({ isWsl: isWsl(), uid })) {
      puppeteerCfgCache = null;
      return puppeteerCfgCache;
    }
    const cfg = { args: ["--no-sandbox", "--disable-setuid-sandbox"] };
    const chrome = await resolveChromePath();
    if (chrome) cfg.executablePath = chrome;
    const dir = join(tmpdir(), "conduct-mermaid");
    await mkdir(dir, { recursive: true });
    const path = join(dir, "puppeteer.json");
    await writeFile(path, JSON.stringify(cfg), "utf-8");
    puppeteerCfgCache = path;
    return puppeteerCfgCache;
  };
  return {
    hasTool,
    runMmdc: async (inputFile, outputFile) => {
      try {
        const puppeteerCfg = await resolvePuppeteerConfig();
        const r = await execa("mmdc", mmdcArgs(inputFile, outputFile, puppeteerCfg), { reject: false });
        return { ok: r.exitCode === 0, error: r.exitCode === 0 ? void 0 : r.stderr || "mmdc failed" };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    open: async (path) => {
      const opener = await resolveOpener();
      if (!opener) {
        log(`  diagram written to ${path} (no opener found \u2014 open it manually)`);
        return;
      }
      await execa(opener, [path], { reject: false, timeout: 1e4, stdio: "ignore" });
    },
    writeTemp: async (name, content) => {
      const dir = join(tmpdir(), "conduct-mermaid");
      await mkdir(dir, { recursive: true });
      const path = join(dir, name);
      await writeFile(path, content, "utf-8");
      return path;
    },
    log
  };
}

// src/ui/create-renderer.ts
import chalk from "chalk";
import ora from "ora";
function createRenderer(opts) {
  const { stateFilePath, featureDesc, steps, readStateFn, notifyFn, projectRoot } = opts;
  const region = opts.liveRegion ?? createLiveRegion();
  const viewMode = opts.viewMode ?? "full";
  const tailLines = opts.tailLines ?? 20;
  let currentStep;
  let lastStepTail;
  let spinner = null;
  function stopSpinner() {
    if (spinner) {
      spinner.stop();
      spinner = null;
    }
  }
  function notify(title, message) {
    if (notifyFn) notifyFn(title, message).catch(() => {
    });
  }
  async function collectArtifacts() {
    if (!projectRoot) return void 0;
    const out = {};
    for (const step of steps) {
      const globs = STEP_ARTIFACT_GLOBS[step.name];
      if (!globs || globs.length === 0) continue;
      out[step.name] = await getArtifactStatus(projectRoot, step.name);
    }
    return out;
  }
  async function renderDashboard() {
    const stateResult = await readStateFn(stateFilePath);
    const state = stateResult.ok ? stateResult.value : {};
    const artifacts = await collectArtifacts();
    const base = buildDashboardSnapshot(state, steps, featureDesc, artifacts);
    const snapshot = { ...base, currentStep, lastStepTail };
    const lines = formatDashboardSnapshot(snapshot, { viewMode, tailLines });
    region.update(lines);
  }
  return async (event) => {
    if (event.type !== "rate_limit" && spinner) {
      stopSpinner();
    }
    switch (event.type) {
      case "step_started": {
        const def = steps.find((s) => s.name === event.step);
        currentStep = {
          name: event.step,
          label: def?.label ?? event.step,
          startedAtMs: Date.now()
        };
        region.log(`  ${chalk.cyan("\u25B6")} ${def?.label ?? event.step} ${chalk.dim("\u2014 running...")}`);
        region.suspend();
        break;
      }
      case "step_completed":
        currentStep = void 0;
        if (event.tail && event.tail.length > 0) {
          lastStepTail = { step: event.step, lines: event.tail };
        }
        region.resume();
        await renderDashboard();
        notify("Conductor", `Step completed: ${event.step}`);
        break;
      case "step_failed":
        currentStep = void 0;
        region.resume();
        region.log("");
        region.log(chalk.bold.red("\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501"));
        region.log(chalk.bold.red(`  \u2717 STEP FAILED: ${event.step}`));
        region.log(chalk.bold.red("\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501"));
        if (event.error) {
          region.log(chalk.red("  Error output:"));
          for (const line of event.error.split("\n")) region.log(chalk.red(`    ${line}`));
        }
        region.log("");
        await renderDashboard();
        notify("Conductor", `Step failed: ${event.step}`);
        break;
      case "step_retry":
        region.log(
          chalk.yellow(`  \u21BB ${event.step} \u2014 retry ${event.attempt}/${event.maxAttempts}: ${event.reason}`)
        );
        break;
      case "rate_limit": {
        const mins = Math.ceil(event.waitSeconds / 60);
        stopSpinner();
        region.suspend();
        spinner = ora(chalk.yellow(`Rate limited \u2014 resuming in ~${mins}m (${event.waitSeconds}s)`)).start();
        notify("Conductor", `Rate limited \u2014 resuming in ~${mins}m`);
        break;
      }
      case "session_reset":
        region.log(chalk.yellow(`  \u27F3  Session reset: ${event.reason}`));
        break;
      case "when_skip": {
        currentStep = void 0;
        const undefinedNote = event.undefinedKey ? chalk.dim(` (key "${event.undefinedKey}" undefined \u2192 false)`) : "";
        region.log(
          chalk.dim(`  \u2298 ${event.step} skipped \u2014 when: ${event.expression}${undefinedNote}`)
        );
        await renderDashboard();
        break;
      }
      case "parallel_started":
        region.log(
          chalk.cyan(`  \u21F6 ${event.step} \u2014 parallel [${event.branches.join(", ")}] started`)
        );
        break;
      case "parallel_completed":
        currentStep = void 0;
        region.log(
          chalk.green(`  \u2713 ${event.step} \u2014 parallel [${event.branches.join(", ")}] completed`)
        );
        await renderDashboard();
        break;
      case "parallel_failure":
        region.log(
          chalk.red(`  \u2717 ${event.step} \u2014 branch "${event.branch}" failed: ${event.error}`)
        );
        break;
      case "tier_skip":
      case "config_skip":
      case "gate_blocked":
        currentStep = void 0;
        await renderDashboard();
        break;
      case "feature_complete":
        currentStep = void 0;
        await renderDashboard();
        region.log(chalk.bold.green(`
\u2713 Feature complete.${event.prUrl ? ` PR: ${event.prUrl}` : ""}`));
        notify("Conductor", "Pipeline complete!");
        break;
      case "dashboard_refresh":
        await renderDashboard();
        break;
      case "checkpoint_reached":
        region.log(chalk.dim(`
\u2500\u2500 Checkpoint: ${event.step} complete \u2500\u2500`));
        break;
    }
  };
}

// src/ui/notifications.ts
import { execFile as execFileCb } from "child_process";
async function sendNotification(title, message) {
  const platform = process.platform;
  try {
    if (platform === "darwin") {
      await exec("osascript", ["-e", `display notification "${message}" with title "${title}"`]);
    } else {
      await exec("notify-send", [title, message]);
    }
  } catch {
    process.stderr.write("\x07");
  }
}
function exec(cmd, args) {
  return new Promise((resolve, reject) => {
    execFileCb(cmd, args, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// src/engine/resume.ts
import { readdir, readFile } from "fs/promises";
import { basename, join as join2 } from "path";
async function readStateFile(...candidates) {
  for (const candidate of candidates) {
    try {
      const raw = await readFile(candidate, "utf-8");
      return JSON.parse(raw);
    } catch {
    }
  }
  return {};
}
function toFeature(name, path, branch, state, totalSteps) {
  const lastStep = state.last_step;
  let stepIndex = 0;
  if (lastStep) {
    const idx = ALL_STEPS.findIndex((s) => s.name === lastStep);
    if (idx >= 0) stepIndex = idx + 1;
  }
  return {
    name,
    path,
    branch,
    lastStep,
    stepIndex,
    totalSteps,
    featureDesc: state.feature_desc
  };
}
async function scanResumableFeatures(projectRoot) {
  const totalSteps = ALL_STEPS.length;
  const results = [];
  const seenPaths = /* @__PURE__ */ new Set();
  const rootState = await readStateFile(
    join2(projectRoot, ".pipeline", "conduct-state.json"),
    join2(projectRoot, "conduct-state.json")
  );
  if (Object.keys(rootState).length > 0 && rootState.feature_status !== "complete") {
    results.push(
      toFeature(
        basename(projectRoot),
        projectRoot,
        "(current branch)",
        rootState,
        totalSteps
      )
    );
    seenPaths.add(projectRoot);
  }
  const worktreesDir = join2(projectRoot, ".worktrees");
  let entries;
  try {
    const dirents = await readdir(worktreesDir, { withFileTypes: true });
    entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return results;
  }
  for (const name of entries) {
    const wtPath = join2(worktreesDir, name);
    if (seenPaths.has(wtPath)) continue;
    const state = await readStateFile(
      join2(wtPath, ".pipeline", "conduct-state.json"),
      join2(wtPath, "conduct-state.json")
    );
    if (state.feature_status === "complete") continue;
    results.push(toFeature(name, wtPath, `feature/${name}`, state, totalSteps));
  }
  return results;
}
function selectFeature(features, choice) {
  if (features.length === 0) return null;
  if (choice === 0) return null;
  if (features.length === 1) return features[0];
  if (choice === void 0) return null;
  if (choice >= 1 && choice <= features.length) return features[choice - 1];
  return null;
}
function formatResumeMenu(features) {
  const lines = ["Active features:"];
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    const label = f.featureDesc ?? f.name;
    const stepInfo = f.lastStep ? `[step ${f.stepIndex}/${f.totalSteps}: ${f.lastStep}]` : `[step 0/${f.totalSteps}: not started]`;
    lines.push(`  ${i + 1}) ${label.padEnd(20)} ${stepInfo.padEnd(25)} ${f.branch}`);
  }
  lines.push("  0) Cancel");
  return lines.join("\n");
}

// src/engine/auto-resume.ts
import { access } from "fs/promises";
import { join as join3 } from "path";
var WORKTREE_DIR_CONVENTIONS = [".worktrees", ".claude/worktrees"];
async function loadStateFromCandidates(paths) {
  for (const p of paths) {
    const r = await readState(p);
    if (r.ok && Object.keys(r.value).length > 0) {
      return { state: r.value, path: p };
    }
  }
  return null;
}
function buildResume(worktreePath, state, statePath) {
  const lastStep = state.last_step;
  const idx = lastStep ? ALL_STEPS.findIndex((s) => s.name === lastStep) : -1;
  return {
    kind: "resume",
    worktreePath,
    stateFilePath: statePath,
    lastStep,
    totalSteps: ALL_STEPS.length,
    stepIndex: idx >= 0 ? idx + 1 : 0,
    featureDesc: state.feature_desc
  };
}
async function findExistingWorktree(projectRoot, slug) {
  for (const dir of WORKTREE_DIR_CONVENTIONS) {
    const wtPath = join3(projectRoot, dir, slug);
    try {
      await access(wtPath);
      return wtPath;
    } catch {
    }
  }
  return null;
}
async function detectAutoResume(projectRoot, featureDesc) {
  const slug = slugify(featureDesc);
  if (!slug) return { kind: "none" };
  const rootLoaded = await loadStateFromCandidates([
    join3(projectRoot, ".pipeline", "conduct-state.json"),
    join3(projectRoot, "conduct-state.json")
  ]);
  if (rootLoaded) {
    const { state, path } = rootLoaded;
    if (state.feature_desc === featureDesc) {
      if (state.feature_status === "complete") {
        return { kind: "complete", worktreePath: projectRoot };
      }
      if (state.worktree === "done") {
        const wt = await findExistingWorktree(projectRoot, slug);
        if (wt) {
          const wtLoaded2 = await loadStateFromCandidates([
            join3(wt, ".pipeline", "conduct-state.json"),
            join3(wt, "conduct-state.json")
          ]);
          if (wtLoaded2) {
            if (wtLoaded2.state.feature_status === "complete") {
              return { kind: "complete", worktreePath: wt };
            }
            return buildResume(wt, wtLoaded2.state, wtLoaded2.path);
          }
          return buildResume(wt, state, path);
        }
        return {
          kind: "orphaned-state",
          stateFilePath: path,
          expectedLocations: WORKTREE_DIR_CONVENTIONS.map((d) => join3(projectRoot, d, slug)),
          featureDesc: state.feature_desc
        };
      }
      return buildResume(projectRoot, state, path);
    }
  }
  const worktreePath = await findExistingWorktree(projectRoot, slug);
  if (!worktreePath) return { kind: "none" };
  const wtLoaded = await loadStateFromCandidates([
    join3(worktreePath, ".pipeline", "conduct-state.json"),
    join3(worktreePath, "conduct-state.json")
  ]);
  if (!wtLoaded) return { kind: "none" };
  if (wtLoaded.state.feature_status === "complete") {
    return { kind: "complete", worktreePath };
  }
  return buildResume(worktreePath, wtLoaded.state, wtLoaded.path);
}

// src/engine/complete-verifier.ts
import { join as join4 } from "path";
var SHIP_GATING_STEPS = ["manual_test", "retro", "finish"];
async function verifyCompleteState(worktreePath) {
  const stateRes = await readState(join4(worktreePath, ".pipeline/conduct-state.json"));
  const state = stateRes.ok ? stateRes.value : {};
  const ctx = {
    sessionStartedAt: state.session_started_at,
    featureDesc: state.feature_desc
  };
  const failedSteps = [];
  const reasons = [];
  for (const step of SHIP_GATING_STEPS) {
    const result = await checkStepCompletion(worktreePath, step, ctx);
    if (!result.done) {
      failedSteps.push(step);
      reasons.push(result.reason ?? "completion check failed");
    }
  }
  if (failedSteps.length === 0) return { ok: true };
  return { ok: false, failedSteps, reasons };
}
function formatGapReport(featureDesc, worktreePath, gap) {
  const lines = [];
  lines.push("");
  lines.push(
    `\u26A0  Feature ${featureDesc ? `"${featureDesc}"` : "in this worktree"} is marked complete but evidence is missing:`
  );
  for (let i = 0; i < gap.failedSteps.length; i++) {
    lines.push(`    - ${gap.failedSteps[i]}: ${gap.reasons[i]}`);
  }
  lines.push("");
  lines.push(`  Worktree: ${worktreePath}`);
  lines.push(
    "  This usually means a prior pipeline run exited mid-implementation without writing"
  );
  lines.push(
    '  the halt marker (skills/pipeline/SKILL.md "User-requested exit during a run"),'
  );
  lines.push("  cascading false-completion through the SHIP-phase steps.");
  lines.push("");
  return lines.join("\n");
}

// src/engine/preflight.ts
import { access as access2, mkdir as mkdir2, writeFile as writeFile2 } from "fs/promises";
import { join as join5 } from "path";
async function ensureClaudeSettings(projectRoot) {
  const claudeDir = join5(projectRoot, ".claude");
  const settingsPath = join5(claudeDir, "settings.json");
  try {
    await access2(settingsPath);
    return;
  } catch {
  }
  await mkdir2(claudeDir, { recursive: true });
  const contents = buildSettingsJson(projectRoot);
  await writeFile2(settingsPath, contents, "utf-8");
}
var BASELINE_BASH_ALLOWS = [
  "Bash(git:*)",
  "Bash(gh:*)",
  "Bash(rtk:*)",
  "Bash(npm:*)",
  "Bash(npx:*)",
  "Bash(node:*)",
  "Bash(mkdir:*)",
  "Bash(touch:*)",
  "Bash(chmod:*)",
  "Bash(ln:*)",
  "Bash(glow:*)"
];
function buildSettingsJson(projectRoot) {
  const scope = projectRoot.startsWith("/") ? projectRoot.slice(1) : projectRoot;
  const payload = {
    $schema: "https://json.schemastore.org/claude-code-settings.json",
    permissions: {
      allow: [
        `Read(//${scope}/**)`,
        `Edit(//${scope}/**)`,
        `Write(//${scope}/**)`,
        ...BASELINE_BASH_ALLOWS
      ]
    }
  };
  return JSON.stringify(payload, null, 2) + "\n";
}

// src/ui/terminal/prompt-host.ts
import { readFile as readFile2 } from "fs/promises";
import * as readline from "readline";

// src/engine/recovery.ts
var NON_GATING_OPTIONS = [
  "retry",
  "interactive",
  "back",
  "skip",
  "quit"
];
var GATING_OPTIONS = [
  "retry",
  "interactive",
  "back",
  "quit"
];
function getRecoveryOptions(_step, isGating) {
  return isGating ? [...GATING_OPTIONS] : [...NON_GATING_OPTIONS];
}

// src/ui/terminal/prompt-host.ts
var RECOVERY_LABELS = {
  retry: "[r]etry",
  interactive: "[i]nteractive fix",
  back: "[b]ack",
  skip: "[s]kip",
  quit: "[q]uit"
};
var RECOVERY_KEYS = {
  r: "retry",
  i: "interactive",
  b: "back",
  s: "skip",
  q: "quit"
};
var TerminalPromptHost = class {
  region;
  input;
  output;
  log;
  readFileFn;
  renderDiagrams;
  constructor(region, opts = {}) {
    this.region = region;
    this.input = opts.input ?? process.stdin;
    this.output = opts.output ?? process.stdout;
    this.log = opts.log ?? ((...args) => console.log(...args));
    this.readFileFn = opts.readFileFn ?? ((p) => readFile2(p, "utf-8"));
    this.renderDiagrams = opts.renderDiagrams;
  }
  async ask(question) {
    this.region.suspend();
    const rl = readline.createInterface({ input: this.input, output: this.output });
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        rl.close();
        this.region.resume();
        resolve(answer.trim().toLowerCase());
      });
    });
  }
  async confirm(question, defaultValue = false) {
    const hint = defaultValue ? "[Y/n]" : "[y/N]";
    const answer = await this.ask(`${question} ${hint} `);
    if (answer === "") return defaultValue;
    return answer === "y" || answer === "yes";
  }
  async checkpoint(_step) {
    while (true) {
      const answer = await this.ask("  c = continue, b = go back, q = quit [c/b/q]: ");
      if (answer === "c") return "continue";
      if (answer === "b") return "back";
      if (answer === "q") return "quit";
      this.log("  Invalid choice. Enter c, b, or q.");
    }
  }
  async navigate(steps) {
    if (steps.length === 0) {
      this.log("  No completed steps to navigate to.");
      return null;
    }
    this.log("\nGo back to which step?");
    steps.forEach((s, i) => {
      this.log(`   ${i + 1}) ${s.label.padEnd(25)} [${s.status}]    ${s.phase}`);
    });
    this.log("   0) Cancel");
    const answer = await this.ask(`Choice [0-${steps.length}]: `);
    const idx = parseInt(answer, 10);
    if (isNaN(idx) || idx === 0) return null;
    if (idx >= 1 && idx <= steps.length) return steps[idx - 1].name;
    return null;
  }
  async reviewArtifacts(step, files) {
    const total = files.length;
    this.log(`
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`);
    this.log(`  Artifact review: ${step} (${total} file${total === 1 ? "" : "s"})`);
    this.log(`\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
`);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const basename5 = file.split("/").pop() ?? file;
      this.log(`\u2501\u2501\u2501 [${i + 1}/${total}] ${basename5} \u2501\u2501\u2501
`);
      try {
        const content = await this.readFileFn(file);
        this.log(content);
        if (this.renderDiagrams && content.includes("```mermaid")) {
          try {
            const notice = await this.renderDiagrams(file, content);
            if (notice) this.log(`  ${notice}`);
          } catch {
          }
        }
      } catch {
        this.log(`  (could not read file: ${file})`);
      }
      this.log(`
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`);
      while (true) {
        const answer = await this.ask("  [enter=approve / r=reject / s=skip remaining]: ");
        if (answer === "" || answer === "a") {
          this.log(`  \u2713 Approved: ${basename5}`);
          break;
        }
        if (answer === "r") {
          this.log(`  \u2717 Rejected: ${basename5}`);
          this.log(`  Returning to ${step} to address issues...
`);
          return "rejected";
        }
        if (answer === "s") {
          this.log(`  Skipping review of remaining artifacts.`);
          return "approved";
        }
        this.log("  Invalid choice. Press enter to approve, r to reject, s to skip.");
      }
    }
    this.log(`
  \u2713 All ${step} artifacts approved.
`);
    return "approved";
  }
  async recovery(step, isGating, context) {
    let options = getRecoveryOptions(step, isGating);
    if (context?.retriesExhausted) {
      options = options.filter((o) => o !== "retry");
      this.log(
        `
  Retry budget exhausted for ${step} \u2014 pick a different path below.`
      );
    }
    const labels = options.map((o) => RECOVERY_LABELS[o]).join(" / ");
    const keys = options.map((o) => o[0]).join("/");
    const gatingTag = isGating ? " [gating]" : "";
    this.log(`
\u2501\u2501\u2501 Step failed: ${step}${gatingTag} \u2501\u2501\u2501`);
    while (true) {
      const answer = await this.ask(`  ${step} \u2014 ${labels} [${keys}]: `);
      const action = RECOVERY_KEYS[answer];
      if (action && options.includes(action)) return action;
      this.log(`  Invalid choice. Enter one of: ${keys}`);
    }
  }
  async complexityAssessment(recommended) {
    if (recommended) {
      this.log(`
Claude recommends complexity tier: ${recommended}`);
      const answer = await this.ask(
        `  [enter=accept ${recommended} / S / M / L to override]: `
      );
      if (answer === "") return recommended;
      if (answer === "s") return "S";
      if (answer === "m") return "M";
      if (answer === "l") return "L";
      this.log(`  Unrecognized input; keeping ${recommended}.`);
      return recommended;
    }
    this.log("\n(Claude did not return a tier recommendation \u2014 choose manually.)");
    while (true) {
      const answer = await this.ask("  Classify complexity [S/M/L]: ");
      if (answer === "s") return "S";
      if (answer === "m") return "M";
      if (answer === "l") return "L";
      this.log("  Invalid choice. Enter s, m, or l.");
    }
  }
};

// src/engine/project-prelude.ts
import { readFile as readFile3, writeFile as writeFile3, mkdir as mkdir3 } from "fs/promises";
import { existsSync as existsSync2 } from "fs";
import { join as join6, dirname } from "path";
import { exec as execCb } from "child_process";
import { promisify } from "util";
import { load as loadYaml, dump as dumpYaml } from "js-yaml";
var exec2 = promisify(execCb);
var DEFAULT_ASSESS_STALE_DAYS = 90;
var DEFAULT_ASSESS_STALE_COMMITS = 500;
var BOOTSTRAP_MARKER_PATH = ".ai-conductor/bootstrapped.yml";
var ASSESS_MARKER_PATH = ".ai-conductor/assessed.yml";
async function runProjectPrelude(projectRoot, provider, sessionId, config, options) {
  const result = {
    bootstrapExecuted: false,
    assessExecuted: false
  };
  const bootstrapMarker = await readBootstrapMarker(projectRoot);
  const hasMigration = options.hasMigration ?? defaultHasMigration;
  let bootstrapReason;
  if (!bootstrapMarker) {
    bootstrapReason = "never_run";
  } else if (hasMigration(bootstrapMarker.harness_version, options.harnessVersion)) {
    bootstrapReason = "migration";
  }
  if (bootstrapReason) {
    result.bootstrapExecuted = true;
    result.bootstrapReason = bootstrapReason;
    const ok = await invokeSkill(
      provider,
      sessionId,
      "/bootstrap",
      "Run the bootstrap skill for this project. It is safe to re-run: detect current state, refresh artifacts, apply any harness migrations."
    );
    result.bootstrapSuccess = ok;
    if (ok) {
      await writeBootstrapMarker(projectRoot, options.harnessVersion);
    }
  }
  const assessResult = await resolveAssessDecision(projectRoot, config, options);
  if (assessResult.decision === "skip") {
    result.assessSkipped = assessResult.reason;
  } else {
    result.assessExecuted = true;
    result.assessReason = assessResult.reason;
    const ok = await invokeSkill(
      provider,
      sessionId,
      "/assess",
      "Run the assess skill. Produce or refresh technical-assessment docs and architecture decision records based on current project state."
    );
    result.assessSuccess = ok;
    if (ok) {
      const sha = await currentCommitSha(projectRoot);
      await writeAssessMarker(projectRoot, sha);
    }
  }
  return result;
}
async function invokeSkill(provider, sessionId, prompt, systemPrompt) {
  const result = await provider.invoke({
    prompt,
    sessionId,
    resume: false,
    dangerouslySkipPermissions: true,
    systemPrompt
  });
  return result.success;
}
function defaultHasMigration(fromVersion, toVersion) {
  const [fa, fb] = parseSemver(fromVersion);
  const [ta, tb] = parseSemver(toVersion);
  if (ta > fa) return true;
  if (ta === fa && tb > fb) return true;
  return false;
}
function parseSemver(v) {
  const clean = v.replace(/^v/, "");
  const parts = clean.split(".").map((p) => parseInt(p, 10));
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}
async function readBootstrapMarker(projectRoot) {
  const path = join6(projectRoot, BOOTSTRAP_MARKER_PATH);
  if (!existsSync2(path)) return null;
  try {
    const raw = await readFile3(path, "utf-8");
    const parsed = loadYaml(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const o = parsed;
    if (typeof o.harness_version !== "string" || typeof o.bootstrapped_at !== "string") {
      return null;
    }
    return { harness_version: o.harness_version, bootstrapped_at: o.bootstrapped_at };
  } catch {
    return null;
  }
}
async function writeBootstrapMarker(projectRoot, harnessVersion) {
  const path = join6(projectRoot, BOOTSTRAP_MARKER_PATH);
  await mkdir3(dirname(path), { recursive: true });
  const marker = {
    harness_version: harnessVersion,
    bootstrapped_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  await writeFile3(path, dumpYaml(marker, { sortKeys: false }), "utf-8");
}
async function readAssessMarker(projectRoot) {
  const path = join6(projectRoot, ASSESS_MARKER_PATH);
  if (!existsSync2(path)) return null;
  try {
    const raw = await readFile3(path, "utf-8");
    const parsed = loadYaml(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const o = parsed;
    if (typeof o.assessed_at !== "string") return null;
    return {
      assessed_at: o.assessed_at,
      last_commit_sha: typeof o.last_commit_sha === "string" ? o.last_commit_sha : void 0
    };
  } catch {
    return null;
  }
}
async function writeAssessMarker(projectRoot, sha) {
  const path = join6(projectRoot, ASSESS_MARKER_PATH);
  await mkdir3(dirname(path), { recursive: true });
  const marker = {
    assessed_at: (/* @__PURE__ */ new Date()).toISOString(),
    ...sha ? { last_commit_sha: sha } : {}
  };
  await writeFile3(path, dumpYaml(marker, { sortKeys: false }), "utf-8");
}
async function resolveAssessDecision(projectRoot, config, options) {
  if (options.forceAssess) {
    return { decision: "run", reason: "forced" };
  }
  const codebase = await detectCodebase(projectRoot);
  if (!codebase) return { decision: "skip", reason: "no_codebase" };
  const hasAssessmentDoc = await hasTechnicalAssessment(projectRoot);
  const marker = await readAssessMarker(projectRoot);
  if (!hasAssessmentDoc && !marker) {
    return { decision: "run", reason: "never_run" };
  }
  const staleDays = config.assess?.stale_after_days ?? DEFAULT_ASSESS_STALE_DAYS;
  const staleCommits = config.assess?.stale_after_commits ?? DEFAULT_ASSESS_STALE_COMMITS;
  const assessedAtStr = marker?.assessed_at;
  const daysElapsed = assessedAtStr ? daysSince(assessedAtStr) : null;
  const commitsElapsed = marker?.last_commit_sha ? await commitsSince(projectRoot, marker.last_commit_sha) : null;
  const timeStale = daysElapsed !== null && daysElapsed > staleDays;
  const commitsStale = commitsElapsed !== null && commitsElapsed > staleCommits;
  if (timeStale || commitsStale) {
    if (options.onAssessStalePrompt) {
      const go = await options.onAssessStalePrompt({
        days: daysElapsed ?? 0,
        commits: commitsElapsed ?? 0
      });
      if (go) {
        return {
          decision: "run",
          reason: timeStale ? "stale_time" : "stale_commits"
        };
      }
      return { decision: "skip", reason: "not_confirmed" };
    }
    return { decision: "skip", reason: "recent" };
  }
  return { decision: "skip", reason: "recent" };
}
var CODE_EXTENSIONS = /\.(rb|py|ts|tsx|js|jsx|go|rs|ex|exs|java|kt|swift|cs|php|c|cpp|h|hpp)$/;
var IGNORED_DIRS = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  ".pipeline",
  ".worktrees",
  ".claude",
  ".ai-conductor",
  ".docs",
  ".harness",
  "dist",
  "build",
  "vendor",
  ".venv",
  "venv",
  "__pycache__"
]);
async function detectCodebase(projectRoot) {
  try {
    const { stdout } = await exec2("git ls-files", { cwd: projectRoot });
    for (const line of stdout.split("\n")) {
      if (CODE_EXTENSIONS.test(line)) return true;
    }
  } catch {
  }
  return walkForCode(projectRoot, 0);
}
async function walkForCode(dir, depth) {
  if (depth > 4) return false;
  let entries;
  try {
    const { readdir: readdir7 } = await import("fs/promises");
    entries = await readdir7(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    if (entry.isFile() && CODE_EXTENSIONS.test(entry.name)) return true;
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      if (await walkForCode(join6(dir, entry.name), depth + 1)) return true;
    }
  }
  return false;
}
async function hasTechnicalAssessment(projectRoot) {
  const decisionsDir = join6(projectRoot, ".docs", "decisions");
  if (!existsSync2(decisionsDir)) return false;
  try {
    const { readdir: readdir7 } = await import("fs/promises");
    const files = await readdir7(decisionsDir);
    return files.some((f) => f.startsWith("technical-assessment-") && f.endsWith(".md"));
  } catch {
    return false;
  }
}
async function currentCommitSha(projectRoot) {
  try {
    const { stdout } = await exec2("git rev-parse HEAD", { cwd: projectRoot });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
async function commitsSince(projectRoot, sha) {
  if (!sha) return null;
  try {
    const { stdout } = await exec2(`git rev-list --count ${sha}..HEAD`, {
      cwd: projectRoot
    });
    const n = parseInt(stdout.trim(), 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
function daysSince(isoTimestamp) {
  const then = Date.parse(isoTimestamp);
  if (Number.isNaN(then)) return null;
  const ms = Date.now() - then;
  return Math.floor(ms / (1e3 * 60 * 60 * 24));
}

// src/engine/event-persister.ts
import { appendFileSync, mkdirSync } from "fs";
import { dirname as dirname2 } from "path";
var EventPersistError = class extends Error {
  constructor(filePath, cause) {
    super(
      `EventPersister failed to write to ${filePath}: ${cause instanceof Error ? cause.message : String(cause)}`
    );
    this.filePath = filePath;
    this.cause = cause;
    this.name = "EventPersistError";
  }
  filePath;
  cause;
};
var ALL_EVENT_TYPES = [
  "step_started",
  "step_completed",
  "step_failed",
  "step_retry",
  "checkpoint_reached",
  "recovery_needed",
  "gate_blocked",
  "tier_skip",
  "config_skip",
  "navigation_back",
  "rate_limit",
  "session_reset",
  "feature_complete",
  "dashboard_refresh",
  "auto_heal",
  "mode_skip",
  "build_stall",
  "renderer_error",
  "when_skip",
  "parallel_started",
  "parallel_completed",
  "parallel_failure"
];
var EventPersister = class {
  filePath;
  emitter;
  handler;
  dirEnsured = false;
  constructor(filePath, emitter) {
    this.filePath = filePath;
    this.emitter = emitter;
    this.handler = (event) => {
      this.persist(event);
    };
  }
  /**
   * Subscribe to all ConductorEvent types.
   */
  start() {
    for (const type of ALL_EVENT_TYPES) {
      this.emitter.on(type, this.handler);
    }
  }
  /**
   * Unsubscribe from all ConductorEvent types.
   */
  stop() {
    for (const type of ALL_EVENT_TYPES) {
      this.emitter.off(type, this.handler);
    }
  }
  persist(event) {
    try {
      if (!this.dirEnsured) {
        mkdirSync(dirname2(this.filePath), { recursive: true });
        this.dirEnsured = true;
      }
      const record = JSON.stringify({ ...event, ts: (/* @__PURE__ */ new Date()).toISOString() });
      appendFileSync(this.filePath, record + "\n", "utf-8");
    } catch (err) {
      throw new EventPersistError(this.filePath, err);
    }
  }
};

// src/engine/registry-cli.ts
import { execa as execa2 } from "execa";
import { mkdir as mkdir4, writeFile as writeFile4, readdir as readdir2 } from "fs/promises";
import { existsSync as existsSync3 } from "fs";
import { join as join7, basename as basename2, isAbsolute, resolve as resolvePath } from "path";
function registryPath() {
  return resolveRegistryPath({ env: process.env });
}
async function isGitRepo(dir) {
  const r = await execa2(
    "git",
    ["-C", dir, "rev-parse", "--is-inside-work-tree"],
    { reject: false }
  );
  return r.exitCode === 0 && String(r.stdout).trim() === "true";
}
async function discoverRemote(dir) {
  const r = await execa2(
    "git",
    ["-C", dir, "remote", "get-url", "origin"],
    { reject: false }
  );
  if (r.exitCode !== 0) return void 0;
  const url = String(r.stdout).trim();
  if (!url) return void 0;
  return redactRemote(url);
}
async function runRegister(pathArg) {
  const target = pathArg ?? process.cwd();
  const abs = isAbsolute(target) ? target : resolvePath(process.cwd(), target);
  if (!existsSync3(abs)) {
    console.error(`conduct register: path does not exist: ${abs}`);
    return 1;
  }
  if (!await isGitRepo(abs)) {
    console.error(`conduct register: not a git repository: ${abs}`);
    return 1;
  }
  const remote = await discoverRemote(abs);
  const record = {
    schemaVersion: SCHEMA_VERSION,
    name: basename2(abs),
    path: abs,
    status: "registered",
    registeredAt: (/* @__PURE__ */ new Date()).toISOString(),
    ...remote ? { remote } : {}
  };
  try {
    await upsertProject(registryPath(), record);
  } catch (e) {
    console.error(
      `conduct register: failed to write registry: ${e instanceof Error ? e.message : String(e)}`
    );
    return 1;
  }
  console.log(`Registered ${record.name} (${abs}).`);
  return 0;
}
function skeletonClaudeMd(name) {
  return `# ${name}

This project uses the james-stoup-agents harness. Behavioral rules, model
selection, communication protocol, and conventions are defined in the harness
**HARNESS.md** \u2014 Claude MUST read and follow it at the start of every session.

Run \`/bootstrap\` to detect the tech stack and generate full project config.
`;
}
var GITIGNORE_SKELETON = [".pipeline/", ".daemon/", ".worktrees/", ".serena/", ""].join("\n");
async function dirIsNonEmpty(dir) {
  if (!existsSync3(dir)) return false;
  try {
    const entries = await readdir2(dir);
    return entries.length > 0;
  } catch {
    return false;
  }
}
async function runCreate(name, opts = {}) {
  const target = resolvePath(process.cwd(), name);
  if (await dirIsNonEmpty(target)) {
    console.error(
      `conduct create: target is not empty, refusing to clobber: ${target}`
    );
    return 1;
  }
  try {
    await mkdir4(target, { recursive: true });
    await execa2("git", ["init", "-q", target]);
    await writeFile4(join7(target, "CLAUDE.md"), skeletonClaudeMd(basename2(target)), "utf-8");
    await writeFile4(join7(target, ".gitignore"), GITIGNORE_SKELETON, "utf-8");
    if (opts.remote) {
      await execa2("git", ["-C", target, "remote", "add", "origin", opts.remote]);
    }
  } catch (e) {
    console.error(
      `conduct create: scaffold failed: ${e instanceof Error ? e.message : String(e)}`
    );
    return 1;
  }
  const record = {
    schemaVersion: SCHEMA_VERSION,
    name: basename2(target),
    path: target,
    status: "created",
    registeredAt: (/* @__PURE__ */ new Date()).toISOString(),
    // Redact credentials before they reach disk (FR-11). The raw URL is still
    // used for `git remote add` above (git needs the real credential); only the
    // on-disk registry record must be credential-free.
    ...opts.remote ? { remote: redactRemote(opts.remote) } : {}
  };
  try {
    await upsertProject(registryPath(), record);
  } catch (e) {
    console.error(
      `conduct create: failed to write registry: ${e instanceof Error ? e.message : String(e)}`
    );
    return 1;
  }
  console.log(`Created ${record.name} (${target}).`);
  return 0;
}
function detectRegistryCommand(argv) {
  const args = argv.slice(2);
  const sub = args[0];
  if (sub === "register") {
    const path = args[1] && !args[1].startsWith("-") ? args[1] : void 0;
    return { kind: "register", path };
  }
  if (sub === "create") {
    const rest = args.slice(1);
    let name;
    let remote;
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === "--remote") {
        remote = rest[i + 1];
        i++;
      } else if (a.startsWith("--remote=")) {
        remote = a.slice("--remote=".length);
      } else if (!a.startsWith("-") && name === void 0) {
        name = a;
      }
    }
    if (name === void 0) return null;
    return { kind: "create", name, remote };
  }
  return null;
}
async function dispatchRegistry(d) {
  if (d.kind === "register") return runRegister(d.path);
  return runCreate(d.name, { remote: d.remote });
}

// src/engine/engineer-cli.ts
import { execFile as execFileCb4, spawn } from "child_process";
import { promisify as promisify4 } from "util";
import { join as join14 } from "path";

// src/engine/engineer/target.ts
import { access as access3 } from "fs/promises";
var TargetPathMissingError = class extends Error {
  constructor(missingPath) {
    super(
      `resolveTargetRepo: registry record path does not exist on disk: "${missingPath}". The project may have been moved or deleted. Re-register with \`conduct register\`.`
    );
    this.name = "TargetPathMissingError";
  }
};
async function resolveTargetRepo(path, reader) {
  const record = await reader.getProject(path);
  if (record === void 0) {
    throw new Error(
      `resolveTargetRepo: no registry record found for path "${path}". Register the project first with \`conduct register\`.`
    );
  }
  try {
    await access3(record.path);
  } catch {
    throw new TargetPathMissingError(record.path);
  }
  const target = {
    name: record.name,
    canonicalPath: record.path,
    ...record.remote !== void 0 ? { remote: record.remote } : {}
  };
  return target;
}

// src/engine/engineer/land-spec.ts
import { access as access5, readdir as readdir3, readFile as readFile4 } from "fs/promises";
import { join as join10 } from "path";
import { execFile as execFileCb3 } from "child_process";
import { promisify as promisify3 } from "util";

// src/engine/engineer/authoring.ts
import { execFile as execFileCb2 } from "child_process";
import { mkdir as mkdir6, writeFile as writeFile6, access as access4 } from "fs/promises";
import { join as join9 } from "path";
import { promisify as promisify2 } from "util";

// src/engine/engineer/track-marker.ts
import { writeFile as writeFile5, mkdir as mkdir5 } from "fs/promises";
import { join as join8 } from "path";

// src/engine/engineer/authoring.ts
var execFile = promisify2(execFileCb2);
function slugify2(idea) {
  return idea.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
}
async function deriveDefaultBranch(repoPath) {
  try {
    const { stdout } = await execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: repoPath
    });
    const branch = stdout.trim();
    if (branch && branch !== "HEAD") return branch;
  } catch {
  }
  throw new Error(
    `runAuthoring: could not derive default branch for repo at "${repoPath}". Ensure the repo has at least one commit and is not in a detached HEAD state.`
  );
}

// src/engine/engineer/land-spec.ts
var execFile2 = promisify3(execFileCb3);
async function landSpec(target, idea, worktreePath, sourceRef, opts = {}) {
  const canonical = target.canonicalPath;
  try {
    await access5(worktreePath);
  } catch {
    throw new Error(
      `landSpec: per-idea worktree "${worktreePath}" does not exist. Create the worktree (conduct-ts engineer worktree) before landing \u2014 landSpec never falls back to the primary checkout.`
    );
  }
  try {
    await access5(canonical);
  } catch {
    throw new TargetPathMissingError(canonical);
  }
  {
    const { stdout: porcelain } = await execFile2("git", ["status", "--porcelain"], {
      cwd: worktreePath
    });
    const lines = porcelain.trim() === "" ? [] : porcelain.trim().split("\n");
    const dirtyLines = lines.filter((line) => {
      const prefix = line.slice(0, 2);
      const path = line.slice(3).trim().replace(/^"(.*)"$/, "$1");
      if (prefix === "??") {
        return !path.startsWith(".docs/") && !path.startsWith(".docs\\");
      }
      return true;
    });
    if (dirtyLines.length > 0) {
      const summary = dirtyLines.map((l) => l.trim()).join(", ");
      throw new Error(
        `landSpec: per-idea worktree at "${worktreePath}" has uncommitted (dirty) changes outside .docs/: ${summary}. Recreate the worktree or discard tracked changes before running landSpec.`
      );
    }
  }
  const unresolvableGh = async () => {
    throw new Error("landSpec: no gh runner injected for owner resolution");
  };
  const ownerResolution = await resolveDaemonOwner(
    opts.ownerConfig ?? {},
    opts.gh ?? unresolvableGh,
    canonical
  );
  if (!ownerResolution.resolved) {
    throw new Error(
      "landSpec: identity is unresolved \u2014 spec cannot be authored without a known owner. To resolve, either: (1) configure `spec_owner` in ~/.ai-conductor/config.yml, or (2) run `gh auth login` to authenticate."
    );
  }
  const specOwner = ownerResolution.id;
  const guard = new AuthoringGuard(canonical);
  const specsDir = join10(worktreePath, ".docs", "specs");
  const storiesDir = join10(worktreePath, ".docs", "stories");
  const plansDir = join10(worktreePath, ".docs", "plans");
  guard.assertWriteAllowed(specsDir);
  guard.assertWriteAllowed(storiesDir);
  guard.assertWriteAllowed(plansDir);
  const trackDir = join10(worktreePath, ".docs", "track");
  const trackFile = await findNewestFile(trackDir);
  const track = parseTrack(trackFile ? await readFile4(trackFile, "utf-8") : null) ?? "product";
  const specRequired = track === "product";
  const specFile = await findNewestFile(specsDir);
  const storiesFile = await findNewestFile(storiesDir);
  const planFile = await findNewestFile(plansDir);
  if (specRequired && !specFile || !storiesFile || !planFile) {
    const missing = [];
    if (specRequired && !specFile) missing.push("spec (product track)");
    if (!storiesFile) missing.push("stories");
    if (!planFile) missing.push("plan");
    throw new Error(
      `landSpec: required artifact ${missing.join(", ")} ${missing.length === 1 ? "file is" : "files are"} missing in ".docs/" under "${worktreePath}". Run the /explore, /prd (product track), /stories, /plan skills first.`
    );
  }
  if (specFile) guard.assertWriteAllowed(specFile);
  guard.assertWriteAllowed(storiesFile);
  guard.assertWriteAllowed(planFile);
  const storiesContent = await readFile4(storiesFile, "utf-8");
  const planContent = await readFile4(planFile, "utf-8");
  if (specFile) {
    validateArtifactContent("spec", await readFile4(specFile, "utf-8"), idea);
  }
  validateArtifactContent("stories", storiesContent, idea);
  validateArtifactContent("plan", planContent, idea);
  if (!isStoriesApproved(storiesContent)) {
    throw new Error(
      'landSpec: stories artifact is not approved \u2014 it must declare "Status: Accepted" (and no "Status: DRAFT"). Run the /stories skill and approve before landing.'
    );
  }
  const complexityDir = join10(worktreePath, ".docs", "complexity");
  const decisionsDir = join10(worktreePath, ".docs", "decisions");
  const complexityFile = await findNewestFile(complexityDir);
  const tier = complexityFile ? parseComplexityTier(await readFile4(complexityFile, "utf-8")) : void 0;
  if (tier && tier !== "S") {
    const conflictsFile = await findNewestFile(join10(worktreePath, ".docs", "conflicts"));
    const architectureFile = await findNewestFile(join10(worktreePath, ".docs", "architecture"));
    const reviewFile = await findNewestFile(decisionsDir);
    const missing = [];
    if (!conflictsFile) missing.push("conflicts");
    if (!architectureFile) missing.push("architecture");
    if (!reviewFile) missing.push("decisions (architecture-review/ADRs)");
    if (missing.length > 0) {
      throw new Error(
        `landSpec: complexity tier is "${tier}" (non-Small) but required DECIDE artifact ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} missing in ".docs/". Run /conflict-check, /architecture-diagram, and /architecture-review before landing.`
      );
    }
  }
  for (const adrFile of await listAdrFiles(decisionsDir)) {
    const adrContent = await readFile4(adrFile, "utf-8");
    if (hasDraftAdr(adrContent)) {
      throw new Error(
        `landSpec: ADR "${adrFile}" still carries "Status: DRAFT". All ADRs must be APPROVED before landing. Approve the ADRs via /architecture-review, then land.`
      );
    }
  }
  const slug = slugify2(idea);
  const { stdout: headRef } = await execFile2("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: worktreePath
  });
  const branch = headRef.trim();
  const markerSlug = planStem(planFile);
  await writeIntakeMarker(worktreePath, markerSlug, sourceRef, specOwner, guard);
  await execFile2("git", ["add", ".docs"], { cwd: worktreePath });
  await execFile2(
    "git",
    ["commit", "-m", `spec: land authored artifacts for "${idea}" [engineer/land]`],
    { cwd: worktreePath }
  );
  return { slug, branch, repoPath: worktreePath };
}
async function findNewestFile(dir) {
  try {
    await access5(dir);
  } catch {
    return null;
  }
  let entries;
  try {
    entries = await readdir3(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const mdFiles = entries.filter((e) => e.isFile() && String(e.name).endsWith(".md")).map((e) => join10(dir, String(e.name)));
  if (mdFiles.length === 0) return null;
  if (mdFiles.length === 1) return mdFiles[0];
  let newest = mdFiles[0];
  let newestMtime = 0;
  for (const f of mdFiles) {
    try {
      const { mtimeMs } = await import("fs/promises").then((m) => m.stat(f));
      if (mtimeMs > newestMtime) {
        newestMtime = mtimeMs;
        newest = f;
      }
    } catch {
    }
  }
  return newest;
}
async function listAdrFiles(decisionsDir) {
  try {
    await access5(decisionsDir);
  } catch {
    return [];
  }
  let entries;
  try {
    entries = await readdir3(decisionsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isFile() && /^adr-.*\.md$/i.test(String(e.name))).map((e) => join10(decisionsDir, String(e.name)));
}
var STUB_PATTERN = /_Generated by engineer\._/i;
function validateArtifactContent(label, content, _idea) {
  if (content.trim() === "") {
    throw new Error(
      `landSpec: ${label} artifact is empty/blank. Run the corresponding DECIDE skill to produce real content.`
    );
  }
  if (/status[^:\n]*:\s*[\*_]*\s*draft/i.test(content)) {
    throw new Error(
      `landSpec: ${label} artifact contains "Status: DRAFT" and has not been approved. The artifact must be accepted/approved before landing.`
    );
  }
  if (STUB_PATTERN.test(content)) {
    throw new Error(
      `landSpec: ${label} artifact contains a stub/generated placeholder ("_Generated by engineer._"). Replace it with real content from the /stories skill before landing.`
    );
  }
}

// src/engine/engineer/authored-ledger.ts
import { mkdir as mkdir7, readFile as readFile5, writeFile as writeFile7 } from "fs/promises";
import { join as join11 } from "path";
var LEDGER_FILE = "authored-keys.json";
var KEY_SEP = "\0";
function ledgerPath(opts = {}) {
  const dir = opts.engineerDir ?? resolveEngineerDir({ home: opts.home, env: opts.env });
  return join11(dir, LEDGER_FILE);
}
function pairKey(project, feature) {
  return `${project}${KEY_SEP}${feature}`;
}
async function recordAuthoredKey(project, feature, opts = {}) {
  if (!project || project.trim() === "") {
    throw new Error("recordAuthoredKey: project must not be empty");
  }
  if (!feature || feature.trim() === "") {
    throw new Error("recordAuthoredKey: feature must not be empty");
  }
  const dir = opts.engineerDir ?? resolveEngineerDir({ home: opts.home, env: opts.env });
  const path = join11(dir, LEDGER_FILE);
  await mkdir7(dir, { recursive: true });
  const existing = await readAuthoredKeys(opts);
  const seen = new Set(existing.map((e) => pairKey(e.project, e.feature)));
  const key = pairKey(project, feature);
  if (seen.has(key)) {
    return;
  }
  const next = [...existing, { project, feature }];
  await writeFile7(path, JSON.stringify(next, null, 2), "utf-8");
}
async function readAuthoredKeys(opts = {}) {
  const path = ledgerPath(opts);
  let raw;
  try {
    raw = await readFile5(path, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") {
      return [];
    }
    throw new Error(
      `authored-keys.json at ${path} could not be read: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `authored-keys.json at ${path} is malformed JSON \u2014 unable to parse ledger: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      `authored-keys.json at ${path} is malformed \u2014 expected a JSON array but got ${typeof parsed}`
    );
  }
  const keys = [];
  for (const item of parsed) {
    if (typeof item === "object" && item !== null && typeof item["project"] === "string" && typeof item["feature"] === "string") {
      keys.push({
        project: item.project,
        feature: item.feature
      });
    }
  }
  return keys;
}

// src/engine/engineer/handoff.ts
var NO_REMOTE_PATTERNS = [
  /no remote/i,
  /does not have any remotes/i,
  /no configured remote/i,
  // gh's actual message when the repo has zero remotes (e.g. `gh pr create`
  // against a local-only repo). The phrase is "no git remotes" — note the
  // intervening "git", which the broader /no remote/i above does NOT match.
  /no git remotes? found/i
];
function isNoRemoteError(err) {
  const message = err instanceof Error ? err.message : String(err);
  return NO_REMOTE_PATTERNS.some((pattern) => pattern.test(message));
}
async function openSpecPr(target, branch, deps) {
  const { runner, ledgerOpts } = deps;
  const cwd = deps.worktreePath ?? target.canonicalPath;
  let result;
  try {
    result = await runner(["pr", "create", "--head", branch, "--fill"], {
      cwd
    });
  } catch (err) {
    if (isNoRemoteError(err)) {
      await recordAuthoredKey(target.name, branch, ledgerOpts ?? {});
      return {
        kind: "pr-skipped",
        reason: `no remote: ${err instanceof Error ? err.message : String(err)}`
      };
    }
    throw err;
  }
  const url = extractPrUrl(result.stdout);
  if (!url) {
    throw new Error(
      `openSpecPr: no PR URL found in runner stdout for branch "${branch}" in "${target.canonicalPath}". stdout was: ${JSON.stringify(result.stdout)}`
    );
  }
  await recordAuthoredKey(target.name, branch, ledgerOpts ?? {});
  if (deps.sourceRef) {
    await injectIssueRef({
      gh: async (args, opts) => {
        const r = await runner(args, { cwd: opts.cwd });
        return { stdout: r.stdout };
      },
      prUrl: url,
      keyword: "Refs",
      sourceRef: deps.sourceRef,
      cwd,
      log: deps.log
    });
  }
  return { kind: "pr-opened", url };
}

// src/engine/engineer/worktree-authoring.ts
import { join as join12 } from "path";
function engineerWorktreePath(canonicalPath, slug) {
  return join12(canonicalPath, ".worktrees", `engineer-${slug}`);
}
async function createEngineerWorktree(canonicalPath, idea, log) {
  const slug = slugify2(idea);
  const branch = `spec/${slug}`;
  const worktreePath = engineerWorktreePath(canonicalPath, slug);
  let res;
  try {
    res = await ensureWorktree({
      root: canonicalPath,
      path: worktreePath,
      branch,
      // Lazy — resolved only when a FRESH branch is cut. Throws on unborn/detached HEAD,
      // which is exactly the strict-abort condition (FR-7 zero-commit case).
      resolveBase: () => deriveDefaultBranch(canonicalPath),
      log
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `engineer worktree: could not create an isolated worktree for "${idea}" in "${canonicalPath}": ${reason}. Aborting the idea \u2014 the engineer never falls back to authoring in the primary checkout (FR-7).`
    );
  }
  if (res.reconcile !== "created") {
    const status = await worktreeStatus(worktreePath).catch(() => "");
    if (status !== "") {
      throw new Error(
        `engineer worktree: leftover worktree at "${worktreePath}" (${res.reconcile}) is dirty:
${status}
Refusing to reuse it to avoid a silent stale-artifact land \u2014 remove it and retry (FR-11).`
      );
    }
  }
  return { slug, branch, worktreePath, reconcile: res.reconcile };
}
async function removeEngineerWorktree(canonicalPath, worktreePath) {
  await removeWorktree(canonicalPath, worktreePath);
}

// src/engine/engineer/intake/ledger.ts
import { readFile as readFile6, writeFile as writeFile8, mkdir as mkdir8, rename } from "fs/promises";
import { dirname as dirname3 } from "path";
import { randomBytes } from "crypto";
function makeKey(source, sourceRef) {
  return `${source}\0${sourceRef}`;
}
async function loadStore(path) {
  try {
    const raw = await readFile6(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
async function saveStore(path, store) {
  await mkdir8(dirname3(path), { recursive: true });
  const tmp = `${path}.tmp.${randomBytes(4).toString("hex")}`;
  await writeFile8(tmp, JSON.stringify(store, null, 2), "utf8");
  await rename(tmp, path);
}
function createLedger(path) {
  return {
    async known(source, sourceRef) {
      const store = await loadStore(path);
      return makeKey(source, sourceRef) in store;
    },
    async record({ source, sourceRef }) {
      const store = await loadStore(path);
      const key = makeKey(source, sourceRef);
      if (!(key in store)) {
        const now = (/* @__PURE__ */ new Date()).toISOString();
        store[key] = {
          source,
          sourceRef,
          status: "pending",
          attempts: 0,
          capturedAt: now,
          lastSeenAt: now
        };
        await saveStore(path, store);
      }
    },
    async transition(source, sourceRef, status, meta) {
      const store = await loadStore(path);
      const key = makeKey(source, sourceRef);
      const entry = store[key];
      if (!entry) {
        throw new Error(
          `Ledger: no entry for (source="${source}", sourceRef="${sourceRef}") \u2014 call record() first`
        );
      }
      store[key] = {
        ...entry,
        status,
        lastSeenAt: (/* @__PURE__ */ new Date()).toISOString(),
        ...meta?.branch !== void 0 ? { branch: meta.branch } : {},
        ...meta?.prUrl !== void 0 ? { prUrl: meta.prUrl } : {}
      };
      await saveStore(path, store);
    },
    async get(source, sourceRef) {
      const store = await loadStore(path);
      return store[makeKey(source, sourceRef)];
    },
    async forget(source, sourceRef) {
      const store = await loadStore(path);
      const key = makeKey(source, sourceRef);
      if (key in store) {
        delete store[key];
        await saveStore(path, store);
      }
    },
    async reopen(source, sourceRef) {
      const store = await loadStore(path);
      const key = makeKey(source, sourceRef);
      const entry = store[key];
      if (!entry) return;
      store[key] = {
        ...entry,
        status: "pending",
        attempts: (entry.attempts ?? 0) + 1,
        lastSeenAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      await saveStore(path, store);
    }
  };
}

// src/engine/engineer/intake/queue.ts
import { mkdir as mkdir9, readdir as readdir4, rename as rename2, unlink, readFile as readFile7, writeFile as writeFile9 } from "fs/promises";
import { join as join13 } from "path";
function sanitize(s) {
  return s.replace(/[^a-zA-Z0-9\-.]/g, "_");
}
function pendingName(e) {
  return `${sanitize(e.receivedAt)}__${sanitize(e.id)}.json`;
}
function claimedName(e) {
  return `${sanitize(e.receivedAt)}__${sanitize(e.id)}.claimed`;
}
function toClaimed(filename) {
  return filename.replace(/\.json$/, ".claimed");
}
function createFileQueue(dir) {
  return {
    // ── enqueue ─────────────────────────────────────────────────────────────
    async enqueue(e) {
      await mkdir9(dir, { recursive: true });
      const filepath = join13(dir, pendingName(e));
      await writeFile9(filepath, JSON.stringify(e), { flag: "w" });
    },
    // ── claim ────────────────────────────────────────────────────────────────
    async claim() {
      await mkdir9(dir, { recursive: true });
      const entries = await readdir4(dir);
      const pendingFiles = entries.filter((f) => f.endsWith(".json")).sort();
      if (pendingFiles.length === 0) return null;
      for (const filename of pendingFiles) {
        const filepath = join13(dir, filename);
        let content;
        try {
          content = await readFile7(filepath, "utf8");
        } catch {
          continue;
        }
        try {
          JSON.parse(content);
        } catch {
          throw new Error(`Corrupt inbox entry: failed to parse file "${filename}"`);
        }
      }
      for (const filename of pendingFiles) {
        const pendingPath = join13(dir, filename);
        const claimedPath = join13(dir, toClaimed(filename));
        try {
          await rename2(pendingPath, claimedPath);
        } catch (err) {
          const nodeErr = err;
          if (nodeErr.code === "ENOENT") {
            continue;
          }
          throw err;
        }
        const content = await readFile7(claimedPath, "utf8");
        return JSON.parse(content);
      }
      return null;
    },
    // ── ack ──────────────────────────────────────────────────────────────────
    async ack(e) {
      await unlink(join13(dir, claimedName(e)));
    },
    // ── release ──────────────────────────────────────────────────────────────
    async release(e) {
      await rename2(join13(dir, claimedName(e)), join13(dir, pendingName(e)));
    }
  };
}

// src/engine/engineer/intake/github-issues.ts
import { randomUUID } from "crypto";

// src/engine/engineer/intake/port.ts
var VALID_STATUSES = /* @__PURE__ */ new Set(["pending", "routed", "deciding", "done"]);
var EmptyEnvelopeTextError = class extends Error {
  constructor() {
    super('Envelope field "text" must not be empty or whitespace-only');
    this.name = "EmptyEnvelopeTextError";
  }
};
var EnvelopeValidationError = class extends Error {
  constructor(field, reason) {
    super(`Envelope field "${field}" ${reason} [field: ${field}]`);
    this.name = "EnvelopeValidationError";
  }
};
function parseEnvelope(input) {
  const requiredStringFields = ["id", "source", "sourceRef", "receivedAt"];
  for (const field of requiredStringFields) {
    if (!(field in input) || input[field] === void 0 || input[field] === null) {
      throw new EnvelopeValidationError(field, "is required");
    }
    if (typeof input[field] !== "string") {
      throw new EnvelopeValidationError(field, "must be a string");
    }
  }
  if (!("text" in input) || input.text === void 0 || input.text === null) {
    throw new EnvelopeValidationError("text", "is required");
  }
  if (typeof input.text !== "string") {
    throw new EnvelopeValidationError("text", "must be a string");
  }
  if (input.text.trim() === "") {
    throw new EmptyEnvelopeTextError();
  }
  if (!("status" in input) || input.status === void 0 || input.status === null) {
    throw new EnvelopeValidationError("status", "is required");
  }
  if (typeof input.status !== "string" || !VALID_STATUSES.has(input.status)) {
    throw new EnvelopeValidationError(
      "status",
      `must be one of ${[...VALID_STATUSES].join("|")} (got: ${String(input.status)})`
    );
  }
  const hintRepo = "hintRepo" in input && typeof input.hintRepo === "string" ? input.hintRepo : void 0;
  return {
    id: input.id,
    source: input.source,
    sourceRef: input.sourceRef,
    text: input.text,
    hintRepo,
    status: input.status,
    receivedAt: input.receivedAt
  };
}

// src/engine/engineer/intake/github-issues.ts
var GITHUB_ISSUES_SOURCE = "github-issues";
var HANDLED_LABEL = "engineer:handled";
var REOPEN_ATTEMPTS_CAP = 2;
function labelNames(issue) {
  return (issue.labels ?? []).map((l) => typeof l === "string" ? l : l.name);
}
function buildText(title, body) {
  const t = (title ?? "").trim();
  const b = (body ?? "").trim();
  if (t === "" && b === "") return null;
  return [t, b].filter((s) => s !== "").join("\n\n");
}
function createGithubIssuesAdapter(deps) {
  const { gh, registry, ledger } = deps;
  const now = deps.now ?? (() => (/* @__PURE__ */ new Date()).toISOString());
  const newId = deps.newId ?? (() => randomUUID());
  const log = deps.log ?? (() => {
  });
  const postedMarkers = /* @__PURE__ */ new Set();
  const repoPaths = /* @__PURE__ */ new Map();
  async function maybeReopen(repo, issue, sourceRef) {
    const entry = await ledger.get(GITHUB_ISSUES_SOURCE, sourceRef);
    if (!entry || entry.status !== "done" || !entry.prUrl) return null;
    let pr;
    try {
      const { stdout } = await gh(["pr", "view", entry.prUrl, "--json", "state,mergedAt"], {
        cwd: repo.path
      });
      pr = JSON.parse(stdout || "{}");
    } catch {
      return null;
    }
    const merged = pr.state === "MERGED" || Boolean(pr.mergedAt);
    if (merged) return null;
    if (pr.state !== "CLOSED") return null;
    if ((entry.attempts ?? 0) >= REOPEN_ATTEMPTS_CAP) {
      await ledger.transition(GITHUB_ISSUES_SOURCE, sourceRef, "needs-manual");
      log(`github-issues: ${sourceRef} exceeded reopen cap \u2014 parked as needs-manual`);
      return null;
    }
    const text = buildText(issue.title, issue.body);
    if (text === null) return null;
    try {
      const ghRepo = repo.ghRepo ?? repo.name;
      await gh(restRemoveLabelArgs(ghRepo, String(issue.number), HANDLED_LABEL), {
        cwd: repo.path
      });
    } catch {
    }
    await ledger.reopen(GITHUB_ISSUES_SOURCE, sourceRef);
    return parseEnvelope({
      id: newId(),
      source: GITHUB_ISSUES_SOURCE,
      sourceRef,
      text,
      hintRepo: repo.name,
      status: "pending",
      receivedAt: now()
    });
  }
  return {
    // ── poll / capture ────────────────────────────────────────────────────────
    async poll() {
      const repos = await registry.list();
      const out = [];
      for (const repo of repos) {
        const ghRepo = repo.ghRepo ?? repo.name;
        repoPaths.set(ghRepo, repo.path);
        let issues;
        try {
          const { stdout } = await gh(
            ["issue", "list", "--assignee", "@me", "--state", "open", "--json", "number,title,body,labels", "-R", ghRepo],
            { cwd: repo.path }
          );
          issues = JSON.parse(stdout || "[]");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log(`github-issues: poll failed for ${ghRepo} \u2014 ${msg}`);
          continue;
        }
        for (const issue of issues) {
          const sourceRef = `${ghRepo}#${issue.number}`;
          if (labelNames(issue).includes(HANDLED_LABEL)) {
            const reopened = await maybeReopen(repo, issue, sourceRef);
            if (reopened) out.push(reopened);
            continue;
          }
          if (await ledger.known(GITHUB_ISSUES_SOURCE, sourceRef)) continue;
          const text = buildText(issue.title, issue.body);
          if (text === null) {
            log(`github-issues: skipping empty issue ${sourceRef}`);
            continue;
          }
          const envelope = parseEnvelope({
            id: newId(),
            source: GITHUB_ISSUES_SOURCE,
            sourceRef,
            text,
            hintRepo: ghRepo,
            status: "pending",
            receivedAt: now()
          });
          await ledger.record({ source: GITHUB_ISSUES_SOURCE, sourceRef });
          out.push(envelope);
        }
      }
      return out;
    },
    // ── report / write-back ─────────────────────────────────────────────────────
    async report(sourceRef, status, meta) {
      const marker = `${sourceRef}\0${status}`;
      if (postedMarkers.has(marker)) return;
      const parsed = parseSourceRef(sourceRef);
      if (!parsed) {
        log(`github-issues: report() ignoring unparseable sourceRef "${sourceRef}"`);
        return;
      }
      const { repo, number } = parsed;
      const repoPath = repoPaths.get(repo) ?? process.cwd();
      try {
        if (status === "routed") {
          const body = `Routed to ${meta?.repo ?? "(unresolved)"}`;
          await gh(["issue", "comment", number, "-R", repo, "--body", body], { cwd: repoPath });
        } else if (status === "done") {
          const body = `Spec PR opened: ${meta?.prUrl ?? "(unknown)"}`;
          await gh(["issue", "comment", number, "-R", repo, "--body", body], { cwd: repoPath });
          try {
            await gh(["label", "create", HANDLED_LABEL, "-R", repo], { cwd: repoPath });
          } catch {
          }
          await gh(restAddLabelArgs(repo, number, HANDLED_LABEL), { cwd: repoPath });
        } else {
          return;
        }
        postedMarkers.add(marker);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`github-issues: write-back failed for ${sourceRef} (${status}) \u2014 ${msg}`);
      }
    }
  };
}

// src/engine/engineer/intake/writeback.ts
async function reportRouted(target, repo) {
  if (target.port) {
    try {
      await target.port.report(target.sourceRef, "routed", { repo });
    } catch {
    }
  }
  try {
    await target.ledger?.transition(target.source, target.sourceRef, "routed");
  } catch {
  }
}
async function reportDone(target, prUrl, branch) {
  if (target.port) {
    try {
      await target.port.report(target.sourceRef, "done", { prUrl });
    } catch {
    }
  }
  try {
    await target.ledger?.transition(target.source, target.sourceRef, "done", {
      prUrl,
      ...branch !== void 0 ? { branch } : {}
    });
  } catch {
  }
}

// src/engine/engineer/intake/dependency-claim.ts
async function claimUnblocked(deps) {
  const { queue, resolveDependency } = deps;
  const held = [];
  const deferred = [];
  try {
    for (; ; ) {
      const envelope = await queue.claim();
      if (!envelope) {
        return deferred.length > 0 ? { kind: "all-blocked", entries: deferred } : { kind: "empty" };
      }
      const verdict = await resolveDependency(envelope.sourceRef);
      if (verdict.kind === "unblocked") {
        return { kind: "claim", envelope };
      }
      held.push(envelope);
      deferred.push({ envelope, verdict });
    }
  } finally {
    for (const envelope of held) {
      await queue.release(envelope);
    }
  }
}

// src/engine/engineer/issue-dep-migration.ts
function repoPrefixOf(ref) {
  const hash = ref.lastIndexOf("#");
  if (hash <= 0) return null;
  return ref.slice(0, hash);
}
var PATTERNS = [
  // "Gated on #217" — bare issue number, same-repo only (no owner/repo prefix
  // immediately before the #, which would signal a cross-repo reference).
  { re: /\bgated on\b\s*:?\s*((?:#\d+(?:\s*\/\s*)?)+)/gi, kind: "gated-on" },
  // "Depends on: #189 / #190" or "Depends on #189"
  { re: /\bdepends on\b\s*:?\s*((?:#\d+(?:\s*\/\s*)?)+)/gi, kind: "depends-on" },
  // "Blocked by #226" — but NOT "Blocker for #226" (reverse direction, Task 23).
  { re: /\bblocked by\b\s*:?\s*((?:#\d+(?:\s*\/\s*)?)+)/gi, kind: "blocked-by" }
];
function extractIssueNumbers(group) {
  const nums = [];
  const re = /#(\d+)/g;
  let m;
  while ((m = re.exec(group)) !== null) nums.push(m[1]);
  return nums;
}
function parseDependencyEdges(input) {
  const { ref, body } = input;
  const repoPrefix = repoPrefixOf(ref);
  if (!repoPrefix || !body) return [];
  const edges = [];
  for (const { re, kind } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(body)) !== null) {
      for (const num of extractIssueNumbers(m[1])) {
        edges.push({
          source: ref,
          target: `${repoPrefix}#${num}`,
          kind,
          blocked_by: true
        });
      }
    }
  }
  return edges;
}
var REVERSE_DIRECTION_RE = /\bblocker for\b\s*:?\s*#(\d+)|\bblocks\b\s*:?\s*#(\d+)/gi;
var CROSS_REPO_RE = /\b([\w.-]+\/[\w.-]+)#(\d+)\b/g;
var TASK_LIST_PHASE_RE = /^-\s*\[[ xX]\]\s*((?:Phase\b|#\d+\s).*)$/gm;
function parseDependencyProse(input) {
  const { ref, body } = input;
  const edges = parseDependencyEdges(input);
  const manualReview = [];
  if (!body) return { edges, manualReview };
  const repoPrefix = repoPrefixOf(ref);
  REVERSE_DIRECTION_RE.lastIndex = 0;
  let m;
  while ((m = REVERSE_DIRECTION_RE.exec(body)) !== null) {
    const num = m[1] ?? m[2];
    manualReview.push({
      source: ref,
      target: repoPrefix ? `${repoPrefix}#${num}` : null,
      reason: "reverse-direction",
      excerpt: m[0]
    });
  }
  CROSS_REPO_RE.lastIndex = 0;
  while ((m = CROSS_REPO_RE.exec(body)) !== null) {
    manualReview.push({
      source: ref,
      target: `${m[1]}#${m[2]}`,
      reason: "cross-repo",
      excerpt: m[0]
    });
  }
  TASK_LIST_PHASE_RE.lastIndex = 0;
  while ((m = TASK_LIST_PHASE_RE.exec(body)) !== null) {
    manualReview.push({
      source: ref,
      target: null,
      reason: "task-list-phase",
      excerpt: m[1].trim()
    });
  }
  return { edges, manualReview };
}
function parseRef(ref) {
  const hash = ref.lastIndexOf("#");
  if (hash <= 0 || hash === ref.length - 1) return null;
  const repo = ref.slice(0, hash);
  const number = ref.slice(hash + 1);
  if (!/^\d+$/.test(number)) return null;
  return { repo, number };
}
function repoFromRepositoryUrl(repositoryUrl) {
  const m = repositoryUrl.match(/\/repos\/([^/]+\/[^/]+)$/);
  return m ? m[1] : null;
}
async function fetchExistingBlockedBy(sourceRepo, sourceNumber, gh, cwd) {
  const { stdout } = await gh(["api", `repos/${sourceRepo}/issues/${sourceNumber}/dependencies/blocked_by`], {
    cwd
  });
  let raw = [];
  try {
    raw = JSON.parse(stdout || "[]");
  } catch {
    raw = [];
  }
  const existing = /* @__PURE__ */ new Set();
  for (const entry of raw) {
    const repo = entry.repository_url ? repoFromRepositoryUrl(entry.repository_url) : sourceRepo;
    if (repo) existing.add(`${repo}#${entry.number}`);
  }
  return existing;
}
async function resolveIssueDatabaseId(repo, number, gh, cwd) {
  const { stdout } = await gh(["api", `repos/${repo}/issues/${number}`], { cwd });
  try {
    const parsed = JSON.parse(stdout || "{}");
    return typeof parsed.id === "number" && Number.isFinite(parsed.id) ? parsed.id : null;
  } catch {
    return null;
  }
}
async function createDependencyLinks(edges, deps) {
  const { gh, cwd, dryRun = false } = deps;
  const log = deps.log ?? (() => {
  });
  const results = [];
  const existingBySource = /* @__PURE__ */ new Map();
  const targetIdByRef = /* @__PURE__ */ new Map();
  for (const edge of edges) {
    const source = parseRef(edge.source);
    const target = parseRef(edge.target);
    if (!source || !target) {
      log(`createDependencyLinks: skipping unparseable edge ${edge.source} -> ${edge.target}`);
      continue;
    }
    let existing = existingBySource.get(edge.source);
    if (!existing) {
      existing = await fetchExistingBlockedBy(source.repo, source.number, gh, cwd);
      existingBySource.set(edge.source, existing);
    }
    if (existing.has(edge.target)) {
      results.push({ edge, status: "already-present" });
      continue;
    }
    if (dryRun) {
      results.push({ edge, status: "dry-run" });
      continue;
    }
    let targetId = targetIdByRef.get(edge.target);
    if (targetId === void 0) {
      targetId = await resolveIssueDatabaseId(target.repo, target.number, gh, cwd);
      targetIdByRef.set(edge.target, targetId);
    }
    if (targetId === null) {
      log(`createDependencyLinks: could not resolve issue id for ${edge.target}; skipping edge`);
      continue;
    }
    await gh(
      [
        "api",
        "-X",
        "POST",
        `repos/${source.repo}/issues/${source.number}/dependencies/blocked_by`,
        "-F",
        `issue_id=${targetId}`
      ],
      { cwd }
    );
    existing.add(edge.target);
    results.push({ edge, status: "created" });
  }
  return results;
}
async function runMigration(deps) {
  const proposed = [];
  const manualReview = [];
  const edges = [];
  const created = [];
  const alreadyPresent = [];
  const failed = [];
  for (const issue of deps.issues) {
    const result = parseDependencyProse({ ref: issue.ref, body: issue.body });
    for (const edge of result.edges) {
      edges.push(edge);
      proposed.push({ issue: edge.source, blockedBy: edge.target, kind: edge.kind });
    }
    for (const item of result.manualReview) {
      manualReview.push({
        issue: item.source,
        target: item.target,
        reason: item.reason,
        excerpt: item.excerpt
      });
    }
  }
  const confirmed = await deps.confirm();
  if (!confirmed) {
    return { proposed, manualReview, created, alreadyPresent, failed };
  }
  const cwd = ".";
  for (const edge of edges) {
    try {
      const results = await createDependencyLinks([edge], { gh: deps.gh, cwd });
      for (const result of results) {
        if (result.status === "created") {
          created.push({ issue: result.edge.source, blockedBy: result.edge.target });
        } else if (result.status === "already-present") {
          alreadyPresent.push({ issue: result.edge.source, blockedBy: result.edge.target });
        }
      }
    } catch (error) {
      failed.push({ issue: edge.source, error: String(error) });
    }
  }
  return { proposed, manualReview, created, alreadyPresent, failed };
}

// src/engine/engineer-cli.ts
var execFileP = promisify4(execFileCb4);
function detectEngineerCommand(argv) {
  const sub = argv[2];
  if (sub !== "engineer") return null;
  const subCmd = argv[3];
  if (!subCmd || subCmd === "") {
    return { kind: "launch" };
  }
  if (subCmd === "projects") {
    return { kind: "projects" };
  }
  if (subCmd === "worktree") {
    const project = parseFlag(argv, "--project");
    const idea = parseFlag(argv, "--idea");
    if (!project || !idea) {
      return { kind: "guide" };
    }
    return { kind: "worktree", project, idea };
  }
  if (subCmd === "land") {
    const project = parseFlag(argv, "--project");
    const idea = parseFlag(argv, "--idea");
    const worktree = parseFlag(argv, "--worktree");
    if (!project || !idea || !worktree) {
      return { kind: "guide" };
    }
    const sourceRef = parseFlag(argv, "--source-ref") ?? void 0;
    return { kind: "land", project, idea, worktree, sourceRef };
  }
  if (subCmd === "handoff") {
    const project = parseFlag(argv, "--project");
    const branch = parseFlag(argv, "--branch");
    const worktree = parseFlag(argv, "--worktree");
    if (!project || !branch || !worktree) {
      return { kind: "guide" };
    }
    const sourceRef = parseFlag(argv, "--source-ref") ?? void 0;
    return { kind: "handoff", project, branch, worktree, sourceRef };
  }
  if (subCmd === "poll") {
    return { kind: "poll" };
  }
  if (subCmd === "claim") {
    return { kind: "claim" };
  }
  if (subCmd === "forget") {
    const sourceRef = argv[4];
    if (!sourceRef || sourceRef.startsWith("--")) {
      return { kind: "guide" };
    }
    return { kind: "forget", sourceRef };
  }
  if (subCmd === "migrate-issue-deps") {
    const confirm = argv.includes("--confirm");
    return { kind: "migrate-issue-deps", confirm };
  }
  if (subCmd === "--idea") {
    const idea = parseFlag(argv, "--idea");
    if (!idea) return { kind: "guide" };
    return { kind: "launch", idea };
  }
  if (!subCmd.startsWith("--")) {
    const idea = argv.slice(3).join(" ").trim();
    if (idea) return { kind: "launch", idea };
  }
  return { kind: "guide" };
}
function parseFlag(argv, flag) {
  const idx = argv.indexOf(flag);
  if (idx === -1 || idx >= argv.length - 1) return null;
  const val = argv[idx + 1];
  if (!val || val.startsWith("--")) return null;
  return val;
}
function engineerLaunchArgs(env = process.env, idea) {
  const requested = (env.CONDUCT_ENGINEER_PERMISSION_MODE || "").trim();
  const mode = requested && requested !== "plan" ? requested : "default";
  const trimmed = (idea ?? "").trim();
  const prompt = trimmed ? `/engineer ${trimmed}` : "/engineer";
  return ["--permission-mode", mode, prompt];
}
function launchClaudeEngineer(cwd, idea) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", engineerLaunchArgs(process.env, idea), { stdio: "inherit", cwd });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 0));
  });
}
function promptAnother() {
  if (!process.stdin.isTTY) return Promise.resolve(false);
  process.stdout.write("\nProcess another idea in a fresh session? [Y/n] ");
  return new Promise((resolve) => {
    const onData = (chunk) => {
      process.stdin.off("data", onData);
      process.stdin.pause();
      const a = chunk.toString().trim().toLowerCase();
      resolve(a === "" || a === "y" || a === "yes");
    };
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}
function parseGhRepo(remote) {
  if (!remote) return null;
  const m = remote.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  return m ? m[1] : null;
}
function printGuide(print) {
  print(
    'The engineer is the agent-hosted idea\u2192spec loop. Run `conduct-ts engineer` (no\nsubcommand) to drop into an interactive `claude /engineer` session and drive it\nwith a human in the loop. The subcommands below are the deterministic primitives\nthe /engineer skill calls in-chat:\n\n  conduct-ts engineer                                     \u2014 launch the interactive /engineer loop (pre-polls intake)\n  conduct-ts engineer --idea "<text>"                     \u2014 launch driving a specific idea (skips intake poll)\n  conduct-ts engineer projects                            \u2014 list registered projects\n  conduct-ts engineer claim                               \u2014 dequeue the oldest pending intake idea (JSON)\n  conduct-ts engineer worktree --project <n> --idea "<i>"                     \u2014 create the per-idea authoring worktree\n  conduct-ts engineer land --project <n> --idea "<i>" --worktree <p> [--source-ref <ref>]    \u2014 commit spec artifacts in the worktree\n  conduct-ts engineer handoff --project <n> --branch <b> --worktree <p> [--source-ref <ref>] \u2014 open spec PR + remove worktree + nudge daemon\n  conduct-ts engineer poll                                \u2014 poll github issues \u2192 enqueue new ideas\n  conduct-ts engineer forget <owner/repo#N>               \u2014 drop an intake ledger entry + label\n  conduct-ts engineer migrate-issue-deps [--confirm]      \u2014 one-time prose\u2192link dependency migration (dry-run by default; --confirm writes)\n'
  );
}
function makeProductionGh() {
  return async (args, opts) => {
    const result = await execFileP("gh", args, { cwd: opts.cwd });
    return { stdout: String(result.stdout) };
  };
}
function buildIntake(deps) {
  const reader = createRegistryReader(deps.registryPath ? { registryPath: deps.registryPath } : {});
  const ledger = createLedger(join14(deps.engineerDir, "ledger.json"));
  const queue = createFileQueue(join14(deps.engineerDir, "inbox"));
  const adapter = createGithubIssuesAdapter({
    gh: deps.gh,
    registry: {
      list: async () => (await reader.listProjects()).map((p) => ({
        name: p.remote ? parseGhRepo(p.remote) ?? p.name : p.name,
        ghRepo: p.remote ? parseGhRepo(p.remote) ?? void 0 : void 0,
        path: p.path
      }))
    },
    ledger,
    log: (m) => deps.printErr(m)
  });
  return { reader, ledger, queue, adapter };
}
async function prePollIntake(deps) {
  const { queue, adapter } = buildIntake(deps);
  const envelopes = await adapter.poll();
  for (const e of envelopes) {
    await queue.enqueue(e);
  }
  return envelopes.length;
}
async function dispatchEngineer(dispatch, opts = {}) {
  const print = opts.print ?? ((s) => process.stdout.write(s + "\n"));
  const printErr = opts.printErr ?? ((s) => process.stderr.write(s + "\n"));
  const gh = opts.gh ?? makeProductionGh();
  const registryPath2 = opts.registryPath;
  const engineerDir = opts.engineerDir;
  switch (dispatch.kind) {
    // ── launch ──────────────────────────────────────────────────────────────────
    // Bare `conduct-ts engineer`: drop the operator into the interactive /engineer loop.
    case "launch": {
      const launchOne = opts.launchInteractive ?? ((idea) => launchClaudeEngineer(process.cwd(), idea));
      const confirmAnother = opts.confirmAnother ?? promptAnother;
      if (!opts.launchInteractive) {
        const inside = opts.insideClaudeSession ?? Boolean(process.env.CLAUDECODE);
        if (inside) {
          print(
            "You're already inside a Claude Code session \u2014 run /engineer directly to start the idea\u2192spec loop (no need to launch a nested session)."
          );
          return 0;
        }
      }
      const prePoll = opts.prePoll ?? (opts.launchInteractive ? void 0 : () => prePollIntake({
        engineerDir: engineerDir ?? resolveEngineerDir({}),
        registryPath: registryPath2,
        gh,
        printErr
      }));
      let pendingIdea = dispatch.idea;
      let lastCode = 0;
      for (; ; ) {
        if (!pendingIdea && prePoll) {
          try {
            const n = await prePoll();
            if (n > 0) print(`Intake: ${n} issue(s) queued.`);
          } catch (err) {
            printErr(
              `engineer: intake pre-poll failed (${err instanceof Error ? err.message : String(err)}) \u2014 continuing.`
            );
          }
        }
        try {
          lastCode = await launchOne(pendingIdea);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          printErr(
            `engineer: could not launch an interactive Claude session (${msg}). Is the \`claude\` CLI installed and on your PATH?`
          );
          printGuide(print);
          return 1;
        }
        pendingIdea = void 0;
        if (!await confirmAnother()) return lastCode;
        print("");
      }
    }
    // ── guide ─────────────────────────────────────────────────────────────────
    case "guide": {
      printGuide(print);
      return 0;
    }
    // ── projects ──────────────────────────────────────────────────────────────
    case "projects": {
      const reader = createRegistryReader(registryPath2 ? { registryPath: registryPath2 } : {});
      const projects = await reader.listProjects();
      print(JSON.stringify(projects));
      return 0;
    }
    // ── worktree ────────────────────────────────────────────────────────────────
    // `conduct-ts engineer worktree --project <n> --idea "<i>"`: create the per-idea
    // isolated worktree the skill authors + lands in. Strict-abort (FR-7): a failure
    // makes zero mutation to the primary tree and returns exit 1. Prints
    // `{ slug, branch, worktreePath, reconcile }` on success.
    case "worktree": {
      const { project: projectName, idea } = dispatch;
      const reader = createRegistryReader(registryPath2 ? { registryPath: registryPath2 } : {});
      const allProjects = await reader.listProjects();
      const record = allProjects.find((p) => p.name === projectName);
      if (!record) {
        printErr(`engineer worktree: project "${projectName}" not found in registry.`);
        return 1;
      }
      let target;
      try {
        target = await resolveTargetRepo(record.path, reader);
      } catch (err) {
        printErr(`engineer worktree: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
      }
      try {
        const wt = await createEngineerWorktree(target.canonicalPath, idea, (m) => printErr(m));
        print(JSON.stringify({ kind: "worktree", ...wt }));
        return 0;
      } catch (err) {
        printErr(`engineer worktree: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
      }
    }
    // ── land ──────────────────────────────────────────────────────────────────
    case "land": {
      const { project: projectName, idea, worktree, sourceRef } = dispatch;
      const reader = createRegistryReader(registryPath2 ? { registryPath: registryPath2 } : {});
      const allProjects = await reader.listProjects();
      const record = allProjects.find((p) => p.name === projectName);
      if (!record) {
        printErr(`engineer land: project "${projectName}" not found in registry.`);
        return 1;
      }
      let target;
      try {
        target = await resolveTargetRepo(record.path, reader);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        printErr(`engineer land: ${msg}`);
        return 1;
      }
      const ownerConfig = await readMachineOwnerConfig();
      const identity = await resolveDaemonOwner(ownerConfig, gh, target.canonicalPath);
      if (!identity.resolved) {
        printErr(
          "Cannot land spec: identity unresolved. Resolve one of:\n  1. Set spec_owner in ~/.ai-conductor/config.yml\n  2. Authenticate via: gh auth login"
        );
        return 1;
      }
      let result;
      try {
        result = await landSpec(
          { name: target.name, canonicalPath: target.canonicalPath },
          idea,
          worktree,
          sourceRef,
          { ownerConfig, gh }
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        printErr(`engineer land: ${msg}`);
        printErr(`engineer land: worktree kept for inspection at "${worktree}".`);
        return 1;
      }
      if (sourceRef) {
        const engDir = engineerDir ?? resolveEngineerDir({});
        const { ledger, adapter } = buildIntake({ engineerDir: engDir, registryPath: registryPath2, gh, printErr });
        await reportRouted(
          { source: GITHUB_ISSUES_SOURCE, sourceRef, port: adapter, ledger },
          target.name
        );
      }
      print(JSON.stringify(result));
      return 0;
    }
    // ── handoff ───────────────────────────────────────────────────────────────
    case "handoff": {
      const { project: projectName, branch, worktree, sourceRef } = dispatch;
      const reader = createRegistryReader(registryPath2 ? { registryPath: registryPath2 } : {});
      const allProjects = await reader.listProjects();
      const record = allProjects.find((p) => p.name === projectName);
      if (!record) {
        printErr(`engineer handoff: project "${projectName}" not found in registry.`);
        return 1;
      }
      let target;
      try {
        target = await resolveTargetRepo(record.path, reader);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        printErr(`engineer handoff: ${msg}`);
        return 1;
      }
      let handoffResult;
      try {
        handoffResult = await openSpecPr(target, branch, {
          runner: async (args, runnerOpts) => {
            const cwd = runnerOpts?.cwd ?? worktree;
            const r = await gh(args, { cwd });
            return { stdout: r.stdout, stderr: "" };
          },
          // gh runs in the per-idea worktree (checked out on spec/<slug>) — FR-4.
          worktreePath: worktree,
          ledgerOpts: engineerDir ? { engineerDir } : {},
          // Link the spec PR to its issue with a non-closing `Refs` (does not
          // close — the daemon's implementation PR closes it on merge).
          sourceRef
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        printErr(`engineer handoff: PR open failed: ${msg}`);
        printErr(`engineer handoff: worktree kept for inspection at "${worktree}".`);
        print(
          JSON.stringify({
            kind: "local-commit",
            branch,
            repoPath: target.canonicalPath,
            worktreePath: worktree
          })
        );
        return 0;
      }
      try {
        await removeEngineerWorktree(target.canonicalPath, worktree);
      } catch (err) {
        printErr(
          `\u26A0 Spec delivered, but the per-idea worktree "${worktree}" could not be removed: ${err instanceof Error ? err.message : String(err)}. Remove it manually.`
        );
      }
      if (handoffResult.kind === "pr-opened") {
        print(JSON.stringify({ kind: "pr-opened", url: handoffResult.url }));
        if (sourceRef) {
          const engDir = engineerDir ?? resolveEngineerDir({});
          const { ledger, adapter } = buildIntake({ engineerDir: engDir, registryPath: registryPath2, gh, printErr });
          await reportDone(
            { source: GITHUB_ISSUES_SOURCE, sourceRef, port: adapter, ledger },
            handoffResult.url,
            branch
          );
        }
      } else {
        print(
          JSON.stringify({
            kind: "local-commit",
            branch,
            repoPath: target.canonicalPath,
            reason: handoffResult.reason
          })
        );
      }
      try {
        const launchFn = opts.ensureRunningLaunch;
        if (launchFn) {
          await Promise.resolve(launchFn(target.canonicalPath));
        } else {
          await ensureRunning(target.canonicalPath, {});
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        printErr(
          `\u26A0 Spec authored, but the build daemon was not started for "${target.name}": ${reason}`
        );
      }
      return 0;
    }
    // ── poll ────────────────────────────────────────────────────────────────────
    // `conduct-ts engineer poll`: poll the github-issues source across registered
    // repos and enqueue new envelopes into the durable inbox. NO routing, NO
    // processing, NO setInterval/detached spawn — a single synchronous sweep. The
    // ledger dedups, so a double-poll enqueues nothing new.
    case "poll": {
      const engDir = engineerDir ?? resolveEngineerDir({});
      const { queue, adapter } = buildIntake({ engineerDir: engDir, registryPath: registryPath2, gh, printErr });
      const envelopes = await adapter.poll();
      for (const e of envelopes) {
        await queue.enqueue(e);
      }
      print(JSON.stringify({ kind: "poll", enqueued: envelopes.length, sourceRefs: envelopes.map((e) => e.sourceRef) }));
      return 0;
    }
    // ── claim ─────────────────────────────────────────────────────────────────
    // `conduct-ts engineer claim`: atomically dequeue the oldest pending idea so the
    // /engineer skill can route it. claim+ack removes it from the inbox (the ledger
    // is the durable record); the ledger advances to `claimed`. On an empty inbox,
    // reports {empty:true} — the skill then falls back to a CLI idea arg or chat.
    case "claim": {
      const engDir = engineerDir ?? resolveEngineerDir({});
      const { ledger, queue } = buildIntake({ engineerDir: engDir, registryPath: registryPath2, gh, printErr });
      const resolver = createBlockerResolver({ run: (args) => gh(args, { cwd: process.cwd() }) });
      const outcome = await claimUnblocked({
        queue,
        resolveDependency: (sourceRef) => resolver.resolve(sourceRef ?? "")
      });
      if (outcome.kind === "empty") {
        print(JSON.stringify({ kind: "claim", empty: true }));
        return 0;
      }
      if (outcome.kind === "all-blocked") {
        print(
          JSON.stringify({
            kind: "claim",
            allBlocked: true,
            entries: outcome.entries.map(({ envelope: e, verdict }) => {
              const entryEnvelope = e;
              return {
                text: entryEnvelope.text,
                source: entryEnvelope.source,
                sourceRef: entryEnvelope.sourceRef,
                verdict
              };
            })
          })
        );
        return 0;
      }
      const envelope = outcome.envelope;
      await queue.ack(envelope);
      try {
        await ledger.transition(envelope.source, envelope.sourceRef, "claimed");
      } catch {
      }
      print(
        JSON.stringify({
          kind: "claim",
          text: envelope.text,
          source: envelope.source,
          sourceRef: envelope.sourceRef
        })
      );
      return 0;
    }
    // ── forget ──────────────────────────────────────────────────────────────────
    // `conduct-ts engineer forget <sourceRef>`: drop the ledger entry so the issue
    // is re-capturable, and strip the `engineer:handled` label so poll sees it again.
    // An absent ref is reported (found:false) and is NOT an error.
    case "forget": {
      const { sourceRef } = dispatch;
      const engDir = engineerDir ?? resolveEngineerDir({});
      const ledger = createLedger(join14(engDir, "ledger.json"));
      const entry = await ledger.get(GITHUB_ISSUES_SOURCE, sourceRef);
      if (!entry) {
        print(JSON.stringify({ kind: "forget", sourceRef, found: false }));
        return 0;
      }
      await ledger.forget(GITHUB_ISSUES_SOURCE, sourceRef);
      const m = sourceRef.match(/^(.+)#(\d+)$/);
      if (m) {
        try {
          await gh(restRemoveLabelArgs(m[1], m[2], HANDLED_LABEL), { cwd: process.cwd() });
        } catch (err) {
          printErr(`engineer forget: label strip failed for ${sourceRef}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      print(JSON.stringify({ kind: "forget", sourceRef, found: true, removed: true }));
      return 0;
    }
    // ── migrate-issue-deps ────────────────────────────────────────────────────
    // `conduct-ts engineer migrate-issue-deps [--confirm]`: one-time prose→link
    // migration over the current repo's open issues. Scans, classifies prose
    // into deterministic edges + manual-review items, prints the full proposal,
    // and only WRITES anything when `--confirm` is passed — a bare run is a
    // pure dry-run (GET-checks only, zero POSTs; see createDependencyLinks).
    case "migrate-issue-deps": {
      const cwd = process.cwd();
      let nameWithOwner;
      try {
        const { stdout } = await gh(["repo", "view", "--json", "nameWithOwner"], { cwd });
        nameWithOwner = String(JSON.parse(stdout || "{}").nameWithOwner ?? "");
      } catch (err) {
        printErr(`engineer migrate-issue-deps: could not resolve repo (${err instanceof Error ? err.message : String(err)})`);
        return 1;
      }
      if (!nameWithOwner) {
        printErr("engineer migrate-issue-deps: could not resolve repo (no nameWithOwner)");
        return 1;
      }
      let issues;
      try {
        const { stdout } = await gh(["issue", "list", "--state", "open", "--json", "number,body", "--limit", "500"], {
          cwd
        });
        issues = JSON.parse(stdout || "[]");
      } catch (err) {
        printErr(`engineer migrate-issue-deps: could not list issues (${err instanceof Error ? err.message : String(err)})`);
        return 1;
      }
      const formattedIssues = issues.map((issue) => ({
        ref: `${nameWithOwner}#${issue.number}`,
        body: issue.body ?? ""
      }));
      const result = await runMigration({
        gh,
        issues: formattedIssues,
        confirm: async () => Promise.resolve(dispatch.confirm)
      });
      print(`migrate-issue-deps: proposal over ${nameWithOwner} (${issues.length} open issue(s))`);
      for (const proposed of result.proposed) {
        print(`  ${proposed.issue} blocked_by ${proposed.blockedBy}  [${proposed.kind}]`);
      }
      if (result.manualReview.length > 0) {
        print(`  ${result.manualReview.length} item(s) need manual review (not auto-proposed):`);
        for (const item of result.manualReview) {
          print(`    ${item.issue} \u2014 ${item.reason}: ${item.excerpt}`);
        }
      }
      if (!dispatch.confirm) {
        print("Dry run \u2014 no links written. Re-run with --confirm to apply.");
        return 0;
      }
      const created = result.created.length;
      const alreadyPresent = result.alreadyPresent.length;
      print(`migrate-issue-deps: ${created} link(s) created, ${alreadyPresent} already present.`);
      return 0;
    }
  }
}

// src/engine/memory-cli.ts
import { lstat as lstat3 } from "fs/promises";
import { join as join17, isAbsolute as isAbsolute2, resolve as resolvePath2 } from "path";
import { existsSync as existsSync4 } from "fs";

// src/engine/memory-store.ts
import { createHash } from "crypto";
import {
  mkdir as mkdir10,
  writeFile as writeFile10,
  appendFile,
  symlink,
  lstat,
  readlink,
  unlink as unlink2
} from "fs/promises";
import { join as join15 } from "path";
import { homedir as homedir2 } from "os";
import { execFile as execFileCb5 } from "child_process";
import { promisify as promisify5 } from "util";
var execFile3 = promisify5(execFileCb5);
async function gitOutput(args, cwd) {
  try {
    const { stdout } = await execFile3("git", args, { cwd });
    return stdout.trim();
  } catch {
    return "";
  }
}
async function stableIdentity(repoPath) {
  const originUrl = await gitOutput(["remote", "get-url", "origin"], repoPath);
  if (originUrl) {
    return originUrl;
  }
  const rawCommonDir = await gitOutput(["rev-parse", "--git-common-dir"], repoPath);
  if (rawCommonDir) {
    const absolute = rawCommonDir.startsWith("/") ? rawCommonDir : join15(repoPath, rawCommonDir);
    return absolute;
  }
  return repoPath;
}
var CATEGORIES = ["decisions", "patterns", "gotchas", "context"];
function resolveHome() {
  return process.env.HOME ?? process.env.USERPROFILE ?? homedir2();
}
async function projectKey(repoPath) {
  const identity = await stableIdentity(repoPath);
  return createHash("sha256").update(identity).digest("hex").slice(0, 24);
}
async function ensureMemoryStore(repoPath) {
  const home = resolveHome();
  const key = await projectKey(repoPath);
  const harnessDir = join15(home, ".ai-conductor", "memory", key, "harness");
  await mkdir10(harnessDir, { recursive: true });
  for (const cat of CATEGORIES) {
    await mkdir10(join15(harnessDir, cat), { recursive: true });
  }
  const indexPath = join15(harnessDir, "index.md");
  let indexExists = false;
  try {
    await lstat(indexPath);
    indexExists = true;
  } catch {
  }
  if (!indexExists) {
    await writeFile10(indexPath, "# Memory Index\n\n", "utf8");
  }
  const memPath = join15(repoPath, ".memory");
  let createLink = true;
  try {
    const stat2 = await lstat(memPath);
    if (stat2.isSymbolicLink()) {
      const currentTarget = await readlink(memPath);
      if (currentTarget === harnessDir) {
        createLink = false;
      } else {
        await unlink2(memPath);
      }
    } else {
      createLink = false;
    }
  } catch {
  }
  if (createLink) {
    await symlink(harnessDir, memPath);
  }
}
var CATEGORY_SET = new Set(CATEGORIES);

// src/engine/memory-migrate.ts
import { appendFile as appendFile2, copyFile, lstat as lstat2, mkdir as mkdir11, readdir as readdir5, readFile as readFile8, rename as rename3, rm, symlink as symlink2, unlink as unlink3 } from "fs/promises";
import { join as join16 } from "path";
import { homedir as homedir3 } from "os";
function resolveHome2() {
  return process.env.HOME ?? process.env.USERPROFILE ?? homedir3();
}
async function getCanonicalHarnessDir(repoPath) {
  const home = resolveHome2();
  const key = await projectKey(repoPath);
  return join16(home, ".ai-conductor", "memory", key, "harness");
}
async function copyMissing(srcDir, destDir) {
  const entries = await readdir5(srcDir, { withFileTypes: true }).catch(() => []);
  const copied = [];
  if (entries.length === 0) return copied;
  await mkdir11(destDir, { recursive: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const destFile = join16(destDir, entry.name);
    const exists = await lstat2(destFile).then(() => true).catch(() => false);
    if (!exists) {
      await copyFile(join16(srcDir, entry.name), destFile);
      copied.push(entry.name);
    }
  }
  return copied;
}
async function copyAll(srcDir, destDir) {
  const entries = await readdir5(srcDir, { withFileTypes: true }).catch(() => []);
  await mkdir11(destDir, { recursive: true });
  for (const entry of entries) {
    const src = join16(srcDir, entry.name);
    const dest = join16(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyAll(src, dest);
    } else if (entry.isFile()) {
      await copyFile(src, dest);
    }
  }
}
async function mergeIndexLines(localMemPath, canonicalHarness, newlyAddedByCategory) {
  const categories = Object.keys(newlyAddedByCategory);
  if (categories.length === 0) return;
  const canonicalIndexPath = join16(canonicalHarness, "index.md");
  const localIndexPath = join16(localMemPath, "index.md");
  const localContent = await readFile8(localIndexPath, "utf8").catch(() => "");
  const canonicalContent = await readFile8(canonicalIndexPath, "utf8").catch(() => "");
  const linesToAppend = [];
  for (const category of categories) {
    const names = newlyAddedByCategory[category] ?? [];
    for (const name of names) {
      const entryPath = `${category}/${name}`;
      if (canonicalContent.includes(entryPath)) continue;
      const localLine = localContent.split("\n").find((l) => l.includes(entryPath));
      if (localLine && localLine.trim()) {
        linesToAppend.push(localLine);
      } else {
        const stem2 = name.replace(/\.md$/, "");
        linesToAppend.push(`- [${stem2}](${entryPath})`);
      }
    }
  }
  if (linesToAppend.length > 0) {
    await appendFile2(canonicalIndexPath, linesToAppend.join("\n") + "\n", "utf8");
  }
}
async function ensureBackupIgnored(repoPath) {
  const giPath = join16(repoPath, ".gitignore");
  const existing = await readFile8(giPath, "utf8").catch(() => "");
  const has = existing.split("\n").some((l) => l.trim() === ".memory*.bak/");
  if (!has) {
    const sep = existing && !existing.endsWith("\n") ? "\n" : "";
    await appendFile2(giPath, `${sep}.memory*.bak/
`, "utf8");
  }
}
async function runDefaultVerify(localMemPath, canonicalHarness) {
  for (const cat of CATEGORIES) {
    const srcDir = join16(localMemPath, cat);
    const destDir = join16(canonicalHarness, cat);
    const files = await readdir5(srcDir).catch(() => []);
    for (const f of files) {
      const exists = await lstat2(join16(destDir, f)).then(() => true).catch(() => false);
      if (!exists) return false;
    }
  }
  return true;
}
async function migrateMemory(repoPath, _opts = {}) {
  const memPath = join16(repoPath, ".memory");
  const backupPath = join16(repoPath, ".memory.pre-migrate.bak");
  if (_opts.reverse) {
    const backupStat = await lstat2(backupPath).catch(() => null);
    if (!backupStat) {
      throw new Error(
        "Cannot reverse: no backup found at .memory.pre-migrate.bak \u2014 migration may not have been performed yet."
      );
    }
    const currentStat = await lstat2(memPath).catch(() => null);
    if (currentStat) {
      if (currentStat.isSymbolicLink()) {
        await unlink3(memPath);
      } else {
        await rm(memPath, { recursive: true, force: true });
      }
    }
    await copyAll(backupPath, memPath);
    return;
  }
  const memStat = await lstat2(memPath).catch(() => null);
  if (!memStat) {
    const backupStat = await lstat2(backupPath).catch(() => null);
    if (backupStat) {
      const canonicalHarness2 = await getCanonicalHarnessDir(repoPath);
      await mkdir11(canonicalHarness2, { recursive: true });
      for (const cat of CATEGORIES) {
        await copyMissing(join16(backupPath, cat), join16(canonicalHarness2, cat));
      }
      const tmpLink2 = memPath + ".tmp-link";
      await rm(tmpLink2, { force: true, recursive: true }).catch(() => {
      });
      await symlink2(canonicalHarness2, memPath);
      return;
    }
    return;
  }
  if (memStat.isSymbolicLink()) {
    return;
  }
  const backupExists = await lstat2(backupPath).then(() => true).catch(() => false);
  if (!backupExists) {
    await copyAll(memPath, backupPath);
  }
  await ensureBackupIgnored(repoPath);
  const canonicalHarness = await getCanonicalHarnessDir(repoPath);
  await mkdir11(canonicalHarness, { recursive: true });
  const newlyAddedByCategory = {};
  for (const cat of CATEGORIES) {
    const srcDir = join16(memPath, cat);
    const destDir = join16(canonicalHarness, cat);
    const copied = await copyMissing(srcDir, destDir);
    if (copied.length > 0) {
      newlyAddedByCategory[cat] = copied;
    }
  }
  await mergeIndexLines(memPath, canonicalHarness, newlyAddedByCategory);
  const verified = _opts.verify ? await _opts.verify() : await runDefaultVerify(memPath, canonicalHarness);
  if (!verified) {
    throw new Error(
      "Migration verification failed: not all entries could be confirmed in the canonical store. Original .memory/ is intact \u2014 no swap performed."
    );
  }
  if (_opts.failBeforeSwap) {
    await _opts.failBeforeSwap();
  }
  const tmpLink = memPath + ".tmp-link";
  await rm(tmpLink, { force: true, recursive: true }).catch(() => {
  });
  await symlink2(canonicalHarness, tmpLink);
  await rm(memPath, { recursive: true, force: true });
  if (_opts.failDuringSwap) {
    await _opts.failDuringSwap();
  }
  await rename3(tmpLink, memPath);
}

// src/engine/memory-cli.ts
function detectMemoryCommand(argv) {
  const args = argv.slice(2);
  if (args[0] === "memory" && args[1] === "setup") {
    const dir = args[2] && !args[2].startsWith("-") ? args[2] : void 0;
    return { kind: "setup", dir };
  }
  return null;
}
async function dispatchMemorySetup(d) {
  const rawDir = d.dir ?? process.cwd();
  const projectDir = isAbsolute2(rawDir) ? rawDir : resolvePath2(process.cwd(), rawDir);
  if (!existsSync4(projectDir)) {
    console.error(`conduct memory setup: directory does not exist: ${projectDir}`);
    return 1;
  }
  const memPath = join17(projectDir, ".memory");
  try {
    let memStat = null;
    try {
      memStat = await lstat3(memPath);
    } catch {
    }
    if (memStat && !memStat.isSymbolicLink()) {
      console.log(`conduct memory setup: migrating existing .memory/ in ${projectDir}`);
      await migrateMemory(projectDir);
    } else {
      await ensureMemoryStore(projectDir);
    }
    console.log(`conduct memory setup: .memory/ is ready at ${projectDir}`);
    return 0;
  } catch (e) {
    console.error(
      `conduct memory setup: failed: ${e instanceof Error ? e.message : String(e)}`
    );
    return 1;
  }
}

// src/engine/render-cli.ts
import { readFile as readFile9 } from "fs/promises";
function stemOf(file) {
  const base = file.split("/").pop() ?? file;
  return base.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]/g, "_") || "diagram";
}
function detectRenderCommand(argv) {
  const sub = argv[2];
  if (sub !== "render-diagrams") return null;
  const rest = argv.slice(3);
  const check = rest.includes("--check");
  const files = rest.filter((a) => a && !a.startsWith("-"));
  if (files.length === 0) return { kind: "guide" };
  return { kind: check ? "check" : "render", files };
}
async function dispatchRender(cmd, projectRoot) {
  if (cmd.kind === "guide") {
    console.error(
      "conduct render-diagrams <file.md>...\n  Renders the Mermaid diagrams in the given Markdown file(s) using your\n  configured mermaid_renderer preset (see ~/.ai-conductor/config.yml).\nconduct render-diagrams --check <file.md>...\n  Parse-checks every Mermaid block (does NOT open them) and exits non-zero\n  if any block fails to render. Skips with exit 0 when mmdc is unavailable."
    );
    return 1;
  }
  if (cmd.kind === "check") {
    return dispatchCheck(cmd.files);
  }
  const configResult = await loadMergedConfig(projectRoot);
  const config = configResult.ok ? configResult.config.mermaid_renderer : void 0;
  const deps = defaultRenderDeps((m) => console.error(m));
  for (const file of cmd.files) {
    try {
      const content = await readFile9(file, "utf-8");
      const result = await renderDiagramsForFile(file, content, config, deps);
      if (result.notice) console.error(`  ${file}: ${result.notice}`);
    } catch (e) {
      console.error(`  ${file}: could not read (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  return 0;
}
async function dispatchCheck(files) {
  const deps = defaultRenderDeps((m) => console.error(m));
  let toolMissing = false;
  let hadErrors = false;
  for (const file of files) {
    let content;
    try {
      content = await readFile9(file, "utf-8");
    } catch (e) {
      console.error(`  \u2717 ${file}: could not read (${e instanceof Error ? e.message : String(e)})`);
      hadErrors = true;
      continue;
    }
    const result = await checkDiagramsForFile(content, deps, stemOf(file));
    switch (result.status) {
      case "no-diagrams":
        break;
      case "ok":
        console.error(`  \u2713 ${file}: ${result.total} diagram(s) render`);
        break;
      case "tool-missing":
        toolMissing = true;
        break;
      case "errors":
        hadErrors = true;
        for (const f of result.failures) {
          const firstLine = f.error.split("\n").find((l) => /error/i.test(l)) ?? f.error.split("\n")[0];
          console.error(`  \u2717 ${file}: diagram ${f.index} failed \u2014 ${firstLine.trim()}`);
        }
        break;
    }
  }
  if (hadErrors) return 1;
  if (toolMissing) {
    console.error(
      "  \u26A0 mmdc not found \u2014 skipped diagram syntax check (install @mermaid-js/mermaid-cli to validate)."
    );
  }
  return 0;
}

// src/engine/shipped-record-cli.ts
import { readFile as readFile10 } from "fs/promises";
import { join as join18, isAbsolute as isAbsolute3 } from "path";
import { execa as execa3 } from "execa";
function detectShippedRecordCommand(argv) {
  if (argv[2] !== "shipped-record") return null;
  const rest = argv.slice(3);
  const flag = (name) => {
    const i = rest.indexOf(name);
    if (i === -1) return void 0;
    const v = rest[i + 1];
    return v && !v.startsWith("--") ? v : void 0;
  };
  const slug = flag("--slug");
  const pr = flag("--pr");
  if (!slug || !pr) return { kind: "guide" };
  return { kind: "write", slug, pr };
}
async function readStoriesBytes(cwd, slug, planContent) {
  const m = planContent.match(/^\s*\*\*Stories:\*\*\s*`?([^\s`]+)`?/im);
  if (m && !isAbsolute3(m[1])) {
    try {
      return await readFile10(join18(cwd, m[1]));
    } catch {
    }
  }
  try {
    return await readFile10(join18(cwd, ".docs/stories", `${slug}.md`));
  } catch {
    return null;
  }
}
async function dispatchShippedRecord(cmd, cwd) {
  if (cmd.kind === "guide") {
    console.error(
      "conduct shipped-record --slug <slug> --pr <url|local>\n  Writes and commits .docs/shipped/<slug>.md on the CURRENT branch, hashing\n  .docs/plans/<slug>.md (+ its stories file) so the daemon never re-dispatches\n  this spec once the branch merges. Run by /finish on the implementation\n  branch before its final push; pass --pr local for merge-local finishes."
    );
    return 1;
  }
  const { slug, pr } = cmd;
  try {
    const planBytes = await readFile10(join18(cwd, ".docs/plans", `${slug}.md`));
    const storiesBytes = await readStoriesBytes(cwd, slug, planBytes.toString("utf-8"));
    const { digest } = specHash(planBytes, storiesBytes);
    const relPath = join18(".docs", "shipped", `${slug}.md`);
    await writeShippedRecord(
      join18(cwd, relPath),
      renderShippedRecord({ slug, specHash: digest, pr, shipped: todayIso() })
    );
    await execa3("git", ["add", relPath], { cwd });
    const staged = await execa3("git", ["diff", "--cached", "--quiet", "--", relPath], {
      cwd,
      reject: false
    });
    if (staged.exitCode !== 0) {
      await execa3("git", ["commit", "-m", `shipped record: ${slug}`, "--no-verify"], { cwd });
      console.error(`  \u2713 shipped record committed: ${relPath}`);
    } else {
      console.error(`  \u2713 shipped record already committed: ${relPath}`);
    }
    return 0;
  } catch (err) {
    console.error(
      `shipped-record write failed \u2014 dedup degraded to local cache for ${slug}: ${err instanceof Error ? err.message : String(err)}`
    );
    return 0;
  }
}
function todayIso() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}

// src/engine/daemon-observe-cli.ts
import { stat } from "fs/promises";
import { basename as basename4 } from "path";

// src/engine/engine-store.ts
import { readdir as readdir6, lstat as lstat4, readlink as readlink2, readFile as readFile11, symlink as symlink3, rename as rename4, unlink as unlink4, rm as rm2 } from "fs/promises";
import { createHash as createHash2, randomBytes as randomBytes2 } from "crypto";
import { join as join19, basename as basename3 } from "path";
var VERSION_ID_PATTERN = /^\d{8}T\d{6}Z-[0-9a-f]{12}$/;
function isEngineVersionId(name) {
  return VERSION_ID_PATTERN.test(name);
}
var DEFAULT_MIN_AGE_MSECS = 24 * 60 * 60 * 1e3;

// src/engine/daemon-observe-cli.ts
var VERSION_UNKNOWN = "version-unknown";
function versionIdFromEngineDir(engineDir) {
  if (!engineDir) return VERSION_UNKNOWN;
  const id = basename4(engineDir);
  return isEngineVersionId(id) ? id : VERSION_UNKNOWN;
}
async function defaultSessionProbe(repoPath) {
  try {
    return await hasSession(sessionNameForRepo(repoPath));
  } catch {
    return false;
  }
}
async function defaultPaneDeadProbe(repoPath) {
  try {
    return await isPaneDead(sessionNameForRepo(repoPath));
  } catch {
    return false;
  }
}
function computeState(liveness, paused) {
  switch (liveness) {
    case "running":
      return paused ? "paused" : "running";
    case "stale":
      return paused ? "paused_dead" : "stale";
    case "stopped":
      return paused ? "paused" : "stopped";
    case "path-missing":
      return "path-missing";
    case "unreadable":
      return "unreadable";
  }
}
async function computeStatusRow(record, kill, hasSessionProbe, paneDeadProbe) {
  const probe = hasSessionProbe ?? defaultSessionProbe;
  const paneDeadCheck = paneDeadProbe ?? defaultPaneDeadProbe;
  const base = { name: record.name, path: record.path };
  try {
    try {
      await stat(record.path);
    } catch (err) {
      const code = err.code;
      if (code === "ENOENT") {
        return {
          ...base,
          liveness: "path-missing",
          state: computeState("path-missing", false),
          sessionPresent: false,
          versionId: VERSION_UNKNOWN
        };
      }
      return {
        ...base,
        liveness: "unreadable",
        state: computeState("unreadable", false),
        detail: err.message,
        sessionPresent: false,
        versionId: VERSION_UNKNOWN
      };
    }
    const rec = await readPidRecord(record.path);
    let liveness;
    let pid;
    let startedAt;
    const versionId = versionIdFromEngineDir(rec?.engineDir);
    if (rec === null) {
      liveness = "stopped";
    } else {
      pid = rec.pid;
      startedAt = rec.startedAt;
      liveness = isLive(rec.pid, kill) ? "running" : "stale";
    }
    const sessionPresent = await probe(record.path);
    const paneDead = sessionPresent ? await paneDeadCheck(record.path) : false;
    const paused = await isPaused(record.path);
    const pauseMeta = paused ? await readPauseMetadata(record.path) : void 0;
    const restartPending = await readRestartPending(record.path) ?? void 0;
    let state = computeState(liveness, paused);
    if (paneDead) state = "dead-pane";
    if (restartPending) state = "restart-pending";
    const row = {
      ...base,
      liveness,
      state,
      pid,
      startedAt,
      sessionPresent,
      paneDead,
      versionId,
      ...pauseMeta?.pausedAt !== void 0 ? { pausedAt: pauseMeta.pausedAt } : {},
      ...pauseMeta?.pausedBy !== void 0 ? { pausedBy: pauseMeta.pausedBy } : {},
      ...restartPending !== void 0 ? { restartPending } : {}
    };
    const tail = await tailDaemonLog(record.path, 1);
    if (tail.status === "ok" && tail.lines.length > 0) {
      row.lastActivity = tail.lines[tail.lines.length - 1];
      row.lastActivityAt = tail.mtime.toISOString();
    } else if (tail.status === "unreadable") {
      row.detail = `log unreadable: ${tail.error}`;
    }
    return row;
  } catch (err) {
    return {
      ...base,
      liveness: "unreadable",
      state: computeState("unreadable", false),
      detail: err.message,
      sessionPresent: false,
      versionId: VERSION_UNKNOWN
    };
  }
}
var STATE_BADGE = {
  running: "\u25CF running",
  paused: "\u23F8 paused",
  paused_dead: "\u23F8 paused (process dead)",
  stale: "\u25CB stale",
  stopped: "\xB7 stopped",
  "path-missing": "\u2717 path missing",
  unreadable: "\u2717 unreadable",
  "restart-pending": "\u23F3 restart-pending",
  "dead-pane": "\u26A0 session-up/process-dead"
};
function formatStatusRow(row) {
  const badge = row.state === "restart-pending" && row.restartPending?.blockingSlug ? `\u23F3 restart-pending (waiting on ${row.restartPending.blockingSlug})` : STATE_BADGE[row.state];
  const parts = [`${badge}  ${row.name}`, `  ${row.path}`];
  if (row.pid !== void 0) parts.push(`  pid ${row.pid}`);
  if (row.startedAt) parts.push(`  since ${row.startedAt}`);
  parts.push(`  version:${row.versionId}`);
  if (row.pausedAt) {
    const by = row.pausedBy ? ` by ${row.pausedBy}` : "";
    parts.push(`  paused ${row.pausedAt}${by}`);
  }
  if (row.lastActivity) {
    const at = row.lastActivityAt ? ` (${row.lastActivityAt})` : "";
    parts.push(`  last${at}: ${row.lastActivity}`);
  }
  parts.push(`  session:${row.sessionPresent ? "up" : "down"}`);
  if (row.detail) parts.push(`  \u2014 ${row.detail}`);
  return parts.join("");
}
async function runDaemonStatus(deps = {}) {
  const out = deps.out ?? ((l) => console.log(l));
  const registryPath2 = deps.registryPath ?? resolveRegistryPath();
  let records;
  try {
    records = await readRegistry(registryPath2);
  } catch (err) {
    out(`Could not read registry at ${registryPath2}: ${err.message}`);
    return { code: 1, rows: [] };
  }
  if (records.length === 0) {
    out("No projects registered. Use `conduct register [path]` to add one.");
    return { code: 0, rows: [] };
  }
  const rows = [];
  for (const record of records) {
    const row = await computeStatusRow(record, deps.kill);
    rows.push(row);
    out(formatStatusRow(row));
  }
  return { code: 0, rows };
}
async function printRepoTail(repoPath, lines, out, withHeader) {
  if (withHeader) out(`==> ${repoPath} <==`);
  const res = await tailDaemonLog(repoPath, lines);
  if (res.status === "missing") {
    out(`(no daemon log yet for ${repoPath})`);
    return 0;
  }
  if (res.status === "unreadable") {
    out(`Could not read daemon log for ${repoPath}: ${res.error}`);
    return 1;
  }
  for (const line of res.lines) out(line);
  return 0;
}
async function runDaemonLogs(args, deps = {}) {
  const out = deps.out ?? ((l) => console.log(l));
  const cwd = deps.cwd ?? process.cwd();
  const lines = args.lines ?? 0;
  if (args.all) {
    const registryPath2 = deps.registryPath ?? resolveRegistryPath();
    let records;
    try {
      records = await readRegistry(registryPath2);
    } catch (err) {
      out(`Could not read registry at ${registryPath2}: ${err.message}`);
      return 1;
    }
    if (records.length === 0) {
      out("No projects registered.");
      return 0;
    }
    if (args.follow) {
      out("--follow is not supported with --all; showing a static snapshot.");
    }
    let code2 = 0;
    for (const record of records) {
      code2 = await printRepoTail(record.path, lines, out, true) || code2;
    }
    return code2;
  }
  const target = args.repo ?? cwd;
  const code = await printRepoTail(target, lines, out, false);
  if (args.follow) {
    let startOffset = 0;
    try {
      startOffset = (await stat(daemonLogPath(target))).size;
    } catch {
      startOffset = 0;
    }
    const handle = followDaemonLog(target, (l) => out(l), { startOffset });
    const stop = deps.untilStop ?? waitForSigint();
    await stop;
    handle.stop();
  }
  return code;
}
function waitForSigint() {
  return new Promise((resolve) => {
    process.once("SIGINT", () => resolve());
  });
}
function detectDaemonObserveCommand(argv) {
  const args = argv.slice(2);
  if (args[0] !== "daemon") return null;
  const sub = args[1];
  if (sub === "status") return { kind: "status" };
  if (sub === "logs") {
    const rest = args.slice(2);
    let repo;
    let follow = false;
    let all = false;
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === "--follow" || a === "-f") follow = true;
      else if (a === "--all") all = true;
      else if (a === "--repo") {
        repo = rest[i + 1];
        i++;
      } else if (a.startsWith("--repo=")) {
        repo = a.slice("--repo=".length);
      }
    }
    return { kind: "logs", repo, follow, all };
  }
  return null;
}
async function dispatchDaemonObserve(d) {
  if (d.kind === "status") {
    const { code } = await runDaemonStatus();
    return code;
  }
  return runDaemonLogs({ repo: d.repo, follow: d.follow, all: d.all });
}

// src/engine/otel/otel-config.ts
import { join as join20 } from "path";
var VALID_EXPORTERS = ["otlp", "file"];
var DEFAULT_FILE = "otel.jsonl";
function resolveOtelConfig(config, pipelineDir) {
  const otel = config.otel;
  if (!otel) {
    return { enabled: false };
  }
  const { exporter, endpoint, file, protocol } = otel;
  if (!VALID_EXPORTERS.includes(exporter)) {
    return {
      enabled: false,
      error: `Unknown otel exporter '${exporter}'. Valid options: ${VALID_EXPORTERS.join(", ")}.`
    };
  }
  if (exporter === "otlp") {
    if (!endpoint) {
      return {
        enabled: false,
        error: "otel exporter='otlp' requires an 'endpoint' URL (e.g. http://localhost:4318). No endpoint was provided."
      };
    }
    return {
      enabled: true,
      exporter: "otlp",
      endpoint,
      ...protocol ? { protocol } : {}
    };
  }
  const resolvedFile = file ?? join20(pipelineDir, DEFAULT_FILE);
  return {
    enabled: true,
    exporter: "file",
    file: resolvedFile
  };
}

// src/engine/otel/otel-visualizer.ts
import {
  BasicTracerProvider,
  BatchSpanProcessor
} from "@opentelemetry/sdk-trace-base";
import {
  MeterProvider,
  PeriodicExportingMetricReader
} from "@opentelemetry/sdk-metrics";

// node_modules/@opentelemetry/core/build/esm/ExportResult.js
var ExportResultCode;
(function(ExportResultCode2) {
  ExportResultCode2[ExportResultCode2["SUCCESS"] = 0] = "SUCCESS";
  ExportResultCode2[ExportResultCode2["FAILED"] = 1] = "FAILED";
})(ExportResultCode || (ExportResultCode = {}));

// src/engine/otel/resource.ts
import { readFileSync as readFileSync2 } from "fs";
import { join as join21 } from "path";
import { v4 as uuidv4 } from "uuid";
import { Resource } from "@opentelemetry/resources";
var SERVICE_NAME = "ai-conductor";
function buildResource(ctx) {
  const runId = ctx.runId ?? resolveRunId(ctx.pipelineDir);
  const feature = ctx.feature ?? "unknown";
  const project = ctx.project ?? "unknown";
  return new Resource({
    "service.name": SERVICE_NAME,
    "conductor.run.id": runId,
    "conductor.feature": feature,
    "conductor.project": project
  });
}
function resolveRunId(pipelineDir) {
  try {
    const content = readFileSync2(join21(pipelineDir, "conduct-session-id"), "utf-8");
    const trimmed = content.trim();
    if (trimmed.length > 0) return trimmed;
  } catch {
  }
  return uuidv4();
}

// src/engine/otel/transport.ts
import { appendFileSync as appendFileSync2, mkdirSync as mkdirSync2 } from "fs";
import { dirname as dirname4 } from "path";
import { OTLPTraceExporter as OTLPHttpTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter as OTLPHttpMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter as OTLPGrpcTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { OTLPMetricExporter as OTLPGrpcMetricExporter } from "@opentelemetry/exporter-metrics-otlp-grpc";
import { JsonTraceSerializer, JsonMetricsSerializer } from "@opentelemetry/otlp-transformer";
function buildExporters(config) {
  if (config.exporter === "otlp") {
    const url = config.endpoint;
    if (config.protocol === "grpc") {
      return {
        spanExporter: new OTLPGrpcTraceExporter({ url }),
        metricExporter: new OTLPGrpcMetricExporter({ url })
      };
    }
    return {
      spanExporter: new OTLPHttpTraceExporter({ url: `${url.replace(/\/$/, "")}/v1/traces` }),
      metricExporter: new OTLPHttpMetricExporter({ url: `${url.replace(/\/$/, "")}/v1/metrics` })
    };
  }
  const filePath = config.file;
  return {
    spanExporter: new FileSpanExporter(filePath),
    metricExporter: new FileMetricExporter(filePath)
  };
}
var FileSpanExporter = class {
  constructor(filePath) {
    this.filePath = filePath;
  }
  filePath;
  dirEnsured = false;
  export(spans, resultCallback) {
    try {
      if (spans.length === 0) {
        resultCallback({ code: ExportResultCode.SUCCESS });
        return;
      }
      this.ensureDir();
      const bytes = JsonTraceSerializer.serializeRequest(spans);
      if (bytes) {
        appendFileSync2(this.filePath, Buffer.from(bytes).toString("utf-8") + "\n", "utf-8");
      }
      resultCallback({ code: ExportResultCode.SUCCESS });
    } catch (err) {
      resultCallback({
        code: ExportResultCode.FAILED,
        message: err instanceof Error ? err.message : String(err)
      });
    }
  }
  async shutdown() {
  }
  async forceFlush() {
  }
  ensureDir() {
    if (!this.dirEnsured) {
      mkdirSync2(dirname4(this.filePath), { recursive: true });
      this.dirEnsured = true;
    }
  }
};
var FileMetricExporter = class {
  constructor(filePath) {
    this.filePath = filePath;
  }
  filePath;
  dirEnsured = false;
  export(metrics, resultCallback) {
    try {
      if (metrics.scopeMetrics.length === 0) {
        resultCallback({ code: ExportResultCode.SUCCESS });
        return;
      }
      this.ensureDir();
      const bytes = JsonMetricsSerializer.serializeRequest(metrics);
      if (bytes) {
        appendFileSync2(this.filePath, Buffer.from(bytes).toString("utf-8") + "\n", "utf-8");
      }
      resultCallback({ code: ExportResultCode.SUCCESS });
    } catch (err) {
      resultCallback({
        code: ExportResultCode.FAILED,
        message: err instanceof Error ? err.message : String(err)
      });
    }
  }
  async forceFlush() {
  }
  async shutdown() {
  }
  ensureDir() {
    if (!this.dirEnsured) {
      mkdirSync2(dirname4(this.filePath), { recursive: true });
      this.dirEnsured = true;
    }
  }
};

// src/engine/otel/span-manager.ts
import {
  SpanStatusCode,
  trace,
  ROOT_CONTEXT
} from "@opentelemetry/api";
var SpanManager = class {
  constructor(tracer, onWarning, callbacks) {
    this.tracer = tracer;
    this.onWarning = onWarning;
    this.callbacks = callbacks;
  }
  tracer;
  onWarning;
  callbacks;
  runSpan = null;
  runCtx = ROOT_CONTEXT;
  runStarted = false;
  openSteps = /* @__PURE__ */ new Map();
  // ── Run span ───────────────────────────────────────────────────────────────
  ensureRunSpan() {
    if (!this.runStarted) {
      this.runStarted = true;
      this.runSpan = this.tracer.startSpan("conductor.run");
      this.runCtx = trace.setSpan(ROOT_CONTEXT, this.runSpan);
    }
  }
  // ── Step-span open/close ───────────────────────────────────────────────────
  onStepStarted(event) {
    this.ensureRunSpan();
    if (this.openSteps.has(event.step)) {
      const old = this.openSteps.get(event.step);
      old.span.setStatus({ code: SpanStatusCode.OK });
      old.span.end();
      this.openSteps.delete(event.step);
    }
    const span = this.tracer.startSpan(event.step, {}, this.runCtx);
    span.setAttribute("conductor.step", event.step);
    span.setAttribute("conductor.step.index", event.index);
    this.openSteps.set(event.step, {
      span,
      index: event.index,
      retryCount: 0,
      startTimeMs: Date.now()
    });
  }
  onStepCompleted(event) {
    const state = this.openSteps.get(event.step);
    if (!state) {
      this.warn(
        `step_completed for '${event.step}' received but no open span exists \u2014 ignoring`
      );
      return;
    }
    const durationMs = Date.now() - state.startTimeMs;
    state.span.setAttribute("conductor.step.status", event.status);
    state.span.setAttribute("conductor.retry.count", state.retryCount);
    state.span.setStatus({ code: SpanStatusCode.OK });
    state.span.end();
    this.openSteps.delete(event.step);
    this.callbacks?.onStepClose?.(event.step, durationMs, state.retryCount);
  }
  onStepFailed(event) {
    const state = this.openSteps.get(event.step);
    if (!state) {
      this.warn(
        `step_failed for '${event.step}' received but no open span exists \u2014 ignoring`
      );
      return;
    }
    const durationMs = Date.now() - state.startTimeMs;
    state.span.setAttribute("conductor.step.status", "failed");
    state.span.setAttribute("conductor.retry.count", event.retryCount);
    state.span.setStatus({ code: SpanStatusCode.ERROR, message: event.error });
    state.span.end();
    this.openSteps.delete(event.step);
    this.callbacks?.onStepClose?.(event.step, durationMs, event.retryCount);
  }
  // ── Span events ────────────────────────────────────────────────────────────
  onStepRetry(event) {
    const state = this.openSteps.get(event.step);
    if (!state) {
      return;
    }
    state.retryCount++;
    state.span.addEvent("retry", {
      attempt: event.attempt,
      maxAttempts: event.maxAttempts,
      reason: event.reason
    });
  }
  onGateVerdict(event) {
    this.ensureRunSpan();
    const state = this.openSteps.get(event.step);
    const targetSpan = state?.span ?? this.runSpan;
    if (!targetSpan) {
      this.warn(`gate_verdict for '${event.step}' received but no span available \u2014 dropping`);
      return;
    }
    const attrs = { satisfied: event.satisfied };
    if (event.reason !== void 0) attrs.reason = event.reason;
    targetSpan.addEvent("gate_verdict", attrs);
  }
  onKickback(event) {
    this.ensureRunSpan();
    const fromState = this.openSteps.get(event.from);
    const targetSpan = fromState?.span ?? this.runSpan;
    if (!targetSpan) {
      this.warn(`kickback from '${event.from}' received but no span available \u2014 dropping`);
      return;
    }
    const attrs = {
      from: event.from,
      to: event.to,
      count: event.count
    };
    if (event.evidence !== void 0) attrs.evidence = event.evidence;
    targetSpan.addEvent("kickback", attrs);
  }
  // ── Run completion ─────────────────────────────────────────────────────────
  onFeatureComplete(_event) {
    for (const [step, state] of this.openSteps) {
      state.span.setAttribute("conductor.step.status", "done");
      state.span.setAttribute("conductor.retry.count", state.retryCount);
      state.span.setStatus({ code: SpanStatusCode.OK });
      state.span.end();
      const durationMs = Date.now() - state.startTimeMs;
      this.callbacks?.onStepClose?.(step, durationMs, state.retryCount);
    }
    this.openSteps.clear();
    if (this.runSpan) {
      this.runSpan.setStatus({ code: SpanStatusCode.OK });
      this.runSpan.end();
      this.runSpan = null;
    }
  }
  // ── Flush / force-close (FR-9) ─────────────────────────────────────────────
  /**
   * Force-close all open spans as ERROR with `conductor.incomplete=true`.
   * Called by OtelVisualizer.stop() before flushing the batch processor.
   */
  forceCloseAll() {
    const steps = [...this.openSteps.entries()].reverse();
    for (const [step, state] of steps) {
      state.span.setAttribute("conductor.incomplete", true);
      state.span.setAttribute("conductor.step.status", "incomplete");
      state.span.setAttribute("conductor.retry.count", state.retryCount);
      state.span.setStatus({ code: SpanStatusCode.ERROR, message: "incomplete: process terminated" });
      state.span.end();
      const durationMs = Date.now() - state.startTimeMs;
      this.callbacks?.onStepClose?.(step, durationMs, state.retryCount);
    }
    this.openSteps.clear();
    if (this.runSpan) {
      this.runSpan.setStatus({ code: SpanStatusCode.OK });
      this.runSpan.end();
      this.runSpan = null;
    }
  }
  // ── Internal helpers ───────────────────────────────────────────────────────
  warn(msg) {
    this.onWarning?.(msg);
  }
};

// src/engine/otel/metrics.ts
var MetricsRecorder = class {
  durationHistogram;
  retriesCounter;
  tokensCounter;
  constructor(meter) {
    this.durationHistogram = meter.createHistogram("conductor.step.duration", {
      description: "Duration of conductor steps in milliseconds",
      unit: "ms"
    });
    this.retriesCounter = meter.createCounter("conductor.step.retries", {
      description: "Number of retries per conductor step"
    });
    this.tokensCounter = meter.createCounter("conductor.step.tokens", {
      description: "Token usage per conductor step"
    });
  }
  /**
   * Record metrics when a step closes (completed or failed).
   *
   * @param step       - Step name (for metric attributes).
   * @param durationMs - Wall-clock duration from step_started to close (milliseconds).
   * @param retryCount - Number of retries for this step execution.
   * @param tokenUsage - Optional token usage from step_completed; absent → skip.
   */
  onStepClose(step, durationMs, retryCount, tokenUsage) {
    this.durationHistogram.record(durationMs, { step });
    if (retryCount > 0) {
      this.retriesCounter.add(retryCount, { step });
    }
    if (tokenUsage !== void 0 && tokenUsage !== null) {
      this.recordTokens(step, tokenUsage);
    }
  }
  recordTokens(step, usage) {
    const entries = Object.entries(usage);
    for (const [kind, value] of entries) {
      if (typeof value === "number" && !Number.isNaN(value)) {
        this.tokensCounter.add(value, { step, kind });
      }
    }
  }
};

// src/engine/otel/otel-visualizer.ts
var WarnOnceSpanExporter = class {
  constructor(inner, warnOnce) {
    this.inner = inner;
    this.warnOnce = warnOnce;
  }
  inner;
  warnOnce;
  export(spans, resultCallback) {
    this.inner.export(spans, (result) => {
      if (result.code !== ExportResultCode.SUCCESS) {
        this.warnOnce(
          `[otel] span export failed: ${result.error?.message ?? "unknown error"}`
        );
      }
      resultCallback(result);
    });
  }
  async shutdown() {
    return this.inner.shutdown();
  }
};
var WarnOnceMetricExporter = class {
  inner;
  warnOnce;
  selectAggregationTemporality;
  selectAggregation;
  constructor(inner, warnOnce) {
    this.inner = inner;
    this.warnOnce = warnOnce;
    if (inner.selectAggregationTemporality) {
      this.selectAggregationTemporality = inner.selectAggregationTemporality.bind(inner);
    }
    if (inner.selectAggregation) {
      this.selectAggregation = inner.selectAggregation.bind(inner);
    }
  }
  export(metrics, resultCallback) {
    this.inner.export(metrics, (result) => {
      if (result.code !== ExportResultCode.SUCCESS) {
        this.warnOnce(
          `[otel] metric export failed: ${result.error?.message ?? "unknown error"}`
        );
      }
      resultCallback(result);
    });
  }
  async forceFlush() {
    const inner = this.inner;
    if (typeof inner.forceFlush === "function") {
      return inner.forceFlush();
    }
  }
  async shutdown() {
    return this.inner.shutdown();
  }
};
var METRIC_EXPORT_INTERVAL_MS = 6e4;
var EXPORT_TIMEOUT_MS = 5e3;
var OtelVisualizer = class {
  name = "otel";
  tracerProvider;
  meterProvider;
  spanManager;
  metricsRecorder;
  /**
   * Bounded warning emitter (FR-8). When ctx.onWarning is provided, this is a
   * once-wrapper shared by both the exporter callback path AND the stop() flush
   * catch path — so exactly ONE warning fires regardless of how the failure
   * manifests.
   */
  warnOnce;
  /** Registered handlers, kept for potential off() cleanup (currently no off needed). */
  emitter = null;
  // ── T21: idempotent stop + SIGINT/SIGTERM flush handlers ──────────────────
  /**
   * Promise from the first stop() call. Set on first invocation; all subsequent
   * calls return the same promise (idempotent — no double-flush, no deadlock).
   */
  stopPromise = null;
  /**
   * Bound signal handler. Stored so it can be unregistered in stop() without
   * leaking across OtelVisualizer instances or test runs.
   */
  sigHandler = null;
  constructor(config, ctx) {
    const resource = buildResource({
      pipelineDir: ctx.pipelineDir ?? "",
      runId: ctx.runId,
      feature: ctx.feature,
      project: ctx.project
    });
    let spanExporter;
    let metricExporter;
    if (ctx.spanExporter && ctx.metricExporter) {
      spanExporter = ctx.spanExporter;
      metricExporter = ctx.metricExporter;
    } else if (config.enabled) {
      const built = buildExporters(config);
      spanExporter = ctx.spanExporter ?? built.spanExporter;
      metricExporter = ctx.metricExporter ?? built.metricExporter;
    } else {
      throw new Error(
        "[OtelVisualizer] constructed with disabled config \u2014 only construct when resolveOtelConfig().enabled is true (FR-1 gate in index.ts)"
      );
    }
    if (ctx.onWarning) {
      let warnEmitted = false;
      this.warnOnce = (msg) => {
        if (!warnEmitted) {
          warnEmitted = true;
          ctx.onWarning(msg);
        }
      };
      spanExporter = new WarnOnceSpanExporter(spanExporter, this.warnOnce);
      metricExporter = new WarnOnceMetricExporter(metricExporter, this.warnOnce);
    }
    const exportTimeoutMillis = ctx.exportTimeoutMillis ?? EXPORT_TIMEOUT_MS;
    this.tracerProvider = new BasicTracerProvider({ resource });
    this.tracerProvider.addSpanProcessor(
      new BatchSpanProcessor(spanExporter, { exportTimeoutMillis })
    );
    const reader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: METRIC_EXPORT_INTERVAL_MS
    });
    this.meterProvider = new MeterProvider({ resource, readers: [reader] });
    const tracer = this.tracerProvider.getTracer("conductor", "1.0.0");
    const meter = this.meterProvider.getMeter("conductor", "1.0.0");
    this.metricsRecorder = new MetricsRecorder(meter);
    this.spanManager = new SpanManager(tracer, ctx.onWarning, {
      onStepClose: (step, durationMs, retryCount) => {
        const tokenUsage = this.pendingTokenUsage.get(step);
        this.pendingTokenUsage.delete(step);
        this.metricsRecorder.onStepClose(step, durationMs, retryCount, tokenUsage);
      }
    });
  }
  /**
   * Stash tokenUsage from step_completed events so the SpanManager's onStepClose
   * callback can pass it to MetricsRecorder. Keyed by step name.
   */
  pendingTokenUsage = /* @__PURE__ */ new Map();
  // ── VisualizerPlugin contract ──────────────────────────────────────────────
  /**
   * Attach to the emitter. Called once at run start.
   * All handlers return void (synchronous) to keep emit() non-blocking (R1).
   *
   * Also registers SIGINT/SIGTERM handlers that call stop() on process termination
   * (T21). Handlers are unregistered in stop() to prevent leaks across instances.
   */
  start(emitter) {
    this.emitter = emitter;
    const eventTypes = [
      "step_started",
      "step_completed",
      "step_failed",
      "step_retry",
      "gate_verdict",
      "kickback",
      "feature_complete"
    ];
    for (const type of eventTypes) {
      emitter.on(type, (event) => {
        this.handleEvent(event);
      });
    }
    this.sigHandler = () => {
      void this.stop();
    };
    process.on("SIGINT", this.sigHandler);
    process.on("SIGTERM", this.sigHandler);
  }
  /**
   * Force-close open spans (FR-9), flush the batch processors, and optionally
   * shut down providers. Idempotent — safe to call from signal handlers or
   * directly; subsequent calls return the same promise from the first invocation
   * (not a new wrapper — callers can use reference equality to detect re-entry).
   *
   * NOTE: We intentionally call forceFlush() ONLY and NOT shutdown() here.
   * BatchSpanProcessor.shutdown() calls exporter.shutdown() which clears
   * InMemorySpanExporter._finishedSpans — making spans unreadable after stop().
   * Callers (tests, acceptance spec) read spans AFTER stop(), so we must not
   * clear the exporter. In production (OTLP / file), the process exits after
   * stop() so the providers are GC'd naturally.
   */
  stop() {
    if (this.stopPromise !== null) return this.stopPromise;
    if (this.sigHandler !== null) {
      process.off("SIGINT", this.sigHandler);
      process.off("SIGTERM", this.sigHandler);
      this.sigHandler = null;
    }
    this.stopPromise = this._doStop();
    return this.stopPromise;
  }
  /** Internal flush implementation. Only ever called once (guarded by stopPromise). */
  async _doStop() {
    this.spanManager.forceCloseAll();
    try {
      await this.tracerProvider.forceFlush();
    } catch (err) {
      this.warnOnce?.(
        `[otel] tracer flush error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    try {
      await this.meterProvider.forceFlush();
    } catch (err) {
      this.warnOnce?.(
        `[otel] meter flush error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  // ── Internal event dispatch (synchronous, O(1)) ────────────────────────────
  handleEvent(event) {
    switch (event.type) {
      case "step_started":
        this.spanManager.onStepStarted(event);
        break;
      case "step_completed":
        this.pendingTokenUsage.set(event.step, event.tokenUsage);
        this.spanManager.onStepCompleted(event);
        this.pendingTokenUsage.delete(event.step);
        break;
      case "step_failed":
        this.pendingTokenUsage.set(event.step, void 0);
        this.spanManager.onStepFailed(event);
        this.pendingTokenUsage.delete(event.step);
        break;
      case "step_retry":
        this.spanManager.onStepRetry(event);
        break;
      case "gate_verdict":
        this.spanManager.onGateVerdict(event);
        break;
      case "kickback":
        this.spanManager.onKickback(event);
        break;
      case "feature_complete":
        this.spanManager.onFeatureComplete(event);
        break;
    }
  }
};

// src/index.ts
function deriveMode(opts) {
  if (opts.auto && opts.interactive) {
    console.error("Error: --auto and --interactive are mutually exclusive");
    process.exit(1);
  }
  return opts.auto ? "auto" : opts.interactive ? "interactive" : "default";
}
var __dirname = dirname5(fileURLToPath(import.meta.url));
function buildVisualizers(visualizers, emitter) {
  for (const vis of visualizers) {
    vis.start(emitter);
  }
  return visualizers;
}
async function stopVisualizers(visualizers) {
  await Promise.all(
    visualizers.map(
      (vis) => vis.stop().catch((err) => {
        console.warn(
          `[otel] visualizer '${vis.name}' stop() error: ${err instanceof Error ? err.message : String(err)}`
        );
      })
    )
  );
}
function createOtelVisualizer(resolved, ctx, events) {
  const onWarning = (msg) => {
    void events.emit({ type: "renderer_error", rendererName: "otel", error: msg });
  };
  try {
    return new OtelVisualizer(resolved, { ...ctx, onWarning });
  } catch (err) {
    onWarning(err instanceof Error ? err.message : String(err));
    return null;
  }
}
async function readHarnessVersion() {
  const candidates = [
    join22(process.cwd(), "VERSION"),
    join22(__dirname, "..", "..", "..", "VERSION"),
    join22(__dirname, "..", "..", "..", "..", "VERSION")
  ];
  for (const path of candidates) {
    try {
      const raw = await readFile12(path, "utf-8");
      const v = raw.trim();
      if (/^\d+\.\d+\.\d+/.test(v)) return v;
    } catch {
    }
  }
  return "0.0.0";
}
async function cleanupMergedWorktrees(projectRoot, promptHost) {
  const features = await scanResumableFeatures(projectRoot);
  const manager = new WorktreeManager(projectRoot);
  let cleaned = 0;
  for (const feature of features) {
    let prUrl;
    try {
      const stateResult = await readState(join22(feature.path, "conduct-state.json"));
      if (stateResult.ok) {
        prUrl = stateResult.value.pr_url;
      }
    } catch {
    }
    if (!prUrl) {
      try {
        const stateResult = await readState(join22(feature.path, ".pipeline", "conduct-state.json"));
        if (stateResult.ok) {
          prUrl = stateResult.value.pr_url;
        }
      } catch {
      }
    }
    if (!prUrl) continue;
    const merged = await checkPrMerged(prUrl);
    if (merged) {
      const answer = await promptHost.ask(`  Remove merged worktree "${feature.name}"? [y/n]: `);
      if (answer === "y") {
        await manager.cleanup(feature.name);
        console.log(`  Removed: ${feature.name}`);
        cleaned++;
      }
    }
  }
  if (cleaned === 0) {
    console.log("  No merged worktrees to clean up.");
  } else {
    console.log(`  Cleaned up ${cleaned} merged worktree${cleaned === 1 ? "" : "s"}.`);
  }
}
async function main() {
  const memoryCmd = detectMemoryCommand(process.argv);
  if (memoryCmd) {
    const code = await dispatchMemorySetup(memoryCmd);
    process.exit(code);
  }
  const registryCmd = detectRegistryCommand(process.argv);
  if (registryCmd) {
    const code = await dispatchRegistry(registryCmd);
    process.exit(code);
  }
  const engineerCmd = detectEngineerCommand(process.argv);
  if (engineerCmd) {
    const code = await dispatchEngineer(engineerCmd);
    process.exit(code);
  }
  const renderCmd = detectRenderCommand(process.argv);
  if (renderCmd) {
    const code = await dispatchRender(renderCmd, process.cwd());
    process.exit(code);
  }
  const shippedRecordCmd = detectShippedRecordCommand(process.argv);
  if (shippedRecordCmd) {
    const code = await dispatchShippedRecord(shippedRecordCmd, process.cwd());
    process.exit(code);
  }
  if (process.argv[2] === "daemon" && process.argv.slice(3).some((a) => a === "--help" || a === "-h")) {
    process.stdout.write(renderDaemonHelp());
    process.exit(0);
  }
  const daemonObserveCmd = detectDaemonObserveCommand(process.argv);
  if (daemonObserveCmd) {
    const code = await dispatchDaemonObserve(daemonObserveCmd);
    process.exit(code);
  }
  const daemonSupervisorCmd = detectDaemonSupervisorCommand(process.argv);
  if (daemonSupervisorCmd) {
    const { dispatchDaemonSupervisor } = await import("./daemon-supervisor-cli-UI66H4D5.js");
    const code = await dispatchDaemonSupervisor(daemonSupervisorCmd);
    process.exit(code);
  }
  const unknownDaemonSub = detectUnknownDaemonSubcommand(process.argv);
  if (unknownDaemonSub) {
    console.error(`conduct daemon: unknown subcommand '${unknownDaemonSub}'.
`);
    process.stderr.write(renderDaemonHelp());
    process.exit(1);
  }
  const daemonCmd = detectDaemonCommand(process.argv);
  if (daemonCmd) {
    const { runDaemonMode } = await import("./daemon-cli-TTZREVO6.js");
    await runDaemonMode({ projectRoot: process.cwd(), ...daemonCmd });
    process.exit(0);
  }
  if (process.argv.slice(2).some((a) => a === "--help" || a === "-h")) {
    process.stdout.write(renderFullHelp());
    process.exit(0);
  }
  const { isInline, rest } = detectInline(process.argv);
  if (!isInline) {
    console.error(
      'conduct: the inline SDLC pipeline now runs under the `inline` subcommand.\n  Run:        conduct inline "<feature description>"\n  State ops:  conduct inline --status | --resume | --report | --diagnose | \u2026\n  All commands: conduct --help'
    );
    process.exit(1);
  }
  let opts;
  try {
    opts = parseArgs(rest);
  } catch (e) {
    console.error(e instanceof Error ? e.message : "Failed to parse arguments");
    process.exit(1);
  }
  let projectRoot = process.cwd();
  let pipelineDir = join22(projectRoot, ".pipeline");
  let stateFilePath = join22(pipelineDir, "conduct-state.json");
  await mkdir12(pipelineDir, { recursive: true });
  await ensureClaudeSettings(projectRoot);
  const liveRegion = createLiveRegion();
  const configResult = await loadConfig(projectRoot);
  const config = configResult.ok ? configResult.config : void 0;
  if (configResult.ok && configResult.warnings.length > 0) {
    for (const w of configResult.warnings) {
      console.warn(`\u26A0 Config warning: ${w}`);
    }
  }
  if (!configResult.ok && configResult.error.type !== "missing") {
    console.error(`Config error: ${configResult.error.message}`);
    process.exit(1);
  }
  const mergedResult = await loadMergedConfig(projectRoot);
  const mermaidCfg = mergedResult.ok ? mergedResult.config.mermaid_renderer : void 0;
  const renderDeps = defaultRenderDeps((m) => console.error(m));
  const promptHost = new TerminalPromptHost(liveRegion, {
    renderDiagrams: async (file, content) => {
      const result = await renderDiagramsForFile(file, content, mermaidCfg, renderDeps);
      return result.notice;
    }
  });
  if (opts.report) {
    const eventsLogPath2 = join22(pipelineDir, "events.jsonl");
    try {
      const report = renderReport(eventsLogPath2);
      console.log(report);
    } catch (err) {
      if (err instanceof ReportError) {
        console.error(err.message);
        process.exit(1);
      }
      throw err;
    }
    process.exit(0);
  }
  if (opts.status) {
    const stateResult = await readState(stateFilePath);
    const state = stateResult.ok ? stateResult.value : {};
    console.log("\n## Conductor State\n");
    console.log(JSON.stringify(state, null, 2));
    return;
  }
  if (opts.reset) {
    await writeState(stateFilePath, {});
    console.log("State cleared.");
    return;
  }
  if (opts.cleanup) {
    console.log("\nChecking for merged worktrees...\n");
    await cleanupMergedWorktrees(projectRoot, promptHost);
    return;
  }
  if (opts.diagnose) {
    let targetWorktree = projectRoot;
    let targetFeatureDesc;
    if (opts.featureDesc) {
      const detection = await detectAutoResume(projectRoot, opts.featureDesc);
      if (detection.kind === "complete" || detection.kind === "resume") {
        targetWorktree = detection.worktreePath;
        targetFeatureDesc = opts.featureDesc;
      } else if (detection.kind === "none") {
        console.log(
          `No conductor state found for "${opts.featureDesc}" \u2014 nothing to diagnose.`
        );
        return;
      } else {
        console.error(
          `
Orphaned conductor state in ${detection.stateFilePath}.
  Run conduct-ts --reset to clear, or recreate the worktree.
`
        );
        process.exit(1);
      }
    }
    const verification = await verifyCompleteState(targetWorktree);
    if (verification.ok) {
      console.log(
        `
State OK: ${targetFeatureDesc ? `"${targetFeatureDesc}"` : "this worktree"} has consistent SHIP-phase evidence.
`
      );
      return;
    }
    console.error(formatGapReport(targetFeatureDesc, targetWorktree, verification));
    console.error(
      `  To roll back feature_status and resume at the first failing step, run:
    conduct-ts ${targetFeatureDesc ? `"${targetFeatureDesc}"` : ""}
  \u2026and answer "y" at the recovery prompt. To inspect raw state: conduct-ts --status
`
    );
    process.exit(1);
  }
  if (opts.featureDesc && !opts.resume && !opts.fresh && !opts.from && !opts.step) {
    const detection = await detectAutoResume(projectRoot, opts.featureDesc);
    if (detection.kind === "resume") {
      projectRoot = detection.worktreePath;
      pipelineDir = join22(projectRoot, ".pipeline");
      stateFilePath = detection.stateFilePath;
      await mkdir12(pipelineDir, { recursive: true });
      opts.resume = true;
      const position = detection.lastStep ? `${detection.stepIndex}/${detection.totalSteps} (after ${detection.lastStep})` : "step 1";
      console.log(
        `
Resuming "${opts.featureDesc}" at ${position}. Use --fresh to start over.
`
      );
    } else if (detection.kind === "complete") {
      const verification = await verifyCompleteState(detection.worktreePath);
      if (!verification.ok) {
        console.warn(formatGapReport(opts.featureDesc, detection.worktreePath, verification));
        const answer = await promptHost.ask(
          "Roll back feature_status and resume at the first failing step? [Y/n/q]: "
        );
        if (answer === "n" || answer === "q") {
          console.log(
            `
No changes made. To inspect: conduct-ts --status
  To start over: conduct-ts --fresh ${opts.featureDesc ? `"${opts.featureDesc}"` : ""}
`
          );
          return;
        }
        projectRoot = detection.worktreePath;
        pipelineDir = join22(projectRoot, ".pipeline");
        stateFilePath = join22(pipelineDir, "conduct-state.json");
        await mkdir12(pipelineDir, { recursive: true });
        const r = await readState(stateFilePath);
        const fixed = r.ok ? { ...r.value } : {};
        delete fixed.feature_status;
        for (const step of verification.failedSteps) {
          fixed[step] = "pending";
        }
        await writeState(stateFilePath, fixed);
        opts.resume = true;
        console.log(
          `
Rolled back. Resuming "${opts.featureDesc}" at ${verification.failedSteps[0]}.
`
        );
      } else {
        const answer = await promptHost.ask(
          `Feature "${opts.featureDesc}" is already marked complete (${detection.worktreePath}). Start over? [y/N]: `
        );
        if (answer !== "y") {
          console.log("Exiting. Use --fresh to force a new start.");
          return;
        }
        projectRoot = detection.worktreePath;
        pipelineDir = join22(projectRoot, ".pipeline");
        stateFilePath = join22(pipelineDir, "conduct-state.json");
        await mkdir12(pipelineDir, { recursive: true });
        await writeState(stateFilePath, {});
      }
    } else if (detection.kind === "orphaned-state") {
      console.error(
        `
Orphaned conductor state in ${detection.stateFilePath}.

  Feature "${detection.featureDesc ?? opts.featureDesc}" was marked past the worktree step,
  but no worktree exists at any of:
` + detection.expectedLocations.map((p) => `    - ${p}`).join("\n") + `

  Either:
    1) Recreate the missing worktree at one of those paths, OR
    2) Run \`conduct-ts --reset\` from this directory to clear the stale state
       (you'll lose the recorded progress, but the actual code on the
       feature branch \u2014 if it exists \u2014 is untouched).

  Refusing to continue here so artifacts don't land on the wrong branch.
`
      );
      process.exit(1);
    }
  }
  if (opts.resume && !opts.featureDesc) {
    await cleanupMergedWorktrees(projectRoot, promptHost);
    const features = await scanResumableFeatures(projectRoot);
    if (features.length === 0) {
      console.error("No active features found in .worktrees/");
      process.exit(1);
    }
    let selected = selectFeature(features, void 0);
    if (!selected) {
      console.log(`
${formatResumeMenu(features)}
`);
      const answer = await promptHost.ask(`Choose feature [0-${features.length}]: `);
      const choice = parseInt(answer, 10);
      selected = selectFeature(features, isNaN(choice) ? 0 : choice);
      if (!selected) {
        console.log("Cancelled.");
        return;
      }
    }
    projectRoot = selected.path;
    pipelineDir = join22(projectRoot, ".pipeline");
    stateFilePath = join22(pipelineDir, "conduct-state.json");
    await mkdir12(pipelineDir, { recursive: true });
    const legacyStatePath = join22(selected.path, "conduct-state.json");
    try {
      const legacyState = await readFile12(legacyStatePath, "utf-8");
      if (legacyState.trim()) {
        const pipelineResult = await readState(stateFilePath);
        if (!pipelineResult.ok || Object.keys(pipelineResult.value).length === 0) {
          stateFilePath = legacyStatePath;
        }
      }
    } catch {
    }
    if (!opts.featureDesc && selected.featureDesc) {
      opts.featureDesc = selected.featureDesc;
    }
  }
  let sessionId;
  const sessionIdPath = join22(pipelineDir, "conduct-session-id");
  try {
    const persisted = await readFile12(sessionIdPath, "utf-8");
    sessionId = persisted.trim() || uuidv42();
  } catch {
    sessionId = uuidv42();
  }
  const events = new ConductorEventEmitter();
  const mode = deriveMode(opts);
  const renderEvent = createRenderer({
    stateFilePath,
    featureDesc: opts.featureDesc,
    steps: ALL_STEPS,
    readStateFn: readState,
    notifyFn: sendNotification,
    projectRoot,
    liveRegion,
    viewMode: opts.view,
    tailLines: opts.tailLines
  });
  const registry = new PluginRegistry();
  const globalPluginsDir = join22(process.env.HOME || "", ".ai-conductor", "plugins");
  const projectPluginsDir = join22(projectRoot, ".ai-conductor", "plugins");
  await discoverPlugins(globalPluginsDir, projectPluginsDir, registry);
  registerBuiltins(registry, events, renderEvent);
  registry.markInitialized();
  const provider = registry.get(
    "llm_provider",
    config?.llm_provider ?? "claude"
  );
  const subscriber = registry.get(
    "ui_renderer",
    config?.ui_renderer ?? "terminal"
  );
  subscriber.start();
  const eventsLogPath = join22(pipelineDir, "events.jsonl");
  const persister = new EventPersister(eventsLogPath, events);
  persister.start();
  const visualizerList = [];
  const otelResolved = resolveOtelConfig(config ?? {}, pipelineDir);
  if (otelResolved.enabled) {
    const otelVis = createOtelVisualizer(
      otelResolved,
      {
        pipelineDir,
        feature: opts.featureDesc ?? "unknown",
        project: projectRoot
      },
      events
    );
    if (otelVis) {
      visualizerList.push(otelVis);
    }
  }
  buildVisualizers(visualizerList, events);
  const stepRunner = new DefaultStepRunner(provider, sessionId, projectRoot, {
    featureDesc: opts.featureDesc,
    pipelineDir,
    stepCooldown: opts.cooldown,
    config,
    modelOverride: opts.model,
    mode
  });
  const harnessVersion = await readHarnessVersion();
  const interactivePrompt = mode === "auto" ? void 0 : async ({ days, commits }) => {
    console.log(
      `
\u26A0 Last assessment was ${days} days / ${commits} commits ago (thresholds: ${config?.assess?.stale_after_days ?? 90} days / ${config?.assess?.stale_after_commits ?? 500} commits).`
    );
    const answer = await promptHost.confirm("Re-run /assess now?", false);
    return answer;
  };
  const prelude = await runProjectPrelude(
    projectRoot,
    provider,
    sessionId,
    config ?? {},
    { harnessVersion, onAssessStalePrompt: interactivePrompt }
  );
  if (prelude.bootstrapExecuted) {
    console.log(
      `[prelude] bootstrap ran (${prelude.bootstrapReason}): ${prelude.bootstrapSuccess ? "ok" : "failed"}`
    );
  }
  if (prelude.assessExecuted) {
    console.log(
      `[prelude] assess ran (${prelude.assessReason}): ${prelude.assessSuccess ? "ok" : "failed"}`
    );
  }
  const conductor = new Conductor({
    stateFilePath,
    stepRunner,
    events,
    resume: opts.resume,
    fromStep: opts.from,
    mode,
    config,
    projectRoot,
    featureDesc: opts.featureDesc,
    verifyArtifacts: true,
    onCheckpoint: (s) => promptHost.checkpoint(s),
    onNavigate: (steps) => promptHost.navigate(steps),
    onReviewArtifacts: (s, files) => promptHost.reviewArtifacts(s, files),
    onRecovery: (s, isGating) => promptHost.recovery(s, isGating),
    onComplexityAssessment: (r) => promptHost.complexityAssessment(r)
  });
  await conductor.run();
  persister.stop();
  await stopVisualizers(visualizerList);
  subscriber.stop();
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("Fatal:", err.message ?? err);
    process.exit(1);
  });
}
export {
  PluginLoadError,
  PluginManifestError,
  PluginNotFoundError,
  PluginRegistryError,
  PluginVersionError,
  VALID_PLUGIN_KINDS,
  buildVisualizers,
  createOtelVisualizer,
  createProgram,
  deriveMode,
  parseArgs,
  stopVisualizers
};
//# sourceMappingURL=index.js.map