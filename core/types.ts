export interface Snippet {
  id: string;
  hash: string;
  source: string;
  model?: string;
  tool?: string;
  addedAt: string;
  content: string;
}

export interface SnippetRegistry {
  version: number;
  snippets: Snippet[];
}

export interface ScanMatch {
  file: string;
  line: number;
  snippet?: Snippet;
  pattern?: string;
  confidence: "high" | "medium" | "low";
  similarity?: number;
  matchType?: "exact" | "fuzzy" | "pattern" | "ast";
}

export interface ScanOptions {
  fuzzy?: boolean;
  fuzzyThreshold?: number;
  ngramSize?: number;
  ast?: boolean;
  astThreshold?: number;
  /** Enable tree-sitter native parsing (falls back to regex AST if unavailable). */
  treesitter?: boolean;
}

export interface ScanReport {
  filesAnalyzed: number;
  aiAttributedFiles: number;
  unattributedSuspicious: number;
  topModel: string | null;
  matches: ScanMatch[];
}

// ------------------------------------------------------------------ //
// Team Registry types
// ------------------------------------------------------------------ //

export interface TeamRegistryConfig {
  /** Remote git URL for the shared registry (git-backed mode). */
  gitUrl?: string;
  /** API endpoint for the registry server (API mode). */
  apiUrl?: string;
  /** API key for authentication. */
  apiKey?: string;
  /** Team / namespace identifier. */
  team?: string;
}

// ------------------------------------------------------------------ //
// SBOM types
// ------------------------------------------------------------------ //

export type SBOMFormat = "cyclonedx" | "spdx";

export interface SBOMComponent {
  type: "library" | "file";
  name: string;
  version?: string;
  supplier?: string;
  aiProvenance: {
    model?: string;
    tool?: string;
    source: string;
    confidence: string;
    similarity?: number;
    matchType: string;
  };
}

export interface SBOMDocument {
  format: SBOMFormat;
  specVersion: string;
  serialNumber: string;
  timestamp: string;
  components: SBOMComponent[];
}
