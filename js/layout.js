// Turns a recipe tree into table cells.
//
// A recipe is a tree: ingredients are leaf strings, steps are {do, in: [...]}.
// Leaves become rows (in order), and each node's column is 0 for an ingredient
// or 1 + the deepest of its inputs for a step. A step's cell spans every row of
// the ingredients beneath it. When an input sits more than one column to the
// left of its step, the gap is filled with empty cells; empty cells for
// neighbouring inputs in the same column are merged, as in a printed chart.
(function (root) {
  "use strict";

  function isStep(node) {
    return node !== null && typeof node === "object";
  }

  // Build an annotated copy of the tree: each entry knows its first row,
  // row count and column. Leaves are numbered in order as rows.
  function measure(nodes) {
    let row = 0;
    function walk(node, path) {
      if (!isStep(node)) return { node, path, first: row++, rows: 1, col: 0, children: [] };
      const first = row;
      const children = node.in.map((child, i) => walk(child, path.concat(i)));
      // A step with no inputs (only possible mid-edit) still takes up a row.
      if (row === first) row++;
      const col = 1 + children.reduce((m, c) => Math.max(m, c.col), 0);
      return { node, path, first, rows: row - first, col, children };
    }
    const tree = nodes.map((n, i) => walk(n, [i]));
    return { tree, rowCount: row };
  }

  // Empty filler cells between a parent at column `col` and its children.
  // Gaps for neighbouring children are merged down a column; a gap that
  // covers the same rows in consecutive columns is merged across.
  function fillers(children, col, cells) {
    const runs = [];
    for (let c = 1; c < col; c++) {
      let run = null;
      for (const child of children) {
        if (child.col < c) {
          if (run) run.rowspan += child.rows;
          else {
            run = { row: child.first, col: c, rowspan: child.rows, colspan: 1, kind: "empty" };
            runs.push(run);
          }
        } else run = null;
      }
    }
    for (const run of runs) {
      const left = cells.find((x) => x.kind === "empty" && x.row === run.row && x.rowspan === run.rowspan && x.col + x.colspan === run.col);
      if (left && runs.includes(left)) left.colspan++;
      else cells.push(run);
    }
  }

  // Lay out a list of root nodes (one for a finished recipe, several while editing).
  function layout(roots) {
    const { tree, rowCount } = measure(Array.isArray(roots) ? roots : [roots]);
    const cells = [];
    const maxCol = tree.reduce((m, t) => Math.max(m, t.col), 0);

    function emit(t) {
      const step = isStep(t.node);
      cells.push({
        row: t.first,
        col: t.col,
        rowspan: t.rows,
        colspan: 1,
        kind: step ? "step" : "ingredient",
        text: step ? t.node.do : t.node,
        path: t.path,
      });
      fillers(t.children, t.col, cells);
      t.children.forEach(emit);
    }
    tree.forEach(emit);
    // Unfinished roots (while editing) get padded out to the right edge.
    fillers(tree, maxCol + 1, cells);

    cells.sort((a, b) => a.row - b.row || a.col - b.col);
    const rows = Array.from({ length: rowCount }, () => []);
    for (const cell of cells) rows[cell.row].push(cell);
    return { rows, columns: maxCol + 1, rowCount };
  }

  function ingredients(node, out) {
    out = out || [];
    if (isStep(node)) node.in.forEach((c) => ingredients(c, out));
    else out.push(node);
    return out;
  }

  function steps(node, out) {
    out = out || [];
    if (isStep(node)) {
      node.in.forEach((c) => steps(c, out));
      out.push(node.do);
    }
    return out;
  }

  const api = { layout, ingredients, steps, isStep };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RecipeLayout = api;
})(typeof window !== "undefined" ? window : globalThis);
