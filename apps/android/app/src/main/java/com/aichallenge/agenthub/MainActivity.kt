package com.aichallenge.agenthub

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import com.aichallenge.agenthub.ui.AgentHubApp
import com.aichallenge.agenthub.ui.AppViewModel
import com.aichallenge.agenthub.ui.theme.AgentHubTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            AgentHubTheme(dynamicColor = false) {
                AgentHubRoot()
            }
        }
    }
}

@Composable
private fun AgentHubRoot() {
    val context = LocalContext.current
    val viewModel: AppViewModel = viewModel(factory = AppViewModel.factory(context))
    val state by viewModel.state.collectAsState()
    AgentHubApp(state = state, viewModel = viewModel)
}
