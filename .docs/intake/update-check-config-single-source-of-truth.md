# Intake origin: update-check-config-single-source-of-truth

Source-Ref: jstoup111/ai-conductor#1400
Owner: jstoup111

## Desired outcome

- One source of truth for update-check state. Editing the documented location changes real behavior; there is no second file that silently wins.
- Existing installs migrate without losing `currentVersion`/`lastCheckedAt` — an operator who never touches either file keeps their correct installed-version identity, since `bin/update:133-138` treats a wrong `currentVersion` as unverifiable and stops checking.
- Key naming agrees between writer and schema (`current_version` vs `currentVersion`).
- The stale/duplicate block cannot silently reappear — a check fails if the update flow reads or writes a config surface the schema does not own.
- Divergent pre-existing values (here `update_channel: tagged` vs `updateChannel: main`) resolve by an explicit documented rule, not by whichever file is read first.
