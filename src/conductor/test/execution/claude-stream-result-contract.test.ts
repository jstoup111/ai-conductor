import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const fixturePath = fileURLToPath(
  new URL('../fixtures/claude-stream-result-line.json', import.meta.url),
);

type RuntimeTypeName = 'string' | 'number';

function requiredField(value: unknown, path: string, expectedType: RuntimeTypeName): void {
  expect(value, `Claude stream result contract is missing or changed: ${path}`).toBeTypeOf(expectedType);
}

describe('Claude stream terminal result contract', () => {
  it('pins every field consumed from the terminal result line', async () => {
    const result = JSON.parse(await readFile(fixturePath, 'utf8')) as Record<string, unknown>;
    const usage = result.usage as Record<string, unknown>;

    expect(result.type).toBe('result');
    requiredField(result.result, 'result', 'string');
    requiredField(usage.input_tokens, 'usage.input_tokens', 'number');
    requiredField(usage.output_tokens, 'usage.output_tokens', 'number');
    requiredField(usage.cache_read_input_tokens, 'usage.cache_read_input_tokens', 'number');
    requiredField(usage.cache_creation_input_tokens, 'usage.cache_creation_input_tokens', 'number');
    requiredField(result.total_cost_usd, 'total_cost_usd', 'number');
    requiredField(result.num_turns, 'num_turns', 'number');
    requiredField(result.duration_ms, 'duration_ms', 'number');
  });
});
