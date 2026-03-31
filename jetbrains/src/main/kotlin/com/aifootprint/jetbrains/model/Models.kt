package com.aifootprint.jetbrains.model

import com.google.gson.annotations.SerializedName

/**
 * Data classes mirroring the ai-footprint CLI JSON output.
 */
data class ScanMatch(
    val file: String,
    val line: Int,
    val snippet: SnippetRef? = null,
    val pattern: String? = null,
    val confidence: String,
    val similarity: Double? = null,
    @SerializedName("matchType") val matchType: String? = null
)

data class SnippetRef(
    val id: String,
    val hash: String,
    val source: String,
    val model: String? = null,
    val tool: String? = null,
    val addedAt: String? = null
)

data class ScanReport(
    val filesAnalyzed: Int,
    val aiAttributedFiles: Int,
    val unattributedSuspicious: Int,
    val topModel: String?,
    val matches: List<ScanMatch>
)
