import * as core from "@actions/core";
import * as glob from "@actions/glob";
import * as fs from "fs";
import * as path from "path";
import { convertOne, ConvertMode, outputPathFor } from "./convert";

function parseBool(value: string, fallback = false): boolean {
  if (!value) return fallback;
  return ["true", "1", "yes", "on"].includes(value.trim().toLowerCase());
}

async function resolveFiles(rawPatterns: string): Promise<string[]> {
  // Accept newline- and/or comma-separated globs.
  const patterns = rawPatterns
    .split(/[\n,]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .join("\n");

  const globber = await glob.create(patterns, { matchDirectories: false });
  const matches = await globber.glob();
  // Keep only real files, sorted for deterministic ordering.
  return matches.filter((f) => fs.existsSync(f) && fs.statSync(f).isFile()).sort();
}

async function run(): Promise<void> {
  const startTime = Date.now();

  try {
    const apiKey = core.getInput("api_key", { required: true });
    const filesInput = core.getInput("files", { required: true });
    const mode = (core.getInput("mode") || "ai").toLowerCase() as ConvertMode;
    const algorithm = (core.getInput("algorithm") || "vtracer").toLowerCase();
    const outputPath = core.getInput("output_path");
    const outputDir = core.getInput("output_dir");
    const svgText = parseBool(core.getInput("svg_text"));
    const failFast = parseBool(core.getInput("fail_fast"), true);
    const baseUrl = core.getInput("base_url") || "https://svgmaker.io/api";

    if (mode !== "ai" && mode !== "trace") {
      throw new Error(`Invalid mode '${mode}'. Use 'ai' or 'trace'.`);
    }

    if (svgText && mode === "trace") {
      core.warning("'svg_text' only applies to mode 'ai' and is ignored in 'trace' mode.");
    }

    const files = await resolveFiles(filesInput);
    if (files.length === 0) {
      throw new Error(`No files matched the pattern(s): ${filesInput}`);
    }

    if (outputPath && files.length > 1) {
      throw new Error(
        `'output_path' sets an exact output file and only works with a single input, but ${files.length} files matched '${filesInput}'. Use 'output_dir' for multiple files.`
      );
    }

    core.info(`Converting ${files.length} file(s) using mode '${mode}'${mode === "trace" ? ` (algorithm: ${algorithm})` : ""}.`);

    const svgPaths: string[] = [];
    const seenOutputs = new Set<string>();
    const failures: string[] = [];
    let totalCredits = 0;
    let creditsRemaining: number | null = null;

    for (const input of files) {
      const outPath = outputPathFor(input, outputPath, outputDir);

      if (seenOutputs.has(outPath)) {
        // Two inputs flatten to the same output path (same basename in different
        // dirs). Skip the duplicate rather than re-converting: converting again
        // would burn credits and inflate count/credits_used/svg_paths for a file
        // that only exists once on disk.
        core.warning(`Skipping ${input}: its output path ${outPath} was already written by an earlier file. Use distinct filenames or per-source output to avoid this.`);
        continue;
      }
      seenOutputs.add(outPath);

      try {
        core.info(`→ ${input}`);
        const result = await convertOne(input, { apiKey, mode, algorithm, svgText, baseUrl });

        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, result.svg, "utf-8");

        totalCredits += result.creditsUsed;
        if (result.creditsRemaining !== null) creditsRemaining = result.creditsRemaining;
        svgPaths.push(outPath);
        core.info(`  ✓ ${outPath}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (failFast) {
          throw new Error(`Failed to convert ${input}: ${message}`);
        }
        core.error(`  ✗ ${input}: ${message}`);
        failures.push(`${input}: ${message}`);
      }
    }

    const processingTime = Date.now() - startTime;

    core.setOutput("svg_paths", JSON.stringify(svgPaths));
    core.setOutput("svg_path", svgPaths[0] ?? "");
    core.setOutput("count", svgPaths.length.toString());
    core.setOutput("credits_used", totalCredits.toString());
    core.setOutput("credits_remaining", creditsRemaining !== null ? creditsRemaining.toString() : "");
    core.setOutput("processing_time_ms", processingTime.toString());

    core.info(`Done. Converted ${svgPaths.length}/${files.length} file(s) in ${processingTime}ms. Credits used: ${totalCredits}${creditsRemaining !== null ? `, remaining: ${creditsRemaining}` : ""}.`);

    if (failures.length > 0) {
      core.setFailed(`${failures.length} file(s) failed to convert:\n${failures.join("\n")}`);
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : "An unexpected error occurred");
  }
}

run();
