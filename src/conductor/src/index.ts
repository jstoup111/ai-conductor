export * from './types/index.js';
export { parseArgs, createProgram, type CLIOptions } from './cli.js';

import { join } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { Conductor } from './engine/conductor.js';
import type { CheckpointResponse, NavigableStep, ArtifactReviewResult } from './engine/conductor.js';
import { DefaultStepRunner } from './engine/step-runners.js';
import { ClaudeProvider } from './execution/claude-provider.js';
import { ConductorEventEmitter } from './ui/events.js';
import { TerminalSubscriber } from './ui/subscriber.js';
import { loadConfig } from './engine/config.js';
import { readState, writeState } from './engine/state.js';
import { parseArgs, type CLIOptions } from './cli.js';
import type { StepName, RunMode, ConductorEvent, RecoveryOption, ComplexityTier } from './types/index.js';
import { getRecoveryOptions } from './engine/recovery.js';
import * as readline from 'node:readline';
import { sendNotification } from './ui/notifications.js';

// --- Terminal UI rendering ---

const STATUS_ICONS: Record<string, string> = {
  done: '✓',
  in_progress: '▶',
  pending: '⬚',
  skipped: '→',
  stale: '⚠',
  failed: '✗',
};

function renderEvent(event: ConductorEvent): void {
  switch (event.type) {
    case 'step_started':
      console.log(`  ${STATUS_ICONS.in_progress} ${event.step} — running...`);
      break;
    case 'step_completed':
      console.log(`  ${STATUS_ICONS.done} ${event.step} — done`);
      sendNotification('Conductor', `Step completed: ${event.step}`).catch(() => {});
      break;
    case 'step_failed':
      console.log(`  ${STATUS_ICONS.failed} ${event.step} — FAILED`);
      if (event.error) {
        console.log(`\n--- Step output ---\n${event.error}\n--- End output ---\n`);
      }
      sendNotification('Conductor', `Step failed: ${event.step}`).catch(() => {});
      break;
    case 'tier_skip':
      console.log(`  ${STATUS_ICONS.skipped} ${event.step} — skipped (tier ${event.tier})`);
      break;
    case 'config_skip':
      console.log(`  ${STATUS_ICONS.skipped} ${event.step} — skipped (disabled via config)`);
      break;
    case 'gate_blocked':
      console.log(`  ${STATUS_ICONS.failed} ${event.step} — BLOCKED: ${event.reason}`);
      break;
    case 'checkpoint_reached':
      console.log(`\n── Checkpoint: ${event.step} complete ──`);
      break;
    case 'feature_complete':
      console.log(`\n✓ Feature complete.${event.prUrl ? ` PR: ${event.prUrl}` : ''}`);
      sendNotification('Conductor', 'Pipeline complete!').catch(() => {});
      break;
    case 'dashboard_refresh':
      // silent
      break;
  }
}

// --- Interactive prompts ---

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function handleCheckpoint(_step: StepName): Promise<CheckpointResponse> {
  while (true) {
    const answer = await prompt('  c = continue, b = go back, q = quit [c/b/q]: ');
    if (answer === 'c') return 'continue';
    if (answer === 'b') return 'back';
    if (answer === 'q') return 'quit';
    console.log('  Invalid choice. Enter c, b, or q.');
  }
}

async function handleNavigate(steps: NavigableStep[]): Promise<StepName | null> {
  if (steps.length === 0) {
    console.log('  No completed steps to navigate to.');
    return null;
  }
  console.log('\nGo back to which step?');
  steps.forEach((s, i) => {
    console.log(`   ${i + 1}) ${s.label.padEnd(25)} [${s.status}]    ${s.phase}`);
  });
  console.log('   0) Cancel');

  const answer = await prompt(`Choice [0-${steps.length}]: `);
  const idx = parseInt(answer, 10);
  if (isNaN(idx) || idx === 0) return null;
  if (idx >= 1 && idx <= steps.length) return steps[idx - 1].name;
  return null;
}

// --- Artifact review ---

async function handleReviewArtifacts(step: StepName, files: string[]): Promise<ArtifactReviewResult> {
  const total = files.length;
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Artifact review: ${step} (${total} file${total === 1 ? '' : 's'})`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const basename = file.split('/').pop() ?? file;

    console.log(`━━━ [${i + 1}/${total}] ${basename} ━━━\n`);

    // Display file contents
    try {
      const content = await readFile(file, 'utf-8');
      console.log(content);
    } catch {
      console.log(`  (could not read file: ${file})`);
    }

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    while (true) {
      const answer = await prompt('  [enter=approve / r=reject / s=skip remaining]: ');
      if (answer === '' || answer === 'a') {
        console.log(`  ✓ Approved: ${basename}`);
        break;
      }
      if (answer === 'r') {
        console.log(`  ✗ Rejected: ${basename}`);
        console.log(`  Returning to ${step} to address issues...\n`);
        return 'rejected';
      }
      if (answer === 's') {
        console.log(`  Skipping review of remaining artifacts.`);
        return 'approved';
      }
      console.log('  Invalid choice. Press enter to approve, r to reject, s to skip.');
    }
  }

  console.log(`\n  ✓ All ${step} artifacts approved.\n`);
  return 'approved';
}

// --- Recovery menu ---

const RECOVERY_LABELS: Record<RecoveryOption, string> = {
  retry: '[r]etry',
  interactive: '[i]nteractive fix',
  back: '[b]ack',
  skip: '[s]kip',
  quit: '[q]uit',
};

const RECOVERY_KEYS: Record<string, RecoveryOption> = {
  r: 'retry',
  i: 'interactive',
  b: 'back',
  s: 'skip',
  q: 'quit',
};

async function handleRecovery(step: StepName, isGating: boolean): Promise<RecoveryOption> {
  const options = getRecoveryOptions(step, isGating);
  const labels = options.map((o) => RECOVERY_LABELS[o]).join(' / ');
  const keys = options.map((o) => o[0]).join('/');

  while (true) {
    const answer = await prompt(`  ${labels} [${keys}]: `);
    const action = RECOVERY_KEYS[answer];
    if (action && options.includes(action)) return action;
    console.log(`  Invalid choice. Enter one of: ${keys}`);
  }
}

// --- Complexity assessment ---

async function handleComplexityAssessment(): Promise<ComplexityTier> {
  console.log(`\nComplexity signals:`);
  console.log(`  Models/tables:         ?`);
  console.log(`  External integrations: ?`);
  console.log(`  Auth/authz:            ?`);
  console.log(`  State machines:        ?`);
  console.log(`  Estimated stories:     ?`);
  console.log();

  while (true) {
    const answer = await prompt('  Based on the brainstorm, classify complexity [S/M/L]: ');
    if (answer === 's') return 'S';
    if (answer === 'm') return 'M';
    if (answer === 'l') return 'L';
    console.log('  Invalid choice. Enter s, m, or l.');
  }
}

// --- Main ---

async function main(): Promise<void> {
  let opts: CLIOptions;
  try {
    opts = parseArgs(process.argv);
  } catch (e: unknown) {
    console.error(e instanceof Error ? e.message : 'Failed to parse arguments');
    process.exit(1);
  }

  const projectRoot = process.cwd();
  const pipelineDir = join(projectRoot, '.pipeline');
  const stateFilePath = join(pipelineDir, 'conduct-state.json');

  // Ensure .pipeline/ exists
  await mkdir(pipelineDir, { recursive: true });

  // Load config (optional — conductor works without it)
  const configResult = await loadConfig(projectRoot);
  const config = configResult.ok ? configResult.config : undefined;
  if (configResult.ok && configResult.warnings.length > 0) {
    for (const w of configResult.warnings) {
      console.warn(`⚠ Config warning: ${w}`);
    }
  }
  if (!configResult.ok && configResult.error.type !== 'missing') {
    console.error(`Config error: ${configResult.error.message}`);
    process.exit(1);
  }

  // Handle --status: show state and exit
  if (opts.status) {
    const stateResult = await readState(stateFilePath);
    const state = stateResult.ok ? stateResult.value : {};
    console.log('\n## Conductor State\n');
    console.log(JSON.stringify(state, null, 2));
    return;
  }

  // Handle --reset: clear state and exit
  if (opts.reset) {
    await writeState(stateFilePath, {});
    console.log('State cleared.');
    return;
  }

  // Set up conductor — reuse persisted session ID if resuming
  let sessionId: string;
  const sessionIdPath = join(pipelineDir, 'conduct-session-id');
  try {
    const persisted = await readFile(sessionIdPath, 'utf-8');
    sessionId = persisted.trim() || uuidv4();
  } catch {
    sessionId = uuidv4();
  }

  const events = new ConductorEventEmitter();
  const provider = new ClaudeProvider();
  const stepRunner = new DefaultStepRunner(provider, sessionId, projectRoot, {
    featureDesc: opts.featureDesc,
    pipelineDir,
    stepCooldown: opts.cooldown,
  });

  // Set up terminal UI
  const subscriber = new TerminalSubscriber(events, renderEvent);
  subscriber.start();

  // Store feature description in state if provided
  if (opts.featureDesc) {
    const stateResult = await readState(stateFilePath);
    const state = stateResult.ok ? stateResult.value : {};
    if (!state.feature_desc) {
      state.feature_desc = opts.featureDesc;
      await writeState(stateFilePath, state);
    }
  }

  const mode: RunMode = opts.auto ? 'auto' : 'default';

  console.log(`\n## Conductor: ${opts.featureDesc ?? '(resuming)'}\n`);

  const conductor = new Conductor({
    stateFilePath,
    stepRunner,
    events,
    resume: opts.resume,
    fromStep: opts.from as StepName | undefined,
    mode,
    config,
    projectRoot,
    onCheckpoint: handleCheckpoint,
    onNavigate: handleNavigate,
    onReviewArtifacts: handleReviewArtifacts,
    onRecovery: handleRecovery,
    onComplexityAssessment: handleComplexityAssessment,
  });

  await conductor.run();

  subscriber.stop();
}

main().catch((err) => {
  console.error('Fatal:', err.message ?? err);
  process.exit(1);
});
