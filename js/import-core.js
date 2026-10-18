// Turning ordinary recipes into sheets.
//
// Two routes, both ending in a recipe tree the editor can open:
// - quickConvert(text): no AI. Reads the ingredient list and the numbered
//   steps from pasted text and joins each ingredient in at the first step
//   that mentions it. The result is a mostly linear sheet that is easy to
//   tidy up in the editor.
// - buildRequest / parseReply / flatToTree: the AI route. Claude reads the
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

  // ---------- Quick route: rule-based, no AI ----------

  const STOP = new Set(
    ("a an and or of to the for with into in on at about plus more extra divided optional taste tasting " +
      "cup cups tbs tbsp tablespoon tablespoons tsp teaspoon teaspoons lb lbs pound pounds oz ounce ounces g kg ml l " +
      "pinch dash can cans clove cloves stick sticks slice slices package packages jar sprig sprigs bunch head heads " +
      "large small medium whole fresh freshly chopped minced diced sliced grated shredded ground crushed packed " +
      "softened melted room temperature finely roughly thinly coarsely cold warm hot unsalted salted light dark " +
      "baking extract purpose all kosher sea black white granulated powdered red green yellow sweet dried ripe " +
      "boneless skinless low sodium plain lean pure virgin each piece pieces inch thick cut cubed peeled seeded").split(" ")
  );

  // Words that identify an ingredient in the method text: "2 cups (250 g)
  // all-purpose flour, sifted" -> ["flour"].
  function keywords(text) {
    const name = text
      .toLowerCase()
      .replace(/\([^)]*\)/g, " ")
      .split(/,|\bfor\b/)[0]
      .replace(/[^a-z\s-]/g, " ");
    const words = name.split(/[\s-]+/).filter((w) => w.length >= 3 && !STOP.has(w));
    return [...new Set(words.flatMap((w) => [w, w.replace(/(es|s)$/, "")]))].filter((w) => w.length >= 3);
  }

  // A step mentions an ingredient if it names one of its keywords, or a
  // shorter word the keyword ends with ("nuts" for "walnuts").
  function mentions(stepText, words) {
    const lower = stepText.toLowerCase();
    const stepWords = lower.match(/[a-z]{4,}/g) || [];
    return words.some((w) => new RegExp("\\b" + w.replace(/[^a-z]/g, "")).test(lower) || stepWords.some((s) => w.endsWith(s)));
  }

  const CATEGORY_HINTS = [
    ["Baking & Desserts", /\b(cookies?|cakes?|brownies?|pies?|tarts?|muffins?|breads?|loaf|cupcakes?|cheesecake|crisp|cobbler|pudding|bars|scones?|biscuits?|frosting|fudge|tiramisu)\b/i],
    ["Breakfast", /\b(pancakes?|waffles?|french toast|omelets?|omelettes?|scrambled|granola|oats|oatmeal|frittata|shakshuka|breakfast|eggs benedict|hash browns?)\b/i],
    ["Soups & Stews", /\b(soup|stew|chili|chowder|bisque|broth|gumbo|ramen|pho)\b/i],
    ["Salads & Sides", /\b(salad|slaw|coleslaw|side|dip|salsa|guacamole|hummus|roasted vegetables|mashed|fries)\b/i],
  ];
  function guessCategory(title) {
    const hit = CATEGORY_HINTS.find(([, re]) => re.test(title));
    return hit ? hit[0] : "Main Dishes";
  }

  const PREP_RE = /^(preheat|heat the oven|grease|line|lightly grease|butter and flour|spray|position a rack|set a rack|bring a (large )?pot)/i;
  const PARTICLES = new Set(["in", "together", "up", "out", "off", "down", "through", "over", "back"]);

  function shortTime(s) {
    return s
      .replace(/\bminutes?\b|\bmins?\b/i, "min.")
      .replace(/\bhours?\b|\bhrs?\b/i, "hr.")
      .replace(/\bseconds?\b|\bsecs?\b/i, "sec.");
  }

  // "Whisk together the flour, baking soda and salt in a bowl." -> "whisk together"
  // "Bake for 55 to 60 minutes, until a skewer comes out clean." -> "bake 55 to 60 min."
  function shortAction(sentence) {
    let s = clean(sentence).replace(/^(step\s*)?\d+[.):]\s*/i, "");
    // Lead-in clauses ("In a large bowl, ...", "Once melted, ...") are context, not the action.
    s = s.replace(/^(in|using|with|once|when|after|while|meanwhile|then|next|finally|to make[^,]*)\b[^,]*,\s*/i, "");
    let words = s.replace(/[.;:!]+$/, "").split(" ");
    // "Gradually beat in..." -> "beat in..."
    while (words.length > 1 && /^[A-Za-z]+ly,?$/.test(words[0]) && !/^(apply|fly|supply)$/i.test(words[0])) words = words.slice(1);
    const action = [words[0]];
    for (let i = 1; i < words.length && action.length < 3; i++) {
      const w = words[i].toLowerCase().replace(/[^a-z]/g, "");
      if (!PARTICLES.has(w)) break;
      action.push(words[i].replace(/[,.;]$/, ""));
    }
    const until = s.match(/\buntil ([^,.;]+)/i);
    if (until && until[1].split(" ").length <= 4) action.push("until", until[1]);
    const temp = s.match(/\d{3}\s*°\s*F(\s*\(\s*\d{2,3}\s*°\s*C\s*\))?/i);
    if (temp) action.push(temp[0].replace(/\s*°\s*/g, "°").replace(/\s*\(\s*/, " (").replace(/\s*\)/, ")"));
    const time = s.match(/\b\d+(\s*(-|–|to)\s*\d+)?\s*(minutes?|mins?|hours?|hrs?|seconds?|secs?)\b/i);
    if (time) action.push(shortTime(time[0]));
    const text = action.join(" ").replace(/[,;]/g, "");
    return (text.charAt(0).toLowerCase() + text.slice(1)).slice(0, 60);
  }

  const HEADER = {
    ingredients: /^(ingredients?)\b\s*:?\s*$/i,
    steps: /^(instructions?|directions?|method|steps|preparation|how to make( it)?)\b\s*:?\s*$/i,
    end: /^(notes?|tips?|nutrition( facts| information)?|storage|recipe notes|equipment)\b\s*:?\s*$/i,
  };
  const BULLET = /^([-–•*▢☐□✓]|\d+[.)]|step\s*\d+[.:)]?)\s*/i;
  const LOOKS_LIKE_INGREDIENT = /^([-–•*▢☐□]\s*)?([\d½⅓⅔¼¾⅛⅜⅝⅞]|a (pinch|handful|dash)|salt|pepper|kosher salt)/i;

  function quickConvert(text) {
    const fixes = [];
    const lines = String(text || "").split(/\r?\n/).map(clean).filter(Boolean);
    let title = "";
    let servings = "";
    const ingredients = [];
    const steps = [];
    let section = null;

    for (const line of lines) {
      if (HEADER.ingredients.test(line)) { section = "ingredients"; continue; }
      if (HEADER.steps.test(line)) { section = "steps"; continue; }
      if (HEADER.end.test(line)) { section = "end"; continue; }
      const yieldMatch = line.match(/^(serves|servings|yield|makes)\b\s*:?\s*(.+)$/i);
      if (yieldMatch) { servings = yieldMatch[2]; continue; }
      if (section === "end") continue;
      if (section === "ingredients") {
        if (/:$/.test(line) && !/\d/.test(line)) continue; // sub-heading like "For the sauce:"
        ingredients.push(line.replace(BULLET, ""));
      } else if (section === "steps") {
        if (/:$/.test(line) && line.split(" ").length <= 4) continue;
        steps.push(line.replace(BULLET, ""));
      } else if (LOOKS_LIKE_INGREDIENT.test(line) && line.length < 100) {
        ingredients.push(line.replace(/^[-–•*▢☐□]\s*/, ""));
      } else if (!title && !ingredients.length && line.length <= 80) {
        title = line;
      } else if (line.length >= 20) {
        steps.push(line.replace(BULLET, ""));
      }
    }
    if (ingredients.length < 2) throw new Error("Couldn't find an ingredient list. Paste the ingredients one per line, under a line that says Ingredients.");
    if (!steps.length) throw new Error("Couldn't find the method. Paste the steps under a line that says Instructions.");

    // A step paragraph often holds several actions; split on sentences.
    const sentences = steps.flatMap((p) => p.split(/(?<=[.!?])\s+(?=[A-Z])/)).filter((s) => s.length > 2);
    // Open branches are separate bowls or pans in progress. A step that
    // starts a new vessel with new ingredients opens a branch; a step that
    // mentions "the mixture" or the dry/wet ingredients joins them all.
    const prep = [];
    const words = ingredients.map(keywords);
    const joined = new Set();
    const open = [];
    const NEW_VESSEL = /\b(a|another|separate|second|large|medium|small)\b[^.]*\b(bowl|saucepan|skillet|pot|pan|jug|measuring cup)\b/i;
    const JOIN = /\b(mixture|dry ingredients|wet ingredients|combine (the )?two|together|serve)\b/i;
    for (const sentence of sentences) {
      const fresh = [];
      ingredients.forEach((ing, i) => {
        if (!joined.has(i) && words[i].length && mentions(sentence, words[i])) fresh.push(i);
      });
      if (!fresh.length && (!open.length || PREP_RE.test(sentence))) {
        if (PREP_RE.test(sentence)) prep.push(sentence.replace(/[.]$/, ""));
        continue;
      }
      fresh.forEach((i) => joined.add(i));
      const items = fresh.map((i) => ingredients[i]);
      const action = shortAction(sentence);
      if (open.length > 1 && JOIN.test(sentence)) {
        open.splice(0, open.length, { do: action, in: open.slice().concat(items) });
      } else if (!open.length || (items.length && NEW_VESSEL.test(sentence) && !JOIN.test(sentence))) {
        open.push({ do: action, in: items });
      } else {
        const last = open.pop();
        open.push({ do: action, in: [last].concat(items) });
      }
    }
    let current = open.length > 1 ? { do: "combine", in: open } : open[0] || null;
    if (open.length > 1) fixes.push("Some mixtures were never joined in the method, so a final “combine” step brings them together. Rename it to what the recipe does.");
    const unmatched = ingredients.filter((_, i) => !joined.has(i));
    if (unmatched.length) {
      fixes.push(`${unmatched.length} ingredient${unmatched.length === 1 ? " isn't" : "s aren't"} mentioned in the method, so ${unmatched.length === 1 ? "it was" : "they were"} added to the last step. Move ${unmatched.length === 1 ? "it" : "them"} to where ${unmatched.length === 1 ? "it belongs" : "they belong"}.`);
      current = current ? { do: current.do, in: current.in.concat(unmatched) } : { do: "combine", in: unmatched };
    }
    fixes.push("Quick import joins each ingredient in at the first step that mentions it, so the sheet comes out mostly in a line. Group things that happen in separate bowls by ungrouping steps in the live sheet and combining them again.");

    return {
      recipe: { title: title || "Imported recipe", category: guessCategory(title), servings, prep, notes: [], tree: current },
      fixes,
    };
  }

  const api = { CATEGORIES, MODEL, SCHEMA, isUrl, buildRequest, parseReply, flatToTree, quickConvert, shortAction, keywords };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RecipeImportCore = api;
})(typeof window !== "undefined" ? window : globalThis);
