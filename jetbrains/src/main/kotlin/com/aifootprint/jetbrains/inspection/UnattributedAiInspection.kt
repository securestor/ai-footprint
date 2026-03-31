package com.aifootprint.jetbrains.inspection

import com.aifootprint.jetbrains.service.FootprintService
import com.intellij.codeInspection.*
import com.intellij.psi.PsiFile

/**
 * Inspection that reports unattributed AI code patterns.
 * Integrates with the Problems panel.
 */
class UnattributedAiInspection : LocalInspectionTool() {

    override fun checkFile(file: PsiFile, manager: InspectionManager, isOnTheFly: Boolean): Array<ProblemDescriptor>? {
        val project = file.project
        val basePath = project.basePath ?: return null
        val filePath = file.virtualFile?.path ?: return null
        val relativePath = filePath.removePrefix("$basePath/")

        val matches = FootprintService.getInstance(project).getCachedMatches(relativePath)
        if (matches.isEmpty()) return null

        val document = file.viewProvider.document ?: return null
        val problems = mutableListOf<ProblemDescriptor>()

        for (match in matches) {
            // Only flag pattern-only matches (no registered snippet) as "unattributed"
            if (match.snippet != null) continue
            if (match.pattern == null) continue

            val lineIndex = match.line - 1
            if (lineIndex < 0 || lineIndex >= document.lineCount) continue

            val startOffset = document.getLineStartOffset(lineIndex)
            val endOffset = document.getLineEndOffset(lineIndex)
            val element = file.findElementAt(startOffset) ?: continue

            val description = "Unattributed AI code detected: ${match.pattern} (${match.confidence})"

            problems.add(
                manager.createProblemDescriptor(
                    element,
                    description,
                    isOnTheFly,
                    arrayOf(RegisterSnippetQuickFix()),
                    ProblemHighlightType.WARNING
                )
            )
        }

        return if (problems.isEmpty()) null else problems.toTypedArray()
    }
}

/**
 * Quick fix to register the detected code as a known AI snippet.
 */
class RegisterSnippetQuickFix : LocalQuickFix {
    override fun getName(): String = "Register as AI snippet"
    override fun getFamilyName(): String = "AI Footprint"

    override fun applyFix(project: com.intellij.openapi.project.Project, descriptor: ProblemDescriptor) {
        val element = descriptor.psiElement ?: return
        val document = element.containingFile?.viewProvider?.document ?: return
        val line = document.getLineNumber(element.textRange.startOffset)
        val lineText = document.getText(
            com.intellij.openapi.util.TextRange(
                document.getLineStartOffset(line),
                document.getLineEndOffset(line)
            )
        )

        FootprintService.getInstance(project).registerSnippet(lineText, "ai", null) { success ->
            if (success) {
                com.intellij.openapi.application.ApplicationManager.getApplication().invokeLater {
                    com.intellij.openapi.ui.Messages.showInfoMessage(
                        project,
                        "Snippet registered successfully.",
                        "AI Footprint"
                    )
                }
            }
        }
    }
}
