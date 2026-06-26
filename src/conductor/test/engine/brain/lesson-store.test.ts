// Test: LessonStore port + types (Task 10, FR-5, ADR-006)
import { describe, it, expect } from 'vitest';
import type {
  LessonStore,
  LessonRecord,
  LessonQuery,
  RetrievedLesson,
} from '../../../src/engine/brain/lesson-store.js';
// Value import to force module resolution at runtime (RED fails if file absent)
import { LESSON_STORE_VERSION } from '../../../src/engine/brain/lesson-store.js';

// --- In-test stub implementing the LessonStore port ---
// If LessonStore, LessonRecord, LessonQuery, or RetrievedLesson are missing or
// have incorrect shapes, TypeScript will reject this file at compile time.

const stubLesson: RetrievedLesson = {
  id: 'lesson-001',
  text: 'always write tests first',
  metadata: { source: 'retro', phase: 'tdd' },
};

class StubLessonStore implements LessonStore {
  private _recorded: LessonRecord[] = [];

  async record(lesson: LessonRecord): Promise<void> {
    this._recorded.push(lesson);
  }

  async retrieve(_query: LessonQuery): Promise<RetrievedLesson[]> {
    return [stubLesson];
  }

  get recorded(): LessonRecord[] {
    return this._recorded;
  }
}

describe('LessonStore port + LessonQuery/RetrievedLesson types', () => {
  it('LESSON_STORE_VERSION sentinel is exported and is a string', () => {
    // This forces the module to exist at runtime; if lesson-store.ts is missing
    // the import above will throw and all tests in this file fail (RED).
    expect(typeof LESSON_STORE_VERSION).toBe('string');
    expect(LESSON_STORE_VERSION.length).toBeGreaterThan(0);
  });


  it('stub implementing LessonStore compiles and record() returns Promise<void>', async () => {
    const store = new StubLessonStore();
    const result = store.record({
      text: 'keep commits small',
      namespace: 'my-project:feature-x',
      metadata: { author: 'tdd-agent' },
    });
    // record() must return a Promise (thenable)
    expect(result).toBeInstanceOf(Promise);
    await result; // must resolve without throwing
    expect(store.recorded).toHaveLength(1);
    expect(store.recorded[0].text).toBe('keep commits small');
  });

  it('retrieve() returns RetrievedLesson[]', async () => {
    const store = new StubLessonStore();
    const query: LessonQuery = { text: 'tdd approach', namespace: 'my-project:feature-x' };
    const results = await store.retrieve(query);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('lesson-001');
    expect(results[0].text).toBe('always write tests first');
    expect(results[0].metadata).toEqual({ source: 'retro', phase: 'tdd' });
  });

  it('RetrievedLesson without score/validAt is still valid (optional fields)', () => {
    // A RetrievedLesson with only required fields — no score, no validAt
    const lesson: RetrievedLesson = {
      id: 'lesson-002',
      text: 'minimal lesson',
      metadata: {},
    };
    // If score and validAt were required, TypeScript would error above.
    // Runtime sanity: the object has the expected shape.
    expect(lesson.id).toBe('lesson-002');
    expect(lesson.score).toBeUndefined();
    expect(lesson.validAt).toBeUndefined();
  });

  it('LessonQuery with only {text, namespace} is valid (optional topK/filters/crossProject)', () => {
    // A query with only the two required fields — no topK, no filters, no crossProject
    const query: LessonQuery = {
      text: 'how to structure a retro',
      namespace: 'project-a:retro-feature',
    };
    expect(query.text).toBe('how to structure a retro');
    expect(query.topK).toBeUndefined();
    expect(query.filters).toBeUndefined();
    expect(query.crossProject).toBeUndefined();
  });

  it('LessonRecord carries text, namespace, and metadata', () => {
    const rec: LessonRecord = {
      text: 'adversarial inputs must be tested',
      namespace: 'harness:tdd',
      metadata: { severity: 'critical', tags: ['security'] },
    };
    expect(rec.text).toBe('adversarial inputs must be tested');
    expect(rec.namespace).toBe('harness:tdd');
    expect(rec.metadata['severity']).toBe('critical');
  });

  it('LessonRecord score and validAt are optional', () => {
    // Both optional fields may be omitted — if required, TypeScript would reject this.
    const rec: LessonRecord = {
      text: 'minimal record',
      namespace: 'proj:feat',
      metadata: {},
    };
    expect(rec.score).toBeUndefined();
    expect(rec.validAt).toBeUndefined();
  });
});
