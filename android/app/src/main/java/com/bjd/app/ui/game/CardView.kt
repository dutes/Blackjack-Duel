package com.bjd.app.ui.game

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.bjd.app.data.Card
import com.bjd.app.data.Suit

@Composable
fun CardView(
    card: Card,
    modifier: Modifier = Modifier
) {
    val cardColor = if (card.isFaceUp) Color.White else Color(0xFF1E88E5) // Blue back
    val textColor = if (card.suit == Suit.HEARTS || card.suit == Suit.DIAMONDS) Color.Red else Color.Black

    Card(
        modifier = modifier
            .width(60.dp)
            .height(90.dp)
            .padding(2.dp),
        shape = RoundedCornerShape(4.dp),
        colors = CardDefaults.cardColors(containerColor = cardColor),
        elevation = CardDefaults.cardElevation(defaultElevation = 4.dp)
    ) {
        if (card.isFaceUp) {
            Column(
                modifier = Modifier.fillMaxSize().padding(4.dp),
                verticalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = getRankSymbol(card.rank),
                    color = textColor,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = getSuitSymbol(card.suit),
                    color = textColor,
                    fontSize = 20.sp,
                    modifier = Modifier.align(Alignment.CenterHorizontally)
                )
            }
        }
    }
}

private fun getSuitSymbol(suit: Suit): String = when (suit) {
    Suit.HEARTS -> "♥"
    Suit.DIAMONDS -> "♦"
    Suit.CLUBS -> "♣"
    Suit.SPADES -> "♠"
}

private fun getRankSymbol(rank: com.bjd.app.data.Rank): String = when (rank) {
    com.bjd.app.data.Rank.ACE -> "A"
    com.bjd.app.data.Rank.JACK -> "J"
    com.bjd.app.data.Rank.QUEEN -> "Q"
    com.bjd.app.data.Rank.KING -> "K"
    else -> rank.value.toString()
}
