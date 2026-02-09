import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseCondition, resolveField, parseArgs, watchFile } from '../poll.js';
import { writeFileSync, unlinkSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const POLL_BIN = join(__dirname, '..', 'poll.js');

function tmpFile(name) {
  const dir = join(tmpdir(), 'poll-test-' + process.pid);
  mkdirSync(dir, { recursive: true });
  return join(dir, name);
}

// --- resolveField ---

describe('resolveField', () => {
  it('resolves top-level field', () => {
    assert.equal(resolveField({ name: 'test' }, '.name'), 'test');
  });

  it('resolves nested field', () => {
    assert.equal(resolveField({ a: { b: { c: 42 } } }, '.a.b.c'), 42);
  });

  it('returns undefined for missing path', () => {
    assert.equal(resolveField({ a: 1 }, '.b.c'), undefined);
  });

  it('returns undefined for null object', () => {
    assert.equal(resolveField(null, '.a'), undefined);
  });

  it('handles numeric values', () => {
    assert.equal(resolveField({ score: 0.8 }, '.score'), 0.8);
  });

  it('handles boolean values', () => {
    assert.equal(resolveField({ active: false }, '.active'), false);
  });
});

// --- parseCondition ---

describe('parseCondition', () => {
  it('returns pass-all when no condition', () => {
    const fn = parseCondition(null);
    assert.equal(fn('anything'), true);
  });

  describe('regex on raw line', () => {
    it('matches with /regex/', () => {
      const fn = parseCondition('/error/');
      assert.equal(fn('an error occurred'), true);
      assert.equal(fn('all is well'), false);
    });

    it('supports flags', () => {
      const fn = parseCondition('/ERROR/i');
      assert.equal(fn('an error occurred'), true);
    });
  });

  describe('equality', () => {
    it('.field == "value"', () => {
      const fn = parseCondition('.type == "emotion"');
      assert.equal(fn('', { type: 'emotion' }), true);
      assert.equal(fn('', { type: 'other' }), false);
    });

    it('.field == number', () => {
      const fn = parseCondition('.count == 5');
      assert.equal(fn('', { count: 5 }), true);
      assert.equal(fn('', { count: 6 }), false);
    });

    it('.field == true', () => {
      const fn = parseCondition('.active == true');
      assert.equal(fn('', { active: true }), true);
      assert.equal(fn('', { active: false }), false);
    });
  });

  describe('inequality', () => {
    it('.field != "value"', () => {
      const fn = parseCondition('.status != "idle"');
      assert.equal(fn('', { status: 'active' }), true);
      assert.equal(fn('', { status: 'idle' }), false);
    });
  });

  describe('numeric comparisons', () => {
    it('.field > N', () => {
      const fn = parseCondition('.score > 0.5');
      assert.equal(fn('', { score: 0.8 }), true);
      assert.equal(fn('', { score: 0.3 }), false);
      assert.equal(fn('', { score: 0.5 }), false);
    });

    it('.field < N', () => {
      const fn = parseCondition('.score < 0.5');
      assert.equal(fn('', { score: 0.3 }), true);
      assert.equal(fn('', { score: 0.8 }), false);
    });

    it('.field >= N', () => {
      const fn = parseCondition('.score >= 0.5');
      assert.equal(fn('', { score: 0.5 }), true);
      assert.equal(fn('', { score: 0.8 }), true);
      assert.equal(fn('', { score: 0.3 }), false);
    });

    it('.field <= N', () => {
      const fn = parseCondition('.score <= 0.5');
      assert.equal(fn('', { score: 0.5 }), true);
      assert.equal(fn('', { score: 0.3 }), true);
      assert.equal(fn('', { score: 0.8 }), false);
    });
  });

  describe('field regex', () => {
    it('.field ~ /pattern/', () => {
      const fn = parseCondition('.msg ~ /fail/');
      assert.equal(fn('', { msg: 'test failed' }), true);
      assert.equal(fn('', { msg: 'test passed' }), false);
    });

    it('returns false without parsed object', () => {
      const fn = parseCondition('.msg ~ /fail/');
      assert.equal(fn('test failed'), false);
    });
  });

  describe('truthy check', () => {
    it('.field — truthy', () => {
      const fn = parseCondition('.emotion');
      assert.equal(fn('', { emotion: 'happy' }), true);
      assert.equal(fn('', { emotion: '' }), false);
      assert.equal(fn('', { emotion: null }), false);
      assert.equal(fn('', {}), false);
    });
  });

  describe('nested fields', () => {
    it('.a.b.c == "deep"', () => {
      const fn = parseCondition('.a.b.c == "deep"');
      assert.equal(fn('', { a: { b: { c: 'deep' } } }), true);
      assert.equal(fn('', { a: { b: { c: 'shallow' } } }), false);
    });
  });
});

// --- parseArgs ---

describe('parseArgs', () => {
  it('parses -c condition', () => {
    const opts = parseArgs(['node', 'poll.js', '-c', '.type == "x"']);
    assert.equal(opts.condition, '.type == "x"');
  });

  it('parses --follow', () => {
    const opts = parseArgs(['node', 'poll.js', '-f']);
    assert.equal(opts.follow, true);
  });

  it('parses file argument', () => {
    const opts = parseArgs(['node', 'poll.js', '/tmp/test.log']);
    assert.equal(opts.file, '/tmp/test.log');
  });

  it('parses all options together', () => {
    const opts = parseArgs(['node', 'poll.js', '-f', '-c', '/err/', '-i', '200', '-n', '10', '--json', '-r', 'app.log']);
    assert.equal(opts.follow, true);
    assert.equal(opts.condition, '/err/');
    assert.equal(opts.interval, 200);
    assert.equal(opts.lines, 10);
    assert.equal(opts.json, true);
    assert.equal(opts.retry, true);
    assert.equal(opts.file, 'app.log');
  });

  it('defaults', () => {
    const opts = parseArgs(['node', 'poll.js']);
    assert.equal(opts.condition, null);
    assert.equal(opts.interval, 100);
    assert.equal(opts.follow, false);
    assert.equal(opts.lines, 0);
    assert.equal(opts.retry, false);
    assert.equal(opts.json, false);
    assert.equal(opts.file, null);
  });
});

// --- watchFile ---

describe('watchFile', () => {
  it('reads new lines appended to a file', async () => {
    const f = tmpFile('append.log');
    writeFileSync(f, '');

    const lines = [];
    const gen = watchFile(f, { follow: true, interval: 50 });

    // Append after a small delay
    setTimeout(() => {
      appendFileSync(f, 'line1\nline2\n');
    }, 80);

    // Collect with timeout
    const timeout = setTimeout(() => {}, 500);
    for await (const line of gen) {
      lines.push(line);
      if (lines.length >= 2) break;
    }
    clearTimeout(timeout);

    assert.deepEqual(lines, ['line1', 'line2']);
    try { unlinkSync(f); } catch {}
  });

  it('handles truncation', async () => {
    const f = tmpFile('trunc.log');
    writeFileSync(f, 'old content that is long\n');

    const lines = [];
    const gen = watchFile(f, { follow: true, interval: 50 });

    setTimeout(() => {
      // Truncate and write new content
      writeFileSync(f, 'new\n');
    }, 80);

    const timeout = setTimeout(() => {}, 500);
    for await (const line of gen) {
      lines.push(line);
      if (lines.length >= 1) break;
    }
    clearTimeout(timeout);

    assert.equal(lines[0], 'new');
    try { unlinkSync(f); } catch {}
  });

  it('reads last N lines with --lines', async () => {
    const f = tmpFile('lastN.log');
    writeFileSync(f, 'a\nb\nc\nd\ne\n');

    const lines = [];
    const gen = watchFile(f, { follow: false, lines: 2 });

    for await (const line of gen) {
      lines.push(line);
    }

    assert.deepEqual(lines, ['d', 'e']);
    try { unlinkSync(f); } catch {}
  });
});

// --- CLI integration ---

describe('CLI integration', () => {
  it('filters stdin with --json and condition', async () => {
    const child = spawn('node', [POLL_BIN, '--json', '-c', '.type == "hit"'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });

    child.stdin.write('{"type":"miss","val":1}\n');
    child.stdin.write('{"type":"hit","val":2}\n');
    child.stdin.write('{"type":"miss","val":3}\n');
    child.stdin.write('{"type":"hit","val":4}\n');
    child.stdin.end();

    await new Promise((resolve) => child.on('close', resolve));

    const lines = stdout.trim().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).val, 2);
    assert.equal(JSON.parse(lines[1]).val, 4);
  });

  it('filters stdin with regex', async () => {
    const child = spawn('node', [POLL_BIN, '-c', '/ERROR/'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });

    child.stdin.write('INFO all good\n');
    child.stdin.write('ERROR something broke\n');
    child.stdin.write('WARN heads up\n');
    child.stdin.end();

    await new Promise((resolve) => child.on('close', resolve));

    const lines = stdout.trim().split('\n');
    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes('ERROR'));
  });

  it('passes all lines when no condition', async () => {
    const child = spawn('node', [POLL_BIN], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });

    child.stdin.write('line1\nline2\nline3\n');
    child.stdin.end();

    await new Promise((resolve) => child.on('close', resolve));

    const lines = stdout.trim().split('\n');
    assert.equal(lines.length, 3);
  });

  it('shows help with -h', async () => {
    const child = spawn('node', [POLL_BIN, '-h'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });

    await new Promise((resolve) => child.on('close', resolve));

    assert.ok(stdout.includes('poll [options] [file]'));
    assert.ok(stdout.includes('--condition'));
  });

  it('watches file with -f and condition', async () => {
    const f = tmpFile('cli-watch.log');
    writeFileSync(f, '');

    const child = spawn('node', [POLL_BIN, '-f', '-c', '/MATCH/', f], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });

    // Write after CLI starts watching
    await new Promise(r => setTimeout(r, 200));
    appendFileSync(f, 'SKIP this line\n');
    appendFileSync(f, 'MATCH this line\n');
    appendFileSync(f, 'SKIP again\n');

    await new Promise(r => setTimeout(r, 300));
    child.kill();

    await new Promise((resolve) => child.on('close', resolve));

    const lines = stdout.trim().split('\n').filter(l => l.length > 0);
    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes('MATCH'));
    try { unlinkSync(f); } catch {}
  });

  it('skips malformed JSON lines with --json', async () => {
    const child = spawn('node', [POLL_BIN, '--json', '-c', '.ok == true'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });

    child.stdin.write('not json\n');
    child.stdin.write('{"ok": true}\n');
    child.stdin.write('{broken\n');
    child.stdin.write('{"ok": false}\n');
    child.stdin.end();

    await new Promise((resolve) => child.on('close', resolve));

    const lines = stdout.trim().split('\n');
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).ok, true);
  });
});
