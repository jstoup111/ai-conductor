import { describe, it, expect } from 'vitest';
import {
  parseAttributionVerdict,
  type AttributionVerdict,
  type Verdict,
} from '../src/engine/attribution-verdict.js';

describe('parseAttributionVerdict — fail-closed parser for attribution verdict files', () => {
  describe('valid schema-1 file — parses correctly', () => {
    it('valid schema-1 with single satisfied verdict', () => {
      const raw = {
        schema: 1,
        anchor: { head: 'abc123', residue: ['7'] },
        results: [
          {
            taskId: '7',
            verdict: 'satisfied',
            citations: [{ sha: 'def456', rationale: 'adds sweep wiring' }],
            testEvidence: { command: 'npm test', exit: 0, summary: '12 passed' },
          },
        ],
      };

      const result = parseAttributionVerdict(raw, ['7']);

      expect(result.size).toBe(1);
      expect(result.get('7')).toBe('satisfied');
    });

    it('valid schema-1 with multiple verdicts', () => {
      const raw = {
        schema: 1,
        anchor: { head: 'abc123', residue: ['7', '9', '12'] },
        results: [
          {
            taskId: '7',
            verdict: 'satisfied',
            citations: [{ sha: 'def456', rationale: 'adds sweep wiring' }],
            testEvidence: { command: 'npm test', exit: 0, summary: '12 passed' },
          },
          {
            taskId: '9',
            verdict: 'unsatisfied',
            reason: 'no candidate diff touches the CLI surface',
          },
          {
            taskId: '12',
            verdict: 'no-verdict',
            reason: 'diff ambiguous between tasks 12 and 13',
          },
        ],
      };

      const result = parseAttributionVerdict(raw, ['7', '9', '12']);

      expect(result.size).toBe(3);
      expect(result.get('7')).toBe('satisfied');
      expect(result.get('9')).toBe('unsatisfied');
      expect(result.get('12')).toBe('no-verdict');
    });

    it('all task IDs from planTaskIds appear in results map', () => {
      const raw = {
        schema: 1,
        anchor: { head: 'abc123', residue: ['1', '2', '3'] },
        results: [
          {
            taskId: '1',
            verdict: 'satisfied',
            citations: [{ sha: 'def456', rationale: 'test' }],
            testEvidence: { command: 'npm test', exit: 0, summary: 'pass' },
          },
        ],
      };

      const result = parseAttributionVerdict(raw, ['1', '2', '3']);

      expect(result.size).toBe(3);
      expect(result.get('1')).toBe('satisfied');
      expect(result.get('2')).toBe('no-verdict'); // missing from results → no-verdict
      expect(result.get('3')).toBe('no-verdict'); // missing from results → no-verdict
    });

    it('extra results beyond planTaskIds are ignored', () => {
      const raw = {
        schema: 1,
        anchor: { head: 'abc123', residue: ['7', '9'] },
        results: [
          {
            taskId: '7',
            verdict: 'satisfied',
            citations: [{ sha: 'def456', rationale: 'test' }],
            testEvidence: { command: 'npm test', exit: 0, summary: 'pass' },
          },
          {
            taskId: '9',
            verdict: 'unsatisfied',
            reason: 'not implemented',
          },
          {
            taskId: '99',
            verdict: 'satisfied',
            citations: [{ sha: 'xyz789', rationale: 'extra' }],
            testEvidence: { command: 'npm test', exit: 0, summary: 'pass' },
          },
        ],
      };

      const result = parseAttributionVerdict(raw, ['7', '9']);

      expect(result.size).toBe(2);
      expect(result.get('7')).toBe('satisfied');
      expect(result.get('9')).toBe('unsatisfied');
      expect(result.has('99')).toBe(false);
    });
  });

  describe('truncated JSON — all entries default to no-verdict', () => {
    it('truncated JSON string returns all no-verdict', () => {
      const raw = '{"schema": 1, "anchor": {"head": "abc", "residue": ["7"';

      const result = parseAttributionVerdict(raw, ['7']);

      expect(result.size).toBe(1);
      expect(result.get('7')).toBe('no-verdict');
    });

    it('incomplete object with missing results field', () => {
      const raw = {
        schema: 1,
        anchor: { head: 'abc123', residue: ['7', '9'] },
        // missing results field
      };

      const result = parseAttributionVerdict(raw, ['7', '9']);

      expect(result.size).toBe(2);
      expect(result.get('7')).toBe('no-verdict');
      expect(result.get('9')).toBe('no-verdict');
    });
  });

  describe('missing file — all entries default to no-verdict', () => {
    it('null input returns all no-verdict', () => {
      const result = parseAttributionVerdict(null, ['7', '9']);

      expect(result.size).toBe(2);
      expect(result.get('7')).toBe('no-verdict');
      expect(result.get('9')).toBe('no-verdict');
    });

    it('undefined input returns all no-verdict', () => {
      const result = parseAttributionVerdict(undefined, ['7']);

      expect(result.size).toBe(1);
      expect(result.get('7')).toBe('no-verdict');
    });

    it('empty planTaskIds with null input', () => {
      const result = parseAttributionVerdict(null, []);

      expect(result.size).toBe(0);
      expect(result instanceof Map).toBe(true);
    });
  });

  describe('unknown schema version — all entries default to no-verdict', () => {
    it('schema version 0 (too old) returns all no-verdict', () => {
      const raw = {
        schema: 0,
        anchor: { head: 'abc123', residue: ['7'] },
        results: [
          {
            taskId: '7',
            verdict: 'satisfied',
            citations: [{ sha: 'def456', rationale: 'test' }],
            testEvidence: { command: 'npm test', exit: 0, summary: 'pass' },
          },
        ],
      };

      const result = parseAttributionVerdict(raw, ['7']);

      expect(result.size).toBe(1);
      expect(result.get('7')).toBe('no-verdict');
    });

    it('schema version 2 (future/unknown) returns all no-verdict', () => {
      const raw = {
        schema: 2,
        anchor: { head: 'abc123', residue: ['7'] },
        results: [
          {
            taskId: '7',
            verdict: 'satisfied',
            citations: [{ sha: 'def456', rationale: 'test' }],
            testEvidence: { command: 'npm test', exit: 0, summary: 'pass' },
          },
        ],
      };

      const result = parseAttributionVerdict(raw, ['7']);

      expect(result.size).toBe(1);
      expect(result.get('7')).toBe('no-verdict');
    });

    it('missing schema field returns all no-verdict', () => {
      const raw = {
        // schema missing
        anchor: { head: 'abc123', residue: ['7'] },
        results: [
          {
            taskId: '7',
            verdict: 'satisfied',
            citations: [{ sha: 'def456', rationale: 'test' }],
            testEvidence: { command: 'npm test', exit: 0, summary: 'pass' },
          },
        ],
      };

      const result = parseAttributionVerdict(raw, ['7']);

      expect(result.size).toBe(1);
      expect(result.get('7')).toBe('no-verdict');
    });

    it('non-numeric schema value returns all no-verdict', () => {
      const raw = {
        schema: 'v1',
        anchor: { head: 'abc123', residue: ['7'] },
        results: [
          {
            taskId: '7',
            verdict: 'satisfied',
            citations: [{ sha: 'def456', rationale: 'test' }],
            testEvidence: { command: 'npm test', exit: 0, summary: 'pass' },
          },
        ],
      };

      const result = parseAttributionVerdict(raw, ['7']);

      expect(result.size).toBe(1);
      expect(result.get('7')).toBe('no-verdict');
    });
  });

  describe('invalid verdict string — coerced to no-verdict', () => {
    it('unknown verdict "maybe" coerced to no-verdict', () => {
      const raw = {
        schema: 1,
        anchor: { head: 'abc123', residue: ['7'] },
        results: [
          {
            taskId: '7',
            verdict: 'maybe',
            reason: 'unsure',
          },
        ],
      };

      const result = parseAttributionVerdict(raw, ['7']);

      expect(result.size).toBe(1);
      expect(result.get('7')).toBe('no-verdict');
    });

    it('unknown verdict "approved" coerced to no-verdict', () => {
      const raw = {
        schema: 1,
        anchor: { head: 'abc123', residue: ['7'] },
        results: [
          {
            taskId: '7',
            verdict: 'approved',
          },
        ],
      };

      const result = parseAttributionVerdict(raw, ['7']);

      expect(result.size).toBe(1);
      expect(result.get('7')).toBe('no-verdict');
    });

    it('null verdict coerced to no-verdict', () => {
      const raw = {
        schema: 1,
        anchor: { head: 'abc123', residue: ['7'] },
        results: [
          {
            taskId: '7',
            verdict: null,
          },
        ],
      };

      const result = parseAttributionVerdict(raw, ['7']);

      expect(result.size).toBe(1);
      expect(result.get('7')).toBe('no-verdict');
    });

    it('undefined verdict coerced to no-verdict', () => {
      const raw = {
        schema: 1,
        anchor: { head: 'abc123', residue: ['7'] },
        results: [
          {
            taskId: '7',
            // verdict missing
          },
        ],
      };

      const result = parseAttributionVerdict(raw, ['7']);

      expect(result.size).toBe(1);
      expect(result.get('7')).toBe('no-verdict');
    });

    it('wrong case "Satisfied" coerced to no-verdict', () => {
      const raw = {
        schema: 1,
        anchor: { head: 'abc123', residue: ['7'] },
        results: [
          {
            taskId: '7',
            verdict: 'Satisfied',
          },
        ],
      };

      const result = parseAttributionVerdict(raw, ['7']);

      expect(result.size).toBe(1);
      expect(result.get('7')).toBe('no-verdict');
    });

    it('satisfied with wrong case "SATISFIED" coerced to no-verdict', () => {
      const raw = {
        schema: 1,
        anchor: { head: 'abc123', residue: ['7'] },
        results: [
          {
            taskId: '7',
            verdict: 'SATISFIED',
          },
        ],
      };

      const result = parseAttributionVerdict(raw, ['7']);

      expect(result.size).toBe(1);
      expect(result.get('7')).toBe('no-verdict');
    });
  });

  describe('task-id normalization via String() — numeric IDs handled correctly', () => {
    it('numeric task ID 7 matched against string "7"', () => {
      const raw = {
        schema: 1,
        anchor: { head: 'abc123', residue: [7] },
        results: [
          {
            taskId: 7,
            verdict: 'satisfied',
            citations: [{ sha: 'def456', rationale: 'test' }],
            testEvidence: { command: 'npm test', exit: 0, summary: 'pass' },
          },
        ],
      };

      const result = parseAttributionVerdict(raw, ['7']);

      expect(result.size).toBe(1);
      expect(result.get('7')).toBe('satisfied');
    });

    it('numeric task IDs in results and string planTaskIds normalize correctly', () => {
      const raw = {
        schema: 1,
        anchor: { head: 'abc123', residue: [1, 2, 3] },
        results: [
          {
            taskId: 1,
            verdict: 'satisfied',
            citations: [{ sha: 'def456', rationale: 'test' }],
            testEvidence: { command: 'npm test', exit: 0, summary: 'pass' },
          },
          {
            taskId: 2,
            verdict: 'unsatisfied',
            reason: 'not found',
          },
        ],
      };

      const result = parseAttributionVerdict(raw, ['1', '2', '3']);

      expect(result.size).toBe(3);
      expect(result.get('1')).toBe('satisfied');
      expect(result.get('2')).toBe('unsatisfied');
      expect(result.get('3')).toBe('no-verdict');
    });

    it('all numeric IDs from planTaskIds normalized', () => {
      const raw = {
        schema: 1,
        anchor: { head: 'abc123', residue: [7, 9, 12] },
        results: [
          {
            taskId: 7,
            verdict: 'no-verdict',
            reason: 'ambiguous',
          },
        ],
      };

      // planTaskIds with numeric values as strings
      const result = parseAttributionVerdict(raw, ['7', '9', '12']);

      expect(result.size).toBe(3);
      expect(result.get('7')).toBe('no-verdict');
      expect(result.get('9')).toBe('no-verdict');
      expect(result.get('12')).toBe('no-verdict');
    });
  });

  describe('whitewash guard — satisfied without citations coerced to no-verdict', () => {
    it('satisfied without citations field returns no-verdict', () => {
      const raw = {
        schema: 1,
        anchor: { head: 'abc123', residue: ['7'] },
        results: [
          {
            taskId: '7',
            verdict: 'satisfied',
            // citations missing
            testEvidence: { command: 'npm test', exit: 0, summary: 'pass' },
          },
        ],
      };

      const result = parseAttributionVerdict(raw, ['7']);

      expect(result.size).toBe(1);
      expect(result.get('7')).toBe('no-verdict');
    });

    it('satisfied with empty citations array returns no-verdict', () => {
      const raw = {
        schema: 1,
        anchor: { head: 'abc123', residue: ['7'] },
        results: [
          {
            taskId: '7',
            verdict: 'satisfied',
            citations: [],
            testEvidence: { command: 'npm test', exit: 0, summary: 'pass' },
          },
        ],
      };

      const result = parseAttributionVerdict(raw, ['7']);

      expect(result.size).toBe(1);
      expect(result.get('7')).toBe('no-verdict');
    });

    it('satisfied without testEvidence returns no-verdict', () => {
      const raw = {
        schema: 1,
        anchor: { head: 'abc123', residue: ['7'] },
        results: [
          {
            taskId: '7',
            verdict: 'satisfied',
            citations: [{ sha: 'def456', rationale: 'test' }],
            // testEvidence missing
          },
        ],
      };

      const result = parseAttributionVerdict(raw, ['7']);

      expect(result.size).toBe(1);
      expect(result.get('7')).toBe('no-verdict');
    });

    it('satisfied with testEvidence exit !== 0 returns no-verdict', () => {
      const raw = {
        schema: 1,
        anchor: { head: 'abc123', residue: ['7'] },
        results: [
          {
            taskId: '7',
            verdict: 'satisfied',
            citations: [{ sha: 'def456', rationale: 'test' }],
            testEvidence: { command: 'npm test', exit: 1, summary: 'failed' },
          },
        ],
      };

      const result = parseAttributionVerdict(raw, ['7']);

      expect(result.size).toBe(1);
      expect(result.get('7')).toBe('no-verdict');
    });

    it('satisfied with multiple citations and valid testEvidence keeps satisfied', () => {
      const raw = {
        schema: 1,
        anchor: { head: 'abc123', residue: ['7'] },
        results: [
          {
            taskId: '7',
            verdict: 'satisfied',
            citations: [
              { sha: 'def456', rationale: 'adds sweep' },
              { sha: 'ghi789', rationale: 'wires task names' },
            ],
            testEvidence: { command: 'npm test', exit: 0, summary: '12 passed' },
          },
        ],
      };

      const result = parseAttributionVerdict(raw, ['7']);

      expect(result.size).toBe(1);
      expect(result.get('7')).toBe('satisfied');
    });
  });

  describe('fail-closed: all error cases return no-verdict map', () => {
    it('results is not an array returns all no-verdict', () => {
      const raw = {
        schema: 1,
        anchor: { head: 'abc123', residue: ['7'] },
        results: { taskId: '7', verdict: 'satisfied' }, // object instead of array
      };

      const result = parseAttributionVerdict(raw, ['7']);

      expect(result.size).toBe(1);
      expect(result.get('7')).toBe('no-verdict');
    });

    it('results array with non-object element', () => {
      const raw = {
        schema: 1,
        anchor: { head: 'abc123', residue: ['7'] },
        results: ['7', 'not an object'],
      };

      const result = parseAttributionVerdict(raw, ['7']);

      expect(result.size).toBe(1);
      expect(result.get('7')).toBe('no-verdict');
    });

    it('taskId missing from result entry coerced to no-verdict', () => {
      const raw = {
        schema: 1,
        anchor: { head: 'abc123', residue: ['7'] },
        results: [
          {
            // taskId missing
            verdict: 'satisfied',
            citations: [{ sha: 'def456', rationale: 'test' }],
            testEvidence: { command: 'npm test', exit: 0, summary: 'pass' },
          },
        ],
      };

      const result = parseAttributionVerdict(raw, ['7']);

      expect(result.size).toBe(1);
      expect(result.get('7')).toBe('no-verdict');
    });

    it('result entry with numeric taskId that does not match any planTaskId', () => {
      const raw = {
        schema: 1,
        anchor: { head: 'abc123', residue: ['7'] },
        results: [
          {
            taskId: 999,
            verdict: 'satisfied',
            citations: [{ sha: 'def456', rationale: 'test' }],
            testEvidence: { command: 'npm test', exit: 0, summary: 'pass' },
          },
        ],
      };

      const result = parseAttributionVerdict(raw, ['7']);

      expect(result.size).toBe(1);
      expect(result.get('7')).toBe('no-verdict');
    });
  });

  describe('edge cases', () => {
    it('empty planTaskIds returns empty map', () => {
      const raw = {
        schema: 1,
        anchor: { head: 'abc123', residue: [] },
        results: [],
      };

      const result = parseAttributionVerdict(raw, []);

      expect(result.size).toBe(0);
      expect(result instanceof Map).toBe(true);
    });

    it('planTaskIds with duplicates each get one entry (no duplicates in map)', () => {
      const raw = {
        schema: 1,
        anchor: { head: 'abc123', residue: ['7', '7'] },
        results: [
          {
            taskId: '7',
            verdict: 'satisfied',
            citations: [{ sha: 'def456', rationale: 'test' }],
            testEvidence: { command: 'npm test', exit: 0, summary: 'pass' },
          },
        ],
      };

      const result = parseAttributionVerdict(raw, ['7', '7']);

      expect(result.size).toBe(1);
      expect(result.get('7')).toBe('satisfied');
    });

    it('large fixture with many tasks', () => {
      const planIds = Array.from({ length: 100 }, (_, i) => String(i + 1));
      const results = planIds.slice(0, 50).map((id) => ({
        taskId: id,
        verdict: parseInt(id) % 2 === 0 ? 'satisfied' : 'unsatisfied',
        ...(parseInt(id) % 2 === 0
          ? {
              citations: [{ sha: 'def456', rationale: 'test' }],
              testEvidence: { command: 'npm test', exit: 0, summary: 'pass' },
            }
          : { reason: 'not found' }),
      }));

      const raw = {
        schema: 1,
        anchor: { head: 'abc123', residue: planIds },
        results,
      };

      const result = parseAttributionVerdict(raw, planIds);

      expect(result.size).toBe(100);
      // First 50 have verdicts, rest are no-verdict
      expect(result.get('2')).toBe('satisfied');
      expect(result.get('1')).toBe('unsatisfied');
      expect(result.get('51')).toBe('no-verdict');
      expect(result.get('100')).toBe('no-verdict');
    });
  });

  describe('determinism and pure function properties', () => {
    it('same input produces same output on repeated calls', () => {
      const raw = {
        schema: 1,
        anchor: { head: 'abc123', residue: ['7', '9'] },
        results: [
          {
            taskId: '7',
            verdict: 'satisfied',
            citations: [{ sha: 'def456', rationale: 'test' }],
            testEvidence: { command: 'npm test', exit: 0, summary: 'pass' },
          },
        ],
      };
      const planTaskIds = ['7', '9'];

      const result1 = parseAttributionVerdict(raw, planTaskIds);
      const result2 = parseAttributionVerdict(raw, planTaskIds);
      const result3 = parseAttributionVerdict(raw, planTaskIds);

      expect(result1.get('7')).toBe(result2.get('7'));
      expect(result2.get('7')).toBe(result3.get('7'));
      expect(result1.get('9')).toBe(result2.get('9'));
      expect(result2.get('9')).toBe(result3.get('9'));
    });

    it('does not mutate input raw object', () => {
      const raw = {
        schema: 1,
        anchor: { head: 'abc123', residue: ['7'] },
        results: [
          {
            taskId: '7',
            verdict: 'satisfied',
            citations: [{ sha: 'def456', rationale: 'test' }],
            testEvidence: { command: 'npm test', exit: 0, summary: 'pass' },
          },
        ],
      };
      const originalRaw = JSON.stringify(raw);

      parseAttributionVerdict(raw, ['7']);

      expect(JSON.stringify(raw)).toBe(originalRaw);
    });

    it('does not mutate input planTaskIds array', () => {
      const raw = {
        schema: 1,
        anchor: { head: 'abc123', residue: ['7', '9'] },
        results: [],
      };
      const planTaskIds = ['7', '9'];
      const originalIds = [...planTaskIds];

      parseAttributionVerdict(raw, planTaskIds);

      expect(planTaskIds).toEqual(originalIds);
    });
  });

  describe('anchor validation — stale verdicts invalidate entire file', () => {
    it('stale anchor.head (mismatch) — entire result map becomes no-verdict', () => {
      const raw = {
        schema: 1,
        anchor: { head: 'stale_abc123', residue: ['7', '9'] },
        results: [
          {
            taskId: '7',
            verdict: 'satisfied',
            citations: [{ sha: 'def456', rationale: 'adds sweep' }],
            testEvidence: { command: 'npm test', exit: 0, summary: 'pass' },
          },
          {
            taskId: '9',
            verdict: 'unsatisfied',
            reason: 'not implemented',
          },
        ],
      };
      const currentHead = 'current_def789';
      const plannedResidueIds = ['7', '9'];

      const result = parseAttributionVerdict(raw, plannedResidueIds, currentHead, plannedResidueIds);

      // All verdicts should be no-verdict due to stale anchor
      expect(result.size).toBe(2);
      expect(result.get('7')).toBe('no-verdict');
      expect(result.get('9')).toBe('no-verdict');
    });

    it('matching anchor.head — verdict passes through normally', () => {
      const currentHead = 'abc123';
      const raw = {
        schema: 1,
        anchor: { head: currentHead, residue: ['7'] },
        results: [
          {
            taskId: '7',
            verdict: 'satisfied',
            citations: [{ sha: 'def456', rationale: 'adds sweep' }],
            testEvidence: { command: 'npm test', exit: 0, summary: 'pass' },
          },
        ],
      };
      const plannedResidueIds = ['7'];

      const result = parseAttributionVerdict(raw, plannedResidueIds, currentHead, plannedResidueIds);

      expect(result.size).toBe(1);
      expect(result.get('7')).toBe('satisfied');
    });

    it('residue-set mismatch (extra residue) — entire file invalidates', () => {
      const currentHead = 'abc123';
      const raw = {
        schema: 1,
        anchor: { head: currentHead, residue: ['7', '9', '12'] },
        results: [
          {
            taskId: '7',
            verdict: 'satisfied',
            citations: [{ sha: 'def456', rationale: 'test' }],
            testEvidence: { command: 'npm test', exit: 0, summary: 'pass' },
          },
        ],
      };
      const planTaskIds = ['7'];
      const plannedResidueIds = ['7']; // plan has only 7, but anchor has 7, 9, 12

      const result = parseAttributionVerdict(raw, planTaskIds, currentHead, plannedResidueIds);

      expect(result.size).toBe(1);
      expect(result.get('7')).toBe('no-verdict');
    });

    it('residue-set mismatch (missing residue) — entire file invalidates', () => {
      const currentHead = 'abc123';
      const raw = {
        schema: 1,
        anchor: { head: currentHead, residue: ['7'] },
        results: [
          {
            taskId: '7',
            verdict: 'satisfied',
            citations: [{ sha: 'def456', rationale: 'test' }],
            testEvidence: { command: 'npm test', exit: 0, summary: 'pass' },
          },
          {
            taskId: '9',
            verdict: 'unsatisfied',
            reason: 'not implemented',
          },
        ],
      };
      const planTaskIds = ['7', '9'];
      const plannedResidueIds = ['7', '9']; // plan has 7 and 9, but anchor only has 7

      const result = parseAttributionVerdict(raw, planTaskIds, currentHead, plannedResidueIds);

      expect(result.size).toBe(2);
      expect(result.get('7')).toBe('no-verdict');
      expect(result.get('9')).toBe('no-verdict');
    });

    it('missing anchor field — entire result map becomes no-verdict', () => {
      const raw = {
        schema: 1,
        // anchor missing
        results: [
          {
            taskId: '7',
            verdict: 'satisfied',
            citations: [{ sha: 'def456', rationale: 'test' }],
            testEvidence: { command: 'npm test', exit: 0, summary: 'pass' },
          },
        ],
      };
      const currentHead = 'abc123';
      const plannedResidueIds = ['7'];

      const result = parseAttributionVerdict(raw, plannedResidueIds, currentHead, plannedResidueIds);

      expect(result.size).toBe(1);
      expect(result.get('7')).toBe('no-verdict');
    });

    it('missing anchor.head field — entire result map becomes no-verdict', () => {
      const raw = {
        schema: 1,
        anchor: { residue: ['7'] }, // head missing
        results: [
          {
            taskId: '7',
            verdict: 'satisfied',
            citations: [{ sha: 'def456', rationale: 'test' }],
            testEvidence: { command: 'npm test', exit: 0, summary: 'pass' },
          },
        ],
      };
      const currentHead = 'abc123';
      const plannedResidueIds = ['7'];

      const result = parseAttributionVerdict(raw, plannedResidueIds, currentHead, plannedResidueIds);

      expect(result.size).toBe(1);
      expect(result.get('7')).toBe('no-verdict');
    });

    it('missing anchor.residue field — entire result map becomes no-verdict', () => {
      const currentHead = 'abc123';
      const raw = {
        schema: 1,
        anchor: { head: currentHead }, // residue missing
        results: [
          {
            taskId: '7',
            verdict: 'satisfied',
            citations: [{ sha: 'def456', rationale: 'test' }],
            testEvidence: { command: 'npm test', exit: 0, summary: 'pass' },
          },
        ],
      };
      const plannedResidueIds = ['7'];

      const result = parseAttributionVerdict(raw, plannedResidueIds, currentHead, plannedResidueIds);

      expect(result.size).toBe(1);
      expect(result.get('7')).toBe('no-verdict');
    });

    it('currentHead parameter missing — entire result map becomes no-verdict', () => {
      const raw = {
        schema: 1,
        anchor: { head: 'abc123', residue: ['7'] },
        results: [
          {
            taskId: '7',
            verdict: 'satisfied',
            citations: [{ sha: 'def456', rationale: 'test' }],
            testEvidence: { command: 'npm test', exit: 0, summary: 'pass' },
          },
        ],
      };
      const plannedResidueIds = ['7'];

      const result = parseAttributionVerdict(raw, plannedResidueIds, undefined, plannedResidueIds);

      expect(result.size).toBe(1);
      expect(result.get('7')).toBe('no-verdict');
    });

    it('multiple tasks with matching anchor — all verdicts pass through', () => {
      const currentHead = 'abc123';
      const raw = {
        schema: 1,
        anchor: { head: currentHead, residue: ['1', '2', '3'] },
        results: [
          {
            taskId: '1',
            verdict: 'satisfied',
            citations: [{ sha: 'def456', rationale: 'test' }],
            testEvidence: { command: 'npm test', exit: 0, summary: 'pass' },
          },
          {
            taskId: '2',
            verdict: 'unsatisfied',
            reason: 'not implemented',
          },
          {
            taskId: '3',
            verdict: 'no-verdict',
            reason: 'ambiguous',
          },
        ],
      };
      const plannedResidueIds = ['1', '2', '3'];

      const result = parseAttributionVerdict(raw, plannedResidueIds, currentHead, plannedResidueIds);

      expect(result.size).toBe(3);
      expect(result.get('1')).toBe('satisfied');
      expect(result.get('2')).toBe('unsatisfied');
      expect(result.get('3')).toBe('no-verdict');
    });

    it('numeric residue IDs in anchor normalize correctly', () => {
      const currentHead = 'abc123';
      const raw = {
        schema: 1,
        anchor: { head: currentHead, residue: [7, 9, 12] },
        results: [
          {
            taskId: 7,
            verdict: 'satisfied',
            citations: [{ sha: 'def456', rationale: 'test' }],
            testEvidence: { command: 'npm test', exit: 0, summary: 'pass' },
          },
          {
            taskId: 9,
            verdict: 'unsatisfied',
            reason: 'not found',
          },
          {
            taskId: 12,
            verdict: 'no-verdict',
            reason: 'ambiguous',
          },
        ],
      };
      const plannedResidueIds = ['7', '9', '12'];

      const result = parseAttributionVerdict(raw, plannedResidueIds, currentHead, plannedResidueIds);

      expect(result.size).toBe(3);
      expect(result.get('7')).toBe('satisfied');
      expect(result.get('9')).toBe('unsatisfied');
      expect(result.get('12')).toBe('no-verdict');
    });
  });
});
