package com.aifootprint.jetbrains.settings

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage

@State(name = "AiFootprintSettings", storages = [Storage("AiFootprintSettings.xml")])
class FootprintSettings : PersistentStateComponent<FootprintSettings.State> {

    data class State(
        var cliPath: String = "ai-footprint",
        var enableOnSave: Boolean = true,
        var fuzzyThreshold: Double = 0.6,
        var astThreshold: Double = 0.65,
        var enableTreeSitter: Boolean = true,
        var overlayEnabled: Boolean = true,
        var annotationSeverity: String = "WARNING",
        var showGutterIcons: Boolean = true,
        var showStatusBar: Boolean = true,
        var defaultModel: String = "",
        var defaultSource: String = "ai",
    )

    private var myState = State()

    override fun getState(): State = myState

    override fun loadState(state: State) {
        myState = state
    }

    companion object {
        fun getInstance(): FootprintSettings =
            ApplicationManager.getApplication().getService(FootprintSettings::class.java)
    }
}
