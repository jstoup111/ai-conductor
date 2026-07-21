# Complexity: Reject an `undefined` base path in the authored-keys write

Tier: S

## Root cause (verified, file:line)

The primary checkout accumulated an untracked `undefined/authored-keys.json` whose
content is the authored-keys test fixtures (`{project:"alpha",feature:"a1"|"a2"|
"only"}`). Two composed defects produce it.

### Defect A — the write site does not validate its base directory

`recordAuthoredKey` resolves the engineer dir and joins the ledger file name with
NO validation of the result:

- `src/conductor/src/engine/engineer/authored-ledger.ts:89-91`
  ```
  const dir = opts.engineerDir ?? resolveEngineerDir({ home: opts.home, env: opts.env });
  const path = join(dir, LEDGER_FILE);
  await mkdir(dir, { recursive: true });
  ```
- `ledgerPath` (read side) has the same shape at
  `src/conductor/src/engine/engineer/authored-ledger.ts:55-58`.

`resolveEngineerDir` (`src/conductor/src/engine/engineer-store.ts:181-189`) reads
`$AI_CONDUCTOR_ENGINEER_DIR` and returns it verbatim whenever it is a non-empty
string:
```
const override = env.AI_CONDUCTOR_ENGINEER_DIR;
if (override && override.trim() !== '') return override;   // line 186
```
It cannot return a real JS `undefined` (it falls back to `homedir()`), so
`path.join` never throws a TypeError. But it happily returns the STRING
`"undefined"` when the env var holds that literal string. `join("undefined",
"authored-keys.json")` = `"undefined/authored-keys.json"`, and because it is a
RELATIVE path, `mkdir`/`writeFile` root it at `process.cwd()` — the primary
checkout. The write site never asserts the base is absolute or non-sentinel, so
the misdirected write is silent.

### Defect B — a test coerces an unset env var into the string `"undefined"`

`src/conductor/test/acceptance/engineer.test.ts` saves and restores the env var
around each test:
- `:81` `savedEnv.AI_CONDUCTOR_ENGINEER_DIR = process.env.AI_CONDUCTOR_ENGINEER_DIR;`
- `:83` `process.env.AI_CONDUCTOR_ENGINEER_DIR = engineerDir;` (temp — correct)
- `:88` `process.env.AI_CONDUCTOR_ENGINEER_DIR = savedEnv.AI_CONDUCTOR_ENGINEER_DIR;`  ← DEFECT

When `$AI_CONDUCTOR_ENGINEER_DIR` is UNSET in the ambient environment (the normal
case for a dev/CI run), `savedEnv.AI_CONDUCTOR_ENGINEER_DIR` is `undefined`.
Assigning `undefined` to a `process.env` property does NOT unset it — Node
coerces the value to the STRING `"undefined"`. After this `afterEach`,
`process.env.AI_CONDUCTOR_ENGINEER_DIR === "undefined"` leaks into the rest of the
worker process.

The canonical correct pattern already exists in the suite at
`src/conductor/test/engine/engineer-store.test.ts:85-87`:
```
if (savedEnv === undefined) delete process.env.AI_CONDUCTOR_ENGINEER_DIR;
else process.env.AI_CONDUCTOR_ENGINEER_DIR = savedEnv;
```

### How A + B combine into the observed litter

The flywheel acceptance tests call `createAuthoredLedger()` with NO opts and then
`.record('alpha','a1' | 'a2' | 'only')`
(`src/conductor/test/acceptance/engineer.test.ts:596-597, 611`). `createAuthoredLedger`
forwards its (undefined) opts straight to `recordAuthoredKey`
(`src/conductor/src/engine/engineer/flywheel-trend.ts:135-139`), which resolves
the dir from `process.env` AT CALL TIME. Whenever that env is the poisoned string
`"undefined"` (Defect B) and the write site does not reject it (Defect A), the
`alpha/*` keys are written to `undefined/authored-keys.json` under the primary
checkout — exactly the leaked artifact. Once present, the daemon's `fastForwardRoot`
heal flags it as an unexplained untracked entry and stalls fast-forward.

## Why Tier S

- Defect A fix: a single small guard helper reused by `recordAuthoredKey` and
  `ledgerPath` in ONE file (`authored-ledger.ts`). It follows two existing
  precedents verbatim — the stringified-sentinel guard at
  `src/conductor/src/engine/owner-gate/identity.ts:81`
  (`login === 'null' || login === 'undefined'`) and the absolute-path guard at
  `src/conductor/src/engine/engineer/authoring-guard.ts:82`
  (`!writePath || !isAbsolute(writePath)`). No new subsystem, no decision.
- Defect B fix: swap one unconditional assignment for the conditional-delete
  pattern that ALREADY exists in the same test suite — a mechanical, low-risk edit.
- Test surface is local: `test/engine/engineer/authored-ledger.test.ts` (guard
  unit tests) and `test/acceptance/engineer.test.ts` (restore fix + a poison-then-
  reject regression). Tests live under `src/conductor/test/...` per #538.
- ~10 lines of production change + focused tests. No CLI/hook/schema/ADR surface.

## Scope guard (STOP conditions — none triggered)

- NOT changing `resolveEngineerDir`'s contract or the default
  `~/.ai-conductor/engineer` location (negative-path story keeps it intact).
- NOT sweeping every env save/restore anti-pattern across the ~10 other test
  files that share it — the Defect-A guard makes ALL of them fail-closed loudly
  rather than leak silently, so a corpus-wide test refactor is out of scope. The
  one file that actually produced the observed leak is fixed here; the rest are a
  hygiene follow-up, not required by #574's outcomes.
- NO architectural change, no shared state-store seam rework (#564). If review
  finds the guard needs to move into a shared root-resolution seam rather than the
  ledger, that is a larger decision — escalate rather than expand here.
