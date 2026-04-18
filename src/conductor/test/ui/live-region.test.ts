import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { createLiveRegion } from '../../src/ui/live-region.js';

/**
 * Captures every write() to a string, preserving ANSI escape sequences so
 * tests can assert on cursor-up / clear-line behavior.
 */
class CaptureStream extends Writable {
  chunks: string[] = [];
  _write(chunk: Buffer | string, _encoding: string, cb: (err?: Error | null) => void): void {
    this.chunks.push(chunk.toString());
    cb();
  }
  output(): string {
    return this.chunks.join('');
  }
}

describe('live-region', () => {
  describe('non-TTY (forceTTY=false)', () => {
    it('appends lines to the stream on update', () => {
      const stream = new CaptureStream();
      const region = createLiveRegion({ stream, forceTTY: false });
      region.update(['line 1', 'line 2']);
      expect(stream.output()).toBe('line 1\nline 2\n');
    });

    it('re-renders only when content changes', () => {
      const stream = new CaptureStream();
      const region = createLiveRegion({ stream, forceTTY: false });
      region.update(['a', 'b']);
      region.update(['a', 'b']);
      // Second update is identical — skipped
      expect(stream.output()).toBe('a\nb\n');
    });

    it('log() appends a transcript line', () => {
      const stream = new CaptureStream();
      const region = createLiveRegion({ stream, forceTTY: false });
      region.update(['dash 1']);
      region.log('hello');
      // Non-TTY: log just writes the line
      expect(stream.output()).toContain('hello\n');
    });
  });

  describe('TTY mode (forceTTY=true)', () => {
    const CURSOR_UP_RE = /\x1b\[\d+A/;
    const CLEAR_LINE = '\x1b[2K';

    it('first update just writes lines (no erase sequence)', () => {
      const stream = new CaptureStream();
      const region = createLiveRegion({ stream, forceTTY: true });
      region.update(['a', 'b']);
      expect(stream.output()).toMatch(/^a\nb\n$/);
    });

    it('second update erases previous lines before writing new ones', () => {
      const stream = new CaptureStream();
      const region = createLiveRegion({ stream, forceTTY: true });
      region.update(['old 1', 'old 2']);
      stream.chunks = [];
      region.update(['new 1', 'new 2']);
      const out = stream.output();
      expect(out).toMatch(CURSOR_UP_RE); // moved up to start
      expect(out).toContain(CLEAR_LINE); // cleared the old lines
      expect(out).toContain('new 1');
      expect(out).toContain('new 2');
      expect(out).not.toContain('old 1');
    });

    it('skips re-render when content is unchanged', () => {
      const stream = new CaptureStream();
      const region = createLiveRegion({ stream, forceTTY: true });
      region.update(['same']);
      stream.chunks = [];
      region.update(['same']);
      expect(stream.output()).toBe('');
    });

    it('log() clears the region, prints the line, then restores the region below', () => {
      const stream = new CaptureStream();
      const region = createLiveRegion({ stream, forceTTY: true });
      region.update(['dash']);
      stream.chunks = [];
      region.log('transient event');
      const out = stream.output();
      // Erase sequence (cursor up + clear), log line, then redraw "dash"
      expect(out).toMatch(CURSOR_UP_RE);
      expect(out).toContain(CLEAR_LINE);
      expect(out).toContain('transient event\n');
      expect(out).toContain('dash\n');
      // Log line appears BEFORE the redrawn dashboard
      expect(out.indexOf('transient event')).toBeLessThan(out.lastIndexOf('dash'));
    });

    it('suspend() clears the region; resume() redraws', () => {
      const stream = new CaptureStream();
      const region = createLiveRegion({ stream, forceTTY: true });
      region.update(['hello']);
      stream.chunks = [];
      region.suspend();
      const afterSuspend = stream.output();
      expect(afterSuspend).toContain(CLEAR_LINE);

      stream.chunks = [];
      region.resume();
      expect(stream.output()).toContain('hello\n');
    });

    it('update() while suspended does not write, but resume() reflects latest content', () => {
      const stream = new CaptureStream();
      const region = createLiveRegion({ stream, forceTTY: true });
      region.update(['start']);
      region.suspend();
      stream.chunks = [];
      region.update(['updated during suspension']);
      expect(stream.output()).toBe('');
      region.resume();
      expect(stream.output()).toContain('updated during suspension');
    });

    it('clear() wipes the region and forgets its content', () => {
      const stream = new CaptureStream();
      const region = createLiveRegion({ stream, forceTTY: true });
      region.update(['something']);
      stream.chunks = [];
      region.clear();
      expect(stream.output()).toContain(CLEAR_LINE);
      // After clear(), resume() should write nothing
      stream.chunks = [];
      region.resume();
      expect(stream.output()).toBe('');
    });
  });
});
