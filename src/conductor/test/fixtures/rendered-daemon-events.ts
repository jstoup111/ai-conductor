// Covers: task:2
import { renderedEventTypes, type RenderedEventType } from '../../src/engine/event-sinks.js';
import type { ConductorEvent } from '../../src/types/index.js';

type RenderedDaemonEventFixtures = {
  [Type in RenderedEventType]: Extract<ConductorEvent, { type: Type }>;
};

/*
 * Rendering has a deliberately broad event surface. These fixtures retain a
 * real discriminant for every registered event, while the recursive value
 * supplies benign scalar, collection, and formatter-method shapes to renderer
 * fields that are irrelevant to this registry/line-shape contract.
 */
const value = new Proxy(function fixtureValue() {}, {
  get: (_target, key) => {
    if (key === Symbol.iterator) return function* iterator() {};
    if (key === Symbol.toPrimitive) return () => 'fixture';
    if (key === 'toString') return () => 'fixture';
    if (key === 'join') return () => 'fixture';
    if (key === 'map' || key === 'filter') return () => [];
    if (key === 'includes') return () => false;
    if (key === 'length') return 1;
    if (key === 'artifact' || key === 'path' || key === 'step' || key === 'slug' || key === 'reason') return 'fixture';
    if (key === 'attempt' || key === 'count' || key === 'regradeCount' || key === 'waitSeconds') return 1;
    return value;
  },
  apply: () => 'fixture',
}) as unknown as Record<PropertyKey, unknown>;

function fixture<Type extends RenderedEventType>(type: Type): Extract<ConductorEvent, { type: Type }> {
  return new Proxy({ type }, {
    get: (target, key) => key === 'type' ? target.type : value[key],
  }) as Extract<ConductorEvent, { type: Type }>;
}

export const RENDERED_DAEMON_EVENT_FIXTURES: RenderedDaemonEventFixtures = Object.fromEntries(
  renderedEventTypes().map((type) => [type, fixture(type as RenderedEventType)]),
) as RenderedDaemonEventFixtures;
