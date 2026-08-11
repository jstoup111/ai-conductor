## Dependency Audit: ai-conductor

**Coverage note:** `npm outdated --json` and `npm audit --json` (read-only, no
install/fix flags) were run once against each package's existing `node_modules`
(`src/conductor`, `plugins/recorder-provider`) early in this audit, before a live
self-host build began running elsewhere in this repo. Once notified of the concurrent
build's live-checkout guard, all further npm/yarn commands were stopped; remaining
findings in this report come from reading manifests/lockfiles/workflow files and source
imports only, per the coordinator's mid-task constraint. Verified afterward:
`git status --porcelain` on both package directories is clean and
`git diff --stat` on both `package.json`/`package-lock.json` pairs is empty — the two
npm reads did not modify any tracked file. The only same-day-mtime files are each
package's `node_modules/.package-lock.json`, which sits under `node_modules/`, a path
the guard itself excludes. Every CVE/version claim below that is labeled `verified`
came from that one npm-audit/outdated pass, not from a script run repeatedly; no vitest
run, `npm install`, or write of any kind followed the constraint.

Scope: `src/conductor/package.json` (main manifest) and `plugins/recorder-provider/package.json`
(plugin manifest). Root repo has no `package.json`. All manifests/lockfiles under
`.worktrees/` and `.claude/worktrees/` are excluded as build-time worktree copies, not
distinct dependency surfaces — **verified** (100%, `find` for `package.json`/`package-lock.json`
outside `node_modules`/`dist-versions`, confirmed both non-worktree hits point to the same two
packages, `git status --porcelain` clean and `git ls-files` shows both `package.json` and
`package-lock.json` tracked for both).

### Package Health Summary

| Package | Current Version | Latest | Status | Risk | Notes |
|---------|----------------|--------|--------|------|-------|
| `vitest` (conductor, dev) | 2.1.9 | 4.1.10 | CVE | **critical** | `npm audit --json`: CVE GHSA-5xrq-8626-4rwp, CVSS 9.8 — "When Vitest UI server is listening, arbitrary file can be read and executed," affects <3.2.6. Dev-only (test runner), so blast radius is a developer/CI machine running `vitest --ui`, not production. Fix requires a major bump (2.x→4.x). **verified** 100% |
| `vitest` (recorder-provider, dev) | 2.1.9 | 4.1.10 | CVE | **critical** (same CVE, dev-only) | Same GHSA-5xrq-8626-4rwp via `npm audit --json` in `plugins/recorder-provider`. **verified** 100% |
| `js-yaml` (conductor, prod, direct) | 4.3.0 | 5.2.3 | CVE | **high** | GHSA-5p4m-2wfm-xmqj, CVSS 7.5, quadratic CPU consumption in `!!omap` resolution, fixed in 4.3.1 — a **prod** dependency (YAML manifest parsing) and the fix is a **patch-level bump already satisfiable within the declared `^4.1.0` range** (`npm outdated` shows wanted 4.3.1). This is the one true "trivial fix, not yet applied" finding — lockfile just needs `npm update js-yaml`. **verified** 100% |
| `uuid` (conductor, prod, direct) | 10.0.0 | 14.0.1 | CVE | medium | GHSA-w5hq-g745-h8pq, CVSS 7.5, "missing buffer bounds check in v3/v5/v6 when `buf` is provided." Fix needs a major bump (10→14 is a **breaking** semver-major per `npm audit`'s `fixAvailable`). ai-conductor's own usage is grep-confirmed in 7 files; whether any call site passes a caller-supplied `buf` (the vulnerable path) is unverified — **inferred**, tentative, ~55% confidence the exploitable code path is even reachable in this codebase's usage pattern. |
| `brace-expansion` (transitive, via eslint/typescript-eslint toolchain) | <1.1.17 / 4.0.0-5.0.8 | 1.1.18+/5.0.9+ | CVE | high | GHSA-mh99-v99m-4gvg / GHSA-rgw5-rvv9-x895, DoS via unbounded expansion (dev toolchain only: eslint glob matching). `fixAvailable: true` (non-major) per `npm audit`. **verified** 100% |
| `nanoid` (transitive, via vite/vitest) | ≤3.3.16 | 3.3.17+ | CVE | high | GHSA-28wg-ghj8-5hjv / GHSA-2v37-7h3g-55p8, dev-only (vite dep chain). `fixAvailable: true`. **verified** 100% |
| `postcss` (transitive, via vite) | ≤8.5.22 | 8.5.23+ (patch chain) | CVE | high | GHSA-r28c-9q8g-f849 (path traversal via sourceMappingURL), plus 3 more advisories on the same package. Dev-only (vite's CSS pipeline, unused by this Node CLI at runtime). `fixAvailable: true`. **verified** 100% |
| `vite` / `vite-node` / `@vitest/mocker` (transitive, via vitest 2.x) | ≤6.4.2 / ≤2.2.0-beta.2 | latest via vitest 4.x | CVE | high/moderate | Multiple GHSAs (path traversal, `server.fs.deny` bypass). All fold into the same vitest 2→4 major upgrade as the fix. Dev-only. **verified** 100% |
| `esbuild` (transitive, via vite) | ≤0.24.2 / 0.27.3-0.28.0 | patched via vitest 4.x | CVE | moderate | GHSA-67mh-4wv8-2f99 + GHSA-g7r4-m6w7-qqqr, dev-server request forgery / Windows arbitrary file read. Dev-only. **verified** 100% |
| `protobufjs` (transitive, via `@opentelemetry/otlp-transformer`) | 7.5.0-7.6.4 | patched upstream | CVE | moderate | GHSA-j3f2-48v5-ccww, DoS via infinite loop in `.proto` parsing. This is a **production** dependency chain (OTel exporters). **verified** 100% |
| `@opentelemetry/core` (transitive, pulled by all 4 exporter packages + resources/sdk-metrics/sdk-trace-base) | <2.8.0 | 2.8.0+ | CVE | moderate | GHSA-8988-4f7v-96qf, unbounded memory allocation in W3C Baggage propagation. Production telemetry path. Fix requires the OTel 0.x→0.221 / 1.x→2.x major bump discussed below. **verified** 100% |
| `@eslint/js` / `eslint` (dev) | 9.39.5 | 10.x | outdated | low | One major behind; no CVE. **verified** (npm outdated) |
| `typescript` (both packages, dev) | 5.9.3 | 7.0.2 | outdated | low | Two majors behind on `npm outdated`'s "latest" tag, but 7.x is a very recent/aggressive jump (TS versioning skips are common; treat "latest" caution — no functional break implied without app code). **verified** version numbers; **inferred** low risk since it's a dev-only compiler. |
| `chokidar` | 4.0.3 | 5.0.0 | outdated | low | One major behind, no CVE. **verified** |
| `commander` | 12.1.0 | 14.0.3 | outdated | low | Two majors behind, no CVE found in audit. **verified** |
| `ora` | 8.2.0 | 9.4.1 | outdated | low | One major behind, no CVE. **verified** |
| `@types/node` (both packages) | 20.19.39 | 26.2.0 | outdated | low | Types package tracks Node's own release cadence; pinned to Node 20 types intentionally (matches `engines.node` and `.tool-versions`). Not a risk on its own. **verified** |

_All other direct/transitive packages reported by `npm outdated`/`npm audit` are patch/minor lag
with no CVE — omitted per the "medium or higher only" instruction._

### OpenTelemetry Cluster — Version-Skew Assessment

9 `@opentelemetry/*` packages declared in `src/conductor/package.json` (**verified**, counted
directly from the manifest):

```
@opentelemetry/api                        ^1.9.0    (installed 1.9.0 range, stable 1.x API surface)
@opentelemetry/exporter-metrics-otlp-grpc ^0.57.0   (installed 0.57.2)
@opentelemetry/exporter-metrics-otlp-http ^0.57.0   (installed 0.57.2)
@opentelemetry/exporter-trace-otlp-grpc   ^0.57.0   (installed 0.57.2)
@opentelemetry/exporter-trace-otlp-http   ^0.57.0   (installed 0.57.2)
@opentelemetry/otlp-transformer           ^0.57.0   (installed 0.57.2)
@opentelemetry/resources                  ^1.30.0   (installed 1.30.1)
@opentelemetry/sdk-metrics                ^1.30.0   (installed 1.30.1)
@opentelemetry/sdk-trace-base             ^1.30.0   (installed 1.30.1)
```

This split (exporters/transformer pinned to the pre-1.0 `0.57.x` experimental line, while
`api`/`resources`/`sdk-*` are on the stable `1.30.x` line) is the OTel project's **own** documented
compatibility contract for this release generation — SDK/API is stable-1.x while exporters remain
experimental-0.x until the exporter API itself stabilizes. All 9 packages currently resolve
consistently within that contract (`npm outdated` shows no packages behind their own `^` range —
`current == wanted` for every one of the 9). **Risk basis: verified, 100%** that the versions are
internally consistent right now.

**Forward risk (inferred, ~75% confidence, tentative):** the known breakage source for this
cluster is future *independent* upgrades — bumping only `resources`/`sdk-metrics`/`sdk-trace-base`
to 2.x (the `npm outdated` "latest" for those three) without also bumping all four exporter
packages and `otlp-transformer` to their matching `0.221.x` "latest" would desync the boundary,
since the exporters' peer/compat range is written against 1.x SDK internals. `npm audit`'s own
`fixAvailable` blocks confirm this coupling — every one of the 9 packages' vulnerability fix is
tied to the *same* target set moving together (0.57→0.221 and 1.30→2.10 as a single atomic bump),
not to any single package updating alone. Any future dependency-bump PR touching this cluster
should update all 9 in the same commit, and pin exact matching minor lines rather than
independent `^` ranges per package — this is a **process recommendation**, not a currently-broken
state.

### Version-Pinning Discipline

- Both manifests use caret (`^`) ranges exclusively for every dependency and devDependency —
  **verified**, 100% (read both `package.json` files in full, zero exact-pin entries).
- Both packages carry a committed `package-lock.json` that is git-tracked and clean
  (`git status --porcelain` empty on both) — **verified** 100%. No missing-lockfile or
  uncommitted-lockfile supply-chain finding.
- `npm outdated`'s `current`/`wanted` columns match for the overwhelming majority of packages
  (caret ranges are being kept current within their major), the exceptions being `js-yaml`
  (4.3.0 installed vs 4.3.1 wanted) and `@types/node`, `@types/semver`, `tsx`,
  `typescript-eslint`, `semver` — all install-drift (a `wanted` newer than `current` inside the
  same major), fixable by a plain `npm update`, not a manifest edit. **verified** via
  `npm outdated --json` output.

### Node Engine Constraint vs CI

- `src/conductor/package.json` declares `"engines": { "node": ">=20.5.0" }` — **verified**
  (package.json:6-8).
- `plugins/recorder-provider/package.json` declares **no** `engines` field at all — **verified**
  (full file read, no `engines` key present). Minor finding: the plugin package has no floor on
  the Node version it requires, so a consumer installing it standalone gets no guardrail.
- Root `.tool-versions` pins `nodejs 20.19.2` — **verified** (file read). All 11 GitHub Actions
  workflows that run Node reference `node-version-file: src/conductor/.tool-versions`
  (`grep -rn node-version .github/workflows/`, 11 matches across `ci.yml`, `release.yml`,
  `release-pr.yml`, `shipped-record.yml`, `release-metadata.yml`,
  `intake-label-sync.yml`, `live-daemon-e2e.yml`) — **verified** 100%. CI's actual Node
  (20.19.2) satisfies the manifest's `>=20.5.0` floor and both are internally consistent; no
  drift between declared engine and CI-run version.
- Node 20.x is in **Active LTS** as of the current date (2026-08-10) per Node's release
  schedule through ~April 2026, moving to Maintenance thereafter — this specific EOL-date claim
  is **inferred** from general Node release-cadence knowledge, not verified against a live
  schedule source in this audit; treat as **tentative**.

### Dependency Usage — Declared vs Actually Imported

- All 8 non-OTel `conductor` prod dependencies were grep-confirmed as imported somewhere in
  `src/`: `chalk` (5 files), `chokidar` (1), `commander` (1), `execa` (27), `js-yaml` (4), `ora`
  (2), `semver` (1), `uuid` (7). **verified** 100%, no unused prod dependency found among these.
- All 9 `@opentelemetry/*` packages are imported at least once in `src/` (1-2 files each,
  consistent with a thin telemetry-adapter layer wrapping the SDK). **verified** 100%.
- No case found of a package imported in `src/` but **not** declared in `package.json`
  (used-but-undeclared) among the checked set — **inferred**, ~70% confidence; this check was
  done by confirming declared deps are used, not by scanning every import statement in the
  codebase against the manifest, so an undeclared-but-used package elsewhere in the 1390-file
  tree cannot be ruled out with the searches actually run. Mark **tentative**.
- `plugins/recorder-provider` declares **zero** runtime dependencies (only `devDependencies`:
  `@types/node`, `typescript`, `vitest`) — **verified** (full manifest read). This is
  appropriate for a thin reference/example plugin but means its actual behavior at runtime is
  either stdlib-only or relies entirely on whatever the host `conductor` package injects.

### Heavyweight / Abandoned / Risky Dependencies

- **`vitest` 2.1.9** — actively maintained, not abandoned, but the installed major (2.x) is two
  majors behind and carries the one **critical** CVE in this audit (GHSA-5xrq-8626-4rwp). Because
  it's dev-only, the practical exposure is a developer or CI runner invoking `vitest --ui`
  (a UI/dev-server mode) — grep of `package.json` scripts shows no `--ui` flag used in any
  committed script (`test`, `test:changed`, `test:watch`, `smoke` — none pass `--ui`), which
  lowers real-world exposure. **verified** 100% that no script invokes `--ui`; **inferred**,
  ~85% confidence, that this materially reduces exploitability since a developer could still run
  it ad hoc.
- **OTel exporter cluster (0.57.x line)** — by definition of being pre-1.0, these packages
  self-declare an unstable API; that's a known, accepted risk of using OTel's Node exporters at
  all pre-2.0, not specific to this codebase's choices. No abandonment signal (actively
  releasing, per the `0.221.0` "latest" seen in `npm outdated`). **inferred**, 90% confidence,
  based on version numbering conventions rather than checking release cadence/dates directly (no
  network access to npm registry timestamps was exercised in this audit — **not verified**
  against actual publish dates).
- No stdlib-replaceable heavyweight dependency found among the declared set — `execa` (process
  spawning with better ergonomics than `child_process`), `chokidar` (cross-platform fs watching,
  materially harder to hand-roll correctly than `fs.watch`), and `semver` (spec-correct semver
  parsing) are all reasonable non-stdlib choices for what they do. **inferred**, tentative,
  since this is a judgment call rather than a fact to verify.
- **Last-publish-date / "abandoned >18 months" check was NOT performed** — no network access to
  the npm registry was used in this audit (all data came from local `npm outdated`/`npm audit`
  against the installed lockfile, which reports version deltas but not publish timestamps). This
  is a **coverage gap**, not a clean bill of health — flag as **unverified** rather than
  asserting no abandoned packages exist.

### Plugin/Provider Boundary — Supply-Chain Surface

`src/conductor/src/engine/plugin-loader.ts:26` performs a genuine dynamic-code-execution supply
chain surface:

```ts
const mod = await import(entrypointPath);
```

- `discoverPlugins()` (plugin-loader.ts:64-125) scans a **global** plugin directory
  (`~/.ai-conductor/plugins/`) and a **project-local** directory (`.ai-conductor/plugins/`),
  reads each subdirectory's `plugin.yml` manifest, and dynamically `import()`s the manifest's
  declared `entrypoint` file with no further validation of its origin, signature, or contents
  beyond checking the loaded module exposes required method names (`invoke`,
  `invokeInteractive` for `llm_provider` kind). **verified** 100% (file read in full for the
  relevant section, lines 1-125).
- Project-local plugins **silently shadow** global plugins of the same kind+name
  (plugin-loader.ts:107-117) — arbitrary code in a project's `.ai-conductor/plugins/` directory
  can override a trusted global plugin without an explicit opt-in beyond the directory existing.
  **verified** 100%.
- This is a genuine supply-chain surface distinct from npm package risk: any code that ends up
  on disk under either plugin directory — whether hand-authored, cloned from a repo, or dropped
  by a compromised installer — executes with full Node process privileges the moment
  `discoverPlugins()` runs, with no sandbox, checksum, or allowlist gate visible in this file.
  Whether such a gate exists elsewhere (e.g., at plugin *install* time rather than *load* time)
  was **not checked** in this audit — this file only covers load-time behavior. **Tentative**,
  flag for the security auditor (`cto-security`) to check plugin-install-time validation, since
  this auditor's scope is dependency/package health, not code-level exploit surfaces.
- The repo's own `plugins/recorder-provider` is the in-tree reference implementation of this
  plugin contract and ships with zero runtime dependencies (see above), so it does not itself
  add third-party supply-chain exposure — the risk is structural (the loader accepts arbitrary
  local code), not about `recorder-provider`'s own dependency tree.

### License Compliance

**Status:** PASS

| Package | License | Concern |
|---------|---------|---------|
| `chalk`, `chokidar`, `commander`, `execa`, `js-yaml`, `ora`, `uuid` | MIT | None |
| `semver` | ISC | None — permissive, equivalent to MIT |
| `@opentelemetry/*` (all 9) | Apache-2.0 | None — permissive, patent-grant clause is favorable for a commercial/SaaS context |

All 11 license values above were read directly from each installed package's own
`package.json` `license` field via `node -e "require(...).license"` — **verified** 100%, not
inferred from package reputation. No GPL/AGPL/SSPL/unlicensed package found in the direct
dependency set of either manifest.

### Upgrade Path Blockers

**Status:** NEEDS_WORK

| Target Upgrade | Blocked By | Reason |
|---------------|-----------|--------|
| `vitest` 2.1.9 → 4.1.10 (both packages) | `@vitest/mocker`, `vite`, `vite-node`, `esbuild`, `postcss`, `nanoid` all move together | `npm audit`'s `fixAvailable` for every transitive vitest-chain CVE points at the same target: `vitest@4.1.10`, `isSemVerMajor: true`. This is a single atomic major-version upgrade, not independently blocked by anything outside the vitest dependency tree itself — but a major test-runner bump (2.x→4.x, skipping 3.x) carries real risk of config/API breaking changes in `vitest.config.ts`/`vitest.smoke.config.ts` that were not assessed here (out of this auditor's scope — architecture/test-authoring concern). **verified** the audit linkage, **inferred** the migration-effort risk. |
| `uuid` 10.0.0 → 14.0.1 | None found — `fixAvailable: { version: "14.0.1", isSemVerMajor: true }` with no intermediate blocking package | Straightforward major bump once call sites are checked for v3/v5/v6 `buf`-argument usage (the CVE'd path) and any v10→v14 API changes. **verified** via npm audit fixAvailable field. |
| `@opentelemetry/*` 0.57.x/1.30.x → 0.221.x/2.10.x (all 9 packages) | Must move as one set (see OTel cluster section) | No single blocking package outside the cluster itself; the constraint is internal consistency across the 9-package boundary, not an external blocker. **inferred**, 75% confidence, tentative. |

### Deprecation Warnings at Install Time

Not checked — the task instructions prohibit running `npm install`, which is the mechanism that
surfaces `npm warn deprecated` output; `npm outdated`/`npm audit` against the existing
`node_modules` do not reproduce install-time deprecation warnings. **Coverage gap, not a clean
result** — flag as unverified rather than asserting no deprecation warnings exist.

---

### Summary
**Overall Verdict:** NEEDS_WORK

**Critical findings:** 1 — `vitest` 2.1.9, CVE GHSA-5xrq-8626-4rwp (CVSS 9.8) present in both
`src/conductor` and `plugins/recorder-provider`, same root cause, counted once as one
cross-package finding. Dev-only exposure (no `--ui` script committed), but the CVSS score and
"critical" npm-audit severity label stand regardless of blast-radius mitigation.

**High risk findings:** 6 — `js-yaml` prod CVE (patch-level fix available, no version bump
needed beyond lockfile update); `uuid` prod CVE (major bump required); `brace-expansion`,
`nanoid`, `postcss` transitive dev-chain CVEs (non-major fixes available); plugin-loader
dynamic `import()` of unsandboxed local plugin code as a structural supply-chain surface.

**Medium risk findings:** 3 — `protobufjs` and `@opentelemetry/core` transitive prod CVEs tied
to the OTel cluster's coordinated major-bump requirement; `plugins/recorder-provider` missing an
`engines` field.

**Low risk findings:** 6 — one-to-two-major version lag with no CVE on `eslint`/`@eslint/js`,
`typescript`, `chokidar`, `commander`, `ora`; install-drift on `js-yaml`/`@types/*`/`tsx`/
`typescript-eslint`/`semver` fixable by plain `npm update`.

**Recommended immediate actions:**
- Run `npm update js-yaml` in `src/conductor` to pick up the already-in-range 4.3.1 patch
  fixing the high-severity CVE — zero manifest change needed, lowest-effort fix in this report.
- Schedule the coordinated `vitest` 2.x→4.x bump across both `src/conductor` and
  `plugins/recorder-provider` in the same PR (resolves the critical CVE plus 5 of the transitive
  dev-chain CVEs at once); treat as a real migration requiring test-suite verification, not a
  drive-by bump.
- Schedule the `@opentelemetry/*` 9-package coordinated bump (0.57.x→0.221.x,
  1.30.x→2.10.x) as one atomic PR, matched to OTel's own compatibility contract — do not bump
  any subset independently.
- Evaluate the `uuid` 10→14 major bump; confirm no call site passes a caller-supplied `buf` to
  `v3`/`v5`/`v6` before deciding whether this is exploitable in practice or just hygiene.
- Route the plugin-loader dynamic-`import()` finding to `cto-security` to assess whether an
  install-time validation/allowlist gate exists elsewhere in the codebase, since this audit only
  covered load-time behavior in `plugin-loader.ts`.
