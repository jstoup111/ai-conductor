import { Writable } from 'node:stream';

import { renderDaemonEvent } from '../../src/daemon-cli.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductorEvent } from '../../src/types/events.js';
import { createLiveRegion } from '../../src/ui/live-region.js';
import { TerminalRenderer } from '../../src/ui/terminal-renderer.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

class CaptureStream extends Writable {
  private chunks: string[] = [];

  override _write(chunk: Buffer | string, _encoding: string, callback: (error?: Error | null) => void): void {
    this.chunks.push(chunk.toString());
    callback();
  }

  output(): string {
    return this.chunks.join('');
  }
}

/** Real event bus plus both production live renderers, with no provider process. */
export function createProviderStartSurfaces() {
  const events = new ConductorEventEmitter();
  const daemon: string[] = [];
  const stream = new CaptureStream();
  const terminal = new TerminalRenderer({
    stateFilePath: '/tmp/provider-start-test-state.json',
    steps: ALL_STEPS,
    readStateFn: async () => ({ ok: true, value: {} }),
    liveRegion: createLiveRegion({ stream, forceTTY: false }),
  });
  events.on('provider_attempt_started', (event) => {
    renderDaemonEvent(event, (line) => daemon.push(line));
    return terminal.handle(event);
  });
  events.on('provider_fallback', (event) => {
    renderDaemonEvent(event, (line) => daemon.push(line));
    return terminal.handle(event);
  });
  events.on('step_completed', (event) => terminal.handle(event));

  return {
    events,
    daemon: () => daemon.join('\n'),
    terminal: () => stream.output(),
    emit: (event: ConductorEvent) => events.emit(event),
  };
}

export function providerStart(
  step: Extract<ConductorEvent, { type: 'provider_attempt_started' }>['step'],
  id: string,
  executionContext?: Extract<ConductorEvent, { type: 'provider_attempt_started' }>['executionContext'],
  model?: string,
): Extract<ConductorEvent, { type: 'provider_attempt_started' }> {
  return {
    type: 'provider_attempt_started', step, provider: { kind: 'known', id },
    ...(executionContext ? { executionContext } : {}),
    ...(model ? { model } : {}),
  };
}

export function member(group: string, name: string) {
  return {
    executionId: `${group}-${name}`,
    subject: { kind: 'configured-member' as const, parentGroup: group, member: name },
  };
}
