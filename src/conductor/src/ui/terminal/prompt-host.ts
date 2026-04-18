import { readFile } from 'node:fs/promises';
import * as readline from 'node:readline';
import type {
  StepName,
  ComplexityTier,
  RecoveryOption,
  RecoveryContext,
} from '../../types/index.js';
import type {
  CheckpointResponse,
  NavigableStep,
  ArtifactReviewResult,
} from '../../engine/conductor.js';
import { getRecoveryOptions } from '../../engine/recovery.js';
import type { LiveRegion } from '../live-region.js';
import type { UIPromptHost } from '../types.js';

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

export interface TerminalPromptHostOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  log?: (...args: unknown[]) => void;
  readFileFn?: (path: string) => Promise<string>;
}

/**
 * Reference terminal implementation of UIPromptHost. Wraps Node's readline
 * around the shared LiveRegion so dashboard rendering and user prompts don't
 * fight for the terminal. A web or IPC implementation would replace this
 * class without touching the engine.
 */
export class TerminalPromptHost implements UIPromptHost {
  private region: LiveRegion;
  private input: NodeJS.ReadableStream;
  private output: NodeJS.WritableStream;
  private log: (...args: unknown[]) => void;
  private readFileFn: (path: string) => Promise<string>;

  constructor(region: LiveRegion, opts: TerminalPromptHostOptions = {}) {
    this.region = region;
    this.input = opts.input ?? process.stdin;
    this.output = opts.output ?? process.stdout;
    this.log = opts.log ?? ((...args) => console.log(...args));
    this.readFileFn = opts.readFileFn ?? ((p) => readFile(p, 'utf-8'));
  }

  async ask(question: string): Promise<string> {
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

  async confirm(question: string, defaultValue = false): Promise<boolean> {
    const hint = defaultValue ? '[Y/n]' : '[y/N]';
    const answer = await this.ask(`${question} ${hint} `);
    if (answer === '') return defaultValue;
    return answer === 'y' || answer === 'yes';
  }

  async checkpoint(_step: StepName): Promise<CheckpointResponse> {
    while (true) {
      const answer = await this.ask('  c = continue, b = go back, q = quit [c/b/q]: ');
      if (answer === 'c') return 'continue';
      if (answer === 'b') return 'back';
      if (answer === 'q') return 'quit';
      this.log('  Invalid choice. Enter c, b, or q.');
    }
  }

  async navigate(steps: NavigableStep[]): Promise<StepName | null> {
    if (steps.length === 0) {
      this.log('  No completed steps to navigate to.');
      return null;
    }
    this.log('\nGo back to which step?');
    steps.forEach((s, i) => {
      this.log(`   ${i + 1}) ${s.label.padEnd(25)} [${s.status}]    ${s.phase}`);
    });
    this.log('   0) Cancel');

    const answer = await this.ask(`Choice [0-${steps.length}]: `);
    const idx = parseInt(answer, 10);
    if (isNaN(idx) || idx === 0) return null;
    if (idx >= 1 && idx <= steps.length) return steps[idx - 1].name;
    return null;
  }

  async reviewArtifacts(step: StepName, files: string[]): Promise<ArtifactReviewResult> {
    const total = files.length;
    this.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    this.log(`  Artifact review: ${step} (${total} file${total === 1 ? '' : 's'})`);
    this.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const basename = file.split('/').pop() ?? file;

      this.log(`━━━ [${i + 1}/${total}] ${basename} ━━━\n`);

      try {
        const content = await this.readFileFn(file);
        this.log(content);
      } catch {
        this.log(`  (could not read file: ${file})`);
      }

      this.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

      while (true) {
        const answer = await this.ask('  [enter=approve / r=reject / s=skip remaining]: ');
        if (answer === '' || answer === 'a') {
          this.log(`  ✓ Approved: ${basename}`);
          break;
        }
        if (answer === 'r') {
          this.log(`  ✗ Rejected: ${basename}`);
          this.log(`  Returning to ${step} to address issues...\n`);
          return 'rejected';
        }
        if (answer === 's') {
          this.log(`  Skipping review of remaining artifacts.`);
          return 'approved';
        }
        this.log('  Invalid choice. Press enter to approve, r to reject, s to skip.');
      }
    }

    this.log(`\n  ✓ All ${step} artifacts approved.\n`);
    return 'approved';
  }

  async recovery(
    step: StepName,
    isGating: boolean,
    context?: RecoveryContext,
  ): Promise<RecoveryOption> {
    let options = getRecoveryOptions(step, isGating);
    if (context?.retriesExhausted) {
      // Strip `retry` from the menu — the conductor has already seen this
      // step bounce off the recovery screen MAX_RECOVERY_RETRIES times and
      // it's not going to heal itself. Push the user toward interactive,
      // back, or quit instead.
      options = options.filter((o) => o !== 'retry');
      this.log(
        `\n  Retry budget exhausted for ${step} — pick a different path below.`,
      );
    }
    const labels = options.map((o) => RECOVERY_LABELS[o]).join(' / ');
    const keys = options.map((o) => o[0]).join('/');
    const gatingTag = isGating ? ' [gating]' : '';

    this.log(`\n━━━ Step failed: ${step}${gatingTag} ━━━`);

    while (true) {
      const answer = await this.ask(`  ${step} — ${labels} [${keys}]: `);
      const action = RECOVERY_KEYS[answer];
      if (action && options.includes(action)) return action;
      this.log(`  Invalid choice. Enter one of: ${keys}`);
    }
  }

  async complexityAssessment(recommended: ComplexityTier | null): Promise<ComplexityTier> {
    if (recommended) {
      this.log(`\nClaude recommends complexity tier: ${recommended}`);
      const answer = await this.ask(
        `  [enter=accept ${recommended} / S / M / L to override]: `,
      );
      if (answer === '') return recommended;
      if (answer === 's') return 'S';
      if (answer === 'm') return 'M';
      if (answer === 'l') return 'L';
      this.log(`  Unrecognized input; keeping ${recommended}.`);
      return recommended;
    }

    this.log('\n(Claude did not return a tier recommendation — choose manually.)');
    while (true) {
      const answer = await this.ask('  Classify complexity [S/M/L]: ');
      if (answer === 's') return 'S';
      if (answer === 'm') return 'M';
      if (answer === 'l') return 'L';
      this.log('  Invalid choice. Enter s, m, or l.');
    }
  }
}
