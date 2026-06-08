# AGENTS.md

## Testing Policy

- Do not run front-end tests, Playwright checks, or other automated UI verification. The user is the only person who performs front-end testing and UI verification.
- Build commands and backend tests may be run when they are useful for validating non-UI changes.
- After UI changes, describe what the user should inspect manually, especially awkward spacing, weak alignment, cramped or wasted space, poor proportions, visual imbalance, and overall layout coherence.

## Commit Hygiene

- Before committing, remove unnecessary generated log files from the project directory, especially root-level `*.log` files from Vite, Tauri, or local preview runs.
