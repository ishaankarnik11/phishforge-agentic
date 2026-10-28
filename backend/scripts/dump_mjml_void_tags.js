#!/usr/bin/env node
/**
 * Dump the MJML component registry as JSON, classifying each tag as
 * void / non-void / text-content (endingTag === true).
 *
 * STORY-7.10 — the sanitizer's auto-repair pass needs to know which MJML
 * tags do not legally accept children. Rather than maintain a hand list,
 * we read it from MJML's own component metadata + dependency graph.
 *
 * A tag is treated as VOID iff:
 *   - it appears in the component registry, AND
 *   - its endingTag !== true (so it is not a text-content tag like
 *     <mj-text> / <mj-button>), AND
 *   - its allowed-children list (mjml-validator dependencies) is empty.
 *
 * The output JSON is committed to backend/app/services/mjml_void_tags.json
 * and read by app.services.mjml_sanitize at module load. A pytest verifies
 * the JSON stays in sync with the installed mjml package.
 *
 * Resolves the mjml package via NODE_PATH (so `npm root -g` works) or via
 * the MJML_PACKAGE_PATH env var as an explicit override.
 *
 * Usage (writes to stdout):
 *   node backend/scripts/dump_mjml_void_tags.js
 * Or to write directly to the JSON file:
 *   node backend/scripts/dump_mjml_void_tags.js > \
 *     backend/app/services/mjml_void_tags.json
 */

"use strict";

const path = require("path");
const { execSync } = require("child_process");

function resolveMjmlRoot() {
  if (process.env.MJML_PACKAGE_PATH) {
    return process.env.MJML_PACKAGE_PATH;
  }
  // Try local node_modules first, then global.
  const candidates = [];
  try {
    candidates.push(require.resolve("mjml/package.json"));
  } catch (_) {
    /* not local */
  }
  try {
    const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
    candidates.push(path.join(globalRoot, "mjml", "package.json"));
  } catch (_) {
    /* npm not on PATH */
  }
  for (const candidate of candidates) {
    try {
      require("fs").accessSync(candidate);
      return path.dirname(candidate);
    } catch (_) {
      /* skip */
    }
  }
  throw new Error(
    "Cannot find the 'mjml' package. Install with `npm install -g mjml` " +
      "or set MJML_PACKAGE_PATH to the package root.",
  );
}

function nestedRequire(rootPkg, name) {
  // mjml's deps are nested under its own node_modules
  return require(path.join(rootPkg, "node_modules", name));
}

function main() {
  const mjmlRoot = resolveMjmlRoot();
  const mjmlPkg = require(path.join(mjmlRoot, "package.json"));

  // Loading the main entry registers all components into mjml-core.
  require(mjmlRoot);

  const mjmlCore = nestedRequire(mjmlRoot, "mjml-core");
  const validator = nestedRequire(mjmlRoot, "mjml-validator");

  const components = mjmlCore.components || {};
  const dependencies = validator.dependencies || {};

  const tags = [];
  for (const [name, Component] of Object.entries(components)) {
    const endingTag = Component && Component.endingTag === true;
    const allowedChildren = dependencies[name];
    // A tag is void if endingTag !== true AND allowed-children list exists
    // and is empty. If the dependency entry is missing entirely we treat the
    // tag conservatively as non-void (no auto-repair).
    const hasEmptyChildren =
      Array.isArray(allowedChildren) && allowedChildren.length === 0;
    const isVoid = !endingTag && hasEmptyChildren;
    tags.push({
      name,
      endingTag,
      allowedChildren: Array.isArray(allowedChildren)
        ? allowedChildren
        : null,
      isVoid,
    });
  }
  // Sort for stable diffs.
  tags.sort((a, b) => a.name.localeCompare(b.name));

  const output = {
    mjmlVersion: mjmlPkg.version,
    generatedBy: "backend/scripts/dump_mjml_void_tags.js",
    tags,
  };
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
}

main();
