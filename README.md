# Status Line

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Status Line is a pi extension package that replaces the default footer with a compact view of:

- Current directory, Git branch, and session name
- Session token usage, cost, context usage, model, and thinking level
- Average output generation speed (tokens/second)
- Remaining provider quota and reset time for Anthropic, Google Antigravity, OpenAI Codex, and GitHub Copilot
- Ollama Cloud session (5h) and weekly (7d) cap usage for `ollama-cloud` models and for local `ollama` cloud models (`:cloud` ids; Ollama exposes no per-window reset times, so no countdown)
- Collapsible status messages published by other extensions

## Install

```bash
pi install git:git@github.com:casonadams/status-line.git
```

The extension uses credentials already configured in pi. GitHub Copilot quota lookup can also fall back to the token from `gh auth token`.

For local `ollama` setups (`ollama launch pi`), the local server does not proxy Ollama Cloud usage, and the entry's `key` is a device credential that ollama.com rejects (and tooling may rewrite). Add your Ollama Cloud API key as a `static_key` on that entry - it takes precedence over every tool-managed source - or launch pi with `OLLAMA_API_KEY` set. Non-cloud local models show no quota.

If the [`pi-ollama-cloud`](https://github.com/fgrehm/pi-ollama-cloud) extension is installed, keep its own opt-in usage bar (`/ollama-usage-status`) off so Ollama Cloud usage is not rendered twice on two surfaces.

## Extension statuses

Extension statuses are hidden by default and summarized on the top line. Toggle the status line with `/status-line.statuses`.

## Development

```bash
pnpm install
pnpm lint
pnpm test
pnpm typecheck
```

To try the local checkout without installing it:

```bash
pi -e ./extensions/status-line/index.ts
```
