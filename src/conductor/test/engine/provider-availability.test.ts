import { describe, expect, it } from 'vitest';
import { createProviderAvailability } from '../../src/engine/provider-availability.js';

describe('provider availability', () => {
  it('admits an unsuppressed provider and suppresses it until the injected clock reaches its deadline', () => {
    let now = 1_000;
    const availability = createProviderAvailability({ now: () => now });

    expect(availability.isAvailable('claude')).toBe(true);

    availability.suppress('claude', 1_500);
    expect(availability.isAvailable('claude')).toBe(false);

    now = 1_500;
    expect(availability.isAvailable('claude')).toBe(true);
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

  it('does not suppress a provider for a deadline at or before the injected clock', () => {
    const availability = createProviderAvailability({ now: () => 1_000 });

    availability.suppress('claude', 1_000);
    availability.suppress('codex', 999);

    expect(availability.isAvailable('claude')).toBe(true);
    expect(availability.isAvailable('codex')).toBe(true);
  });

  it('never leaves a provider permanently unavailable across repeated suppression and expiry cycles', () => {
    let now = 1_000;
    const availability = createProviderAvailability({ now: () => now });

    for (const deadline of [1_100, 1_200, 1_300]) {
      availability.suppress('claude', deadline);
      expect(availability.isAvailable('claude')).toBe(false);
      now = deadline;
      expect(availability.isAvailable('claude')).toBe(true);
    }
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
