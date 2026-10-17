// Recipe editor. The user adds ingredients to a workbench, then repeatedly
// ticks the items that go together and names the action that combines them.
// Each combine wraps those items in a new step, so the table grows to the
// right until a single final step remains. Any cell in the preview can be
// clicked to rename, wrap, ungroup, pull out, reorder or delete it.
(function (root) {
  "use strict";

  const { h, chart, splitQuantity } = root.RecipeRender;
  const Store = root.RecipeStore;
  const isStep = root.RecipeLayout.isStep;
  const DRAFT_KEY = "recipe-grid:new-draft";

  function clone(x) {
    return JSON.parse(JSON.stringify(x));
  }

  function lines(text) {
    return String(text || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function summary(node) {
    const items = root.RecipeLayout.ingredients(node);
    const short = items.map((s) => s.replace(/^[\d\s./\-–()a-zA-Z]*?\)\s*/, "") || s);
    return short.join(", ");
  }

  function ingredientLabel(text) {
    const [qty, name] = splitQuantity(text);
    return qty ? h("span", {}, h("span", { class: "qty" }, qty), " ", name) : h("span", {}, text);
  }

  function loadDraft() {
    try {
      return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    } catch (e) {
      return null;
    }
  }

  function storeDraft(draft) {
    try {
      if (draft) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      else localStorage.removeItem(DRAFT_KEY);
    } catch (e) {
      /* drafts are a convenience only */
    }
  }

  // Open the editor in `container`. `existing` is a recipe to edit, or null
  // for a new one. `copyOf` marks an edit of a built-in, saved as a new recipe.
  function open(container, existing, copyOf, onDone) {
    const isNew = !existing || copyOf;
    let restored = false;
    let draft;
    if (existing) {
      draft = {
        id: copyOf ? null : existing.id,
        title: copyOf ? existing.title + " (my version)" : existing.title,
        category: existing.category,
        servings: existing.servings || "",
        prep: (existing.prep || []).join("\n"),
        notes: (existing.notes || []).join("\n"),
        sourceName: existing.source ? existing.source.name : "",
        sourceUrl: existing.source ? existing.source.url : "",
        roots: [clone(existing.tree)],
      };
    } else {
      const saved = loadDraft();
      restored = !!(saved && (saved.title || saved.roots.length));
      draft = restored
        ? saved
        : { id: null, title: "", category: Store.CATEGORIES[0], servings: "", prep: "", notes: "", sourceName: "", sourceUrl: "", roots: [] };
    }

    const selected = new Set();
    const history = [];
    let popover = null;
    let activePath = null;

    function persist() {
      if (!existing) storeDraft(draft);
    }

    function checkpoint() {
      history.push(clone(draft.roots));
      if (history.length > 100) history.shift();
    }

    function locate(path) {
      let list = draft.roots;
      for (let i = 0; i < path.length - 1; i++) list = list[path[i]].in;
      return { list, index: path[path.length - 1] };
    }

    // Remove steps left with no inputs after a deletion or pull-out.
    function prune(nodes) {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if (isStep(n)) {
          prune(n.in);
          if (n.in.length === 0) nodes.splice(i, 1);
        }
      }
    }

    function change(fn) {
      checkpoint();
      fn();
      prune(draft.roots);
      selected.clear();
      closePopover();
      persist();
      refresh();
    }

    // ----- form -----
    let fieldCount = 0;
    function field(labelText, input, cls) {
      input.id = input.id || "field-" + ++fieldCount;
      return h("div", { class: cls }, h("label", { for: input.id }, labelText), input);
    }
    function bind(key, input) {
      input.addEventListener("input", () => {
        draft[key] = input.value;
        persist();
      });
      return input;
    }

    const titleInput = bind("title", h("input", { type: "text", value: draft.title, placeholder: "e.g. Grandma's Banana Bread", required: true }));
    const categorySelect = bind(
      "category",
      h("select", {}, Store.CATEGORIES.map((c) => h("option", { value: c, selected: c === draft.category }, c)))
    );
    const servingsInput = bind("servings", h("input", { type: "text", value: draft.servings, placeholder: "about 10 servings" }));
    const prepInput = bind("prep", h("textarea", { rows: 2, placeholder: "Butter and flour a loaf pan\nPreheat oven to 350°F (175°C)" }));
    prepInput.value = draft.prep;
    const notesInput = bind("notes", h("textarea", { id: "field-notes", rows: 3, placeholder: "Optional tips, one per line" }));
    notesInput.value = draft.notes;
    const sourceName = bind("sourceName", h("input", { type: "text", value: draft.sourceName, placeholder: "Where it's from (optional)" }));
    const sourceUrl = bind("sourceUrl", h("input", { type: "url", value: draft.sourceUrl, placeholder: "https://…" }));

    // ----- ingredients -----
    const ingredientInput = h("input", {
      type: "text",
      placeholder: "2 large (250 g) ripe bananas",
      "aria-label": "Ingredient",
    });
    function addIngredients(items) {
      if (!items.length) return;
      change(() => draft.roots.push(...items));
      ingredientInput.value = "";
      ingredientInput.focus();
    }
    ingredientInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addIngredients(lines(ingredientInput.value));
      }
    });
    ingredientInput.addEventListener("paste", (e) => {
      const text = (e.clipboardData || window.clipboardData).getData("text");
      if (text.includes("\n")) {
        e.preventDefault();
        addIngredients(lines(text));
      }
    });

    // ----- combine -----
    const actionInput = h("input", { type: "text", "aria-label": "Action", placeholder: "whisk · mash · bake 350°F (175°C) 55 min." });
    const combineButton = h("button", { type: "button", class: "accent", onclick: combine }, "Combine");
    actionInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        combine();
      }
    });
    actionInput.addEventListener("input", updateCombine);

    function combine() {
      const text = actionInput.value.trim();
      if (!text || selected.size === 0) return;
      const picks = [...selected].sort((a, b) => a - b);
      change(() => {
        const step = { do: text, in: picks.map((i) => draft.roots[i]) };
        for (let i = picks.length - 1; i >= 1; i--) draft.roots.splice(picks[i], 1);
        draft.roots[picks[0]] = step;
      });
      actionInput.value = "";
      // Keep the new step selected so a chain (bake → cool → slice) is quick.
      selected.add(picks[0]);
      refresh();
      actionInput.focus();
    }

    function updateCombine() {
      combineButton.disabled = !(selected.size > 0 && actionInput.value.trim());
      combineButton.textContent =
        selected.size > 1 ? `Combine ${selected.size}` : selected.size === 1 ? "Add step" : "Combine";
    }

    const undoButton = h("button", {
      type: "button",
      class: "quiet",
      onclick: () => {
        if (!history.length) return;
        draft.roots = history.pop();
        selected.clear();
        closePopover();
        persist();
        refresh();
      },
    }, "Undo");

    const bench = h("ul", { class: "bench" });
    const preview = h("div", {});
    const message = h("div", {});
    const status = h("p", { class: "status", role: "status" });

    function renderStatus() {
      const loose = draft.roots.length;
      status.hidden = loose === 0;
      if (loose === 1 && isStep(draft.roots[0])) {
        status.className = "status ready";
        status.replaceChildren(h("span", { class: "chip" }, "READY"), "One final step — this recipe can be saved.");
      } else {
        status.className = "status";
        status.replaceChildren(
          h("span", { class: "chip" }, `${loose} LOOSE`),
          loose === 1 ? "Give it a step to finish the sheet." : "Combine everything into one final step to save."
        );
      }
    }

    function renderBench() {
      bench.replaceChildren();
      if (!draft.roots.length) {
        bench.append(h("li", { class: "empty-bench" }, "Nothing here yet — add ingredients above."));
        return;
      }
      draft.roots.forEach((node, i) => {
        const box = h("input", {
          type: "checkbox",
          checked: selected.has(i),
          "aria-label": "Select " + (isStep(node) ? node.do : node),
          onchange: () => {
            if (box.checked) selected.add(i);
            else selected.delete(i);
            refresh();
          },
        });
        const move = (d) => () => {
          const j = i + d;
          if (j < 0 || j >= draft.roots.length) return;
          change(() => ([draft.roots[i], draft.roots[j]] = [draft.roots[j], draft.roots[i]]));
        };
        bench.append(
          h(
            "li",
            { class: selected.has(i) ? "selected" : "" },
            box,
            h(
              "span",
              { class: "label", onclick: () => box.click() },
              h("span", { class: "kind" }, isStep(node) ? `Step · ${root.RecipeLayout.ingredients(node).length} inside` : "Ingredient"),
              isStep(node) ? h("span", { class: "step-name" }, node.do) : ingredientLabel(node),
              isStep(node) ? h("small", {}, summary(node)) : null
            ),
            h("button", { type: "button", class: "move", title: "Move up", "aria-label": "Move up", disabled: i === 0, onclick: move(-1) }, "↑"),
            h("button", { type: "button", class: "move", title: "Move down", "aria-label": "Move down", disabled: i === draft.roots.length - 1, onclick: move(1) }, "↓")
          )
        );
      });
    }

    function renderPreview() {
      const prep = lines(draft.prep);
      preview.replaceChildren();
      if (!draft.roots.length) {
        preview.append(h("div", { class: "sheet-empty" }, "Your sheet builds here as you add ingredients and combine them."));
        return;
      }
      preview.append(
        chart(draft.roots, {
          prep,
          editable: true,
          onCell(cell, td) {
            td.tabIndex = 0;
            if (cell.path.length === 1 && selected.has(cell.path[0])) td.classList.add("root-selected");
            if (activePath && activePath.join() === cell.path.join()) td.classList.add("active");
            const openIt = () => openPopover(cell, td);
            td.addEventListener("click", openIt);
            td.addEventListener("keydown", (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openIt();
              }
            });
          },
        })
      );
    }

    // ----- cell popover -----
    function closePopover() {
      if (popover) popover.remove();
      popover = null;
      activePath = null;
      document.removeEventListener("mousedown", outside, true);
      document.removeEventListener("keydown", escape, true);
    }
    function outside(e) {
      if (popover && !popover.contains(e.target) && !(e.target.closest && e.target.closest(".chart.editable td"))) {
        closePopover();
        renderPreview();
      }
    }
    function escape(e) {
      if (e.key === "Escape") {
        closePopover();
        renderPreview();
      }
    }

    function openPopover(cell, td) {
      closePopover();
      activePath = cell.path;
      td.classList.add("active");
      const { list, index } = locate(cell.path);
      const node = list[index];
      const step = isStep(node);
      const text = h("input", { type: "text", value: step ? node.do : node, "aria-label": step ? "Step text" : "Ingredient" });
      const wrapText = h("input", { type: "text", placeholder: step ? "Next action, e.g. cool 10 min." : "Prep, e.g. dice · melt · lightly beat" });
      const save = () => {
        const v = text.value.trim();
        if (!v) return;
        change(() => {
          if (step) node.do = v;
          else list[index] = v;
        });
      };
      text.addEventListener("keydown", (e) => e.key === "Enter" && save());
      const wrap = () => {
        const v = wrapText.value.trim();
        if (!v) return wrapText.focus();
        change(() => (list[index] = { do: v, in: [node] }));
      };
      wrapText.addEventListener("keydown", (e) => e.key === "Enter" && wrap());
      const nested = cell.path.length > 1;
      const btn = (label, fn, opts) => h("button", Object.assign({ type: "button", onclick: fn }, opts || {}), label);

      popover = h(
        "div",
        { class: "popover", role: "dialog", "aria-label": "Edit cell" },
        h("label", {}, step ? "Step" : "Ingredient"),
        h("div", { class: "row" }, text, btn("Save", save, { class: "solid" })),
        h("label", {}, step ? "Add a following step" : "Add a prep step for this ingredient"),
        h("div", { class: "row" }, wrapText, btn("Add", wrap)),
        h(
          "div",
          { class: "buttons" },
          btn("↑ Up", () => change(() => ([list[index - 1], list[index]] = [list[index], list[index - 1]])), { disabled: index === 0 }),
          btn("↓ Down", () => change(() => ([list[index + 1], list[index]] = [list[index], list[index + 1]])), { disabled: index === list.length - 1 }),
          step ? btn("Ungroup", () => change(() => list.splice(index, 1, ...node.in)), { title: "Remove this step but keep what it combines" }) : null,
          nested
            ? btn("Pull out", () => change(() => { list.splice(index, 1); draft.roots.push(node); }), { title: "Move back to the workbench to combine differently" })
            : null,
          btn(step ? "Delete with inputs" : "Delete", () => change(() => list.splice(index, 1)), { class: "danger" })
        )
      );
      document.body.append(popover);
      const r = td.getBoundingClientRect();
      const left = Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - popover.offsetWidth - 16);
      popover.style.left = Math.max(16, left) + "px";
      popover.style.top = r.bottom + window.scrollY + 6 + "px";
      text.focus();
      text.select();
      document.addEventListener("mousedown", outside, true);
      document.addEventListener("keydown", escape, true);
    }

    function refresh() {
      renderBench();
      renderPreview();
      renderStatus();
      updateCombine();
      undoButton.disabled = history.length === 0;
      message.replaceChildren();
    }

    function finish() {
      const errors = [];
      if (!draft.title.trim()) errors.push("Give the recipe a title.");
      if (!draft.roots.length) errors.push("Add some ingredients.");
      else if (draft.roots.length > 1)
        errors.push(`Everything has to end in one final step — ${draft.roots.length} items are still separate on the workbench. Tick them all and combine (e.g. “serve”).`);
      else if (!isStep(draft.roots[0])) errors.push("Add at least one step.");
      else if (root.RecipeLayout.ingredients(draft.roots[0]).length < 2) errors.push("A recipe needs at least two ingredients.");
      if (draft.sourceUrl && !/^https?:\/\//.test(draft.sourceUrl)) errors.push("The source link should start with http:// or https://.");
      if (errors.length) {
        message.replaceChildren(h("p", { class: "message error", role: "alert" }, errors.join(" ")));
        return;
      }
      const recipe = {
        id: draft.id || Store.newId(draft.title),
        title: draft.title.trim(),
        category: draft.category,
        servings: draft.servings.trim(),
        prep: lines(draft.prep),
        notes: lines(draft.notes),
        tree: draft.roots[0],
        source: draft.sourceUrl ? { name: draft.sourceName.trim() || draft.sourceUrl, url: draft.sourceUrl.trim() } : undefined,
      };
      if (!Store.save(recipe)) {
        message.replaceChildren(h("p", { class: "message error", role: "alert" }, "Couldn't save — this browser is blocking local storage. Use Export to keep a copy."));
        return;
      }
      if (!existing) storeDraft(null);
      closePopover();
      onDone(recipe.id);
    }

    const heading = existing ? (copyOf ? existing.title : "Edit " + existing.title) : "New recipe";
    const eyebrow = existing ? (copyOf ? "Your copy of a built-in recipe" : "Editing your recipe") : "Draft · saved in this browser";
    const panel = (no, title, hint, cls, ...body) =>
      h("section", { class: "panel" + (cls ? " " + cls : "") }, h("h2", {}, h("span", { class: "step-no" }, no), title), hint ? h("p", { class: "hint" }, hint) : null, ...body);

    container.replaceChildren(
      h(
        "div",
        { class: "wrap page" },
        h(
          "div",
          { class: "editor-head" },
          h("div", {}, h("p", { class: "eyebrow" }, eyebrow), h("h1", { class: "display" }, heading)),
          h(
            "div",
            { class: "actions" },
            h("button", { type: "button", class: "quiet", onclick: () => { closePopover(); onDone(existing && !copyOf ? existing.id : null); } }, "Cancel"),
            h("button", { type: "button", class: "solid", onclick: finish }, "Save recipe")
          )
        ),
        isNew && copyOf ? h("p", { class: "message" }, "Built-in recipes can't be changed, so this will be saved as your own copy.") : null,
        restored
          ? h(
              "p",
              { class: "message" },
              "Picked up your unsaved draft. ",
              h("button", { type: "button", class: "quiet", onclick: () => { storeDraft(null); open(container, null, false, onDone); } }, "Start over")
            )
          : null,
        h(
          "div",
          { class: "editor-cols" },
          h(
            "div",
            { class: "editor-side" },
            panel(
              "00",
              "Details",
              null,
              "",
              h(
                "div",
                { class: "fields" },
                field("Title", titleInput, "wide"),
                field("Category", categorySelect),
                field("Yield", servingsInput),
                field("Before you start · one per line", prepInput, "wide"),
                field("Source name", sourceName),
                field("Source link", sourceUrl)
              )
            ),
            panel(
              "01",
              "Ingredients",
              "Amount first, metric in brackets: “6 Tbs. (90 mL) butter”. Paste a list to add several.",
              "",
              h("div", { class: "row" }, ingredientInput, h("button", { type: "button", onclick: () => addIngredients(lines(ingredientInput.value)) }, "Add"))
            ),
            panel(
              "02",
              "Combine",
              "Tick what goes together and name the action. Tick one item to give it its own step (melt, dice, bake). Keep going until one final step is left.",
              "strong",
              bench,
              h("div", { class: "row combine-row" }, actionInput, combineButton, undoButton)
            ),
            panel("03", "Notes", null, "", h("label", { for: "field-notes", class: "visually-hidden" }, "Notes"), notesInput)
          ),
          h(
            "section",
            { class: "editor-main", "aria-label": "Live sheet" },
            h("div", { class: "sheet-head" }, h("h2", {}, "Live sheet"), h("p", {}, "Click any cell to rename, add a step, reorder or ungroup")),
            preview,
            status,
            message
          )
        )
      )
    );
    refresh();
    (existing ? titleInput : draft.title ? ingredientInput : titleInput).focus();
    return closePopover;
  }

  root.RecipeEditor = { open };
})(window);
