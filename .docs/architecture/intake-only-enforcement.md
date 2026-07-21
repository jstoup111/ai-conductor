# Architecture: Intake-only criteria enforcement

**Issue:** #695 · **Stem:** `intake-only-enforcement` · **Tier:** M (lightweight diagram)

## One-line

Priority + size + linking are stamped at the moment an issue is **filed** (born
complete), across every capture surface. Nothing downstream re-checks them, so
there is no place a missing label can fail.

## Capture surfaces (where "born complete" is enforced)

```mermaid
flowchart LR
  subgraph INTAKE["INTAKE — capture / file time (born complete)"]
    A["A. Web/mobile form<br/>intake.yml<br/>(Priority*, Size*, Depends-on)"]
    LS["intake-label-sync.yml<br/>apply priority:/size: labels<br/>create-if-absent, default on unparsable,<br/>record blocked_by — labels only,<br/>isolated from ci.yml, cannot fail a build"]
    B["B. Agent / operator<br/>gh issue create via /intake skill<br/>bin/intake-file: require size+priority<br/>(prompt ▸ infer ▸ default),<br/>labels + links atomic at file time"]
    C["C. Backfill (one-shot)<br/>bin/intake-backfill: stamp ~100 legacy issues<br/>(infer ▸ default), report only — NO HALT"]
    A -->|"issues.opened / edited"| LS
  end
  BORN(["issue leaves intake WITH<br/>priority + size + links"])
  LS --> BORN
  B --> BORN
  C --> BORN
  subgraph DOWN["DOWNSTREAM — unchanged"]
    P["poll() capture — github-issues.ts<br/>enqueue Envelope · NO needs-triage flag ·<br/>NO withheld enqueue"]
    CL["claimUnblocked() — dependency-claim.ts<br/>ClaimOutcome union: claim | empty | all-blocked (SAME)<br/>NO needs-criteria · NO criteria deferral"]
    D["daemon build / dispatch /<br/>pipeline gates / ci.yml<br/>zero new checks"]
    P --> CL --> D
  end
  BORN --> P
```

`*` required (form) or required-then-defaulted (filing helper). "Default" = a
deterministic fallback (`size: M`, `priority: medium`) applied when the field is
absent or unparsable — never an error.

## Invariants

1. **Born-complete:** an issue that has passed any capture surface (A/B/C) carries
   a `priority:` label, a `size: S|M|L` label, and an explicit dependency-linking
   decision (a `blocked_by` set, possibly empty-by-acknowledgement).
2. **No downstream re-check:** `claimUnblocked` and its `ClaimOutcome` union stay
   byte-identical to `main`; `poll()` gains no blocking flag; the daemon/pipeline/CI
   add zero criteria checks. There is no `needs-criteria` outcome, no HALT, no
   dispatch/build/CI rejection tied to priority/size/links.
3. **Fail-soft, never fail-closed:** every stamping surface, on any error, either
   applies the sensible default or logs-and-continues. It never blocks filing,
   capture, dispatch, or a build.

## Data flow of a single label

`form field / helper arg / backfill inference` → normalize to closed vocab
(`parseSizeLabel` / `parsePriorityLabels`) → REST label apply (`restAddLabelArgs`
idiom) → issue is born complete. Read-back on capture is informational only; it
never gates.
