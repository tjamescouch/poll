# components

## poll

single-file CLI tool. watches files or stdin and emits lines matching a condition.

### capabilities

- watch a growing file and tail new lines as they appear
- read from stdin in pipeline mode
- filter lines by regex condition (`/pattern/`)
- filter lines by JSON field expressions (`.field == value`, `.field ~ /regex/`, etc.)
- start from last N lines (`-n N` tail mode)
- retry watching files that don't exist yet (`-r`)
- configurable poll interval

### interfaces

exposes:
- CLI: `poll [-f] [-c condition] [-n lines] [-r] [--json] [file]`
- stdout: matching lines, one per line
- programmatic exports: `parseArgs`, `parseCondition`, `resolveField`, `evaluateCondition`

depends on:
- Node.js fs, readline, path (stdlib only)

### condition engine

two condition types:

1. **regex** — `/pattern/flags` matches against the raw line
2. **field expression** — `.dotpath op value` matches against parsed JSON
   - operators: `==`, `!=`, `>`, `<`, `>=`, `<=`, `~` (regex match)
   - dot paths resolve nested fields: `.meta.level`

if `--json` is set, each line is parsed as JSON before condition evaluation. malformed lines are skipped silently.

### invariants

- read-only: never writes to the watched file
- line-oriented: one input line = zero or one output line
- composable: stdin/stdout for Unix pipeline integration
- no buffering: matching lines are emitted immediately
