import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import type { Context } from '@opentelemetry/api';
import type { SdkLogRecord } from '@opentelemetry/sdk-logs';
import { logRecordByteSize } from './log-record.js';

const LOG_DELIVERY_TIMEOUT_MS = 2_000;

export interface LogBatchExporter {
  export(records: SdkLogRecord[], done: (result: ExportResult) => void): void | Promise<void>;
  shutdown?(): Promise<void>;
}

export interface BoundedLogProcessorOptions {
  delayMs?: number;
  maxRecords?: number;
  maxBytes?: number;
  maxBatchRecords?: number;
  maxBatchBytes?: number;
  onDrop?: (count: number) => void;
}

interface QueuedLogRecord {
  record: SdkLogRecord;
  byteSize: number;
}

/**
 * The SDK's stock processor has an unobservable overflow queue. This is the
 * one bounded queue for logs: producer callbacks do no serialization or I/O.
 */
export class BoundedLogProcessor {
  private readonly queue: QueuedLogRecord[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight = 0;
  private inFlightBytes = 0;
  private queuedBytes = 0;
  private flushing: Promise<void> | undefined;
  private stopped = false;
  private readonly delayMs: number;
  private readonly maxRecords: number;
  private readonly maxBytes: number;
  private readonly maxBatchRecords: number;
  private readonly maxBatchBytes: number;

  constructor(private readonly exporter: LogBatchExporter, private readonly options: BoundedLogProcessorOptions = {}) {
    this.delayMs = options.delayMs ?? 1_000;
    this.maxRecords = options.maxRecords ?? 1_024;
    this.maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
    this.maxBatchRecords = options.maxBatchRecords ?? 128;
    this.maxBatchBytes = options.maxBatchBytes ?? 1024 * 1024;
  }

  onEmit(record: SdkLogRecord, _context?: Context): void {
    if (this.stopped) return;
    // Listener normalization owns this measurement.  onEmit stays a bounded
    // admission path and never serializes records on a producer callback.
    const bytes = logRecordByteSize(_context);
    if (bytes === undefined) { this.options.onDrop?.(1); return; }
    if (this.queue.length + this.inFlight >= this.maxRecords || this.queuedBytes + this.inFlightBytes + bytes > this.maxBytes) {
      this.options.onDrop?.(1); return;
    }
    this.queue.push({ record, byteSize: bytes }); this.queuedBytes += bytes;
    this.requestFlush(this.queue.length >= this.maxBatchRecords || this.queuedBytes >= this.maxBatchBytes);
  }

  async forceFlush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    await this.flush();
  }

  async shutdown(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    await this.flush();
    await this.exporter.shutdown?.();
  }

  private requestFlush(immediately = false): void {
    if (this.flushing) return;
    if (immediately) {
      if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
      void this.flush();
      return;
    }
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, this.delayMs);
    this.timer.unref?.();
  }

  private async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.drain().finally(() => {
      this.flushing = undefined;
      if (this.queue.length && !this.stopped) this.requestFlush(this.queue.length >= this.maxBatchRecords || this.queuedBytes >= this.maxBatchBytes);
    });
    return this.flushing;
  }

  private async drain(): Promise<void> {
    while (this.queue.length) {
      const batch: QueuedLogRecord[] = [];
      let batchBytes = 0;
      while (this.queue.length && batch.length < this.maxBatchRecords) {
        const next = this.queue[0];
        if (batch.length > 0 && batchBytes + next.byteSize > this.maxBatchBytes) break;
        this.queue.shift(); this.queuedBytes -= next.byteSize; batchBytes += next.byteSize; batch.push(next);
      }
      if (!batch.length) { this.queue.shift(); this.options.onDrop?.(1); continue; }
      this.inFlight += batch.length;
      this.inFlightBytes += batchBytes;
      await new Promise<void>((resolve) => {
        let settled = false;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const settle = (_result?: ExportResult) => {
          if (settled) return;
          settled = true;
          if (timeout) clearTimeout(timeout);
          resolve();
        };
        timeout = setTimeout(() => settle({ code: ExportResultCode.FAILED }), LOG_DELIVERY_TIMEOUT_MS);
        timeout.unref?.();
        try {
          const exported = this.exporter.export(batch.map(({ record }) => record), settle);
          if (exported) void exported.then(() => settle(), () => settle({ code: ExportResultCode.FAILED }));
        } catch { settle({ code: ExportResultCode.FAILED }); }
      });
      this.inFlight -= batch.length;
      this.inFlightBytes -= batchBytes;
    }
  }
}
