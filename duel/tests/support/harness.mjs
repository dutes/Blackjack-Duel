// Test harness: starts a real duel server and drives it with real Socket.IO clients,
// exactly as two browsers would. Nothing in server.js is mocked.

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { io } from 'socket.io-client';

const duelDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Starts server.js in its own process. Each test gets a fresh server, so a
 * crash or a stuck match in one test can't leak into another.
 */
export async function startServer({ seed, timeScale = 20 } = {}) {
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), TEST_TIME_SCALE: String(timeScale) };
  if (seed !== undefined) env.TEST_SEED = String(seed);

  const proc = spawn(process.execPath, ['--import', './tests/support/test-runtime.mjs', 'server.js'], {
    cwd: duelDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  proc.stdout.on('data', (d) => { output += d; });
  proc.stderr.on('data', (d) => { output += d; });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not start:\n${output}`)), 10_000);
    proc.stdout.on('data', () => {
      if (output.includes(`localhost:${port}`)) { clearTimeout(timer); resolve(); }
    });
    proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`Server exited (${code}):\n${output}`)); });
  });

  const url = `http://localhost:${port}`;
  const clients = [];
  return {
    url,
    get output() { return output; },
    get exited() { return proc.exitCode !== null; },
    connect() {
      const socket = connect(url);
      clients.push(socket);
      return socket;
    },
    async stop() {
      clients.forEach((c) => c.disconnect());
      if (proc.exitCode === null) {
        proc.kill();
        await new Promise((r) => proc.once('exit', r));
      }
    }
  };
}

/** A Socket.IO client that remembers the latest game state and every event it receives. */
function connect(url) {
  const socket = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  socket.state = null;
  socket.received = [];
  socket.onAny((event, payload) => {
    socket.received.push({ event, payload });
    if (event === 'state') socket.state = payload;
  });
  return socket;
}

/**
 * Resolves with the payload of the next `event` matching `predicate`.
 * Events that already arrived count too, if `includePast` is set.
 */
export function waitFor(socket, event, predicate = () => true, { timeout = 8_000, includePast = false } = {}) {
  if (includePast) {
    const hit = socket.received.find((r) => r.event === event && predicate(r.payload));
    if (hit) return Promise.resolve(hit.payload);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for "${event}"`));
    }, timeout);
    const handler = (payload) => {
      if (predicate(payload)) {
        clearTimeout(timer);
        socket.off(event, handler);
        resolve(payload);
      }
    };
    socket.on(event, handler);
  });
}

/** True if no matching event arrives within `ms`. */
export async function staysQuiet(socket, event, predicate = () => true, ms = 500) {
  try {
    await waitFor(socket, event, predicate, { timeout: ms });
    return false;
  } catch {
    return true;
  }
}

/** Puts two players into a match through the public queue. p1 queues first. */
export async function startMatch(server) {
  const p1 = server.connect();
  const p2 = server.connect();
  await Promise.all([waitFor(p1, 'connect'), waitFor(p2, 'connect')]).catch(() => {});
  const p1Waiting = waitFor(p1, 'waiting');
  p1.emit('queue_play');
  await p1Waiting;
  const starts = Promise.all([waitFor(p1, 'match_start'), waitFor(p2, 'match_start')]);
  p2.emit('queue_play');
  const [m1, m2] = await starts;
  return { p1, p2, roomId: m1.roomId, p2RoomId: m2.roomId };
}

/** Both players dismiss the rules briefing; resolves once the Strategy Phase has begun. */
export async function toStrategy({ p1, p2, roomId }) {
  const ready = Promise.all([
    waitFor(p1, 'state', (s) => s.stage === 'strategy'),
    waitFor(p2, 'state', (s) => s.stage === 'strategy')
  ]);
  p1.emit('dismiss_briefing', { roomId });
  p2.emit('dismiss_briefing', { roomId });
  await ready;
}

/** Both players lock in their strategy; resolves once play has started. */
export async function toPlay({ p1, p2, roomId }) {
  const playing = Promise.all([
    waitFor(p1, 'state', (s) => s.stage === 'play'),
    waitFor(p2, 'state', (s) => s.stage === 'play')
  ]);
  p1.emit('start_play', { roomId });
  p2.emit('start_play', { roomId });
  await playing;
}

/**
 * Plays every hand by standing as soon as it's this player's turn.
 * Returns a function that stops the auto-play.
 */
export function autoStand(socket, roomId) {
  const handler = (s) => {
    if (s.stage !== 'play') return;
    const key = s.mode === 'sudden' ? 'A' : s.activeHand;
    if (key && !s.myFinished?.[key]) socket.emit('stand', { roomId });
  };
  socket.on('state', handler);
  if (socket.state) handler(socket.state);
  return () => socket.off('state', handler);
}

/* ---------- An independent implementation of the spec, used as an oracle ---------- */

const rankValue = (r) => (r === 'A' ? 11 : ['J', 'Q', 'K'].includes(r) ? 10 : Number(r));

export function total(cards) {
  let sum = 0;
  let aces = 0;
  for (const c of cards) {
    sum += rankValue(c.r);
    if (c.r === 'A') aces += 1;
  }
  while (sum > 21 && aces > 0) { sum -= 10; aces -= 1; }
  return sum;
}

export const isNatural = (cards) =>
  cards.length === 2 && cards.some((c) => c.r === 'A') && cards.some((c) => ['10', 'J', 'Q', 'K'].includes(c.r));

/** Who should win a hand under the ruleset: 'p1', 'p2' or 'tie'. */
export function expectedOutcome(mine, theirs) {
  const n1 = isNatural(mine);
  const n2 = isNatural(theirs);
  if (n1 || n2) return n1 && n2 ? 'tie' : n1 ? 'p1' : 'p2';
  const a = total(mine);
  const b = total(theirs);
  if (a > 21 && b > 21) return 'tie';
  if (a > 21) return 'p2';
  if (b > 21) return 'p1';
  return a > b ? 'p1' : b > a ? 'p2' : 'tie';
}
