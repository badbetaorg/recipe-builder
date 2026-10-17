// Routing and the library / recipe pages.
//   #/                 library
//   #/recipe/<id>      one recipe
//   #/new              new recipe
//   #/edit/<id>        edit (built-ins are edited as a copy)
(function (root) {
  "use strict";

  const { h, chart } = root.RecipeRender;
  const Store = root.RecipeStore;
  const app = document.getElementById("app");
  const FILTER_KEY = "recipe-grid:filter";
  let closeEditor = null;

  function readFilter() {
    try {
      return JSON.parse(sessionStorage.getItem(FILTER_KEY)) || { q: "", cat: "All" };
    } catch (e) {
      return { q: "", cat: "All" };
    }
  }
  function writeFilter(f) {
    try {
      sessionStorage.setItem(FILTER_KEY, JSON.stringify(f));
    } catch (e) {
      /* remembering the filter is a convenience only */
    }
  }

  function download(name, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = h("a", { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function exportable(r) {
    const copy = Object.assign({}, r);
    delete copy.mine;
    return copy;
  }

  function importFile() {
    const input = h("input", { type: "file", accept: "application/json,.json" });
    input.addEventListener("change", async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const n = Store.importMany(Array.isArray(data) ? data : [data]);
        alert(n ? `Imported ${n} recipe${n === 1 ? "" : "s"}.` : "No recipes found in that file.");
      } catch (e) {
        alert("That file isn't a recipe export (" + e.message + ").");
      }
      route();
    });
    input.click();
  }

  // ----- library -----
  function library() {
    const filter = readFilter();
    const recipes = Store.all();
    const search = h("input", { type: "search", placeholder: "Search recipes or ingredients…", value: filter.q, "aria-label": "Search recipes" });
    const chips = h("div", { class: "chips", role: "group", "aria-label": "Category" });
    const count = h("p", { class: "count", "aria-live": "polite" });
    const grid = h("div", { class: "cards" });
    const cats = ["All"].concat(Store.CATEGORIES, ["My recipes"]);

    function haystack(r) {
      return (r.title + " " + root.RecipeLayout.ingredients(r.tree).join(" ")).toLowerCase();
    }

    function draw() {
      writeFilter(filter);
      chips.replaceChildren(
        ...cats.map((c) =>
          h("button", { type: "button", class: "chip", "aria-pressed": String(c === filter.cat), onclick: () => { filter.cat = c; draw(); } }, c)
        )
      );
      const words = filter.q.toLowerCase().split(/\s+/).filter(Boolean);
      const shown = recipes
        .filter((r) => filter.cat === "All" || (filter.cat === "My recipes" ? r.mine : r.category === filter.cat))
        .filter((r) => {
          const text = haystack(r);
          return words.every((w) => text.includes(w));
        })
        .sort((a, b) => (b.mine - a.mine) || a.title.localeCompare(b.title));
      count.textContent = `${shown.length} of ${recipes.length} recipes`;
      grid.replaceChildren(
        ...shown.map((r) =>
          h(
            "a",
            { class: "card", href: "#/recipe/" + encodeURIComponent(r.id) },
            h("h3", {}, r.title, r.mine ? h("span", { class: "badge" }, "Mine") : null),
            h("div", { class: "meta" }, r.category),
            h(
              "div",
              { class: "meta" },
              [r.servings, `${root.RecipeLayout.ingredients(r.tree).length} ingredients`, `${root.RecipeLayout.steps(r.tree).length} steps`]
                .filter(Boolean)
                .join(" · ")
            )
          )
        )
      );
      if (!shown.length)
        grid.append(
          h(
            "p",
            { class: "empty-state" },
            filter.cat === "My recipes" && !filter.q ? "You haven't added any recipes yet. " : "Nothing matches. ",
            h("a", { href: "#/new" }, "Add a recipe")
          )
        );
    }

    search.addEventListener("input", () => {
      filter.q = search.value;
      draw();
    });

    app.replaceChildren(
      h(
        "div",
        { class: "toolbar" },
        search,
        h("button", { type: "button", onclick: importFile }, "Import"),
        h("button", { type: "button", onclick: () => download("my-recipes.json", Store.userRecipes()), title: "Download your own recipes as JSON" }, "Export mine")
      ),
      chips,
      count,
      grid
    );
    draw();
  }

  // ----- one recipe -----
  function recipePage(id) {
    const r = Store.get(id);
    if (!r) return notFound();
    document.title = r.title + " · Recipe Grid";
    app.replaceChildren(...[
      h("a", { class: "crumb", href: "#/" }, "← All recipes"),
      h(
        "div",
        { class: "recipe-head" },
        h("h1", { class: "recipe-title" }, r.title, " ", r.servings ? h("small", {}, `(${r.servings})`) : null, r.mine ? h("span", { class: "badge" }, "Mine") : null),
        h(
          "div",
          { class: "actions" },
          h("a", { class: "button", href: "#/edit/" + encodeURIComponent(r.id) }, r.mine ? "Edit" : "Edit a copy"),
          h("button", { type: "button", onclick: () => window.print() }, "Print"),
          h("button", { type: "button", onclick: () => download(r.id + ".json", exportable(r)) }, "Export"),
          r.mine
            ? h(
                "button",
                {
                  type: "button",
                  class: "danger",
                  onclick: () => {
                    if (confirm(`Delete “${r.title}”? This can't be undone.`)) {
                      Store.remove(r.id);
                      location.hash = "#/";
                    }
                  },
                },
                "Delete"
              )
            : null
        )
      ),
      chart(r.tree, { prep: r.prep }),
      r.notes && r.notes.length ? h("div", { class: "recipe-notes" }, h("strong", {}, "Notes"), h("ul", {}, r.notes.map((n) => h("li", {}, n)))) : null,
      r.source ? h("p", { class: "source" }, "Adapted from ", h("a", { href: r.source.url, target: "_blank", rel: "noopener" }, r.source.name)) : null,
    ].filter(Boolean));
  }

  function notFound() {
    app.replaceChildren(h("p", { class: "empty-state" }, "That recipe isn't here. ", h("a", { href: "#/" }, "Back to all recipes")));
  }

  function route() {
    if (closeEditor) closeEditor();
    closeEditor = null;
    document.title = "Recipe Grid Cookbook";
    const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
    const done = (id) => (location.hash = id ? "#/recipe/" + encodeURIComponent(id) : "#/");
    if (parts[0] === "recipe" && parts[1]) recipePage(parts[1]);
    else if (parts[0] === "new") closeEditor = root.RecipeEditor.open(app, null, false, done);
    else if (parts[0] === "edit" && parts[1]) {
      const r = Store.get(parts[1]);
      if (!r) notFound();
      else closeEditor = root.RecipeEditor.open(app, r, !r.mine, done);
    } else library();
    window.scrollTo(0, 0);
    // The editor focuses its own first field.
    if (!closeEditor) app.focus({ preventScroll: true });
  }

  window.addEventListener("hashchange", route);
  route();
})(window);
