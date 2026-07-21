# Hanja Conversion Safety Implementation Plan

> For agentic workers: execute continuously in this feature branch, use test-driven development, do not commit, and keep `third_party/rhwp` read-only.

**Goal:** Make F9 Hanja conversion atomic, formatting-safe, lifecycle-safe, keyboard-accessible, and guarded by a validated offline dictionary boundary.

**Architecture:** Keep HOP behavior in the Studio overlay. A HOP edit command owns replacement and character-shape restoration through reversible text/style transitions without consuming the shared WASM snapshot store. A shared primary-document bridge owns generation changes. Guarded capture-phase F9 routing and a modal focus contract protect editor state. Runtime parsers validate and bound bundled data before caching.

**Tech Stack:** TypeScript, Vitest, Tauri 2 bridge APIs, pinned rhwp WASM bridge, Node.js 24 scripts, pnpm.

---

### Task 1: Lock the replacement transaction contract

**Files:**
- Create: `apps/studio-host/src/hanja/hanja-replace-command.ts`
- Create: `apps/studio-host/src/hanja/hanja-replace-command.test.ts`
- Modify: `apps/studio-host/src/hanja/editor-text-range.ts`
- Modify: `apps/studio-host/src/hanja/editor-text-range.test.ts`
- Modify: `docs/architecture/HANJA_DATABASE.md`

- [x] Add failing tests for mixed body/cell character styles across execute/undo/redo.
- [x] Add failure-injection tests proving insertion/style failures restore the complete pre-operation state.
- [x] Add a failing test that nested table cells are rejected before lookup.
- [x] Implement the smallest command using reversible text/style transitions and explicit style runs without shared snapshots.
- [x] Clear selection only after successful command routing.
- [x] Run the focused replacement/range tests with the bundled WASM, including a full 100-snapshot preservation probe.

### Task 2: Move generation to the document mutation boundary

**Files:**
- Create: `apps/studio-host/src/core/document-wasm-bridge.ts`
- Create: `apps/studio-host/src/core/document-wasm-bridge.test.ts`
- Modify: `apps/studio-host/src/core/tauri-bridge.ts`
- Modify: `apps/studio-host/src/core/tauri-bridge.test.ts`
- Modify: `apps/studio-host/src/main.ts`

- [x] Add failing shared load/create stale-source tests.
- [x] Add deferred Tauri open/create tests proving generation advances before follow-up awaits.
- [x] Implement one shared primary-document bridge and remove the late UI generation bump.
- [x] Run focused core bridge and Tauri bridge tests.

### Task 3: Protect F9 and modal keyboard/focus behavior

**Files:**
- Modify: `apps/studio-host/src/command/shortcut-map.ts`
- Modify/Create: focused shortcut tests under `apps/studio-host/src/command/`
- Modify: `apps/studio-host/src/main.ts`
- Modify: `apps/studio-host/src/command/commands/hanja.ts`
- Modify: `apps/studio-host/src/command/commands/hanja.test.ts`
- Modify: `apps/studio-host/src/ui/hanja-conversion-elements.ts`
- Modify: `apps/studio-host/src/ui/hanja-conversion-dialog.ts`
- Modify: `apps/studio-host/src/ui/hanja-conversion-dialog.test.ts`

- [x] Add failing tests for guarded capture-phase unmodified F9, modifier bypass, modal, IME, target, and placement-mode ownership.
- [x] Add failing tests for Enter on close/cancel, listbox-only candidate tab stops, focus trapping, and click focus retention.
- [x] Install the capture handler and remove duplicate late F9 mapping.
- [x] Gate dialog replacement on a still-editable context and delete unreachable direct-execute feedback logic.
- [x] Implement the smallest modal key/focus changes and run focused tests.

### Task 4: Validate dictionary assets and byte integrity

**Files:**
- Create: `apps/studio-host/src/hanja/hanja-dictionary-validation.ts`
- Modify: `apps/studio-host/src/hanja/hanja-dictionary.ts`
- Modify: `apps/studio-host/src/hanja/hanja-dictionary.test.ts`
- Modify/Create: repository attribute test under `tests/`
- Modify: `.gitattributes`
- Modify: `package.json`

- [x] Add failing tests for reordered routing, malformed core records, unsafe or oversized assets, retry, and missing LF attributes.
- [x] Parse and bound `unknown` assets into validated typed structures before caching.
- [x] Add `text eol=lf` to both generated JSON paths.
- [x] Gate dictionary generation and Studio builds with `dictionary:verify`.
- [x] Run focused dictionary and repository tests.

### Task 5: Integrate, inspect, and manually verify

**Files:** all task files above; no upstream edits.

- [x] Run focused tests, full Studio tests, repository tests, dictionary verification, typecheck/build, and `git diff --check`.
- [x] Inspect changed TypeScript diagnostics and confirm generated assets were not rewritten.
- [x] Run the Studio with actual WASM and manually exercise F9 word/character conversion, cancel/apply, undo/redo, stale-document protection, and modal keyboard focus.
- [x] Run independent spec, code-quality, review-work, debugging, and visual-QA passes; resolve every actionable finding.
- [x] Remove `.debug-journal.md` and its local exclude entry, then report changed files, simplifications, residual risks, and exact evidence.
