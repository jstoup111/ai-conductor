import { describe, expect, it } from 'vitest';

import { ProviderStreamAssembler } from '../../src/execution/provider-stream.js';

describe('ProviderStreamAssembler', () => {
  it('reassembles records split at every byte offset without emitting an unterminated trailing fragment', () => {
    const stream = '{"type":"assistant","id":1}\n{"type":"assistant","id":2}\nnot-json\n{"type":"result","ok":true}\n{"type":"partial"';
    const expected = [
      { type: 'assistant', id: 1 },
      { type: 'assistant', id: 2 },
      { type: 'result', ok: true },
    ];

    expect(
      Array.from({ length: Buffer.byteLength(stream) + 1 }, (_, offset) => {
        const assembler = new ProviderStreamAssembler();
        const chunks = [stream.slice(0, offset), stream.slice(offset)];
        return chunks.flatMap((chunk) => assembler.push(chunk));
      }),
    ).toEqual(Array.from({ length: Buffer.byteLength(stream) + 1 }, () => expected));
  });
});
