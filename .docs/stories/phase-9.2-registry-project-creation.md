# Stories: Phase 9.2 — Project Registry + Creation

**Status:** Accepted
**Source PRD:** `.docs/specs/2026-06-25-phase-9.2-registry-project-creation.md`
**Complexity tier:** M
**Persona note:** "I" is the **operator** (runs `register`/`create`) or **`/bootstrap`** (which
auto-registers). The future **brain** (9.3) is the eventual reader. Scenarios are expressed in
terms of `~/.ai-conductor/registry.json`, project records, CLI exit codes/errors, and scaffolded
files — there is no HTTP/UI surface.

---

## Story: Registry file location, override, creation

**Requirement:** FR-1
As the operator, I want the registry at a predictable cross-project path, so the brain can find it
and it never clutters a repo.

### Acceptance Criteria
#### Happy Path
- Given no override, when the registry is read/written, then it resolves to
  `~/.ai-conductor/registry.json`.
- Given `$AI_CONDUCTOR_REGISTRY` is set, when resolved, then that path is used instead.
- Given the file/dir does not exist, when first written, then it is created (with the parent dir).

#### Negative Paths
- Given any resolution, when computed, then the path is **never inside a project repo** (assert it
  is outside a given project root).
- Given an unset `$HOME` / unresolvable home (edge), when resolving without an override, then it
  errors clearly rather than writing to a wrong/relative location.

### Done When
- [ ] Default `~/.ai-conductor/registry.json`; override honored; auto-created; outside any repo.
- [ ] Test: resolution from injected `{home, env}` (testable, mirrors `user-config.ts`).

---

## Story: Project record schema

**Requirement:** FR-2
As the future brain, I want each project record well-formed and versioned, so I can read the
registry reliably.

### Acceptance Criteria
#### Happy Path
- Given a registration, when the record is written, then it has
  `{schemaVersion, name, path (absolute), remote?, status, registeredAt}` with `status` ∈
  {`registered`, `created`}.
- Given the schema evolves later, when a record is written, then it carries the current
  `schemaVersion`.

#### Negative Paths
- Given a project with no git remote, when registered, then `remote` is **absent/null** (not an
  empty-string that looks like a remote).
- Given the file is read back, when parsed, then it is valid JSON and every record conforms (no
  partial record from an interrupted write).

### Done When
- [ ] Record matches schema; `remote` optional; `schemaVersion` set; file parses as valid JSON.

---

## Story: Register an existing project

**Requirement:** FR-3
As the operator, I want `register [path]` to add my project to the registry, so the brain knows it
exists.

### Acceptance Criteria
#### Happy Path
- Given a git repo at `path` (default cwd), when I run `register`, then a record is written with
  `name` = basename, absolute `path`, `remote` from `git remote get-url origin` if present, and
  `status: registered`.
- Given the command succeeds, when it exits, then it reports the registered project and exits 0.

#### Negative Paths
- Given a repo with a relative path argument, when registered, then the stored `path` is
  **absolute** (resolved), so the brain has a stable key.

### Done When
- [ ] `register` writes a correct record; relative path → stored absolute; exit 0 on success.
- [ ] Test: register in a real temp git repo → record fields asserted from the REAL derivation
      (basename, abs path, discovered remote) — not injected literals.

---

## Story: Register is idempotent (dedup by path)

**Requirement:** FR-4
As the operator, I want re-registering a project to update it, not duplicate it, so the registry
stays clean.

### Acceptance Criteria
#### Happy Path
- Given a project already registered, when I register the same `path` again (e.g. its remote
  changed), then the existing record is **updated in place** and there is still exactly **one**
  record for that path.

#### Negative Paths
- Given two different projects, when both are registered, then they produce **two distinct**
  records (no collision) — dedup is by absolute path, and distinct paths never merge.
- Given the same project reached via a symlinked vs canonical path, when registered twice, then it
  is treated as one (paths are canonicalized) — or, if not canonicalized, this is documented as a
  known limitation in the record (decide at architecture).

### Done When
- [ ] Re-register same path → 1 updated record; distinct paths → distinct records.
- [ ] Test: register→re-register asserts count stays 1 and fields updated.

---

## Story: Register rejects invalid targets without corrupting the registry

**Requirement:** FR-5
As the operator, I want a bad `register` to fail safely, so I never end up with a half-written
registry.

### Acceptance Criteria
#### Happy Path (of the failure mode)
- Given a non-existent `path`, when I run `register`, then it exits non-zero with a clear error and
  the registry file is **unchanged**.
- Given a path that exists but is **not a git repo**, when I run `register`, then it errors and the
  registry is **unchanged**.

#### Negative Paths
- Given a pre-existing valid registry, when a failed `register` occurs, then the prior records are
  intact and the file is still valid JSON (no truncation).

### Done When
- [ ] Non-existent/non-git path → non-zero exit, clear error, registry byte-identical to before.
- [ ] Test: failed register leaves an existing registry unchanged + valid.

---

## Story: Create a new project (scaffold + register)

**Requirement:** FR-6
As the operator, I want `create <name>` to stand up a new project and register it, so I (and later
the brain) can start work immediately.

### Acceptance Criteria
#### Happy Path
- Given a fresh target, when I run `create <name> [--remote <url>]`, then it: `git init`s the repo,
  writes a bootstrap `CLAUDE.md` (from the template, referencing HARNESS.md), seeds `.gitignore`
  with `.pipeline/`, `.daemon/`, `.worktrees/`, sets the remote if `--remote` given, and writes a
  registry record with `status: created`.
- Given `--remote` is omitted, when create runs, then it scaffolds + registers with `remote`
  absent (no remote configured), no network calls.

#### Negative Paths
- Given `--remote <url>`, when create runs, then it `git remote add` only — it does **not** push
  (no network side effects).
- Given `create`, when it scaffolds, then it writes only a **minimal skeleton** (git init +
  template CLAUDE.md + `.gitignore` + register) — it does **not** re-implement `/bootstrap`'s
  stack detection or `.memory/`/`.docs/` onboarding (FR-6 × ST-026). Full onboarding is a
  subsequent `/bootstrap` run, which (ST-026) skips-if-bootstrapped and fills gaps without
  overwriting, and re-registers idempotently (FR-4/FR-8).

### Done When
- [ ] `create` produces git repo + skeleton CLAUDE.md + `.gitignore` (3 ignores) + optional remote
      + a `created` record (no stack detection — that's bootstrap's job).
- [ ] A later `/bootstrap` on a `created` project does not clobber it and re-registers idempotently
      (status provenance preserved or refined — decided at architecture).
- [ ] Test: real temp dir → assert scaffolded files exist + record present; `--remote` → remote
      set, no push.

---

## Story: Create refuses to clobber an existing directory

**Requirement:** FR-7
As the operator, I want `create` to never overwrite existing work, so I can't lose files to a typo.

### Acceptance Criteria
#### Happy Path (of the failure mode)
- Given the target directory **exists and is non-empty**, when I run `create <name>`, then it exits
  non-zero with a clear error and writes **nothing** — no scaffold, no `git init`, no registry
  entry.

#### Negative Paths
- Given the target exists but is **empty**, when create runs, then it MAY proceed (empty dir is not
  clobbering) — decide at architecture; whichever, it is consistent and tested.
- Given create fails partway (e.g. git init fails), when it errors, then it does **not** leave a
  registry record for the failed project (no orphan record).

### Done When
- [ ] Non-empty target → non-zero exit, nothing written, no registry record.
- [ ] Test: create into a non-empty dir → refused, dir untouched, registry unchanged.

---

## Story: Bootstrap auto-registers the onboarded project

**Requirement:** FR-8
As the operator running `/bootstrap`, I want my project auto-registered, so existing projects enter
the registry without a separate step.

### Acceptance Criteria
#### Happy Path
- Given `/bootstrap` runs on a project, when it completes onboarding, then the project is
  registered (same path as `register`) and appears in `registry.json`.

#### Negative Paths
- Given `/bootstrap` runs on an **already-registered** project, when it registers, then it updates
  (idempotent, FR-4) — no duplicate record.

### Done When
- [ ] `skills/bootstrap/SKILL.md` includes an auto-register step that invokes the registration path.
- [ ] Bootstrap re-run → still one record (idempotent). Validation suite passes with the SKILL change.

---

## Story: Registry writes are atomic, concurrency-safe, and errors are reported

**Requirement:** FR-9
As the operator, I want registry writes to never corrupt the file and to tell me when they fail, so
I never silently lose a project.

### Acceptance Criteria
#### Happy Path
- Given a write, when it occurs, then it is atomic (temp-file + rename) — a reader never sees a
  partial file.

#### Negative Paths
- Given N concurrent registrations, when all complete, then the registry is valid JSON containing
  all N records (no lost/torn writes).
- Given the registry dir is **unwritable**, when a register/create runs, then it **reports the
  error** (non-zero exit, clear message) — unlike the brain store, it does **not** silently swallow
  (registration is a deliberate action).

### Done When
- [ ] Atomic temp+rename; concurrent writes → valid JSON with all records; write failure → reported error (non-zero), not swallowed.
- [ ] Test: concurrent registrations + an injected write failure.

---

## Story: Types-only reader interface for the brain (9.3)

**Requirement:** FR-10
As the future brain, I want a typed read contract for the registry, so 9.3 can consume it without
reshaping 9.2's data.

### Acceptance Criteria
#### Happy Path
- Given the module, when imported, then it exports a types-only `RegistryReader`
  (`listProjects(): ProjectRecord[]`, `getProject(path): ProjectRecord | undefined`) and the
  `ProjectRecord` type.

#### Negative Paths
- Given 9.2 scope, when the interface is added, then it ships **no runtime consumer behavior** (no
  routing/planning) — only the contract.

### Done When
- [ ] `RegistryReader` + `ProjectRecord` exported (compile-time); no consumer logic.
- [ ] Test: a fixture set of records type-checks against the interface.

---

## Story: Registry stores no secrets

**Requirement:** FR-11
As the operator, I want the registry to never capture credentials, so a shared/inspectable registry
file is safe.

### Acceptance Criteria
#### Happy Path
- Given a project whose `remote` is a plain git URL, when registered, then `remote` is stored as-is
  (the URL), and nothing else about the remote is captured.

#### Negative Paths
- Given a remote URL that **embeds credentials** (e.g. `https://user:token@host/...`), when
  registered, then the credentials are **stripped/redacted** from the stored `remote` (or the
  record stores only host/path) — no token is written to disk.

### Done When
- [ ] Plain remote stored as-is; credential-bearing remote → stripped/redacted, no token on disk.
- [ ] Test: register a repo with a token-bearing origin → stored `remote` contains no token.
