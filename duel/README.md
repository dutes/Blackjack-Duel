# 1v1 Duel

The MVP of Blackjack Duel: two players head-to-head over the network.

**▶ Play it live:** https://blackjack-duel.onrender.com (open it in two browser tabs to play against yourself, or try the tutorial against the bot). It runs on a free server that sleeps when idle, so the first visit can take about a minute.

## What's in it

- **Matchmaking:** a public queue, private matches with a room code, or a match against a bot.
- **A guided tutorial** against a bot, with a scripted deal that walks through every rule.
- **A timed Strategy Phase** to use Redraw and Double before play starts.
- **Three hands played in turn**, scored 1 point each or 2 if Doubled, with **Sudden Death** on a tie.
- **Server authority:** the server shuffles, deals and scores. Each player only ever receives their own cards; the opponent's stay masked until the reveal.

## Not built yet

The **hidden bust**. When a player busts, the server ends their turn and tells the opponent. In the design, a bust stays secret and the player can keep hitting as a bluff until they stand. It's the mechanic the whole game leans on, so it's next.

## Testing

`npm test` plays real matches against the server with two Socket.IO clients and checks them against the user stories. What it covers and what it found are in [TESTING.md](TESTING.md).

## Hosting

[`render.yaml`](../render.yaml) at the root of the repo deploys this folder to Render's free tier. A free instance sleeps after 15 minutes without traffic and takes about a minute to wake on the next visit.

## Running it

```bash
npm install
npm start        # http://localhost:3000
```

Node.js 18 or later to run, 22 or later for the tests. Built with Express and Socket.IO.
