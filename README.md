# Status Line

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Status Line is a pi extension package that replaces the default footer with a compact view of:

- Current directory, Git branch, and session name
- Session token usage, cost, context usage, model, and thinking level
- Average output generation speed (tokens/second)
- Remaining provider quota and reset time for Anthropic, Google Antigravity, OpenAI Codex, and GitHub Copilot
- Collapsible status messages published by other extensions

## Install

```bash
pi install git:git@github.com:casonadams/status-line.git
```

The extension uses credentials already configured in pi. GitHub Copilot quota lookup can also fall back to the token from `gh auth token`.

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
