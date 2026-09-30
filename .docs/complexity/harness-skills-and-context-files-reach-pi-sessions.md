# Complexity: Harness skills and context files reach Pi sessions like other hosts

Tier: M

Rationale: The change crosses three surfaces but adds no new subsystem. In the engine, it changes the Pi catalog descriptor (invocation prefix, home variable), adds Pi adapter argv for HARNESS.md injection and project skills, and adds a pre-spawn skill-resolution refusal. In `bin/install`, the `--providers` allowlist, readiness, and `--check` gain Pi. In docs, the multiprovider host table and the HARNESS.md invocation list gain a Pi row. It lands on the same `pi-provider.ts` argv that #1885 extends, and the refusal path adds a new failure outcome. Both warrant the Medium conflict-check and lightweight architecture review. Nothing reshapes a seam other features depend on, so it is not Large.
