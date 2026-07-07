<div align="center">

# Bowri

**A local-first desktop workspace for writing novels with an AI co-author.**

Brainstorm the idea, build the plan, draft scenes, and export a finished book — all on your machine, with your own AI account and nothing stored in the cloud.

[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)](https://tauri.app)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-stable-000000?logo=rust&logoColor=white)](https://www.rust-lang.org)
[![SQLite](https://img.shields.io/badge/SQLite-local-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org)

</div>

---

## What is Bowri?

Bowri is a desktop writing studio for long-form fiction. It walks a book from a
blank page to an exportable manuscript through a guided workflow, and it treats
AI as a proposal engine — every change the model suggests is shown in the UI and
saved **only after you approve it**.

Your work lives in a local SQLite database. Bowri never uploads your manuscript;
the only thing that leaves your machine is the prompt you send to your own AI
account.

## Features

- **📖 Guided writing workflow** — Brainstorm → Concept → Plan → Characters → World → Scene editor → Editing → Export.
- **🤖 AI co-author, human in control** — the model proposes; you review a diff-style preview and accept or reject. Nothing is written behind your back.
- **🧠 Story bible awareness** — characters, world, and continuity summaries are fed back into prompts so the AI stays consistent across chapters.
- **🎨 Cover & character art** — generate a book cover, character portraits, and editorial illustrations through the same AI account.
- **💸 Cost visibility** — token usage and generation cost are surfaced per request.
- **📝 Rich scene editor** — a TipTap-based editor built for drafting and redrafting prose.
- **📦 Portable projects** — export a project as a self-contained ZIP and re-import it anywhere.
- **🌍 Bilingual UI** — Polish and English out of the box (i18next).
- **🔒 Local-first & private** — SQLite on disk, no accounts, no telemetry, no credentials stored by the app.

## AI provider

Bowri's V1 AI backend is **`codex-cli-bridge`**. The app shells out to the
official [Codex CLI](https://developers.openai.com/codex/cli) through Tauri
commands, so it reuses your existing Codex authentication for both text and
image generation. Bowri stores no tokens or credentials of its own — run
`codex login` once and you are set.

## Tech stack

| Layer      | Technology                                             |
| ---------- | ------------------------------------------------------ |
| Shell      | [Tauri 2](https://tauri.app) (Rust)                    |
| Frontend   | React 19, TypeScript, Vite                             |
| Routing    | TanStack Router                                        |
| State/data | TanStack Query, Zustand, Zod                           |
| Editor     | TipTap 3                                               |
| Storage    | SQLite (local)                                         |
| AI         | `codex-cli-bridge` → official Codex CLI                |
| i18n       | i18next / react-i18next (Polish + English)             |

## Getting started

### Prerequisites

- **Node.js** 18+ and npm
- **Rust** (stable, MSVC toolchain on Windows) — required for the desktop build
- **Codex CLI** — required for AI text and image generation

Install Rust on Windows if you don't have it:

```powershell
winget install Rustlang.Rustup
rustup default stable
cargo --version
```

Authenticate the Codex CLI (used for all AI features):

```powershell
codex --version
codex login
```

### Run the desktop app

From the repository root, with PowerShell:

```powershell
npm install
npm run tauri -- dev
```

This launches the full Tauri app with the Rust backend, SQLite storage, and
Codex CLI integration.

> **Note:** Image generation (covers, character art) can take several minutes.
> Bowri keeps a 600-second minimum timeout and copies the final PNG into the
> app's `covers` directory once Codex CLI finishes.

### Frontend-only preview

For UI work you can run just the Vite dev server:

```sh
npm run desktop
```

This starts the browser preview only — it has **no** Rust backend, SQLite
commands, or Codex CLI checks. Use it for styling and layout, not for testing
real behavior.

### Tests

```sh
npm test
```

## Project structure

```
Bowri/
├─ apps/
│  └─ desktop/
│     ├─ src/                 # React frontend
│     │  ├─ app/              # Router & app shell
│     │  ├─ features/         # Brainstorm, book, characters, world, scenes, editing, export, ai
│     │  └─ shared/           # UI kit, i18n, API bindings
│     └─ src-tauri/           # Rust backend (Tauri commands, SQLite, Codex bridge)
└─ docs/                      # Design system & planning docs
```

## Troubleshooting

**`failed to run cargo metadata … program not found`**
Tauri can't find `cargo`. Install Rust, open a **new** terminal, and confirm
`cargo --version` works before retrying. If Cargo is installed but not on
`PATH` yet:

```powershell
$env:PATH="$env:USERPROFILE\.cargo\bin;$env:PATH"
cargo --version
npm run tauri -- dev
```

---

<div align="center">
<sub>Bowri — write locally, own your words.</sub>
</div>
