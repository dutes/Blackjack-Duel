package com.bjd.app.domain

import com.bjd.app.data.Card
import com.bjd.app.data.Hand
import com.bjd.app.data.Rank
import com.bjd.app.data.Suit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BlackjackRulesTest {

    @Test
    fun calculateScore_numericCards_returnsSum() {
        val cards = listOf(
            Card(Suit.HEARTS, Rank.TWO),
            Card(Suit.CLUBS, Rank.FIVE)
        )
        assertEquals(7, BlackjackRules.calculateScore(cards))
    }

    @Test
    fun calculateScore_faceCards_valueIsTen() {
        val cards = listOf(
            Card(Suit.HEARTS, Rank.JACK),
            Card(Suit.CLUBS, Rank.QUEEN)
        )
        assertEquals(20, BlackjackRules.calculateScore(cards))
    }

    @Test
    fun calculateScore_aceLow_returnsCorrectValue() {
        val cards = listOf(
            Card(Suit.HEARTS, Rank.ACE),
            Card(Suit.CLUBS, Rank.NINE),
            Card(Suit.DIAMONDS, Rank.FIVE)
        )
        // 11 + 9 + 5 = 25 -> Ace becomes 1 -> 1 + 9 + 5 = 15
        assertEquals(15, BlackjackRules.calculateScore(cards))
    }

    @Test
    fun calculateScore_aceHigh_returnsCorrectValue() {
        val cards = listOf(
            Card(Suit.HEARTS, Rank.ACE),
            Card(Suit.CLUBS, Rank.NINE)
        )
        // 11 + 9 = 20
        assertEquals(20, BlackjackRules.calculateScore(cards))
    }

    @Test
    fun isBusted_scoreOver21_returnsTrue() {
        val hand = Hand("test", listOf(
            Card(Suit.HEARTS, Rank.KING),
            Card(Suit.CLUBS, Rank.QUEEN),
            Card(Suit.DIAMONDS, Rank.TWO)
        ))
        // 10 + 10 + 2 = 22
        assertTrue(BlackjackRules.isBusted(hand))
    }

    @Test
    fun isNaturalBlackjack_aceAndTen_returnsTrue() {
        val hand = Hand("test", listOf(
            Card(Suit.HEARTS, Rank.ACE),
            Card(Suit.CLUBS, Rank.KING)
        ))
        assertTrue(BlackjackRules.isNaturalBlackjack(hand))
    }
}
