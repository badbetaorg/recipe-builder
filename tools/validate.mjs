#!/usr/bin/env node
// Validate recipe JSON files against the tabular-recipe schema.
// Usage: node tools/validate.mjs data/batches/*.json
import { readFileSync } from "node:fs";

const CATEGORIES = ["Breakfast", "Baking & Desserts", "Soups & Stews", "Salads & Sides", "Main Dishes"];

function validateNode(node, path, errors, stats) {
  if (typeof node === "string") {
    if (!node.trim()) errors.push(`${path}: empty ingredient`);
    stats.leaves++;
    return 0;
  }
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    errors.push(`${path}: node must be an ingredient string or {do, in}`);
    return 0;
  }
  const extra = Object.keys(node).filter((k) => k !== "do" && k !== "in");
  if (extra.length) errors.push(`${path}: unexpected keys ${extra.join(", ")}`);
  if (typeof node.do !== "string" || !node.do.trim()) errors.push(`${path}: step needs a non-empty "do"`);
  else if (node.do.length > 60) errors.push(`${path}: step text over 60 chars ("${node.do}") - keep it short like a table cell`);
  if (!Array.isArray(node.in) || node.in.length === 0) {
    errors.push(`${path}: step "${node.do}" needs a non-empty "in" array`);
    return 1;
  }
  stats.steps++;
  let depth = 0;
  node.in.forEach((child, i) => {
    depth = Math.max(depth, validateNode(child, `${path}.in[${i}]`, errors, stats));
  });
  return depth + 1;
}

export function validateRecipe(r) {
  const errors = [];
  const where = r && r.id ? r.id : "(no id)";
  if (!r || typeof r !== "object") return [`${where}: not an object`];
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(r.id || "")) errors.push(`${where}: id must be a lowercase slug`);
  if (typeof r.title !== "string" || !r.title.trim()) errors.push(`${where}: missing title`);
  if (!CATEGORIES.includes(r.category)) errors.push(`${where}: category must be one of ${CATEGORIES.join(" | ")}`);
  if (typeof r.servings !== "string" || !r.servings.trim()) errors.push(`${where}: servings must be a string like "about 10 servings"`);
  if (r.prep !== undefined && (!Array.isArray(r.prep) || r.prep.some((p) => typeof p !== "string"))) errors.push(`${where}: prep must be an array of strings`);
  if (r.notes !== undefined && (!Array.isArray(r.notes) || r.notes.some((p) => typeof p !== "string"))) errors.push(`${where}: notes must be an array of strings`);
  if (r.source !== undefined && (typeof r.source !== "object" || typeof r.source.name !== "string" || !/^https?:\/\//.test(r.source.url || ""))) errors.push(`${where}: source must be {name, url}`);
  const stats = { leaves: 0, steps: 0 };
  if (!r.tree || typeof r.tree !== "object") errors.push(`${where}: tree must be a step object`);
  else validateNode(r.tree, `${where}.tree`, errors, stats);
  if (stats.leaves < 2) errors.push(`${where}: needs at least 2 ingredients`);
  return errors;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let total = 0;
  let bad = 0;
  const ids = new Set();
  for (const file of process.argv.slice(2)) {
    let list;
    try {
      list = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      console.error(`${file}: invalid JSON - ${e.message}`);
      bad++;
      continue;
    }
    if (!Array.isArray(list)) {
      console.error(`${file}: top level must be an array of recipes`);
      bad++;
      continue;
    }
    for (const r of list) {
      total++;
      const errs = validateRecipe(r);
      if (r && ids.has(r.id)) errs.push(`${r.id}: duplicate id`);
      if (r && r.id) ids.add(r.id);
      if (errs.length) {
        bad++;
        errs.forEach((e) => console.error(`${file}: ${e}`));
      }
    }
  }
  console.log(`${total} recipes checked, ${bad} with errors`);
  process.exit(bad ? 1 : 0);
}
