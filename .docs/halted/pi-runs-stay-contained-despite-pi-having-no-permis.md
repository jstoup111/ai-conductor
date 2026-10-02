# Halt record

Status: halted
Slug: pi-runs-stay-contained-despite-pi-having-no-permis
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-pi-runs-stay-contained-despite-pi-having-no-permis
Head SHA: 26d2799a8555c4e957da145b8a618828ca372384
Halted at: 2026-10-02T03:33:38.088Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: needs human DECIDE — AB-1 (architectural-clarity: The as-built gate (99% verified) flags PiProvider's readOnlyReview branch and git_read as having no production caller, because the only readOnlyReview:true producers are custom-policy paths that refuse pi on reviewPolicyCatalog. That dormancy is the approved design: ADR D17 says 'Pi serves custom-policy laps only after #1888 turns it on', the track doc defers admission to #1888, and plan Task 10/story S1.7 require the refusal. The gate's resolution ('wire Pi read-only review through an approved production review path') has no approved path to wire, and adding one would contradict D17 and Task 10. A human must decide whether to accept a dormant-until-#1888 primitive for reachability or change the architecture; no code task can close it (confidence 85%).)
```
