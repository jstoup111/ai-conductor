import { describe, it, expect } from 'vitest';
import { parseArgs, createProgram, detectInline } from '../../src/cli.js';

describe('CLI', () => {
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

  it('parses --step <step> flag', () => {
    const opts = parseArgs(['node', 'conduct', '--step', 'brainstorm']);
    expect(opts.step).toBe('brainstorm');
  });

  it('parses --reset flag', () => {
    const opts = parseArgs(['node', 'conduct', '--reset']);
    expect(opts.reset).toBe(true);
  });

  it('parses --output flag', () => {
    const opts = parseArgs(['node', 'conduct', 'feature', '--output']);
    expect(opts.output).toBe(true);
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
  it('--help lists all subcommands (inline, register, create, engineer, daemon)', () => {
    const help = createProgram().helpInformation();
    expect(help).toMatch(/^Commands:/m);
    for (const cmd of ['inline', 'register', 'create', 'engineer', 'daemon']) {
      expect(help).toContain(cmd);
    }
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
