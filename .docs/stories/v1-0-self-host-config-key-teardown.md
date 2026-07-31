**Status:** Accepted

## Story: Retire obsolete self-host cutover residue without weakening ownership

As the harness operator, I want obsolete v1.0 bootstrap and cutover residue removed at the
correct lifecycle point so that the committed self-host configuration describes only active
policy without restoring pre-release approval stalls or weakening cross-operator ownership.

### Acceptance Criteria

#### Happy Path

- Given the #722 cleanup is applied before the v1.0 cutover, when the project configuration
  is inspected, then `owner_gate_cutover`, `attribution_enforcement_cutover`, and
  `attribution_judge_cutover` are absent, `attribution_audit_sample_pct: 10` remains while
  telemetry consumes it, and `harness_self_host.version_freeze` still matches the pre-1.0
  `VERSION`.
- Given the retired enforcement and judge cutovers have no production consumers, when their
  teardown is complete, then their shared config types, allow-list entries, validators, dead
  tests, and stale dependent fixtures are removed while live attribution telemetry tests
  continue without either key.
- Given a spec carries an `Owner:` stamp for another resolved operator, when this daemon
  discovers it after the historical cutover key is removed, then the spec remains gated as
  `other-owner`.
- Given an unowned spec is discovered with a resolved daemon owner and no
  `owner_gate_cutover`, when backlog discovery reports its decision, then the spec
  default-builds under that daemon owner and the notice accurately describes that behavior.
- Given #226 moves `VERSION` to `1.0.0`, when its cutover checklist is executed, then
  `harness_self_host.version_freeze` is removed in that PR rather than earlier.

#### Negative Paths

- Given pre-1.0 work remains, when #722 is implemented, then it does not remove or change
  `harness_self_host.version_freeze` and therefore does not restore per-feature version
  approval halts.
- Given `owner_gate_cutover` is absent, when an unowned spec default-builds, then no message
  claims that unowned specs are skipped.
- Given attribution telemetry still reads `attribution_audit_sample_pct`, when obsolete
  cutover residue is removed, then the sampling key is not removed.
- Given an existing consumer config contains either removed attribution cutover key, when
  that consumer upgrades, then the release migration tells the operator to delete the keys
  before loading the new config schema.

### Done When

- [ ] The committed self-host config contains the retained freeze and audit sampling keys,
      but none of the retired owner/enforcement/judge cutover residue.
- [ ] Owner-gate tests prove that differently stamped owners still skip and unowned specs
      still default-build without a misleading no-cutover warning.
- [ ] No production type, config parser branch, or test fixture depends on either retired
      attribution cutover key; audit sampling remains live and covered.
- [ ] The release migration names both removed consumer config keys and provides a runnable
      removal step.
- [ ] Issue #226 records that its `VERSION → 1.0.0` cutover must remove `version_freeze`.
