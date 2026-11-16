# Testing the 1v1 Duel

The duel is the MVP, so I tested it against the MVP user stories, story by story. It's also a networked game where the server holds the cards, so I tested it the way a cheating client would approach it as well as a fair one.

Testing found fourteen issues. The worst let any player crash the server or give themselves an extra card; both are fixed. The most important one still open is the game's defining mechanic, the hidden bust, which isn't built yet.

## How the tests work

**Real server, real clients.** Every test starts its own copy of `server.js` and plays it with two real Socket.IO clients, sending exactly the events the game page sends. Nothing in the game is mocked, and no game code was changed to make it testable.

**A repeatable deck.** A small file, [`tests/support/test-runtime.mjs`](tests/support/test-runtime.mjs), is loaded into the server process only during tests. It seeds the random number generator, so the same seed always shuffles the same deck. I played a couple of hundred seeds once to find deals with the situations the tests need: a Natural on Hand A, a match that ends level and goes to Sudden Death.

**Faster timers.** The same file runs every server timer 20 times faster, so a full match takes under a second. The order of events doesn't change.

**One server per test.** A test that crashes the server, or leaves a match stuck, can't affect any other test.

**An oracle for scoring.** The scoring test doesn't trust the server's arithmetic. A separate implementation of the ruleset, written from the [game design](../docs/game-design.md#ruleset-phase-1) rather than from `server.js`, scores every hand from the cards the server reveals at the end. Across twelve seeded matches, the server has to agree with it on every hand, every points total and every match result. It does.

## Results

**30 tests: 27 pass, 3 open.** The suite takes about 30 seconds.

Nine of the fourteen issues are fixed, two were settled as product decisions, and three are still open. A fixed bug keeps its test, so it can't quietly come back. An open one is written as a `{ todo: 'DUEL-...' }` test: it describes what the story asks for, runs on every build and is reported as TODO, so the build stays green while the gap stays visible. I checked each open test fails for the reason it states, not because of a timeout or a test mistake.

## What works

- **Matchmaking:** the public queue pairs two players; private matches work by code; an unknown code gets a clear message.
- **Server authority:** each player receives their own three hands and only masked cards for their opponent. The server deals all twelve cards from one deck with no duplicates, refuses a Hit during the Strategy Phase, and now rejects requests for hands or cards that don't exist.
- **Redraw and Double:** Redraw replaces exactly the chosen card and works once; Double works once, and the opponent is told which hand. They can't be combined on one hand, and a Natural can't be Doubled.
- **Scoring:** correct on every hand across twelve matches, including Doubled hands (one extra card, 2 points) and Naturals (an automatic win, revealed to the opponent).
- **Sudden Death:** a tie after three hands deals each player a fresh hand with Double off and Redraw on. A Natural wins it outright, and a tied hand is replayed.
- **Disconnections:** the remaining player is told straight away.

## Findings

Severity is about the player: what breaks, and for whom.

### Fixed

| ID | Severity | What was wrong | Fix |
|---|---|---|---|
| DUEL-002 | Critical | A Redraw request for a hand that doesn't exist, such as `{ handKey: 'Z' }`, crashed the server and ended every match on it. | The server checks the hand exists before touching it. |
| DUEL-001 | High | A Redraw request with a card position past the end of the hand added a third card. A player could give themselves an extra card. | The server checks the card position is real. |
| DUEL-008 | High | A tied Sudden Death hand froze the match: the page sent `next_sudden_round`, and the server had no handler for it. | The server deals a new Sudden Death hand once both players continue. |
| DUEL-013 | High | If a player had a Natural on Hand A in the main round, their Sudden Death cards were sent to the opponent face up. | Naturals from the main round are cleared when Sudden Death starts. |
| DUEL-012 | Medium | A Double from the main round carried into Sudden Death, so a player who had Doubled Hand A got their Sudden Death hand dealt one card and locked before they could play it. | Doubles are cleared when Sudden Death starts. |
| DUEL-003 | Medium | Redraw worked on a Doubled hand, so a player could Double a hand and then improve it. | Doubled hands are locked. |
| DUEL-014 | Medium | Double worked on a hand that had been Redrawn. The page blocked it, but the server didn't. | The server refuses it. |
| DUEL-005 | Low | Doubling a Natural did nothing except use up the player's Double. | The server refuses it and the Double stays available. |
| DUEL-011 | Medium | In Sudden Death the bot drew two cards every time it hit. Found by reading the code. | The bot draws through the same path as a player. |

### Settled as decisions

| ID | Question | Decision |
|---|---|---|
| DUEL-004 | The stories said 30 seconds for the Strategy Phase; the build used 20. | **20 seconds**, as the build and the on-screen instructions already said. The stories are updated. |
| DUEL-007 | The stories said Redraw is off in Sudden Death; the build allowed it. | **Redraw stays on**, so Sudden Death is a test of skill rather than a coin flip. Double stays off. |

Both are pinned by `DECISION-` tests, alongside a third: **a Natural dealt in Sudden Death wins outright**, and two Naturals are a draw that's replayed. The decisions are recorded in [the user stories](../docs/user-stories.md#changes-after-testing-november-2026) and [the ruleset](../docs/game-design.md#ruleset-phase-1).

### Still open

**DUEL-006 · High · The hidden bust isn't built.** When a player busts, the server ends their turn and tells the opponent. In the design, the bust stays secret and the player can keep hitting as a bluff until they stand. This is the mechanic that makes Blackjack Duel different, so it's next. *Stories: US-1.4, GDD hidden bust.*

**DUEL-010 · High · A player can stall a match forever.** There's no timer on a hand in play, so a player who never hits or stands holds their opponent indefinitely. The story asks for a 30-second timer that auto-stands. *Stories: US-1.4, US-1.6.*

**DUEL-009 · Medium · A dropped connection ends the match at once.** The story asks for a 30-second window to reconnect, then a win by forfeit. Whether the prototype needs it is still under discussion. *Stories: US-2.1, US-4.2.*

### Not tested automatically

- **Two Naturals in Sudden Death.** The code follows the same path as any tied Sudden Death hand, which is tested, but no seed in the first 1,200 deals both players a Natural there.
- **The bot's Sudden Death draw (DUEL-011).** The bot's moves depend on timing, so the fix was checked by reading the code.

## Not covered yet

- **The game page itself.** These tests drive the server directly. A browser test of the full flow, like the [King of the Hill suite](../king-of-the-hill/TESTING.md), is the next layer.
- **Reconnection (US-4.2):** there's nothing to test until DUEL-009 is built.
- **Load:** how many matches one server can run at once.

## Running the tests

```bash
npm install
npm test
```

Needs Node.js 22 or later. They also run on every push through GitHub Actions.
