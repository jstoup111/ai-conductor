import { InMemorySpanExporter, type ReadableSpan } from '@opentelemetry/sdk-trace-base';

/** Preserve exported evidence while still executing the SDK's real shutdown. */
export class CapturingSpanExporter extends InMemorySpanExporter {
  private captured: ReadableSpan[] | undefined;

  override shutdown(): Promise<void> {
    this.captured ??= [...super.getFinishedSpans()];
    return super.shutdown();
  }

  override getFinishedSpans(): ReadableSpan[] {
    return this.captured ?? super.getFinishedSpans();
  }
}
