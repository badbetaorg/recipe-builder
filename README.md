# Recipe Grid Cookbook

A cookbook where every recipe is a single table, in the style of the classic
"tabular recipe" chart:

- ingredients run down the left column, in the order you use them
- each step is a cell to the right that spans exactly the ingredients (or
  earlier results) it combines
- the further right a cell is, the later it happens; the last column is the
  finished dish
- setup tasks (preheat the oven, grease a pan) run across the top

It ships with 100 common recipes and lets you write your own in the same style.

## Running it

No build step and no dependencies. Open `index.html` in a browser, or serve the
folder:

```sh
npm start        # python3 -m http.server 8000, then visit http://localhost:8000
```

It also works as-is on GitHub Pages.

## Importing a recipe you already have

**Import a recipe** (on the recipes page, or from the builder) turns an ordinary
recipe into a sheet, then opens it in the builder to check before saving:

- **Convert with Claude** takes a link or pasted text. Claude fetches the page,
  works out which ingredients are prepped and mixed together, and returns the
  sheet with real parallel steps. It uses your own Anthropic API key, sent
  straight from the browser to Anthropic and billed to your account (usually a
  few cents per recipe). Get a key at https://console.anthropic.com/settings/keys.
  The key is only saved on the device if you tick "Remember it".
- **Quick convert** needs no key and works offline (`js/quick-convert.js`). It
  strips blog clutter, rewrites amounts in house style with metric added,
  turns prep in the ingredient list ("1 onion, diced") into its own cell, picks
  each step's action from a cooking-verb vocabulary, and tracks separate bowls
  and pans through the method, joining them where the recipe does ("the flour
  mixture", "return the chicken"). Browsers block reading other sites, so it
  takes pasted text, not links. `test/fixtures/` holds the pasted recipes it is
  tested against.

The Claude route lives in `js/import-core.js` (tested in `test/import.test.cjs`);
the page is `js/importer.js`. Claude replies with a
flat list of ingredients and steps that `flatToTree` assembles and repairs,
listing anything it had to fix.

## Installing it on a phone

Recipe Grid is an installable web app and works offline once it has been
opened.

- **iPhone / iPad (Safari):** tap Share, then **Add to Home Screen**.
- **Android (Chrome):** tap **Install app** in the page footer, or the browser
  menu's **Install app**.
- **Desktop Chrome / Edge:** use the install icon in the address bar.

An installed copy keeps its own saved recipes. On iPhone in particular, recipes
added in Safari don't appear in the home-screen app (or the other way round),
so move them with **Export mine** and **Import**.

The offline cache lives in `sw.js`; the icons are drawn by
`tools/make-icons.py`.

New to the format? `walkthrough.html` is an animated two-minute guide to reading
a sheet and building one; the app links to it from the header.

## Writing your own recipes

Click **+ New recipe**, then:

1. **Ingredients.** Type each one and press Enter (or paste a whole list).
   Put the amount first with metric in brackets: `6 Tbs. (90 mL) butter`.
2. **Combine.** Tick the items that go together, type the action (`whisk`,
   `mash until smooth`, `bake 350°F (175°C) 55 min.`) and press Enter. Tick a
   single item to give it its own step (`melt`, `dice`) or to add the next
   step in a chain (`bake` → `cool 10 min. in pan` → `cool on wire rack`).
   Repeat until one final step is left.
3. **Adjust.** Click any cell in the preview to rename it, add a step after it,
   move it up or down, ungroup a step, pull an item back out to the workbench,
   or delete it. Undo is there too.

Your recipes are saved in this browser's local storage. Use **Export mine** to
back them up as JSON and **Import** to load them on another device. Built-in
recipes can't be changed, but **Edit a copy** saves your own version.

## Recipe format

Each recipe is a tree. Ingredients are strings; a step is
`{ "do": "...", "in": [ ... ] }`:

```json
{
  "id": "banana-nut-bread",
  "title": "Banana Nut Bread",
  "category": "Baking & Desserts",
  "servings": "about 10 servings",
  "prep": ["Butter and flour a loaf pan", "Preheat oven to 350°F (175°C)"],
  "tree": { "do": "bake 350°F (175°C) 55 min.", "in": [
    { "do": "fold", "in": [
      { "do": "mash until smooth", "in": [
        { "do": "mash", "in": ["2 large (250 g) ripe bananas"] },
        "1 tsp. (5 mL) vanilla extract"
      ] },
      "1/2 cup (70 g) chopped walnuts"
    ] }
  ] },
  "source": { "name": "…", "url": "https://…" }
}
```

`js/layout.js` turns the tree into table cells. Each ingredient is a row; a
step's column is one more than its deepest input. Empty cells fill the gaps.

## Built-in recipes

The built-in recipes live in `data/batches/*.json`. Each one was researched
from a well-known published version, rewritten into table form, and links its
source. After editing them:

```sh
npm run validate   # check the batches against the format
npm run build      # regenerate data/recipes.js
npm test           # layout tests
```

`data/recipes.js` is generated, so edit the batches rather than that file.
