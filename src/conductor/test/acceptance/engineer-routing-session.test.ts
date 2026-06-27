// Regression: the engineer routing adapter must pass a valid InvokeOptions to the
// real LLMProvider — NOT `{ prompt } as any`.
//
// Bug (surfaced in manual-test): loop.ts built its routing adapter as
//   deps.provider.invoke({ prompt } as any)
// which omitted the REQUIRED `sessionId` and `resume` fields of InvokeOptions.
// The `as any` cast suppressed the compiler error; at runtime the real
// ClaudeProvider emitted `claude --session-id undefined`, which the CLI rejects
// with "Invalid session ID. Must be a valid UUID." Routing then returned zero
// candidates and the loop silently fell through to "create a new project?" even
// with a seeded registry.
//
// This is the same class as retro H-1 (orphaned-primitive / unexercised seam):
// every existing routing test injects a fake provider whose invoke() ignores its
// argument, so the malformed call was never observed. This test drives the REAL
// entry point (runEngineerMode) and asserts the OPTIONS the adapter actually
// hands the provider — making the missing sessionId falsifiable.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { InvokeOptions, InvokeResult } from '../../src/execution/llm-provider.js';

// RFC-4122 v4 UUID (the format `claude --session-id` requires).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function loadLoop(): Promise<{ runEngineerMode: (...args: any[]) => Promise<any> }> {
  return import('../../src/engine/engineer/loop.js') as Promise<{
    runEngineerMode: (...args: any[]) => Promise<any>;
  }>;
}

/** Scripted IO helper. */
function scriptedIo(lines: string[]) {
  const queue = [...lines];
  const out: string[] = [];
  return {
    out,
    io: {
      prompt: async (): Promise<string | null> => (queue.length ? queue.shift()! : null),
      print: (s: string) => out.push(s),
    },
  };
}

/**
 * Capturing provider: records every InvokeOptions it receives and returns a
 * single routing candidate. Conforms to the REAL LLMProvider.invoke(options)
 * signature — so it observes exactly what the adapter passes.
 */
function makeCapturingProvider(projectName: string) {
  const calls: InvokeOptions[] = [];
  return {
    calls,
    invoke: async (options: InvokeOptions): Promise<InvokeResult> => {
      calls.push(options);
      return {
        success: true,
        output: JSON.stringify({
          candidates: [{ name: projectName, score: 0.9, rationale: 'match' }],
        }),
        exitCode: 0,
      };
    },
    invokeInteractive: async (): Promise<void> => {},
  };
}

const noopGh = async (_args: string[], _opts: { cwd: string }) => ({ stdout: '' });

function makeRecord(path: string, name: string) {
  return {
    schemaVersion: 1,
    name,
    path,
    status: 'registered',
    registeredAt: '2026-06-26T00:00:00.000Z',
  };
}

let workDir: string;
let registryPath: string;
let engineerDir: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'routing-session-'));
  registryPath = join(workDir, 'registry.json');
  engineerDir = join(workDir, 'engineer');
  await mkdir(engineerDir, { recursive: true });
  await writeFile(
    registryPath,
    JSON.stringify([makeRecord(join(workDir, 'repo'), 'target-project')], null, 2),
    'utf-8',
  );
  savedEnv.AI_CONDUCTOR_REGISTRY = process.env.AI_CONDUCTOR_REGISTRY;
  savedEnv.AI_CONDUCTOR_ENGINEER_DIR = process.env.AI_CONDUCTOR_ENGINEER_DIR;
  process.env.AI_CONDUCTOR_REGISTRY = registryPath;
  process.env.AI_CONDUCTOR_ENGINEER_DIR = engineerDir;
});

afterEach(async () => {
  process.env.AI_CONDUCTOR_REGISTRY = savedEnv.AI_CONDUCTOR_REGISTRY;
  process.env.AI_CONDUCTOR_ENGINEER_DIR = savedEnv.AI_CONDUCTOR_ENGINEER_DIR;
  await rm(workDir, { recursive: true, force: true });
});

describe('engineer routing adapter — InvokeOptions are well-formed (regression)', () => {
  it('passes a valid-UUID sessionId (never undefined) to provider.invoke', async () => {
    const provider = makeCapturingProvider('target-project');
    const { runEngineerMode } = await loadLoop();
    // Route one idea, then decline the confirmation so no authoring/git is needed.
    const { io } = scriptedIo(['add tag filtering to the notes list', 'n', 'exit']);

    await runEngineerMode({
      provider,
      io,
      gh: noopGh,
      registryPath,
      engineerDir,
    });

    // The adapter MUST have invoked the provider for routing.
    expect(provider.calls.length).toBeGreaterThan(0);

    const opts = provider.calls[0];
    // Falsifiable: with `{ prompt } as any`, sessionId is undefined and fails this.
    expect(opts.sessionId).toMatch(UUID_RE);
    // Routing is a single-shot classification — a fresh session, not a resume.
    expect(opts.resume).toBe(false);
    // The prompt must still be carried through.
    expect(typeof opts.prompt).toBe('string');
    expect(opts.prompt.length).toBeGreaterThan(0);
  });

  it('does not fall through to create-on-no-fit when routing succeeds with a seeded registry', async () => {
    const provider = makeCapturingProvider('target-project');
    const { runEngineerMode } = await loadLoop();
    const { io, out } = scriptedIo(['add tag filtering to the notes list', 'n', 'exit']);

    await runEngineerMode({
      provider,
      io,
      gh: noopGh,
      registryPath,
      engineerDir,
    });

    // With a real candidate, the loop must NOT offer to create a project.
    const combined = out.join('\n');
    expect(combined).not.toMatch(/No matching project found/i);
  });
});
