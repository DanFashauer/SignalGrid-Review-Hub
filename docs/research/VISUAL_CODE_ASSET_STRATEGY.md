# Visual-Code Asset Strategy

SignalGrid visuals should be source-controlled visual code wherever practical. Diagrams, architecture maps, ecosystem visuals, Review Hub surfaces, and public teaser graphics should be editable artifacts, not one-off screenshots.

## Principle

Prefer code-native visual artifacts that can be rendered, inspected, revised, versioned, and reused:

```text
Visual artifact source
  -> render / preview
  -> inspect
  -> revise source
  -> commit
```

This keeps the working loop close to:

```text
Code -> Render -> Inspect -> Revise
```

## Stack

The visual-code workflow should use a source-first stack:

```text
Coding model / authoring process
  -> symbolic representation
  -> renderer or engine
  -> inspection / revision
  -> committed artifact
```

## Preferred representations

- SVG for architecture diagrams, ecosystem maps, positioning visuals, and social cards.
- React / HTML / CSS for Review Hub UI visuals and interactive public review surfaces.
- Lottie JSON later for motion or animated explainers.
- Mermaid or structured diagram specs where useful for simple flows.
- Raster exports only when a target platform requires PNG/JPEG output.

Raster-only source files should be avoided unless the platform requires them or the source is intentionally a reference image.

## Current SignalGrid visual assets

Current and near-term visual-code candidates include:

- Ecosystem positioning SVG.
- Runtime architecture visuals.
- DockBridge diagrams.
- Review Hub UI surfaces.
- LinkedIn and social teaser graphics.
- Future mobile/operator workflow diagrams.

## Workflow

1. Generate or edit the source asset.
2. Render locally in the relevant engine, browser, or SVG viewer.
3. Inspect visually for layout, readability, accessibility, and claim discipline.
4. Revise the source artifact.
5. Commit the source file.
6. Export PNG or another raster format only when a target platform requires it.

## Guardrails

- No vendor logos unless explicitly allowed.
- No partnership or certification claims in visuals.
- No production-ready claims.
- No compliance guarantee claims.
- Keep diagrams public-safe.
- Prefer conceptual diagrams over screenshots of private, customer, tenant, or protected systems.
- Keep visual-code strategy as a repository and communication process, not as a SignalGrid product feature.

## Future automation

A future validation script could be named `proof:visual-assets` or `validate:visual-assets`. It could check that required SVG files exist, render selected assets for review, and optionally verify that exported raster files are generated from committed source artifacts.
