export { hashSnippet, normalize } from "./hasher.js";
export { matchFile, matchFileAsync } from "./matcher.js";
export {
  fuzzyMatchFile,
  jaccardSimilarity,
  shingle,
  tokenize,
  structuralTokenize,
} from "./fuzzy.js";
export {
  extractAST,
  astFingerprint,
  astMatchFile,
} from "./ast-matcher.js";
export {
  isTreeSitterAvailable,
  treesitterMatchFile,
  treesitterParse,
  treesitterStatus,
} from "./treesitter-matcher.js";
export type {
  ScanMatch,
  ScanOptions,
  ScanReport,
  Snippet,
  SnippetRegistry,
  TeamRegistryConfig,
  SBOMFormat,
  SBOMComponent,
  SBOMDocument,
} from "./types.js";
