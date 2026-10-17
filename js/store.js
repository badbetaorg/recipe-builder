// Built-in recipes come from data/recipes.js; the user's own recipes live in
// localStorage. User recipes shadow a built-in with the same id.
(function (root) {
  "use strict";

  const KEY = "recipe-grid:user-recipes";
  const CATEGORIES = ["Breakfast", "Baking & Desserts", "Soups & Stews", "Salads & Sides", "Main Dishes"];

  function readUser() {
    try {
      const list = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function writeUser(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      return false;
    }
  }

  function builtIns() {
    return (root.RECIPES || []).map((r) => Object.assign({}, r, { mine: false }));
  }

  function all() {
    const mine = readUser().map((r) => Object.assign({}, r, { mine: true }));
    const ids = new Set(mine.map((r) => r.id));
    return mine.concat(builtIns().filter((r) => !ids.has(r.id)));
  }

  function get(id) {
    return all().find((r) => r.id === id) || null;
  }

  function slugify(text) {
    return (
      String(text)
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "recipe"
    );
  }

  // A fresh id for a new user recipe that doesn't collide with anything.
  function newId(title) {
    const taken = new Set(all().map((r) => r.id));
    const base = "my-" + slugify(title);
    let id = base;
    for (let n = 2; taken.has(id); n++) id = base + "-" + n;
    return id;
  }

  function clean(recipe) {
    const out = {
      id: recipe.id,
      title: recipe.title,
      category: recipe.category,
      servings: recipe.servings,
      prep: recipe.prep || [],
      tree: recipe.tree,
    };
    if (recipe.notes && recipe.notes.length) out.notes = recipe.notes;
    if (recipe.source && recipe.source.url) out.source = recipe.source;
    out.updated = new Date().toISOString();
    return out;
  }

  function save(recipe) {
    const list = readUser();
    const i = list.findIndex((r) => r.id === recipe.id);
    if (i >= 0) list[i] = clean(recipe);
    else list.unshift(clean(recipe));
    return writeUser(list);
  }

  function remove(id) {
    return writeUser(readUser().filter((r) => r.id !== id));
  }

  // Merge recipes from an exported file. Returns the number imported.
  function importMany(recipes) {
    const list = readUser();
    let count = 0;
    for (const r of recipes) {
      if (!r || typeof r.title !== "string" || !r.tree) continue;
      const copy = clean(Object.assign({}, r, { category: CATEGORIES.includes(r.category) ? r.category : "Main Dishes", servings: r.servings || "" }));
      const existing = list.findIndex((x) => x.id === copy.id);
      if (!copy.id || (existing < 0 && all().some((x) => x.id === copy.id))) copy.id = newId(copy.title);
      if (existing >= 0) list[existing] = copy;
      else list.unshift(copy);
      count++;
    }
    writeUser(list);
    return count;
  }

  root.RecipeStore = { CATEGORIES, all, get, save, remove, newId, importMany, userRecipes: readUser };
})(window);
