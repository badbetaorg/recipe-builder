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

  // An inline SVG element (h() can't create SVG-namespaced nodes).
  function svg(markup, attrs) {
    const wrap = document.createElement("span");
    wrap.innerHTML = markup;
    const el = wrap.firstElementChild;
    el.setAttribute("aria-hidden", "true");
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    return el;
  }

  const UNIT = /^(large|small|medium|whole|cups?|Tbs\.?|tbsp\.?|tsp\.?|lbs?\.?|oz\.?|cloves?|cans?|pinch|dash|sticks?|slices?|sprigs?|stalks?|bunch|heads?|g|kg|mL|L|pieces?|packages?|jars?|each)$/i;

  // "2 large (250 g) ripe bananas" -> ["2 large (250 g)", "ripe bananas"].
  // Returns ["", text] when there is no leading amount.
  function splitQuantity(text) {
    if (!/^[\d½⅓⅔¼¾⅛]/.test(text)) return ["", text];
    const paren = text.indexOf(")");
    if (paren > 0 && paren < 32 && text.indexOf("(") < paren) {
      const name = text.slice(paren + 1).trim();
      if (name) return [text.slice(0, paren + 1), name];
    }
    const words = text.split(/\s+/);
    let n = 1;
    while (n < words.length - 1 && n < 5 && (UNIT.test(words[n]) || /^[\d\/\-–½⅓⅔¼¾⅛]+$/.test(words[n]) || words[n] === "to" || words[n] === "or")) n++;
    return [words.slice(0, n).join(" "), words.slice(n).join(" ")];
  }

  // "bake 350°F (175°C) 55 min." -> ["bake", "350°F (175°C) 55 min."]
  function splitStep(text) {
    const words = text.split(/\s+/);
    const i = words.findIndex((w) => /\d/.test(w));
    if (i <= 0) return [text, ""];
    return [words.slice(0, i).join(" "), words.slice(i).join(" ")];
  }

  const HEAT = /\b(bake|roast|broil|grill|fry|deep-fry|sear|toast)\b/i;

  // Render a recipe (or a list of in-progress roots) as a table.
  // opts.prep: setup lines shown in a "Before you start" row above the grid.
  // opts.onCell(cell, td): called for each non-empty cell, e.g. to wire up editing.
  function chart(roots, opts) {
    opts = opts || {};
    const grid = root.RecipeLayout.layout(roots);
    const finished = !Array.isArray(roots) || roots.length === 1;
    const table = h("table", { class: "chart" + (opts.editable ? " editable" : "") });
    const body = h("tbody");
    const prep = opts.prep || [];
    if (prep.length) {
      body.append(
        h(
          "tr",
          {},
          h(
            "td",
            { class: "prep", colspan: grid.columns },
            h(
              "div",
              { class: "prep-list" },
              h("span", { class: "tag" }, "Before you start"),
              prep.map((line, i) => h("span", { class: "prep-item" }, h("span", { class: "num" }, String(i + 1).padStart(2, "0")), line))
            )
          )
        )
      );
    }
    for (const row of grid.rows) {
      const tr = h("tr");
      for (const cell of row) {
        let content = "";
        let cls = cell.kind;
        if (cell.kind === "ingredient") {
          const [qty, name] = splitQuantity(cell.text);
          content = qty ? [h("span", { class: "qty" }, qty), " ", h("span", { class: "name" }, name)] : cell.text;
        } else if (cell.kind === "step") {
          const [action, detail] = splitStep(cell.text);
          content = [h("span", { class: "action" }, action), detail ? h("span", { class: "detail" }, detail) : null];
          if (finished && cell.col === grid.columns - 1) cls += " finish";
          else if (HEAT.test(action)) cls += " heat";
        } else content = h("span", { class: "visually-hidden" }, "no step");
        const td = h(
          "td",
          {
            class: cls,
            rowspan: cell.rowspan > 1 ? cell.rowspan : null,
            colspan: cell.colspan > 1 ? cell.colspan : null,
          },
          content
        );
        if (cell.kind !== "empty" && opts.onCell) opts.onCell(cell, td);
        tr.append(td);
      }
      body.append(tr);
    }
    table.append(body);
    return h("div", { class: "chart-scroll" }, table);
  }

  // A miniature of the chart's shape: for each step column, the row ranges
  // (as percentages) its cells cover. Used on library cards.
  function shape(tree) {
    const grid = root.RecipeLayout.layout(tree);
    const cols = Array.from({ length: Math.max(grid.columns - 1, 0) }, () => []);
    for (const row of grid.rows)
      for (const cell of row)
        if (cell.kind === "step") cols[cell.col - 1].push([(cell.row / grid.rowCount) * 100, (cell.rowspan / grid.rowCount) * 100]);
    return cols;
  }

  function miniChart(tree) {
    const cols = shape(tree);
    return h(
      "div",
      { class: "mini", "aria-hidden": "true" },
      h("div", { class: "mini-ing" }),
      cols.map((segs, i) =>
        h(
          "div",
          { class: "mini-col" },
          segs.map(([top, height]) =>
            h("div", { class: "mini-seg" + (i === cols.length - 1 ? " last" : ""), style: `top:calc(${top}% + 1px);height:calc(${height}% - 2px)` })
          )
        )
      )
    );
  }

  // "350°F (175°C)" from the setup lines or steps, if the recipe uses an oven.
  function ovenTemp(recipe) {
    const text = (recipe.prep || []).concat(root.RecipeLayout.steps(recipe.tree)).join(" ");
    const m = text.match(/(\d{3})\s*°F(?:\s*\((\d{2,3})\s*°C\))?/);
    return m ? m[1] + "°F" + (m[2] ? " · " + m[2] + "°C" : "") : "";
  }

  root.RecipeRender = { h, svg, chart, miniChart, splitQuantity, splitStep, ovenTemp };
})(window);
