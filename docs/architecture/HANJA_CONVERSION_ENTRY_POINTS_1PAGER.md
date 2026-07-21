# Hanja conversion entry points — Problem 1-Pager

## Background

HOP already provides offline Hangul-to-Hanja lookup and replacement through the
`edit:convert-hanja` command. The command is intended to be available from F9,
but its capture path currently depends on one WebView key shape and an exact
hidden-input event target. The command is not exposed through the editor chrome.

## Problem

F9 can be ignored when a desktop WebView reports the function key through
`code`/legacy key code or retargets the event while the hidden editor input still
has focus. Users also cannot discover the feature from the selection context
menu, toolbar, or Input menu.

## Goal

- Make unmodified F9 reliably dispatch Hanja conversion while the editor owns focus.
- Add a Hangul-sensitive conversion submenu to the text context menu.
- Add a `漢` conversion button immediately after Character Table in the toolbar.
- Add Hangul/Hanja Conversion immediately after Character Table in Input.
- Route every entry point through the existing command and preserve its safety checks.

## Non-goals

- Converting Hanja back to Hangul in this change.
- Modifying the read-only `third_party/rhwp` submodule.
- Capturing function keys that macOS reserves before they reach the application.

## Constraints

- Preserve IME composition, modal, drawing/placement, form-mode, object-selection,
  and unsupported text-container guards.
- Do not show the context-menu entry for an English or mixed non-Hangul selection.
- Keep the implementation cross-platform and dependency-free.

## Implementation outline

1. Recognize F9 through `key`, `code`, or key code 120, and accept WebView event
   retargeting only while the hidden editor input remains focused.
2. Extend the upstream context-menu class in the HOP layer and append a conversion
   submenu only when the current selection/caret resolves to a valid Hangul source.
3. Add static menu and toolbar markup bound to `edit:convert-hanja`.
4. Use a text-based `漢` icon so no new binary asset or dependency is required.

## Verification plan

- Shortcut unit tests for `key`, `code`, key code, retargeting, modifiers, IME,
  modal state, and non-editor focus.
- Context eligibility and markup-order tests, including English-selection hiding.
- Studio tests, typecheck/build, repository tests, and a rebuilt desktop launch.

## Rollback or recovery notes

All changes are isolated to HOP source and static markup. Reverting the feature
commit restores the prior command-only implementation without touching dictionary
data or document serialization.
