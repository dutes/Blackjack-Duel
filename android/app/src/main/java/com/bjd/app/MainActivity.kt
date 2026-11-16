package com.bjd.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import com.bjd.app.ui.theme.BlackjackDuelTheme

import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.lifecycle.viewmodel.compose.viewModel
import com.bjd.app.ui.lobby.LobbyScreen
import com.bjd.app.ui.game.GameScreen
import com.bjd.app.viewmodel.GameViewModel

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            BlackjackDuelTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    val navController = rememberNavController()
                    val gameViewModel: GameViewModel = viewModel()

                    NavHost(navController = navController, startDestination = "lobby") {
                        composable("lobby") {
                            LobbyScreen(
                                onPlayClick = {
                                    gameViewModel.startGame()
                                    navController.navigate("game")
                                }
                            )
                        }
                        composable("game") {
                            GameScreen(
                                viewModel = gameViewModel,
                                onGameOver = {
                                    navController.popBackStack()
                                }
                            )
                        }
                    }
                }
            }
        }
    }
}
