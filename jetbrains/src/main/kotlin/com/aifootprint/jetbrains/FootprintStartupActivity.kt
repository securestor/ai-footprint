package com.aifootprint.jetbrains

import com.aifootprint.jetbrains.service.FootprintService
import com.aifootprint.jetbrains.settings.FootprintSettings
import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity

/**
 * Runs an initial project scan on IDE startup (if enabled).
 */
class FootprintStartupActivity : ProjectActivity {

    override suspend fun execute(project: Project) {
        val settings = FootprintSettings.getInstance().state
        if (!settings.enableOnSave) return

        val service = FootprintService.getInstance(project)
        service.scanProject { report ->
            if (report != null) {
                com.intellij.openapi.diagnostic.Logger.getInstance(FootprintStartupActivity::class.java)
                    .info("AI Footprint: initial scan found ${report.matches.size} match(es) in ${report.filesAnalyzed} files")
            }
        }
    }
}
