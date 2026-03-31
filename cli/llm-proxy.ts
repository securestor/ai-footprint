/**
 * LLM API auto-detect proxy.
 *
 * A lightweight HTTP proxy that intercepts responses from LLM API endpoints
 * (OpenAI, Anthropic, Google AI, Ollama, etc.), extracts generated code from
 * the responses, and auto-registers snippets in the local registry.
 *
 * Usage:
 *   ai-footprint intercept [--port 8990] [--model auto]
 *
 * Configure your LLM client to use http://localhost:8990 as the base URL
 * (or set HTTPS_PROXY / HTTP_PROXY environment variables).
 */

import { createServer, IncomingMessage, ServerResponse, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { URL } from "node:url";
import { randomUUID } from "node:crypto";
import { addSnippet, loadRegistry } from "./registry.js";
import { hashSnippet } from "../core/hasher.js";
import {
  audit,
  isAllowedLLMHost,
  collectBodyLimited,
  MAX_BODY_SIZE,
  validatePort,
} from "../core/security.js";

// ------------------------------------------------------------------ //
// Known LLM API endpoint patterns
// ------------------------------------------------------------------ //

interface EndpointPattern {
  /** Regex against the full request URL path. */
  pathPattern: RegExp;
  /** How to identify the provider. */
  provider: string;
  /** Extract model name from request body. */
  extractModel: (body: Record<string, unknown>) => string | null;
  /** Extract generated text from response body. */
  extractContent: (body: Record<string, unknown>) => string[];
}

const ENDPOINT_PATTERNS: EndpointPattern[] = [
  // OpenAI Chat Completions
  {
    pathPattern: /\/v1\/chat\/completions/,
    provider: "openai",
    extractModel: (body) => (body.model as string) ?? null,
    extractContent: (body) => {
      const choices = body.choices as Array<{
        message?: { content?: string };
        delta?: { content?: string };
      }> | undefined;
      if (!choices) return [];
      return choices
        .map((c) => c.message?.content ?? c.delta?.content ?? "")
        .filter((s) => s.length > 0);
    },
  },
  // OpenAI Completions (legacy)
  {
    pathPattern: /\/v1\/completions$/,
    provider: "openai",
    extractModel: (body) => (body.model as string) ?? null,
    extractContent: (body) => {
      const choices = body.choices as Array<{ text?: string }> | undefined;
      if (!choices) return [];
      return choices.map((c) => c.text ?? "").filter((s) => s.length > 0);
    },
  },
  // Anthropic Messages
  {
    pathPattern: /\/v1\/messages/,
    provider: "anthropic",
    extractModel: (body) => (body.model as string) ?? null,
    extractContent: (body) => {
      const content = body.content as Array<{ type: string; text?: string }> | undefined;
      if (!content) return [];
      return content
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text!);
    },
  },
  // Google AI (Gemini) — generateContent
  {
    pathPattern: /\/v1(?:beta)?\/models\/[^/]+:generateContent/,
    provider: "google",
    extractModel: (body) => {
      // Model is usually in the URL, but may be in body
      return (body.model as string) ?? null;
    },
    extractContent: (body) => {
      const candidates = body.candidates as Array<{
        content?: { parts?: Array<{ text?: string }> };
      }> | undefined;
      if (!candidates) return [];
      return candidates.flatMap(
        (c) => c.content?.parts?.map((p) => p.text ?? "").filter((s) => s.length > 0) ?? [],
      );
    },
  },
  // Ollama
  {
    pathPattern: /\/api\/(?:generate|chat)/,
    provider: "ollama",
    extractModel: (body) => (body.model as string) ?? null,
    extractContent: (body) => {
      // /api/generate
      if (typeof body.response === "string") return [body.response];
      // /api/chat
      const message = body.message as { content?: string } | undefined;
      if (message?.content) return [message.content];
      return [];
    },
  },
  // Azure OpenAI
  {
    pathPattern: /\/openai\/deployments\/[^/]+\/chat\/completions/,
    provider: "azure-openai",
    extractModel: (body) => (body.model as string) ?? null,
    extractContent: (body) => {
      const choices = body.choices as Array<{
        message?: { content?: string };
      }> | undefined;
      if (!choices) return [];
      return choices
        .map((c) => c.message?.content ?? "")
        .filter((s) => s.length > 0);
    },
  },
  // Cohere
  {
    pathPattern: /\/v1\/chat$/,
    provider: "cohere",
    extractModel: (body) => (body.model as string) ?? null,
    extractContent: (body) => {
      if (typeof body.text === "string") return [body.text];
      return [];
    },
  },
  // Mistral
  {
    pathPattern: /\/v1\/chat\/completions/,
    provider: "mistral",
    extractModel: (body) => (body.model as string) ?? null,
    extractContent: (body) => {
      const choices = body.choices as Array<{
        message?: { content?: string };
      }> | undefined;
      if (!choices) return [];
      return choices
        .map((c) => c.message?.content ?? "")
        .filter((s) => s.length > 0);
    },
  },
];

// ------------------------------------------------------------------ //
// Code extraction from LLM response text
// ------------------------------------------------------------------ //

/**
 * Extract code blocks from markdown-formatted LLM responses.
 * Finds fenced code blocks (```lang ... ```) and substantial inline code.
 */
function extractCodeBlocks(text: string): { code: string; language: string }[] {
  const blocks: { code: string; language: string }[] = [];

  // Fenced code blocks (```lang\ncode\n```)
  const fencedRegex = /```(\w*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fencedRegex.exec(text)) !== null) {
    const lang = match[1] || "unknown";
    const code = match[2].trim();
    if (code.length >= 20 && code.split("\n").length >= 2) {
      blocks.push({ code, language: lang });
    }
  }

  // If no fenced blocks, check for large code-like content
  // (heuristic: lines with consistent indentation, semicolons, braces)
  if (blocks.length === 0) {
    const lines = text.split("\n");
    let codeStart = -1;
    let codeLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isCodeLike =
        /^[\s]*(?:import|export|const|let|var|function|class|def|func|if|for|while|return|try|catch)\b/.test(
          line,
        ) ||
        /[{};()]\s*$/.test(line.trimEnd()) ||
        /^\s{2,}\S/.test(line);

      if (isCodeLike) {
        if (codeStart === -1) codeStart = i;
        codeLines.push(line);
      } else if (codeLines.length > 0) {
        if (codeLines.length >= 3) {
          blocks.push({ code: codeLines.join("\n"), language: "auto-detected" });
        }
        codeStart = -1;
        codeLines = [];
      }
    }

    // Trailing code block
    if (codeLines.length >= 3) {
      blocks.push({ code: codeLines.join("\n"), language: "auto-detected" });
    }
  }

  return blocks;
}

// ------------------------------------------------------------------ //
// Interception stats
// ------------------------------------------------------------------ //

interface InterceptStats {
  requestsProxied: number;
  responsesIntercepted: number;
  codeBlocksDetected: number;
  snippetsRegistered: number;
  duplicatesSkipped: number;
  providers: Map<string, number>;
  models: Map<string, number>;
}

function createStats(): InterceptStats {
  return {
    requestsProxied: 0,
    responsesIntercepted: 0,
    codeBlocksDetected: 0,
    snippetsRegistered: 0,
    duplicatesSkipped: 0,
    providers: new Map(),
    models: new Map(),
  };
}

// ------------------------------------------------------------------ //
// Proxy server
// ------------------------------------------------------------------ //

export interface InterceptOptions {
  port?: number;
  /** Override model name (default: extract from API request). */
  model?: string;
  /** Minimum code block length to register (chars). */
  minCodeLength?: number;
  /** Minimum code block lines to register. */
  minCodeLines?: number;
  /** Whether to print each intercepted snippet. */
  verbose?: boolean;
  /** Allowlist of target hosts to proxy to. If empty, all hosts are allowed. */
  allowedHosts?: string[];
}

/**
 * Collect the full body from an IncomingMessage stream with size limit.
 */
function collectBody(stream: IncomingMessage): Promise<Buffer> {
  return collectBodyLimited(stream as unknown as { on: (event: string, cb: (...args: unknown[]) => void) => void }, MAX_BODY_SIZE);
}

/**
 * Start the LLM API interception proxy.
 *
 * The proxy forwards requests to the real LLM API, reads the response,
 * extracts code blocks, and auto-registers them as snippets.
 */
export function startInterceptProxy(opts: InterceptOptions = {}): void {
  const port = opts.port ?? 8990;
  validatePort(port);
  validatePort(port + 1); // status port
  const minLen = opts.minCodeLength ?? 20;
  const minLines = opts.minCodeLines ?? 2;
  const verbose = opts.verbose ?? false;
  // Use explicit allowlist if provided; otherwise default to known LLM API hosts
  const customAllowlist = opts.allowedHosts && opts.allowedHosts.length > 0;
  const allowedHosts = new Set(opts.allowedHosts ?? []);
  const stats = createStats();

  audit("proxy.start", `Starting intercept proxy on port ${port}`);

  // Pre-load existing hashes for dedup
  const existingHashes = new Set(loadRegistry().snippets.map((s) => s.hash));

  const server = createServer(async (clientReq: IncomingMessage, clientRes: ServerResponse) => {
    stats.requestsProxied++;

    // --- Determine target ---
    // The proxy expects either:
    // 1. Absolute URL in the request line (standard HTTP proxy)
    // 2. Host header with relative path (reverse proxy mode)
    let targetUrl: URL;
    try {
      if (clientReq.url?.startsWith("http")) {
        targetUrl = new URL(clientReq.url);
      } else {
        const host = clientReq.headers.host;
        if (!host) {
          clientRes.writeHead(400, { "Content-Type": "text/plain" });
          clientRes.end("Missing Host header");
          return;
        }
        const proto = clientReq.headers["x-forwarded-proto"] === "https" ? "https" : "http";
        targetUrl = new URL(`${proto}://${host}${clientReq.url}`);
      }
    } catch {
      clientRes.writeHead(400, { "Content-Type": "text/plain" });
      clientRes.end("Invalid request URL");
      return;
    }

    // --- Host allowlist ---
    // If a custom allowlist is provided, use it exclusively.
    // Otherwise, use the default known LLM API host list to prevent open proxy / SSRF.
    const hostAllowed = customAllowlist
      ? allowedHosts.has(targetUrl.hostname)
      : isAllowedLLMHost(targetUrl.hostname);

    if (!hostAllowed) {
      audit("security.host-blocked", `Blocked request to ${targetUrl.hostname}`);
      clientRes.writeHead(403, { "Content-Type": "text/plain" });
      clientRes.end(`Host ${targetUrl.hostname} not in allowlist. Use --allowed-hosts to add it.`);
      return;
    }

    // --- Collect client request body ---
    const reqBody = await collectBody(clientReq);
    let reqJson: Record<string, unknown> | null = null;
    try {
      if (reqBody.length > 0) {
        reqJson = JSON.parse(reqBody.toString("utf-8"));
      }
    } catch {
      // Not JSON — that's fine, just proxy it
    }

    // --- Find matching endpoint pattern ---
    const endpoint = ENDPOINT_PATTERNS.find((ep) =>
      ep.pathPattern.test(targetUrl.pathname),
    );

    // --- Determine model name ---
    let modelName = opts.model ?? null;
    if (!modelName && endpoint && reqJson) {
      modelName = endpoint.extractModel(reqJson);
    }

    // --- Forward request to real API ---
    const isHttps = targetUrl.protocol === "https:";
    const reqFn = isHttps ? httpsRequest : httpRequest;

    // Copy headers, removing proxy-specific and hop-by-hop headers
    const HOP_BY_HOP = new Set([
      "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
      "te", "trailers", "transfer-encoding", "upgrade", "proxy-connection",
    ]);
    const forwardHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(clientReq.headers)) {
      if (key === "host" || HOP_BY_HOP.has(key.toLowerCase())) continue;
      if (value) forwardHeaders[key] = Array.isArray(value) ? value.join(", ") : value;
    }
    forwardHeaders["host"] = targetUrl.host;

    const proxyReq = reqFn(
      {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (isHttps ? 443 : 80),
        path: targetUrl.pathname + targetUrl.search,
        method: clientReq.method,
        headers: forwardHeaders,
      },
      async (proxyRes) => {
        // --- Collect response body ---
        const resBody = await collectBody(proxyRes as unknown as IncomingMessage);

        // --- Forward response to client ---
        const resHeaders: Record<string, string | string[]> = {};
        for (const [key, value] of Object.entries(proxyRes.headers)) {
          if (value) resHeaders[key] = value;
        }
        clientRes.writeHead(proxyRes.statusCode ?? 200, resHeaders);
        clientRes.end(resBody);

        // --- Intercept: extract code from successful responses ---
        if (
          proxyRes.statusCode &&
          proxyRes.statusCode >= 200 &&
          proxyRes.statusCode < 300 &&
          endpoint
        ) {
          stats.responsesIntercepted++;

          const providerCount = stats.providers.get(endpoint.provider) ?? 0;
          stats.providers.set(endpoint.provider, providerCount + 1);

          let resJson: Record<string, unknown> | null = null;
          try {
            resJson = JSON.parse(resBody.toString("utf-8"));
          } catch {
            // Non-JSON response — skip
            return;
          }

          if (!resJson) return;

          // Extract model from response if not already known
          if (!modelName && resJson.model) {
            modelName = resJson.model as string;
          }

          if (modelName) {
            const modelCount = stats.models.get(modelName) ?? 0;
            stats.models.set(modelName, modelCount + 1);
          }

          // Extract text content from response
          const texts = endpoint.extractContent(resJson);

          for (const text of texts) {
            const codeBlocks = extractCodeBlocks(text);
            stats.codeBlocksDetected += codeBlocks.length;

            for (const block of codeBlocks) {
              if (block.code.length < minLen) continue;
              if (block.code.split("\n").length < minLines) continue;

              const hash = hashSnippet(block.code);

              if (existingHashes.has(hash)) {
                stats.duplicatesSkipped++;
                continue;
              }

              // Register the snippet
              const snippet = addSnippet({
                content: block.code,
                source: endpoint.provider,
                model: modelName ?? "unknown",
                tool: `${endpoint.provider}-api`,
              });

              existingHashes.add(hash);
              stats.snippetsRegistered++;

              if (verbose) {
                const preview = block.code.split("\n").slice(0, 3).join("\n");
                console.log(
                  `[intercept] Registered snippet ${snippet.id.slice(0, 8)}… ` +
                  `(${endpoint.provider}/${modelName ?? "?"}, ${block.language}, ` +
                  `${block.code.split("\n").length} lines)`,
                );
                console.log(`  ${preview.replace(/\n/g, "\n  ")}`);
                console.log("");
              }
            }
          }
        }
      },
    );

    proxyReq.on("error", (err) => {
      console.error(`[intercept] Proxy error: ${err.message}`);
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { "Content-Type": "text/plain" });
        clientRes.end(`Proxy error: ${err.message}`);
      }
    });

    if (reqBody.length > 0) {
      proxyReq.write(reqBody);
    }
    proxyReq.end();
  });

  // --- Status endpoint ---
  const statusServer = createServer((req, res) => {
    if (req.url === "/status" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          {
            requestsProxied: stats.requestsProxied,
            responsesIntercepted: stats.responsesIntercepted,
            codeBlocksDetected: stats.codeBlocksDetected,
            snippetsRegistered: stats.snippetsRegistered,
            duplicatesSkipped: stats.duplicatesSkipped,
            providers: Object.fromEntries(stats.providers),
            models: Object.fromEntries(stats.models),
          },
          null,
          2,
        ),
      );
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  const statusPort = port + 1;

  server.listen(port, () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                  AI Footprint Intercept Proxy                ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Proxy:   http://localhost:${String(port).padEnd(5)}                          ║
║  Status:  http://localhost:${String(statusPort).padEnd(5)}/status                   ║
║                                                              ║
║  Configure your LLM client to use the proxy URL:             ║
║                                                              ║
║  OpenAI:                                                     ║
║    OPENAI_BASE_URL=http://localhost:${String(port).padEnd(5)}                ║
║                                                              ║
║  Anthropic:                                                  ║
║    ANTHROPIC_BASE_URL=http://localhost:${String(port).padEnd(5)}             ║
║                                                              ║
║  HTTP proxy (any client):                                    ║
║    HTTP_PROXY=http://localhost:${String(port).padEnd(5)}                     ║
║    HTTPS_PROXY=http://localhost:${String(port).padEnd(5)}                    ║
║                                                              ║
║  Detected code will be auto-registered as snippets.          ║
║  Press Ctrl+C to stop.                                       ║
╚══════════════════════════════════════════════════════════════╝
`);
  });

  statusServer.listen(statusPort);

  // Graceful shutdown
  const shutdown = () => {
    console.log("\n[intercept] Shutting down...");
    console.log(`[intercept] Session stats:`);
    console.log(`  Requests proxied:      ${stats.requestsProxied}`);
    console.log(`  Responses intercepted: ${stats.responsesIntercepted}`);
    console.log(`  Code blocks detected:  ${stats.codeBlocksDetected}`);
    console.log(`  Snippets registered:   ${stats.snippetsRegistered}`);
    console.log(`  Duplicates skipped:    ${stats.duplicatesSkipped}`);
    if (stats.providers.size > 0) {
      console.log(`  Providers: ${[...stats.providers.entries()].map(([k, v]) => `${k}(${v})`).join(", ")}`);
    }
    if (stats.models.size > 0) {
      console.log(`  Models: ${[...stats.models.entries()].map(([k, v]) => `${k}(${v})`).join(", ")}`);
    }
    server.close();
    statusServer.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/**
 * Print intercept proxy status from the status endpoint.
 */
export async function interceptStatus(port: number = 8991): Promise<void> {
  return new Promise((resolve) => {
    const req = httpRequest(
      { hostname: "127.0.0.1", port, path: "/status", method: "GET" },
      (res) => {
        let data = "";
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () => {
          try {
            const status = JSON.parse(data);
            console.log("\nAI Footprint Intercept Proxy — Status");
            console.log("─".repeat(40));
            console.log(`Requests proxied:      ${status.requestsProxied}`);
            console.log(`Responses intercepted: ${status.responsesIntercepted}`);
            console.log(`Code blocks detected:  ${status.codeBlocksDetected}`);
            console.log(`Snippets registered:   ${status.snippetsRegistered}`);
            console.log(`Duplicates skipped:    ${status.duplicatesSkipped}`);
            if (Object.keys(status.providers).length > 0) {
              console.log(`Providers: ${Object.entries(status.providers).map(([k, v]) => `${k}(${v})`).join(", ")}`);
            }
            if (Object.keys(status.models).length > 0) {
              console.log(`Models: ${Object.entries(status.models).map(([k, v]) => `${k}(${v})`).join(", ")}`);
            }
          } catch {
            console.log("Could not parse status response.");
          }
          resolve();
        });
      },
    );

    req.on("error", () => {
      console.log("Intercept proxy is not running (or not on the expected port).");
      resolve();
    });

    req.end();
  });
}

// Re-export for external use
export { extractCodeBlocks, ENDPOINT_PATTERNS };
