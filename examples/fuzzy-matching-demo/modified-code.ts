// examples/fuzzy-matching-demo/modified-code.ts
// A developer copied the AI-generated code and modified it.
// AI Footprint's fuzzy matching detects this as a derivative of the original.

// Renamed functions, changed variable names, added a filter parameter,
// but the structure and logic are clearly derived from the AI snippet.

export function extractQueryParams(href: string): Map<string, string> {
  const result = new Map<string, string>();
  const qs = href.split("?")[1];
  if (!qs) return result;

  for (const segment of qs.split("&")) {
    const [k, v] = segment.split("=");
    if (k) {
      result.set(decodeURIComponent(k), decodeURIComponent(v || ""));
    }
  }
  return result;
}

export function constructQueryString(
  entries: Map<string, string>,
  filter?: (key: string) => boolean,
): string {
  const segments: string[] = [];
  for (const [k, v] of entries) {
    if (filter && !filter(k)) continue;
    segments.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  return segments.length > 0 ? `?${segments.join("&")}` : "";
}
