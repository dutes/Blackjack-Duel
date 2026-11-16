// Unit tests for the King of the Hill rules engine.
//
// Each test name starts with the requirement it covers:
//   GDD-...  the ruleset in docs/game-design.md
//   US-...   the acceptance criteria in docs/user-stories.md
//   KOTH-... behaviour specific to the tournament prototype
// Tests marked { todo: 'BUG-...' } describe what the spec says should happen
// and currently fail. They run on every build but don't fail it, so the bug
// stays visible until it's fixed. See TESTING.md for the findings log.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  cardPoints,
  calculateHandValue,
  resolveOpening,
  settleHand,
  botShouldHit,
  handsPerMatch,
  nextPlayersRemaining,
  applyHandResult,
  currentHandIndex,
  determineMatchResolution
} from '../../public/rules.mjs';

// Builds a hand from short codes: 'A', 'K', 'Q', 'J', '10', '2' ... '9'.
const NAMES = { A: 'ACE', K: 'KING', Q: 'QUEEN', J: 'JACK' };
const hand = (...codes) => codes.map((c) => ({ value: NAMES[c] ?? c }));

// A fresh three-hand match in the opening round of an 8-player bracket.
const newMatch = (overrides = {}) => ({
  wins: 0,
  losses: 0,
  draws: 0,
  handsPlayed: 0,
  handResults: [],
  handsPerMatch: 3,
  doubleUsedInMatch: false,
  playersRemaining: 8,
  ...overrides
});

describe('Card and hand values', () => {
  test('GDD-Hand: number cards score their face value', () => {
    for (let n = 2; n <= 10; n += 1) {
      assert.equal(cardPoints({ value: String(n) }), n);
    }
  });

  test('GDD-Hand: kings, queens and jacks score 10', () => {
    assert.equal(calculateHandValue(hand('K', 'Q')), 20);
    assert.equal(calculateHandValue(hand('J', '5')), 15);
  });

  test('GDD-Hand: an ace counts 11 when that does not bust the hand', () => {
    assert.equal(calculateHandValue(hand('A', '6')), 17);
  });

  test('GDD-Hand: an ace drops to 1 to avoid a bust', () => {
    assert.equal(calculateHandValue(hand('A', '6', '9')), 16);
  });

  test('GDD-Hand: two aces make 12, not 22', () => {
    assert.equal(calculateHandValue(hand('A', 'A')), 12);
  });

  test('GDD-Hand: only as many aces drop as needed', () => {
    assert.equal(calculateHandValue(hand('A', 'A', '9')), 21);
    assert.equal(calculateHandValue(hand('A', 'A', 'A', 'A', '7')), 21);
  });

  test('GDD-Hand: a hand over 21 with no aces stays bust', () => {
    assert.equal(calculateHandValue(hand('K', 'Q', '5')), 25);
  });

  test('GDD-Hand: an empty hand is worth 0', () => {
    assert.equal(calculateHandValue([]), 0);
  });
});

describe('Opening hands (Natural Blackjack)', () => {
  test('GDD-Natural / US-1.5c: a player Natural is an automatic win', () => {
    assert.equal(resolveOpening(hand('A', 'K'), hand('9', '7')), 'win');
  });

  test('GDD-Natural / US-1.5c: an opponent Natural is an automatic loss', () => {
    assert.equal(resolveOpening(hand('8', '8'), hand('Q', 'A')), 'lose');
  });

  test('GDD-Natural / US-1.5c: Naturals on both sides are a push', () => {
    assert.equal(resolveOpening(hand('A', '10'), hand('J', 'A')), 'draw');
  });

  test('GDD-Natural: any ten-value card makes a Natural with an ace', () => {
    for (const ten of ['10', 'J', 'Q', 'K']) {
      assert.equal(resolveOpening(hand('A', ten), hand('5', '5')), 'win', `A + ${ten}`);
    }
  });

  test('US-1.5c: hands without a Natural go on to be played', () => {
    assert.equal(resolveOpening(hand('10', '9'), hand('K', '7')), null);
  });
});

describe('Settling a hand', () => {
  test('GDD-Win: the higher total wins', () => {
    assert.deepEqual(settleHand(20, 18), { result: 'win', reason: 'higher-total' });
  });

  test('GDD-Loss: the lower total loses', () => {
    assert.deepEqual(settleHand(17, 19), { result: 'lose', reason: 'lower-total' });
  });

  test('GDD-Push: equal totals are a push', () => {
    assert.deepEqual(settleHand(19, 19), { result: 'draw', reason: 'push' });
  });

  test('GDD-Win: the player wins if only the opponent busts', () => {
    assert.deepEqual(settleHand(12, 24), { result: 'win', reason: 'opponent-bust' });
  });

  test('GDD-Loss: the player loses if only the player busts', () => {
    assert.deepEqual(settleHand(23, 12), { result: 'lose', reason: 'player-bust' });
  });

  test('GDD-Loss: a bust loses even when the busted total is "higher"', () => {
    assert.equal(settleHand(26, 20).result, 'lose');
  });

  test('SPEC-GAP-001: when both players bust, the hand is a push', () => {
    // The spec doesn't say what happens here. This pins the prototype's choice
    // so a change to it is deliberate. See TESTING.md.
    assert.deepEqual(settleHand(24, 22), { result: 'draw', reason: 'double-bust' });
  });

  test('GDD-Win: 21 is a valid winning total, 22 is a bust', () => {
    assert.equal(settleHand(21, 20).result, 'win');
    assert.equal(settleHand(22, 20).result, 'lose');
  });
});

describe('Bot opponents', () => {
  // Thresholds from the personalities in public/app.js.
  const personalities = { 'Risky Rick': 18, 'Steely Stella': 17, 'The Shark': 16 };

  for (const [name, threshold] of Object.entries(personalities)) {
    test(`KOTH-Bot: ${name} hits on ${threshold - 1} and stands on ${threshold}`, () => {
      assert.equal(botShouldHit(threshold - 1, threshold), true);
      assert.equal(botShouldHit(threshold, threshold), false);
      assert.equal(botShouldHit(threshold + 1, threshold), false);
    });
  }

  test('KOTH-Bot: a bot never hits a bust hand', () => {
    assert.equal(botShouldHit(22, 18), false);
  });
});

describe('Tournament structure', () => {
  test('KOTH-Bracket: an 8-player tournament plays best-of-three matches', () => {
    assert.equal(handsPerMatch(8), 3);
  });

  test('KOTH-Bracket: match length grows with the bracket', () => {
    assert.equal(handsPerMatch(2), 1);
    assert.equal(handsPerMatch(16), 4);
  });

  test('KOTH-Bracket: winning a round halves the field: 8, 4, then the final 2', () => {
    assert.equal(nextPlayersRemaining(8), 4);
    assert.equal(nextPlayersRemaining(4), 2);
  });

  test('KOTH-Bracket: the field never drops below the final two', () => {
    assert.equal(nextPlayersRemaining(3), 2);
    assert.equal(nextPlayersRemaining(2), 2);
  });
});

describe('Scoring a hand', () => {
  test('US-1.5a: a win scores 1 point', () => {
    const after = applyHandResult(newMatch(), 'win', false);
    assert.equal(after.wins, 1);
    assert.equal(after.losses, 0);
  });

  test('GDD-Double / US-1.5a: a Doubled win scores 2 points', () => {
    assert.equal(applyHandResult(newMatch(), 'win', true).wins, 2);
  });

  test('GDD-Double: a Doubled loss gives the opponent 2 points', () => {
    assert.equal(applyHandResult(newMatch(), 'lose', true).losses, 2);
  });

  test('US-1.5a: a push scores nothing for either side', () => {
    const after = applyHandResult(newMatch(), 'draw', false);
    assert.equal(after.wins, 0);
    assert.equal(after.losses, 0);
    assert.equal(after.draws, 1);
  });

  test('US-1.5a: the scoreboard records one entry per point', () => {
    assert.deepEqual(applyHandResult(newMatch(), 'win', true).handResults, ['win', 'win']);
  });

  test('applyHandResult does not change the match it is given', () => {
    const before = newMatch();
    applyHandResult(before, 'win', true);
    assert.deepEqual(before, newMatch());
  });
});

describe('Deciding a match', () => {
  test('US-1.5a: after one hand at 1-0, the match continues', () => {
    const match = { ...newMatch(), ...applyHandResult(newMatch(), 'win', false) };
    assert.equal(determineMatchResolution(match).type, 'continue');
  });

  test('GDD-Round: a 2-1 lead after three hands wins the match', () => {
    const match = newMatch({ wins: 2, losses: 1, handsPlayed: 3, doubleUsedInMatch: true });
    assert.deepEqual(determineMatchResolution(match), { type: 'advance', nextPlayersRemaining: 4 });
  });

  test('GDD-Round: a 1-2 deficit after three hands is elimination', () => {
    const match = newMatch({ wins: 1, losses: 2, handsPlayed: 3, doubleUsedInMatch: true });
    assert.deepEqual(determineMatchResolution(match), { type: 'eliminated', isFinalRound: false });
  });

  test('GDD-Sudden Death / US-1.5d: a tie after three hands goes to a tiebreak', () => {
    const match = newMatch({ wins: 1, losses: 1, draws: 1, handsPlayed: 3, doubleUsedInMatch: true });
    assert.equal(determineMatchResolution(match).type, 'tiebreak');
  });

  test('KOTH-Bracket: winning the final makes you champion', () => {
    const match = newMatch({ wins: 2, losses: 1, handsPlayed: 3, doubleUsedInMatch: true, playersRemaining: 2 });
    assert.deepEqual(determineMatchResolution(match), { type: 'champion' });
  });

  test('KOTH-Bracket: losing the final is flagged as the final round', () => {
    const match = newMatch({ wins: 0, losses: 2, handsPlayed: 3, doubleUsedInMatch: true, playersRemaining: 2 });
    assert.deepEqual(determineMatchResolution(match), { type: 'eliminated', isFinalRound: true });
  });

  test('KOTH-Early finish: a lead the opponent cannot catch ends the match early', () => {
    // 2-0 after two hands with the Double spent: one point left, so 2-0 can't be caught.
    const match = newMatch({ wins: 2, losses: 0, handsPlayed: 2, doubleUsedInMatch: true });
    assert.equal(determineMatchResolution(match).type, 'advance');
  });

  test('KOTH-Early finish: an unused Double keeps a trailing player alive', () => {
    // 0-2 after two hands, Double still available: the last hand is worth 2, so 2-2 is possible.
    const match = newMatch({ wins: 0, losses: 2, handsPlayed: 2, doubleUsedInMatch: false });
    assert.equal(determineMatchResolution(match).type, 'continue');
  });
});

describe('Known issues: Doubled hands', () => {
  // The prototype counts a Doubled hand as two hands played, because it uses
  // the same counter for points and for hands. These tests describe the spec.

  test('BUG-001 / GDD-Core loop: after a Doubled Hand A, the next hand played is Hand B', { todo: 'BUG-001' }, () => {
    const afterHandA = applyHandResult(newMatch(), 'win', true);
    assert.equal(currentHandIndex(afterHandA), 1, 'expected Hand B (index 1), but Hand B is skipped');
  });

  test('BUG-002 / GDD-Round: losing a Doubled Hand A does not end the match', { todo: 'BUG-002' }, () => {
    // 0-2 with Hands B and C still to play: winning both makes it 2-2, which goes to Sudden Death.
    const match = { ...newMatch(), ...applyHandResult(newMatch(), 'lose', true), doubleUsedInMatch: true };
    assert.equal(determineMatchResolution(match).type, 'continue');
  });

  test('BUG-003 / GDD-Round: Hand C is still played after a Doubled Hand B', { todo: 'BUG-003' }, () => {
    // 1-0 after Hand A, then a Doubled loss on Hand B makes it 1-2. Winning Hand C ties it 2-2.
    const afterA = { ...newMatch(), ...applyHandResult(newMatch(), 'win', false) };
    const afterB = { ...afterA, ...applyHandResult(afterA, 'lose', true), doubleUsedInMatch: true };
    assert.equal(determineMatchResolution(afterB).type, 'continue');
  });
});
