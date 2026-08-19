import type { File, Task, Test } from '@vitest/runner';
import type { Reporter } from 'vitest/reporters';

const INTENT_RATIONALE =
  'The real Conductor.run() path continued past the fourth same-rubric FAIL because the rubric-repetition short-circuit is not implemented.';

export default class RubricRepetitionAcceptanceRedReporter implements Reporter {
  onFinished(files: File[], errors: unknown[]): void {
    const tests: Test[] = [];
    const visit = (task: Task): void => {
      if (task.type === 'test') {
        tests.push(task);
        return;
      }
      if ('tasks' in task) {
        for (const child of task.tasks) visit(child);
      }
    };

    for (const file of files) visit(file);

    const failed = tests.filter((test) => test.result?.state === 'fail');
    const passed = tests.filter((test) => test.result?.state === 'pass');
    const skipped = tests.filter((test) => test.mode === 'skip' || test.mode === 'todo');

    process.stdout.write(`ACCEPTANCE_RED_EVIDENCE: ${JSON.stringify({
      executed: passed.length + failed.length,
      passed: passed.length,
      failed: failed.length,
      skipped: skipped.length,
      errors: errors.length,
      failingTests: failed.map((test) => ({
        name: test.name,
        reason: test.result?.errors?.[0]?.message?.split('\n')[0] ?? 'acceptance assertion failed',
      })),
      intentRationale: INTENT_RATIONALE,
    })}\n`);
  }
}
