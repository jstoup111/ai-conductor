import { relative } from 'node:path';
import type { Reporter } from 'vitest/reporters';
import type { ReportedHookContext, TestCase, TestModule, Vitest } from 'vitest/node';

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
  lastProgressAt: number;
  lastStallReportAt?: number;
}

export default class CiProgressReporter implements Reporter {
  private readonly write: (line: string) => unknown;
  private readonly now: () => number;
  private readonly setInterval: typeof setInterval;
  private readonly clearInterval: typeof clearInterval;
  private readonly stallMs: number;
  private readonly tickMs: number;
  private readonly inFlight = new Map<string, InFlightModule>();
  private root = process.cwd();
  private inlineDirty = false;
  private stallTimer?: ReturnType<typeof setInterval>;

  constructor(options: CiProgressReporterOptions = {}) {
    this.write = options.write ?? ((line) => process.stdout.write(line));
    this.now = options.now ?? Date.now;
    this.setInterval = options.setInterval ?? setInterval;
    this.clearInterval = options.clearInterval ?? clearInterval;
    this.stallMs = options.stallMs ?? 90_000;
    this.tickMs = options.tickMs ?? 15_000;
  }

  onInit(ctx: Vitest): void {
    this.root = ctx.config.root;
  }

  onTestRunStart(): void {
    this.stopWatchdog();
    const timer = this.setInterval(() => this.reportStalls(), this.tickMs);
    if (typeof (timer as { unref?: () => unknown }).unref === 'function') {
      (timer as { unref: () => unknown }).unref();
    }
    this.stallTimer = timer;
  }

  onTestRunEnd(): void {
    this.stopWatchdog();
    this.inFlight.clear();
  }

  onTestModuleQueued(testModule: TestModule): void {
    this.start(testModule);
  }

  onTestModuleStart(testModule: TestModule): void {
    this.start(testModule);
  }

  onTestModuleCollected(testModule: TestModule): void {
    this.progress(testModule);
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
    this.progress(testCase.module);
    if (testCase.result().state !== 'pending') this.inlineDirty = true;
  }

  onTestCaseReady(testCase: TestCase): void {
    this.progress(testCase.module);
  }

  onHookStart(hook: ReportedHookContext): void {
    this.progress(this.moduleForHook(hook));
  }

  onHookEnd(hook: ReportedHookContext): void {
    this.progress(this.moduleForHook(hook));
  }

  private start(testModule: TestModule): InFlightModule {
    const existing = this.inFlight.get(testModule.moduleId);
    if (existing) return existing;

    const module = {
      path: relative(this.root, testModule.moduleId),
      lastProgressAt: this.now(),
    };
    this.inFlight.set(testModule.moduleId, module);
    this.record(`[ci-progress] start ${module.path}\n`);
    return module;
  }

  private progress(testModule: TestModule | undefined): void {
    if (!testModule) return;

    const module = this.inFlight.get(testModule.moduleId);
    if (!module) return;

    module.lastProgressAt = this.now();
    module.lastStallReportAt = undefined;
  }

  private moduleForHook(hook: ReportedHookContext): TestModule {
    return hook.entity.type === 'module' ? hook.entity : hook.entity.module;
  }

  private reportStalls(): void {
    const now = this.now();
    for (const module of this.inFlight.values()) {
      const stalledFor = now - module.lastProgressAt;
      if (
        stalledFor < this.stallMs ||
        (module.lastStallReportAt !== undefined && now - module.lastStallReportAt < this.stallMs)
      ) continue;

      module.lastStallReportAt = now;
      this.record(`[ci-progress] stalled ${module.path} no progress for ${Math.floor(stalledFor / 1000)}s\n`);
    }
  }

  private stopWatchdog(): void {
    if (this.stallTimer === undefined) return;

    this.clearInterval(this.stallTimer);
    this.stallTimer = undefined;
  }

  private record(line: string): void {
    if (this.inlineDirty) {
      this.write('\n');
      this.inlineDirty = false;
    }
    this.write(line);
  }
}
