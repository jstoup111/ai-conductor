import type { File, Task, Test } from '@vitest/runner';
import type { Reporter } from 'vitest/reporters';

const RATIONALE =
  'The failures show that non-advancing FINISH judgments still retry or claim progress, and production PR observation still misses halt signals required by #1487.';

export default class FinishPublicationAcceptanceRedReporter implements Reporter {
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
    const failingTests = failed.map((test) => ({
      name: test.name,
      reason: test.result?.errors?.[0]?.message?.split('\n')[0] ?? 'acceptance assertion failed',
    }));

    process.stdout.write(`ACCEPTANCE_RED_EVIDENCE: ${JSON.stringify({
      executed: passed.length + failed.length,
      passed: passed.length,
      failed: failed.length,
      skipped: skipped.length,
      errors: errors.length,
      failingTests,
      intentRationale: RATIONALE,
    })}\n`);
  }
}
