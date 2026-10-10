# Track: ATX-numbered ADR decision headings are citable

Track: technical

Scope boundary: Balanced (pre-authorized by the operator for this composer run). `parseAdrDecisions` accepts an ATX heading whose decision number carries no `D` prefix (`### 4. Title`, `### **4. Title**`) as a citable decision start, additively, so every id it returns today it still returns. The as-built projection's per-decision text lookup recognizes the same heading form so a cited ATX-numbered decision projects its own heading body. The corpus guard that holds APPROVED ADRs citable is widened to see ATX-numbered headings. Excluded: renaming or migrating any existing ADR's headings; changing `templates/adr.md.template`; making an ATX heading's passage swallow the numbered list items nested under it (nested items keep splitting passages exactly as they do under every other accepted shape today); moving the projection's decision-text lookup onto the shared parser.

Internal engine parser fix with no product requirements: approved ADR adr-2026-09-02-adr-decision-citability-contract decision 2 already names ATX `###`-heading decisions as an accepted shape, and the parser missed the un-prefixed numbered form (intake jstoup111/ai-conductor#2390).
