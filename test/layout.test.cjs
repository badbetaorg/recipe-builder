// Run with: node --test test/*.test.cjs
const test = require("node:test");
const assert = require("node:assert");
const { layout, ingredients, steps } = require("../js/layout.js");
const banana = require("../data/batches/00-example.json")[0];

// Compact picture of each row: "col:rowspan:colspan:text" ("." for empty cells).
function picture(grid) {
  return grid.rows.map((row) => row.map((c) => `${c.col}:${c.rowspan}:${c.colspan}:${c.kind === "empty" ? "." : c.text.split(" ")[0]}`).join(" "));
}

test("banana bread matches the printed chart", () => {
  const grid = layout(banana.tree);
  assert.strictEqual(grid.columns, 7);
  assert.deepStrictEqual(picture(grid), [
    "0:1:1:2 1:1:1:mash 2:4:1:mash 3:10:1:fold 4:10:1:bake 5:10:1:cool 6:10:1:cool",
    "0:1:1:6 1:1:1:melt",
    "0:1:1:1 1:1:1:.", // vanilla has no prep of its own
    "0:1:1:2 1:1:1:lightly",
    "0:1:1:1-1/3 1:5:1:whisk 2:6:1:.", // one empty cell beside whisk and walnuts
    "0:1:1:2/3",
    "0:1:1:1/2",
    "0:1:1:1/4",
    "0:1:1:1/2",
    "0:1:1:1/2 1:1:1:.",
  ]);
});

test("gaps covering the same rows merge across columns", () => {
  const grid = layout({ do: "toss", in: ["oil", { do: "whisk", in: [{ do: "mince", in: ["shallot"] }, "vinegar"] }] });
  assert.deepStrictEqual(picture(grid), ["0:1:1:oil 1:1:2:. 3:3:1:toss", "0:1:1:shallot 1:1:1:mince 2:2:1:whisk", "0:1:1:vinegar 1:1:1:."]);
});

test("unfinished roots are padded to the right edge and duplicates keep their own rows", () => {
  const grid = layout(["salt", { do: "mix", in: ["salt", "egg"] }]);
  assert.deepStrictEqual(picture(grid), ["0:1:1:salt 1:1:1:.", "0:1:1:salt 1:2:1:mix", "0:1:1:egg"]);
  assert.deepStrictEqual(grid.rows[1][0].path, [1, 0]);
});

test("ingredients and steps are listed in order", () => {
  assert.strictEqual(ingredients(banana.tree).length, 10);
  assert.deepStrictEqual(steps(banana.tree).slice(-3), ["bake 350°F (175°C) 55 min.", "cool 10 min. in pan", "cool on wire rack"]);
});
