package com.bjd.app.ui.game

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.bjd.app.data.Hand
import com.bjd.app.domain.BlackjackRules

@Composable
fun HandView(
    hand: Hand,
    isActive: Boolean,
    isFanned: Boolean = false,
    onHandClick: () -> Unit = {},
    onCardClick: (Int) -> Unit = {},
    modifier: Modifier = Modifier
) {
    val borderColor = if (isActive) Color.Yellow else Color.Transparent
    val score = BlackjackRules.calculateScore(hand.cards)
    
    Column(
        modifier = modifier
            .border(2.dp, borderColor, RoundedCornerShape(8.dp))
            .padding(4.dp)
            .clickable { onHandClick() },
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        if (hand.isDoubled && hand.cards.size == 3) {
            Box(contentAlignment = Alignment.Center) {
                Row(horizontalArrangement = Arrangement.Center) {
                    // First two cards
                    for (i in 0..1) {
                        Box(modifier = Modifier.clickable { onCardClick(i) }) {
                            CardView(card = hand.cards[i])
                        }
                    }
                }
                // Third card rotated on top
                Box(modifier = Modifier
                    .rotate(90f)
                    .clickable { onCardClick(2) }) {
                    CardView(card = hand.cards[2])
                }
            }
        } else if (isFanned) {
            // Fanned Layout
            Row(
                horizontalArrangement = Arrangement.spacedBy((-30).dp)
            ) {
                hand.cards.forEachIndexed { index, card ->
                    Box(modifier = Modifier.clickable { onCardClick(index) }) {
                        CardView(card = card)
                    }
                }
            }
        } else {
            Row(
                horizontalArrangement = Arrangement.Center
            ) {
                hand.cards.forEachIndexed { index, card ->
                    Box(modifier = Modifier.clickable { onCardClick(index) }) {
                        CardView(card = card)
                    }
                }
            }
        }
        
        Spacer(modifier = Modifier.height(4.dp))
        
        // Score / Status
        val allFaceUp = hand.cards.isNotEmpty() && hand.cards.all { it.isFaceUp }
        if (hand.isBusted) {
            Text("BUST", color = Color.Red, style = MaterialTheme.typography.labelSmall)
        } else if (hand.isDoubled && allFaceUp) {
            Text("DOUBLE ($score)", color = Color.Magenta, style = MaterialTheme.typography.labelSmall)
        } else if (allFaceUp) {
            Text("$score", color = Color.White, style = MaterialTheme.typography.labelSmall)
        }
    }
}
