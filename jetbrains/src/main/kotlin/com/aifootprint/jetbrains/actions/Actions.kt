package com.aifootprint.jetbrains.actions

import com.aifootprint.jetbrains.service.FootprintService
import com.aifootprint.jetbrains.settings.FootprintSettings
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.Messages
import javax.swing.*

/**
 * Scan the entire project for AI-generated code.
 */
class ScanProjectAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        FootprintService.getInstance(project).scanProject { report ->
            ApplicationManager.getApplication().invokeLater {
                if (report != null) {
                    Messages.showInfoMessage(
                        project,
                        "Scan complete: ${report.matches.size} match(es) in ${report.filesAnalyzed} files.\n" +
                                "AI-attributed: ${report.aiAttributedFiles}, Suspicious: ${report.unattributedSuspicious}",
                        "AI Footprint Scan"
                    )
                } else {
                    Messages.showErrorDialog(project, "Scan failed. Ensure ai-footprint CLI is installed.", "AI Footprint")
                }
            }
        }
    }
}

/**
 * Scan the currently open file.
 */
class ScanCurrentFileAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val file = e.getData(CommonDataKeys.VIRTUAL_FILE) ?: return

        FootprintService.getInstance(project).scanFile(file) { matches ->
            ApplicationManager.getApplication().invokeLater {
                Messages.showInfoMessage(
                    project,
                    "Found ${matches.size} AI match(es) in ${file.name}.",
                    "AI Footprint Scan"
                )
            }
        }
    }
}

/**
 * Register selected code as an AI-generated snippet.
 */
class RegisterSnippetAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val editor = e.getData(CommonDataKeys.EDITOR) ?: return
        val selection = editor.selectionModel

        if (!selection.hasSelection()) {
            Messages.showWarningDialog(project, "Select code to register as an AI snippet.", "AI Footprint")
            return
        }

        val selectedText = selection.selectedText ?: return
        val settings = FootprintSettings.getInstance().state

        // Show dialog for model/source input
        val dialog = RegisterSnippetDialog(settings.defaultSource, settings.defaultModel)
        if (dialog.showAndGet()) {
            FootprintService.getInstance(project).registerSnippet(
                selectedText,
                dialog.source,
                dialog.model.ifBlank { null }
            ) { success ->
                ApplicationManager.getApplication().invokeLater {
                    if (success) {
                        Messages.showInfoMessage(project, "Snippet registered.", "AI Footprint")
                    } else {
                        Messages.showErrorDialog(project, "Failed to register snippet.", "AI Footprint")
                    }
                }
            }
        }
    }
}

class RegisterSnippetDialog(defaultSource: String, defaultModel: String) : DialogWrapper(true) {
    private val sourceField = JTextField(defaultSource, 20)
    private val modelField = JTextField(defaultModel, 20)

    val source: String get() = sourceField.text
    val model: String get() = modelField.text

    init {
        title = "Register AI Snippet"
        init()
    }

    override fun createCenterPanel(): JComponent {
        val panel = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)

            fun row(label: String, field: JTextField) {
                val row = JPanel().apply {
                    layout = BoxLayout(this, BoxLayout.X_AXIS)
                    add(JLabel(label).apply { preferredSize = java.awt.Dimension(80, 25) })
                    add(Box.createHorizontalStrut(10))
                    add(field)
                    alignmentX = LEFT_ALIGNMENT
                }
                add(row)
                add(Box.createVerticalStrut(5))
            }

            row("Source:", sourceField)
            row("Model:", modelField)
        }
        return panel
    }
}

/**
 * Toggle overlay visibility.
 */
class ToggleOverlayAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val settings = FootprintSettings.getInstance()
        val current = settings.state.overlayEnabled
        settings.loadState(settings.state.copy(overlayEnabled = !current))
        val state = if (!current) "enabled" else "disabled"
        Messages.showInfoMessage(e.project, "AI Footprint overlay $state.", "AI Footprint")
    }
}

/**
 * Show the AI Footprint tool window with the latest report.
 */
class ShowReportAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val toolWindow = com.intellij.openapi.wm.ToolWindowManager
            .getInstance(project)
            .getToolWindow("AI Footprint")
        toolWindow?.show()
    }
}
