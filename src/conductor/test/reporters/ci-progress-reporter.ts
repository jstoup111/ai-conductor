import { relative } from 'node:path';
import type { Reporter } from 'vitest/reporters';
import type { TestCase, TestModule, Vitest } from 'vitest/node';

export interface CiProgressReporterOptions {
  write?: (line: string) => unknown;
  writeSync?: (line: string) => unknown;
  now?: () => number;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
  stallMs?: number;
  tickMs?: number;
}

interface InFlightModule {
  path: string;
}

export default class CiProgressReporter implements Reporter {
  private readonly write: (line: string) => unknown;
  private readonly inFlight = new Map<string, InFlightModule>();
  private root = process.cwd();
  private inlineDirty = false;

  constructor(options: CiProgressReporterOptions = {}) {
    this.write = options.write ?? ((line) => process.stdout.write(line));
  }

  onInit(ctx: Vitest): void {
    this.root = ctx.config.root;
  }

  onTestModuleQueued(testModule: TestModule): void {
    this.start(testModule);
  }

  onTestModuleStart(testModule: TestModule): void {
    this.start(testModule);
  }

  onTestModuleEnd(testModule: TestModule): void {
    const path = this.start(testModule).path;
    const state = testModule.state() === 'failed' ? 'failed' : 'passed';
    const durationSeconds = (testModule.diagnostic().duration / 1000).toFixed(1);

    this.record(`[ci-progress] done ${path} ${state} ${durationSeconds}s\n`);
    this.inFlight.delete(testModule.moduleId);

    if (state === 'failed') {
      for (const testCase of testModule.children.allTests()) {
        if (testCase.result().state === 'failed') {
          this.record(`[ci-progress] failed test: ${testCase.fullName}\n`);
        }
      }
    }
  }

  onTestCaseResult(testCase: TestCase): void {
    if (testCase.result().state !== 'pending') this.inlineDirty = true;
  }

  private start(testModule: TestModule): InFlightModule {
    const existing = this.inFlight.get(testModule.moduleId);
    if (existing) return existing;

    const module = { path: relative(this.root, testModule.moduleId) };
    this.inFlight.set(testModule.moduleId, module);
    this.record(`[ci-progress] start ${module.path}\n`);
    return module;
  }

  private record(line: string): void {
    if (this.inlineDirty) {
      this.write('\n');
      this.inlineDirty = false;
    }
    this.write(line);
  }
}
