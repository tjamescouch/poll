# constraints

- Zero runtime dependencies — Node.js builtins only
- Single-file implementation — no build step
- Must compose with standard Unix pipelines (stdin/stdout)
- Node.js 18+ required
- Condition parsing must handle both regex and JSON field expressions
- JSON mode (`--json`) parses each line independently — malformed lines are skipped, not fatal
