// Covers: task:7
import { describe, expect, it } from 'vitest';
import { attachFeatureEventRenderer, renderDaemonEvent } from '../src/daemon-cli.js';
import { renderedEventTypes } from '../src/engine/event-sinks.js';
import { ConductorEventEmitter } from '../src/ui/events.js';

describe('daemon bot co-author skip rendering', () => {
  it('subscribes the feature daemon logger to token-unavailable skips', async () => {
    const featureEvents = new ConductorEventEmitter();
    const featureLog: string[] = [];
    const detach = attachFeatureEventRenderer(featureEvents, (line) => featureLog.push(line));

    await featureEvents.emit({ type: 'bot_co_author_skipped', reason: 'token-unavailable' });
    detach();

    expect(featureLog).toHaveLength(1);
    expect(featureLog[0]).toContain('bot co-author skipped: token unavailable');
  });

  it('declares bot co-author skips renderable', () => {
    expect(renderedEventTypes()).toContain('bot_co_author_skipped');
  });

  it.each([
    ['token-unavailable', 'bot co-author skipped: token unavailable'],
    ['identity-read-failed', 'bot co-author skipped: identity read failed'],
    ['worktree-write-failed', 'bot co-author skipped: worktree setup failed'],
    ['resolver-absent', 'bot co-author skipped: resolver not installed for daemon dispatch'],
  ] as const)('renders %s exactly once', (reason, renderedReason) => {
    const log: string[] = [];

    renderDaemonEvent({ type: 'bot_co_author_skipped', reason }, (line) => log.push(line));

    expect(log).toHaveLength(1);
    expect(log[0]).toContain(renderedReason);
  });
});
