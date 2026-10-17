// DOM helpers and the recipe chart renderer shared by the viewer and editor.
(function (root) {
  "use strict";

  // h("div", {class: "x", onclick: fn}, child, "text", [more children])
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "class") el.className = v;
      else if (k === "value") el.value = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    const add = (c) => {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    };
    children.forEach(add);
    return el;
  }

  // Render a recipe (or a list of in-progress roots) as a table.
  // opts.prep: setup lines shown as full-width rows above the grid.
  // opts.onCell(cell, td): called for each non-empty cell, e.g. to wire up editing.
  function chart(roots, opts) {
    opts = opts || {};
    const grid = root.RecipeLayout.layout(roots);
    const table = h("table", { class: "chart" + (opts.editable ? " editable" : "") });
    const body = h("tbody");
    for (const line of opts.prep || []) {
      body.append(h("tr", {}, h("td", { class: "prep", colspan: grid.columns }, line)));
    }
    for (const row of grid.rows) {
      const tr = h("tr");
      for (const cell of row) {
        const td = h(
          "td",
          {
            class: cell.kind,
            rowspan: cell.rowspan > 1 ? cell.rowspan : null,
            colspan: cell.colspan > 1 ? cell.colspan : null,
          },
          cell.text || ""
        );
        if (cell.kind !== "empty" && opts.onCell) opts.onCell(cell, td);
        tr.append(td);
      }
      body.append(tr);
    }
    table.append(body);
    return h("div", { class: "chart-scroll" }, table);
  }

  root.RecipeRender = { h, chart };
})(window);
