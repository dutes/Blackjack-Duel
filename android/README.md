# Android exploration

An early look at Blackjack Duel as a native Android game, written in Kotlin with Jetpack Compose.

It covers the single-device game flow: dealing three hands to each side, a timed Strategy Phase with Redraw and Double, then playing the hands in turn. The rules sit in their own domain layer (`domain/BlackjackRules.kt` and `domain/GameEngine.kt`), separate from the UI, with unit tests for hand scoring, busts and Naturals in `app/src/test`.

It's an exploration, not a finished app: there's no networked opponent, and the web prototypes are the place to play the game.

## Running it

Open this folder in Android Studio and run the `app` configuration. Minimum Android 7.0 (API 24).
