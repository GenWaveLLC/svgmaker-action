import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { buildEndpoint, extractResult, mimeForFile, outputPathFor, describeHttpError } from "./convert";

test("buildEndpoint maps modes to the correct v1 slugs", () => {
  assert.equal(
    buildEndpoint("https://svgmaker.io/api", "ai"),
    "https://svgmaker.io/api/v1/convert/ai-vectorize"
  );
  assert.equal(
    buildEndpoint("https://svgmaker.io/api", "trace"),
    "https://svgmaker.io/api/v1/convert/trace"
  );
  // Trailing slashes are trimmed.
  assert.equal(
    buildEndpoint("https://svgmaker.io/api/", "ai"),
    "https://svgmaker.io/api/v1/convert/ai-vectorize"
  );
});

test("extractResult reads svgUrl from an AI-shaped envelope", () => {
  const json = {
    success: true,
    data: { svgUrl: "https://cdn/x.svg", originalImageUrl: "https://cdn/x.png", creditCost: 1, quality: "medium" },
    metadata: { requestId: "r1", creditsUsed: 1, creditsRemaining: 42 },
  };
  const r = extractResult(json, "ai");
  assert.equal(r.url, "https://cdn/x.svg");
  assert.equal(r.inlineSvg, null);
  assert.equal(r.creditsUsed, 1);
  assert.equal(r.creditsRemaining, 42);
});

test("extractResult prefers inline svgText in AI mode when present", () => {
  const json = {
    success: true,
    data: { svgUrl: "https://cdn/x.svg", svgText: "<svg>ai</svg>" },
    metadata: { creditsUsed: 1, creditsRemaining: 10 },
  };
  const r = extractResult(json, "ai");
  assert.equal(r.inlineSvg, "<svg>ai</svg>");
});

test("extractResult reads results[0].url from a trace-shaped envelope", () => {
  const json = {
    success: true,
    data: { results: [{ success: true, url: "https://cdn/trace.svg", format: "svg", urlExpiresIn: "1h" }] },
    metadata: { creditsUsed: 0.5, creditsRemaining: 5 },
  };
  const r = extractResult(json, "trace");
  assert.equal(r.url, "https://cdn/trace.svg");
  assert.equal(r.creditsUsed, 0.5);
  assert.equal(r.creditsRemaining, 5);
});

test("extractResult throws on a failed trace result", () => {
  const json = { success: true, data: { results: [{ success: false, error: "trace failed" }] }, metadata: {} };
  assert.throws(() => extractResult(json, "trace"), /trace failed/);
});

test("extractResult falls back to default credit cost when metadata is missing", () => {
  assert.equal(extractResult({ data: { svgUrl: "u" } }, "ai").creditsUsed, 1);
  assert.equal(extractResult({ data: { results: [{ success: true, url: "u" }] } }, "trace").creditsUsed, 0.5);
});

test("mimeForFile maps extensions case-insensitively and falls back", () => {
  assert.equal(mimeForFile("logo.png"), "image/png");
  assert.equal(mimeForFile("photo.JPG"), "image/jpeg");
  assert.equal(mimeForFile("a.jpeg"), "image/jpeg");
  assert.equal(mimeForFile("b.webp"), "image/webp");
  assert.equal(mimeForFile("c.tiff"), "image/tiff");
  assert.equal(mimeForFile("mystery.xyz"), "application/octet-stream");
});

test("outputPathFor honors precedence: outputPath > outputDir > beside source", () => {
  // Explicit output path wins and is resolved to absolute.
  assert.equal(
    outputPathFor("assets/logo.png", "public/brand.svg", "ignored"),
    path.resolve("public/brand.svg")
  );
  // output_dir flattens the basename into the (resolved) directory.
  assert.equal(
    outputPathFor("assets/icons/logo.png", "", "dist/svg"),
    path.join(path.resolve("dist/svg"), "logo.svg")
  );
  // Neither: written next to the source with a .svg extension.
  assert.equal(outputPathFor("assets/icons/logo.png", "", ""), path.join("assets/icons", "logo.svg"));
  // Two sources that share a basename collapse to the same output_dir path.
  assert.equal(
    outputPathFor("a/logo.png", "", "out"),
    outputPathFor("b/logo.png", "", "out")
  );
});

test("describeHttpError maps known statuses to friendly messages", async () => {
  assert.match(await describeHttpError(new Response("", { status: 401 })), /Invalid or missing API key/);
  assert.match(await describeHttpError(new Response("", { status: 413 })), /up to 25 MB/);
  assert.match(await describeHttpError(new Response("", { status: 429 })), /Rate limit/);
});

test("describeHttpError extracts the message from a JSON error body", async () => {
  const res = new Response(JSON.stringify({ error: { message: "out of credits" } }), { status: 402 });
  assert.equal(await describeHttpError(res), "Insufficient credits. out of credits");
});

test("describeHttpError surfaces a non-JSON body instead of swallowing it", async () => {
  // Regression: reading res.json() first would consume the stream and the text()
  // fallback would throw, hiding the body. We now read text once and parse.
  const res = new Response("upstream gateway exploded", { status: 500 });
  assert.equal(await describeHttpError(res), "API request failed (500): upstream gateway exploded");
});
