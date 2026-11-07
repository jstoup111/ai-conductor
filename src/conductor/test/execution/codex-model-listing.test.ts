// Covers: task:1
import { describe, expect, it } from 'vitest';
import { parseCodexModelListing } from '../../src/execution/codex-provider.js';

const fullListing = JSON.stringify({
  models: [
    { slug: 'gpt-6.1-sol', visibility: 'list', supported_in_api: true },
    { slug: 'gpt-6-astra', visibility: 'list', supported_in_api: true },
    { slug: 'gpt-6-sol', visibility: 'list', supported_in_api: true },
    { slug: 'gpt-6-luna', visibility: 'list', supported_in_api: true },
    { slug: 'gpt-5.6-sol', visibility: 'list', supported_in_api: true },
    { slug: 'gpt-5.6-terra', visibility: 'list', supported_in_api: true },
    { slug: 'gpt-5.6-luna', visibility: 'list', supported_in_api: true },
    { slug: 'gpt-6-chat-thinking', visibility: 'list', supported_in_api: false },
    { slug: 'gpt-reserve', visibility: 'list', supported_in_api: false },
    { slug: 'codex-auto-review', visibility: 'list', supported_in_api: false },
    { slug: 'gpt-7-sol', visibility: 'hide', supported_in_api: true },
    { slug: 'gpt-7.1-sol', visibility: 'list', supported_in_api: false },
  ],
});

describe('parseCodexModelListing', () => {
  it('keeps only list-visible models supported in the API', () => {
    expect(parseCodexModelListing(fullListing)).toEqual({
      kind: 'parsed',
      modelIds: [
        'gpt-6.1-sol',
        'gpt-6-astra',
        'gpt-6-sol',
        'gpt-6-luna',
        'gpt-5.6-sol',
        'gpt-5.6-terra',
        'gpt-5.6-luna',
      ],
    });
  });

  it('returns the first line for non-JSON output', () => {
    expect(parseCodexModelListing('not json\ntry again later')).toEqual({
      kind: 'unparseable',
      firstLine: 'not json',
    });
  });

  it('returns unparseable when JSON has no models array', () => {
    expect(parseCodexModelListing(JSON.stringify({ model: [] }))).toEqual({
      kind: 'unparseable',
      firstLine: '{"model":[]}',
    });
  });
});
