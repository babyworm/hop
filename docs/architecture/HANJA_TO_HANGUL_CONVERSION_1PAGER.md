# Hanja-to-Hangul conversion — Problem 1-Pager

## Background

HOP's bundled character database already stores each Hanja glyph's Korean
readings, labels, and meanings. The conversion command, editor range reader,
and context-menu eligibility currently accept only precomposed Hangul.

## Problem

F9 and the selection context menu do nothing on Hanja text, so users cannot
inspect a glyph's 음·훈 or convert it back to Hangul.

## Goal

- Recognize a contiguous Hanja run at the caret or in a same-container selection.
- Show every available Korean reading with its corresponding 훈/meaning.
- Let users choose readings per glyph and replace the source through the existing
  undo-safe conversion command.
- Show the right-click conversion submenu for Hanja while continuing to hide it
  for English or mixed unsupported selections.

## Non-goals

- Building a reverse index across all word shards in this change.
- Guessing Korean phonological changes or 두음법칙 for whole words.
- Modifying `third_party/rhwp` or the bundled source datasets.

## Constraints

- Keep source and replacement scalar counts aligned for format-safe replacement.
- Preserve IME, modal, form-mode, object-selection, stale-document, and unsupported
  container guards.
- Load only the validated core character assets for reverse lookup.

## Implementation outline

1. Classify editor sources as Hangul-to-Hanja or Hanja-to-Hangul.
2. Add validated Hanja reverse lookup using existing character records.
3. Generalize the per-character dialog so both directions share navigation,
   preview, accessibility, and replacement behavior.
4. Make the context submenu action label direction-aware.

## Verification plan

- Range tests for Hanja selection, caret runs, supplementary-plane characters,
  and mixed/English rejection.
- Dictionary tests for multiple readings and 훈 labels without word-shard loading.
- Dialog tests for meaning display and per-glyph Hangul assembly.
- Command routing, context-menu, full repository, build, and desktop checks.

## Rollback or recovery notes

The reverse path is additive and uses the existing replacement command. Reverting
the feature commit restores the prior one-way behavior without data migration.
