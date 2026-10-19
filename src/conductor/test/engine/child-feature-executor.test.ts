// Covers: task:17, task:18

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { createChildProcessFeatureExecutor, type ForkedExecutor } from '../../src/engine/child-feature-executor.js';
import type { WorkOrder } from '../../src/engine/work-order.js';

const VERSION = '20261019T120000Z-aaaaaaaaaaaa' as WorkOrder['engineVersionId'];
const VERSION_TWO = '20261019T120001Z-bbbbbbbbbbbb' as WorkOrder['engineVersionId'];
const order: WorkOrder = {
  schemaVersion: 1,
  repository: 'repo',
  slug: 'feature',
  baseSha: 'a'.repeat(40),
  engineVersionId: VERSION,
  pinFallbackReason: 'publish-incomplete',
  manifest: [],
};

let root: string | undefined;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = undefined; });

describe('child feature executor dispatch lifecycle', () => {
  it('publishes its immutable pin at fork, sends the order only after hello, and removes it only on exit', async () => {
    root = await mkdtemp(join(tmpdir(), 'child-executor-'));
    const messages = new Map<string, Array<(value?: unknown) => void>>();
    let exit: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;
    const sent: unknown[] = [];
    const child: ForkedExecutor = {
      pid: 42,
      send(value) {
        sent.push(value);
        return true;
      },
      on(event, listener) { (messages.get(event) ?? messages.set(event, []).get(event)!).push(listener); return this; },
      once(_event, listener) { exit = listener; return this; },
      kill() { return true; },
    };
    const events = new ConductorEventEmitter();
    const emitted: Array<Record<string, unknown>> = [];
    events.on('feature_dispatch_started', (event) => { emitted.push(event as Record<string, unknown>); });
    events.on('feature_dispatch_ended', (event) => { emitted.push(event as Record<string, unknown>); });
    let modulePath = '';
    const executor = createChildProcessFeatureExecutor({
      projectRoot: root,
      engineDirForOrder: () => `/store/dist-versions/${VERSION}`,
      supervisorEngineVersionId: VERSION,
      rootEvents: events,
      attachBroker: () => ({ events, close() {} }),
      fork: (path) => { modulePath = path; return child; },
    });

    const execution = executor.execute(order);
    await vi.waitFor(() => expect(modulePath).toBe(`/store/dist-versions/${VERSION}/index.js`));
    await vi.waitFor(async () => {
      const record = JSON.parse(await readFile(join(root!, '.daemon', 'executors', 'feature.json'), 'utf8')) as Record<string, unknown>;
      expect(record).toMatchObject({ pid: 42, engineDir: `/store/dist-versions/${VERSION}`, engineVersionId: VERSION });
    });
    expect(sent).toEqual([]);

    for (const listener of messages.get('message') ?? []) listener({ kind: 'hello', protocolVersion: 1, engineVersionId: VERSION });
    await vi.waitFor(() => expect(sent).toEqual([expect.objectContaining({ kind: 'work-order', order: expect.objectContaining(order) })]));
    for (const listener of messages.get('message') ?? []) listener({ kind: 'outcome', outcome: { slug: 'feature', status: 'done' } });

    // A terminal outcome does not prove process exit: retain the pin until
    // the child actually terminates so engine-store GC remains safe.
    await expect(readFile(join(root, '.daemon', 'executors', 'feature.json'), 'utf8')).resolves.toContain(VERSION);
    exit?.(0, null);
    await expect(execution).resolves.toMatchObject({ slug: 'feature', status: 'done' });
    await expect(readFile(join(root, '.daemon', 'executors', 'feature.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(emitted).toEqual([
      expect.objectContaining({ type: 'feature_dispatch_started', engineVersionId: VERSION, pinFallbackReason: 'publish-incomplete' }),
      expect.objectContaining({ type: 'feature_dispatch_ended', outcome: 'complete' }),
    ]);
  });

  it('launches concurrent orders from their separate immutable engine pins', async () => {
    root = await mkdtemp(join(tmpdir(), 'child-executor-'));
    const launchedPaths: string[] = [];
    const children = new Map<string, {
      child: ForkedExecutor;
      messages: Array<(value?: unknown) => void>;
      exit: () => void;
      sent: unknown[];
    }>();
    const makeChild = (slug: string) => {
      const messages: Array<(value?: unknown) => void> = [];
      const sent: unknown[] = [];
      let onExit: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;
      const child: ForkedExecutor = {
        pid: children.size + 100,
        send(message) { sent.push(message); return true; },
        on(event, listener) { if (event === 'message') messages.push(listener); return this; },
        once(_event, listener) { onExit = listener; return this; },
        kill() { return true; },
      };
      children.set(slug, { child, messages, sent, exit: () => onExit?.(0, null) });
      return child;
    };
    const events = new ConductorEventEmitter();
    const executor = createChildProcessFeatureExecutor({
      projectRoot: root,
      engineDirForOrder: (item) => `/store/dist-versions/${item.engineVersionId}`,
      supervisorEngineVersionId: VERSION,
      rootEvents: events,
      attachBroker: () => ({ events, close() {} }),
      fork: (path) => {
        launchedPaths.push(path);
        return makeChild(launchedPaths.length === 1 ? 'v1' : 'v2');
      },
    });
    const first = executor.execute({ ...order, slug: 'v1' });
    const second = executor.execute({ ...order, slug: 'v2', engineVersionId: VERSION_TWO });

    await vi.waitFor(() => expect(children.size).toBe(2));
    for (const [slug, version] of [['v1', VERSION], ['v2', VERSION_TWO]] as const) {
      const state = children.get(slug)!;
      for (const listener of state.messages) listener({ kind: 'hello', protocolVersion: 1, engineVersionId: version });
      await vi.waitFor(() => expect(state.sent).toEqual([expect.objectContaining({ kind: 'work-order', order: expect.objectContaining({ engineVersionId: version }) })]));
    }
    expect(launchedPaths).toEqual([
      `/store/dist-versions/${VERSION}/index.js`,
      `/store/dist-versions/${VERSION_TWO}/index.js`,
    ]);

    for (const slug of ['v1', 'v2']) {
      const state = children.get(slug)!;
      for (const listener of state.messages) listener({ kind: 'outcome', outcome: { slug, status: 'done' } });
      state.exit();
    }
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ slug: 'v1', status: 'done' }),
      expect.objectContaining({ slug: 'v2', status: 'done' }),
    ]);
  });

  it('relaunches a protocol mismatch on the supervisor pin and requests a restart only through the armed callback', async () => {
    root = await mkdtemp(join(tmpdir(), 'child-executor-'));
    const children: Array<{
      messages: Array<(value?: unknown) => void>;
      sent: unknown[];
      kills: NodeJS.Signals[];
      exit: () => void;
    }> = [];
    const launched: string[] = [];
    const makeChild = (): ForkedExecutor => {
      const messages: Array<(value?: unknown) => void> = [];
      const sent: unknown[] = [];
      const kills: NodeJS.Signals[] = [];
      let onExit: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;
      children.push({ messages, sent, kills, exit: () => onExit?.(0, null) });
      return {
        pid: 200 + children.length,
        send(message) { sent.push(message); return true; },
        on(event, listener) { if (event === 'message') messages.push(listener); return this; },
        once(_event, listener) { onExit = listener; return this; },
        kill(signal = 'SIGTERM') { kills.push(signal); return true; },
      };
    };
    const events = new ConductorEventEmitter();
    const mismatches: Array<Record<string, unknown>> = [];
    events.on('executor_protocol_mismatch', (event) => { mismatches.push(event as Record<string, unknown>); });
    const mismatchRequested = vi.fn(() => true);
    const executor = createChildProcessFeatureExecutor({
      projectRoot: root,
      engineDirForOrder: (_order, supervisor) => supervisor
        ? `/store/dist-versions/${VERSION_TWO}`
        : `/store/dist-versions/${VERSION}`,
      supervisorEngineVersionId: VERSION_TWO,
      rootEvents: events,
      attachBroker: () => ({ events, close() {} }),
      fork: (path) => { launched.push(path); return makeChild(); },
      onProtocolMismatch: mismatchRequested,
    });

    const execution = executor.execute(order);
    await vi.waitFor(() => expect(children).toHaveLength(1));
    for (const listener of children[0]!.messages) listener({ kind: 'hello', protocolVersion: 2, engineVersionId: VERSION });
    expect(children[0]!.sent).toEqual([]);
    expect(children[0]!.kills).toEqual(['SIGTERM']);
    children[0]!.exit();

    await vi.waitFor(() => expect(children).toHaveLength(2));
    expect(launched).toEqual([
      `/store/dist-versions/${VERSION}/index.js`,
      `/store/dist-versions/${VERSION_TWO}/index.js`,
    ]);
    expect(mismatchRequested).toHaveBeenCalledOnce();
    expect(mismatches).toEqual([
      expect.objectContaining({
        type: 'executor_protocol_mismatch',
        engineVersionId: VERSION,
        expectedProtocolVersion: 1,
        actualProtocolVersion: 2,
        restartRequested: true,
      }),
    ]);
    for (const listener of children[1]!.messages) listener({ kind: 'hello', protocolVersion: 1, engineVersionId: VERSION_TWO });
    await vi.waitFor(() => expect(children[1]!.sent).toEqual([
      expect.objectContaining({ kind: 'work-order', order: expect.objectContaining({ engineVersionId: VERSION_TWO, supervisorEngineVersionId: VERSION_TWO }) }),
    ]));
    await expect(readFile(join(root, '.daemon', 'executors', 'feature.json'), 'utf8')).resolves.toContain(VERSION_TWO);
    for (const listener of children[1]!.messages) listener({ kind: 'outcome', outcome: { slug: 'feature', status: 'done' } });
    children[1]!.exit();
    await expect(execution).resolves.toMatchObject({ status: 'done' });
  });

  it('treats a malformed hello as an unarmed mismatch and relaunches without requesting a restart', async () => {
    root = await mkdtemp(join(tmpdir(), 'child-executor-'));
    const children: Array<{ messages: Array<(value?: unknown) => void>; exit: () => void }> = [];
    const makeChild = (): ForkedExecutor => {
      const messages: Array<(value?: unknown) => void> = [];
      let onExit: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;
      children.push({ messages, exit: () => onExit?.(0, null) });
      return {
        pid: 300 + children.length,
        send() { return true; },
        on(event, listener) { if (event === 'message') messages.push(listener); return this; },
        once(_event, listener) { onExit = listener; return this; },
        kill() { return true; },
      };
    };
    const events = new ConductorEventEmitter();
    const mismatches: Array<Record<string, unknown>> = [];
    events.on('executor_protocol_mismatch', (event) => { mismatches.push(event as Record<string, unknown>); });
    const requestRestart = vi.fn(() => false);
    const executor = createChildProcessFeatureExecutor({
      projectRoot: root,
      engineDirForOrder: (_order, supervisor) => `/store/dist-versions/${supervisor ? VERSION_TWO : VERSION}`,
      supervisorEngineVersionId: VERSION_TWO,
      rootEvents: events,
      attachBroker: () => ({ events, close() {} }),
      fork: () => makeChild(),
      onProtocolMismatch: requestRestart,
    });

    const execution = executor.execute(order);
    await vi.waitFor(() => expect(children).toHaveLength(1));
    for (const listener of children[0]!.messages) listener({ kind: 'hello', protocolVersion: 'not-a-number', engineVersionId: VERSION });
    children[0]!.exit();
    await vi.waitFor(() => expect(children).toHaveLength(2));
    expect(requestRestart).toHaveBeenCalledOnce();
    expect(mismatches).toEqual([expect.objectContaining({ restartRequested: false, reason: expect.stringContaining('malformed executor startup handshake') })]);
    children[1]!.exit();
    await expect(execution).resolves.toMatchObject({ status: 'error' });
  });

  it('returns a missing-hello error without relaunching', async () => {
    root = await mkdtemp(join(tmpdir(), 'child-executor-'));
    let exit: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;
    const kill = vi.fn(() => true);
    const executor = createChildProcessFeatureExecutor({
      projectRoot: root,
      engineDirForOrder: () => `/store/dist-versions/${VERSION}`,
      supervisorEngineVersionId: VERSION,
      rootEvents: new ConductorEventEmitter(),
      attachBroker: () => ({ events: new ConductorEventEmitter(), close() {} }),
      fork: () => ({
        pid: 400,
        send() { return true; },
        on() { return this; },
        once(_event, listener) { exit = listener; return this; },
        kill,
      }),
      dispatchStartTimeoutMs: 1,
    });

    vi.useFakeTimers();
    try {
      const execution = executor.execute(order);
      await vi.advanceTimersByTimeAsync(1);
      expect(kill).toHaveBeenCalledWith('SIGTERM');
      exit?.(0, null);
      await expect(execution).resolves.toMatchObject({ status: 'error', reason: 'executor missing startup handshake' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports both handshake failures and never forks a third executor', async () => {
    root = await mkdtemp(join(tmpdir(), 'child-executor-'));
    const children: Array<{ messages: Array<(value?: unknown) => void>; exit: () => void }> = [];
    const fork = vi.fn((): ForkedExecutor => {
      const messages: Array<(value?: unknown) => void> = [];
      let onExit: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;
      children.push({ messages, exit: () => onExit?.(0, null) });
      return {
        pid: 500 + children.length,
        send() { return true; },
        on(event, listener) { if (event === 'message') messages.push(listener); return this; },
        once(_event, listener) { onExit = listener; return this; },
        kill() { return true; },
      };
    });
    const executor = createChildProcessFeatureExecutor({
      projectRoot: root,
      engineDirForOrder: (_order, supervisor) => `/store/dist-versions/${supervisor ? VERSION_TWO : VERSION}`,
      supervisorEngineVersionId: VERSION_TWO,
      rootEvents: new ConductorEventEmitter(),
      attachBroker: () => ({ events: new ConductorEventEmitter(), close() {} }),
      fork,
    });

    const execution = executor.execute(order);
    await vi.waitFor(() => expect(children).toHaveLength(1));
    for (const listener of children[0]!.messages) listener({ kind: 'hello', protocolVersion: 2, engineVersionId: VERSION });
    children[0]!.exit();
    await vi.waitFor(() => expect(children).toHaveLength(2));
    for (const listener of children[1]!.messages) listener({ kind: 'hello', protocolVersion: 'invalid', engineVersionId: VERSION_TWO });
    children[1]!.exit();
    await expect(execution).resolves.toMatchObject({
      status: 'error',
      reason: expect.stringContaining('expected 1, received 2'),
    });
    const outcome = await execution;
    expect(outcome.reason).toContain('malformed executor startup handshake');
    expect(fork).toHaveBeenCalledTimes(2);
  });
});
