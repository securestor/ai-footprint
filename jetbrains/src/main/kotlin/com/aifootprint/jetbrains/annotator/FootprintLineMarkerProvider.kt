package com.aifootprint.jetbrains.annotator

import com.aifootprint.jetbrains.service.FootprintService
import com.aifootprint.jetbrains.settings.FootprintSettings
import com.intellij.codeInsight.daemon.LineMarkerInfo
import com.intellij.codeInsight.daemon.LineMarkerProvider
import com.intellij.icons.AllIcons
import com.intellij.openapi.editor.markup.GutterIconRenderer
import com.intellij.psi.PsiElement
import com.intellij.psi.PsiFile

/**
 * Gutter icon line marker — shows an AI icon in the gutter for detected lines.
 */
class FootprintLineMarkerProvider : LineMarkerProvider {

    override fun getLineMarkerInfo(element: PsiElement): LineMarkerInfo<*>? {
        if (!FootprintSettings.getInstance().state.showGutterIcons) return null

        // Only process the first element on each line (attached to the PsiFile level)
        val file = element.containingFile ?: return null
        val project = element.project
        val basePath = project.basePath ?: return null
        val filePath = file.virtualFile?.path ?: return null
        val relativePath = filePath.removePrefix("$basePath/")

        val document = file.viewProvider.document ?: return null
        val offset = element.textRange.startOffset
        val lineNumber = document.getLineNumber(offset) + 1

        // Check if this element is the first on its line
        val lineStartOffset = document.getLineStartOffset(lineNumber - 1)
        if (offset != lineStartOffset) return null

        val matches = FootprintService.getInstance(project).getCachedMatches(relativePath)
        val match = matches.find { it.line == lineNumber } ?: return null

        val tag = if (match.snippet != null) {
            val label = match.snippet.model ?: match.snippet.source
            "${match.matchType ?: "snippet"} [$label]"
        } else {
            "pattern [${match.pattern}]"
        }

        val similarity = match.similarity?.let { " ${(it * 100).toInt()}%" } ?: ""
        val tooltip = "AI: $tag (${match.confidence})$similarity"

        return LineMarkerInfo(
            element,
            element.textRange,
            AllIcons.General.Information,
            { tooltip },
            null,
            GutterIconRenderer.Alignment.RIGHT,
            { tooltip }
        )
    }
}
