# Audit fixes — 2026-09-29

The 45 findings from the review are being addressed in order, with a separate commit per item. Each entry records its implementation and validation.

1. [x] Bound complete share links
2. [x] Enforce study limits for every move path
3. [x] Keep last good autosave on capacity failures
4. [ ] Keep separate recovery drafts across tabs
5. [ ] Undo discarding note-only studies
6. [ ] Make recovery Escape non-destructive
7. [ ] Checkpoint studies before replacement
8. [ ] Preserve failed recovery data
9. [ ] Cancel stale direct imports
10. [ ] Validate FEN counters
11. [ ] Preserve reviewed-game cursor
12. [ ] Preserve recovered library identity
13. [ ] Validate cloud numeric fields
14. [ ] Timeout stalled library workers
15. [ ] Ignore repeated action shortcuts
16. [ ] Serialize concurrent library mutations
17. [ ] Isolate engine telemetry rendering
18. [ ] Narrow tree-derived invalidation
19. [ ] Avoid whole-library mutation/reload costs
20. [ ] Skip duplicate autosave work
21. [ ] Move direct imports to a worker
22. [ ] Prepare library search off the typing path
23. [ ] Defer engine download until requested
24. [ ] Improve device resource classification
25. [ ] Bound AI thinking time at every level
26. [ ] Reduce initial bundle
27. [ ] Avoid duplicated practice paths
28. [ ] Defer hidden cloud requests
29. [ ] Clarify initial task choices
30. [ ] Use a gentler first AI difficulty
31. [ ] Keep board context in phone analysis
32. [ ] Offer notation-aware board coordinates
33. [ ] Distinguish advantage from win probability
34. [ ] Group advanced engine controls
35. [ ] Offer comfortable UI density
36. [ ] Show persistent save/modified state
37. [ ] Track study modification dates
38. [ ] Add editor Undo/Redo
39. [ ] Apply pending editor FEN on Done
40. [ ] Respect notation during practice
41. [ ] Persist practice progress
42. [ ] Provide guided library salvage
43. [ ] Resolve backup conflicts per game
44. [ ] Detect collection duplicates
45. [ ] Run cross-browser checks in CI

## 1. Bound complete share links

Short links retain the legacy query format. Long payloads use a versioned URL fragment, keeping study data out of the HTTP request. The complete encoded URL has a 24,000-character ceiling; oversized links explain the PGN fallback. Both loading and recovery recognize fragment links. Regression tests cover the previously failing 240-ply annotated Unicode study and old links.

Validation: share URL/tree tests (31 passing), TypeScript, and ESLint.

## 2. Enforce study limits for every move path

Normal moves and appended engine lines now share the 1,024-ply / 8,192-node limits. Appending an oversized line fails atomically, while following existing moves still works at capacity. The board shows a dismissible explanation and recovery direction.

Validation: append-line regression tests (8 passing), TypeScript, ESLint, and full-study browser recovery at 1440, 390, and 320px.

## 3. Keep last good autosave on capacity failures

Capacity, validation, and storage failures leave the previous recoverable snapshot intact. The warning explicitly distinguishes that snapshot from the latest unsaved edits.

Validation: autosave tests (18 passing), including byte, line, tree, and invalid-data failures; TypeScript.
