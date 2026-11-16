# Testing the 1v1 Duel

The duel is the MVP, so I tested it against the MVP user stories, story by story. It's also a networked game where the server holds the cards, so I tested it the way a cheating client would approach it as well as a fair one.

The suite found ten gaps between the stories and the build, and reading the code turned up one more. One lets any player crash the server, one lets a player give themselves an extra card, and one is the game's defining mechanic, which isn't there yet.

## How the tests work

**Real server, real clients.** Every test starts its own copy of `server.js` and plays it with two real Socket.IO clients, sending exactly the events the game page sends. Nothing in the game is mocked, and no game code was changed to make it testable.

**A repeatable deck.** A small file, [`tests/support/test-runtime.mjs`](tests/support/test-runtime.mjs), is loaded into the server process only during tests. It seeds the random number generator, so the same seed always shuffles the same deck. I played a couple of hundred seeds once to find deals with the situations the tests need: a Natural on Hand A, a match that ends level and goes to Sudden Death.

**Faster timers.** The same file runs every server timer 20 times faster, so a full match takes under a second. The order of events doesn't change.

**One server per test.** A test that crashes the server, or leaves a match stuck, can't affect any other test.

**An oracle for scoring.** The scoring test doesn't trust the server's arithmetic. A separate implementation of the ruleset, written from the [game design](../docs/game-design.md#ruleset-phase-1) rather than from `server.js`, scores every hand from the cards the server reveals at the end. Across twelve seeded matches, the server has to agree with it on every hand, every points total and every match result. It does.

## Results

**16 passed, 10 known gaps.** The suite takes about 25 seconds.

Known gaps are written as `{ todo: 'DUEL-...' }` tests. Each describes what the story asks for, runs on every build and is reported as TODO, so the build stays green while the gap stays visible. I checked each one fails for the reason it states, not because of a timeout or a test mistake.

## What works

- **Matchmaking:** the public queue pairs two players; private matches work by code; an unknown code gets a clear message.
- **Server authority over what you see:** each player receives their own three hands and only masked cards for their opponent. The server deals all twelve cards from one deck, with no duplicates, and refuses a Hit during the Strategy Phase.
- **Redraw and Double:** Redraw replaces exactly the chosen card and works once; Double works once, and the opponent is told which hand.
- **Scoring:** correct on every hand across twelve matches, including Doubled hands (one extra card, 2 points) and Naturals (an automatic win, revealed to the opponent).
- **Sudden Death:** a tie after three hands deals each player a fresh hand, with Double switched off.
- **Disconnections:** the remaining player is told straight away.

## Findings

Severity is about the player: what breaks, and for whom.

### DUEL-002 · Critical · Any player can crash the server

A Redraw request for a hand that doesn't exist, such as `{ handKey: 'Z' }`, throws an unhandled error and the Node process exits. Every match on the server ends. It takes one message from a modified client, or a bug in the real one.
*Story:* US-4.1, server authority. *Fix:* validate `handKey` and `cardIndex` on every event, and stop one bad request from taking the process down.

### DUEL-001 · High · A player can give themselves an extra card

A Redraw request with a card position past the end of the hand, such as `{ cardIndex: 5 }`, adds a third card instead of replacing one. The server trusts the position it's sent.
*Story:* US-4.1, server authority. *Fix:* the same validation as DUEL-002.

### DUEL-006 · High · The hidden bust isn't built

When a player busts, the server ends their turn and sends the opponent "Opponent busted." In the design, the bust stays secret and the player can keep hitting as a bluff until they stand. This is the mechanic that makes Blackjack Duel different, so I'd build it before anything else.
*Story:* US-1.4, GDD hidden bust.

### DUEL-008 · High · A tied Sudden Death hand stops the game

If both players bust, or push, in Sudden Death, the page shows a tie and sends `next_sudden_round` when the players continue. The server has no handler for that event, so nothing happens and the match never finishes.
*Story:* GDD Sudden Death. *Fix:* handle `next_sudden_round` by dealing a new Sudden Death hand.

### DUEL-010 · High · A player can stall a match forever

There's no timer on a hand in play. A player who never hits or stands holds the match, and their opponent, indefinitely. The story asks for a 30-second timer that auto-stands.
*Story:* US-1.4 and US-1.6.

### DUEL-009 · Medium · A dropped connection ends the match at once

When a player disconnects, the match is deleted immediately. The story asks for a 30-second window to reconnect, then a win by forfeit for the player who stayed. A brief Wi-Fi drop currently costs both players the match.
*Story:* US-2.1 and US-4.2.

### DUEL-003 · Medium · Redraw works on a Doubled hand

The rules say Redraw can't be used on a Doubled hand. The server allows it, so a player can Double a hand and then improve it.
*Story:* US-1.3.

### DUEL-007 · Medium · Redraw works in Sudden Death

The rules say Redraw and Double are both off in Sudden Death. Double is; Redraw isn't. The code comments say this is deliberate ("one redraw each allowed"), so the spec and the build disagree. That's a product decision, and it should be written down either way.
*Story:* US-1.5d, GDD Sudden Death.

### DUEL-005 · Low · Doubling a Natural wastes the Double

A Natural is scored the moment it's dealt. The server still accepts a Double on it, which does nothing except use up the player's Double for the round. The rules say a Natural can't be Doubled, so the request should be refused and the Double kept.
*Story:* GDD Natural Blackjack.

### DUEL-004 · Low · The Strategy Phase is 20 seconds, not 30

The stories specify 30 seconds for the Strategy Phase; the build uses 20, and 10 in Sudden Death. Again, a decision to write down rather than a defect.
*Story:* US-1.3 and US-1.6.

### DUEL-011 · Medium · Found in code review: the bot draws two cards per hit in Sudden Death

In Sudden Death the bot draws a card, then calls the shared hit function, which draws another. It also hits below 16 in normal play but below 17 in Sudden Death. The bot's moves depend on timing, so this one has no automated test yet.

## What I'd fix first

1. **DUEL-001 and DUEL-002 together:** one input-validation change closes both, and they're the only findings that let a player cheat or take the game down for everyone.
2. **DUEL-006, the hidden bust:** without it, the playtest can't answer the question the product depends on.
3. **DUEL-008 and DUEL-010:** both leave a player stuck in a match that can't end.

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
