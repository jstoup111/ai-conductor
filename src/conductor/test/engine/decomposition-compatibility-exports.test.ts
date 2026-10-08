// Covers: task:10
import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  AttributionAuditDispatchResult,
  SpotAuditDispatchResult,
} from '../../src/engine/attribution-audit.js';
import {
  KICKBACK_LEDGER_MAX_PER_GATE,
  MAX_KICKBACKS_PER_GATE,
} from '../../src/engine/kickback-ledger.js';

describe('conductor decomposition compatibility exports', () => {
  it('retains the legacy kickback cap export at its destination module', () => {
    expect(MAX_KICKBACKS_PER_GATE).toBe(KICKBACK_LEDGER_MAX_PER_GATE);
  });

  it('retains the legacy spot-audit dispatch type export at its destination module', () => {
    expectTypeOf<SpotAuditDispatchResult>().toEqualTypeOf<AttributionAuditDispatchResult>();
  });
});
