import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { TerminalPromptHost } from '../../../src/ui/terminal/prompt-host.js';
import { createLiveRegion } from '../../../src/ui/live-region.js';
import type { LiveRegion } from '../../../src/ui/live-region.js';

function stubRegion(): LiveRegion {
  return {
    update() {},
    clear() {},
    log() {},
    suspend() {},
    resume() {},
    stop() {},
  };
}

function makeHost(inputs: string[]) {
  const input = new PassThrough();
  const output = new PassThrough();
  const logs: string[] = [];
  const host = new TerminalPromptHost(stubRegion(), {
    input,
    output,
    log: (...args) => logs.push(args.map(String).join(' ')),
    readFileFn: async () => 'file contents',
  });
  // Drip-feed answers: write each answer on its own line as readline would see.
  queueMicrotask(() => {
    for (const answer of inputs) {
      input.write(answer + '\n');
    }
  });
  return { host, logs };
}

describe('TerminalPromptHost.checkpoint', () => {
  it('returns continue on "c"', async () => {
    const { host } = makeHost(['c']);
    await expect(host.checkpoint('plan')).resolves.toBe('continue');
  });

  it('returns back on "b"', async () => {
    const { host } = makeHost(['b']);
    await expect(host.checkpoint('plan')).resolves.toBe('back');
  });

  it('returns quit on "q"', async () => {
    const { host } = makeHost(['q']);
    await expect(host.checkpoint('plan')).resolves.toBe('quit');
  });

  it('re-prompts on invalid input until a valid choice', async () => {
    const { host, logs } = makeHost(['x', 'zz', 'c']);
    await expect(host.checkpoint('plan')).resolves.toBe('continue');
    expect(logs.some((l) => l.includes('Invalid choice'))).toBe(true);
  });
});

describe('TerminalPromptHost.navigate', () => {
  it('returns null when no steps supplied', async () => {
    const { host } = makeHost([]);
    await expect(host.navigate([])).resolves.toBeNull();
  });

  it('returns selected step by number', async () => {
    const { host } = makeHost(['2']);
    const result = await host.navigate([
      { name: 'plan', label: 'Plan', status: 'done', phase: 'DECIDE' },
      { name: 'stories', label: 'Stories', status: 'done', phase: 'DECIDE' },
    ]);
    expect(result).toBe('stories');
  });

  it('returns null when 0 selected', async () => {
    const { host } = makeHost(['0']);
    const result = await host.navigate([
      { name: 'plan', label: 'Plan', status: 'done', phase: 'DECIDE' },
    ]);
    expect(result).toBeNull();
  });

  it('returns null on out-of-range choice', async () => {
    const { host } = makeHost(['99']);
    const result = await host.navigate([
      { name: 'plan', label: 'Plan', status: 'done', phase: 'DECIDE' },
    ]);
    expect(result).toBeNull();
  });
});

describe('TerminalPromptHost.complexityAssessment', () => {
  it('accepts recommendation on empty enter', async () => {
    const { host } = makeHost(['']);
    await expect(host.complexityAssessment('M')).resolves.toBe('M');
  });

  it('overrides recommendation with explicit letter', async () => {
    const { host } = makeHost(['l']);
    await expect(host.complexityAssessment('S')).resolves.toBe('L');
  });

  it('re-prompts on invalid when no recommendation', async () => {
    const { host, logs } = makeHost(['x', 's']);
    await expect(host.complexityAssessment(null)).resolves.toBe('S');
    expect(logs.some((l) => l.includes('Invalid choice'))).toBe(true);
  });

  it('keeps recommendation on unrecognized override input', async () => {
    const { host } = makeHost(['x']);
    await expect(host.complexityAssessment('M')).resolves.toBe('M');
  });
});

describe('TerminalPromptHost.recovery', () => {
  it('returns retry on "r"', async () => {
    const { host } = makeHost(['r']);
    await expect(host.recovery('build', false)).resolves.toBe('retry');
  });

  it('rejects skip when step is gating', async () => {
    const { host, logs } = makeHost(['s', 'r']);
    await expect(host.recovery('plan', true)).resolves.toBe('retry');
    expect(logs.some((l) => l.includes('Invalid choice'))).toBe(true);
  });

  it('drops "retry" from the menu when retriesExhausted is set', async () => {
    // User types r (rejected — retry is gone), then i (interactive). Invalid
    // choice triggers the "Enter one of:" message.
    const { host, logs } = makeHost(['r', 'i']);
    await expect(
      host.recovery('build', false, { recoveryCount: 2, retriesExhausted: true }),
    ).resolves.toBe('interactive');
    expect(logs.some((l) => l.includes('Retry budget exhausted'))).toBe(true);
    expect(logs.some((l) => l.includes('Invalid choice'))).toBe(true);
  });
});

describe('TerminalPromptHost.reviewArtifacts', () => {
  it('approves all when each file is approved with enter', async () => {
    const { host } = makeHost(['', '']);
    await expect(
      host.reviewArtifacts('plan', ['/tmp/a.md', '/tmp/b.md']),
    ).resolves.toBe('approved');
  });

  it('rejects when user types r', async () => {
    const { host } = makeHost(['r']);
    await expect(host.reviewArtifacts('plan', ['/tmp/a.md'])).resolves.toBe('rejected');
  });

  it('skip-remaining short-circuits to approved', async () => {
    const { host } = makeHost(['s']);
    await expect(
      host.reviewArtifacts('plan', ['/tmp/a.md', '/tmp/b.md', '/tmp/c.md']),
    ).resolves.toBe('approved');
  });
});

describe('TerminalPromptHost.ask', () => {
  it('suspends the region, closes readline on answer, resumes', async () => {
    let suspendCalls = 0;
    let resumeCalls = 0;
    const region: LiveRegion = {
      update() {},
      clear() {},
      log() {},
      suspend() {
        suspendCalls++;
      },
      resume() {
        resumeCalls++;
      },
      stop() {},
    };
    const input = new PassThrough();
    const output = new PassThrough();
    const host = new TerminalPromptHost(region, { input, output, log: () => {} });
    queueMicrotask(() => input.write('y\n'));
    const answer = await host.ask('? ');
    expect(answer).toBe('y');
    expect(suspendCalls).toBe(1);
    expect(resumeCalls).toBe(1);
  });

  it('uses a disposable createLiveRegion instance cleanly (smoke)', async () => {
    const region = createLiveRegion({ forceTTY: false });
    const input = new PassThrough();
    const output = new PassThrough();
    const host = new TerminalPromptHost(region, { input, output, log: () => {} });
    queueMicrotask(() => input.write('hello\n'));
    await expect(host.ask('? ')).resolves.toBe('hello');
  });
});
