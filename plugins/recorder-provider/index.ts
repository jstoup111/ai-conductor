import { appendFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import type { LLMProvider, InvokeOptions, InvokeResult } from '../../src/conductor/src/execution/llm-provider.js';

/**
 * Error thrown when RecorderProvider fails to write to the recording file.
 */
export class RecorderProviderError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'RecorderProviderError';
  }
}

export interface RecorderProviderOptions {
  recordingPath: string;
}

/**
 * Reference LLM provider plugin that records every invoke() and invokeInteractive()
 * call as a JSONL line, then returns a canned response.
 *
 * Designed to install through the Wave A plugin loader with zero edits to
 * src/conductor/src/index.ts.
 */
export class RecorderProvider implements LLMProvider {
  private readonly recordingPath: string;
  private dirEnsured = false;

  constructor(options: RecorderProviderOptions) {
    this.recordingPath = options.recordingPath;
  }

  /**
   * Appends a JSONL record and returns a canned response with deterministic tokenUsage.
   */
  async invoke(options: InvokeOptions): Promise<InvokeResult> {
    await this.appendRecord('invoke', options);
    return {
      success: true,
      output: '[RecorderProvider] canned response',
      exitCode: 0,
      tokenUsage: { input: 10, output: 5 },
    };
  }

  /**
   * Appends a JSONL record and resolves immediately.
   */
  async invokeInteractive(options: InvokeOptions): Promise<void> {
    await this.appendRecord('invokeInteractive', options);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async ensureDir(): Promise<void> {
    if (this.dirEnsured) return;
    await mkdir(dirname(this.recordingPath), { recursive: true });
    this.dirEnsured = true;
  }

  private async appendRecord(kind: 'invoke' | 'invokeInteractive', options: InvokeOptions): Promise<void> {
    try {
      await this.ensureDir();
      const record = JSON.stringify({
        ts: new Date().toISOString(),
        kind,
        options,
      });
      await appendFile(this.recordingPath, record + '\n', 'utf-8');
    } catch (err) {
      throw new RecorderProviderError(
        `RecorderProvider failed to write to ${this.recordingPath}: ${String(err)}`,
        err
      );
    }
  }
}
