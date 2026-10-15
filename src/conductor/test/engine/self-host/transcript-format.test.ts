// Covers: task:14
import { describe, expect, it } from 'vitest';
import { findBuiltInProviderDescriptor } from '../../../src/execution/provider-catalog.js';

function extract(providerId: 'claude' | 'codex' | 'pi', lines: readonly string[]): string | undefined {
  const provider = findBuiltInProviderDescriptor(providerId);
  if (!provider?.selfHostShape) throw new Error(`Missing self-host shape for ${providerId}`);
  return provider.selfHostShape.transcripts.extractFinalAssistantMessage(lines);
}

describe('provider final assistant transcript extractors', () => {
  it('extracts the last Claude assistant text and skips a trailing malformed line', () => {
    expect(extract('claude', [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'first' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'last ' }, { type: 'tool_use', name: 'read' }, { type: 'text', text: 'answer' }] } }),
      '{malformed',
    ])).toBe('last answer');
  });

  it('extracts the last Codex assistant output text and skips a trailing malformed line', () => {
    expect(extract('codex', [
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'first' }] } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'last ' }, { type: 'reasoning', text: 'ignored' }, { type: 'output_text', text: 'answer' }] } }),
      '{malformed',
    ])).toBe('last answer');
  });

  it('extracts the last Pi assistant text and skips a trailing malformed line', () => {
    expect(extract('pi', [
      JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'first' }] } }),
      JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'last ' }, { type: 'tool', name: 'read' }, { type: 'text', text: 'answer' }] } }),
      '{malformed',
    ])).toBe('last answer');
  });

  it('returns undefined when no assistant record is present', () => {
    expect(extract('claude', [
      JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'question' }] } }),
      '{malformed',
    ])).toBeUndefined();
  });
});
