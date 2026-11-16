package com.bjd.app.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.bjd.app.domain.GameEngine
import com.bjd.app.data.GameState

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class GameViewModel : ViewModel() {
    private val gameEngine = GameEngine()
    val gameState: StateFlow<GameState> = gameEngine.gameState

    // UI State for Strategy Phase
    private val _selectedHandIndex = MutableStateFlow<Int?>(null)
    val selectedHandIndex: StateFlow<Int?> = _selectedHandIndex.asStateFlow()

    fun selectHand(index: Int) {
        _selectedHandIndex.value = index
        // Optional: Reset modes if user just wants to select? 
        // For now, let's keep modes active to allow "Select -> Action" if they want, 
        // but the main flow is "Action -> Select".
        // Actually, if they tap a hand while in mode, they execute the action.
        // If they tap a hand while NOT in mode, they select it.
    }

    // Redraw Mode State
    private val _isRedrawMode = MutableStateFlow(false)
    val isRedrawMode: StateFlow<Boolean> = _isRedrawMode.asStateFlow()

    // Double Mode State
    private val _isDoubleMode = MutableStateFlow(false)
    val isDoubleMode: StateFlow<Boolean> = _isDoubleMode.asStateFlow()

    fun toggleRedrawMode() {
        _isRedrawMode.value = !_isRedrawMode.value
        if (_isRedrawMode.value) _isDoubleMode.value = false
    }

    fun toggleDoubleMode() {
        _isDoubleMode.value = !_isDoubleMode.value
        if (_isDoubleMode.value) _isRedrawMode.value = false
    }

    fun startGame() {
        gameEngine.startGame()
    }

    fun doubleHand(handIndex: Int) {
        gameEngine.doubleHand(handIndex)
        _isDoubleMode.value = false
    }

    fun redrawCard(handIndex: Int, cardIndex: Int) {
        gameEngine.redrawCard(handIndex, cardIndex)
        _isRedrawMode.value = false // Exit mode after redraw
    }

    fun endStrategyPhase() {
        gameEngine.endStrategyPhase()
    }

    fun hit() {
        gameEngine.hit()
    }

    fun stand() {
        gameEngine.stand()
    }
    
    fun resetGame() {
        gameEngine.resetGame()
    }

    override fun onCleared() {
        super.onCleared()
        gameEngine.cancel()
    }
}
