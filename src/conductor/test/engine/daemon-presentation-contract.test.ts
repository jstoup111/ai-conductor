import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DAEMON_EVENT_PRESENTATION,
  createDaemonEventPresenter,
  type RenderedEventType,
} from '../../src/engine/daemon-event-presenter.js';
import { renderedEventTypes } from '../../src/engine/event-sinks.js';
import { composeDaemonLineBody, type DaemonLogEntry } from '../../src/engine/daemon-log.js';

// Covers: task:rem-prd-audit-refusal-4ec42d50-f74a-4c13-8d31-580759f26f22, task:rem-prd-audit-R2-S3.1-a, task:rem-prd-audit-R2-S3.1-b, task:rem-prd-audit-R2-S6.7, task:rem-prd-audit-R2-S7.1-8, task:rem-prd-audit-R2-S7.1-9, task:rem-prd-audit-R2-S7.1-10, task:rem-prd-audit-R2-S7.1-11, task:rem-prd-audit-R2-S7.3, task:rem-prd-audit-R2-S7.5-a, task:rem-prd-audit-R2-S7.5-b, task:rem-as-built-R2-AB1, task:rem-as-built-R2-AB2, task:rem-as-built-R2-AB3, task:rem-as-built-R2-AB4

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const presentationTypes = renderedEventTypes().filter(
  (type): type is RenderedEventType => type in DAEMON_EVENT_PRESENTATION,
);

describe('daemon presentation contract', () => {
  it('rejects raw warning and halt markers at daemon producer sites', () => {
    const sourceDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/engine');
    const marker = /\blog\s*\(\s*['"`]\s*(?:WARNING:|⚠|✋)/;
    for (const file of [
      'conductor.ts', 'daemon-runner.ts', 'daemon-rekick.ts',
      'halt-pr-rehabilitation.ts', 'halt-pr-reconciliation.ts',
    ]) {
      expect(readFileSync(join(sourceDir, file), 'utf8')).not.toMatch(marker);
    }
    for (const fixture of ['log(`WARNING: x`)', 'log(`⚠ x`)', 'log(`✋ x`)']) {
      expect(fixture).toMatch(marker);
    }
  });

  it('keeps identifier-bearing fixture detail out of every default line', () => {
    const entries: DaemonLogEntry[] = [];
    const presenter = createDaemonEventPresenter({ log: (entry) => entries.push(entry), verbose: false });

    // Every rendered type gets the same UUID-shaped identifier fixture. The
    // presenter is the single default-verbosity boundary, so this catches a
    // newly added presentation row that leaks a detail field into its summary.
    for (const type of presentationTypes) {
      presenter.outputFor(type).info({ text: `${type} fixture`, suffix: undefined });
      presenter.outputFor(type).detail(`id=${UUID}`);
    }

    expect(entries.map(composeDaemonLineBody).join('\n')).not.toMatch(UUID_RE);
  });

  it('gives every warning and halt an action suffix while information has none', () => {
    const entries: DaemonLogEntry[] = [];
    const presenter = createDaemonEventPresenter({ log: (entry) => entries.push(entry), verbose: false });
    for (const type of presentationTypes) {
      const output = presenter.outputFor(type);
      output.info(`${type} info`);
      output.warning(`${type} warning`, { kind: 'none', why: 'fixture retry' });
      output.halt(`${type} halt`, { kind: 'operator', action: 'ai-conductor monitor all' });
    }

    const lines = entries.map(composeDaemonLineBody);
    for (const line of lines.filter((line) => /(?:⚠|✋)/.test(line))) {
      expect(line).toMatch(/ — (?:next|no action needed): .+$/);
    }
    for (const line of lines.filter((line) => !/(?:⚠|✋)/.test(line))) {
      expect(line).not.toContain(' — next: ');
      expect(line).not.toContain(' — no action needed: ');
    }
  });
});
