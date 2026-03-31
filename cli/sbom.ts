/**
 * SBOM (Software Bill of Materials) integration.
 *
 * Exports AI provenance data from scan results into standard SBOM formats:
 *  - CycloneDX 1.5 (JSON)
 *  - SPDX 2.3 (JSON)
 *
 * Each AI-attributed file becomes a component/package with AI provenance
 * metadata attached as properties / annotations.
 */

import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import type {
  ScanReport,
  ScanMatch,
  SBOMFormat,
  SBOMComponent,
  SBOMDocument,
} from "../core/types.js";

// ------------------------------------------------------------------ //
// Extract components from scan report
// ------------------------------------------------------------------ //

/** Group scan matches by file and build SBOM components. */
function extractComponents(report: ScanReport, baseDir: string): SBOMComponent[] {
  // Group matches by file
  const byFile = new Map<string, ScanMatch[]>();
  for (const match of report.matches) {
    const existing = byFile.get(match.file) ?? [];
    existing.push(match);
    byFile.set(match.file, existing);
  }

  const components: SBOMComponent[] = [];

  for (const [file, matches] of byFile) {
    // Pick the highest-confidence match for primary attribution
    const primary = matches.reduce((best, m) => {
      const confOrder = { high: 3, medium: 2, low: 1 };
      const bestConf = confOrder[best.confidence] ?? 0;
      const mConf = confOrder[m.confidence] ?? 0;
      return mConf > bestConf ? m : best;
    }, matches[0]);

    components.push({
      type: "file",
      name: file,
      supplier: primary.snippet?.model ?? primary.snippet?.source ?? "unknown",
      aiProvenance: {
        model: primary.snippet?.model,
        tool: primary.snippet?.tool,
        source: primary.snippet?.source ?? "pattern-detected",
        confidence: primary.confidence,
        similarity: primary.similarity,
        matchType: primary.matchType ?? "unknown",
      },
    });
  }

  return components;
}

// ------------------------------------------------------------------ //
// CycloneDX 1.5 JSON format
// ------------------------------------------------------------------ //

interface CycloneDXOutput {
  bomFormat: "CycloneDX";
  specVersion: "1.5";
  serialNumber: string;
  version: number;
  metadata: {
    timestamp: string;
    tools: { vendor: string; name: string; version: string }[];
    component: { type: string; name: string; version: string };
  };
  components: CycloneDXComponent[];
}

interface CycloneDXComponent {
  type: "file";
  name: string;
  "bom-ref": string;
  supplier?: { name: string };
  properties: { name: string; value: string }[];
}

function toCycloneDX(
  components: SBOMComponent[],
  projectName: string,
): CycloneDXOutput {
  const serialNumber = `urn:uuid:${randomUUID()}`;

  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [
        {
          vendor: "ai-footprint",
          name: "ai-footprint",
          version: "0.1.0",
        },
      ],
      component: {
        type: "application",
        name: projectName,
        version: "0.0.0",
      },
    },
    components: components.map((c) => {
      const props: { name: string; value: string }[] = [
        { name: "ai-footprint:source", value: c.aiProvenance.source },
        { name: "ai-footprint:confidence", value: c.aiProvenance.confidence },
        { name: "ai-footprint:matchType", value: c.aiProvenance.matchType },
      ];
      if (c.aiProvenance.model) {
        props.push({ name: "ai-footprint:model", value: c.aiProvenance.model });
      }
      if (c.aiProvenance.tool) {
        props.push({ name: "ai-footprint:tool", value: c.aiProvenance.tool });
      }
      if (c.aiProvenance.similarity !== undefined) {
        props.push({
          name: "ai-footprint:similarity",
          value: c.aiProvenance.similarity.toFixed(3),
        });
      }

      const comp: CycloneDXComponent = {
        type: "file",
        name: c.name,
        "bom-ref": `ai-footprint:${c.name}`,
        properties: props,
      };

      if (c.supplier) {
        comp.supplier = { name: c.supplier };
      }

      return comp;
    }),
  };
}

// ------------------------------------------------------------------ //
// SPDX 2.3 JSON format
// ------------------------------------------------------------------ //

interface SPDXOutput {
  spdxVersion: "SPDX-2.3";
  dataLicense: "CC0-1.0";
  SPDXID: "SPDXRef-DOCUMENT";
  name: string;
  documentNamespace: string;
  creationInfo: {
    created: string;
    creators: string[];
    licenseListVersion: "3.22";
  };
  packages: SPDXPackage[];
  relationships: SPDXRelationship[];
}

interface SPDXPackage {
  SPDXID: string;
  name: string;
  downloadLocation: "NOASSERTION";
  filesAnalyzed: false;
  supplier?: string;
  annotations: SPDXAnnotation[];
}

interface SPDXAnnotation {
  annotationDate: string;
  annotationType: "REVIEW";
  annotator: string;
  comment: string;
}

interface SPDXRelationship {
  spdxElementId: string;
  relatedSpdxElement: string;
  relationshipType: string;
}

function sanitiseSPDXId(name: string): string {
  return name.replace(/[^a-zA-Z0-9.-]/g, "-");
}

function toSPDX(
  components: SBOMComponent[],
  projectName: string,
): SPDXOutput {
  const timestamp = new Date().toISOString();
  const namespace = `https://ai-footprint.dev/spdx/${randomUUID()}`;

  const packages: SPDXPackage[] = components.map((c) => {
    const spdxId = `SPDXRef-${sanitiseSPDXId(c.name)}`;
    const comment = [
      `AI provenance detected by ai-footprint.`,
      `Source: ${c.aiProvenance.source}`,
      `Match type: ${c.aiProvenance.matchType}`,
      `Confidence: ${c.aiProvenance.confidence}`,
      c.aiProvenance.model ? `Model: ${c.aiProvenance.model}` : null,
      c.aiProvenance.tool ? `Tool: ${c.aiProvenance.tool}` : null,
      c.aiProvenance.similarity !== undefined
        ? `Similarity: ${(c.aiProvenance.similarity * 100).toFixed(1)}%`
        : null,
    ]
      .filter(Boolean)
      .join("; ");

    const pkg: SPDXPackage = {
      SPDXID: spdxId,
      name: c.name,
      downloadLocation: "NOASSERTION",
      filesAnalyzed: false,
      annotations: [
        {
          annotationDate: timestamp,
          annotationType: "REVIEW",
          annotator: "Tool: ai-footprint-0.1.0",
          comment,
        },
      ],
    };

    if (c.supplier) {
      pkg.supplier = `Organization: ${c.supplier}`;
    }

    return pkg;
  });

  const relationships: SPDXRelationship[] = packages.map((pkg) => ({
    spdxElementId: "SPDXRef-DOCUMENT",
    relatedSpdxElement: pkg.SPDXID,
    relationshipType: "DESCRIBES",
  }));

  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: projectName,
    documentNamespace: namespace,
    creationInfo: {
      created: timestamp,
      creators: ["Tool: ai-footprint-0.1.0"],
      licenseListVersion: "3.22",
    },
    packages,
    relationships,
  };
}

// ------------------------------------------------------------------ //
// Public API
// ------------------------------------------------------------------ //

/**
 * Generate an SBOM document from a scan report.
 *
 * @param report — Scan report (from `scan()`)
 * @param format — "cyclonedx" or "spdx"
 * @param baseDir — Project root directory
 * @returns SBOM as a JSON string
 */
export function generateSBOM(
  report: ScanReport,
  format: SBOMFormat,
  baseDir: string,
): string {
  const projectName = basename(resolve(baseDir));
  const components = extractComponents(report, baseDir);

  if (components.length === 0) {
    console.log("No AI-attributed components found. SBOM will be empty.");
  }

  let doc: unknown;

  switch (format) {
    case "cyclonedx":
      doc = toCycloneDX(components, projectName);
      break;
    case "spdx":
      doc = toSPDX(components, projectName);
      break;
    default:
      throw new Error(`Unsupported SBOM format: ${format}. Use 'cyclonedx' or 'spdx'.`);
  }

  return JSON.stringify(doc, null, 2);
}

/**
 * Export an SBOM to a file.
 *
 * @param report — Scan report
 * @param format — "cyclonedx" or "spdx"
 * @param outputPath — File path to write to
 * @param baseDir — Project root directory
 */
export function exportSBOM(
  report: ScanReport,
  format: SBOMFormat,
  outputPath: string,
  baseDir: string,
): void {
  const json = generateSBOM(report, format, baseDir);
  writeFileSync(outputPath, json);
  const components = JSON.parse(json);
  const componentCount =
    format === "cyclonedx"
      ? (components.components?.length ?? 0)
      : (components.packages?.length ?? 0);

  console.log(`\nSBOM exported: ${outputPath}`);
  console.log(`Format:     ${format === "cyclonedx" ? "CycloneDX 1.5" : "SPDX 2.3"}`);
  console.log(`Components: ${componentCount} AI-attributed file(s)`);
}
