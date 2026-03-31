package com.aifootprint.jetbrains.settings

import com.intellij.openapi.options.Configurable
import javax.swing.*

class FootprintSettingsConfigurable : Configurable {

    private var panel: JPanel? = null
    private var cliPathField: JTextField? = null
    private var enableOnSaveBox: JCheckBox? = null
    private var fuzzyThresholdField: JTextField? = null
    private var astThresholdField: JTextField? = null
    private var treeSitterBox: JCheckBox? = null
    private var overlayBox: JCheckBox? = null
    private var gutterBox: JCheckBox? = null
    private var defaultModelField: JTextField? = null
    private var defaultSourceField: JTextField? = null

    override fun getDisplayName(): String = "AI Footprint"

    override fun createComponent(): JComponent {
        val settings = FootprintSettings.getInstance().state

        panel = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            border = BorderFactory.createEmptyBorder(10, 10, 10, 10)
        }

        fun addRow(label: String, component: JComponent) {
            val row = JPanel().apply {
                layout = BoxLayout(this, BoxLayout.X_AXIS)
                add(JLabel(label).apply { preferredSize = java.awt.Dimension(180, 25) })
                add(Box.createHorizontalStrut(10))
                add(component)
                add(Box.createHorizontalGlue())
                maximumSize = java.awt.Dimension(Int.MAX_VALUE, 30)
                alignmentX = JPanel.LEFT_ALIGNMENT
            }
            panel!!.add(row)
            panel!!.add(Box.createVerticalStrut(5))
        }

        cliPathField = JTextField(settings.cliPath, 30)
        addRow("CLI path:", cliPathField!!)

        enableOnSaveBox = JCheckBox("", settings.enableOnSave)
        addRow("Scan on save:", enableOnSaveBox!!)

        fuzzyThresholdField = JTextField(settings.fuzzyThreshold.toString(), 10)
        addRow("Fuzzy threshold:", fuzzyThresholdField!!)

        astThresholdField = JTextField(settings.astThreshold.toString(), 10)
        addRow("AST threshold:", astThresholdField!!)

        treeSitterBox = JCheckBox("", settings.enableTreeSitter)
        addRow("Enable tree-sitter:", treeSitterBox!!)

        overlayBox = JCheckBox("", settings.overlayEnabled)
        addRow("Show overlay:", overlayBox!!)

        gutterBox = JCheckBox("", settings.showGutterIcons)
        addRow("Gutter icons:", gutterBox!!)

        defaultModelField = JTextField(settings.defaultModel, 20)
        addRow("Default model:", defaultModelField!!)

        defaultSourceField = JTextField(settings.defaultSource, 20)
        addRow("Default source:", defaultSourceField!!)

        return panel!!
    }

    override fun isModified(): Boolean {
        val settings = FootprintSettings.getInstance().state
        return cliPathField?.text != settings.cliPath
                || enableOnSaveBox?.isSelected != settings.enableOnSave
                || fuzzyThresholdField?.text != settings.fuzzyThreshold.toString()
                || astThresholdField?.text != settings.astThreshold.toString()
                || treeSitterBox?.isSelected != settings.enableTreeSitter
                || overlayBox?.isSelected != settings.overlayEnabled
                || gutterBox?.isSelected != settings.showGutterIcons
                || defaultModelField?.text != settings.defaultModel
                || defaultSourceField?.text != settings.defaultSource
    }

    override fun apply() {
        val settings = FootprintSettings.getInstance()
        settings.loadState(
            FootprintSettings.State(
                cliPath = cliPathField?.text ?: "ai-footprint",
                enableOnSave = enableOnSaveBox?.isSelected ?: true,
                fuzzyThreshold = fuzzyThresholdField?.text?.toDoubleOrNull() ?: 0.6,
                astThreshold = astThresholdField?.text?.toDoubleOrNull() ?: 0.65,
                enableTreeSitter = treeSitterBox?.isSelected ?: true,
                overlayEnabled = overlayBox?.isSelected ?: true,
                showGutterIcons = gutterBox?.isSelected ?: true,
                defaultModel = defaultModelField?.text ?: "",
                defaultSource = defaultSourceField?.text ?: "ai",
            )
        )
    }
}
