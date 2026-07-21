# Status Line

Status Line is a pi extension package that replaces the default footer with a compact view of:

- Current directory, Git branch, and session name
- Session token usage, cost, context usage, model, and thinking level
- Remaining provider quota and reset time for Anthropic, OpenAI Codex, and GitHub Copilot
- Status messages published by other extensions

## Install

```bash
pi install git:git@github.com:casonadams/status-line.git
```

The extension uses credentials already configured in pi. GitHub Copilot quota lookup can also fall back to the token from `gh auth token`.

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
