import type { Writable } from 'node:stream';

/**
 * A "sticky" bottom region of the terminal that can be rewritten in place
 * without accumulating copies. Transient log lines ("Step foo started")
 * can still be printed above it; each log() call clears the sticky region,
 * writes the log line, then redraws the sticky lines underneath.
 *
 * Implementation: ANSI cursor control (cursor-up + clear-line) — no ink,
 * no external deps. Falls back to plain append-mode when stdout is not
 * a TTY (CI, piped output, test harnesses).
 */
export interface LiveRegion {
  /**
   * Replace the sticky region's content with `lines`. No-op if identical to
   * the last render (avoids pointless flicker).
   */
  update(lines: string[]): void;
  /**
   * Clear the sticky region without replacing it.
   */
  clear(): void;
  /**
   * Print a permanent log line above the sticky region. The region is cleared,
   * the log line is printed, then the region is redrawn below.
   */
  log(line: string): void;
  /**
   * Temporarily clear the sticky region so a subprocess (e.g., an interactive
   * Claude session) owns the terminal. `resume()` redraws what was there.
   */
  suspend(): void;
  /**
   * Redraw the sticky region after suspend().
   */
  resume(): void;
  /**
   * Stop managing the region; leave final content visible.
   */
  stop(): void;
}

export interface LiveRegionOptions {
  /**
   * Output stream. Defaults to process.stdout.
   */
  stream?: Writable;
  /**
   * Force TTY behavior even when the stream reports otherwise (useful for tests).
   */
  forceTTY?: boolean;
}

const ANSI_CURSOR_UP = (n: number): string => `\x1b[${n}A`;
const ANSI_CLEAR_LINE = '\x1b[2K';
const ANSI_CURSOR_START = '\r';

export function createLiveRegion(options: LiveRegionOptions = {}): LiveRegion {
  const stream = options.stream ?? process.stdout;
  const isTTY = options.forceTTY ?? Boolean((stream as NodeJS.WriteStream).isTTY);

  let lastLines: string[] = [];
  let suspended = false;

  function write(s: string): void {
    stream.write(s);
  }

  function renderLines(lines: string[]): void {
    for (const line of lines) {
      write(line);
      write('\n');
    }
  }

  function eraseRegion(): void {
    if (lastLines.length === 0) return;
    // Move up to the first rendered line and clear each downward.
    // After the last render, the cursor is on the line AFTER the final
    // rendered line, so we move up lastLines.length to reach the first.
    write(ANSI_CURSOR_START);
    write(ANSI_CURSOR_UP(lastLines.length));
    for (let i = 0; i < lastLines.length; i++) {
      write(ANSI_CLEAR_LINE);
      if (i < lastLines.length - 1) write('\n');
    }
    // Cursor is now on the last cleared line; move back to column 0 and
    // up to the first cleared line so subsequent writes start there.
    write(ANSI_CURSOR_START);
    if (lastLines.length > 1) write(ANSI_CURSOR_UP(lastLines.length - 1));
  }

  return {
    update(lines: string[]): void {
      if (suspended) {
        // Record what would have rendered so resume() can redraw it.
        lastLines = lines;
        return;
      }
      if (!isTTY) {
        // Non-TTY: just print once. Skip if identical to last render.
        if (arraysEqual(lines, lastLines)) return;
        renderLines(lines);
        lastLines = lines;
        return;
      }
      if (arraysEqual(lines, lastLines)) return;
      eraseRegion();
      renderLines(lines);
      lastLines = lines;
    },

    clear(): void {
      if (suspended) {
        lastLines = [];
        return;
      }
      if (isTTY) eraseRegion();
      lastLines = [];
    },

    log(line: string): void {
      if (suspended || !isTTY) {
        write(line);
        write('\n');
        return;
      }
      const snapshot = lastLines;
      eraseRegion();
      lastLines = [];
      write(line);
      write('\n');
      if (snapshot.length > 0) {
        renderLines(snapshot);
        lastLines = snapshot;
      }
    },

    suspend(): void {
      if (suspended) return;
      if (isTTY) eraseRegion();
      suspended = true;
    },

    resume(): void {
      if (!suspended) return;
      suspended = false;
      if (isTTY && lastLines.length > 0) {
        const snapshot = lastLines;
        lastLines = [];
        renderLines(snapshot);
        lastLines = snapshot;
      }
    },

    stop(): void {
      // Leave last content visible. Nothing else to do — the cursor is already
      // positioned below the final render.
      suspended = false;
    },
  };
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
