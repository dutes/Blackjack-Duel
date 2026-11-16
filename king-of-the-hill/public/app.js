import * as Rules from './rules.mjs';

const overlay = document.getElementById('overlay');
const overlayMessage = document.getElementById('overlayMessage');
const startButton = document.getElementById('startButton');
const opponentNameEl = document.getElementById('opponentName');
const opponentCardsEl = document.getElementById('opponentCards');
const opponentTotalEl = document.getElementById('opponentTotal');
const opponentTotalLabelEl = document.getElementById('opponentTotalLabel');
const opponentStatusEl = document.getElementById('opponentStatus');
const opponentIndicatorEl = document.getElementById('opponentIndicator');
const playerCardsEl = document.getElementById('playerCards');
const playerTotalEl = document.getElementById('playerTotal');
const playerStatusEl = document.getElementById('playerStatus');
const opponentScoreboardEl = document.getElementById('opponentScoreboard');
const playerScoreboardEl = document.getElementById('playerScoreboard');
const levelIndicatorEl = document.getElementById('levelIndicator');
const tournamentStatusEl = document.getElementById('tournamentStatus');
const handIndicatorEl = document.getElementById('handIndicator');
const hitButton = document.getElementById('hitButton');
const standButton = document.getElementById('standButton');
const doubleButton = document.getElementById('doubleButton');
const controlsContainer = document.querySelector('.controls');
const toastContainer = document.getElementById('toastContainer');
const loadingOverlay = document.getElementById('loadingOverlay');

const isDebugMode = window.location.pathname.startsWith('/debug') || window.location.search.includes('debug');

const debugPanelEl = document.getElementById('debugPanel');
const debugLogsEl = document.getElementById('debugLogs');
if (isDebugMode && debugPanelEl) {
  debugPanelEl.classList.remove('hidden');
}

function debugLog(event, payload) {
  if (isDebugMode) {
    console.log(`[DEBUG] ${event}`, payload ? JSON.parse(JSON.stringify(payload)) : '');

    if (debugLogsEl) {
      const entryEl = document.createElement('div');
      entryEl.className = 'debug-log-entry';

      const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

      const headerEl = document.createElement('div');
      headerEl.innerHTML = `<span class="debug-log-time">[${time}]</span><span class="debug-log-event">${event}</span>`;
      entryEl.appendChild(headerEl);

      if (payload) {
        const payloadEl = document.createElement('div');
        payloadEl.className = 'debug-log-payload';
        // Strip out some excess verbosity for the UI
        const cleanPayload = JSON.parse(JSON.stringify(payload));
        if (cleanPayload.state && cleanPayload.state.deckId) {
          delete cleanPayload.state.deckId;
        }
        payloadEl.textContent = JSON.stringify(cleanPayload, null, 2);
        entryEl.appendChild(payloadEl);
      }

      debugLogsEl.appendChild(entryEl);
      debugLogsEl.scrollTop = debugLogsEl.scrollHeight;
    }
  }
}

let overlayAction = null;

const CARD_BACK = 'https://deckofcardsapi.com/static/img/back.png';

const personalities = [
  {
    name: 'Risky Rick',
    difficulty: 'Easy',
    hitThreshold: 18,
    thinkingMessages: ["Let's go!", "One more can't hurt...", "Fortune favors the bold!", "I'm feeling lucky tonight!"],
    actionMessages: ["Hitting! I need some heat!", "Give me another one!", "Spinning the wheel!"],
    winMessages: ["I knew it! Risk paid off!", "Boom! That's how we do it!", "Easy money!"],
    lossMessages: ["Ah, busted again!", "Story of my life...", "The cards are rigged!"],
    doubleReactions: ["Oh, doubling down? Brave!", "Twice the fun, twice the loss!", "Go big or go home, right?"]
  },
  {
    name: 'Steely Stella',
    difficulty: 'Medium',
    hitThreshold: 17,
    thinkingMessages: ["Playing by the book.", "Staying focused.", "Analyzing the odds.", "Efficiency is key."],
    actionMessages: ["Hitting as per strategy.", "Taking another card.", "The probability suggests a hit."],
    winMessages: ["Strategy executed successfully.", "A calculated victory.", "Good game."],
    lossMessages: ["Variance happens.", "The math didn't favor me this time.", "Acceptable loss."],
    doubleReactions: ["Increasing the stakes. Acknowledged.", "Calculating the new risk parameters.", "Bold move, but is it the right one?"]
  },
  {
    name: 'The Shark',
    difficulty: 'Hard',
    hitThreshold: 16,
    thinkingMessages: ["Amateur moves everywhere.", "Checked and mated.", "You're already beat.", "I see through your plays."],
    actionMessages: ["Expanding my lead.", "Securing the win.", "Watch a pro at work."],
    winMessages: ["I never lose.", "As expected.", "Try again when you've practiced."],
    lossMessages: ["Impossible.", "A statistical anomaly.", "You got lucky. This won't happen again."],
    doubleReactions: ["Doubling into my trap? Classic.", "Donate your points to me then.", "Pressure doesn't work on a Shark."]
  }
];

const opponentNames = personalities.map(p => p.name);

const state = {
  stage: 'lobby',
  totalPlayers: 8,
  playersRemaining: 8,
  round: 1,
  wins: 0,
  losses: 0,
  handsPlayed: 0,
  draws: 0,
  deckId: null,
  playerHand: [],
  opponentHand: [],
  playerHands: [], // Array of 3 hands
  opponentHands: [], // Array of 3 hands
  opponentName: 'Opponent',
  opponentPersonality: null,
  playerStood: false,
  doubleDown: false,
  doubleUsedInMatch: false,
  revealOpponent: false,
  opponentPlaying: false,
  opponentDecisionComplete: false,
  playerBusted: false,
  roundActive: false,
  message: '',
  handsPerMatch: 3,
  handResults: [],
  redrawUsed: false,
  selectedRedrawCard: null // { handIndex, cardIndex }
};

startButton.addEventListener('click', async () => {
  if (startButton.disabled || !overlayAction) {
    return;
  }

  startButton.disabled = true;
  await overlayAction();
});

hitButton.addEventListener('click', () => takePlayerAction('hit'));
standButton.addEventListener('click', () => takePlayerAction('stand'));
doubleButton.addEventListener('click', () => takePlayerAction('double'));

async function beginTournament() {
  debugLog('Tournament Started', { totalPlayers: state.totalPlayers });
  state.stage = 'waiting';
  await showOverlaySequence([
    'Waiting for opponents…',
    'Opponents connected. Shuffling brackets…',
    'Opponent being drawn…'
  ]);
  hideOverlay();
  state.round = 1;
  state.playersRemaining = state.totalPlayers;
  state.wins = 0;
  state.losses = 0;
  state.draws = 0;
  state.handsPerMatch = Rules.handsPerMatch(state.totalPlayers);
  await setupNextMatch(true);
}

async function setupNextMatch(isFirst = false) {
  debugLog('Setup Next Match', { isFirst, round: state.round, playersRemaining: state.playersRemaining, opponent: state.opponentName });
  state.stage = 'preparing';
  state.roundActive = false;
  state.playerHand = [];
  state.opponentHand = [];
  state.playerStood = false;
  state.doubleDown = false;
  state.revealOpponent = false;
  state.opponentPlaying = false;
  state.opponentDecisionComplete = false;
  state.playerBusted = false;
  state.message = '';
  state.wins = 0;
  state.losses = 0;
  state.draws = 0;
  state.handsPlayed = 0;
  state.handResults = [];
  state.playerHands = [];
  state.opponentHands = [];
  state.doubleUsedInMatch = false;
  state.redrawUsed = false;
  state.handsPerMatch = Rules.handsPerMatch(state.totalPlayers);
  tournamentStatusEl.textContent = isFirst
    ? 'Tournament ready. Good luck!'
    : `Preparing round ${state.round}…`;
  toggleActionButtons(false);
  opponentStatusEl.textContent = 'Waiting for deal…';
  playerStatusEl.textContent = 'Awaiting deal…';
  opponentTotalEl.textContent = '';
  if (opponentTotalLabelEl) {
    opponentTotalLabelEl.classList.add('hidden');
  }
  playerTotalEl.textContent = '0';
  opponentCardsEl.innerHTML = '';
  playerCardsEl.innerHTML = '';
  updateOpponentIndicator();
  updateScoreboard();
  updateLevelIndicator();
  updateHandIndicator();

  await delay(900);
  await drawOpponent();
  await delay(600);
  await initializeDeck();

  // Deal all 3 hands upfront
  await dealOpeningHands();

  // Show Redraw Screen instead of starting play immediately
  await showRedrawScreen();
}

async function startCurrentHand() {
  const handIdx = Rules.currentHandIndex(state);
  state.playerHand = state.playerHands[handIdx];
  state.opponentHand = state.opponentHands[handIdx];

  debugLog('Starting Hand', {
    handIndex: handIdx,
    playerHand: describeHand(state.playerHand).summary,
    opponentHand: describeHand(state.opponentHand).summary
  });

  const roundResolved = await checkForBlackjack();
  tournamentStatusEl.textContent = `Round ${state.round}: Beat ${state.opponentName}!`;
  if (roundResolved) {
    return;
  }

  state.roundActive = true;
  state.stage = 'playing';
  if (levelIndicatorEl.classList.contains('hidden')) {
    levelIndicatorEl.classList.remove('hidden');
  }
  playerStatusEl.textContent = 'Your move.';
  const personality = state.opponentPersonality || personalities[1];
  opponentStatusEl.textContent = `${personality.name} is deciding…`;
  toggleActionButtons(true);
  startOpponentTurn();
  updateUI();
  updateHandIndicator();
}

async function drawOpponent() {
  const personality = personalities[Math.floor(Math.random() * personalities.length)];
  state.opponentPersonality = personality;
  state.opponentName = personality.name;
  opponentNameEl.textContent = `${personality.name} (${personality.difficulty})`;
}

async function initializeDeck() {
  try {
    showLoading();
    const response = await fetch('https://deckofcardsapi.com/api/deck/new/shuffle/?deck_count=1');
    const data = await response.json();
    if (!data.success) {
      throw new Error('Deck service unavailable');
    }
    state.deckId = data.deck_id;
  } catch (error) {
    console.error(error);
    handleError('Could not reach the deck service. Try again.');
  } finally {
    hideLoading();
  }
}

async function dealOpeningHands() {
  try {
    const totalCardsNeeded = state.handsPerMatch * 4; // 2 for player, 2 for opponent per hand
    const allCards = await drawCards(totalCardsNeeded);

    state.playerHands = [];
    state.opponentHands = [];

    for (let i = 0; i < state.handsPerMatch; i++) {
      state.playerHands.push([allCards.pop(), allCards.pop()]);
      state.opponentHands.push([allCards.pop(), allCards.pop()]);
    }

    // Set initial active hand
    state.playerHand = state.playerHands[0];
    state.opponentHand = state.opponentHands[0];

    state.playerStood = false;
    state.playerBusted = false;
    state.opponentDecisionComplete = false;
    state.concealOpponentCardCount = true;
    updateUI();
  } catch (error) {
    console.error(error);
    handleError('Failed to deal cards.');
  }
}

async function drawCards(count) {
  if (!state.deckId) {
    throw new Error('Deck not initialised');
  }
  showLoading();
  try {
    const response = await fetch(`https://deckofcardsapi.com/api/deck/${state.deckId}/draw/?count=${count}`);
    const data = await response.json();
    if (!data.success) {
      throw new Error('Not enough cards in deck');
    }
    return data.cards;
  } finally {
    hideLoading();
  }
}

async function startOpponentTurn() {
  state.opponentPlaying = true;
  state.opponentDecisionComplete = false;
  updateOpponentIndicator();

  const personality = state.opponentPersonality || personalities[1];
  const thinkMsg = personality.thinkingMessages[Math.floor(Math.random() * personality.thinkingMessages.length)];
  opponentStatusEl.textContent = `${personality.name}: "${thinkMsg}"`;
  showToast(`${personality.name} is thinking...`);

  try {
    await delay(1000);
    let opponentTotal = calculateHandValue(state.opponentHand);

    while (state.roundActive && Rules.botShouldHit(opponentTotal, personality.hitThreshold)) {
      const actMsg = personality.actionMessages[Math.floor(Math.random() * personality.actionMessages.length)];
      opponentStatusEl.textContent = `${personality.name}: "${actMsg}"`;
      showToast(`${personality.name} hits.`);
      await delay(800);

      const [card] = await drawCards(1);
      if (!state.roundActive) {
        break;
      }
      state.opponentHand.push(card);
      opponentTotal = calculateHandValue(state.opponentHand);
      if (!state.roundActive) {
        break;
      }
      updateUI();
      await delay(1000);
    }
  } catch (error) {
    console.error(error);
    handleError('Opponent could not complete their turn.');
    state.roundActive = false;
  } finally {
    state.opponentPlaying = false;
    state.opponentDecisionComplete = true;
    updateOpponentIndicator();
    if (state.roundActive && calculateHandValue(state.opponentHand) <= 21) {
      showToast(`${state.opponentName} stands.`);
    }
  }

  if (!state.roundActive) {
    return;
  }

  if (!state.roundActive) {
    return;
  }

  opponentStatusEl.textContent = state.playerStood || state.playerBusted
    ? `${state.opponentName} is ready for the reveal.`
    : `${state.opponentName} is waiting for your move.`;

  if (!state.playerStood && !state.playerBusted) {
    playerStatusEl.textContent = `Opponent locked in. Finish your hand.`;
  }

  await attemptResolveRound();
}

async function attemptResolveRound() {
  if (!state.roundActive) return;
  if (!state.playerStood && !state.playerBusted) return;
  if (!state.opponentDecisionComplete) return;

  await settleRound();
}

async function settleRound() {
  const playerTotal = calculateHandValue(state.playerHand);
  const opponentTotal = calculateHandValue(state.opponentHand);

  debugLog('Settling Round', { playerTotal, opponentTotal, playerBust: playerTotal > 21, opponentBust: opponentTotal > 21 });

  const { result, reason } = Rules.settleHand(playerTotal, opponentTotal);

  switch (reason) {
    case 'double-bust':
      await endRound(result, 'Double bust! It\'s a push—no points awarded.');
      return;
    case 'player-bust':
      state.playerBusted = true;
      await endRound(result, 'You busted! Eliminated from the match.');
      return;
    case 'opponent-bust':
      await endRound(result, `${state.opponentName} busted! You advance.`);
      return;
    case 'higher-total':
      await endRound(result, `You beat ${state.opponentName} ${playerTotal} to ${opponentTotal}!`);
      return;
    case 'lower-total':
      await endRound(result, `${state.opponentName} wins ${opponentTotal} to ${playerTotal}.`);
      return;
    default:
      await endRound(result, `Push at ${playerTotal}! No points awarded.`);
  }
}

function updateUI() {
  renderHand(state.playerHand, playerCardsEl, true);
  renderHand(state.opponentHand, opponentCardsEl, state.revealOpponent);

  animateScore(playerTotalEl, calculateHandValue(state.playerHand));

  if (state.revealOpponent) {
    animateScore(opponentTotalEl, calculateHandValue(state.opponentHand));
    if (opponentTotalLabelEl) {
      opponentTotalLabelEl.classList.remove('hidden');
    }
  } else {
    opponentTotalEl.textContent = '';
    if (opponentTotalLabelEl) {
      opponentTotalLabelEl.classList.add('hidden');
    }
  }
  tournamentStatusEl.textContent = state.message || tournamentStatusEl.textContent;
  updateOpponentIndicator();
}

function renderHand(hand, container, reveal) {
  // Temporarily grab and remove double strap so it stays on top
  const existingStrap = container.querySelector('.double-strap');
  if (existingStrap) existingStrap.remove();

  // Remove cards that are no longer in this hand (e.g., from previous hands or redrawn)
  const currentCardCodes = hand.map(c => c.code);
  const existingCards = container.querySelectorAll('.card');
  existingCards.forEach(cardEl => {
    if (!currentCardCodes.includes(cardEl.dataset.code)) {
      cardEl.remove();
    }
  });

  hand.forEach((card, idx) => {
    let cardEl = container.querySelector(`.card[data-code="${card.code}"]`);
    if (!cardEl) {
      cardEl = document.createElement('div');
      cardEl.className = 'card card-enter';
      cardEl.dataset.code = card.code;
      cardEl.style.animationDelay = `${idx * 0.15}s`;

      cardEl.addEventListener('animationend', () => {
        cardEl.classList.remove('card-enter');
        cardEl.style.animationDelay = '0s';
      }, { once: true });

      container.appendChild(cardEl);
    }

    const imageUrl = reveal ? card.image : CARD_BACK;
    cardEl.style.backgroundImage = `url(${imageUrl})`;
    cardEl.classList.toggle('card-hidden', !reveal);
  });

  // Add DOUBLE strap across the hand if doubled
  if (state.doubleDown && container === playerCardsEl) {
    const strap = document.createElement('div');
    strap.className = 'double-strap';
    strap.textContent = 'DOUBLE';
    container.appendChild(strap);
  }
}

function animateScore(element, targetValue) {
  const currentValue = parseInt(element.textContent) || 0;
  if (currentValue === targetValue || targetValue === 0) {
    element.textContent = targetValue;
    return;
  }

  element.style.color = 'var(--accent-gold)';
  element.style.transform = 'scale(1.2)';
  element.style.transition = 'all var(--speed-fast) var(--easing-bounce)';

  const duration = 400;
  const frames = 20;
  const stepTime = duration / frames;
  const diff = targetValue - currentValue;
  let currentFrame = 0;

  // Clear any existing timer to prevent jank on rapid fires
  if (element.animationTimer) clearInterval(element.animationTimer);

  element.animationTimer = setInterval(() => {
    currentFrame++;
    const progress = currentFrame / frames;
    const easeOut = Math.sin((progress * Math.PI) / 2);
    const stepValue = Math.round(currentValue + diff * easeOut);
    element.textContent = stepValue;

    if (currentFrame >= frames) {
      clearInterval(element.animationTimer);
      element.textContent = targetValue;
      setTimeout(() => {
        element.style.color = '';
        element.style.transform = '';
      }, 150);
    }
  }, stepTime);
}

function updateOpponentIndicator() {
  if (!opponentIndicatorEl) return;
  if (state.opponentPlaying && state.roundActive) {
    opponentIndicatorEl.classList.remove('hidden');
  } else {
    opponentIndicatorEl.classList.add('hidden');
  }
}

function toggleActionButtons(enabled) {
  hitButton.disabled = !enabled;
  standButton.disabled = !enabled;
  doubleButton.disabled = !enabled || state.playerHand.length !== 2 || state.doubleDown;
}

async function takePlayerAction(action) {
  if (!state.roundActive) return;

  debugLog('Player Action', { action, currentTotal: calculateHandValue(state.playerHand) });

  switch (action) {
    case 'hit':
      await playerHit();
      break;
    case 'stand':
      await playerStand();
      break;
    case 'double':
      if (state.doubleUsedInMatch) return;
      state.doubleDown = true;
      state.doubleUsedInMatch = true;

      const personality = state.opponentPersonality || personalities[1];
      const dblReact = personality.doubleReactions[Math.floor(Math.random() * personality.doubleReactions.length)];
      opponentStatusEl.textContent = `${personality.name}: "${dblReact}"`;

      playerStatusEl.textContent = 'Tournament Double! One final card…';
      await playerHit(true);
      await playerStand();
      break;
  }
}

async function playerHit(isDouble = false) {
  try {
    const [card] = await drawCards(1);
    state.playerHand.push(card);
    state.playerBusted = false;
    updateUI();

    await delay(1000); // Visual pause so user sees drawn card

    const total = calculateHandValue(state.playerHand);
    if (total > 21) {
      state.playerBusted = true;
      showToast('You busted!');
      playerStatusEl.textContent = 'You busted! Waiting for reveal…';
      toggleActionButtons(false);
      await attemptResolveRound();
    } else {
      if (!isDouble) {
        showToast('You hit.');
        playerStatusEl.textContent = 'Hit! Decide your next move.';
      }
    }
  } catch (error) {
    console.error(error);
    handleError('Could not draw a card.');
  }
}

async function playerStand() {
  if (!state.roundActive || state.playerStood) {
    return;
  }

  state.playerStood = true;
  toggleActionButtons(false);
  showToast('You stand.');
  playerStatusEl.textContent = state.opponentDecisionComplete
    ? 'Standing. Revealing hands…'
    : 'Standing. Waiting for opponent…';

  if (state.opponentDecisionComplete) {
    await delay(800); // Visual pause before resolving
  }

  await attemptResolveRound();
}

function calculateHandValue(hand) {
  return Rules.calculateHandValue(hand);
}

async function checkForBlackjack() {
  const opening = Rules.resolveOpening(state.playerHand, state.opponentHand);

  if (opening === 'draw') {
    state.revealOpponent = true;
    state.concealOpponentCardCount = false;
    state.opponentDecisionComplete = true;
    state.opponentPlaying = false;
    updateOpponentIndicator();
    updateUI();
    await delay(1200);
    await endRound('draw', 'Double blackjack! It\'s a push—no points awarded.');
    return true;
  } else if (opening === 'win') {
    state.revealOpponent = true;
    state.concealOpponentCardCount = false;
    state.opponentDecisionComplete = true;
    state.opponentPlaying = false;
    updateOpponentIndicator();
    updateUI();
    await delay(1200);
    await endRound('win', 'Blackjack! Immediate victory.');
    return true;
  } else if (opening === 'lose') {
    state.revealOpponent = true;
    state.concealOpponentCardCount = false;
    state.opponentDecisionComplete = true;
    state.opponentPlaying = false;
    updateOpponentIndicator();
    updateUI();
    await delay(1200);
    await endRound('lose', `${state.opponentName} hits blackjack. Eliminated.`);
    return true;
  }

  return false;
}

async function endRound(result, message) {
  state.roundActive = false;
  state.revealOpponent = true;
  state.concealOpponentCardCount = false;
  state.opponentPlaying = false;
  state.opponentDecisionComplete = true;

  const handHeadline = buildHandOutcomeHeadline(result);
  const displayMessage = message ? `${handHeadline} ${message}` : handHeadline;

  const personality = state.opponentPersonality || personalities[1];
  let reaction = '';
  const scoreIncrement = state.doubleDown ? 2 : 1;

  Object.assign(state, Rules.applyHandResult(state, result, state.doubleDown));

  switch (result) {
    case 'win':
      state.stage = 'post-hand-win';
      reaction = personality.lossMessages[Math.floor(Math.random() * personality.lossMessages.length)];
      break;
    case 'lose':
      state.stage = 'post-hand-loss';
      reaction = personality.winMessages[Math.floor(Math.random() * personality.winMessages.length)];
      break;
    case 'draw':
      state.stage = 'post-hand-draw';
      break;
    default:
      state.stage = 'post-hand';
      break;
  }

  toggleActionButtons(false);
  opponentStatusEl.textContent = reaction ? `${personality.name}: "${reaction}"` : `${state.opponentName}'s hand revealed.`;
  state.message = displayMessage;
  playerStatusEl.textContent = displayMessage;
  tournamentStatusEl.textContent = displayMessage;
  updateOpponentIndicator();

  debugLog('Hand Ended', { result, message: displayMessage, handsPlayed: state.handsPlayed, scoreIncrement, state });

  updateScoreboard();
  updateLevelIndicator();
  updateHandIndicator();
  updateUI();

  const resolution = determineMatchResolution();

  if (resolution.type === 'champion') {
    state.playersRemaining = 1;
    state.stage = 'champion';
    state.message = 'Champion! You conquered the hill!';
    tournamentStatusEl.textContent = state.message;
    playerStatusEl.textContent = state.message;
    updateLevelIndicator();
  } else if (resolution.type === 'advance') {
    state.stage = 'post-win';
  } else if (resolution.type === 'eliminated') {
    state.stage = 'post-loss';
    state.message = resolution.isFinalRound
      ? 'Final showdown lost. Refresh to try again.'
      : 'Defeated. Try the tournament again!';
    tournamentStatusEl.textContent = state.message;
    playerStatusEl.textContent = state.message;
  }

  showHandSummary(result, displayMessage, resolution);
}

async function prepareNextHand() {
  state.stage = 'preparing-hand';
  state.roundActive = false;
  state.playerStood = false;
  state.doubleDown = false;
  state.revealOpponent = false;
  state.concealOpponentCardCount = true;
  state.opponentPlaying = false;
  state.opponentDecisionComplete = false;
  state.playerBusted = false;
  state.message = '';

  opponentStatusEl.textContent = 'Preparing next hand…';
  playerStatusEl.textContent = 'Next hand incoming…';

  updateOpponentIndicator();
  updateUI();
  updateHandIndicator();

  await delay(800);
  await startCurrentHand();
}

function updateScoreboard() {
  renderScoreboard(playerScoreboardEl, state.handResults, 'player');
  renderScoreboard(opponentScoreboardEl, state.handResults, 'opponent');
  updateHandIndicator();
}

function renderScoreboard(container, results, perspective) {
  if (!container) return;

  const totalSlots = state.handsPerMatch;
  container.innerHTML = '';

  for (let i = 0; i < totalSlots; i += 1) {
    const dot = document.createElement('span');
    dot.classList.add('score-dot');

    let status = 'pending';
    let ariaLabel = `Hand ${i + 1}: Pending`;
    const result = results[i];

    if (result === 'draw') {
      status = 'draw';
      ariaLabel = `Hand ${i + 1}: Draw`;
    } else if (result) {
      const playerWon = result === 'win';
      const didWin = perspective === 'player' ? playerWon : !playerWon;
      status = didWin ? 'win' : 'loss';
      ariaLabel = `Hand ${i + 1}: ${didWin ? 'Win' : 'Loss'}`;
    }

    dot.classList.add(`score-dot--${status}`);
    dot.setAttribute('aria-label', ariaLabel);
    dot.setAttribute('role', 'presentation');
    container.appendChild(dot);
  }
}

function determineMatchResolution() {
  return Rules.determineMatchResolution(state);
}

function formatCardValue(card) {
  const valueMap = {
    ACE: 'A',
    KING: 'K',
    QUEEN: 'Q',
    JACK: 'J'
  };

  return valueMap[card.value] || card.value;
}

function formatCardSuit(card) {
  const suitMap = {
    SPADES: '♠',
    HEARTS: '♥',
    DIAMONDS: '♦',
    CLUBS: '♣'
  };

  return suitMap[card.suit] || card.suit?.[0] || '';
}

function describeHand(hand) {
  const total = calculateHandValue(hand);
  const cardText = hand.map((card) => `${formatCardValue(card)}${formatCardSuit(card)}`).join(', ');
  return {
    cards: cardText,
    total,
    summary: `${cardText} (${total})`
  };
}

function buildHandOutcomeHeadline(result) {
  const playerHand = describeHand(state.playerHand);
  const opponentHand = describeHand(state.opponentHand);

  switch (result) {
    case 'win':
      return `You won the hand with ${playerHand.summary} vs ${state.opponentName}'s ${opponentHand.summary}.`;
    case 'lose':
      return `You lost the hand with ${playerHand.summary} vs ${state.opponentName}'s ${opponentHand.summary}.`;
    default:
      return `Hand pushed: you showed ${playerHand.summary} and ${state.opponentName} showed ${opponentHand.summary}.`;
  }
}

function updateLevelIndicator() {
  const playersText = state.playersRemaining <= 1
    ? 'Champion'
    : `${state.playersRemaining} players left`;
  levelIndicatorEl.textContent = `Round ${state.round} • ${playersText}`;
}

function handleError(message) {
  playerStatusEl.textContent = message;
  tournamentStatusEl.textContent = message;
  toggleActionButtons(false);
  showOverlayPrompt(`<p>${message}</p>`, 'Restart Tournament', () => refreshTournament());
}

function showHandSummary(result, message, resolution) {
  const playerHand = describeHand(state.playerHand);
  const opponentHand = describeHand(state.opponentHand);

  const overlayContentEl = document.querySelector('.overlay-content');
  const modifierClass = result === 'win' ? 'overlay-content--win' : (result === 'lose' ? 'overlay-content--loss' : '');
  if (modifierClass) {
    overlayContentEl.classList.add(modifierClass);
  }

  const summaryHtml = `
    <div class="hand-summary">
      <p class="hand-summary__headline">${message}</p>
      <div class="hand-summary__hands">
        <div class="hand-summary__hand">
          <span class="hand-summary__label">${state.opponentName}</span>
          <span class="hand-summary__cards">${opponentHand.cards}</span>
          <span class="hand-summary__value">${opponentHand.total}</span>
        </div>
        <div class="hand-summary__hand hand-summary__hand--player">
          <span class="hand-summary__label">You</span>
          <span class="hand-summary__cards">${playerHand.cards}</span>
          <span class="hand-summary__value">${playerHand.total}</span>
        </div>
      </div>
    </div>
  `;

  let buttonText = 'Next Hand';
  let action = async () => {
    hideOverlay();
    await prepareNextHand();
  };

  switch (resolution.type) {
    case 'continue':
      buttonText = 'Next Hand';
      action = async () => {
        hideOverlay();
        await prepareNextHand();
      };
      break;
    case 'advance':
      buttonText = 'Next Round';
      action = async () => {
        hideOverlay();
        showAdvanceDialog(resolution.nextPlayersRemaining);
      };
      break;
    case 'champion':
      buttonText = 'View Trophy';
      action = async () => {
        hideOverlay();
        showChampionDialog();
      };
      break;
    case 'eliminated':
      buttonText = resolution.isFinalRound ? 'View Results' : 'Try Again';
      action = async () => {
        hideOverlay();
        showEliminationDialog(resolution.isFinalRound);
      };
      break;
    case 'tiebreak':
      buttonText = 'Tie-Breaker Hand';
      action = async () => {
        state.message = 'Tie-breaker hand incoming!';
        tournamentStatusEl.textContent = state.message;
        playerStatusEl.textContent = state.message;
        state.handsPerMatch += 1;
        updateScoreboard();
        updateHandIndicator();
        hideOverlay();
        await prepareNextHand();
      };
      break;
    default:
      break;
  }

  showOverlayPrompt(summaryHtml, buttonText, action);
}

async function showRedrawScreen() {
  state.stage = 'strategy';
  state.redrawUsed = false;
  state.selectedRedrawCard = null;

  const redrawHtml = `
    <div class="strategy-screen">
      <h2 class="strategy-title">Strategy Phase: Redraw 1 Card</h2>
      <p class="strategy-subtitle">Select a card across your 3 hands to redraw, or skip to start.</p>
      <div class="strategy-hands">
        ${state.playerHands.map((hand, hIdx) => `
          <div class="strategy-hand" data-hand="${hIdx}">
            <div class="strategy-hand-label">Hand ${hIdx + 1}</div>
            <div class="strategy-hand-cards">
              ${hand.map((card, cIdx) => `
                <div class="card strategy-card" 
                     data-hand="${hIdx}" 
                     data-card="${cIdx}" 
                     style="background-image: url(${card.image})">
                </div>
              `).join('')}
            </div>
            <div class="strategy-hand-value">${calculateHandValue(hand)}</div>
          </div>
        `).join('')}
      </div>
      <div class="strategy-actions">
        <button id="redrawBtn" class="btn btn--primary" disabled>Redraw Selected</button>
        <button id="skipRedrawBtn" class="btn btn--secondary">Start Match</button>
      </div>
    </div>
  `;

  showOverlayPrompt(redrawHtml, 'Start Match', async () => {
    await startCurrentHand();
  });

  // Re-bind actions since showOverlayPrompt overwrites
  const redrawBtn = document.getElementById('redrawBtn');
  const skipRedrawBtn = document.getElementById('skipRedrawBtn');
  const cards = document.querySelectorAll('.strategy-card');
  const startBtn = document.getElementById('startButton');

  startBtn.classList.add('hidden'); // Hide the standard start button in this phase

  cards.forEach(card => {
    card.addEventListener('click', () => {
      if (state.redrawUsed) return;

      cards.forEach(c => c.classList.remove('card--selected'));
      card.classList.add('card--selected');
      state.selectedRedrawCard = {
        handIndex: parseInt(card.dataset.hand),
        cardIndex: parseInt(card.dataset.card)
      };
      redrawBtn.disabled = false;
    });
  });

  redrawBtn.addEventListener('click', async () => {
    if (!state.selectedRedrawCard || state.redrawUsed) return;

    redrawBtn.disabled = true;
    redrawBtn.textContent = 'Redrawing...';

    try {
      const [newCard] = await drawCards(1);
      const { handIndex, cardIndex } = state.selectedRedrawCard;
      state.playerHands[handIndex][cardIndex] = newCard;
      state.redrawUsed = true;

      // Update UI
      const selectedCardEl = document.querySelector(`.strategy-card[data-hand="${handIndex}"][data-card="${cardIndex}"]`);
      selectedCardEl.style.backgroundImage = `url(${newCard.image})`;
      selectedCardEl.classList.add('card--redrawn');

      const handValueEl = document.querySelector(`.strategy-hand[data-hand="${handIndex}"] .strategy-hand-value`);
      handValueEl.textContent = calculateHandValue(state.playerHands[handIndex]);

      redrawBtn.textContent = 'Redraw Used';

      // Transition to match after a brief delay
      await delay(1000);
      hideOverlay();
      await startCurrentHand();
    } catch (error) {
      console.error(error);
      redrawBtn.textContent = 'Error redraw';
    }
  });

  skipRedrawBtn.addEventListener('click', async () => {
    hideOverlay();
    await startCurrentHand();
  });
}

async function showOverlaySequence(messages) {
  openOverlay();
  overlayAction = null;
  startButton.disabled = true;
  startButton.classList.add('hidden');
  for (const message of messages) {
    overlayMessage.textContent = message;
    await delay(1200);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function showToast(message) {
  if (!toastContainer) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-exit');
    toast.addEventListener('animationend', () => toast.remove());
  }, 2500);
}

function openOverlay() {
  overlay.classList.remove('hidden');
  controlsContainer.classList.add('hidden');
}

function closeOverlay() {
  overlay.classList.add('hidden');
  document.querySelector('.overlay-content').classList.remove('overlay-content--win', 'overlay-content--loss');
  controlsContainer.classList.remove('hidden');
  startButton.disabled = false;
  startButton.classList.remove('hidden');
  overlayAction = null;
}

function hideOverlay() {
  closeOverlay();
}

function showLoading() {
  if (loadingOverlay) loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
  if (loadingOverlay) loadingOverlay.classList.add('hidden');
}

function showOverlayPrompt(message, buttonText, action) {
  openOverlay();
  overlayMessage.innerHTML = message;
  startButton.textContent = buttonText;
  startButton.disabled = false;
  startButton.classList.remove('hidden');
  overlayAction = async () => {
    await action();
  };
}

function resetTournamentState() {
  state.stage = 'lobby';
  state.playerHand = [];
  state.opponentHand = [];
  state.playerStood = false;
  state.doubleDown = false;
  state.revealOpponent = false;
  state.concealOpponentCardCount = true;
  state.opponentPlaying = false;
  state.opponentDecisionComplete = false;
  state.playerBusted = false;
  state.roundActive = false;
  state.message = '';
  state.deckId = null;
  state.opponentName = 'Opponent';
  state.opponentPersonality = null;
  state.playersRemaining = state.totalPlayers;
  state.round = 1;
  state.wins = 0;
  state.losses = 0;
  state.draws = 0;
  state.handsPlayed = 0;
  state.handResults = [];
  state.handsPerMatch = Rules.handsPerMatch(state.totalPlayers);
  playerCardsEl.innerHTML = '';
  opponentCardsEl.innerHTML = '';
  playerTotalEl.textContent = '0';
  opponentTotalEl.textContent = '';
  if (opponentTotalLabelEl) {
    opponentTotalLabelEl.classList.add('hidden');
  }
  playerStatusEl.textContent = 'Awaiting deal…';
  opponentStatusEl.textContent = 'Waiting…';
  opponentNameEl.textContent = state.opponentName;
  tournamentStatusEl.textContent = 'Prepare for battle!';
  toggleActionButtons(false);
  levelIndicatorEl.classList.add('hidden');
  levelIndicatorEl.textContent = `Round ${state.round} • ${state.totalPlayers} players left`;
  updateOpponentIndicator();
  updateScoreboard();
  updateLevelIndicator();
  updateHandIndicator();
}

function showAdvanceDialog(nextPlayersRemaining) {
  showOverlayPrompt(
    '<p>Congrats you are through to the next round</p>',
    'Start Next Round',
    async () => {
      state.playersRemaining = nextPlayersRemaining;
      state.round += 1;
      updateLevelIndicator();
      hideOverlay();
      await setupNextMatch();
    }
  );
}

function showEliminationDialog(isFinalRound) {
  const message = isFinalRound
    ? "<p>You lost in the final round, please try again</p>"
    : '<p>Oh well you lost</p>';
  showOverlayPrompt(message, 'Restart Tournament', () => refreshTournament());
}

function showChampionDialog() {
  const message = `
    <div class="champion-message">
      <h2 class="champion-message__title">CONGRATS! you won the tournament, You are king of the hill!.</h2>
      <p class="champion-message__subtitle">The crowd roars as the trophy is yours.</p>
    </div>
  `;

  showOverlayPrompt(message, 'Restart Tournament', () => refreshTournament());
}

function refreshTournament() {
  window.location.reload();
}

function showIntroDialog() {
  const introMessage = [
    'Welcome to the Blackjack Duel battle royale demo',
    "To start a game press the 'start game' button below.",
    'This is a single player proof of concept demo of an 8 player heads up tournament of Blackjack Duel.',
    'The game play is as follows: You are matched with a random player, you play them in a standard BJD game, winner gets matched to another winner form the same round, loser is eliminated and so on until the last player standing takes the spoils.'
  ]
    .map((line) => `<p>${line}</p>`)
    .join('');

  showOverlayPrompt(introMessage, 'Start Game', async () => {
    await beginTournament();
  });
}

function updateHandIndicator() {
  const totalHands = state.handsPerMatch;
  const completedHands = state.handsPlayed;
  let currentHand = completedHands + 1;

  if (state.stage === 'lobby') {
    currentHand = 1;
  } else if (!state.roundActive) {
    const showCompleted =
      state.playersRemaining <= 1 ||
      state.stage === 'post-loss' ||
      state.stage === 'champion';
    currentHand = showCompleted ? Math.max(completedHands, 1) : completedHands + 1;
  }

  currentHand = Math.min(Math.max(currentHand, 1), totalHands);
  handIndicatorEl.textContent = `Hand ${currentHand} of ${totalHands}`;
}

resetTournamentState();
showIntroDialog();
