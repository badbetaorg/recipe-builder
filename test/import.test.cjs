// Run with: node --test test/*.test.cjs
const test = require("node:test");
const assert = require("node:assert");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const Core = require("../js/import-core.js");
const { ingredients } = require("../js/layout.js");
const banana = require("../data/batches/00-example.json")[0];

// The worked example embedded in the system prompt.
function example() {
  return JSON.parse(Core.buildRequest("x").system.split("banana bread recipe:\n")[1]);
}

test("the prompt's example reply rebuilds the banana bread sheet exactly", () => {
  const { recipe, fixes } = Core.flatToTree(example());
  assert.deepStrictEqual(recipe.tree, banana.tree);
  assert.deepStrictEqual(fixes, []);
});

test("a messy reply is repaired without losing ingredients", () => {
  const flat = example();
  flat.final_step = "missing";
  flat.steps = flat.steps.map((s) => (s.id === "s6" ? { ...s, inputs: ["s4", "s5", "i9", "nowhere"] } : s));
  const { recipe, fixes } = Core.flatToTree(flat);
  assert.strictEqual(ingredients(recipe.tree).length, 10);
  assert.strictEqual(recipe.tree.do, "cool on wire rack");
  assert.strictEqual(fixes.length, 2);
});

test("URL requests let Claude fetch the page; pasted text doesn't", () => {
  const url = Core.buildRequest("https://example.com/banana-bread");
  assert.strictEqual(url.model, "claude-opus-5-5");
  assert.deepStrictEqual(url.tools, [{ type: "web_fetch_20260209", name: "web_fetch", max_uses: 3 }]);
  assert.strictEqual(url.output_config.format.type, "json_schema");
  assert.strictEqual(Core.buildRequest("2 eggs\nBeat the eggs.").tools, undefined);
});

test("failed fetches and refusals become messages for the cook", () => {
  const reply = (obj) => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(obj) }] });
  assert.throws(() => Core.parseReply(reply({ ...example(), status: "fetch_failed", problem: "Blocked." })), /Blocked\./);
  assert.throws(() => Core.parseReply({ stop_reason: "refusal", content: [] }), /declined/);
});

test("quick convert keeps separate bowls separate until the method joins them", () => {
  const text = readFileSync(join(__dirname, "fixtures/cookies.txt"), "utf8");
  const { recipe } = Core.quickConvert(text);
  assert.strictEqual(recipe.title, "Classic Chocolate Chip Cookies");
  assert.strictEqual(recipe.servings, "36 cookies");
  assert.deepStrictEqual(recipe.prep, ["Preheat oven to 375°F (190°C)"]);
  assert.strictEqual(ingredients(recipe.tree).length, 10);
  // "beat in" the flour mixture joins the dry bowl with the creamed butter.
  const find = (node, name) => (typeof node === "string" ? null : node.do === name ? node : node.in.map((c) => find(c, name)).find(Boolean));
  const merge = find(recipe.tree, "beat in");
  assert.deepStrictEqual(merge.in.map((n) => n.do), ["combine", "add"]);
});

test("short actions keep times and temperatures", () => {
  assert.strictEqual(Core.shortAction("Bake at 350°F (175°C) for 25-30 minutes."), "bake 350°F (175°C) 25-30 min.");
  assert.strictEqual(Core.shortAction("In a large bowl, whisk together the flour and salt."), "whisk together");
  assert.strictEqual(Core.shortAction("Gradually beat in the flour mixture."), "beat in");
});

test("quick convert opens a branch for a new pan and joins it at serving", () => {
  const { recipe } = Core.quickConvert(
    [
      "Weeknight Tomato Soup",
      "- 2 tablespoons olive oil",
      "- 1 medium onion, diced",
      "- 1 (28 oz) can whole tomatoes",
      "- 4 slices sourdough bread",
      "- 2 tablespoons butter",
      "Heat the olive oil in a large pot. Add the onion and cook until soft, about 6 minutes. Add the tomatoes and cook for 20 minutes.",
      "Meanwhile, butter the bread and toast in a skillet until golden. Serve the soup with the toast.",
    ].join("\n")
  );
  assert.strictEqual(recipe.category, "Soups & Stews");
  assert.strictEqual(recipe.tree.do, "serve");
  assert.strictEqual(recipe.tree.in.length, 2);
  assert.strictEqual(ingredients(recipe.tree).length, 5);
});
