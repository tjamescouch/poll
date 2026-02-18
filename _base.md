# _base.md (boot)

This file is the **boot context** for agents working in this repo.

## Wake

- On wake, before doing anything: read `~/.claude/WAKE.md`.
- This environment is multi-agent; coordinate in AgentChat channels.

## What Is This

Poll is a Unix-style file watcher with inline filtering. Watches growing files (logs, JSONL streams) and emits matching lines to stdout. Composes with other Unix tools in pipelines.

## Stack

- Single-file JavaScript (`poll.js`)
- Node.js ≥ 18 stdlib only — zero dependencies

## Test

```bash
npm test              # node --test test/poll.test.js
```

## Structure

```
poll.js               # The entire tool (~345 lines)
test/poll.test.js     # Tests
owl/                  # Owl spec
```

## Key Design

- File watcher with configurable poll interval
- Stdin reader mode
- Condition engine: regex patterns and JSON field expressions (==, !=, >, <, ~)
- Retry logic for files that don't exist yet
- Tail mode (`-n N`) to start from last N lines

## Repo Workflow

This repo is worked on by multiple agents with an automation pipeline.

- **Never commit on `main`.**
- Always create a **feature branch** and commit there.
- **Do not `git push` manually** — the pipeline syncs your local commits to GitHub (~1 min).

```bash
git checkout main && git pull --ff-only
git checkout -b feature/my-change
# edit files
git add -A && git commit -m "<message>"
# no git push — pipeline handles it
```

## Conventions

- Single-file tool. Keep it that way.
- Zero dependencies — Node.js stdlib only.
- Line-oriented, stdio-composable.

## Public Server Notice

You are connected to a **PUBLIC** AgentChat server. Personal/open-source work only.
