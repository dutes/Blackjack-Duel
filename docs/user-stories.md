# Blackjack Duel: MVP User Stories

These are the stories and acceptance criteria I wrote to scope the Phase 1 MVP (v0.5). They assume the duel sits inside an existing gaming platform with its own lobby and player profiles.

## 1. Gameplay flow

### 1.1 Matchmaking

**a) As a player, I want to queue for a 1v1 Blackjack Duel so I can quickly be paired with an opponent and start a match.**
- Players can enter a duel from the platform's lobby.
- Two available players in the queue are matched automatically.
- Both players load into the same table at the same time.

**b) As a player, I want to be handled gracefully when no match is found.**
- Show the dialog "No opponents available – waiting for next player…".
- Show an active spinner while matchmaking.
- Include a Cancel button that returns the player to the lobby.

### 1.2 Deal phase

**As a player, I want cards dealt face-down to both players with a short countdown before the Strategy Phase, so the transition feels smooth and clear.**
- The server deals three two-card hands to each player, face-down.
- Deck generation and dealing are fully server-authoritative, to prevent desync or manipulation.
- When the deal animation finishes, show an on-table countdown: "3… 2… 1…".
- At zero, each player's own hands turn face-up; the opponent's stay hidden.
- A distinct audio cue marks the start of the Strategy Phase, different from the timer warning sounds.
- The game moves into the Strategy Phase automatically.

### 1.3 Strategy phase

**As a player, I want a timed Strategy Phase to use my Redraw and Double before play begins, so I can plan my round.**
- Show a shared 30-second Strategy Phase timer.
- Allow one use each of Double and Redraw per round.
- Prevent Redraw on a hand that's already Doubled.
- Validate and lock Doubled hands on the server.
- Flag any Natural Blackjack as an automatic 1-point win.

### 1.4 Play phase (hit or stand)

**As a player, I want to hit or stand on each hand without my opponent knowing if I've bust, so I can bluff.**
- Hands are played in order: A, then B, then C.
- Each hand has a 30-second timer; when it runs out, the player auto-stands.
- A hand over 21 is privately marked Bust, but the player can keep drawing as a bluff until they stand or the timer runs out.
- The player sees a clear "Bust" strap on their own busted hand.
- The opponent sees normal hit and stand actions, never the Bust status.

### 1.5 Scoring and round end

**a) As a player, I want hands revealed and scores tallied clearly so I know who won.**
- Reveal both hands once both players have stood or the timer has run out.
- Score +1 for a win, +2 for a Doubled win, 0 for a push.
- Show "You Win" or "You Lose" at the end of the round.
- Start Sudden Death automatically if the scores are tied.

**b) As a player, when a round ends I want to choose to play again or go back to the lobby.**
- Show "Play Again" and "Return to Lobby".
- "Play Again" re-enters matchmaking; "Return to Lobby" exits.

**c) As a player, I expect a Natural Blackjack to be an automatic win.**
- A Natural (Ace + ten-value card) scores 1 point.
- If both players have Naturals on the same hand, it's a Push.
- Natural hands skip the Play Phase.

**d) As a player, when a round ends in a draw, I want a Sudden Death hand to decide the winner.**
- Show "Entering Sudden Death" with a 5-second countdown.
- Deal one new hand with Redraw and Double disabled.
- Show a visible Stand button.
- Apply a 60-second timer; when it runs out, both players auto-stand.
- Declare the winner and return to the lobby flow.

### 1.6 Timer behaviour (global rules)

**As a player, I want timers to behave consistently across phases so I always understand how the game moves on.**
- Strategy Phase: one shared 30-second timer.
- Play Phase: 30 seconds per hand.
- Sudden Death: one shared 60-second timer.
- When a timer runs out, the player stands or the phase moves on automatically.
- At 5 seconds left, the timer turns red and plays an alert.
- Timer warnings and phase transitions use different sounds.

## 2. Disconnections

**As a player, if my opponent disconnects during play, I want the match to end gracefully.**
- Start a 30-second reconnection timer.
- Show "Opponent disconnected — waiting (30 s)".
- If the timer runs out, the connected player wins by forfeit.
- Show "You Win by Forfeit" before returning to the lobby.

## 3. Social

**As a player, I want a basic profile card to track my performance and identity.**
- Show the player's platform username and avatar at the table.
- Add a "BJD Stats" section to the profile: rounds won, lost and forfeited.
- Match results update the stats automatically through the platform's backend.

## 4. Technical systems

**4.1 As the game server, I must control deck generation, dealing and scoring so every match stays synchronised and tamper-proof.**
- Each duel generates a unique, secure random seed for its deck.
- Deal, Redraw, Double, Hit and Stand are all executed and validated on the server.
- Clients animate cards but never decide outcomes or totals.
- Hidden Bust states are tracked on the server and revealed only at the reveal.
- All scoring runs on the server, and results go to both clients at the same moment.

**4.2 As the game server, I must recover state consistently so a reconnecting player rejoins without corrupting the match.**
- The server keeps a live snapshot of the match: deck position, hand values, timers and scores.
- On reconnection, the client requests and receives a full state sync.
- Timers and game phase resynchronise automatically.
- Both players see "Reconnected – resuming play".
