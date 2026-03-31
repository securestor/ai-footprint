package com.aifootprint.jetbrains.statusbar

import com.aifootprint.jetbrains.service.FootprintService
import com.aifootprint.jetbrains.settings.FootprintSettings
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.StatusBar
import com.intellij.openapi.wm.StatusBarWidget
import com.intellij.openapi.wm.StatusBarWidgetFactory
import com.intellij.util.Consumer
import java.awt.event.MouseEvent

class FootprintStatusBarFactory : StatusBarWidgetFactory {
    override fun getId(): String = "AiFootprintStatusBar"
    override fun getDisplayName(): String = "AI Footprint"
    override fun isAvailable(project: Project): Boolean =
        FootprintSettings.getInstance().state.showStatusBar

    override fun createWidget(project: Project): StatusBarWidget =
        FootprintStatusBarWidget(project)
}

class FootprintStatusBarWidget(private val project: Project) :
    StatusBarWidget, StatusBarWidget.TextPresentation {

    private var statusBar: StatusBar? = null
    private var matchCount = 0

    override fun ID(): String = "AiFootprintStatusBar"

    override fun install(statusBar: StatusBar) {
        this.statusBar = statusBar
        FootprintService.getInstance(project).addListener {
            val report = FootprintService.getInstance(project).lastReport
            matchCount = report?.matches?.size ?: 0
            statusBar.updateWidget(ID())
        }
    }

    override fun getPresentation(): StatusBarWidget.WidgetPresentation = this

    override fun getText(): String {
        return if (matchCount > 0) "AI: $matchCount match(es)" else "AI: ✓"
    }

    override fun getTooltipText(): String {
        val report = FootprintService.getInstance(project).lastReport
        return if (report != null) {
            "AI Footprint: ${report.matches.size} match(es) in ${report.filesAnalyzed} files"
        } else {
            "AI Footprint: no scan results"
        }
    }

    override fun getAlignment(): Float = 0f

    override fun getClickConsumer(): Consumer<MouseEvent>? = Consumer {
        // Open the tool window on click
        val toolWindow = com.intellij.openapi.wm.ToolWindowManager
            .getInstance(project)
            .getToolWindow("AI Footprint")
        toolWindow?.show()
    }

    override fun dispose() {
        statusBar = null
    }
}
