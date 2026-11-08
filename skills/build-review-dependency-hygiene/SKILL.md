---
name: build-review-dependency-hygiene
disable-model-invocation: true
description: "Judge whether a feature diff adds unnecessary, insufficiently pinned, or license-incompatible dependencies."
enforcement: gating
phase: build
---

## Purpose

Judge one engine-managed `build_review` dependency-hygiene rubric branch. This is a
provider-neutral, judgement-only policy: the engine owns scope selection, evidence assembly,
finding identity, and the outer gate verdict.

## Judgement

Judge only dependency additions or version changes introduced by the feature diff. Report one
finding per independent concern, anchored to the changed manifest or lockfile hunk that introduces
it. Use on-disk evidence only for dependency and license facts.

- `necessity` — when an added dependency's purpose is already served by an existing declared
  dependency or an existing in-repo module, report a finding of at least `major` severity that names
  the added dependency and the existing equivalent's path.
- `pinning` — report a finding of at least `major` severity when an added or upgraded dependency
  uses `*`, `latest`, or an unbounded `>=` range, or with a manifest change and no matching
  committed lockfile update. Name the dependency and the manifest location.
- `license` — compare on-disk dependency license metadata with the project's declared license. If
  the dependency license is incompatible with the project's declared license, report a finding of
  at least `major` severity that names both licenses and the evidence location. If no on-disk evidence
  can determine the dependency license, report a `license` finding with severity `nit` that states
  the license is unverifiable.

## Recommended paths

Configure manifest and lockfile paths appropriate to the project's ecosystems:

- npm: `**/package.json`, `**/package-lock.json`
- Yarn: `**/package.json`, `**/yarn.lock`
- pnpm: `**/package.json`, `**/pnpm-lock.yaml`
- Bundler: `**/Gemfile`, `**/Gemfile.lock`
- pip: `**/requirements*.txt`, `**/requirements*.lock`
- Poetry: `**/pyproject.toml`, `**/poetry.lock`
- uv: `**/pyproject.toml`, `**/uv.lock`
- Go modules: `**/go.mod`, `**/go.sum`
- Cargo: `**/Cargo.toml`, `**/Cargo.lock`
- Maven: `**/pom.xml`, `**/.mvn/dependency-locks/**`
- Gradle: `**/build.gradle*`, `**/gradle.lockfile`
