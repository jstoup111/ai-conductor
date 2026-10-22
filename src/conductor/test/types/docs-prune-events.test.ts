import type { ConductorEvent } from '../../src/types/events.js';

const event: ConductorEvent = { type: 'decide_artifacts_pruned', removed: [], deferred: [{ stem: 'alpha', paths: [], reason: 'open-pr-modifies', pullRequests: [] }], skipped: [{ stem: 'beta', reason: 'no-shipped-record' }], excluded: [] };
void event;
// @ts-expect-error closed deferred reason
const invalid: ConductorEvent = { type: 'decide_artifacts_pruned', removed: [], deferred: [{ stem: 'alpha', paths: [], reason: 'other', pullRequests: [] }], skipped: [], excluded: [] };
void invalid;
