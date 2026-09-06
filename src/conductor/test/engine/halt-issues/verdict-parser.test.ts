// Covers: task:1
import { describe, it, expect } from 'vitest';
import { parseCanonicalUtcTimestamp, parseVerdicts } from '../../../src/engine/halt-issues/verdict-parser';

describe('verdict-parser', () => {
  describe('parseVerdicts', () => {
    it('parses a single embedded verdict from monitor log text', () => {
      const logText = `2026-07-04T11:59:37Z NEW HALT: 2026-07-04T11:58:38.984Z [daemon] ✋ daemon-lifecycle-controls halted
HALT daemon-lifecycle-controls -> filed #297`;

      const result = parseVerdicts(logText, 'test-repo');

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].slug).toBe('daemon-lifecycle-controls');
      expect(result.entries[0].issue).toBe('297');
      expect(result.unparseable).toBe(0);
    });

    it('parses verdict embedded within a RESULT line', () => {
      const logText = `2026-07-04T15:02:02Z RESULT: HALT make-daemon-build-push-pr-timing-a-configurable-st -> filed #300`;

      const result = parseVerdicts(logText, 'test-repo');

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].slug).toBe('make-daemon-build-push-pr-timing-a-configurable-st');
      expect(result.entries[0].issue).toBe('300');
      expect(result.unparseable).toBe(0);
    });

    it('ignores covered-by verdicts and only extracts filed verdicts', () => {
      const logText = `2026-07-04T14:39:17Z RESULT: HALT test-spawned-daemons-leak-real-tmux-daemons-persis -> covered by #270`;

      const result = parseVerdicts(logText, 'test-repo');

      expect(result.entries).toHaveLength(0);
      expect(result.unparseable).toBe(0);
    });

    it('extracts only the filed verdict from double-verdict RESULT line', () => {
      const logText = `2026-07-09T09:00:00Z RESULT: Two unrelated slugs converged in the same triage pass: HALT synthetic-double-verdict-a -> covered by #900 (duplicate of an existing gap), and separately HALT synthetic-double-verdict-b -> filed #901 (new gap, no prior issue covered it).`;

      const result = parseVerdicts(logText, 'test-repo');

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].slug).toBe('synthetic-double-verdict-b');
      expect(result.entries[0].issue).toBe('901');
      expect(result.unparseable).toBe(0);
    });

    it('is idempotent - parsing the same text twice yields identical results', () => {
      const logText = `HALT daemon-lifecycle-controls -> filed #297
HALT make-daemon-build-push-pr-timing-a-configurable-st -> filed #300`;

      const result1 = parseVerdicts(logText, 'test-repo');
      const result2 = parseVerdicts(logText, 'test-repo');

      expect(result1.entries).toEqual(result2.entries);
      expect(result1.unparseable).toBe(result2.unparseable);
    });

    it('dedupes entries by issue number when parsing multiple lines', () => {
      const logText = `HALT daemon-lifecycle-controls -> filed #297
HALT another-slug -> filed #297`;

      const result = parseVerdicts(logText, 'test-repo');

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].issue).toBe('297');
    });

    it('counts malformed verdicts as unparseable', () => {
      const logText = `2026-07-09T09:06:00Z RESULT: HALT -> filed #`;

      const result = parseVerdicts(logText, 'test-repo');

      expect(result.entries).toHaveLength(0);
      expect(result.unparseable).toBe(1);
    });

    it('handles mixed real and malformed verdicts', () => {
      const logText = `HALT daemon-lifecycle-controls -> filed #297
HALT -> filed #
HALT make-daemon-build-push-pr-timing-a-configurable-st -> filed #300`;

      const result = parseVerdicts(logText, 'test-repo');

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

      const result = parseVerdicts(logText, 'test-repo');

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

    describe('Task 3: haltAt and repo parameter', () => {
      it('accepts repo parameter and includes it in verdict entries', () => {
        const logText = `HALT daemon-lifecycle-controls -> filed #297`;

        const result = parseVerdicts(logText, 'my-repo');

        expect(result.entries).toHaveLength(1);
        expect(result.entries[0]).toEqual({
          slug: 'daemon-lifecycle-controls',
          issue: '297',
          repo: 'my-repo',
          haltAt: undefined
        });
      });

      it('extracts haltAt timestamp from NEW HALT line', () => {
        const logText = `2026-07-04T11:59:37Z NEW HALT: 2026-07-04T11:58:38.984Z [daemon] ✋ daemon-lifecycle-controls halted
HALT daemon-lifecycle-controls -> filed #297`;

        const result = parseVerdicts(logText, 'test-repo');

        expect(result.entries).toHaveLength(1);
        expect(result.entries[0]).toEqual({
          slug: 'daemon-lifecycle-controls',
          issue: '297',
          repo: 'test-repo',
          haltAt: '2026-07-04T11:58:38.984Z'
        });
      });

      it('uses newest (latest) haltAt timestamp when multiple NEW HALT lines exist for same slug', () => {
        const logText = `2026-07-04T10:00:00Z NEW HALT: 2026-07-04T10:00:00.000Z [daemon] ✋ test-slug halted
2026-07-04T12:00:00Z NEW HALT: 2026-07-04T12:00:00.000Z [daemon] ✋ test-slug halted
2026-07-04T11:00:00Z NEW HALT: 2026-07-04T11:00:00.000Z [daemon] ✋ test-slug halted
HALT test-slug -> filed #999`;

        const result = parseVerdicts(logText, 'test-repo');

        expect(result.entries).toHaveLength(1);
        expect(result.entries[0].haltAt).toBe('2026-07-04T12:00:00.000Z');
      });

      it('correctly maps multiple slugs to their newest haltAt timestamps', () => {
        const logText = `2026-07-04T10:00:00Z NEW HALT: 2026-07-04T10:00:00.000Z [daemon] ✋ slug-a halted
2026-07-04T11:00:00Z NEW HALT: 2026-07-04T11:30:00.000Z [daemon] ✋ slug-a halted
2026-07-04T12:00:00Z NEW HALT: 2026-07-04T12:00:00.000Z [daemon] ✋ slug-b halted
HALT slug-a -> filed #100
HALT slug-b -> filed #200`;

        const result = parseVerdicts(logText, 'test-repo');

        expect(result.entries).toHaveLength(2);
        const slugAEntry = result.entries.find(e => e.slug === 'slug-a');
        const slugBEntry = result.entries.find(e => e.slug === 'slug-b');

        expect(slugAEntry?.haltAt).toBe('2026-07-04T11:30:00.000Z');
        expect(slugBEntry?.haltAt).toBe('2026-07-04T12:00:00.000Z');
      });

      it('counts malformed verdicts with missing slug', () => {
        const logText = `HALT -> filed #123`;

        const result = parseVerdicts(logText, 'test-repo');

        expect(result.entries).toHaveLength(0);
        expect(result.unparseable).toBe(1);
      });

      it('counts malformed verdicts with missing issue number', () => {
        const logText = `HALT test-slug -> filed #`;

        const result = parseVerdicts(logText, 'test-repo');

        expect(result.entries).toHaveLength(0);
        expect(result.unparseable).toBe(1);
      });

      it('handles mixed valid and malformed verdicts with haltAt', () => {
        const logText = `2026-07-04T10:00:00Z NEW HALT: 2026-07-04T10:00:00.000Z [daemon] ✋ valid-slug halted
HALT valid-slug -> filed #500
HALT -> filed #
HALT invalid -> filed #`;

        const result = parseVerdicts(logText, 'test-repo');

        expect(result.entries).toHaveLength(1);
        expect(result.entries[0]).toEqual({
          slug: 'valid-slug',
          issue: '500',
          repo: 'test-repo',
          haltAt: '2026-07-04T10:00:00.000Z'
        });
        expect(result.unparseable).toBe(2);
      });

      it('handles slug without corresponding NEW HALT line (haltAt undefined)', () => {
        const logText = `HALT no-new-halt-slug -> filed #888`;

        const result = parseVerdicts(logText, 'test-repo');

        expect(result.entries).toHaveLength(1);
        expect(result.entries[0]).toEqual({
          slug: 'no-new-halt-slug',
          issue: '888',
          repo: 'test-repo',
          haltAt: undefined
        });
      });

      it('selects the newest millisecond timestamp for a slug regardless of log order', () => {
        const logText = `2026-07-04T10:00:00Z NEW HALT: 2026-07-04T10:00:00.999Z [daemon] ✋ test-slug halted
2026-07-04T10:00:00Z NEW HALT: 2026-07-04T10:00:00.001Z [daemon] ✋ test-slug halted
HALT test-slug -> filed #999`;

        const result = parseVerdicts(logText, 'test-repo');

        expect(result.entries[0].haltAt).toBe('2026-07-04T10:00:00.999Z');
      });

      it('does not recover precision from invalid or imprecise NEW HALT timestamps', () => {
        const logText = `NEW HALT: 2026-07-04T10:00:00Z [daemon] ✋ seconds-only halted
NEW HALT: 2026-07-04T10:00:00.123 [daemon] ✋ timezone-less halted
NEW HALT: 2026-02-29T10:00:00.123Z [daemon] ✋ invalid-date halted
HALT seconds-only -> filed #101
HALT timezone-less -> filed #102
HALT invalid-date -> filed #103`;

        const result = parseVerdicts(logText, 'test-repo');

        expect(result.entries).toEqual([
          { slug: 'seconds-only', issue: '101', repo: 'test-repo', haltAt: undefined },
          { slug: 'timezone-less', issue: '102', repo: 'test-repo', haltAt: undefined },
          { slug: 'invalid-date', issue: '103', repo: 'test-repo', haltAt: undefined }
        ]);
      });
    });

    describe('parseCanonicalUtcTimestamp', () => {
      it('returns the epoch only for canonical, valid millisecond UTC timestamps', () => {
        expect(parseCanonicalUtcTimestamp('2026-07-04T11:58:38.984Z')).toBe(
          Date.UTC(2026, 6, 4, 11, 58, 38, 984)
        );
      });

      it.each([
        undefined,
        '',
        '2026-07-04T11:58:38Z',
        '2026-07-04T11:58:38.984',
        '2026-07-04T11:58:38.98Z',
        '2026-02-29T11:58:38.984Z',
        'not-a-timestamp'
      ])('rejects missing, imprecise, malformed, and invalid-date values: %s', (timestamp) => {
        expect(parseCanonicalUtcTimestamp(timestamp)).toBeUndefined();
      });
    });
  });
});
