**Status:** Accepted

# Stories: User-level configuration precedence (#1000)

## Story 1: Validation preserves caller-owned configuration

**Requirement:** Technical intent TI-1 — configuration validation is pure with respect to its input while returning the same normalized result contract.

As a configuration caller, I want validation to return a normalized configuration without modifying the value I supplied so validation order cannot silently change later precedence or caller state.

### Acceptance Criteria

#### Happy Path

- Given a valid configuration containing top-level and nested objects, when it is validated, then the returned configuration contains the expected normalized values and the original input remains deeply equal to its pre-call snapshot.
- Given an absent value whose current contract materializes a default, when effective configuration is validated, then the returned configuration contains that default while the original input still lacks the key.
- Given a present value whose current contract clamps or normalizes it with a warning, when validation succeeds, then only the returned configuration contains the normalized value and the original input retains the supplied value.

#### Negative Paths

- Given a configuration with an unknown top-level or nested key, when validation rejects it, then the error remains the existing validation error and the rejected input is unchanged at every depth.
- Given a malformed value whose current contract falls back rather than rejects, when validation runs, then the result and warning follow the existing fallback contract without writing the fallback into the input.
- Given a returned normalized nested object is later modified by a caller, when the original input is inspected, then it remains unchanged rather than sharing a mutable nested reference with the result.

### Done When

- [ ] Tests compare complete before/after snapshots for successful, warning-producing, and rejected validation.
- [ ] Tests prove nested objects are not shared between caller input and normalized output where validation writes or defaults nested data.
- [ ] Existing normalized values, warnings, and validation errors remain unchanged apart from removal of input mutation.

## Story 2: Explicit project values override user defaults precisely

**Requirement:** Technical intent TI-2 — all eight affected keys obey user-under-project precedence based on explicit presence, not validator-injected defaults.

As an operator, I want my user-level setting to apply whenever a project does not explicitly set that key so machine defaults work without weakening repository policy.

The required matrix applies independently to:

- `ci_watch`
- `build_review`
- `auto_restart_on_stale_engine`
- `engine_refresh_min_interval_seconds`
- `attribution_audit_sample_pct`
- `build_progress_halt`
- `kickback_escalation`
- `retry_routing`

### Acceptance Criteria

#### Happy Path

- Given each affected key has a schema-valid user value and is absent from project configuration, when effective configuration is loaded, then the effective value equals the user value.
- Given each affected key has a schema-valid project value and is absent from user configuration, when effective configuration is loaded, then the effective value equals the project value.
- Given each affected key has distinct schema-valid values in user and project configuration, when effective configuration is loaded, then the project value wins for that key.
- Given an affected key is absent from both scopes, when effective configuration is loaded, then its existing runtime default is materialized.
- Given unrelated nested objects, scalars, or arrays exist in both scopes, when effective configuration is loaded, then existing deep-merge semantics remain unchanged: objects merge recursively and project scalars or arrays replace user values.

#### Negative Paths

- Given a user-only affected value is malformed, when effective configuration is loaded, then the existing merged-validation error or fallback contract applies; the raw malformed value is never silently accepted.
- Given a project-only affected value is malformed, when project-source validation runs, then its existing error or fallback contract applies before merge; an underlying user value does not launder the malformed project policy.
- Given both scopes set an affected key and the explicit project value triggers a documented fallback or warning, when effective configuration is loaded, then the project result remains authoritative rather than falling through to the valid user value.
- Given neither scope sets an affected key, when defaults are materialized after merge, then no affected value remains undefined and no duplicate warning is emitted solely because validation ran twice.
- Given an unrelated nested object, scalar, or array is present in both scopes, when merging occurs, then the fix does not reverse precedence, concatenate arrays, or erase unrelated user object members.

### Done When

- [ ] A data-driven regression matrix covers all eight keys in user-only, project-only, and both-scopes cases: 24 precedence cases minimum.
- [ ] Tests cover the neither-scope default for every affected key.
- [ ] Tests prove explicit malformed project values retain their current error/fallback behavior and never expose an underlying user value.
- [ ] Existing object, scalar, and array merge-contract tests remain green.

## Story 3: Source-specific configuration safeguards remain intact

**Requirement:** Technical intent TI-3 — fixing merged precedence does not weaken project-only validation, identity protection, or existing loader behavior.

As a harness maintainer, I want the pre-merge and project-only loader paths to preserve their established safeguards so a precedence repair cannot disable defaults or launder invalid shared policy.

### Acceptance Criteria

#### Happy Path

- Given ordinary project-only loading with affected keys absent, when `loadConfig` succeeds, then it continues returning the same runtime-ready defaults as before this change.
- Given merged loading with a valid project file and a valid or absent user file, when configuration resolves, then project-source validation occurs before merge and effective validation occurs after merge.
- Given a valid explicit project value requires normalization, when project configuration is loaded for merging, then the normalized project value remains explicit and authoritative.

#### Negative Paths

- Given project configuration contains `spec_owner`, when project-source validation runs, then loading fails with the existing anti-leak diagnostic before any merge can hide its origin.
- Given a project-only caller loads configuration without any affected keys, when deferred-default behavior is exercised by merged loading elsewhere, then the project-only result does not lose its established defaults.
- Given project-source validation rejects an invalid value, when merged loading is attempted, then no partially merged or defaulted configuration is returned.

### Done When

- [ ] Regression tests distinguish ordinary `loadConfig` behavior from the deferred project pre-merge pass.
- [ ] The existing `spec_owner` project-source rejection remains byte-for-byte compatible in outcome and actionable message.
- [ ] A failed project validation produces no effective configuration and mutates neither source object.
