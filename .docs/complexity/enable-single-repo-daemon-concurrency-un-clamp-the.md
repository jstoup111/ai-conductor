# Complexity: enable-single-repo-daemon-concurrency-un-clamp-the

Tier: L

Rationale: cross-cutting refactor of the daemon's orchestration core (`daemon.ts` pool loop and
its ~12 idle-gated sites), a new dispatcher/executor contract with a document-manifest work order
and a work-claim interface, an interleaving-correct self-host live boundary, a new config key with
resolver/validation/docs, an ADR amendment to the governing serial-pool decision, and N>1
isolation/starvation/attribution tests plus a byte-for-byte serial-equivalence guarantee at the
default. Multiple interacting state machines (pool fill/drain, idle-gate scheduling, claim
lifecycle, live-boundary fingerprint windows) and a compatibility invariant push this past Medium.
