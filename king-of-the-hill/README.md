# Blackjack King of the Hill

A lightweight Node.js proof of concept for a knockout-style blackjack experience. Players enter a mini-tournament, wait for opponents to be paired, and face off head-to-head using the [Deck of Cards API](https://deckofcardsapi.com/). Win each duel to advance through the bracket until you are crowned champion.

## Features

- Lobby overlay with staged matchmaking messages ("waiting for opponents", "opponent being drawn", etc.).
- Tournament bracket indicator showing the current round and players remaining.
- Blackjack duel layout inspired by the provided concept screenshot.
- Hit, Stand, and Double Down actions with basic dealer AI.
- Automatic card rendering sourced from the Deck of Cards API.
- Simple victory/defeat flow that allows instant replay testing.

## Getting Started

This project intentionally has **no external npm dependencies** so it can run in restricted environments.

```bash
npm start
```

By default the server starts on [http://localhost:3000](http://localhost:3000). Open that URL in your browser to enter the tournament.

## Next Steps

This prototype is designed for solo playtesting. A future iteration can add real multiplayer brackets (e.g., six-player battle royale sessions) once networking and persistence layers are introduced.

## Testing

Unit tests cover the rules and Playwright tests play full hands in a browser with a scripted deck. `npm test` runs the unit tests and `npm run test:e2e` the browser tests. The strategy, traceability and the bugs the suite found are in [TESTING.md](TESTING.md).
