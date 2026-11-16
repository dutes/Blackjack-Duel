package com.bjd.app.ui.game

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import com.bjd.app.data.GamePhase
import com.bjd.app.viewmodel.GameViewModel

private val FELT_GREEN = Color(0xFF2E7D32)
private val OPPONENT_AREA_HEIGHT = 120.dp
private val BOTTOM_CONTROLS_HEIGHT = 200.dp
private val COLLAPSED_HAND_WIDTH = 100.dp
private val EXPANDED_HAND_WIDTH = 300.dp
private val ANIMATION_DURATION_MS = 500

private val PLAY_PHASES = setOf(GamePhase.PLAY_HAND_A, GamePhase.PLAY_HAND_B, GamePhase.PLAY_HAND_C)

@Composable
fun GameScreen(
    viewModel: GameViewModel,
    onGameOver: () -> Unit
) {
    val gameState by viewModel.gameState.collectAsState()
    val selectedHandIndex by viewModel.selectedHandIndex.collectAsState()
    val isRedrawMode by viewModel.isRedrawMode.collectAsState()
    val isDoubleMode by viewModel.isDoubleMode.collectAsState()

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .background(FELT_GREEN)
            .padding(16.dp)
    ) {
        val maxWidth = maxWidth
        val maxHeight = maxHeight

        // Opponent Area (Top)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .align(Alignment.TopCenter),
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            gameState.opponent.hands.forEach { hand ->
                HandView(hand = hand, isActive = false, isFanned = true)
            }
        }

        // Center Info (Timer, Phase, Message)
        Column(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .padding(top = OPPONENT_AREA_HEIGHT),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = "Phase: ${gameState.phase}",
                color = Color.White,
                style = MaterialTheme.typography.titleMedium
            )
            Text(
                text = "Time: ${gameState.timerSeconds}",
                color = if (gameState.timerSeconds < 5) Color.Red else Color.White,
                style = MaterialTheme.typography.titleLarge
            )
            if (gameState.message.isNotEmpty()) {
                Text(
                    text = gameState.message,
                    color = Color.Yellow,
                    style = MaterialTheme.typography.headlineMedium
                )
            }
        }

        // Player Hands with Animation
        gameState.player.hands.forEachIndexed { index, hand ->
            val isCurrentHand = (gameState.phase == GamePhase.PLAY_HAND_A && index == 0) ||
                                (gameState.phase == GamePhase.PLAY_HAND_B && index == 1) ||
                                (gameState.phase == GamePhase.PLAY_HAND_C && index == 2)
            val isSelected = gameState.phase == GamePhase.STRATEGY && selectedHandIndex == index

            val bottomRowY = maxHeight - BOTTOM_CONTROLS_HEIGHT
            val centerStageY = maxHeight / 2 - 50.dp
            val targetY = if (isCurrentHand) centerStageY else bottomRowY

            val handWidth = if (isCurrentHand) EXPANDED_HAND_WIDTH else COLLAPSED_HAND_WIDTH
            val spacing = (maxWidth - (COLLAPSED_HAND_WIDTH * 3)) / 4
            val bottomRowX = spacing + (COLLAPSED_HAND_WIDTH + spacing) * index
            val centerStageX = (maxWidth - handWidth) / 2
            val targetX = if (isCurrentHand) centerStageX else bottomRowX

            val animatedX by animateDpAsState(targetValue = targetX, animationSpec = tween(ANIMATION_DURATION_MS))
            val animatedY by animateDpAsState(targetValue = targetY, animationSpec = tween(ANIMATION_DURATION_MS))
            val animatedWidth by animateDpAsState(targetValue = handWidth, animationSpec = tween(ANIMATION_DURATION_MS))
            val zIndex = if (isCurrentHand) 10f else 1f

            Column(
                modifier = Modifier
                    .offset(x = animatedX, y = animatedY)
                    .width(animatedWidth)
                    .zIndex(zIndex),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    text = "Hand ${index + 1}",
                    color = Color.White,
                    style = MaterialTheme.typography.labelMedium
                )
                HandView(
                    hand = hand,
                    isActive = isCurrentHand || isSelected,
                    isFanned = isCurrentHand || gameState.phase == GamePhase.REVEAL,
                    onHandClick = {
                        if (gameState.phase == GamePhase.STRATEGY) {
                            if (isDoubleMode) viewModel.doubleHand(index)
                            else viewModel.selectHand(index)
                        }
                    },
                    onCardClick = { cardIndex ->
                        if (gameState.phase == GamePhase.STRATEGY) {
                            if (isRedrawMode) viewModel.redrawCard(index, cardIndex)
                            else if (isDoubleMode) viewModel.doubleHand(index)
                            else viewModel.selectHand(index)
                        }
                    }
                )
            }
        }

        // Controls (Bottom)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .align(Alignment.BottomCenter)
                .padding(bottom = 16.dp),
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            when {
                gameState.phase == GamePhase.STRATEGY -> {
                    Button(onClick = { viewModel.endStrategyPhase() }) {
                        Text("Done")
                    }
                    Button(
                        onClick = { viewModel.toggleDoubleMode() },
                        enabled = !gameState.player.hands.any { it.isDoubled },
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (isDoubleMode) Color.Yellow else MaterialTheme.colorScheme.primary,
                            contentColor = if (isDoubleMode) Color.Black else Color.White
                        )
                    ) {
                        Text(if (isDoubleMode) "Cancel Double" else "Double")
                    }
                    Button(
                        onClick = { viewModel.toggleRedrawMode() },
                        enabled = !gameState.player.hands.any { it.hasRedrawn },
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (isRedrawMode) Color.Yellow else MaterialTheme.colorScheme.primary,
                            contentColor = if (isRedrawMode) Color.Black else Color.White
                        )
                    ) {
                        Text(if (isRedrawMode) "Cancel Redraw" else "Redraw")
                    }
                }
                gameState.phase in PLAY_PHASES -> {
                    Button(onClick = { viewModel.hit() }) { Text("Hit") }
                    Button(onClick = { viewModel.stand() }) { Text("Stand") }
                }
            }
        }

        // Results Overlay
        if (gameState.phase == GamePhase.REVEAL) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.7f))
                    .zIndex(20f),
                contentAlignment = Alignment.Center
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    Text(
                        text = gameState.message,
                        color = if (gameState.message.contains("Win")) Color.Green else Color.Red,
                        style = MaterialTheme.typography.displayMedium
                    )
                    Text(
                        text = "Player: ${gameState.player.score} - Opponent: ${gameState.opponent.score}",
                        color = Color.White,
                        style = MaterialTheme.typography.headlineMedium
                    )
                    Button(
                        onClick = { viewModel.startGame() },
                        colors = ButtonDefaults.buttonColors(containerColor = Color.Blue)
                    ) {
                        Text("New Game", style = MaterialTheme.typography.titleLarge)
                    }
                    Button(
                        onClick = {
                            viewModel.resetGame()
                            onGameOver()
                        }
                    ) {
                        Text("Back to Lobby", style = MaterialTheme.typography.titleLarge)
                    }
                }
            }
        }
    }
}
