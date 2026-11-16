# Blackjack Duel: How I'd Validate It

A prototype proves the game can be built. It doesn't prove anyone wants it. This is the two-phase plan I'd run before committing to a full build: behavioural data first, to find out whether the audience exists, then a targeted survey, to find out why.

It's written for an operator that already runs both casino and poker products, because that's where the data needed to answer these questions lives.

## Hypotheses

**A. Bored Blackjack fans.** There's a group of players who like Blackjack's simple rules but find playing against a dealer unengaging.

**B. Poker rejectors.** There's a group of players who tried poker and stopped because it felt too complex, too slow or too intimidating.

**C. Crossover appeal.** Many casino-only players would try a PvP game if it felt accessible, and many poker-only players would try a simpler, faster PvP game.

## Phase 1: behavioural data analysis

Three questions an operator's own data can answer.

**1. Is there real overlap between heavy Blackjack players and poker players?**
- *Why it matters:* a strong overlap means the core casino audience is already open to PvP skill games, which is the market for a "bridge" product.
- *Query:* what percentage of the top 20% of Blackjack players (by hands played in the last 90 days) also played at least one real-money poker hand in the same period?

**2. Do Blackjack players show signs of low engagement?**
- *Why it matters:* if players aren't sticking with Blackjack, they're likely open to a more engaging format. Session bounce is a direct signal of a game that isn't holding attention.
- *Query:* what percentage of sessions that start with Blackjack last under 5 minutes before the player switches category (slots, poker) or leaves?
- *Comparison:* how does that bounce rate compare with the most engaging games, such as poker tournaments or the most popular slots?

**3. Does the audience want direct, aggressive head-to-head competition?**
- *Why it matters:* this tests the duel format itself, using the closest existing equivalent.
- *Query:* among crossover players, what percentage choose heads-up (2-player) sit-and-go poker?
- *Follow-up:* among frequent heads-up players, do VPIP/PFR ratios (how often they voluntarily put money in, and raise before the flop) show a generally aggressive style?

**Outputs:** a validation report that confirms or refutes each question with data, and an anonymised list of players in each persona, which becomes the sample for Phase 2.

## Phase 2: targeted user survey

Sent to 500 to 1,000 active players picked from the Phase 1 segments, not to a general audience. The personas are the **High-Value Blackjack Main**, the **Lapsed Skill-Gamer** and the **Poker-Casino Crossover** player.

| Hypothesis | Tested by |
|---|---|
| A: Bored Blackjack fans | Questions 4 and 5 |
| B: Poker rejectors | Questions 3 and 6 |
| C: Crossover appeal | Questions 7 and 8 |

### Screener and segmentation

**Q1. Which best describes your main online gaming in the last 6 months?**
Mostly Blackjack · Mostly slots or other casino games · Mostly poker · A regular mix of casino and poker

**Q2. What's your experience with online poker?**
I play regularly · I play sometimes · I've tried it but don't play any more · I've never played

**Q3.** *(Only if "tried it but don't play any more")* **What was the main reason you stopped?**
The rules and strategy were too complicated · Games took too long · My opponents were far more advanced · I wasn't successful at it

### Problem validation

**Q4.** *(Blackjack players)* **How much do you agree?** (Strongly disagree → Strongly agree)
- The game is exciting every time I play.
- I wish the game involved more player skill.
- Playing against a computer dealer can be boring.

**Q5. How appealing is playing Blackjack against one other human player?** 1 (not at all) to 5 (very)

**Q6.** *(Tried poker but stopped)* **How important are these when you consider a new skill game?** (Not important → Very important)
- Simple, easy-to-learn rules
- Fast games completed in minutes
- Playing against real people

### Crossover appeal

**Q7.** *(Casino but not poker)* **How interested would you be in a game with the simple rules of casino games but the competitive, player-vs-player action of poker?**
Very · Somewhat · Neutral · Not very · Not at all

**Q8.** *(Poker but not casino)* **How interested would you be in a simpler, faster PvP game that takes 5 minutes, using rules like Blackjack?**
Very · Somewhat · Neutral · Not very · Not at all
