# poll

Unix-style file watcher with inline filtering. Watches files (or stdin) and emits matching lines to stdout.

## purpose

- Watch growing files (logs, JSONL streams) and filter in real-time
- Support regex conditions on raw lines and field expressions on JSON
- Compose with other Unix tools in pipelines (`poll | face | visage`)
- Zero dependencies — Node.js stdlib only

## components

- **poll.js** — Single-file implementation (~345 lines)
  - File watcher with configurable poll interval
  - Stdin reader mode
  - Condition engine: regex patterns and JSON field expressions (==, !=, >, <, ~)
  - Retry logic for files that don't exist yet
  - Tail mode (`-n N`) to start from last N lines

## non-goals

- Not an event bus or message queue — purely line-oriented stdio filter
- No complex query language — conditions are intentionally simple
- No write operations — read-only, output to stdout
