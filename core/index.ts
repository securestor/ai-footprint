export { hashSnippet, normalize } from "./hasher.js";
export { matchFile } from "./matcher.js";
export {
  fuzzyMatchFile,
  jaccardSimilarity,
  shingle,
  tokenize,
  structuralTokenize,
} from "./fuzzy.js";
export type {
  ScanMatch,
  ScanOptions,
  ScanReport,
  Snippet,
  SnippetRegistry,
} from "./types.js";
