# HOP Design Contract

## Source of truth

This file is the active product and interaction design contract for HOP. It was refreshed on 2026-07-21 from the current Studio host, upstream design tokens, dialog implementations, and desktop document workflows. New UI work should extend these rules unless a later design decision explicitly replaces them.

## Product context

HOP is a cross-platform desktop editor for HWP and HWPX documents. The document is the primary object; application chrome and transient tools should remain quiet, compact, and predictable. HOP extends the pinned `rhwp-studio` UI without changing the read-only upstream submodule.

Observed implementation evidence:

- `third_party/rhwp/rhwp-studio/src/styles/base.css` defines semantic light/dark tokens, compact desktop type sizes, spacing, radii, and focus colors.
- `third_party/rhwp/rhwp-studio/src/styles/dialogs.css` defines the shared modal structure and buttons.
- `apps/studio-host/src/ui/recent-documents-dialog.ts` establishes HOP's listbox, arrow-key, Enter, Escape, and focus behavior.
- `apps/studio-host/src/style.css` composes upstream styles with HOP-owned contributions.

## Brand and experience goals

HOP should feel document-first, dependable, and desktop-native rather than decorative. The interface uses restrained blue emphasis, neutral surfaces, compact information density, and explicit labels. Users should be able to complete frequent editing actions from the keyboard without losing their place in the document.

The experience should:

- keep the document visible as the dominant surface;
- make reversible edits and their consequences clear;
- behave consistently on macOS, Windows, and Linux;
- expose rich linguistic or document information without visual ornament;
- remain fully usable in light and dark themes.

## Users and core tasks

Primary users are Korean-language document authors and reviewers who open existing HWP/HWPX files, make precise edits, save or export them, and expect familiar word-processor shortcuts.

Core tasks include opening and saving documents, editing and formatting text, working with tables and embedded objects, finding content, printing/exporting, and converting Korean readings to appropriate Hanja while preserving document structure and undo history.

## Information architecture

The main window is organized as:

1. menu bar and document commands;
2. compact toolbars and formatting controls;
3. central document canvas;
4. status bar for brief feedback;
5. modal dialogs for bounded decisions that require attention.

The Hanja conversion flow belongs to the Edit command family. It opens a single modal over the current document and returns focus to the editor when conversion is applied or cancelled.

## Design principles

1. Document before chrome: transient UI must not compete with the page.
2. Keyboard parity: every modal action available by pointer must have a clear keyboard path.
3. Progressive detail: show the candidate first, then pronunciation, meaning, source definition, or metadata.
4. Safe editing: asynchronous choices must not apply to a changed selection, and one conversion must be one undo unit.
5. Existing patterns first: reuse semantic tokens, modal anatomy, listbox states, and status feedback.
6. Cross-platform restraint: avoid OS-specific layouts, fonts, pointer assumptions, or path conventions.

## Visual language

Use the existing semantic variables from upstream `base.css`; do not introduce a parallel color or spacing system. Raised dialog surfaces use `--color-surface-raised`, primary selection and actions use `--color-primary`/`--color-primary-bg`, text uses the semantic text tokens, and focus uses `--color-focus-border` with `--ui-focus-soft`.

Typography uses `--font-family-ui` and the existing compact scale. Hanja glyphs may be visually larger for recognition, but supporting text stays within the shared base, small, and muted sizes. Borders and radii remain modest. Icons are optional and must come from the existing sprite system; text labels are preferred for unfamiliar linguistic actions.

## Components

### Shared modal

Use `.modal-overlay`, `.dialog-wrap`, `.dialog-title`, `.dialog-body`, `.dialog-footer`, `.dialog-btn`, and `.dialog-btn-primary`. A modal has a visible title, close button, bounded body height, cancel action, and one primary action.

### Selectable list

Use `role="listbox"` and `role="option"` with `aria-selected`. Selected items use the established primary border and background. Arrow Up/Down moves selection, Enter confirms, and active items scroll into view.

### Hanja conversion dialog

The dialog has one of two modes:

- Word candidates: a list of complete replacements, with the Hanja form as the primary line and per-character 훈음 plus dictionary definition as secondary information.
- Character fallback: a row of source syllables, a live assembled preview, and a candidate list for the active syllable. Left/Right changes the active syllable; Up/Down changes its candidate; Enter accepts the current character and advances, or applies on the final syllable.

The original Hangul stays visible. Candidate text is never represented by color alone. The dialog must distinguish “word candidate” and “character-by-character” modes in text.

## Accessibility

- The dialog uses `role="dialog"`, `aria-modal="true"`, and an accessible title.
- Candidate collections expose listbox/option roles and current selection.
- Initial focus lands on the primary candidate list; closing restores editor focus.
- Escape always cancels without editing.
- Keyboard handlers stop propagation so editor shortcuts do not fire behind the modal.
- Pointer targets remain at least 44 px on narrow/touch layouts; desktop controls may use the existing compact sizes.
- Focus indication, selected state, and explanatory text must remain legible in both themes.

## Responsive behavior

Dialogs use a desktop width capped by `calc(100vw - 32px)` and a candidate list height capped by the viewport. On narrow windows, metadata wraps, syllable controls become horizontally scrollable, and footer actions remain reachable. No content relies on hover.

## Interaction and system states

- Loading: status bar reports that the bundled dictionary is loading; no empty dialog flashes.
- Word match: complete word candidates are preferred over character fallback.
- No word match: every Hangul syllable must have at least one labeled character candidate before the fallback dialog opens.
- Unsupported input: empty text, non-Hangul text, cross-paragraph selections, form mode, unsupported note/header editing contexts, or missing candidates produce a concise status message and make no edit.
- Stale range: if the editor range changes while data or the modal is open, conversion is cancelled safely.
- Failure: bundled asset parse/load failures are logged without document content and summarized in the status bar.
- Success: the replacement is one undoable edit and the status bar confirms the source and result.

## Implementation constraints

- HOP UI and behavior live in `apps/studio-host`; `third_party/rhwp` remains read-only.
- The bundled static dictionary is the runtime source. No API key or network service is required.
- Commands must dispatch through the existing registry. Shortcuts normally use the late matcher;
  F9 is the narrow exception because it must run before upstream clears the text selection. Its
  capture handler may run only for unmodified F9 from the active editor input, with no modal, IME
  composition, or image/shape/textbox/connector/polygon placement mode active.
- Text mutation goes through upstream's undo-aware operation router.
- Replacement lengths use document character counts rather than JavaScript UTF-16 code units so supplementary-plane Hanja remain undo-safe.
- DOM text uses `textContent`; dictionary content is never injected as HTML.
- No new dependency is required for this interaction.

## Open questions

The initial release intentionally leaves contextual candidate ranking, per-user frequency learning, and optional live National Institute of Korean Language API enrichment for later evaluation. These do not block the deterministic offline F9 flow.
