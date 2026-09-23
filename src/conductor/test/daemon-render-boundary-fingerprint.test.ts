// Covers: task:5
import { describe, expect, it } from 'vitest';

import { renderDaemonEvent } from '../src/daemon-cli.js';

describe('self-host boundary fingerprint daemon rendering', () => {
  it('logs one line containing every surface label, duration, and file count', () => {
    const output: string[] = [];

    renderDaemonEvent({
      type: 'self_host_boundary_fingerprint',
      surfaces: [
        { label: 'live checkout', elapsedMs: 410, fileCount: 6391 },
        { label: 'provider state', elapsedMs: 95, fileCount: 812 },
      ],
    }, (line) => output.push(line));

    expect(output).toHaveLength(1);
    expect(output[0]).toContain('live checkout 410ms/6391 files');
    expect(output[0]).toContain('provider state 95ms/812 files');
  });
});
