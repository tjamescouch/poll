# @tjamescouch/poll

Watch files and emit matching lines to stdout. A Unix-style filter primitive.

```bash
poll -f server.log -c '/ERROR/'
```

## Install

```bash
npm install -g @tjamescouch/poll
```

Or use directly:

```bash
npx @tjamescouch/poll -f app.log -c '/ERROR/'
```

## Usage

```
poll [options] [file]

Options:
  -c, --condition <expr>   Filter condition (default: emit all)
  -i, --interval <ms>      Poll interval in ms (default: 100)
  -f, --follow             Keep watching after EOF (tail -f style)
  -n, --lines <count>      Start from last N lines (default: 0)
  -r, --retry              Retry if file doesn't exist yet
  --json                   Parse lines as JSON before condition eval
  -h, --help               Show help
  -v, --version            Show version
```

No file argument reads from stdin.

## Conditions

### Regex (works on raw lines)

```bash
poll -f app.log -c '/ERROR|WARN/'
poll -f app.log -c '/timeout/i'
```

### Field expressions (require `--json`)

```bash
# Equality
poll --json -c '.type == "emotion"'

# Numeric comparison
poll --json -c '.score > 0.5'

# Inequality
poll --json -c '.status != "idle"'

# Field regex
poll --json -c '.message ~ /fail/'

# Truthy check
poll --json -c '.error'

# Nested fields
poll --json -c '.data.sentiment.valence > 0'
```

## Pipeline Examples

Filter a JSONL stream:

```bash
cat events.jsonl | poll --json -c '.type == "emotion"' | face | visage
```

Watch a growing log file:

```bash
poll -f /var/log/app.log -c '/ERROR/' | notify
```

Wait for a file that doesn't exist yet:

```bash
poll -f -r /tmp/output.jsonl --json -c '.done == true'
```

Start from the last 10 lines:

```bash
poll -f -n 10 app.log
```

Chain conditions with standard Unix tools:

```bash
poll -f data.jsonl --json -c '.score > 0.5' | poll --json -c '.type == "hit"'
```

## Zero Dependencies

No npm dependencies. Uses only Node.js builtins (`fs`, `readline`, `path`).

Requires Node.js >= 18.

## License

MIT
