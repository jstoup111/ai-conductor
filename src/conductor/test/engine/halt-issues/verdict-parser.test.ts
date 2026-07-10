import { describe, it, expect } from 'vitest';
import { parseVerdicts } from '../../../src/engine/halt-issues/verdict-parser';

describe('verdict-parser', () => {
  describe('parseVerdicts', () => {
    it('parses a single embedded verdict from monitor log text', () => {
      const logText = `2026-07-04T11:59:37Z NEW HALT: 2026-07-04T11:58:38.984Z [daemon] ✋ daemon-lifecycle-controls halted
HALT daemon-lifecycle-controls -> filed #297`;

      const result = parseVerdicts(logText);

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]).toEqual({
        slug: 'daemon-lifecycle-controls',
        issue: '297'
      });
      expect(result.unparseable).toBe(0);
    });

    it('parses verdict embedded within a RESULT line', () => {
      const logText = `2026-07-04T15:02:02Z RESULT: HALT make-daemon-build-push-pr-timing-a-configurable-st -> filed #300`;

      const result = parseVerdicts(logText);

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]).toEqual({
        slug: 'make-daemon-build-push-pr-timing-a-configurable-st',
        issue: '300'
      });
      expect(result.unparseable).toBe(0);
    });

    it('ignores covered-by verdicts and only extracts filed verdicts', () => {
      const logText = `2026-07-04T14:39:17Z RESULT: HALT test-spawned-daemons-leak-real-tmux-daemons-persis -> covered by #270`;

      const result = parseVerdicts(logText);

      expect(result.entries).toHaveLength(0);
      expect(result.unparseable).toBe(0);
    });

    it('extracts only the filed verdict from double-verdict RESULT line', () => {
      const logText = `2026-07-09T09:00:00Z RESULT: Two unrelated slugs converged in the same triage pass: HALT synthetic-double-verdict-a -> covered by #900 (duplicate of an existing gap), and separately HALT synthetic-double-verdict-b -> filed #901 (new gap, no prior issue covered it).`;

      const result = parseVerdicts(logText);

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]).toEqual({
        slug: 'synthetic-double-verdict-b',
        issue: '901'
      });
      expect(result.unparseable).toBe(0);
    });

    it('is idempotent - parsing the same text twice yields identical results', () => {
      const logText = `HALT daemon-lifecycle-controls -> filed #297
HALT make-daemon-build-push-pr-timing-a-configurable-st -> filed #300`;

      const result1 = parseVerdicts(logText);
      const result2 = parseVerdicts(logText);

      expect(result1.entries).toEqual(result2.entries);
      expect(result1.unparseable).toBe(result2.unparseable);
    });

    it('dedupes entries by issue number when parsing multiple lines', () => {
      const logText = `HALT daemon-lifecycle-controls -> filed #297
HALT another-slug -> filed #297`;

      const result = parseVerdicts(logText);

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].issue).toBe('297');
    });

    it('counts malformed verdicts as unparseable', () => {
      const logText = `2026-07-09T09:06:00Z RESULT: HALT -> filed #`;

      const result = parseVerdicts(logText);

      expect(result.entries).toHaveLength(0);
      expect(result.unparseable).toBe(1);
    });

    it('handles mixed real and malformed verdicts', () => {
      const logText = `HALT daemon-lifecycle-controls -> filed #297
HALT -> filed #
HALT make-daemon-build-push-pr-timing-a-configurable-st -> filed #300`;

      const result = parseVerdicts(logText);

      expect(result.entries).toHaveLength(2);
      expect(result.entries.map(e => e.issue)).toEqual(['297', '300']);
      expect(result.unparseable).toBe(1);
    });

    it('handles entire fixture file content', () => {
      // This is a simplified test to ensure the parser works with real fixture content
      // The actual fixture would be loaded in integration tests
      const logText = `HALT daemon-lifecycle-controls -> filed #297
RESULT: HALT test-spawned-daemons-leak-real-tmux-daemons-persis -> covered by #270
HALT make-daemon-build-push-pr-timing-a-configurable-st -> filed #300
RESULT: HALT make-daemon-build-push-pr-timing-a-configurable-st -> covered by #300
2026-07-05T19:40:04Z NEW HALT: 2026-07-05T19:38:09.401Z [daemon] ✋ drop-check-harness-config-consumer-claude-md-harne
2026-07-05T19:41:19Z RESULT: HALT drop-check-harness-config-consumer-claude-md-harne -> covered by #282
HALT prd-audit-kickback-preserves-task-status -> filed #385
RESULT: HALT add-a-judgement-gate-at-the-build-manual-test-seam -> filed #403`;

      const result = parseVerdicts(logText);

      expect(result.entries.length).toBeGreaterThan(0);
      // Should only have filed entries, not covered-by entries
      const issues = result.entries.map(e => e.issue);
      expect(issues).toContain('297');
      expect(issues).toContain('300');
      expect(issues).toContain('385');
      expect(issues).toContain('403');
      expect(issues).not.toContain('270');
      expect(issues).not.toContain('282');
    });
  });
});
