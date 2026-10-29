// Covers: task:1
import { describe, expect, it } from 'vitest';
import {
  createDaemonModeLogger,
  createFeatureDaemonLogger,
  formatDaemonLogLine,
} from '../../src/engine/daemon-log.js';

const at = new Date('2026-10-29T00:00:00.000Z');

function buildLoggers() {
  const live: string[] = [];
  const persisted: string[] = [];
  const baseLog = createDaemonModeLogger({
    writeLive: (line) => live.push(line),
    writePersisted: (line) => persisted.push(formatDaemonLogLine(line, at)),
  });
  return { live, persisted, baseLog };
}

describe('daemon logger line shape', () => {
  it('strips leading whitespace from a feature line in both sinks', () => {
    const { live, persisted, baseLog } = buildLoggers();

    createFeatureDaemonLogger('feature-a', baseLog)('   ! [rejected] x');

    expect(live).toEqual(['[daemon][feature-a] ! [rejected] x']);
    expect(persisted).toEqual(['2026-10-29T00:00:00.000Z [daemon][feature-a] ! [rejected] x']);
  });

  it('keeps a repository-wide message byte-identical without a marker', () => {
    const { persisted, baseLog } = buildLoggers();
    const message = 'progress re-kick: feature-a retained — halt disposition needs-human';

    baseLog(message);

    expect(persisted).toEqual([`2026-10-29T00:00:00.000Z [daemon] ${message}`]);
  });

  it('uses continuation bodies without changing later-line content', () => {
    const { persisted, baseLog } = buildLoggers();

    baseLog('first\n ! [rejected]        HEAD -> feat/x (non-fast-forward)');

    expect(persisted).toEqual([
      '2026-10-29T00:00:00.000Z [daemon] first',
      '2026-10-29T00:00:00.000Z [daemon] │  ! [rejected]        HEAD -> feat/x (non-fast-forward)',
    ]);
  });

  it('renders blank middle lines and drops one trailing newline', () => {
    const { persisted, baseLog } = buildLoggers();

    baseLog('alpha\n\nbeta\n');

    expect(persisted).toEqual([
      '2026-10-29T00:00:00.000Z [daemon] alpha',
      '2026-10-29T00:00:00.000Z [daemon] │',
      '2026-10-29T00:00:00.000Z [daemon] │ beta',
    ]);
  });

  it('still suppresses a repeated feature start message', () => {
    const { live, persisted, baseLog } = buildLoggers();
    const featureLog = createFeatureDaemonLogger('feature-a', baseLog);

    featureLog('▶ start feature-a');
    featureLog('▶ start feature-a');

    expect(live).toEqual(['[daemon][feature-a] ▶ start feature-a']);
    expect(persisted).toEqual([
      '2026-10-29T00:00:00.000Z [daemon][feature-a] ▶ start feature-a',
    ]);
  });
});
