// Integration tests for the 1v1 duel server.
//
// Every test starts its own copy of server.js and plays it with two real
// Socket.IO clients, the same way two browsers would. The deck is seeded so
// deals are repeatable, and timers run 20x faster.
//
// Test names start with the requirement they cover (docs/user-stories.md and
// docs/game-design.md). DUEL-... tests began as known bugs and now guard the
// fix; DECISION-... tests pin a rule that was decided after testing. Tests
// marked { todo: 'DUEL-...' } describe what the spec asks for and currently
// fail; they run every time but don't fail the build. See TESTING.md.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer, startMatch, toStrategy, toPlay, autoStand, waitFor, staysQuiet,
  total, isNatural, expectedOutcome
} from '../support/harness.mjs';

const KEYS = ['A', 'B', 'C'];
const T = { timeout: 30_000 };

// Seeds whose deals give the situation a test needs (found by playing them).
const SEED = {
  plain: 2,                 // no Naturals, decided in three hands
  p1NaturalOnA: 14,         // player one is dealt a Natural on Hand A
  tieAfterThree: 1,         // standing on every hand ends level, so Sudden Death follows
  tieWithDoubleOnA: 57,     // still level after player one Doubles Hand A
  bothNaturalsOnAThenTie: 52, // both players are dealt a Natural on Hand A, and the match still ends level
  p1NaturalInSuddenDeath: 97, // the match ends level and player one is dealt a Natural in Sudden Death
  scoringRuns: [2, 3, 4, 5, 7, 8, 9, 10, 11, 13, 15, 16] // varied results, no Naturals
};

let server;
afterEach(async () => {
  if (server) await server.stop();
  server = undefined;
});

/** Plays a whole match by standing on every hand. Resolves with player one's final payload. */
async function playOutStanding(match) {
  autoStand(match.p1, match.roomId);
  autoStand(match.p2, match.roomId);
  return waitFor(match.p1, 'final', () => true, { timeout: 15_000 });
}

/** Hits until this player's current hand is over 21. */
async function hitUntilBust(socket, roomId, handsOf) {
  for (let i = 0; i < 10; i += 1) {
    const cards = handsOf(socket.state);
    if (total(cards) > 21) return;
    const before = cards.length;
    socket.emit('hit', { roomId });
    await waitFor(socket, 'state', (s) => handsOf(s).length > before);
  }
  throw new Error('Never went bust');
}

describe('Matchmaking', () => {
  test('US-1.1a: two players in the queue are paired into the same match', T, async () => {
    server = await startServer({ seed: SEED.plain });
    const match = await startMatch(server);
    assert.ok(match.roomId);
    assert.equal(match.p2RoomId, match.roomId);
  });

  test('US-1.1a: a lone player in the queue is told they are waiting', T, async () => {
    server = await startServer();
    const p1 = server.connect();
    const waiting = waitFor(p1, 'waiting');
    p1.emit('queue_play');
    await waiting;
  });

  test('US-1.1: a friend can join a private match with its code', T, async () => {
    server = await startServer();
    const host = server.connect();
    const friend = server.connect();
    const created = waitFor(host, 'session_created');
    host.emit('create_private_match');
    const { roomId } = await created;

    const starts = Promise.all([waitFor(host, 'match_start'), waitFor(friend, 'match_start')]);
    friend.emit('join_private_match', { roomId });
    const [a, b] = await starts;
    assert.equal(a.roomId, roomId);
    assert.equal(b.roomId, roomId);
  });

  test('US-1.1: an unknown match code is refused with a message', T, async () => {
    server = await startServer();
    const friend = server.connect();
    const error = waitFor(friend, 'error_msg');
    friend.emit('join_private_match', { roomId: 'nope00' });
    assert.match((await error).text, /not found/i);
  });
});

describe('Server authority and fair play', () => {
  test('US-1.2 / US-4.1: each player gets three two-card hands and sees only their own cards', T, async () => {
    server = await startServer({ seed: SEED.plain });
    const match = await startMatch(server);
    await toStrategy(match);

    for (const player of [match.p1, match.p2]) {
      const s = player.state;
      for (const k of KEYS) {
        assert.equal(s.myHands[k].length, 2, `own Hand ${k}`);
        assert.ok(s.myHands[k].every((c) => c.r !== '?'), `own Hand ${k} is visible`);
        assert.ok(s.oppHands[k].every((c) => c.r === '?' && c.s === '?'), `opponent Hand ${k} is masked`);
      }
    }
  });

  test('US-4.1: the two players are dealt different cards from one deck', T, async () => {
    server = await startServer({ seed: SEED.plain });
    const match = await startMatch(server);
    await toStrategy(match);
    const codes = [match.p1, match.p2].flatMap((p) => KEYS.flatMap((k) => p.state.myHands[k].map((c) => c.r + c.s)));
    assert.equal(new Set(codes).size, 12);
  });

  test('US-1.3: a player cannot Hit during the Strategy Phase', T, async () => {
    server = await startServer({ seed: SEED.plain });
    const match = await startMatch(server);
    await toStrategy(match);
    match.p1.emit('hit', { roomId: match.roomId });
    assert.ok(await staysQuiet(match.p1, 'state', (s) => s.myHands.A.length > 2));
  });

  test('DUEL-001 / US-4.1: a Redraw aimed at a card that does not exist is refused', T, async () => {
    server = await startServer({ seed: SEED.plain });
    const match = await startMatch(server);
    await toStrategy(match);
    match.p1.emit('redraw_card', { roomId: match.roomId, handKey: 'A', cardIndex: 5 });
    await waitFor(match.p1, 'state', () => true, { timeout: 1_000 }).catch(() => {});
    assert.equal(match.p1.state.myHands.A.length, 2, 'Hand A grew to three cards: the client added a card');
  });

  test('DUEL-002 / US-4.1: a malformed Redraw does not take the server down', T, async () => {
    server = await startServer({ seed: SEED.plain });
    const match = await startMatch(server);
    await toStrategy(match);
    match.p1.emit('redraw_card', { roomId: match.roomId, handKey: 'Z', cardIndex: 0 });
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(server.exited, false, 'the server process crashed, ending every match on it');
  });
});

describe('Strategy Phase', () => {
  test('US-1.3: Redraw replaces exactly one card, and only once per round', T, async () => {
    server = await startServer({ seed: SEED.plain });
    const match = await startMatch(server);
    await toStrategy(match);
    const [first, second] = match.p1.state.myHands.B;

    match.p1.emit('redraw_card', { roomId: match.roomId, handKey: 'B', cardIndex: 0 });
    const after = await waitFor(match.p1, 'state', (s) => s.redrawUsed);
    assert.notDeepEqual(after.myHands.B[0], first, 'the chosen card changed');
    assert.deepEqual(after.myHands.B[1], second, 'the other card did not');

    const handsAfterFirst = JSON.stringify(after.myHands);
    match.p1.emit('redraw_card', { roomId: match.roomId, handKey: 'C', cardIndex: 1 });
    await staysQuiet(match.p1, 'state', () => true, 400);
    assert.equal(JSON.stringify(match.p1.state.myHands), handsAfterFirst, 'a second Redraw was ignored');
  });

  test('US-1.3: Double can be used on one hand only', T, async () => {
    server = await startServer({ seed: SEED.plain });
    const match = await startMatch(server);
    await toStrategy(match);

    match.p1.emit('double_choice', { roomId: match.roomId, handKey: 'A' });
    const s = await waitFor(match.p1, 'state', (st) => st.doubleTarget === 'A');
    assert.equal(s.doubleAvailable, false);

    match.p1.emit('double_choice', { roomId: match.roomId, handKey: 'C' });
    await staysQuiet(match.p1, 'state', () => true, 400);
    assert.equal(match.p1.state.doubleTarget, 'A', 'a second Double was ignored');
  });

  test('US-1.3: the opponent is told a Double was used, and on which hand', T, async () => {
    server = await startServer({ seed: SEED.plain });
    const match = await startMatch(server);
    await toStrategy(match);
    const cue = waitFor(match.p2, 'cue', (c) => /doubled/i.test(c.text));
    match.p1.emit('double_choice', { roomId: match.roomId, handKey: 'B' });
    assert.match((await cue).text, /Hand B/);
  });

  test('DUEL-003 / US-1.3: Redraw is refused on a hand that has been Doubled', T, async () => {
    server = await startServer({ seed: SEED.plain });
    const match = await startMatch(server);
    await toStrategy(match);
    match.p1.emit('double_choice', { roomId: match.roomId, handKey: 'A' });
    await waitFor(match.p1, 'state', (s) => s.doubleTarget === 'A');
    const before = JSON.stringify(match.p1.state.myHands.A);

    match.p1.emit('redraw_card', { roomId: match.roomId, handKey: 'A', cardIndex: 0 });
    await staysQuiet(match.p1, 'state', () => true, 400);
    assert.equal(JSON.stringify(match.p1.state.myHands.A), before, 'the Doubled hand was Redrawn');
  });

  test('DUEL-014 / GDD-Double: Double is refused on a hand that has been Redrawn', T, async () => {
    server = await startServer({ seed: SEED.plain });
    const match = await startMatch(server);
    await toStrategy(match);
    match.p1.emit('redraw_card', { roomId: match.roomId, handKey: 'B', cardIndex: 0 });
    await waitFor(match.p1, 'state', (s) => s.redrawUsed);

    match.p1.emit('double_choice', { roomId: match.roomId, handKey: 'B' });
    await staysQuiet(match.p1, 'state', () => true, 400);
    assert.equal(match.p1.state.doubleAvailable, true, 'the Redrawn hand was Doubled');
  });

  test('DECISION-1 / US-1.3: the Strategy Phase timer is 20 seconds', T, async () => {
    server = await startServer({ seed: SEED.plain });
    const match = await startMatch(server);
    const timer = waitFor(match.p1, 'redraw_timer');
    await toStrategy(match);
    assert.equal((await timer).total, 20);
  });
});

describe('Scoring', () => {
  test('GDD ruleset / US-1.5a: every hand is scored correctly across a dozen matches', { timeout: 120_000 }, async () => {
    // An independent implementation of the rules (the "oracle") scores each
    // hand from the cards the server reveals at the end, and the server's
    // results have to agree with it, hand by hand and in total.
    for (const seed of SEED.scoringRuns) {
      server = await startServer({ seed });
      const match = await startMatch(server);
      await toStrategy(match);
      await toPlay(match);
      const final = await playOutStanding(match);

      let p1Points = 0;
      let p2Points = 0;
      for (const k of KEYS) {
        const expected = expectedOutcome(final.yourHands[k], final.oppHands[k]);
        assert.equal(final.perHand[k], expected, `seed ${seed}, Hand ${k}`);
        if (expected === 'p1') p1Points += 1;
        if (expected === 'p2') p2Points += 1;
      }
      assert.equal(final.points, p1Points, `seed ${seed}, player one's points`);
      assert.equal(final.oppPoints, p2Points, `seed ${seed}, player two's points`);
      assert.equal(final.result, p1Points > p2Points ? 'win' : 'lose', `seed ${seed}, match result`);
      await server.stop();
      server = undefined;
    }
  });

  test('GDD-Double / US-1.5a: a Doubled hand is dealt one card and is worth 2 points', T, async () => {
    server = await startServer({ seed: SEED.plain });
    const match = await startMatch(server);
    await toStrategy(match);
    match.p1.emit('double_choice', { roomId: match.roomId, handKey: 'A' });
    await waitFor(match.p1, 'state', (s) => s.doubleTarget === 'A');
    await toPlay(match);
    const final = await playOutStanding(match);

    assert.equal(final.yourHands.A.length, 3, 'the Doubled hand took exactly one card');
    let p1Points = 0;
    for (const k of KEYS) {
      if (expectedOutcome(final.yourHands[k], final.oppHands[k]) === 'p1') p1Points += k === 'A' ? 2 : 1;
    }
    assert.equal(final.points, p1Points);
  });

  test('US-1.5c: a dealt Natural Blackjack wins its hand without being played', T, async () => {
    server = await startServer({ seed: SEED.p1NaturalOnA });
    const match = await startMatch(server);
    await toStrategy(match);
    assert.ok(isNatural(match.p1.state.myHands.A));
    assert.deepEqual(match.p2.state.oppHands.A.map((c) => c.r).sort(), match.p1.state.myHands.A.map((c) => c.r).sort(),
      'the Natural is revealed to the opponent');
    await toPlay(match);
    const final = await playOutStanding(match);
    assert.equal(final.perHand.A, 'p1');
  });

  test('DUEL-005 / GDD-Natural: a Natural cannot be Doubled, so the Double stays available', T, async () => {
    server = await startServer({ seed: SEED.p1NaturalOnA });
    const match = await startMatch(server);
    await toStrategy(match);
    match.p1.emit('double_choice', { roomId: match.roomId, handKey: 'A' });
    await staysQuiet(match.p1, 'state', () => true, 400);
    // The Natural was already scored at the deal, so a Double on it does nothing,
    // but the server still accepts it and the player loses their Double.
    assert.equal(match.p1.state.doubleAvailable, true, 'the Double was spent on a hand it cannot affect');
  });
});

describe('Hidden bust', () => {
  test('DUEL-006 / GDD-Hidden Bust / US-1.4: a bust is kept from the opponent and the player can keep hitting', { ...T, todo: 'DUEL-006' }, async () => {
    server = await startServer({ seed: SEED.plain });
    const match = await startMatch(server);
    await toStrategy(match);
    await toPlay(match);
    const key = match.p1.state.activeHand;

    await hitUntilBust(match.p1, match.roomId, (s) => s.myHands[key]);

    const told = !(await staysQuiet(match.p2, 'cue', (c) => /bust/i.test(c.text), 500)) ||
      match.p2.received.some((r) => r.event === 'cue' && /bust/i.test(r.payload.text));
    assert.equal(told, false, 'the opponent was told about the bust');
    assert.equal(match.p1.state.myFinished[key], false, 'the busted player\'s turn was ended for them');
  });
});

describe('Sudden Death', () => {
  async function reachSuddenDeath({ seed = SEED.tieAfterThree, beforePlay } = {}) {
    server = await startServer({ seed });
    const match = await startMatch(server);
    await toStrategy(match);
    if (beforePlay) await beforePlay(match);
    await toPlay(match);
    const stopP1 = autoStand(match.p1, match.roomId);
    const stopP2 = autoStand(match.p2, match.roomId);
    const inSuddenDeath = (s) => s.mode === 'sudden' && s.stage === 'strategy';
    await Promise.all([
      waitFor(match.p1, 'state', inSuddenDeath, { timeout: 15_000, includePast: true }),
      waitFor(match.p2, 'state', inSuddenDeath, { timeout: 15_000, includePast: true })
    ]);
    stopP1();
    stopP2();
    return match;
  }

  test('US-1.5d: a tie after three hands deals each player one fresh Sudden Death hand', T, async () => {
    const match = await reachSuddenDeath();
    for (const p of [match.p1, match.p2]) {
      assert.equal(p.state.myHands.A.length, 2);
      assert.deepEqual(Object.keys(p.state.myHands), ['A']);
    }
  });

  test('US-1.5d: Double is disabled in Sudden Death', T, async () => {
    const match = await reachSuddenDeath();
    assert.equal(match.p1.state.doubleAvailable, false);
    assert.equal(match.p2.state.doubleAvailable, false);
  });

  test('DUEL-012 / US-1.5d: a Double from the main round does not carry into Sudden Death', T, async () => {
    const match = await reachSuddenDeath({
      seed: SEED.tieWithDoubleOnA,
      beforePlay: async (m) => {
        m.p1.emit('double_choice', { roomId: m.roomId, handKey: 'A' });
        await waitFor(m.p1, 'state', (s) => s.doubleTarget === 'A');
      }
    });
    await toPlay(match);
    await staysQuiet(match.p1, 'state', () => true, 400);
    assert.equal(match.p1.state.myHands.A.length, 2, 'the Sudden Death hand was dealt a Double card');
    assert.equal(match.p1.state.myFinished.A, false, 'the Sudden Death hand was locked before it was played');
  });

  test('DUEL-013 / US-4.1: the opponent\'s Sudden Death hand stays hidden, even after a Natural in the main round', T, async () => {
    const match = await reachSuddenDeath({ seed: SEED.bothNaturalsOnAThenTie });
    for (const p of [match.p1, match.p2]) {
      assert.ok(p.state.oppHands.A.every((c) => c.r === '?'), 'the opponent\'s Sudden Death cards were sent face up');
    }
  });

  test('DECISION-3 / GDD-Natural: a Natural dealt in Sudden Death wins the match outright', T, async () => {
    server = await startServer({ seed: SEED.p1NaturalInSuddenDeath });
    const match = await startMatch(server);
    await toStrategy(match);
    await toPlay(match);
    autoStand(match.p1, match.roomId);
    autoStand(match.p2, match.roomId);
    const final = await waitFor(match.p1, 'final', () => true, { timeout: 15_000 });
    assert.equal(final.bySuddenDeath, true);
    assert.ok(isNatural(final.yourHands.A), 'player one held the Natural');
    assert.equal(final.yourHands.A.length, 2, 'the Natural was never played');
    assert.equal(final.result, 'win');
  });

  test('DECISION-2 / US-1.5d: Redraw stays available in Sudden Death, so it is not a coin flip', T, async () => {
    const match = await reachSuddenDeath();
    const before = match.p1.state.myHands.A.map((c) => c.r + c.s);
    match.p1.emit('redraw_card', { roomId: match.roomId, handKey: 'A', cardIndex: 0 });
    const after = await waitFor(match.p1, 'state', (s) => s.redrawUsed);
    assert.notEqual(after.myHands.A[0].r + after.myHands.A[0].s, before[0], 'the first card was replaced');
    assert.equal(after.myHands.A[1].r + after.myHands.A[1].s, before[1], 'the second card was kept');
  });

  test('DUEL-008 / GDD-Sudden Death: a tied Sudden Death hand is replayed until there is a winner', T, async () => {
    const match = await reachSuddenDeath();
    await toPlay(match);
    // Both players bust, which ties the hand.
    await hitUntilBust(match.p1, match.roomId, (s) => s.myHands.A);
    await hitUntilBust(match.p2, match.roomId, (s) => s.myHands.A);
    await waitFor(match.p1, 'state', (s) => s.tiePending, { includePast: true });
    // Reaching here proves the tie was detected; the gap is what happens next.

    // This is what the game page sends when a player continues from the tie.
    match.p1.emit('next_sudden_round', { roomId: match.roomId });
    match.p2.emit('next_sudden_round', { roomId: match.roomId });
    await waitFor(match.p1, 'state', (s) => !s.tiePending && s.stage === 'strategy', { timeout: 3_000 });
  });
});

describe('Timers and disconnections', () => {
  test('US-2.1: the remaining player is told when their opponent disconnects', T, async () => {
    server = await startServer({ seed: SEED.plain });
    const match = await startMatch(server);
    await toStrategy(match);
    const left = waitFor(match.p2, 'opponent_left');
    match.p1.disconnect();
    await left;
  });

  test('DUEL-009 / US-2.1: a disconnected player gets 30 seconds to reconnect before a forfeit', { ...T, todo: 'DUEL-009' }, async () => {
    server = await startServer({ seed: SEED.plain });
    const match = await startMatch(server);
    await toStrategy(match);
    match.p1.disconnect();
    assert.ok(await staysQuiet(match.p2, 'opponent_left', () => true, 300), 'the match ended immediately, with no reconnection window');
  });

  test('DUEL-010 / US-1.4: a hand auto-stands when its 30-second timer runs out', { ...T, todo: 'DUEL-010' }, async () => {
    server = await startServer({ seed: SEED.plain });
    const match = await startMatch(server);
    await toStrategy(match);
    await toPlay(match);
    const key = match.p1.state.activeHand;
    // 30 seconds of game time is 1.5 seconds here. Nobody acts.
    await waitFor(match.p1, 'state', (s) => s.myFinished[key], { timeout: 4_000 });
  });
});
