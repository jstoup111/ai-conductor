// Covers: task:2, task:3, task:10, task:12, task:21

import { describe, it, expect, vi } from 'vitest';
import { execa } from 'execa';
import { Command } from 'commander';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseArgs,
  createProgram,
  detectInline,
  renderFullHelp,
  renderDaemonHelp,
  detectBuildReviewFindingsCommand,
  detectBuildReviewAcceptCommand,
  detectBuildReviewRecordReducedCoverageCommand,
} from '../../src/cli.js';
import { DAEMON_RUN_FLAGS } from '../../src/engine/daemon-command.js';
import { detectDaemonSupervisorCommand } from '../../src/engine/daemon-command.js';
import { detectDaemonObserveCommand } from '../../src/engine/daemon-observe-cli.js';
import { PRE_DISPATCH_COMMANDS } from '../../src/cli-pre-dispatch.js';
import { renderCanonicalFullHelp } from '../../src/index.js';

const OPERATOR_FACING_COMMANDS = [
  'shipped-record',
  'kpi',
  'memory',
  'brain',
  'intake-loop',
  'render-diagrams',
  'build-auth-status',
  'transcripts',
  'shipment-evidence',
] as const;

const HIDDEN_PRE_DISPATCH_COMMANDS = [
  'scoped-run',
  'halt-clear',
  'missing-reseal-reason',
  'test-suite',
  'finish-record',
  'manual-test-record',
  'derive-feedback',
  'github-boundary-audit',
  'github-operation',
  'scope-check',
  'task-membership-check',
] as const;

const VISIBLE_PRE_DISPATCH_COMMANDS = [
  'render-diagrams',
  'rate-card',
  'overlap-scan',
  'version',
  'update',
  'build-review',
  'build-tail',
  'decide-grant',
  'kickback-budget',
  'rewind',
  'reseal',
  'memory',
  'register',
  'create',
  'config',
  'engineer',
  'intake-loop',
  'brain',
  'shipped-record',
  'transcripts',
  'shipment-evidence',
  'task',
  'evidence',
  'kpi',
  'build-auth-status',
  'halt-issues',
  'plan-protected-targets',
  'monitor',
  'daemon',
] as const;

function expectVisibleOperatorCommands(program = createProgram()): void {
  const commandNames = program.commands.map((command) => command.name());
  for (const command of OPERATOR_FACING_COMMANDS) {
    expect(commandNames, `missing visible command: ${command}`).toContain(command);
  }
}

function fullHelpSection(help: string, path: string): string {
  const header = `ai-conductor ${path}\n`;
  const start = help.indexOf(header);
  expect(start, `missing full-reference section: ${path}`).toBeGreaterThanOrEqual(0);
  const nextSection = help.indexOf(`\n\n${'─'.repeat(72)}\n`, start + header.length);
  return help.slice(start, nextSection === -1 ? undefined : nextSection);
}

function missingDaemonRunFlags(
  flags: readonly string[],
  daemon: Command,
): string[] {
  const declared = new Set(daemon.options.map((option) => option.long));
  return flags.filter((flag) => !declared.has(flag));
}

/** Commander keeps these declaration details as runtime fields, but omits them from its public types. */
function commanderInternals(command: Command | undefined): {
  _hidden?: boolean;
  _actionHandler?: unknown;
} | undefined {
  return command as (Command & { _hidden?: boolean; _actionHandler?: unknown }) | undefined;
}

describe('CLI', () => {
  it('detects only the explicit read-only build-review findings grammar', () => {
    expect(detectBuildReviewFindingsCommand(['node', 'conduct', 'build-review', 'findings', '--feature', 'review-rubrics', '--json']))
      .toEqual({ kind: 'findings', feature: 'review-rubrics', format: 'json' });
    expect(detectBuildReviewFindingsCommand(['node', 'conduct', 'build-review', 'findings'])).toBeNull();
  });
  it('requires exact accept identity inputs and never accepts an operator override', () => {
    expect(detectBuildReviewAcceptCommand(['node', 'conduct', 'build-review', 'accept', '--feature', 'review-rubrics', '--lap', 'lap-current', '--finding', 'sha256:abc', '--rationale', 'known risk']))
      .toEqual({ kind: 'accept', feature: 'review-rubrics', lapId: 'lap-current', findingId: 'sha256:abc', rationale: 'known risk' });
    expect(detectBuildReviewAcceptCommand(['node', 'conduct', 'build-review', 'accept', '--feature', 'review-rubrics', '--lap', 'lap-current', '--finding', 'sha256:abc', '--rationale', 'risk', '--operator', 'forged'])).toBeNull();
  });
  it('requires the closed reduced-coverage command grammar without a caller-supplied cause', () => {
    expect(detectBuildReviewRecordReducedCoverageCommand([
      'node', 'conduct', 'build-review', 'record-reduced-coverage', '--feature', 'review-rubrics', '--lap', 'lap-current', '--rubric', 'rootCause', '--rationale', 'known provider risk',
    ])).toEqual({ kind: 'record-reduced-coverage', feature: 'review-rubrics', lapId: 'lap-current', rubric: 'rootCause', rationale: 'known provider risk' });
    expect(detectBuildReviewRecordReducedCoverageCommand([
      'node', 'conduct', 'build-review', 'record-reduced-coverage', '--feature', 'review-rubrics', '--lap', 'lap-current', '--rubric', 'rootCause', '--rationale', 'risk', '--reason', 'provider-error',
    ])).toBeNull();
    expect(detectBuildReviewRecordReducedCoverageCommand([
      'node', 'conduct', 'build-review', 'record-reduced-coverage', '--feature', 'review-rubrics', '--lap', 'lap-current', '--rubric', 'unknown', '--rationale', 'risk',
    ])).toMatchObject({ kind: 'record-reduced-coverage', rubric: 'unknown' });
  });
  it('parses feature description as positional arg', () => {
    const opts = parseArgs(['node', 'conduct', 'URL shortener']);
    expect(opts.featureDesc).toBe('URL shortener');
  });

  it('parses --resume flag', () => {
    const opts = parseArgs(['node', 'conduct', '--resume']);
    expect(opts.resume).toBe(true);
  });

  it('parses --auto flag and sets mode to auto', () => {
    const opts = parseArgs(['node', 'conduct', 'feature', '--auto']);
    expect(opts.auto).toBe(true);
  });

  it('parses --status flag', () => {
    const opts = parseArgs(['node', 'conduct', '--status']);
    expect(opts.status).toBe(true);
  });

  it('parses --from <step> flag', () => {
    const opts = parseArgs(['node', 'conduct', 'feature', '--from', 'plan']);
    expect(opts.from).toBe('plan');
  });

  it('parses --cleanup flag', () => {
    const opts = parseArgs(['node', 'conduct', '--cleanup']);
    expect(opts.cleanup).toBe(true);
  });

  it('parses --reset flag', () => {
    const opts = parseArgs(['node', 'conduct', '--reset']);
    expect(opts.reset).toBe(true);
  });

  // #1013: --step and --output were parsed but never consumed anywhere in the
  // entry point (dead CLI surface). Both were removed rather than implemented.
  it('rejects --step as an unknown option', () => {
    expect(() => parseArgs(['node', 'conduct', '--step', 'brainstorm'])).toThrow();
  });

  it('rejects --output as an unknown option', () => {
    expect(() => parseArgs(['node', 'conduct', 'feature', '--output'])).toThrow();
  });

  it('no longer exposes step/output on CLIOptions', () => {
    const opts = parseArgs(['node', 'conduct', 'feature']);
    expect(opts).not.toHaveProperty('step');
    expect(opts).not.toHaveProperty('output');
  });

  it('--help no longer advertises --step or --output', () => {
    const help = createProgram().helpInformation();
    expect(help).not.toContain('--step');
    expect(help).not.toContain('--output');
  });

  it('does not register or advertise the removed validate-wired-into subcommand', async () => {
    const program = createProgram();
    const stderr = vi.fn();
    program.configureOutput({ writeErr: stderr });
    program.exitOverride();
    expect(program.commands.map((command) => command.name())).not.toContain('validate-wired-into');
    expect(renderFullHelp()).not.toContain('validate-wired-into');
    expect(() => program.parse(['node', 'conduct', 'validate-wired-into'])).toThrow();
    expect(stderr).toHaveBeenCalledWith(expect.stringMatching(/unknown command ['"]?validate-wired-into/i));

    const result = await execa(
      process.execPath,
      ['--import', 'tsx', join(process.cwd(), 'src', 'index.ts'), 'validate-wired-into'],
      { reject: false, all: true },
    );
    expect(result.exitCode).toBe(1);
    expect(result.all).toMatch(/unknown command ['"]?validate-wired-into/i);
  });

  // --from is the real, documented way to start at a specific step and must
  // be unaffected by the --step/--output removal.
  it('--from still works and still satisfies the state-flag check', () => {
    const opts = parseArgs(['node', 'conduct', '--from', 'plan']);
    expect(opts.from).toBe('plan');
    expect(opts.featureDesc).toBeUndefined();
  });

  it('requires feature description when no state exists', () => {
    expect(() => parseArgs(['node', 'conduct'])).toThrow();
  });

  it('defaults --view to full', () => {
    const opts = parseArgs(['node', 'conduct', 'feature']);
    expect(opts.view).toBe('full');
  });

  it('parses --view focus', () => {
    const opts = parseArgs(['node', 'conduct', 'feature', '--view', 'focus']);
    expect(opts.view).toBe('focus');
  });

  it('parses --view log', () => {
    const opts = parseArgs(['node', 'conduct', 'feature', '--view', 'log']);
    expect(opts.view).toBe('log');
  });

  it('falls back to full when --view gets a bogus value', () => {
    const opts = parseArgs(['node', 'conduct', 'feature', '--view', 'garbage']);
    expect(opts.view).toBe('full');
  });

  it('defaults --tail-lines to 20', () => {
    const opts = parseArgs(['node', 'conduct', 'feature']);
    expect(opts.tailLines).toBe(20);
  });

  it('parses --tail-lines override', () => {
    const opts = parseArgs(['node', 'conduct', 'feature', '--tail-lines', '50']);
    expect(opts.tailLines).toBe(50);
  });

  it('accepts --tail-lines 0 to disable the tail pane', () => {
    const opts = parseArgs(['node', 'conduct', 'feature', '--tail-lines', '0']);
    expect(opts.tailLines).toBe(0);
  });

  it('accepts --from without a feature description (state-flag)', () => {
    // --from targets a step in an existing feature; there's nothing to
    // describe that the state file doesn't already carry.
    const opts = parseArgs(['node', 'conduct', '--from', 'manual_test']);
    expect(opts.from).toBe('manual_test');
    expect(opts.featureDesc).toBeUndefined();
  });

  // #1027: --effort seam (effortCliOverride/effortOverride) existed but no
  // CLI flag registered it. Mirrors --model's parsing/validation shape.
  describe('--effort', () => {
    it('parses a valid --effort value', () => {
      const opts = parseArgs(['node', 'conduct', 'feature', '--effort', 'high']);
      expect(opts.effort).toBe('high');
    });

    it('is undefined when not provided', () => {
      const opts = parseArgs(['node', 'conduct', 'feature']);
      expect(opts.effort).toBeUndefined();
    });

    it('rejects an invalid --effort value', () => {
      expect(() =>
        parseArgs(['node', 'conduct', 'feature', '--effort', 'bogus']),
      ).toThrow(/Invalid --effort/);
    });

    it('--help documents --effort', () => {
      const help = createProgram().helpInformation();
      expect(help).toContain('--effort');
    });
  });

  it('parses --interactive flag as true', () => {
    const opts = parseArgs(['node', 'conduct', 'feature', '--interactive']);
    expect(opts.interactive).toBe(true);
  });

  it('defaults --interactive to false when not provided', () => {
    const opts = parseArgs(['node', 'conduct', 'feature']);
    expect(opts.interactive).toBe(false);
  });

  it('--help output includes --interactive flag', () => {
    const program = createProgram();
    const helpOutput = program.helpInformation();
    expect(helpOutput).toContain('--interactive');
  });

  // The discoverable command surface: top-level help must list every subcommand,
  // not just the bare-pipeline flags. Regression — `--help` rendered the base
  // program (no Commands section), so register/create/engineer/daemon were
  // invisible. createProgram() is the program index.ts routes top-level help to.
  it('--help lists all subcommands including build-review', () => {
    const help = createProgram().helpInformation();
    expect(help).toMatch(/^Usage: ai-conductor/m);
    expect(help).toMatch(/^Commands:/m);
    for (const cmd of ['inline', 'register', 'create', 'engineer', 'daemon', 'build-review']) {
      expect(help).toContain(cmd);
    }
  });

  // Root --help is a full reference: renderFullHelp recurses through every command
  // and sub-subcommand, documenting nested commands + their options in one document.
  describe('renderFullHelp (root-level full reference)', () => {
    const help = renderFullHelp();

    it('documents every top-level command with a titled section', () => {
      for (const path of [
        'ai-conductor inline',
        'ai-conductor register',
        'ai-conductor create',
        'ai-conductor engineer',
        'ai-conductor daemon',
        'ai-conductor build-review',
        'ai-conductor build-review findings',
        'ai-conductor build-review accept',
      ]) {
        expect(help).toContain(path);
      }
    });

    it('documents the foreground monitor verb and its project selectors', () => {
      expect(help).toMatch(
        /ai-conductor monitor\n[\s\S]*?Usage: ai-conductor monitor \[options\] <project>[\s\S]*?`all` registered projects/,
      );
    });

    it('documents NESTED sub-subcommands (engineer + daemon trees)', () => {
      for (const path of [
        'ai-conductor engineer projects',
        'ai-conductor engineer land',
        'ai-conductor engineer handoff',
        'ai-conductor daemon status',
        'ai-conductor daemon logs',
        'ai-conductor daemon start',
        'ai-conductor daemon stop',
        'ai-conductor daemon restart',
        'ai-conductor daemon connect',
        'ai-conductor daemon debug',
      ]) {
        expect(help).toContain(path);
      }
    });

    it('documents nested-command OPTIONS, not just names', () => {
      // create --remote, engineer land --project/--idea, daemon --concurrency,
      // daemon logs --follow — each only appears if we recurse into the command.
      for (const opt of ['--remote', '--idea', '--branch', '--concurrency', '--follow']) {
        expect(help).toContain(opt);
      }
    });

    it('omits the auto-generated `help [command]` as its own section', () => {
      expect(help).not.toContain('ai-conductor help');
      expect(help).not.toContain('ai-conductor engineer help');
    });

    it('documents the full engineer subtree (all six runtime primitives)', () => {
      for (const path of [
        'ai-conductor engineer worktree',
        'ai-conductor engineer poll',
        'ai-conductor engineer claim',
        'ai-conductor engineer forget',
        'ai-conductor engineer resolve',
        'ai-conductor engineer migrate-issue-deps',
      ]) {
        expect(help).toContain(path);
      }
    });

    it('documents the real land/handoff flags (--worktree, --source-ref)', () => {
      expect(help).toContain('--worktree');
      expect(help).toContain('--source-ref');
    });
  });

  describe('operator-facing command reference', () => {
    it('lists each operator-facing command with a one-line description in canonical help', () => {
      const help = renderCanonicalFullHelp();
      expectVisibleOperatorCommands();
      for (const command of OPERATOR_FACING_COMMANDS) {
        expect(help).toMatch(new RegExp(`^  ${command}\\b\\s+.+$`, 'm'));
      }
    });

    it('gives every operator-facing command a full-reference section with its declared interface', () => {
      const help = renderCanonicalFullHelp();
      const commandOptions: Record<(typeof OPERATOR_FACING_COMMANDS)[number], string[]> = {
        'shipped-record': ['--slug', '--pr'],
        kpi: [],
        memory: ['setup'],
        brain: ['start', 'stop', 'status'],
        'intake-loop': ['--continuous', '--once', '--interval-ms'],
        'render-diagrams': ['--check'],
        'build-auth-status': [],
        transcripts: ['--show'],
        'shipment-evidence': ['--pr', '--event', 'reconcile', 'audit'],
      };
      for (const [command, options] of Object.entries(commandOptions)) {
        const section = fullHelpSection(help, command);
        for (const option of options) expect(section).toContain(option);
      }
      expect(fullHelpSection(help, 'memory setup')).toContain('[dir]');
      expect(fullHelpSection(help, 'shipment-evidence reconcile')).toContain('--shipped');
      expect(fullHelpSection(help, 'shipment-evidence audit')).toContain('--report');
    });

    it('names a missing operator-facing command in the visible-command fixture check', () => {
      const program = new Command();
      for (const command of OPERATOR_FACING_COMMANDS.filter((command) => command !== 'memory')) {
        program.command(command);
      }
      expect(() => expectVisibleOperatorCommands(program)).toThrow('missing visible command: memory');
    });

    it('keeps previously visible recovery and timing commands in the top-level list', () => {
      const commandNames = createProgram().commands.map((command) => command.name());
      expect(commandNames).toEqual(expect.arrayContaining(['kickback-budget', 'build-tail']));
    });
  });

  describe('engine-internal command catalog', () => {
    it('declares the four named engine-internal commands as hidden', () => {
      const commands = createProgram().commands;
      for (const name of ['test-suite', 'finish-record', 'manual-test-record', 'derive-feedback']) {
        expect(commanderInternals(commands.find((command) => command.name() === name))?._hidden, name).toBe(true);
      }
    });

    it('declares every formerly undeclared pre-dispatch top-level command as hidden', () => {
      const commands = createProgram().commands;
      const declaredHiddenCommands = [...new Set(
        PRE_DISPATCH_COMMANDS
          .map(({ commandPath }) => commandPath[0])
          .filter((name) => !VISIBLE_PRE_DISPATCH_COMMANDS.includes(
            name as (typeof VISIBLE_PRE_DISPATCH_COMMANDS)[number],
          )),
      )].sort();
      expect(declaredHiddenCommands).toEqual([...HIDDEN_PRE_DISPATCH_COMMANDS].sort());
      for (const name of HIDDEN_PRE_DISPATCH_COMMANDS) {
        expect(commanderInternals(commands.find((command) => command.name() === name))?._hidden, name).toBe(true);
      }
      for (const name of [...VISIBLE_PRE_DISPATCH_COMMANDS, ...OPERATOR_FACING_COMMANDS]) {
        expect(commanderInternals(commands.find((command) => command.name() === name))?._hidden, name).not.toBe(true);
      }
    });

    it('omits hidden commands from canonical full help listings and sections', () => {
      const help = renderCanonicalFullHelp();
      for (const name of HIDDEN_PRE_DISPATCH_COMMANDS) {
        expect(help).not.toMatch(new RegExp(`^  ${name}\\b`, 'm'));
        expect(help).not.toContain(`ai-conductor ${name}\n`);
      }
    });
  });

  describe('root-level program description names both loops', () => {
    it('mentions daemon, engineer, and points to `engineer --help`', () => {
      const rootHelp = createProgram().helpInformation();
      expect(rootHelp).toContain('daemon');
      expect(rootHelp).toContain('engineer');
      expect(rootHelp).toContain('engineer --help');
    });
  });

  // `conduct daemon --help` renders the daemon subtree only (run flags + every
  // sub-verb), answered WITHOUT launching a daemon run.
  describe('renderDaemonHelp (daemon subtree reference)', () => {
    const help = renderDaemonHelp();

    it('documents the run flags and all sub-verbs (status/logs + management)', () => {
      expect(help).toContain('--concurrency');
      for (const verb of ['status', 'logs', 'start', 'stop', 'restart', 'connect', 'debug']) {
        expect(help).toContain(`ai-conductor daemon ${verb}`);
      }
    });

    // Covers: task:9
    it('lists every daemon run flag and describes --all as including completed features', () => {
      expect(help).toContain('--no-watch');
      expect(help).toContain('--completed');
      expect(help).toMatch(/--all[\s\S]*including completed features/i);
    });

    // Covers: task:9
    it('declares every parser-recognized daemon run flag', () => {
      const daemon = createProgram().commands.find((command) => command.name() === 'daemon');
      expect(daemon).toBeDefined();
      expect(missingDaemonRunFlags(DAEMON_RUN_FLAGS, daemon!)).toEqual([]);
    });

    // Covers: task:9
    it('names an undeclared daemon run flag in the parity fixture', () => {
      const daemon = createProgram().commands.find((command) => command.name() === 'daemon');
      expect(daemon).toBeDefined();
      expect(missingDaemonRunFlags(['--no-such-run-flag'], daemon!)).toEqual(['--no-such-run-flag']);
    });

    // Covers: task:10
    it('lists the logs flags, including the --repo=<path> spelling', () => {
      const logs = fullHelpSection(help, 'daemon logs');
      expect(logs).toContain('-f, --follow');
      expect(logs).toContain('-n, --lines <n>');
      expect(logs).toMatch(/--repo <path>[\s\S]*--repo=<path>/);
      expect(logs).toContain('--all');
    });

    // Covers: task:10
    it('documents fleet selectors without adding commander action handlers or --names', () => {
      const daemon = createProgram().commands.find((command) => command.name() === 'daemon');
      expect(daemon).toBeDefined();
      for (const verb of ['pause', 'resume', 'restart']) {
        const section = fullHelpSection(help, `daemon ${verb}`);
        expect(section).toContain(`[repos...]`);
        expect(section).toMatch(/named\s+subset/i);
        expect(section).toMatch(/--all[\s\S]*every registered repo/i);

        const command = daemon!.commands.find((candidate) => candidate.name() === verb);
        expect(commanderInternals(command)?._actionHandler).toBeNull();
        expect(command?.options.map((option) => option.long)).not.toContain('--names');
      }
    });

    // Covers: task:10
    it('parses logs -n exactly as --lines', () => {
      const short = detectDaemonObserveCommand(['node', 'conduct', 'daemon', 'logs', '-n', '50']);
      const long = detectDaemonObserveCommand(['node', 'conduct', 'daemon', 'logs', '--lines', '50']);
      expect(short).toMatchObject({ kind: 'logs', lines: 50 });
      expect(short).toEqual(long);
    });

    // Covers: task:10
    it('leaves bare daemon restart on its pre-selector result shape', () => {
      expect(detectDaemonSupervisorCommand(['node', 'conduct', 'daemon', 'restart'])).toEqual({ verb: 'restart' });
    });
  });

  // The inline pipeline now runs under an explicit `inline` subcommand; detectInline
  // strips that token so parseArgs sees just the feature + flags.
  describe('detectInline', () => {
    it('rejects the retired closeout-event command without changing its sibling ledger', async () => {
      const projectRoot = await mkdtemp(join(tmpdir(), 'retired-closeout-command-'));
      const ledger = join(projectRoot, '.pipeline', 'pipeline-events.jsonl');
      try {
        await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
        await writeFile(ledger, '{"type":"kickback_budget_adjustment_authorized","adjustmentId":"kept"}\n');
        const before = await readFile(ledger, 'utf8');

        const result = await execa(
          process.execPath,
          ['--import', 'tsx', join(process.cwd(), 'src', 'index.ts'), 'closeout-event', 'start', 'simplify'],
          { cwd: projectRoot, reject: false, all: true },
        );

        expect(result.exitCode).not.toBe(0);
        expect(result.all).toContain("error: unknown command 'closeout-event'");
        expect(await readFile(ledger, 'utf8')).toBe(before);
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    });

    it('rejects a stale evaluator closeout invocation without appending either event ledger', async () => {
      const projectRoot = await mkdtemp(join(tmpdir(), 'retired-evaluator-closeout-'));
      const pipelineDir = join(projectRoot, '.pipeline');
      const siblingLedger = join(pipelineDir, 'pipeline-events.jsonl');
      const canonicalLedger = join(pipelineDir, 'events.jsonl');
      try {
        await mkdir(pipelineDir, { recursive: true });
        await writeFile(siblingLedger, '{"type":"pipeline_closeout_started","obligation":"evaluator","ts":10}\n');
        await writeFile(canonicalLedger, '{"type":"step_started","step":"build","index":0}\n');
        const [siblingBefore, canonicalBefore] = await Promise.all([
          readFile(siblingLedger, 'utf8'), readFile(canonicalLedger, 'utf8'),
        ]);

        const result = await execa(
          process.execPath,
          ['--import', 'tsx', join(process.cwd(), 'src', 'index.ts'), 'closeout-event', 'start', 'evaluator'],
          { cwd: projectRoot, reject: false, all: true },
        );

        expect(result.exitCode).not.toBe(0);
        expect(result.all).toContain("error: unknown command 'closeout-event'");
        expect(result.all).not.toMatch(/uncaught|TypeError|ReferenceError/i);
        await expect(Promise.all([readFile(siblingLedger, 'utf8'), readFile(canonicalLedger, 'utf8')]))
          .resolves.toEqual([siblingBefore, canonicalBefore]);
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    });

    it('recognizes `inline` and strips it from argv', () => {
      const { isInline, rest } = detectInline(['node', 'conduct', 'inline', 'URL shortener']);
      expect(isInline).toBe(true);
      expect(rest).toEqual(['node', 'conduct', 'URL shortener']);
    });

    it('keeps inline flags after stripping the subcommand', () => {
      const { isInline, rest } = detectInline(['node', 'conduct', 'inline', '--status']);
      expect(isInline).toBe(true);
      expect(parseArgs(rest).status).toBe(true);
    });

    it('reports non-inline for a bare feature (the now-rejected form)', () => {
      const { isInline, rest } = detectInline(['node', 'conduct', 'URL shortener']);
      expect(isInline).toBe(false);
      expect(rest).toEqual(['node', 'conduct', 'URL shortener']);
    });

    it('names a bare unknown command while preserving bare-feature guidance', async () => {
      const invoke = (args: string[]) => execa(
        process.execPath,
        ['--import', 'tsx', join(process.cwd(), 'src', 'index.ts'), ...args],
        { reject: false },
      );

      const unknownCommand = await invoke(['deploy']);
      expect(unknownCommand.exitCode).toBe(1);
      expect(unknownCommand.stderr).toContain("error: unknown command 'deploy'");

      const bareFeature = await invoke(['URL shortener']);
      expect(bareFeature.exitCode).toBe(1);
      expect(bareFeature.stderr).toContain('conduct: the inline SDLC pipeline now runs under the `inline` subcommand.');
      expect(bareFeature.stderr).not.toContain('error: unknown command');
    });

    it('dispatches update help without falling through to inline guidance', async () => {
      const harnessRoot = join(process.cwd(), '..', '..');
      const gitDirectory = await stat(join(harnessRoot, '.git')).then(
        (metadata) => metadata.isDirectory(),
        () => false,
      );
      const result = await execa(
        process.execPath,
        ['--import', 'tsx', join(process.cwd(), 'src', 'index.ts'), 'update', '--help'],
        { reject: false },
      );
      const output = `${result.stdout}\n${result.stderr}`;

      expect(output).not.toMatch(/unknown command/i);
      expect(output).not.toContain('Run:        conduct inline');
      if (!gitDirectory) {
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toMatch(/not a git checkout/i);
        expect(result.stderr).toContain(harnessRoot);
      } else {
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('Usage: update [OPTIONS]');
        expect(result.stdout).toContain('--set-channel');
      }
    });

    it('reports non-inline for a bare state flag', () => {
      expect(detectInline(['node', 'conduct', '--status']).isInline).toBe(false);
    });

    it('does not treat a feature literally named after the token as the subcommand only', () => {
      // `inline` as argv[2] is the subcommand; a following feature survives.
      const { rest } = detectInline(['node', 'conduct', 'inline', 'inline notes']);
      expect(parseArgs(rest).featureDesc).toBe('inline notes');
    });
  });
});
