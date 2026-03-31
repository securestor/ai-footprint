package com.aifootprint.jetbrains.toolwindow

import com.aifootprint.jetbrains.model.ScanReport
import com.aifootprint.jetbrains.service.FootprintService
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.content.ContentFactory
import com.intellij.ui.table.JBTable
import java.awt.BorderLayout
import javax.swing.*
import javax.swing.table.DefaultTableModel

/**
 * Tool window factory — displays the scan report in a bottom panel.
 */
class FootprintToolWindowFactory : ToolWindowFactory, DumbAware {

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = FootprintToolWindowPanel(project)
        val content = ContentFactory.getInstance().createContent(panel, "Scan Results", false)
        toolWindow.contentManager.addContent(content)
    }
}

class FootprintToolWindowPanel(private val project: Project) : JPanel(BorderLayout()) {

    private val tableModel = DefaultTableModel(
        arrayOf("File", "Line", "Type", "Tag", "Confidence", "Similarity"), 0
    )
    private val table = JBTable(tableModel)
    private val summaryLabel = JLabel("No scan results yet. Run a scan from Tools → AI Footprint.")
    private val scanButton = JButton("Scan Project")
    private val refreshButton = JButton("Refresh")

    init {
        // Summary bar
        val topPanel = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.X_AXIS)
            border = BorderFactory.createEmptyBorder(5, 10, 5, 10)
            add(summaryLabel)
            add(Box.createHorizontalGlue())
            add(refreshButton)
            add(Box.createHorizontalStrut(5))
            add(scanButton)
        }
        add(topPanel, BorderLayout.NORTH)

        // Table
        table.autoResizeMode = JTable.AUTO_RESIZE_ALL_COLUMNS
        table.rowHeight = 22
        add(JBScrollPane(table), BorderLayout.CENTER)

        // Actions
        scanButton.addActionListener { runScan() }
        refreshButton.addActionListener { refreshFromCache() }

        // Listen for service updates
        FootprintService.getInstance(project).addListener { refreshFromCache() }

        // Initial load
        refreshFromCache()
    }

    private fun runScan() {
        scanButton.isEnabled = false
        summaryLabel.text = "Scanning..."
        FootprintService.getInstance(project).scanProject { report ->
            SwingUtilities.invokeLater {
                scanButton.isEnabled = true
                if (report != null) {
                    updateTable(report)
                } else {
                    summaryLabel.text = "Scan failed. Check that ai-footprint CLI is installed."
                }
            }
        }
    }

    private fun refreshFromCache() {
        val report = FootprintService.getInstance(project).lastReport
        if (report != null) {
            SwingUtilities.invokeLater { updateTable(report) }
        }
    }

    private fun updateTable(report: ScanReport) {
        summaryLabel.text = "Files: ${report.filesAnalyzed} | " +
                "AI-attributed: ${report.aiAttributedFiles} | " +
                "Suspicious: ${report.unattributedSuspicious} | " +
                "Top model: ${report.topModel ?: "—"}"

        tableModel.rowCount = 0
        for (match in report.matches) {
            val tag = if (match.snippet != null) {
                "${match.snippet.model ?: match.snippet.source}"
            } else {
                match.pattern ?: "—"
            }
            val similarity = match.similarity?.let { "${(it * 100).toInt()}%" } ?: "—"
            tableModel.addRow(
                arrayOf(match.file, match.line, match.matchType ?: "—", tag, match.confidence, similarity)
            )
        }
    }
}
