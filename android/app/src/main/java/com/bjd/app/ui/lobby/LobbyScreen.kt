package com.bjd.app.ui.lobby

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun LobbyScreen(
    onPlayClick: () -> Unit
) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = "Blackjack Duel",
            style = MaterialTheme.typography.displayLarge
        )
        Spacer(modifier = Modifier.height(32.dp))
        Button(onClick = onPlayClick) {
            Text(text = "Find Match")
        }
    }
}
