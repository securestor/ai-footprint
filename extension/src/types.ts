// Local copy of core types for the VS Code extension.
// Kept in sync with ../../core/types.ts — the extension compiles independently.

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
  matchType?: "exact" | "fuzzy" | "pattern";
}

export interface ScanOptions {
  fuzzy?: boolean;
  fuzzyThreshold?: number;
  ngramSize?: number;
}

export interface ScanReport {
  filesAnalyzed: number;
  aiAttributedFiles: number;
  unattributedSuspicious: number;
  topModel: string | null;
  matches: ScanMatch[];
}
