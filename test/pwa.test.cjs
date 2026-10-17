// The offline cache refuses to install if any listed file is missing, so
// check the list (and the manifest's icons) against the repo.
const test = require("node:test");
const assert = require("node:assert");
const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");

test("every file the service worker precaches exists", () => {
  const sw = readFileSync(join(root, "sw.js"), "utf8");
  const list = JSON.parse(sw.match(/const SHELL = (\[[\s\S]*?\]);/)[1].replace(/,\s*\]/, "]"));
  for (const path of list) if (path !== "./") assert.ok(existsSync(join(root, path)), `${path} is listed in sw.js but missing`);
});

test("every manifest icon exists", () => {
  const manifest = JSON.parse(readFileSync(join(root, "manifest.webmanifest"), "utf8"));
  for (const icon of manifest.icons) assert.ok(existsSync(join(root, icon.src)), `${icon.src} is missing`);
});

test("the deploy publishes everything the service worker needs", () => {
  const workflow = readFileSync(join(root, ".github/workflows/pages.yml"), "utf8");
  const copied = workflow.match(/cp -r (.*) _site\//)[1].split(/\s+/);
  for (const path of ["sw.js", "manifest.webmanifest", "icons", "walkthrough.html"]) assert.ok(copied.includes(path), `${path} is not deployed`);
});
