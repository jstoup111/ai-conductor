import { describe, expect, it, vi } from 'vitest';
import { createProviderAvailability } from '../../src/engine/provider-availability.js';

describe('provider availability', () => {
  it('re-admits an expired provider and permits the next injected invocation without operator action', () => {
    let now = 1_000;
    const availability = createProviderAvailability({ now: () => now });
    const invoke = vi.fn();

    availability.suppress('claude', 1_500);
    expect(availability.isAvailable('claude')).toBe(false);

    now = 1_501;
    expect(availability.isAvailable('claude')).toBe(true);
    if (availability.isAvailable('claude')) {
      invoke('claude');
    }

    expect(invoke).toHaveBeenCalledExactlyOnceWith('claude');
  });

  it('keeps the later deadline when an earlier suppression is recorded second', () => {
    let now = 1_000;
    const availability = createProviderAvailability({ now: () => now });

    availability.suppress('claude', 3_000);
    availability.suppress('claude', 2_000);

    now = 2_500;
    expect(availability.isAvailable('claude')).toBe(false);
    now = 3_000;
    expect(availability.isAvailable('claude')).toBe(true);
  });

  it('re-admits a provider after the bounded default interval when no parsed deadline supplied it', () => {
    let now = 1_000;
    const availability = createProviderAvailability({ now: () => now });
    const boundedDefaultIntervalMs = 60_000;

    availability.suppress('claude', now + boundedDefaultIntervalMs);
    expect(availability.isAvailable('claude')).toBe(false);

    now += boundedDefaultIntervalMs + 1;
    expect(availability.isAvailable('claude')).toBe(true);
  });

  it('does not suppress a provider for a deadline at or before the injected clock', () => {
    const availability = createProviderAvailability({ now: () => 1_000 });

    availability.suppress('claude', 1_000);
    availability.suppress('codex', 999);

    expect(availability.isAvailable('claude')).toBe(true);
    expect(availability.isAvailable('codex')).toBe(true);
  });

  it('opens a fresh suppression window when a re-admitted provider is exhausted again', () => {
    let now = 1_000;
    const availability = createProviderAvailability({ now: () => now });

    availability.suppress('claude', 1_100);
    now = 1_101;
    expect(availability.isAvailable('claude')).toBe(true);

    availability.suppress('claude', 1_300);
    expect(availability.isAvailable('claude')).toBe(false);
    now = 1_300;
    expect(availability.isAvailable('claude')).toBe(true);
  });

  it('admits two evaluations made just after the same elapsed deadline', () => {
    let now = 1_000;
    const availability = createProviderAvailability({ now: () => now });

    availability.suppress('claude', 1_100);
    now = 1_101;

    expect(availability.isAvailable('claude')).toBe(true);
    expect(availability.isAvailable('claude')).toBe(true);
  });

  it('keeps a provider ordinarily available to subsequent steps after expiry and success', () => {
    let now = 1_000;
    const availability = createProviderAvailability({ now: () => now });

    availability.suppress('claude', 1_100);
    now = 1_101;

    expect(availability.isAvailable('claude')).toBe(true);
    // A successful invocation does not write new availability state.
    expect(availability.isAvailable('claude')).toBe(true);
  });

  it('changes only admission, preserving the resolved candidate order', () => {
    const availability = createProviderAvailability({ now: () => 1_000 });
    const candidates = ['claude', 'codex', 'custom-provider'];
    const beforeSuppression = candidates.map((provider) => ({
      provider,
      admitted: availability.isAvailable(provider),
    }));

    availability.suppress('codex', 2_000);
    const duringSuppression = candidates.map((provider) => ({
      provider,
      admitted: availability.isAvailable(provider),
    }));

    expect(duringSuppression.map(({ provider }) => provider)).toEqual(
      beforeSuppression.map(({ provider }) => provider),
    );
    expect(duringSuppression.map(({ admitted }) => admitted)).toEqual([true, false, true]);
  });
});
