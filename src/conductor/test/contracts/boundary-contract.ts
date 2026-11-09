import { describe, it } from 'vitest';

export type BoundaryContractLeg = 'fake' | 'real';

export interface BoundaryContractExpectation<S> {
  readonly name: string;
  readonly run: (subject: S) => void | Promise<void>;
}

export interface BoundaryContract<S> {
  readonly boundary: string;
  readonly expectations: readonly BoundaryContractExpectation<S>[];
}

export interface BoundaryContractDefinition<S> {
  readonly boundary: string;
  readonly expectations: readonly BoundaryContractExpectation<S>[];
}

/** Defines an immutable, ordered set of assertions shared by fake and real adapter legs. */
export function defineBoundaryContract<S>({ boundary, expectations }: BoundaryContractDefinition<S>): BoundaryContract<S> {
  if (expectations.length === 0) {
    throw new Error(`Boundary contract ${boundary} is empty`);
  }

  const names = new Set<string>();
  for (const expectation of expectations) {
    if (names.has(expectation.name)) {
      throw new Error(`Boundary contract ${boundary} repeats expectation ${expectation.name}`);
    }
    names.add(expectation.name);
  }

  return Object.freeze({
    boundary,
    expectations: Object.freeze(expectations.map((expectation) => Object.freeze({ ...expectation }))),
  });
}

export interface BoundaryContractRun<S> {
  readonly adapter: string;
  readonly leg: BoundaryContractLeg;
  readonly create: () => S | Promise<S>;
  readonly timeoutMs?: number;
}

/** Registers the independently-executed cases for one adapter leg. */
export function runBoundaryContract<S>(contract: BoundaryContract<S>, { adapter, leg, create, timeoutMs }: BoundaryContractRun<S>): void {
  describe(`${contract.boundary} contract [${adapter} ${leg}]`, () => {
    for (const expectation of contract.expectations) {
      it(expectation.name, async () => {
        const subject = await create();
        await expectation.run(subject);
      }, timeoutMs);
    }
  });
}
