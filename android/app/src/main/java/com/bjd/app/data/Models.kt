package com.bjd.app.data

enum class Suit {
    HEARTS, DIAMONDS, CLUBS, SPADES
}

enum class Rank(val value: Int) {
    TWO(2), THREE(3), FOUR(4), FIVE(5), SIX(6), SEVEN(7), EIGHT(8), NINE(9), TEN(10),
    JACK(10), QUEEN(10), KING(10), ACE(11)
}

data class Card(
    val suit: Suit,
    val rank: Rank,
    val isFaceUp: Boolean = true
)

data class Hand(
    val id: String,
    val cards: List<Card> = emptyList(),
    val isDoubled: Boolean = false,
    val isLocked: Boolean = false,
    val isBusted: Boolean = false,
    val isNaturalBlackjack: Boolean = false,
    val hasRedrawn: Boolean = false
) {
    fun addCard(card: Card): Hand = copy(cards = cards + card)
}

data class Player(
    val id: String,
    val name: String,
    val hands: List<Hand> = listOf(Hand("A"), Hand("B"), Hand("C")),
    val score: Int = 0
)

enum class GamePhase {
    IDLE, DEALING, STRATEGY, PLAY_HAND_A, PLAY_HAND_B, PLAY_HAND_C, REVEAL, SUDDEN_DEATH, GAME_OVER
}

data class GameState(
    val phase: GamePhase = GamePhase.IDLE,
    val player: Player = Player("p1", "Player"),
    val opponent: Player = Player("p2", "Opponent"),
    val currentHandIndex: Int = 0,
    val timerSeconds: Int = 0,
    val winnerId: String? = null,
    val message: String = ""
)
