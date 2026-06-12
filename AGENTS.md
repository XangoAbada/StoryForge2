# AGENTS.md

## Testing Policy

- Do not run front-end tests, Playwright checks, or other automated UI verification. The user is the only person who performs front-end testing and UI verification.
- Build commands and backend tests may be run when they are useful for validating non-UI changes.
- After UI changes, describe what the user should inspect manually, especially awkward spacing, weak alignment, cramped or wasted space, poor proportions, visual imbalance, and overall layout coherence.

## Polish UI Text

- All Polish UI copy, labels, field descriptions, tab names, button text, status messages, AI prompt labels, and user-facing errors must use correct Polish diacritics.
- Do not add new Polish text without characters such as `ą`, `ć`, `ę`, `ł`, `ń`, `ó`, `ś`, `ź`, and `ż` where the word requires them.
- When editing an existing Polish UI area, fix nearby missing or mojibake Polish characters in the touched strings instead of preserving broken display text.

## Migration Hygiene

- Do not edit existing database migration files that may already have been applied locally or by another developer.
- When changing the database schema or migration behavior, add a new migration instead of modifying a previously applied migration.
- If a migration must be corrected immediately after creation, first verify it has not been applied; otherwise create a follow-up migration.

## AI Field Controls

- Every text input or textarea added to the app should include a local AI generation button for that exact field.
- Field-level AI generation must produce content only for the field next to the button. Do not use one field button to silently update other fields.
- Each AI field generation must include the meaningful default context fields for that generation target. Choose the context that best fits the target field, entity, and screen.
- Focusing or clicking an editable AI-backed field should activate the right-side prompt context builder (`AiPromptContextPanel`) for that field.
- The `+` context button beside an AI button adds that field/source to the currently active prompt context, when the screen supports contextual AI prompts.
- A context source may appear only once in the active prompt context. After a source has been added, its `+` button must be disabled/greyed out and the store-level duplicate guard should still prevent duplicate insertion.
- Required context sources stay enabled and cannot be toggled off by the user.
- AI-generated text must go through the proposal/acceptance flow and must not be saved permanently without user confirmation.

## Plan Relation Controls

- Chapters, beats, and threads are connected through explicit relation data: `chapterBeats` for chapter-to-beat links and `chapterThreads` for chapter-to-thread links.
- Cards should show existing relations as compact chips/tags on the related entity card.
- A `-` control on a relation chip detaches only that relation. It must not delete the beat, chapter, thread, or any other canonical entity.
- A `+` relation control opens a selector/picker for adding existing entities. It should not create duplicate relation entries.
- Reuse this relation style in new plan views: chip/tag for the current relation, `-` for detach, `+` for add, clear `aria-label` and `title` text, and stopped click propagation when relation controls sit inside clickable cards.
- When adding or removing relations from a chapter card or editor, preserve unrelated relation lists and update only the relevant `threadIds` or `beatIds`.

## Modal Construction

- App modals should render through `createPortal(..., document.body)` when `document` exists, with a non-portal fallback for environments where `document` is unavailable.
- Modal wrappers should use `role="dialog"`, `aria-modal="true"`, and preferably `aria-labelledby` pointing to the visible modal title.
- Use the established structure: fixed full-screen overlay, a separate backdrop button that closes the modal, a shell above the backdrop, a header with eyebrow/title and an `X` close button, body content for the form/list, and an optional footer for actions or status.
- `Escape`, backdrop click, and the `X` button should close the modal unless a specific flow intentionally blocks closing.
- Relation selectors should use the smaller relation-picker modal style with a scrollable option list. Entity editors should use the larger edit modal style with a header and body.

## Commit Hygiene

- Before committing, remove unnecessary generated log files from the project directory, especially root-level `*.log` files from Vite, Tauri, or local preview runs.
