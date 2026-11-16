package com.bjd.app.domain

import com.bjd.app.data.Card
import com.bjd.app.data.Hand
import com.bjd.app.data.Rank

object BlackjackRules {

    fun calculateScore(cards: List<Card>): Int {
        var score = 0
        var aceCount = 0

        for (card in cards) {
            score += card.rank.value
            if (card.rank == Rank.ACE) {
                aceCount++
            }
        }

        while (score > 21 && aceCount > 0) {
            score -= 10
            aceCount--
        }

        return score
    }

    fun isBusted(hand: Hand): Boolean {
        return calculateScore(hand.cards) > 21
    }

    fun isNaturalBlackjack(hand: Hand): Boolean {
        return hand.cards.size == 2 && calculateScore(hand.cards) == 21
    }

    // Returns 1 for win, 0 for push, -1 for loss
    fun compareHands(playerHand: Hand, opponentHand: Hand): Int {
        val playerScore = calculateScore(playerHand.cards)
        val opponentScore = calculateScore(opponentHand.cards)
        val playerBust = isBusted(playerHand)
        val opponentBust = isBusted(opponentHand)

        if (playerBust && opponentBust) return 0 // Both bust = Push (or loss depending on specific house rules, usually push in friendly games, but casino is loss. Design doc says "Loss: ... or player busts and opponent does not". Implies if both bust, it might be push or double loss. Let's assume Push for fairness in Duel)
        if (playerBust) return -1
        if (opponentBust) return 1

        if (playerScore > opponentScore) return 1
        if (playerScore < opponentScore) return -1
        return 0
    }
}
