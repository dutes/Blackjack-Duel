// Pure game rules for King of the Hill.
//
// Everything here is free of the DOM, timers and network calls, so it runs the
// same in the browser (imported by app.js) and in Node (imported by the tests).
// The functions describe the game as it currently behaves. Where that differs
// from the design spec, the tests record it as a known issue rather than
// silently changing the game.

const FACE_CARDS = ['KING', 'QUEEN', 'JACK'];

/** Points for a single card in the Deck of Cards API format ({ value: 'ACE' | 'KING' | '7' ... }). */
export function cardPoints(card) {
  if (card.value === 'ACE') return 11;
  if (FACE_CARDS.includes(card.value)) return 10;
  return Number(card.value);
}

/** Best Blackjack total for a hand: aces count 11, dropping to 1 one at a time while the hand is over 21. */
export function calculateHandValue(hand) {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    total += cardPoints(card);
    if (card.value === 'ACE') aces += 1;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

/**
 * Checks both opening hands for 21 before play starts.
 * Returns 'draw' if both have 21, 'win' or 'lose' if only one does, or null to play the hand normally.
 */
export function resolveOpening(playerHand, opponentHand) {
  const player21 = calculateHandValue(playerHand) === 21;
  const opponent21 = calculateHandValue(opponentHand) === 21;
  if (player21 && opponent21) return 'draw';
  if (player21) return 'win';
  if (opponent21) return 'lose';
  return null;
}

/**
 * Settles a hand once both sides are finished.
 * Returns { result: 'win' | 'lose' | 'draw', reason } where reason says which rule decided it.
 */
export function settleHand(playerTotal, opponentTotal) {
  const playerBust = playerTotal > 21;
  const opponentBust = opponentTotal > 21;
  if (playerBust && opponentBust) return { result: 'draw', reason: 'double-bust' };
  if (playerBust) return { result: 'lose', reason: 'player-bust' };
  if (opponentBust) return { result: 'win', reason: 'opponent-bust' };
  if (playerTotal > opponentTotal) return { result: 'win', reason: 'higher-total' };
  if (playerTotal < opponentTotal) return { result: 'lose', reason: 'lower-total' };
  return { result: 'draw', reason: 'push' };
}

/** A bot keeps hitting while its total is below its personality's threshold. */
export function botShouldHit(total, hitThreshold) {
  return total < hitThreshold;
}

/** Hands per match grows with the bracket: 8 players gives 3 hands. */
export function handsPerMatch(totalPlayers) {
  return Math.max(1, Math.ceil(Math.log2(totalPlayers)));
}

/** Players left after winning a round, never fewer than the final two. */
export function nextPlayersRemaining(playersRemaining) {
  return Math.max(2, Math.floor(playersRemaining / 2));
}

/**
 * Records a finished hand. A doubled hand scores 2 points.
 * Returns the updated match counters; the input is not changed.
 */
export function applyHandResult(match, result, doubled) {
  const points = doubled ? 2 : 1;
  const next = {
    wins: match.wins,
    losses: match.losses,
    draws: match.draws,
    handsPlayed: match.handsPlayed + points,
    handResults: [...match.handResults, ...Array(points).fill(result)]
  };
  if (result === 'win') next.wins += points;
  else if (result === 'lose') next.losses += points;
  else if (result === 'draw') next.draws += 1;
  return next;
}

/** Which of the dealt hands (0 = A, 1 = B, 2 = C) is played next. */
export function currentHandIndex(match) {
  return match.handsPlayed;
}

/**
 * Decides whether the match is over.
 * Returns { type: 'champion' | 'advance' | 'eliminated' | 'tiebreak' | 'continue', ... }.
 */
export function determineMatchResolution(match) {
  const remainingHands = match.handsPerMatch - match.handsPlayed;
  // An unused Double is worth one extra point to the player.
  const remainingPoints = remainingHands + (match.doubleUsedInMatch ? 0 : 1);
  const isFinalRound = match.playersRemaining <= 2;
  const maxHandsReached = match.handsPlayed >= match.handsPerMatch;

  const advanceResult = () => (isFinalRound
    ? { type: 'champion' }
    : { type: 'advance', nextPlayersRemaining: nextPlayersRemaining(match.playersRemaining) });

  if (match.wins > match.losses + remainingPoints) return advanceResult();
  if (match.losses > match.wins + remainingPoints) return { type: 'eliminated', isFinalRound };

  if (maxHandsReached) {
    if (match.wins > match.losses) return advanceResult();
    if (match.losses > match.wins) return { type: 'eliminated', isFinalRound };
    return { type: 'tiebreak' };
  }
  return { type: 'continue' };
}
