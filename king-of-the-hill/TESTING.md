# Testing King of the Hill

I've spent twenty years in QA, so when I came back to my own prototype, I tested it the way I'd test anything going to real players: start from what the spec promises, work out what would hurt most if it broke, and write tests that trace back to both.

The suite found four bugs, three of them serious. They're all written up at the end.

## What matters most

Not everything in a game deserves the same attention. I ranked the risks by what a player would feel:

| Risk | Why it matters | Coverage |
|---|---|---|
| **The wrong person wins a hand** | Scoring is the game. A wrong result destroys trust instantly. | Heavy: every rule, every edge |
| **Hands play out of order, or get skipped** | Players plan all three hands in the Strategy Phase. Skipping one breaks that plan. | Unit and end-to-end |
| **The match ends too early or too late** | Wrongly knocking a player out of a tournament is the worst outcome. | Heavy: every resolution path |
| **The bot doesn't play the strategy it shows** | A bot that breaks its own rules feels rigged. | Every personality, at the boundary |
| **Visuals and copy** | Annoying, but nobody loses a match over them. | Checked by eye, not automated |

## How the tests are built

**Unit tests** cover the rules. The game logic used to live inside the browser code, tangled up with the page, timers and network calls. I moved the pure rules (hand values, settling a hand, the bot's decision, deciding a match) into [`public/rules.mjs`](public/rules.mjs), changing nothing about how they behave, so they can be tested directly. 46 tests run in well under a second.

**End-to-end tests** play the real game in a browser with Playwright, clicking the same buttons a player would. Three things make them repeatable:

- **A scripted deck.** The game deals from a public card API. The tests intercept every call to it and deal from a queue, so each test knows exactly which cards arrive and in what order.
- **A fixed opponent.** The opponent is always Risky Rick, who hits until 18.
- **Faster timers.** The game's pauses run 20 times faster, which keeps each test to a few seconds. That's a trade-off: a bug that depended on real timing could slip past, so timing gets its own manual check.

**Proving the refactor changed nothing.** Before trusting the unit tests, I ran the end-to-end suite against the original, untouched code and against the refactored code. Both gave identical results, known bugs included.

## Traceability

Every test name starts with the requirement it covers, so a failure points straight back to the spec.

| Requirement | Source | Unit | E2E |
|---|---|---|---|
| Hand values, aces soft and hard | [Game design: ruleset](../docs/game-design.md#ruleset-phase-1) | 8 | |
| Natural Blackjack wins automatically; both Naturals push | GDD ruleset, [US-1.5c](../docs/user-stories.md#15-scoring-and-round-end) | 5 | 1 |
| Win, loss and push | GDD ruleset | 8 | 2 |
| Doubled hands score 2 | GDD ruleset, US-1.5a | 3 | |
| Scoring and the scoreboard | US-1.5a | 3 | |
| Three hands per match, played in order | GDD core loop | 1 (known bug) | 2 (1 known bug) |
| Who wins the match, and when it ends early | GDD round | 9 (2 known bugs) | 1 (known bug) |
| Sudden Death on a tie | GDD ruleset, US-1.5d | 1 | 1 (known bug) |
| Bot strategy by personality | King of the Hill | 4 | 1 |
| Bracket size and progression | King of the Hill | 4 | |

## Known bugs are tests too

A test for a known bug states what the spec says should happen and is marked as expected to fail. That keeps the build green while keeping the bug in plain sight:

- Unit tests use `{ todo: 'BUG-00x' }`. They run every time and are reported as TODO.
- End-to-end tests use `test.fail()`. If someone fixes the bug, Playwright flags the test as unexpectedly passing, so the marker can't be forgotten.

Current results: **unit 43 passed, 3 known bugs; end-to-end 5 passed, 3 known bugs.**

## Findings

### BUG-001 · High · A Doubled hand skips the next hand

**Steps:** Double on Hand A. The hand ends in a push. Click Next Hand.
**Expected:** Hand B is dealt.
**Actual:** Hand C is dealt. Hand B is never played.
**Cause:** The game uses one counter, `handsPlayed`, for two jobs: counting points on the scoreboard and choosing which dealt hand to play next. A Doubled hand adds 2 to it, so the next hand's position jumps by two.
**Tests:** `BUG-001` in both suites.

### BUG-002 · High · Losing a Doubled Hand A knocks you out

**Steps:** Double on Hand A and lose it.
**Expected:** The match continues. You trail 0-2 with two hands left, and winning both makes it 2-2 and sends you to Sudden Death.
**Actual:** You're eliminated immediately.
**Cause:** The same shared counter. After the Doubled hand, the game thinks only one hand is left, so it decides you can't catch up.
**Tests:** `BUG-002` in both suites.

### BUG-003 · High · A Doubled Hand B ends the match before Hand C

**Steps:** Win Hand A, then Double on Hand B and lose it (1-2).
**Expected:** Hand C is played. Winning it ties the match at 2-2.
**Actual:** The game thinks all three hands are done, and you're eliminated.
**Cause:** Same as BUG-001.
**Tests:** `BUG-003` (unit).

### BUG-004 · Critical · Sudden Death has no cards, so the game stops

**Steps:** Finish three hands level, for example win, loss, push. Click Tie-Breaker Hand.
**Expected:** A fresh Sudden Death hand is dealt.
**Actual:** Nothing is dealt and the buttons stay disabled. The page throws an error because it tries to play a fourth hand when only three were dealt. The tournament can't continue.
**Cause:** All three hands are dealt at the start of the match, and the tie-breaker reads a fourth, non-existent hand.
**Tests:** `BUG-004` (end-to-end).

**One fix covers all four:** keep the points total and the hand position as separate counters, and deal a new hand when Sudden Death starts. I've left the fix out on purpose, so the tests show the bugs as I found them.

### Spec gaps

Places where the prototype had to make a decision the spec doesn't cover. These aren't bugs, but they need a product decision.

- **SPEC-GAP-001 · Both players bust.** The ruleset defines a win and a loss when one player busts, but not when both do. The prototype calls it a push. That's reasonable, and the unit tests pin it so any change is deliberate.
- **SPEC-GAP-002 · A Redraw that makes 21.** The spec says a Natural is a 21 *dealt* in the Deal Phase. The prototype checks for 21 after the Redraw too, so a Redrawn 21 also wins automatically. That makes Redraw more powerful than the spec intends, and it should be decided one way or the other.

### Where King of the Hill differs from the spec on purpose

- **No hidden bust.** The bot plays a fixed strategy and never reacts to what you do, so hiding your bust from it would change nothing. The 1v1 duel is where the hidden bust lives.
- **Double happens during play, not in the Strategy Phase.** It's still once per match and still scores double.

## Not covered yet

- **The deck service going down.** The game shows an error, but no test checks that it recovers properly. This is the next test I'd add.
- **Accessibility and layout.** Checked by hand only.
- **The 1v1 duel.** That code isn't in this repo yet. The user stories for timers, disconnections and server authority are written with testing in mind and are the obvious next target.

## Running the tests

```bash
npm install
npm test             # unit tests
npm run test:e2e     # end-to-end (first run: npx playwright install chromium)
npm run test:all     # both
```

To use a Chrome that's already installed instead of Playwright's: `CHROME_PATH=/path/to/chrome npm run test:e2e`.

Both suites run on every push through GitHub Actions.
