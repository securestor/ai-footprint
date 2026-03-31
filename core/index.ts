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
export {
  audit,
  verifyAuditLog,
  signPayload,
  verifyPayload,
  canonicalJSON,
  validateNoControlChars,
  validateGitUrl,
  validateApiUrl,
  validateTeamName,
  validatePort,
  safePath,
  validateOutputPath,
  validateSnippet,
  validateRegistry,
  hardenConfigPermissions,
  collectBodyLimited,
  isAllowedLLMHost,
  DEFAULT_LLM_HOSTS,
  MAX_BODY_SIZE,
  MAX_FILE_SIZE,
} from "./security.js";
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
