import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { PipelineCloseoutEvent } from './closeout-events.js';
import type { ConductorEventEmitter } from '../ui/events.js';

const PIPELINE_CLOSEOUT_LEDGER = '.pipeline/pipeline-events.jsonl';

/**
 * Incrementally reads pipeline-owned closeout events without consuming a
 * record that is still being appended.  The offset is measured in bytes so it
 * remains valid for UTF-8 JSON records.
 */
export class CloseoutTailReader {
  private offset = 0;

  constructor(private readonly projectRoot: string) {}

  /** Return each newly completed JSONL record exactly once. */
  async read(): Promise<PipelineCloseoutEvent[]> {
    let content: Buffer;
    try {
      content = await readFile(join(this.projectRoot, PIPELINE_CLOSEOUT_LEDGER));
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }

    if (content.byteLength < this.offset) this.offset = 0;
    const unread = content.subarray(this.offset);
    const lastNewline = unread.lastIndexOf(0x0a);
    if (lastNewline === -1) return [];

    const completed = unread.subarray(0, lastNewline + 1);
    const events = completed
      .toString('utf8')
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as PipelineCloseoutEvent);

    this.offset += completed.byteLength;
    return events;
  }
}

/** Polls the pipeline-owned closeout ledger and re-emits complete records. */
export class CloseoutEventTail {
  private readonly reader: CloseoutTailReader;
  private readonly events: ConductorEventEmitter;
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor({
    projectRoot,
    events,
  }: {
    projectRoot: string;
    events: ConductorEventEmitter;
  }) {
    this.reader = new CloseoutTailReader(projectRoot);
    this.events = events;
  }

  async poll(): Promise<void> {
    for (const event of await this.reader.read()) {
      await this.events.emit(event);
    }
  }

  /** Start background polling; lifecycle ownership stays with the conductor. */
  start(): void {
    if (this.interval) return;

    this.interval = setInterval(() => {
      void this.poll();
    }, 1_000);
    this.interval.unref();
  }

  /** Stop background polling once the owning build attempt has settled. */
  stop(): void {
    if (!this.interval) return;
    clearInterval(this.interval);
    this.interval = null;
  }
}
