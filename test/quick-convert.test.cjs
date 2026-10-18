// Run with: node --test test/*.test.cjs
// Each fixture is a recipe pasted the way people copy it from the web.
const test = require("node:test");
const assert = require("node:assert");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const Q = require("../js/quick-convert.js");
const { ingredients } = require("../js/layout.js");

const sheet = (name) => Q.convert(readFileSync(join(__dirname, "fixtures", name), "utf8"));
const find = (node, test) =>
  typeof node === "string" ? null : test(node) ? node : node.in.map((c) => find(c, test)).find(Boolean);
const named = (action) => (n) => n.do === action;
const has = (node, text) => ingredients(node).some((i) => i.includes(text));

test("blog clutter is dropped and the details are found", () => {
  const { recipe } = sheet("blog-banana-bread.txt");
  assert.strictEqual(recipe.title, "Easy Banana Bread");
  assert.strictEqual(recipe.category, "Baking & Desserts");
  assert.strictEqual(recipe.servings, "10 slices");
  assert.deepStrictEqual(recipe.notes, ["Freezes well for up to 3 months."]);
  assert.strictEqual(recipe.prep.length, 1);
  assert.strictEqual(ingredients(recipe.tree).length, 8);
  assert.ok(find(recipe.tree, named("bake 55 min.")));
});

test("ingredients come out in house style with metric", () => {
  assert.deepStrictEqual(Q.normalizeIngredient("1 1/2 cups all-purpose flour"), { text: "1-1/2 cups (190 g) all-purpose flour", prep: "" });
  assert.deepStrictEqual(Q.normalizeIngredient("2 tablespoons olive oil"), { text: "2 Tbs. (30 mL) olive oil", prep: "" });
  assert.deepStrictEqual(Q.normalizeIngredient("1 lb boneless skinless chicken breast, thinly sliced"), { text: "1 lb. (455 g) boneless skinless chicken breast", prep: "thinly slice" });
  assert.deepStrictEqual(Q.normalizeIngredient("1/3 cup melted butter"), { text: "1/3 cup (76 g) butter", prep: "melt" });
  assert.deepStrictEqual(Q.normalizeIngredient("1 (15 oz) can kidney beans, drained and rinsed"), { text: "1 (15 oz.) can kidney beans", prep: "drain and rinse" });
  assert.deepStrictEqual(Q.normalizeIngredient("2 tablespoons vegetable oil, divided"), { text: "2 Tbs. (30 mL) vegetable oil, divided", prep: "" });
});

test("separate bowls stay apart until the method joins them", () => {
  const { recipe } = sheet("cookies.txt");
  const join = find(recipe.tree, named("beat in"));
  assert.deepStrictEqual(join.in.map((n) => n.do), ["combine", "add"]); // dry bowl first: it was started first
  assert.ok(has(find(recipe.tree, named("combine")), "flour"));
  assert.ok(has(find(recipe.tree, named("beat until creamy")), "brown sugar"));
  assert.ok(has(find(recipe.tree, named("stir in")), "walnuts"), "'nuts' in the method means the walnuts");
});

test("a stir-fry keeps its sauce, chicken and vegetables in separate branches", () => {
  const { recipe } = sheet("stir-fry.txt");
  assert.strictEqual(recipe.tree.do, "serve over rice");
  const finish = find(recipe.tree, named("cook until thickened 2 min."));
  assert.deepStrictEqual(finish.in.map((n) => n.do), ["stir-fry until cooked through 5 to 6 min.", "whisk together", "cook 30 sec."]); // in the order they were started
  assert.ok(has(find(recipe.tree, named("whisk together")), "chicken broth"), "broth belongs to the sauce, not the chicken");
  assert.ok(find(recipe.tree, named("thinly slice")), "prep from the ingredient line becomes a cell");
});

test("pasta and its sauce cook side by side and meet at the end", () => {
  const { recipe } = sheet("pasta.txt");
  assert.deepStrictEqual(recipe.prep, ["Bring a large pot of salted water to a boil"]);
  const toss = find(recipe.tree, named("toss"));
  assert.ok(toss && has(toss, "spaghetti") && has(toss, "olive oil"));
  assert.ok(!has(find(recipe.tree, named("drain")), "salt"), "salted water isn't the salt");
});

test("a paragraph method splits into steps and doesn't confuse beef with beef broth", () => {
  const { recipe } = sheet("paragraph-chili.txt");
  assert.strictEqual(recipe.tree.do, "season");
  assert.ok(find(recipe.tree, named("simmer 30 min.")));
  assert.ok(!has(find(recipe.tree, named("brown 6 min.")), "broth"));
  assert.ok(find(recipe.tree, named("drain and rinse")));
});

test("actions read like table cells", () => {
  assert.strictEqual(Q.actionFor("Bake at 350°F (175°C) for 25-30 minutes"), "bake 350°F (175°C) 25-30 min.");
  assert.strictEqual(Q.actionFor("Drop by rounded tablespoon onto ungreased baking sheets"), "drop onto sheets");
  assert.strictEqual(Q.actionFor("Add the onion and cook until soft, about 6 minutes"), "cook until soft 6 min.");
  assert.strictEqual(Q.actionFor("Serve over rice"), "serve over rice");
});

test("numbered steps without headings are read as the method", () => {
  const { recipe } = sheet("muffins.txt");
  assert.strictEqual(ingredients(recipe.tree).length, 8);
  const join = find(recipe.tree, named("stir until just combined"));
  assert.deepStrictEqual(join.in.map((n) => n.do), ["whisk together", "whisk until combined"]);
  assert.strictEqual(recipe.prep.length, 1);
});

test("'salt and pepper' doesn't take the bell pepper, and 'olive oil' doesn't take the olives", () => {
  const { recipe } = sheet("greek-salad.txt");
  const dressing = find(recipe.tree, named("shake"));
  assert.ok(has(dressing, "Salt and black pepper") && !has(dressing, "bell pepper") && !has(dressing, "olives"));
  assert.ok(has(find(recipe.tree, named("toss gently")), "Kalamata olives"));
});

test("an unfamiliar verb still makes a step", () => {
  const { recipe } = sheet("roast-chicken.txt");
  const stuff = find(recipe.tree, named("stuff"));
  assert.ok(stuff && has(stuff, "thyme") && has(stuff, "garlic"));
  assert.ok(find(recipe.tree, named("pat dry")));
  assert.ok(find(recipe.tree, named("halve crosswise")));
});
