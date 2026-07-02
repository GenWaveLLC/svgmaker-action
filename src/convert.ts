import * as fs from "fs";
import * as path from "path";

export type ConvertMode = "ai" | "trace";

export interface ConvertOptions {
  apiKey: string;
  mode: ConvertMode;
  algorithm: string;
  svgText: boolean;
  baseUrl: string;
}

export interface ConvertResult {
  /** The SVG source code. */
  svg: string;
  creditsUsed: number;
  creditsRemaining: number | null;
}

/**
 * Build the SVGMaker v1 conversion endpoint for a given mode.
 * AI vectorize -> /v1/convert/ai-vectorize, trace -> /v1/convert/trace.
 */
export function buildEndpoint(baseUrl: string, mode: ConvertMode): string {
  const base = baseUrl.replace(/\/+$/, "");
  const slug = mode === "trace" ? "trace" : "ai-vectorize";
  return `${base}/v1/convert/${slug}`;
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
};

/** Guess the MIME type of an image file from its extension, for the upload part. */
export function mimeForFile(fileName: string): string {
  return MIME_BY_EXT[path.extname(fileName).toLowerCase()] || "application/octet-stream";
}

/**
 * Resolve where a converted SVG should be written for a given input file.
 * Precedence: explicit outputPath (exact file, single-input only) >
 * outputDir (flattened basename) > alongside the source as <name>.svg.
 */
export function outputPathFor(input: string, outputPath: string, outputDir: string): string {
  if (outputPath) return path.resolve(outputPath);
  const parsed = path.parse(input);
  const name = `${parsed.name}.svg`;
  return outputDir ? path.join(path.resolve(outputDir), name) : path.join(parsed.dir, name);
}

interface ExtractedResult {
  /** Inlined SVG source, if the response carried it directly. */
  inlineSvg: string | null;
  /** URL to download the SVG from, if not inlined. */
  url: string | null;
  creditsUsed: number;
  creditsRemaining: number | null;
}

/**
 * Extract the SVG location and credit info from a v1 response envelope.
 *
 * The two modes return different shapes inside `data`:
 *  - ai:    { svgUrl, svgText?, creditCost, ... }
 *  - trace: { results: [ { success, url, format, ... } ] }
 */
export function extractResult(
  json: any,
  mode: ConvertMode
): ExtractedResult {
  const data: any = json?.data ?? json ?? {};
  const metadata: any = json?.metadata ?? {};

  let inlineSvg: string | null = null;
  let url: string | null = null;

  if (mode === "trace") {
    const first: any = Array.isArray(data.results) ? data.results[0] : undefined;
    if (!first || first.success === false) {
      const msg = first?.error || first?.message || "Trace conversion returned no result";
      throw new Error(String(msg));
    }
    url = first.url ?? first.svgUrl ?? null;
  } else {
    if (typeof data.svgText === "string" && data.svgText.length > 0) {
      inlineSvg = data.svgText;
    }
    url = data.svgUrl ?? null;
  }

  if (!inlineSvg && !url) {
    throw new Error("Response contained neither inline SVG nor a download URL");
  }

  const defaultCredit = mode === "trace" ? 0.5 : 1;
  const creditsUsed =
    numberOrNull(metadata.creditsUsed) ??
    numberOrNull(data.creditCost) ??
    defaultCredit;
  const creditsRemaining = numberOrNull(metadata.creditsRemaining);

  return { inlineSvg, url, creditsUsed, creditsRemaining };
}

function numberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Turn an HTTP error response into a helpful, mode-agnostic message. */
export async function describeHttpError(res: Response): Promise<string> {
  let bodyMessage = "";
  // Read the body exactly once, then try to parse it as JSON. Calling res.json()
  // first would consume the stream, so a non-JSON body (HTML 500, plain-text
  // gateway error) could not be recovered as text afterward.
  let raw = "";
  try {
    raw = await res.text();
  } catch {
    raw = "";
  }
  if (raw) {
    try {
      const body: any = JSON.parse(raw);
      bodyMessage = body?.error?.message || body?.error || body?.message || "";
    } catch {
      bodyMessage = raw;
    }
  }

  switch (res.status) {
    case 401:
      return "Invalid or missing API key. Generate one at https://svgmaker.io/account and store it as a GitHub secret.";
    case 402:
      return `Insufficient credits.${bodyMessage ? ` ${bodyMessage}` : ""}`;
    case 413:
      return "File too large. The API accepts images up to 25 MB.";
    case 429:
      return "Rate limit exceeded. Please wait and try again.";
    default:
      return `API request failed (${res.status})${bodyMessage ? `: ${bodyMessage}` : ""}`;
  }
}

/** Convert a single image file to SVG source. */
export async function convertOne(
  filePath: string,
  opts: ConvertOptions
): Promise<ConvertResult> {
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  const formData = new FormData();
  formData.append("file", new Blob([fileBuffer], { type: mimeForFile(fileName) }), fileName);
  if (opts.mode === "ai" && opts.svgText) {
    formData.append("svgText", "true");
  }
  if (opts.mode === "trace") {
    formData.append("algorithm", opts.algorithm);
  }

  const endpoint = buildEndpoint(opts.baseUrl, opts.mode);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "x-api-key": opts.apiKey },
    body: formData,
  });

  if (!res.ok) {
    throw new Error(await describeHttpError(res));
  }

  const json = await res.json();
  const { inlineSvg, url, creditsUsed, creditsRemaining } = extractResult(
    json,
    opts.mode
  );

  let svg: string;
  if (inlineSvg) {
    svg = inlineSvg;
  } else {
    const svgRes = await fetch(url as string);
    if (!svgRes.ok) {
      throw new Error(`Failed to download SVG from ${url} (${svgRes.status})`);
    }
    svg = await svgRes.text();
  }

  return { svg, creditsUsed, creditsRemaining };
}
