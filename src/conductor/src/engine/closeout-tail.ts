import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ExternalPipelineEvent } from './closeout-events.js';
import type { ConductorEventEmitter } from '../ui/events.js';

const PIPELINE_CLOSEOUT_LEDGER = '.pipeline/pipeline-events.jsonl';

type TailRecord =
  | { kind: 'event'; event: ExternalPipelineEvent }
  | { kind: 'malformed-line'; byteOffset: number };

/**
 * Incrementally reads pipeline-owned closeout events without consuming a
 * record that is still being appended.  The offset is measured in bytes so it
 * remains valid for UTF-8 JSON records.
 */
class CloseoutTailReader {
  private offset = 0;

  constructor(
    private readonly projectRoot: string,
    private readonly readLedger: (path: string) => Promise<Buffer> = readFile,
  ) {}

  /** Return each newly completed JSONL record exactly once. */
  async read(): Promise<TailRecord[]> {
    let content: Buffer;
    try {
      content = await this.readLedger(join(this.projectRoot, PIPELINE_CLOSEOUT_LEDGER));
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }

    if (content.byteLength < this.offset) this.offset = 0;
    const unread = content.subarray(this.offset);
    const lastNewline = unread.lastIndexOf(0x0a);
    if (lastNewline === -1) return [];

    const completed = unread.subarray(0, lastNewline + 1);
    const records: TailRecord[] = [];
    let lineStart = 0;
    while (lineStart < completed.byteLength) {
      const lineEnd = completed.indexOf(0x0a, lineStart);
      const line = completed.subarray(lineStart, lineEnd);
      if (line.byteLength > 0) {
        try {
          records.push({ kind: 'event', event: JSON.parse(line.toString('utf8')) as ExternalPipelineEvent });
        } catch {
          records.push({ kind: 'malformed-line', byteOffset: this.offset + lineStart });
        }
      }
      lineStart = lineEnd + 1;
    }
    this.offset += completed.byteLength;
    return records;
  }
}

/** Polls the pipeline-owned closeout ledger and re-emits complete records. */
export class CloseoutEventTail {
  private readonly reader: CloseoutTailReader;
  private readonly events: ConductorEventEmitter;
  private interval: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;

  constructor({
    projectRoot,
    events,
    readLedger,
  }: {
    projectRoot: string;
    events: ConductorEventEmitter;
    readLedger?: (path: string) => Promise<Buffer>;
  }) {
    this.reader = new CloseoutTailReader(projectRoot, readLedger);
    this.events = events;
  }

  poll(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const operation = this.pollOnce();
    this.inFlight = operation;
    void operation.then(
      () => { if (this.inFlight === operation) this.inFlight = null; },
      () => { if (this.inFlight === operation) this.inFlight = null; },
    );
    return operation;
  }

  private async pollOnce(): Promise<void> {
    for (const record of await this.reader.read()) {
      if (record.kind === 'event') {
        await this.events.emit(record.event);
      } else {
        await this.events.emit({
          type: 'pipeline_tail_diagnostic',
          reason: 'malformed-line',
          path: PIPELINE_CLOSEOUT_LEDGER,
          byteOffset: record.byteOffset,
        });
      }
    }
  }

  /** Start background polling; lifecycle ownership stays with the conductor. */
  start(): void {
    if (this.interval) return;

    this.interval = setInterval(() => {
      void this.poll().catch(() =>
        this.events.emit({
          type: 'pipeline_tail_diagnostic',
          reason: 'poll-failed',
          path: PIPELINE_CLOSEOUT_LEDGER,
        }).catch(() => undefined),
      );
    }, 1_000);
    this.interval.unref(); // portability-ok: detaches the closeout polling interval from process exit
  }

  /** Stop background polling once the owning build attempt has settled. */
  stop(): void {
    if (!this.interval) return;
    clearInterval(this.interval);
    this.interval = null;
  }
}
