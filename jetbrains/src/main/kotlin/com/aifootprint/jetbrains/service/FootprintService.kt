package com.aifootprint.jetbrains.service

import com.aifootprint.jetbrains.model.ScanMatch
import com.aifootprint.jetbrains.model.ScanReport
import com.aifootprint.jetbrains.settings.FootprintSettings
import com.google.gson.Gson
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.process.OSProcessHandler
import com.intellij.execution.process.ProcessAdapter
import com.intellij.execution.process.ProcessEvent
import com.intellij.execution.process.ProcessOutputTypes
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Key
import com.intellij.openapi.vfs.VirtualFile
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * Core project service — manages scanning, caching, and result distribution.
 */
@Service(Service.Level.PROJECT)
class FootprintService(private val project: Project) {

    private val log = Logger.getInstance(FootprintService::class.java)
    private val gson = Gson()

    /** Cached scan results per file path. */
    private val cache = ConcurrentHashMap<String, List<ScanMatch>>()

    /** Last full project scan report. */
    @Volatile
    var lastReport: ScanReport? = null
        private set

    /** Listeners notified when scan results change. */
    private val listeners = mutableListOf<() -> Unit>()

    fun addListener(listener: () -> Unit) {
        listeners.add(listener)
    }

    private fun notifyListeners() {
        listeners.forEach { it() }
    }

    fun getCachedMatches(filePath: String): List<ScanMatch> {
        return cache[filePath] ?: emptyList()
    }

    /**
     * Scan an individual file using the CLI.
     */
    fun scanFile(file: VirtualFile, callback: (List<ScanMatch>) -> Unit) {
        val settings = FootprintSettings.getInstance().state
        val basePath = project.basePath ?: return
        val relativePath = file.path.removePrefix("$basePath/")

        val cmd = GeneralCommandLine(
            settings.cliPath, "scan", basePath,
            "--json", "--file", relativePath
        ).withWorkDirectory(basePath)

        runCliCommand(cmd) { output ->
            try {
                val report = gson.fromJson(output, ScanReport::class.java)
                val matches = report?.matches ?: emptyList()
                cache[relativePath] = matches
                notifyListeners()
                callback(matches)
            } catch (e: Exception) {
                log.warn("Failed to parse scan output for $relativePath", e)
                callback(emptyList())
            }
        }
    }

    /**
     * Scan the entire project.
     */
    fun scanProject(callback: (ScanReport?) -> Unit) {
        val settings = FootprintSettings.getInstance().state
        val basePath = project.basePath ?: return

        val cmd = GeneralCommandLine(
            settings.cliPath, "scan", basePath, "--json"
        ).withWorkDirectory(basePath)

        runCliCommand(cmd) { output ->
            try {
                val report = gson.fromJson(output, ScanReport::class.java)
                lastReport = report

                // Update per-file cache
                cache.clear()
                report?.matches?.groupBy { it.file }?.forEach { (file, matches) ->
                    cache[file] = matches
                }
                notifyListeners()
                callback(report)
            } catch (e: Exception) {
                log.warn("Failed to parse project scan output", e)
                callback(null)
            }
        }
    }

    /**
     * Register a code snippet via the CLI.
     */
    fun registerSnippet(
        content: String,
        source: String,
        model: String?,
        callback: (Boolean) -> Unit
    ) {
        val settings = FootprintSettings.getInstance().state
        val basePath = project.basePath ?: return

        // Write content to a temp file
        val tmpFile = File.createTempFile("ai-footprint-snippet-", ".txt")
        tmpFile.writeText(content)
        tmpFile.deleteOnExit()

        val cmdArgs = mutableListOf(
            settings.cliPath, "add-snippet",
            "--file", tmpFile.absolutePath,
            "--source", source
        )
        if (!model.isNullOrBlank()) {
            cmdArgs.addAll(listOf("--model", model))
        }

        val cmd = GeneralCommandLine(cmdArgs).withWorkDirectory(basePath)

        runCliCommand(cmd) { output ->
            val success = output.contains("Added snippet")
            tmpFile.delete()
            callback(success)
        }
    }

    /**
     * Get the SBOM export from the CLI.
     */
    fun exportSbom(format: String, outputPath: String, callback: (Boolean) -> Unit) {
        val settings = FootprintSettings.getInstance().state
        val basePath = project.basePath ?: return

        val cmd = GeneralCommandLine(
            settings.cliPath, "sbom",
            "--format", format,
            "--output", outputPath
        ).withWorkDirectory(basePath)

        runCliCommand(cmd) { output ->
            callback(output.contains("SBOM exported"))
        }
    }

    private fun runCliCommand(cmd: GeneralCommandLine, callback: (String) -> Unit) {
        try {
            val handler = OSProcessHandler(cmd)
            val output = StringBuilder()

            handler.addProcessListener(object : ProcessAdapter() {
                override fun onTextAvailable(event: ProcessEvent, outputType: Key<*>) {
                    if (outputType === ProcessOutputTypes.STDOUT) {
                        output.append(event.text)
                    }
                }

                override fun processTerminated(event: ProcessEvent) {
                    callback(output.toString())
                }
            })

            handler.startNotify()
        } catch (e: Exception) {
            log.error("Failed to run ai-footprint CLI", e)
            callback("")
        }
    }

    companion object {
        fun getInstance(project: Project): FootprintService =
            project.getService(FootprintService::class.java)
    }
}
