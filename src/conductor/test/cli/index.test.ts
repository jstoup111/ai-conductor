import { describe, it, expect, vi } from 'vitest';
import { execa } from 'execa';
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
        'conduct inline',
        'conduct register',
        'conduct create',
        'conduct engineer',
        'conduct daemon',
        'conduct build-review',
        'conduct build-review findings',
        'conduct build-review accept',
      ]) {
        expect(help).toContain(path);
      }
    });

    it('documents NESTED sub-subcommands (engineer + daemon trees)', () => {
      for (const path of [
        'conduct engineer projects',
        'conduct engineer land',
        'conduct engineer handoff',
        'conduct daemon status',
        'conduct daemon logs',
        'conduct daemon start',
        'conduct daemon stop',
        'conduct daemon restart',
        'conduct daemon connect',
        'conduct daemon debug',
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
      expect(help).not.toContain('conduct help');
      expect(help).not.toContain('conduct engineer help');
    });

    it('documents the full engineer subtree (all six runtime primitives)', () => {
      for (const path of [
        'conduct engineer worktree',
        'conduct engineer poll',
        'conduct engineer claim',
        'conduct engineer forget',
        'conduct engineer resolve',
        'conduct engineer migrate-issue-deps',
      ]) {
        expect(help).toContain(path);
      }
    });

    it('documents the real land/handoff flags (--worktree, --source-ref)', () => {
      expect(help).toContain('--worktree');
      expect(help).toContain('--source-ref');
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
        expect(help).toContain(`conduct daemon ${verb}`);
      }
    });
  });

  // The inline pipeline now runs under an explicit `inline` subcommand; detectInline
  // strips that token so parseArgs sees just the feature + flags.
  describe('detectInline', () => {
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
