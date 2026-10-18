// Turning ordinary recipes into sheets.
//
// The AI route (the rule-based route is js/quick-convert.js); both end in a
// recipe tree the editor can open.
// - buildRequest / parseReply / flatToTree: Claude reads the
//   recipe (fetching the URL itself when given one) and returns a flat list
//   of ingredients and steps; flatToTree assembles and repairs the tree.
(function (root) {
  "use strict";

  const CATEGORIES = ["Breakfast", "Baking & Desserts", "Soups & Stews", "Salads & Sides", "Main Dishes"];
  const MODEL = "claude-opus-5-5";

  // ---------- Shared helpers ----------

  function clean(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function isStep(node) {
    return node !== null && typeof node === "object";
  }

  function countLeaves(node) {
    return isStep(node) ? node.in.reduce((n, c) => n + countLeaves(c), 0) : 1;
  }

  // ---------- AI route: request, reply, assembly ----------

  // Recursive schemas aren't supported by structured outputs, so the model
  // returns a flat graph (steps refer to ingredient and step ids) and the
  // tree is assembled here.
  const SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["status", "problem", "title", "category", "servings", "prep", "notes", "source_name", "source_url", "ingredients", "steps", "final_step"],
    properties: {
      status: { type: "string", enum: ["ok", "not_a_recipe", "fetch_failed"] },
      problem: { type: "string", description: "Empty when status is ok; otherwise one sentence for the cook explaining what went wrong." },
      title: { type: "string" },
      category: { type: "string", enum: CATEGORIES },
      servings: { type: "string", description: "Yield as free text, e.g. 'about 10 servings' or '24 cookies'. Empty if unknown." },
      prep: { type: "array", items: { type: "string" }, description: "Setup done before any ingredient work: preheat, grease a pan, boil water." },
      notes: { type: "array", items: { type: "string" }, description: "Short serving or storage tips worth keeping. Usually 0-3." },
      source_name: { type: "string", description: "Site or author name, empty for pasted text without one." },
      source_url: { type: "string", description: "The recipe URL, empty for pasted text." },
      ingredients: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "text"],
          properties: { id: { type: "string", description: "i1, i2, ..." }, text: { type: "string" } },
        },
      },
      steps: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "action", "inputs"],
          properties: {
            id: { type: "string", description: "s1, s2, ..." },
            action: { type: "string", description: "A short table cell: 1-5 words plus any time or temperature." },
            inputs: { type: "array", items: { type: "string" }, description: "Ids of the ingredients and earlier steps this step combines." },
          },
        },
      },
      final_step: { type: "string", description: "Id of the last step: the finished dish." },
    },
  };

  const SYSTEM = `You convert recipes into a tabular recipe sheet.

The sheet is a table: ingredients run down the left column; each step is a cell to the right that spans exactly the ingredients or earlier results it combines; later steps sit further right; the last column is the finished dish. Structurally it is a tree. Ingredients are leaves, every step combines one or more inputs, and everything ends in one final step.

Return the recipe as JSON matching the schema:
- ingredients: every ingredient once, in the order the cook uses them. Write each as amount first, metric in parentheses, then the item: "1-1/3 cups (167 g) all-purpose flour", "6 Tbs. (90 mL) butter", "2 large eggs", "salt and pepper to taste". Convert to metric yourself when the source gives only one system.
- steps: each has an id, a short action, and the ids it combines. Every ingredient id and every step id except final_step must be an input to exactly one step. If an ingredient is used in two places, split it into two ingredients with the quantity divided ("2 Tbs. (28 g) butter, for the roux").
- An ingredient that needs its own prep gets a one-input step ("dice", "melt", "lightly beat"). An ingredient used as it is goes straight into the step that uses it.
- Model real parallel work: wet and dry mixtures, a sauce made while pasta boils, a topping. Join them where the recipe joins them.
- Sequential steps on one thing are a chain of one-input steps: bake, then cool, then slice.
- Actions are short table cells, usually 1-5 words, with times and temperatures: "whisk", "sauté 5 min.", "simmer covered 30 min.", "bake 350°F (175°C) 55 min.". Never write sentences.
- prep holds setup with no ingredients: preheating, greasing or lining pans, bringing water to a boil.
- Keep the recipe faithful to the source. Don't add ingredients or steps it doesn't have.

When given a URL, fetch it with web_fetch and work from the recipe on that page. If the page can't be fetched, set status to "fetch_failed"; if it holds no recipe, set status to "not_a_recipe". In both cases explain in problem and leave the other fields empty.`;

  // A worked example from the cookbook, in the reply format, so the model
  // sees the target granularity.
  const EXAMPLE = {
    status: "ok", problem: "", title: "Banana Nut Bread", category: "Baking & Desserts", servings: "about 10 servings",
    prep: ["Butter and flour a loaf pan", "Preheat oven to 350°F (175°C)"], notes: [], source_name: "", source_url: "",
    ingredients: [
      { id: "i1", text: "2 large (250 g) ripe bananas" }, { id: "i2", text: "6 Tbs. (90 mL) butter" },
      { id: "i3", text: "1 tsp. (5 mL) vanilla extract" }, { id: "i4", text: "2 large eggs" },
      { id: "i5", text: "1-1/3 cups (167 g) all-purpose flour" }, { id: "i6", text: "2/3 cup (130 g) sugar" },
      { id: "i7", text: "1/2 tsp. (2.3 g) baking soda" }, { id: "i8", text: "1/4 tsp. (1.2 g) baking powder" },
      { id: "i9", text: "1/2 tsp. (3 g) salt" }, { id: "i10", text: "1/2 cup (70 g) chopped walnuts" },
    ],
    steps: [
      { id: "s1", action: "mash", inputs: ["i1"] }, { id: "s2", action: "melt", inputs: ["i2"] },
      { id: "s3", action: "lightly beat", inputs: ["i4"] }, { id: "s4", action: "mash until smooth", inputs: ["s1", "s2", "i3", "s3"] },
      { id: "s5", action: "whisk", inputs: ["i5", "i6", "i7", "i8", "i9"] }, { id: "s6", action: "fold", inputs: ["s4", "s5", "i10"] },
      { id: "s7", action: "bake 350°F (175°C) 55 min.", inputs: ["s6"] }, { id: "s8", action: "cool 10 min. in pan", inputs: ["s7"] },
      { id: "s9", action: "cool on wire rack", inputs: ["s8"] },
    ],
    final_step: "s9",
  };

  function isUrl(input) {
    return /^https?:\/\/\S+$/i.test(clean(input));
  }

  // Parameters for client.beta.messages.stream(). The beta is only for
  // fallbacks: "default", which re-runs a declined request on Anthropic's
  // recommended fallback model instead of returning a refusal.
  function buildRequest(input) {
    const url = isUrl(input);
    const body = url
      ? `Convert the recipe at this URL into a recipe sheet: ${clean(input)}`
      : `Convert this recipe into a recipe sheet.\n\n<recipe>\n${String(input).trim()}\n</recipe>`;
    const params = {
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM + "\n\nExample of a finished reply for a banana bread recipe:\n" + JSON.stringify(EXAMPLE),
      messages: [{ role: "user", content: body }],
    };
    if (url) params.tools = [{ type: "web_fetch_20260209", name: "web_fetch", max_uses: 3 }];
    return params;
  }

  // Pull the JSON reply out of a final message, or throw a message for the cook.
  function parseReply(message) {
    if (message.stop_reason === "refusal") throw new Error("Claude declined to convert this recipe. Try pasting the recipe text instead.");
    if (message.stop_reason === "max_tokens") throw new Error("The recipe was too long to convert in one go. Try pasting just the ingredients and steps.");
    const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    let flat;
    try {
      flat = JSON.parse(text);
    } catch (e) {
      throw new Error("Claude's reply wasn't in the expected format. Try again.");
    }
    if (flat.status === "fetch_failed") throw new Error(flat.problem || "That page couldn't be fetched. Paste the recipe text instead.");
    if (flat.status === "not_a_recipe") throw new Error(flat.problem || "That doesn't look like a recipe.");
    return flat;
  }

  // Build a recipe from the flat reply. Repairs instead of failing where it
  // can, and lists every repair so the cook can check those spots.
  function flatToTree(flat) {
    const fixes = [];
    const ingredients = new Map();
    const steps = new Map();
    for (const i of flat.ingredients || []) if (clean(i.text) && !ingredients.has(i.id)) ingredients.set(i.id, clean(i.text));
    for (const s of flat.steps || []) if (clean(s.action) && !steps.has(s.id)) steps.set(s.id, s);
    if (!ingredients.size) throw new Error("No ingredients were found.");

    const used = new Set();
    let dropped = 0;
    function build(id, path) {
      if (steps.has(id)) {
        if (path.has(id)) return null;
        path.add(id);
        const inputs = [];
        for (const ref of steps.get(id).inputs || []) {
          if (used.has(ref) || (!steps.has(ref) && !ingredients.has(ref))) {
            dropped++;
            continue;
          }
          used.add(ref);
          const child = build(ref, path);
          if (child) inputs.push(child);
        }
        path.delete(id);
        return inputs.length ? { do: clean(steps.get(id).action), in: inputs } : null;
      }
      return ingredients.get(id) || null;
    }

    let finalId = flat.final_step;
    if (!steps.has(finalId)) {
      // Fall back to the step nobody uses as an input, last one first.
      const referenced = new Set([...steps.values()].flatMap((s) => s.inputs || []));
      finalId = [...steps.keys()].reverse().find((id) => !referenced.has(id));
    }
    used.add(finalId);
    let tree = finalId ? build(finalId, new Set()) : null;
    if (dropped) fixes.push("Some step inputs repeated or pointed nowhere; they were left out.");

    // Anything never joined in goes into the final step, so nothing is lost.
    const leftovers = [];
    for (const id of steps.keys()) {
      if (used.has(id)) continue;
      const referenced = [...steps.values()].some((s) => (s.inputs || []).includes(id));
      if (referenced) continue;
      used.add(id);
      const node = build(id, new Set());
      if (node) leftovers.push(node);
    }
    for (const id of ingredients.keys()) if (!used.has(id)) leftovers.push(ingredients.get(id));
    if (leftovers.length) {
      const n = leftovers.reduce((sum, node) => sum + countLeaves(node), 0);
      fixes.push(`${n} ingredient${n === 1 ? " wasn't" : "s weren't"} joined in by any step, so ${n === 1 ? "it was" : "they were"} added to the last step. Move ${n === 1 ? "it" : "them"} to where ${n === 1 ? "it belongs" : "they belong"}.`);
      tree = tree ? { do: tree.do, in: tree.in.concat(leftovers) } : { do: "combine", in: leftovers };
    }
    if (!isStep(tree)) tree = { do: "combine", in: [tree] };

    const recipe = {
      title: clean(flat.title) || "Imported recipe",
      category: CATEGORIES.includes(flat.category) ? flat.category : "Main Dishes",
      servings: clean(flat.servings),
      prep: (flat.prep || []).map(clean).filter(Boolean),
      notes: (flat.notes || []).map(clean).filter(Boolean),
      tree,
    };
    if (/^https?:\/\//.test(flat.source_url || "")) recipe.source = { name: clean(flat.source_name) || new URL(flat.source_url).hostname, url: flat.source_url };
    return { recipe, fixes };
  }

  const api = { CATEGORIES, MODEL, SCHEMA, isUrl, buildRequest, parseReply, flatToTree };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RecipeImportCore = api;
})(typeof window !== "undefined" ? window : globalThis);
