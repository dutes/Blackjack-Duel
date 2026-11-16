// Loaded into the server process with `node --import` during tests only.
// It leaves the game code untouched and makes two things controllable:
//
//   TEST_SEED        replaces Math.random with a seeded generator, so the
//                    shuffle (and therefore every deal) is repeatable.
//   TEST_TIME_SCALE  divides every timer delay, so a 20-second Strategy Phase
//                    takes 2 seconds at a scale of 10. Order of events is unchanged.

const seed = process.env.TEST_SEED;
if (seed !== undefined) {
  let a = Number(seed) >>> 0;
  // mulberry32: small, fast, and good enough for shuffling a deck.
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const scale = Number(process.env.TEST_TIME_SCALE || 1);
if (scale > 1) {
  const realTimeout = globalThis.setTimeout;
  const realInterval = globalThis.setInterval;
  globalThis.setTimeout = (fn, ms = 0, ...args) => realTimeout(fn, ms / scale, ...args);
  globalThis.setInterval = (fn, ms = 0, ...args) => realInterval(fn, ms / scale, ...args);
}
