#!/usr/bin/env node

import { createReadStream, watch, statSync, openSync, readSync, closeSync } from 'node:fs';
import { stat, access } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';

// --- Arg parsing ---

export function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    condition: null,
    interval: 100,
    follow: false,
    lines: 0,
    retry: false,
    json: false,
    help: false,
    version: false,
    file: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-c' || arg === '--condition') {
      opts.condition = args[++i];
    } else if (arg === '-i' || arg === '--interval') {
      opts.interval = parseInt(args[++i], 10);
    } else if (arg === '-f' || arg === '--follow') {
      opts.follow = true;
    } else if (arg === '-n' || arg === '--lines') {
      opts.lines = parseInt(args[++i], 10);
    } else if (arg === '-r' || arg === '--retry') {
      opts.retry = true;
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '-h' || arg === '--help') {
      opts.help = true;
    } else if (arg === '-v' || arg === '--version') {
      opts.version = true;
    } else if (!arg.startsWith('-')) {
      opts.file = arg;
    }
  }

  return opts;
}

// --- Field resolution ---

export function resolveField(obj, dotPath) {
  const parts = dotPath.replace(/^\./, '').split('.');
  let cur = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

// --- Condition parsing ---

export function parseCondition(expr) {
  if (!expr) return () => true;

  // /regex/ — match raw line
  const rawRegex = expr.match(/^\/(.+)\/([gimsuy]*)$/);
  if (rawRegex) {
    const re = new RegExp(rawRegex[1], rawRegex[2]);
    return (line) => re.test(line);
  }

  // .field ~ /pattern/ — regex match on field
  const fieldRegex = expr.match(/^(\.[a-zA-Z0-9_.]+)\s*~\s*\/(.+)\/([gimsuy]*)$/);
  if (fieldRegex) {
    const [, path, pattern, flags] = fieldRegex;
    const re = new RegExp(pattern, flags);
    return (line, parsed) => {
      if (!parsed) return false;
      const val = resolveField(parsed, path);
      return val != null && re.test(String(val));
    };
  }

  // .field op "value" or .field op number
  const comparison = expr.match(/^(\.[a-zA-Z0-9_.]+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (comparison) {
    const [, path, op, rawVal] = comparison;
    let expected;
    const strMatch = rawVal.match(/^"(.*)"$/) || rawVal.match(/^'(.*)'$/);
    if (strMatch) {
      expected = strMatch[1];
    } else if (rawVal === 'true') {
      expected = true;
    } else if (rawVal === 'false') {
      expected = false;
    } else if (rawVal === 'null') {
      expected = null;
    } else {
      expected = Number(rawVal);
    }

    return (line, parsed) => {
      if (!parsed) return false;
      const actual = resolveField(parsed, path);
      switch (op) {
        case '==': return actual == expected;
        case '!=': return actual != expected;
        case '>':  return actual > expected;
        case '<':  return actual < expected;
        case '>=': return actual >= expected;
        case '<=': return actual <= expected;
      }
      return false;
    };
  }

  // .field — truthy check
  const truthyMatch = expr.match(/^(\.[a-zA-Z0-9_.]+)$/);
  if (truthyMatch) {
    const path = truthyMatch[1];
    return (line, parsed) => {
      if (!parsed) return false;
      return !!resolveField(parsed, path);
    };
  }

  // Fallback: treat as literal substring match
  return (line) => line.includes(expr);
}

// --- Stdin reader ---

export async function* readStdin() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    yield line;
  }
}

// --- File watcher ---

export async function* watchFile(filePath, opts = {}) {
  const { interval = 100, follow = false, lines = 0, retry = false } = opts;
  const absPath = resolve(filePath);

  // Wait for file to exist if --retry
  if (retry) {
    while (true) {
      try {
        await access(absPath);
        break;
      } catch {
        await sleep(interval);
      }
    }
  }

  let offset = 0;

  // Handle --lines: start from last N lines
  if (lines > 0) {
    const content = readChunk(absPath, 0);
    const allLines = content.split('\n');
    const startFrom = allLines.slice(-lines - 1);
    // Calculate offset to skip everything before these lines
    const skipBytes = Buffer.byteLength(content) - Buffer.byteLength(startFrom.join('\n'));
    offset = Math.max(0, skipBytes);
  } else {
    // Start from end of file (only new content)
    try {
      const s = statSync(absPath);
      offset = s.size;
    } catch {
      offset = 0;
    }
  }

  // Read any initial content from offset
  const initial = readChunkFrom(absPath, offset);
  if (initial.length > 0) {
    const initialLines = initial.split('\n');
    offset += Buffer.byteLength(initial);
    for (const line of initialLines) {
      if (line.length > 0) yield line;
    }
  }

  if (!follow) return;

  // Follow mode: watch for changes
  let pending = false;
  let watcher;

  try {
    watcher = watch(absPath, () => { pending = true; });
  } catch {
    // fs.watch not available, fall back to polling
    watcher = null;
  }

  try {
    while (true) {
      if (watcher) {
        // Wait for fs.watch event or poll interval
        if (!pending) {
          await sleep(interval);
          if (!pending) continue;
        }
        pending = false;
      } else {
        await sleep(interval);
      }

      // Check for new content
      let size;
      try {
        const s = await stat(absPath);
        size = s.size;
      } catch {
        if (retry) continue;
        return;
      }

      // Truncation detection
      if (size < offset) {
        offset = 0;
      }

      if (size <= offset) continue;

      const chunk = readChunkFrom(absPath, offset);
      if (chunk.length === 0) continue;

      offset += Buffer.byteLength(chunk);
      const newLines = chunk.split('\n');
      for (const line of newLines) {
        if (line.length > 0) yield line;
      }
    }
  } finally {
    if (watcher) watcher.close();
  }
}

// --- Helpers ---

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function readChunk(filePath, start) {
  try {
    const s = statSync(filePath);
    const len = s.size - start;
    if (len <= 0) return '';
    const buf = Buffer.alloc(len);
    const fd = openSync(filePath, 'r');
    try {
      readSync(fd, buf, 0, len, start);
    } finally {
      closeSync(fd);
    }
    return buf.toString('utf8');
  } catch {
    return '';
  }
}

function readChunkFrom(filePath, offset) {
  return readChunk(filePath, offset);
}

// --- Main ---

const HELP = `poll [options] [file]

Watch a file (or stdin) and emit matching lines to stdout.

Options:
  -c, --condition <expr>   Filter condition (default: emit all)
  -i, --interval <ms>      Poll interval in ms (default: 100)
  -f, --follow             Keep watching after EOF (tail -f style)
  -n, --lines <count>      Start from last N lines (default: 0)
  -r, --retry              Retry if file doesn't exist yet
  --json                   Parse lines as JSON before condition eval
  -h, --help               Show this help
  -v, --version            Show version

Condition syntax:
  /regex/                  Match raw line against regex
  .field == "value"        Equality (requires --json)
  .field != "value"        Inequality (requires --json)
  .field > N               Numeric comparison (requires --json)
  .field ~ /pattern/       Regex match on field (requires --json)
  .field                   Truthy check (requires --json)

Examples:
  poll -f server.log -c '/ERROR/'
  poll -f events.jsonl --json -c '.type == "emotion"'
  cat data.jsonl | poll --json -c '.score > 0.5'`;

export async function main(argv) {
  const opts = parseArgs(argv);

  if (opts.help) {
    process.stdout.write(HELP + '\n');
    return;
  }

  if (opts.version) {
    process.stdout.write('0.1.0\n');
    return;
  }

  const test = parseCondition(opts.condition);
  const source = opts.file
    ? watchFile(opts.file, opts)
    : readStdin();

  for await (const line of source) {
    let parsed = null;
    if (opts.json) {
      try {
        parsed = JSON.parse(line);
      } catch {
        continue; // skip malformed JSON lines
      }
    }

    if (test(line, parsed)) {
      process.stdout.write(line + '\n');
    }
  }
}

// Run if executed directly
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  main(process.argv).catch(err => {
    process.stderr.write(err.message + '\n');
    process.exit(1);
  });
}
