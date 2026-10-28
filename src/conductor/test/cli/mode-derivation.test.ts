// Covers: task:1
import { describe, it, expect, vi, afterEach } from 'vitest';
import { deriveMode, parseArgs } from '../../src/index.js';
import { createProgram } from '../../src/cli.js';

describe('RunMode derivation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns default when neither --auto nor --interactive is set', () => {
    const mode = deriveMode({ auto: false, interactive: false });
    expect(mode).toBe('default');
  });

  // Covers: task:11
  it('rejects --auto with a deprecation notice directing the operator to the daemon', () => {
    const exitSentinel = new Error('process.exit called');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw exitSentinel;
    });

    let thrown: unknown;
    let pipelineConstructed = false;
    try {
      deriveMode({ auto: true, interactive: false });
      pipelineConstructed = true;
    } catch (error) {
      thrown = error;
    }

    expect({
      thrown,
      exitCode: exitSpy.mock.calls[0]?.[0],
      notice: errorSpy.mock.calls[0]?.[0],
      pipelineConstructed,
    }).toEqual({
      thrown: exitSentinel,
      exitCode: 1,
      notice: expect.stringMatching(
        /--auto.*deprecated.*ai-conductor daemon start.*docs\/guides\/running-the-daemon\.md/i,
      ),
      pipelineConstructed: false,
    });
    expect(errorSpy.mock.calls.flat()).not.toContainEqual(expect.stringMatching(/mutually exclusive/i));
  });

  // Covers: task:11
  it('returns interactive when --interactive is set', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mode = deriveMode({ auto: false, interactive: true });
    expect(mode).toBe('interactive');
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringMatching(/mutually exclusive/i));
  });

  // Covers: task:11
  it('exits non-zero with error message when both --auto and --interactive are set', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: string | number | null) => {
      throw new Error('process.exit called');
    });

    expect(() => deriveMode({ auto: true, interactive: true })).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);

    const errorMsg = errorSpy.mock.calls[0]?.[0] as string;
    expect(errorMsg).toMatch(/--auto/);
    expect(errorMsg).toMatch(/--interactive/);
    expect(errorMsg).toMatch(/mutually exclusive/);
  });

  // Covers: task:11
  it('describes --auto as daemon-only and mutually exclusive with --interactive in root and inline help', () => {
    const rootHelp = createProgram().helpInformation();
    const inlineHelp = createProgram().commands.find((command) => command.name() === 'inline')?.helpInformation();

    for (const help of [rootHelp, inlineHelp]) {
      expect(help).toMatch(/--auto[\s\S]*ai-conductor daemon start/i);
      expect(help).toMatch(/--auto[\s\S]*(?:cannot|not) be\s+combined with --interactive/i);
    }
  });

  // Covers: task:11
  it('keeps REPL mode and states --interactive is mutually exclusive with --auto in root and inline help', () => {
    const rootHelp = createProgram().helpInformation();
    const inlineHelp = createProgram().commands.find((command) => command.name() === 'inline')?.helpInformation();

    for (const help of [rootHelp, inlineHelp]) {
      expect(help).toMatch(/--interactive[\s\S]*REPL mode/i);
      expect(help).toMatch(/--interactive[\s\S]*(?:cannot|not) be\s+combined with --auto/i);
    }
  });

  it('preserves Commander\'s unknown-option rejection', () => {
    expect(() => parseArgs(['node', 'conduct', 'inline', 'x', '--bogus'])).toThrow(
      /unknown option '--bogus'/i,
    );
  });
});
