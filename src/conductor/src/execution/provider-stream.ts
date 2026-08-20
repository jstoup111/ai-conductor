/**
 * Reassembles newline-delimited JSON records from arbitrary stdout chunks.
 * Incomplete trailing data remains buffered until a later chunk completes it.
 */
export class ProviderStreamAssembler {
  private buffer = '';

  push(chunk: string): unknown[] {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    return lines.flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  }
}
