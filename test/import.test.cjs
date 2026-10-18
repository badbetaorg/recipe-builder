// Run with: node --test test/*.test.cjs
const test = require("node:test");
const assert = require("node:assert");
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
