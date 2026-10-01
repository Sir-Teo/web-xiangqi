# Audit fixes — 2026-09-29

All 45 findings from the review have implementation commits, with a separate commit per item. Each entry records its implementation and validation.

1. [x] Bound complete share links
2. [x] Enforce study limits for every move path
3. [x] Keep last good autosave on capacity failures
4. [x] Keep separate recovery drafts across tabs
5. [x] Undo discarding note-only studies
6. [x] Make recovery Escape non-destructive
7. [x] Checkpoint studies before replacement
8. [x] Preserve failed recovery data
9. [x] Cancel stale direct imports
10. [x] Validate FEN counters
11. [x] Preserve reviewed-game cursor
12. [x] Preserve recovered library identity
13. [x] Validate cloud numeric fields
14. [x] Timeout stalled library workers
15. [x] Ignore repeated action shortcuts
16. [x] Serialize concurrent library mutations
17. [x] Isolate engine telemetry rendering
18. [x] Narrow tree-derived invalidation
19. [x] Avoid whole-library mutation/reload costs
20. [x] Skip duplicate autosave work
21. [x] Move direct imports to a worker
22. [x] Prepare library search off the typing path
23. [x] Defer engine download until requested
24. [x] Improve device resource classification
25. [x] Bound AI thinking time at every level
26. [x] Reduce initial bundle
27. [x] Avoid duplicated practice paths
28. [x] Defer hidden cloud requests
29. [x] Clarify initial task choices
30. [x] Use a gentler first AI difficulty
31. [x] Keep board context in phone analysis
32. [x] Offer notation-aware board coordinates
33. [x] Distinguish advantage from win probability
34. [x] Group advanced engine controls
35. [x] Offer comfortable UI density
36. [x] Show persistent save/modified state
37. [x] Track study modification dates
38. [x] Add editor Undo/Redo
39. [x] Apply pending editor FEN on Done
40. [x] Respect notation during practice
41. [x] Persist practice progress
42. [x] Provide guided library salvage
43. [x] Resolve backup conflicts per game
44. [x] Detect collection duplicates
45. [x] Run cross-browser checks in CI

## 1. Bound complete share links

Short links retain the legacy query format. Long payloads use a versioned URL fragment, keeping study data out of the HTTP request. The complete encoded URL has a 24,000-character ceiling; oversized links explain the PGN fallback. Both loading and recovery recognize fragment links. Regression tests cover the previously failing 240-ply annotated Unicode study and old links.

Validation: share URL/tree tests (31 passing), TypeScript, and ESLint.

## 2. Enforce study limits for every move path

Normal moves and appended engine lines now share the 1,024-ply / 8,192-node limits. Appending an oversized line fails atomically, while following existing moves still works at capacity. The board shows a dismissible explanation and recovery direction.

Validation: append-line regression tests (8 passing), TypeScript, ESLint, and full-study browser recovery at 1440, 390, and 320px.

## 3. Keep last good autosave on capacity failures

Capacity, validation, and storage failures leave the previous recoverable snapshot intact. The warning explicitly distinguishes that snapshot from the latest unsaved edits.

Validation: autosave tests (18 passing), including byte, line, tree, and invalid-data failures; TypeScript.

## 4. Keep separate recovery drafts across tabs

Each document writes an independently owned recovery slot. Legacy recovery remains readable; a compatibility mirror is never the authoritative copy. Recovery offers a draft selector and a way to reopen remaining drafts. Clearing an empty tab or discarding one draft preserves all others.

Validation: independent-tab ownership and legacy/mirror tests (20 autosave tests passing), TypeScript, ESLint, capacity recovery at three widths, and storage failure/download/retry in desktop and phone browsers.

## 5. Undo discarding note-only studies

Discard Undo uses the same meaningful-content predicate as autosave, so notes, variations, metadata, custom positions, and recorded results qualify without a played move.

Validation: browser recovery of note-only, variation-only, metadata-only, and result-only drafts; TypeScript.

## 6. Make recovery Escape non-destructive

Escape and Decide later close recovery without deleting its draft. A visible recovery button reopens the decision. Its placement clears the board controls on desktop and phones.

Validation: browser Escape/reopen/discard/undo, recovery text scaling and focus at four viewport sizes, 15 component tests, TypeScript, and ESLint.

## 7. Checkpoint studies before replacement

New games, direct imports, saved/historical game loads, editor positions, and play/practice from here archive a recovery checkpoint before replacement. Checkpoints include pending note text, remain accessible through recovery, and avoid repeating an unchanged checkpoint. If persistence fails, replacement stops and explains how to export the current study.

Validation: browser reset/checkpoint/restore and quota-failure refusal, TypeScript, and ESLint.

## 8. Preserve failed recovery data

A failed Restore keeps the dialog and original data, with a download action. Unreadable or unsupported recovery records show a download notice and are preserved byte-for-byte when a new study saves.

Validation: malformed/unsupported data retention tests, browser downloads of malformed and illegal-move records, component tests, TypeScript, and ESLint.

## 9. Cancel stale direct imports

Direct file reads carry a generation token. New file selections, typed input, closing/reopening the dialog, mode changes, board replacement, and unmount invalidate old results and errors.

Validation: delayed-file browser regression with out-of-order success, late failure after close, and typing during a read; TypeScript and ESLint.

## 10. Validate FEN counters

Explicit FEN clocks must be decimal whole numbers in a supported range (halfmove 0–1,000,000; fullmove 1–1,000,000). Invalid clocks are explained rather than silently rounded or reset. Omitted clocks still default to 0/1.

Validation: 32 position/FEN tests, including negative, fractional, non-finite, exponent, hex, and overflow inputs; TypeScript and ESLint.

## 11. Preserve reviewed-game cursor

Saved studies now record the selected ply independently from the full line needed for review annotations. Recovery and ordinary library loading restore that position; explicit explorer navigation still wins. Old records default to their original behavior.

Validation: 54 autosave/library tests plus browser save/reload/recovery at the root and mid-line with a complete review; TypeScript and ESLint.

## 12. Preserve recovered library identity

Recovery envelopes retain the original library ID and a compact content revision. An unchanged entry reconnects to Update saved study, including after a rename. Changed or deleted source entries recover as a separate study with an explanation; normal update conflict checks remain in place.

Validation: source/rename/conflict and envelope tests, browser save/edit/reload/recover/update of the same library ID, TypeScript, and ESLint.

## 13. Validate cloud numeric fields

Malformed scores and ranks no longer become plausible zero evaluations. Invalid percentages become unavailable, and PV numeric fields must match completely and remain safe integers. Valid entries can still be used when another entry is rejected.

Validation: 35 cloud-book/PV tests, TypeScript, and ESLint.

## 14. Timeout stalled library workers

Each index/lookup request has a 30-second deadline. A stalled worker terminates and exposes Retry; completion, replacement, and unmount clean up timers, and late replies cannot publish. Hidden stalled requests remain recoverable when the explorer reopens.

Validation: controlled worker browser checks at 1440, 390, and 320px, including timeout/retry/late replies; TypeScript and ESLint.

Follow-up to 9: the dialog visibility itself now invalidates reads, covering Escape and every dismissal path before a late result can run. The delayed-error browser check also checks the closed state before reopening.

## 15. Ignore repeated action shortcuts

Held F/D/X/H/Space/E/T/R keys no longer toggle or replay actions repeatedly, and holding the palette shortcut does not reopen/close it. Arrow-key move navigation still repeats.

Validation: browser key-down/repeat/up checks for board flip, command palette, and repeated navigation; TypeScript and ESLint.

## 16. Serialize concurrent library mutations

Every UI library mutation now runs under an origin-wide Web Lock, with an IndexedDB transaction fallback. Queued operations read the latest library only after acquiring the lock. Save/import submission guards prevent duplicate requests; late save completion cannot attach an old study to a newly opened board.

Validation: simultaneous two-tab saves under both coordination mechanisms, recovery/update, rename/delete focus at three widths, backup restore, PGN collection import, all 2,092 unit tests, TypeScript, and ESLint.

## 17. Isolate engine telemetry rendering

Search counters and raw logs now update subscribed leaf components rather than App state. Effort-only PV updates reuse the board reading, while explicit Keep Line captures the latest effort. Recommendations, score changes, bounds, and WDL changes still publish normally.

Validation: instrumented browser recorded zero App renders across four counter/log flushes; engine-line keep/replay/save/recovery on desktop and phone; 2,099 unit tests, TypeScript, and ESLint. Existing browser assertions now await asynchronous library persistence.

## 18. Narrow tree-derived invalidation

A separate immutable move-structure snapshot changes only when moves or main-line order change. Notes and stored evaluations no longer invalidate path signatures, opening lookups, branch counts, notation callbacks, or FEN clocks.

Validation: structural identity browser regression; main-line and halfmove-clock suites at 1440, 390, and 320px; focused unit tests, TypeScript, and ESLint. Save assertions await asynchronous persistence.

## 19. Avoid whole-library mutation/reload costs

Library reads reuse validated snapshots while storage is unchanged. Mutations serialize only changed records and publish the resulting state directly; unchanged records retain their search and explorer caches, including across external edits. The bounded JSON library remains one atomic storage write. Failed writes never publish cached success.

Validation: cache identity, external modification, corrupt data and quota regressions; 52 focused tests, two-tab saves under Web Locks and IndexedDB, TypeScript, and ESLint.

## 20. Skip duplicate autosave work

Unchanged flushes retain the original recovery timestamp and skip validation, byte encoding, and storage writes. The writer checks its actual owned slot before reusing success, so deleted or externally replaced drafts are repaired and failures remain retryable. Draft ownership is inserted without reparsing and reserializing the whole study.

Validation: 25 autosave/draft tests, recovery Undo browser cases, storage-failure/download/retry on desktop and phone, TypeScript, and ESLint.

## 21. Move direct imports to a worker

Direct PGN, notation, DhtmlXQ, and XQF reading and legality checks run in a dedicated worker. Cancel, dismissal, replacement, input edits and FEN changes terminate pending parsing; a 30-second deadline exposes a retryable error. Deep trees use flat worker messages. The board and worker share the same pure move validators.

Validation: cancellation/timeout/late-response browser test; delayed-file races; XQF metadata/results and 1,024-ply capacity/recovery at three widths; 53 parser/transfer tests, TypeScript, and ESLint.

## 22. Prepare library search off the typing path

Library search text is prepared in short queued tasks as the panel opens. Keystrokes filter prepared strings; an in-progress message avoids false empty results while preparation finishes. Record identity and locale changes still invalidate the appropriate entries.

Validation: controlled first-keystroke test proves zero text preparation during typing; 400-study cache benchmark at 4× CPU slowdown reports zero tree visits for warm queries; saved-analysis search at three widths and two text sizes; TypeScript and ESLint.

## 23. Defer engine download until requested

Opening the board, a shared study, or the library no longer starts Pikafish or preloads its loader. Explicit analysis controls, desktop and phone Engine tabs, the E shortcut, the Engine panel command, post-game review, and AI play activate it. Desktop, phone and command-palette entry points explain the first-use download.

Validation: zero loader/NNUE/WASM requests before activation at 1440, 390 and 320px; one loader request afterward; startup cancellation, telemetry isolation, and engine-line save/recovery/capacity workflows; TypeScript, ESLint and production build.

## 24. Improve device resource classification

CPU and reported memory determine resource tier. A touch laptop, tablet, or narrow desktop no longer becomes low-tier merely because of its input or dimensions. Small touch devices receive a separate two-thread / 64 MB default ceiling while explicit memory choices and single-thread fallback remain available.

Validation: 52 device-profile tests covering touch laptops/tablets, strong phones, missing readings, low memory, thread ladders and isolation fallback; TypeScript and ESLint.

## 25. Bound AI thinking time at every level

All six strengths send both depth and time ceilings: 250, 500, 900, 1,500, 2,500 and 4,000 ms. The strength description shows that budget, including subsecond values. Invalid depth inputs resolve to a finite supported ceiling.

Validation: all 2,104 unit tests; AI pause/late-reply refusal, annotations, persistence and resume at four desktop/phone/landscape sizes and 100/200% text; TypeScript and ESLint.

## 26. Reduce initial bundle

Graph rendering, candidate comparison and the command palette are separate lazy chunks with loading/error boundaries. Pending dialogs remain closable and restore focus. Main JavaScript decreased from 523.48 KB to 490.04 KB (151.34 KB gzip); optional panels are absent from initial phone requests.

Validation: production build, deferred-command cancellation/reopening, candidate comparison at three widths, hidden/visible graph updates at four widths, delayed/failed editor and lesson loading with focus restoration, TypeScript and ESLint.

## 27. Avoid duplicated practice paths

Practice keeps shared prefix nodes and a move trie instead of eagerly copying every root-to-leaf move/note path. Only the requested line is materialized, with a one-line cache. Answer matching follows the prefix trie and selects an eligible continuation without reading every full line. Duplicate-path and branch-specific note semantics are preserved.

Validation: 14 practice tests, including alternate matching without unrelated path reads and differing notes on duplicate prefixes; complete practice, focus and recall flows at four viewports and enlarged text; failed-chunk handling and AI pause isolation; TypeScript and ESLint.

## 28. Defer hidden cloud requests

Cloud book and PV requests follow visible graph cards and page visibility. Rule adjudication remains available on the board where it is displayed. Opening the panel resumes the current position without changing the stored preference.

Validation: hidden-panel and background-page request counts; cloud response cancellation, retry, UTF-8 and failed ruling tests at three widths; TypeScript and ESLint.

## 29. Clarify initial task choices

The first-use guide offers play, lessons, import and library entry points. It explains free board exploration, Coach/Pro guidance and explicit engine activation. Import opens and focuses the notation field directly.

Validation: all guide actions, focus, dismissal persistence, real AI reply and board sizing at desktop, phone, short-phone and landscape sizes; TypeScript and ESLint.

## 30. Use a gentler first AI difficulty

New and reset preferences use Easy instead of Master. Explicit saved strengths are preserved, and the guide still offers Beginner quick start.

Validation: fresh/default and saved-strength reload checks; AI pause, late replies, save and resume at four sizes with enlarged text; TypeScript.

## 31. Keep board context in phone analysis

All phone analysis tabs retain a compact current-position preview, turn and timeline label, with one return-to-board control. The preview follows piece style and orientation without adding another interactive square grid.

Validation: piece position, turn, return action and panel visibility at three phone/landscape sizes; screenshot inspection, TypeScript and ESLint.

## 32. Offer notation-aware board coordinates

Board edges follow the selected notation: absolute files/ranks for UCI, player-relative file numbers for WXF, and Red Chinese numerals for Chinese notation. Flipping keeps each side’s labels at its own edge. Accessible square names remain stable UCI coordinates.

Validation: notation mapping tests and all three styles in both orientations at desktop and two phone widths; TypeScript and ESLint.

## 33. Distinguish advantage from win probability

The evaluation bar announces a normalized advantage indicator out of 100 and explains that the centipawn transform is not a calibrated win probability. Review loss and practice feedback use advantage wording; engine-provided WDL remains separate.

Validation: 64 evaluation/review/graph tests, TypeScript and ESLint; browser expectations updated to the explicit indicator wording.

## 34. Group advanced engine controls

Restart and hash clearing live in an Engine maintenance disclosure. Search policy, depth and resources are grouped under Advanced engine settings with a device-defaults explanation. Primary analysis actions remain visible.

Validation: restart/disable during pending boot on desktop and phone; collapsed resources and expanded controls at three widths; TypeScript and ESLint.

## 35. Offer comfortable UI density

A persisted Comfortable density enlarges side-panel/settings controls and supporting text. Compact preserves the existing layout. The toolbar and board remain the same size.

Validation: 31 preference tests; actual font/target size, board dimensions, horizontal fit and reload persistence at three widths; TypeScript and ESLint.

## 36. Show persistent save/modified state

Desktop and phone controls show Unsaved, Modified, Saving or Saved study and directly save/update it. Comparison includes notes, variations, metadata and retained analysis while ignoring navigation and automatic readings. Pending note edits mark the study immediately.

Validation: content identity tests and browser save/navigation/pending-note/update checks at three widths; TypeScript and ESLint.

## 37. Track study modification dates

Study edits and renames set a separate modification date while retaining creation time. Recently modified sorting and Updated labels use it; older records fall back to creation time. Renames still preserve recovery/update identity.

Validation: 29 library/cache/source/backup/date tests and saved-study update/conflict/copy browser workflows at three widths; TypeScript and ESLint.

## 38. Add editor Undo/Redo

Position edits have a bounded 100-step history. Undo/Redo covers painting, clearing, start-position resets, side changes and atomic FEN loads. Ctrl/Cmd-Z, Shift-Z and Y work on board controls while text fields retain native editing shortcuts.

Validation: history branching/bounds tests plus editor keyboard, undo/redo, clear recovery, focus trap and layout at four sizes; TypeScript and ESLint.

## 39. Apply pending editor FEN on Done

Done validates the latest typed FEN and applies its placement, side and clocks without requiring Load first. Invalid drafts remain open with a specific error, and a valid draft can replace an invalid board preview.

Validation: pending valid/invalid FEN and clock preservation browser checks at desktop and two phone widths; TypeScript and ESLint.

## 40. Respect notation during practice

Practice receives the selected notation for board files, hints, saved replies and completed-line notes. Notes are formatted against each move’s original position so Chinese/WXF piece and file names remain correct.

Validation: hints/replies/notes in all three notations; complete practice flows at four sizes and enlarged text, failed-chunk recovery and AI pause isolation; TypeScript and ESLint.

## 41. Persist practice progress

Practice resumes the selected side, move prefix, completed lines and recall counts after closing or reloading. Each side is separate and can be reset explicitly. Stored prefixes are validated and replayed; edited studies start fresh, storage is bounded to 50 studies / 512 KB, and write failures are visible.

Validation: 16 practice/progress tests; reload/resume, separate sides, completion and reset at three widths; complete practice regression across four sizes and enlarged text; TypeScript and ESLint.

## 42. Provide guided library salvage

Blocked libraries offer a preview of readable studies, invalid/duplicate entries and conflicting IDs preserved as copies. Repair archives the exact original bytes before replacing data, refuses stale previews or archival failures, and exposes an archived-original download afterward. Structurally unreadable files retain the manual download route.

Validation: salvage/archive/quota/stale-preview tests and guided repair with exact original download at three widths; TypeScript and ESLint.

## 43. Resolve backup conflicts per game

Restore previews current and incoming versions and offers Keep current, Replace with backup or Import as a copy for each conflict. Counts and capacity follow the choices. Confirmation rechecks selected replacement/copy sources under the library lock and refuses changed or deleted versions.

Validation: 18 backup/conflict tests; mixed choices at three widths, complete backup/download/recovery browser flow; TypeScript and ESLint.

## 44. Detect collection duplicates

PGN imports compare normalized game content across existing records and within the incoming selection, independent of library IDs, dates and labels. Compact and tree representations match. The preview reports new/duplicate counts before capacity checks, and an explicit option retains duplicate copies. Changed notes or annotations remain distinct.

Validation: duplicate/capacity/copy/atomic-save unit tests; repeated collection import skips duplicates, optional copies exercise quota refusal, metadata and variation export remain intact at three widths; TypeScript and ESLint.

## Browser follow-up: preserve focus through dialog transitions

The original page control remains the focus destination when a command palette action opens another dialog. Removed palette inputs and the page body no longer replace that destination.

Validation: position-editor keyboard/focus coverage at four viewports in WebKit, repeated three times against the production build; Chromium dialog focus/inert checks; TypeScript and ESLint.

## 45. Run cross-browser checks in CI

Firefox and WebKit run a 16-workflow production smoke suite alongside the existing Chromium audit shards. The final verification gate requires both browser jobs before deployment, and failures retain screenshots. The Chromium manifest includes the new audit regressions. Coordinate fixtures seed preferences before mounting, and concurrent-save checks observe a foreground tab with timer polling.

Validation: all 16 core workflows exercised in Chromium, Firefox and WebKit; the WebKit editor focus failure was fixed and its four-viewport suite passed three consecutive production runs. Four shard/workflow coverage tests pass. The broader Chromium audit has been reconciled with asynchronous saving, recovery checkpoints and explicit engine activation.

## Browser follow-up: keep recovery controls out of board content

Recovery drafts now appear in the desktop action bar and phone action menu. The floating control could cover rule explanations on narrow screens with enlarged text.

Validation: recovery menu flows at 1440, 390 and 320 pixels; 60-move-rule notices at all three widths with 100% and 200% text; TypeScript and ESLint.

## Browser follow-up: checkpoint without native UUID support

Replacing a meaningful study now uses the existing ID fallback when `crypto.randomUUID` is unavailable. Previously, checkpoint creation threw and prevented opening a checked PGN on the board.

Validation: dense PGN recovery at three widths, including an unreadable library and unavailable native UUID at 320 pixels; all 1,000 analysis snapshots retained and library bytes unchanged.

## Browser follow-up: consistent drill evaluation language

Good-alternative drill feedback now says “Advantage change,” consistent with the other verdicts and the evaluation display.

Validation: the mistake-practice prompt, good alternative and grading workflow pass in the layout suite; TypeScript and ESLint.

## Browser follow-up: inset the analysis context control

The entire phone analysis context button now fits between the left and right safe-area insets. Its clickable bounds previously extended beneath landscape display cutouts even though its text was padded.

Validation: the comprehensive follow-up browser sweep passes, including landscape/portrait cutout emulation, board intersections and touch targets; TypeScript and ESLint.

## Final browser regression reconciliation

Engine-dependent fixtures explicitly request analysis. Save/import fixtures wait for persistence or completed imports, recovery fixtures preserve meaningful replacement checkpoints, and library focus/sort expectations follow modification dates. Render probes distinguish new work from flags retained on an unchanged React fiber. The production smoke excludes requests cancelled by the expected service-worker reload only when they belong to an earlier document; final-document asset failures still fail the check. Layout runs collect all failures before returning a nonzero exit code.

Validation: all 127 Chromium audit scripts and 177 layout checks exercised. Initial failures were corrected and their targeted reruns pass. Real engine production smoke passes for isolated hosting, static hosting and returning visitors with the legacy service worker. Engine telemetry updates produce zero unchanged-board renders, and navigation in a 1,024-ply study renders only three affected move entries.
