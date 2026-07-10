import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'fixtures', 'session-hook-payloads');

interface PreDispatchToolInput {
  description: string;
  prompt: string;
}

interface PreDispatchPayload {
  session_id: string;
  transcript_path: string;
  cwd: string;
  prompt_id: string;
  permission_mode: string;
  hook_event_name: string;
  tool_name: string;
  tool_input: PreDispatchToolInput;
  tool_use_id: string;
}

/**
 * Loads a real captured PreToolUse payload fixture from the 2026-07-10 #477
 * spike session and optionally overrides `tool_input.prompt` so scenario
 * tests can vary the prompt while staying anchored to the real payload shape.
 */
function loadPreDispatchPayload(
  fixtureName: string,
  overrides: { prompt?: string } = {},
): PreDispatchPayload {
  const raw = readFileSync(join(FIXTURES_DIR, fixtureName), 'utf-8');
  const payload = JSON.parse(raw) as PreDispatchPayload;
  if (overrides.prompt !== undefined) {
    payload.tool_input = { ...payload.tool_input, prompt: overrides.prompt };
  }
  return payload;
}

describe('session-hook-behavior fixtures', () => {
  const fixtures: Array<[string, string]> = [
    ['pre-dispatch-task-id.json', 'Task: 7 — reply with the single word done'],
    ['pre-dispatch-settings-local.json', 'Task: 9 — reply with the single word done'],
  ];

  it.each(fixtures)('%s loads with the verbatim spike payload shape', (fixtureName, prompt) => {
    const payload = loadPreDispatchPayload(fixtureName);

    expect(payload.hook_event_name).toBe('PreToolUse');
    expect(payload.tool_name).toBe('Agent');
    expect(payload.permission_mode).toBe('default');
    expect(payload.tool_input.description).toBe('Launch general-purpose subagent');
    expect(payload.tool_input.prompt).toBe(prompt);
    expect(typeof payload.session_id).toBe('string');
    expect(payload.session_id.length).toBeGreaterThan(0);
    expect(typeof payload.tool_use_id).toBe('string');
    expect(payload.tool_use_id.startsWith('toolu_')).toBe(true);
  });

  it('loader overrides tool_input.prompt without mutating other fields', () => {
    const base = loadPreDispatchPayload('pre-dispatch-task-id.json');
    const overridden = loadPreDispatchPayload('pre-dispatch-task-id.json', {
      prompt: 'Task: 42 — reply with the single word done',
    });

    expect(overridden.tool_input.prompt).toBe('Task: 42 — reply with the single word done');
    expect(overridden.tool_input.description).toBe(base.tool_input.description);
    expect(overridden.session_id).toBe(base.session_id);
    expect(base.tool_input.prompt).toBe('Task: 7 — reply with the single word done');
  });

  it('loader throws for a nonexistent fixture', () => {
    expect(() => loadPreDispatchPayload('does-not-exist.json')).toThrow();
  });
});
