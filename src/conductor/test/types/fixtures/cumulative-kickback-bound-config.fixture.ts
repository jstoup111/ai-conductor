import type { HarnessConfig } from '../../../src/types/config.js';

const absent: HarnessConfig = {};
const empty: HarnessConfig = { cumulative_kickback_bound: {} };
const enabled: HarnessConfig = { cumulative_kickback_bound: { enabled: true } };
const disabled: HarnessConfig = { cumulative_kickback_bound: { enabled: false } };

// @ts-expect-error enabled accepts only booleans
const invalidEnabled: HarnessConfig = { cumulative_kickback_bound: { enabled: 'false' } };
// @ts-expect-error the block accepts no keys other than enabled
const unknownSibling: HarnessConfig = { cumulative_kickback_bound: { enabled: false, extra: true } };

void absent;
void empty;
void enabled;
void disabled;
void invalidEnabled;
void unknownSibling;
