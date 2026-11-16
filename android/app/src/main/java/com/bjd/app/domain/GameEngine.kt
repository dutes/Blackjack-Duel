package com.bjd.app.domain

import com.bjd.app.data.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.random.Random

class GameEngine {

    private val _gameState = MutableStateFlow(GameState())
    val gameState: StateFlow<GameState> = _gameState.asStateFlow()

    private val deck = mutableListOf<Card>()
    private var timerJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())

    init {
        resetGame()
    }

    fun cancel() {
        timerJob?.cancel()
        scope.cancel()
    }

    private fun createDeck() {
        deck.clear()
        for (suit in Suit.entries) {
            for (rank in Rank.entries) {
                deck.add(Card(suit, rank))
            }
        }
        deck.shuffle(Random(System.currentTimeMillis()))
    }

    private fun drawCard(faceUp: Boolean = true): Card {
        if (deck.isEmpty()) createDeck()
        return deck.removeAt(0).copy(isFaceUp = faceUp)
    }

    fun startGame() {
        createDeck()

        val playerHands = MutableList(3) { i -> Hand(id = ('A' + i).toString()) }
        val opponentHands = MutableList(3) { i -> Hand(id = ('A' + i).toString()) }

        for (i in 0..2) {
            var pHand = playerHands[i].addCard(drawCard()).addCard(drawCard())
            if (BlackjackRules.isNaturalBlackjack(pHand)) {
                pHand = pHand.copy(isNaturalBlackjack = true, isLocked = true)
            }
            playerHands[i] = pHand

            var oHand = opponentHands[i].addCard(drawCard(faceUp = false)).addCard(drawCard(faceUp = false))
            if (BlackjackRules.isNaturalBlackjack(oHand)) {
                oHand = oHand.copy(isNaturalBlackjack = true)
            }
            opponentHands[i] = oHand
        }

        _gameState.value = GameState(
            phase = GamePhase.STRATEGY,
            player = Player("p1", "Player", hands = playerHands),
            opponent = Player("p2", "Opponent", hands = opponentHands),
            timerSeconds = TIMER_SECONDS
        )
        startTimer(TIMER_SECONDS) { endStrategyPhase() }
    }

    private fun startTimer(seconds: Int, onFinish: () -> Unit) {
        timerJob?.cancel()
        timerJob = scope.launch {
            var timeLeft = seconds
            while (timeLeft > 0) {
                _gameState.value = _gameState.value.copy(timerSeconds = timeLeft)
                delay(1000)
                timeLeft--
            }
            _gameState.value = _gameState.value.copy(timerSeconds = 0)
            onFinish()
        }
    }

    fun doubleHand(handIndex: Int) {
        val state = _gameState.value
        if (state.phase != GamePhase.STRATEGY) return

        val hand = state.player.hands[handIndex]
        if (hand.isNaturalBlackjack || state.player.hands.any { it.isDoubled }) return

        val handWithCard = hand.addCard(drawCard())
        val newHand = handWithCard.copy(
            isDoubled = true,
            isLocked = true,
            isBusted = BlackjackRules.isBusted(handWithCard)
        )
        _gameState.value = state.withPlayerHand(handIndex, newHand)
    }

    fun redrawCard(handIndex: Int, cardIndex: Int) {
        val state = _gameState.value
        if (state.phase != GamePhase.STRATEGY) return

        val hand = state.player.hands[handIndex]
        if (hand.isLocked || state.player.hands.any { it.hasRedrawn }) return
        if (cardIndex >= hand.cards.size) return

        val newCards = hand.cards.toMutableList().also { it[cardIndex] = drawCard() }
        _gameState.value = state.withPlayerHand(handIndex, hand.copy(cards = newCards, hasRedrawn = true))
    }

    fun endStrategyPhase() {
        timerJob?.cancel()
        _gameState.value = _gameState.value.copy(
            phase = GamePhase.PLAY_HAND_A,
            currentHandIndex = 0,
            timerSeconds = TIMER_SECONDS
        )
        startTimer(TIMER_SECONDS) { stand() }
    }

    fun hit() {
        val state = _gameState.value
        val handIndex = state.currentHandIndex
        if (state.phase !in PLAY_PHASES) return

        val hand = state.player.hands[handIndex]
        if (hand.isLocked) return

        val newHand = hand.addCard(drawCard()).let { h ->
            if (BlackjackRules.isBusted(h)) h.copy(isBusted = true) else h
        }
        _gameState.value = state.withPlayerHand(handIndex, newHand)
    }

    fun stand() {
        val state = _gameState.value
        val handIndex = state.currentHandIndex
        timerJob?.cancel()

        val stateWithLockedHand = state.withPlayerHand(
            handIndex,
            state.player.hands[handIndex].copy(isLocked = true)
        )

        val nextPhase = when (state.phase) {
            GamePhase.PLAY_HAND_A -> GamePhase.PLAY_HAND_B
            GamePhase.PLAY_HAND_B -> GamePhase.PLAY_HAND_C
            GamePhase.PLAY_HAND_C -> GamePhase.REVEAL
            else -> return
        }

        if (nextPhase == GamePhase.REVEAL) {
            _gameState.value = calculateFinalScores(stateWithLockedHand)
        } else {
            _gameState.value = stateWithLockedHand.copy(
                phase = nextPhase,
                currentHandIndex = handIndex + 1,
                timerSeconds = TIMER_SECONDS
            )
            startTimer(TIMER_SECONDS) { stand() }
        }
    }

    private fun calculateFinalScores(state: GameState): GameState {
        val opponentHands = state.opponent.hands.map { hand ->
            var h = hand.copy(cards = hand.cards.map { it.copy(isFaceUp = true) })
            while (BlackjackRules.calculateScore(h.cards) < 17) {
                h = h.addCard(drawCard())
            }
            h
        }

        var pScore = 0
        var oScore = 0
        for (i in 0..2) {
            val result = BlackjackRules.compareHands(state.player.hands[i], opponentHands[i])
            val pPoints = if (state.player.hands[i].isDoubled) 2 else 1
            if (result > 0) pScore += pPoints
            else if (result < 0) oScore += 1
        }

        val winnerId = when {
            pScore > oScore -> state.player.id
            oScore > pScore -> state.opponent.id
            else -> null
        }
        val message = when (winnerId) {
            state.player.id -> "You Win!"
            state.opponent.id -> "You Lose!"
            else -> "Draw!"
        }

        return state.copy(
            phase = GamePhase.REVEAL,
            player = state.player.copy(score = pScore),
            opponent = state.opponent.copy(hands = opponentHands, score = oScore),
            winnerId = winnerId,
            message = message,
            currentHandIndex = 0,
            timerSeconds = 0
        )
    }

    fun resetGame() {
        timerJob?.cancel()
        _gameState.value = GameState()
    }

    companion object {
        private const val TIMER_SECONDS = 30
        private val PLAY_PHASES = setOf(GamePhase.PLAY_HAND_A, GamePhase.PLAY_HAND_B, GamePhase.PLAY_HAND_C)
    }
}

private fun GameState.withPlayerHand(index: Int, hand: Hand): GameState {
    val newHands = player.hands.toMutableList().also { it[index] = hand }
    return copy(player = player.copy(hands = newHands))
}
