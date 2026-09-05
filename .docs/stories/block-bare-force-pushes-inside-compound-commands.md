# Stories: Block bare force pushes inside compound commands

Source: jstoup111/ai-conductor#2159

## Story 1: A lease flag cannot authorize another force push

**Requirement:** Issue outcome 1.

As an operator using the existing Bash feedback hook, I want unsafe force pushes denied independently of nearby lease flags so that combining commands does not bypass the guard.

### Acceptance Criteria

#### Happy Path
- H1: Given a hook command payload containing `git push --force-with-lease origin a && git push --force origin main`, when the hook examines it, then it exits 2 and emits its existing structured force-push denial.
- H2: Given a direct unquoted git push with a standalone `--force` or `-f` token, when the hook examines it, then it denies that push whether the lease flag is earlier/later in the same invocation or in a neighboring command. This applies across `&&`, `||`, `;`, `|`, `&`, and newline separators.

#### Negative Paths
- N1: Given the denied command, when the hook returns its decision, then it has not executed any Git push or any other command contained in the payload. The payload remains data.

### Done When
- [ ] Direct execution of the real hook with the reported JSON reproduction exits 2 and stderr parses to `hookSpecificOutput.permissionDecision = deny` with the existing force-push reason.
- [ ] The bounded separator/order/flag test matrix receives the same denial, and no payload command is executed.

## Story 2: Safe command text does not become a false force push

**Requirement:** Issue outcome 2 and preservation of existing scanner behavior.

As an operator, I want legitimate lease pushes and harmless text to pass so that the corrected check does not turn the safe escape path into another false block.

### Acceptance Criteria

#### Happy Path
- H1: Given a single direct `git push --force-with-lease origin a`, its explicit `--force-with-lease=refs/heads/a:<sha>` form, or a plain push, when the hook examines it, then it exits 0 without a force-push denial.
- H2: Given a lease-only push followed or preceded by a non-push command carrying an unquoted `--force` token, when separated by the bounded operators in Story 1, then the hook does not borrow that token to classify the safe push as destructive.

#### Negative Paths
- N1: Given quoted commit/echo text containing `git push --force`, when the hook examines it, then the existing quoted-span exemption is preserved. An option name containing `--force` as a prefix, such as `--force-with-lease`, does not count as the standalone `--force` token.
- N2: Given a safe lease push combined with `git reset --hard`, when the hook examines it, then the independent reset clause still blocks it. An ordinary rebase still receives its existing non-blocking reminder, and `git rebase --continue` still passes silently.

### Done When
- [ ] The real hook returns exit 0 without force-push denial for plain/single-lease/explicit-lease and quoted-text fixtures.
- [ ] A neighboring non-push command's `--force` is ignored for the safe push, while the compound reset fixture still exits 2 with its reset diagnostic.
- [ ] Rebase reminder and continuation fixtures retain their existing exit code and diagnostic behavior.

## Coverage and negative-category review

Task 1 owns Story 1 H1/H2/N1 and Story 2 H1/N1 using a focused hook subprocess test; Task 2 owns Story 2 H2/N2 using that same public stdin/exit/stderr boundary. Tests pass JSON data to `bash <hook-path>`, never evaluate the command payload, and fake any Git/GitHub process boundary with fail-on-call stubs. This is the lowest sufficient layer; no conductor run or extra acceptance/system suite is needed.

All criteria are diff-local. The scanner's previously documented quote removal and lack of shell expansion remain the boundary: no new claims about aliases, computed commands, quoted wrappers, substitutions, or arbitrary shell grammar. Invalid-input behavior is unchanged; quoted-data false positives and force authorization bypass are covered above. No new network, timeout, concurrency, storage, resource-exhaustion, deletion, exception hierarchy, or partial-write behavior is introduced.

**Status:** Accepted
