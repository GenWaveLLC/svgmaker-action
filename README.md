# SVGMaker Action — Convert Images to SVG

[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-SVGMaker-purple?logo=github)](https://github.com/marketplace/actions/svgmaker-image-to-svg)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Convert raster images (PNG, JPG, WebP, TIFF) to clean, scalable SVG in your CI pipeline using [SVGMaker](https://svgmaker.io).

Two conversion modes:

| Mode | How it works | Credits | Best for |
|------|--------------|---------|----------|
| `ai` (default) | **AI vectorization** — reinterprets the image and redraws it as clean vector paths. This is what powers [svgmaker.io/convert](https://svgmaker.io/convert). | 1 / image | Logos, icons, illustrations |
| `trace` | **Algorithmic trace** — deterministic pixel-edge tracing (no AI). | 0.5 / image | Flat, hard-edged graphics |

---

## Usage

### Single file conversion

```yaml
name: Vectorize Image
on: [push]

jobs:
  convert:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Convert image to SVG
        uses: GenWaveLLC/svgmaker-action@v1
        with:
          api_key: ${{ secrets.SVGMAKER_API_KEY }}
          files: assets/logo.png

      - name: Commit SVG
        run: |
          git config user.name "github-actions"
          git config user.email "github-actions@github.com"
          git add "*.svg"
          git commit -m "Convert images to SVG" || echo "No changes"
          git push
```

### Convert many images with globs

```yaml
name: Batch Vectorize
on:
  push:
    paths:
      - "assets/images/**"

jobs:
  convert:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Convert all images into one directory
        id: svg
        uses: GenWaveLLC/svgmaker-action@v1
        with:
          api_key: ${{ secrets.SVGMAKER_API_KEY }}
          files: |
            assets/icons/*.png
            assets/logos/*.jpg
          output_dir: dist/svg

      - run: echo "Generated ${{ steps.svg.outputs.count }} SVGs (${{ steps.svg.outputs.credits_used }} credits used)"
```

### Convert one file to an exact path

```yaml
- name: Convert with custom output
  uses: GenWaveLLC/svgmaker-action@v1
  id: logo
  with:
    api_key: ${{ secrets.SVGMAKER_API_KEY }}
    files: src/assets/photo.jpg
    output_path: public/vectors/photo.svg

- run: echo "Wrote ${{ steps.logo.outputs.svg_path }}"
```

### Cheaper algorithmic trace

```yaml
- name: Trace flat graphics
  uses: GenWaveLLC/svgmaker-action@v1
  with:
    api_key: ${{ secrets.SVGMAKER_API_KEY }}
    files: graphics/*.png
    mode: trace
```

---

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `api_key` | Yes | – | Your SVGMaker API key. Store as a [GitHub secret](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions). |
| `files` | Yes | – | Image file(s) to convert. Glob patterns, newline- or comma-separated (e.g. `assets/**/*.png`). |
| `mode` | No | `ai` | `ai` (AI vectorization, 1 credit) or `trace` (algorithmic trace, 0.5 credit). |
| `algorithm` | No | `vtracer` | Trace algorithm (trace mode only). Currently only `vtracer` is supported. |
| `output_path` | No | – | Exact output file path for the SVG. **Single file only** — errors if the glob matches more than one file. Takes precedence over `output_dir`. |
| `output_dir` | No | – | Directory to write SVGs into (basenames flattened). If empty, each SVG is written next to its source as `<name>.svg`. |
| `svg_text` | No | `false` | AI mode only: request the SVG source inline instead of downloading the result URL. |
| `fail_fast` | No | `true` | Stop at the first failure. If `false`, convert the rest and fail at the end with a summary. |
| `base_url` | No | `https://svgmaker.io/api` | API base URL. Override only for testing. |

## Outputs

| Output | Description |
|--------|-------------|
| `svg_paths` | JSON array of paths to the generated SVG files. |
| `svg_path` | Path to the first (or only) generated SVG — convenient for single-file conversions. |
| `count` | Number of images successfully converted. |
| `credits_used` | Total credits consumed. |
| `credits_remaining` | Your remaining credit balance. |
| `processing_time_ms` | Total processing time in milliseconds. |

---

## Setup

1. **Get an API key** from your [SVGMaker account](https://svgmaker.io/account).
2. **Add the key** as a repository secret named `SVGMAKER_API_KEY`.
3. **Use the action** in your workflow as shown above.

---

## Pricing

Conversions are billed in credits: **AI vectorization** uses **1 credit** per image, and **algorithmic trace** uses **0.5 credit** per image. See [svgmaker.io](https://svgmaker.io) for plans and credit balances.

---

## Supported Formats

| Input Format | Extension | `ai` | `trace` |
|--------------|-----------|:----:|:-------:|
| PNG | `.png` | ✅ | ✅ |
| JPEG | `.jpg`, `.jpeg` | ✅ | ✅ |
| WebP | `.webp` | ✅ | ✅ |
| TIFF | `.tiff`, `.tif` | ✅ | ✅ |

Maximum file size 25 MB. **Output**: SVG (Scalable Vector Graphics).

---

## Links

- [SVGMaker](https://svgmaker.io) — image to SVG converter
- [Account](https://svgmaker.io/account) — get and manage your API key
- [API Reference](https://svgmaker.io/docs/api-reference) — endpoints and parameters
- [Convert online](https://svgmaker.io/convert) — try it in the browser

---

## License

MIT — see [LICENSE](LICENSE) for details.
