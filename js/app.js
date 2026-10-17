// Routing and the library / recipe pages.
//   #/                 library
//   #/recipe/<id>      one recipe
//   #/mine             only your recipes
//   #/new              new recipe
//   #/edit/<id>        edit (built-ins are edited as a copy)
(function (root) {
  "use strict";

  const { h, svg, chart, miniChart, ovenTemp } = root.RecipeRender;
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

  const SEARCH_ICON =
    '<svg width="20" height="20" viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="6" fill="none" stroke="currentColor" stroke-width="2"/><line x1="13" y1="13" x2="18" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const BACK_ICON = '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M10 3 L5 8 L10 13" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

  function counts(r) {
    return { ingredients: root.RecipeLayout.ingredients(r.tree).length, steps: root.RecipeLayout.steps(r.tree).length };
  }

  // ----- library -----
  function library(mineOnly) {
    const filter = readFilter();
    if (mineOnly) filter.cat = "My recipes";
    else if (filter.cat === "My recipes") filter.cat = "All";
    const recipes = Store.all();
    const search = h("input", { id: "lib-search", type: "search", placeholder: "short ribs, buttermilk, walnuts…", value: filter.q, autocomplete: "off" });
    const segments = h("div", { class: "segments", role: "group", "aria-label": "Category" });
    const count = h("p", { class: "count", "aria-live": "polite" });
    const grid = h("div", { class: "cards" });
    const cats = ["All"].concat(Store.CATEGORIES);
    const tally = (c) => recipes.filter((r) => c === "All" || r.category === c).length;
    const mine = recipes.filter((r) => r.mine).length;
    if (mine) cats.push("My recipes");

    function haystack(r) {
      return (r.title + " " + r.category + " " + root.RecipeLayout.ingredients(r.tree).join(" ")).toLowerCase();
    }

    function draw() {
      writeFilter(filter);
      segments.replaceChildren(
        ...cats.map((c) =>
          h(
            "button",
            {
              type: "button",
              "aria-pressed": String(c === filter.cat),
              onclick: () => {
                filter.cat = c;
                if (c === "My recipes") location.hash = "#/mine";
                else if (location.hash === "#/mine") location.hash = "#/";
                else draw();
              },
            },
            c,
            h("span", { class: "n" }, c === "My recipes" ? mine : tally(c))
          )
        )
      );
      const words = filter.q.toLowerCase().split(/\s+/).filter(Boolean);
      const shown = recipes
        .filter((r) => filter.cat === "All" || (filter.cat === "My recipes" ? r.mine : r.category === filter.cat))
        .filter((r) => {
          const text = haystack(r);
          return words.every((w) => text.includes(w));
        })
        .sort((a, b) => b.mine - a.mine || a.title.localeCompare(b.title));
      count.textContent = `Showing ${shown.length} of ${recipes.length} · A–Z`;
      grid.replaceChildren(
        ...shown.map((r) => {
          const n = counts(r);
          return h(
            "a",
            { class: "card", href: "#/recipe/" + encodeURIComponent(r.id) },
            miniChart(r.tree),
            h(
              "div",
              { class: "card-body" },
              h("span", { class: "eyebrow" }, r.category, r.mine ? h("span", { class: "badge" }, "Mine") : null),
              h("span", { class: "card-title" }, r.title),
              h("span", { class: "card-meta" }, [`${n.ingredients} ing`, `${n.steps} steps`, r.servings].filter(Boolean).join(" · "))
            )
          );
        })
      );
      if (!shown.length)
        grid.append(
          h(
            "p",
            { class: "empty-state" },
            filter.cat === "My recipes" && !filter.q ? "You haven't added any recipes yet. " : "Nothing matches. ",
            h("a", { href: "#/new" }, "Write a recipe")
          )
        );
    }

    search.addEventListener("input", () => {
      filter.q = search.value;
      draw();
    });

    app.replaceChildren(
      h(
        "section",
        { class: "hero" },
        h(
          "div",
          { class: "wrap" },
          h(
            "div",
            { class: "hero-copy" },
            h("p", { class: "eyebrow" }, `${recipes.length} recipes · one sheet each`),
            h("h1", { class: "display" }, "Every recipe", h("br"), "on one sheet."),
            h("p", { class: "lede" }, "Ingredients down the side. Each step spans exactly what it combines. Read left to right — the last column is dinner."),
            h("a", { class: "guide-link", href: "walkthrough.html" }, "New to this? Watch the 2-minute walkthrough", h("span", { "aria-hidden": "true" }, " →"))
          ),
          h(
            "form",
            { class: "search", role: "search", onsubmit: (e) => e.preventDefault() },
            h("label", { for: "lib-search" }, "Search recipes or ingredients"),
            h("div", { class: "search-box" }, svg(SEARCH_ICON), search)
          )
        )
      ),
      h(
        "div",
        { class: "wrap library" },
        h(
          "div",
          { class: "toolbar" },
          segments,
          h(
            "div",
            { class: "actions" },
            h("button", { type: "button", class: "quiet", onclick: importFile }, "Import"),
            h("button", { type: "button", class: "quiet", onclick: () => download("my-recipes.json", Store.userRecipes()), title: "Download your own recipes as JSON" }, "Export mine")
          )
        ),
        count,
        grid
      )
    );
    draw();
  }

  // ----- one recipe -----
  function recipePage(id) {
    const r = Store.get(id);
    if (!r) return notFound();
    document.title = r.title + " · Recipe Grid";
    const n = counts(r);
    const oven = ovenTemp(r);
    const stats = [
      r.servings ? ["Yield", r.servings.replace(/^./, (c) => c.toUpperCase())] : null,
      ["Ingredients", n.ingredients],
      ["Steps", n.steps],
      oven ? ["Oven", oven] : null,
    ].filter(Boolean);
    const sheet = chart(r.tree, { prep: r.prep });
    const hasHeat = !!sheet.querySelector("td.heat");

    app.replaceChildren(
      h(
        "div",
        { class: "wrap page" },
        h("a", { class: "back", href: "#/" }, svg(BACK_ICON), "All recipes"),
        h(
          "div",
          { class: "recipe-head" },
          h(
            "div",
            {},
            h("p", { class: "eyebrow" }, r.category),
            h("h1", { class: "display" }, r.title, r.mine ? h("span", { class: "badge" }, "Mine") : null)
          ),
          h(
            "div",
            { class: "actions" },
            h("a", { class: "button", href: "#/edit/" + encodeURIComponent(r.id) }, r.mine ? "Edit" : "Edit a copy"),
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
              : null,
            h("button", { type: "button", class: "solid", onclick: () => window.print() }, "Print sheet")
          )
        ),
        h("dl", { class: "stats" }, stats.map(([k, v]) => h("div", {}, h("dt", {}, k), h("dd", {}, v)))),
        h(
          "div",
          { class: "legend" },
          h("p", {}, "Read left → right. Each step spans what it combines.", h("a", { class: "guide-link small", href: "walkthrough.html" }, "How to read a sheet")),
          h(
            "p",
            { class: "keys" },
            h("span", { class: "swipe" }, "Swipe →"),
            hasHeat ? h("span", {}, h("span", { class: "swatch heat" }), "Heat") : null,
            h("span", {}, h("span", { class: "swatch" }), "Finish")
          )
        ),
        sheet,
        r.notes && r.notes.length || r.source
          ? h(
              "div",
              { class: "below" },
              r.notes && r.notes.length ? h("section", {}, h("h2", {}, "Notes"), h("ul", {}, r.notes.map((t) => h("li", {}, t)))) : null,
              r.source
                ? h("section", {}, h("h2", {}, "Source"), h("p", {}, "Adapted from ", h("a", { href: r.source.url, target: "_blank", rel: "noopener" }, r.source.name)))
                : null
            )
          : null
      )
    );
  }

  function notFound() {
    app.replaceChildren(h("div", { class: "wrap page" }, h("p", { class: "empty-state" }, "That recipe isn't here. ", h("a", { href: "#/" }, "Back to all recipes"))));
  }

  function markNav(which) {
    for (const a of document.querySelectorAll("[data-nav]")) {
      if (a.dataset.nav === which) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
  }

  function route() {
    if (closeEditor) closeEditor();
    closeEditor = null;
    document.title = "Recipe Grid";
    const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
    const done = (id) => (location.hash = id ? "#/recipe/" + encodeURIComponent(id) : "#/");
    if (parts[0] === "recipe" && parts[1]) {
      markNav("all");
      recipePage(parts[1]);
    } else if (parts[0] === "new") {
      markNav("new");
      closeEditor = root.RecipeEditor.open(app, null, false, done);
    } else if (parts[0] === "edit" && parts[1]) {
      markNav(null);
      const r = Store.get(parts[1]);
      if (!r) notFound();
      else closeEditor = root.RecipeEditor.open(app, r, !r.mine, done);
    } else if (parts[0] === "mine") {
      markNav("mine");
      library(true);
    } else {
      markNav("all");
      library(false);
    }
    window.scrollTo(0, 0);
    // The editor focuses its own first field.
    if (!closeEditor) app.focus({ preventScroll: true });
  }

  window.addEventListener("hashchange", route);
  route();
})(window);
