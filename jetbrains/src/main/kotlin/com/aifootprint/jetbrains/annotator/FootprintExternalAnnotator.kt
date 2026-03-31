package com.aifootprint.jetbrains.annotator

import com.aifootprint.jetbrains.model.ScanMatch
import com.aifootprint.jetbrains.service.FootprintService
import com.aifootprint.jetbrains.settings.FootprintSettings
import com.intellij.lang.annotation.AnnotationHolder
import com.intellij.lang.annotation.ExternalAnnotator
import com.intellij.lang.annotation.HighlightSeverity
import com.intellij.openapi.editor.Editor
import com.intellij.psi.PsiFile

/**
 * External annotator that highlights AI-attributed lines with
 * warning/info annotations in the editor.
 */
class FootprintExternalAnnotator : ExternalAnnotator<PsiFile, List<ScanMatch>>() {

    override fun collectInformation(file: PsiFile): PsiFile = file

    override fun collectInformation(file: PsiFile, editor: Editor, hasErrors: Boolean): PsiFile = file

    override fun doAnnotate(file: PsiFile): List<ScanMatch> {
        val project = file.project
        val basePath = project.basePath ?: return emptyList()
        val filePath = file.virtualFile?.path ?: return emptyList()
        val relativePath = filePath.removePrefix("$basePath/")

        return FootprintService.getInstance(project).getCachedMatches(relativePath)
    }

    override fun apply(file: PsiFile, matches: List<ScanMatch>, holder: AnnotationHolder) {
        val settings = FootprintSettings.getInstance().state
        if (!settings.overlayEnabled) return

        val document = file.viewProvider.document ?: return

        val severity = when (settings.annotationSeverity) {
            "ERROR" -> HighlightSeverity.ERROR
            "WARNING" -> HighlightSeverity.WARNING
            "INFO" -> HighlightSeverity.INFORMATION
            else -> HighlightSeverity.WARNING
        }

        for (match in matches) {
            val lineIndex = match.line - 1
            if (lineIndex < 0 || lineIndex >= document.lineCount) continue

            val startOffset = document.getLineStartOffset(lineIndex)
            val endOffset = document.getLineEndOffset(lineIndex)

            val tag = if (match.snippet != null) {
                val label = match.snippet.model ?: match.snippet.source
                "${match.matchType ?: "snippet"} [$label]"
            } else {
                "pattern [${match.pattern}]"
            }

            val similarity = match.similarity?.let { " (${(it * 100).toInt()}%)" } ?: ""
            val message = "AI Footprint: $tag (${match.confidence})$similarity"

            holder.newAnnotation(severity, message)
                .range(startOffset, endOffset)
                .tooltip(buildTooltip(match))
                .create()
        }
    }

    private fun buildTooltip(match: ScanMatch): String {
        val sb = StringBuilder("<html><b>AI Footprint</b><br>")
        sb.append("Type: ${match.matchType ?: "unknown"}<br>")
        sb.append("Confidence: ${match.confidence}<br>")

        match.similarity?.let {
            sb.append("Similarity: ${(it * 100).toInt()}%<br>")
        }

        match.snippet?.let { snippet ->
            snippet.model?.let { sb.append("Model: $it<br>") }
            sb.append("Source: ${snippet.source}<br>")
            snippet.tool?.let { sb.append("Tool: $it<br>") }
        }

        match.pattern?.let {
            sb.append("Pattern: $it<br>")
        }

        sb.append("</html>")
        return sb.toString()
    }
}
