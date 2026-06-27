import { describe, it, expect } from 'vitest';
import { detectDaemonCommand } from '../../src/engine/daemon-command.js';

// argv is process.argv: [node, entry, sub, ...rest].
const argv = (...rest: string[]) => ['node', 'conduct', ...rest];

describe('detectDaemonCommand', () => {
  it('returns null when the first token is not `daemon`', () => {
    expect(detectDaemonCommand(argv('URL shortener'))).toBeNull();
    expect(detectDaemonCommand(argv('--status'))).toBeNull();
    expect(detectDaemonCommand(argv('engineer'))).toBeNull();
    expect(detectDaemonCommand(argv())).toBeNull();
  });

  it('detects a bare `daemon` with defaults (concurrency 1, idle-poll 5, drain once)', () => {
    expect(detectDaemonCommand(argv('daemon'))).toEqual({
      concurrency: 1,
      maxItems: undefined,
      continuous: false,
      maxCostTokens: undefined,
      maxRuntimeSeconds: undefined,
      idlePollSeconds: 5,
      maxIdlePolls: undefined,
    });
  });

  it('parses concurrency and max-items', () => {
    const opts = detectDaemonCommand(argv('daemon', '--concurrency', '3', '--max-items', '10'));
    expect(opts).toMatchObject({ concurrency: 3, maxItems: 10, continuous: false });
  });

  it('parses the continuous ceilings', () => {
    const opts = detectDaemonCommand(
      argv('daemon', '--continuous', '--max-runtime', '3600', '--max-cost', '2000000', '--max-idle-polls', '8'),
    );
    expect(opts).toMatchObject({
      continuous: true,
      maxRuntimeSeconds: 3600,
      maxCostTokens: 2000000,
      maxIdlePolls: 8,
    });
  });

  it('honors an explicit --idle-poll override', () => {
    expect(detectDaemonCommand(argv('daemon', '--idle-poll', '30'))).toMatchObject({
      idlePollSeconds: 30,
    });
  });

  it('falls back to defaults when a numeric flag is blank or non-numeric', () => {
    // `--concurrency` with no following value → keeps the default of 1.
    expect(detectDaemonCommand(argv('daemon', '--concurrency'))).toMatchObject({ concurrency: 1 });
    expect(detectDaemonCommand(argv('daemon', '--concurrency', 'abc'))).toMatchObject({
      concurrency: 1,
    });
  });
});
