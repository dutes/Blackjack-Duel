// Test helpers: a scripted deck, a fixed opponent and faster timers.
//
// The game deals from the public Deck of Cards API. In tests every call to
// that API is intercepted and answered from a scripted queue, so each test
// knows exactly which cards will appear and in what order.

const SUITS = ['S', 'H', 'D', 'C'];
const VALUES = { A: 'ACE', K: 'KING', Q: 'QUEEN', J: 'JACK' };
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

/** Turns short codes ('A', 'K', '10', '7') into API card objects with unique codes. */
export function cards(...codes) {
  return codes.map((code, i) => {
    const suit = SUITS[i % SUITS.length];
    const apiCode = `${code === '10' ? '0' : code}${suit}`;
    return {
      code: `${apiCode}-${Math.random().toString(36).slice(2, 7)}`,
      value: VALUES[code] ?? code,
      suit,
      image: `https://deckofcardsapi.com/static/img/${apiCode}.png`
    };
  });
}

/**
 * Builds the opening deal. The game draws 12 cards and pops them off the end,
 * player first, so this reverses the order to put each hand where it's wanted.
 * `player` and `opponent` are three two-card hands each: [A, B, C].
 */
export function openingDeal(player, opponent) {
  const inDealOrder = [];
  for (let i = 0; i < 3; i += 1) {
    inDealOrder.push(...cards(...player[i]), ...cards(...opponent[i]));
  }
  return inDealOrder.reverse();
}

/**
 * Starts the game with a scripted deck.
 * `deal` is the opening deal; `drawPile` is every later card in the order it's drawn
 * (Redraws, player hits and bot hits all take from the same pile).
 */
export async function startGame(page, { deal, drawPile = [] }) {
  const queue = [...deal, ...cards(...drawPile)];

  await page.route('https://deckofcardsapi.com/api/deck/new/shuffle/**', (route) =>
    route.fulfill({ json: { success: true, deck_id: 'test-deck', remaining: 52 } })
  );
  await page.route('https://deckofcardsapi.com/api/deck/test-deck/draw/**', (route) => {
    const count = Number(new URL(route.request().url()).searchParams.get('count'));
    const drawn = queue.splice(0, count);
    route.fulfill({ json: { success: drawn.length === count, cards: drawn, remaining: queue.length } });
  });
  await page.route('https://deckofcardsapi.com/static/img/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: PIXEL })
  );

  await page.addInitScript(() => {
    // Always draw the first personality (Risky Rick, hits until 18).
    Math.random = () => 0;
    // Run the game's pauses 20x faster. Order of events is unchanged.
    const realSetTimeout = window.setTimeout;
    window.setTimeout = (fn, ms = 0, ...args) => realSetTimeout(fn, ms / 20, ...args);
  });

  await page.goto('/');
  await page.locator('#startButton', { hasText: 'Start Game' }).click();
  // Skip the Strategy Phase (no Redraw) unless a test needs it.
}

/** Skips the Redraw and starts Hand A. */
export async function skipRedraw(page) {
  await page.locator('#skipRedrawBtn').click();
}

/** Waits for the hand summary and returns its headline text. */
export async function handSummary(page) {
  const headline = page.locator('.hand-summary__headline');
  await headline.waitFor();
  return headline.innerText();
}

/** Clicks the summary's button (Next Hand, Next Round, Tie-Breaker Hand ...). */
export async function continueFromSummary(page, buttonText) {
  await page.locator('#startButton', { hasText: buttonText }).click();
}
