// Quick convert: turn a pasted recipe into a sheet with rules, no AI.
//
// 1. Clean the paste: drop blog clutter (ratings, "Print", times, nutrition),
//    find the title, yield, ingredient list, method and notes.
// 2. Normalise each ingredient to house style ("1 tsp. (5 mL) vanilla
//    extract"), adding metric, and pull prep out of it ("1 onion, diced"
//    becomes a dice cell).
// 3. Walk the method clause by clause. Each clause gets an action from a
//    cooking-verb vocabulary and the ingredients it names. Separate pans and
//    bowls become separate branches; a clause that names something from
//    another branch ("return the chicken", "the flour mixture") joins them.
(function (root) {
  "use strict";

  // ---------- Text helpers ----------

  function clean(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  // Lower-case word tokens with simple plural folding, so "tomatoes" and
  // "tomato" compare equal.
  function singular(word) {
    if (word.length <= 3 || /(ss|us|is)$/.test(word)) return word;
    if (/(oes|ches|shes|xes)$/.test(word)) return word.slice(0, -2);
    if (/ies$/.test(word)) return word.slice(0, -3) + "y";
    if (/ves$/.test(word) && !/(cloves|olives|chives)$/.test(word)) return word.slice(0, -3) + "f";
    return word.endsWith("s") ? word.slice(0, -1) : word;
  }
  function tokens(text) {
    return (text.toLowerCase().match(/[a-z]+(?:-[a-z]+)*/g) || []).map(singular);
  }

  // ---------- Ingredients ----------

  const UNIT_WORDS = [
    [/\b(teaspoons?|tsps?\.?)(?=\s|$)/gi, "tsp."],
    [/\b(tablespoons?|tbsps?\.?|tbs\.?|Tbs\.?)(?=\s|$)/gi, "Tbs."],
    [/\b(ounces?|oz\.?)(?=[\s)/,]|$)/gi, "oz."],
    [/\b(pounds?|lbs?\.?)(?=[\s)/,]|$)/gi, "lb."],
    [/\b(grams?|gr)(?=[\s)/,]|$)/gi, "g"],
    [/\b(kilograms?|kgs?)(?=[\s)/,]|$)/gi, "kg"],
    [/\b(milliliters?|millilitres?|mls?)(?=[\s)/,]|$)/gi, "mL"],
  ];
  const UNICODE_FRACTIONS = { "½": "1/2", "⅓": "1/3", "⅔": "2/3", "¼": "1/4", "¾": "3/4", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8" };

  // Grams per US cup for common dry or solid ingredients; anything else
  // measured by volume converts to millilitres.
  const GRAMS_PER_CUP = [
    [/whole wheat flour/, 120], [/flour/, 125], [/brown sugar/, 213], [/(powdered|confectioners'?|icing) sugar/, 120],
    [/sugar/, 200], [/butter(?!milk)/, 227], [/oat/, 90], [/rice/, 185], [/cocoa/, 85], [/chocolate chip|chips/, 170],
    [/walnut|pecan/, 120], [/almond/, 140], [/peanut butter/, 258], [/parmesan|cheese/, 100], [/honey/, 340],
    [/maple syrup/, 320], [/breadcrumb|panko/, 110], [/cornmeal/, 150], [/raisin/, 145], [/berr/, 150], [/cornstarch/, 128],
  ];
  const ML = { "tsp.": 5, "Tbs.": 15, cup: 240 };

  function parseAmount(text) {
    // "2-1/4", "2 1/4", "1/2", "1.5", "3"
    const m = text.match(/^(\d+)(?:[ -](\d+)\/(\d+))?(?:\/(\d+))?(?:\.(\d+))?/);
    if (!m) return null;
    if (m[2]) return +m[1] + +m[2] / +m[3];
    if (m[4]) return +m[1] / +m[4];
    if (m[5]) return parseFloat(m[1] + "." + m[5]);
    return +m[1];
  }

  function roundMetric(value) {
    if (value < 10) return String(Math.round(value * 10) / 10);
    if (value < 100) return String(Math.round(value));
    return String(Math.round(value / 5) * 5);
  }

  function metricFor(amount, unit, name) {
    const lower = name.toLowerCase();
    if (unit === "oz.") return roundMetric(amount * 28.35) + " g";
    if (unit === "lb.") return roundMetric(amount * 453.6) + " g";
    if (unit === "Tbs." && /butter(?!milk)/.test(lower)) return roundMetric(amount * 14.2) + " g";
    if (unit === "cup") {
      const density = GRAMS_PER_CUP.find(([re]) => re.test(lower));
      if (density) return roundMetric(amount * density[1]) + " g";
    }
    if (ML[unit]) return roundMetric(amount * ML[unit]) + " mL";
    return "";
  }

  // Past participles in ingredient lines and the step they stand for.
  const PREP_WORDS = {
    diced: "dice", chopped: "chop", minced: "mince", sliced: "slice", grated: "grate", shredded: "shred",
    melted: "melt", softened: "soften", beaten: "beat", "lightly beaten": "lightly beat", crushed: "crush",
    cubed: "cube", peeled: "peel", drained: "drain", rinsed: "rinse", toasted: "toast", sifted: "sift",
    halved: "halve", quartered: "quarter", trimmed: "trim", seeded: "seed", zested: "zest", juiced: "juice",
    thawed: "thaw", mashed: "mash", julienned: "julienne", torn: "tear", cooked: "cook", pitted: "pit",
    deveined: "devein", whisked: "whisk", "patted dry": "pat dry", scrubbed: "scrub", hulled: "hull", stemmed: "stem",
    shelled: "shell", "cut into wedges": "cut into wedges", "cut into pieces": "cut into pieces",
  };
  const KEEP_TAIL = /^(divided|optional|to taste|for (serving|garnish|topping|dusting|brushing|the .+)|plus more.*|or more.*|at room temperature|room temperature|packed|loosely packed|about .*)$/i;

  // "1 medium onion, finely chopped" -> { text: "1 medium onion", prep: "finely chop" }
  function splitPrep(text) {
    let prep = "";
    const comma = text.indexOf(",");
    if (comma > 0) {
      const tail = clean(text.slice(comma + 1)).replace(/\.$/, "");
      const parts = tail.split(/\s*(?:,|\band\b)\s*/).filter(Boolean);
      const verbs = [];
      let ok = parts.length > 0;
      for (const part of parts) {
        const m = part.match(/^(finely |roughly |coarsely |thinly |lightly |freshly )?([a-z ]+?)( crosswise| lengthwise| widthwise| diagonally| on the bias)?$/i);
        const word = m && PREP_WORDS[m[2].toLowerCase()];
        if (word) verbs.push((m[1] || "") + word + (m[3] || ""));
        else if (!KEEP_TAIL.test(part)) ok = false;
      }
      if (ok && verbs.length) {
        prep = verbs.join(" and ").toLowerCase();
        const kept = parts.filter((p) => KEEP_TAIL.test(p));
        text = clean(text.slice(0, comma)) + (kept.length ? ", " + kept.join(", ") : "");
      }
    }
    // Leading participles that are really steps: "1/3 cup melted butter".
    const lead = text.match(/^(.*?\b)(melted|softened|beaten|lightly beaten|sifted) (.+)$/i);
    if (!prep && lead && /\d/.test(lead[1])) {
      prep = PREP_WORDS[lead[2].toLowerCase()];
      text = clean(lead[1] + lead[3]);
    }
    return { text, prep };
  }

  // House style: units abbreviated, mixed numbers hyphenated, metric added.
  function normalizeIngredient(raw) {
    let text = clean(raw).replace(/[½⅓⅔¼¾⅛⅜⅝⅞]/g, (f) => " " + UNICODE_FRACTIONS[f]).replace(/(\d)\s+(\d\/\d)/, "$1-$2");
    text = clean(text);
    for (const [re, abbr] of UNIT_WORDS) text = text.replace(re, abbr);
    text = text.replace(/\bcups\b/i, "cups").replace(/\bcup\b/i, "cup");
    const { text: base, prep } = splitPrep(text);
    text = base;

    const hasMetric = /\(\s*[^)]*\d\s*(g|kg|mL|L)\b[^)]*\)/.test(text);
    const m = text.match(/^([\d\s/.-]+?)\s*(tsp\.|Tbs\.|cups?|oz\.|lb\.)\s*(\([^)]*\))?\s*(.*)$/);
    if (m && !hasMetric && !/\bto\b|–/.test(m[1])) {
      const amount = parseAmount(m[1].trim());
      const unit = /^cup/.test(m[2]) ? "cup" : m[2];
      const metric = amount ? metricFor(amount, unit, m[4]) : "";
      if (metric) {
        const paren = m[3] ? m[3].slice(1, -1) + ", " + metric : metric;
        text = `${m[1].trim()} ${m[2]} (${paren}) ${m[4]}`;
      }
    }
    return { text: clean(text), prep };
  }

  // Words that never identify an ingredient on their own.
  const DROP = new Set(
    ("a an and or of to the for with into in on at about plus more extra divided optional taste tasting " +
      "tsp tbs tb cup oz lb g kg ml l fl pinch dash can jar package pkg stick sprig bunch head handful " +
      "large small medium whole fresh freshly chopped minced diced sliced grated shredded crushed packed " +
      "softened melted room temperature finely roughly thinly coarsely cold warm hot unsalted salted " +
      "boneless skinless low sodium reduced fat plain lean pure virgin each piece inch thick cut cubed peeled " +
      "seeded ripe dried canned frozen thawed toasted organic good quality store bought homemade baby").split(" ").map(singular)
  );
  // Modifiers that only count as part of a phrase ("brown sugar"), never alone ("brown the beef").
  const WEAK = new Set("brown white black red green yellow sweet sea kosher table baking all-purpose granulated powdered ground light dark extra".split(" ").map(singular));
  // Heads naming a form or cut; the word before them is what cooks call it.
  const FORM = new Set("breast thigh drumstick wing fillet floret leaf clove sprig stalk wedge slice piece chunk cube strip steak chop rib".split(" "));
  // Heads too generic to name the ingredient alone; the modifier can.
  const GENERIC = new Set("cheese sauce powder seed juice extract sugar flour broth stock milk cream vinegar bean paste flake oil syrup chip pepper".split(" ").map(singular));

  // How a method step can refer to an ingredient: its full phrase, the word
  // cooks use for it, and (for generic heads) its distinguishing modifier.
  function ingredientKeys(text) {
    const name = text
      .replace(/\([^)]*\)/g, " ")
      .replace(/^[\d\s/.,-]+/, " ")
      .split(/,|\bfor\b|\bor\b/)[0];
    const words = tokens(name).filter((w) => !DROP.has(w));
    if (!words.length) return { phrase: [], phrases: [], ids: [], mods: [] };
    // "salt and pepper": each part names it.
    const parts = name.split(/\band\b|&/).map((p) => tokens(p).filter((w) => !DROP.has(w))).filter((p) => p.length);
    const ids = [];
    const mods = [];
    for (const part of parts) {
      const head = part[part.length - 1];
      ids.push(head);
      if (FORM.has(head) && part.length > 1) ids.unshift(part[part.length - 2]);
      if (GENERIC.has(head)) mods.push(...part.slice(0, -1).filter((w) => !WEAK.has(w)));
    }
    // Ways a step might write the name: in full, from any later word
    // ("olive oil" for "extra-virgin olive oil"), or without weak words.
    const forms = [words, words.filter((w) => !WEAK.has(w))];
    for (let k = 1; k < words.length - 1; k++) forms.push(words.slice(k));
    const seen = new Set();
    const phrases = forms
      .filter((f) => f.length > 1 && !seen.has(f.join(" ")) && seen.add(f.join(" ")))
      .sort((a, b) => b.length - a.length);
    return { phrase: words, phrases, ids, mods };
  }

  // ---------- Method ----------

  // Cooking verbs, best first; generic ones only win when nothing better is there.
  const VERBS = (
    "bake roast broil grill sear brown fry stir-fry deep-fry saute sauté simmer boil poach steam braise blanch caramelize " +
    "toast scramble melt reduce thicken cook microwave blend puree purée process whisk beat cream whip fold knead mash " +
    "chill freeze refrigerate marinate rest proof rise cool rub coat brush baste dredge dip stuff fill pipe skewer thread wrap tie truss shake squeeze pat score carve garnish drizzle sprinkle season toss dress top spread layer " +
    "roll shape form flatten cut slice dice chop mince grate shred julienne peel drain rinse strain sift dissolve steep " +
    "wilt flip turn serve mix combine stir add pour transfer place put return bring heat warm arrange divide spoon scoop drop"
  ).split(" ");
  const GENERIC_VERBS = new Set("mix combine stir add pour transfer place put return bring heat warm arrange divide spoon scoop drop turn".split(" "));
  const VERB_RANK = new Map(VERBS.map((v, i) => [v, (GENERIC_VERBS.has(v) ? 1000 : 0) + i]));
  const PARTICLES = new Set(["in", "together", "up", "through"]);
  const PARTICLE_VERBS = new Set(["stir", "mix", "beat", "whisk", "fold", "toss", "add", "combine", "blend", "cream", "whip", "turn"]);
  const PLACE_VERBS = new Set(["serve", "pour", "spread", "spoon", "scoop", "transfer", "drop", "divide", "arrange", "drizzle", "sprinkle", "cool", "rest", "chill"]);
  const PLACE_SKIP = /^(ungreased|greased|prepared|lined|parchment-lined|baking|your|the|a|an|some|large|small|medium)$/;

  function shortTime(s) {
    return s.replace(/\bminutes?\b|\bmins?\b/i, "min.").replace(/\bhours?\b|\bhrs?\b/i, "hr.").replace(/\bseconds?\b|\bsecs?\b/i, "sec.");
  }

  // The action cell for one clause: verb, a short "until ...", where it goes
  // for serving or pouring, temperature and time.
  function actionFor(clause, names) {
    let lower = clause.toLowerCase();
    // Blank out ingredient names so "brown sugar" or "butter" aren't read as verbs.
    for (const name of names || []) {
      const re = new RegExp("\\b" + name.map((w) => w.replace(/[^a-z-]/g, "") + "(?:e?s)?").join("\\s+") + "\\b", "g");
      lower = lower.replace(re, (m) => " ".repeat(m.length));
    }
    const words = lower.replace(/[^a-z\s-]/g, " ").split(/\s+/).filter(Boolean);
    let best = null;
    words.forEach((w, i) => {
      const verb = w === "saute" ? "sauté" : w;
      if (!VERB_RANK.has(verb)) return;
      // "toss to coat", "stir to combine": the verb after "to" is the purpose, not the action.
      if (words[i - 1] === "to") return;
      if (verb === "reduce" && words[i + 1] === "the" && words[i + 2] === "heat") return;
      if (verb === "turn" && words[i + 1] !== "out") return;
      if (!best || VERB_RANK.get(verb) < VERB_RANK.get(best.verb)) best = { verb, i };
    });
    if (!best) return null;
    const out = [best.verb];
    const after = words.slice(best.i + 1);
    if (best.verb === "bring" && /to a (rolling )?boil/.test(lower)) out.push("to a boil");
    else if (best.verb === "bring" && /to a simmer/.test(lower)) out[0] = "simmer";
    else if (after[0] && PARTICLES.has(after[0]) && PARTICLE_VERBS.has(best.verb)) out.push(after[0]);
    else if (after[0] && /ly$/.test(after[0]) && after[0] !== "only") out.push(after[0]);
    if (PLACE_VERBS.has(best.verb)) {
      // "onto ungreased baking sheets" -> "onto sheets"; "over rice"; "in the pan"
      const preps = best.verb === "cool" || best.verb === "rest" || best.verb === "chill" ? "in|on" : "over|onto|into|on|with";
      const where = clause.slice(clause.toLowerCase().indexOf(best.verb)).match(new RegExp("\\b(" + preps + ")\\s+((?:[a-z-]+\\s+){0,3}?)([a-z]+)(?=\\s+(?:and|or|until|for|then|to|about|over|with)\\b|[,.;]|$)", "i"));
      if (where) {
        const nouns = (where[2] + where[3]).toLowerCase().split(/\s+/).filter((w) => w && !PLACE_SKIP.test(w));
        if (nouns.length && nouns.length <= 2) out.push(where[1].toLowerCase(), nouns.join(" "));
      }
    }
    const until = clause.match(/\buntil\s+(?:the\s+)?([^,.;]+)/i);
    if (until) {
      const u = until[1].trim().split(/\s+/);
      if (u.length <= 5) out.push("until", u.join(" ").toLowerCase());
    }
    const temp = clause.match(/\d{3}\s*°\s*F(\s*\(\s*\d{2,3}\s*°\s*C\s*\))?/i);
    if (temp) out.push(temp[0].replace(/\s*°\s*/g, "°").replace(/\s*\(\s*/, " (").replace(/\s*\)/, ")"));
    const time = clause.match(/\b\d+(\s*(-|–|to)\s*\d+)?\s*(minutes?|mins?|hours?|hrs?|seconds?|secs?)\b/i);
    if (time) out.push(shortTime(time[0].toLowerCase()));
    return out.join(" ").replace(/\s+/g, " ").slice(0, 60);
  }

  const PREP_CLAUSE = /^(preheat|heat the oven|position a rack|set a rack|grease|lightly grease|line|spray|butter (a|the|an)\b|butter and flour|bring a (large |medium )?pot of (salted )?water)/i;
  const SKIP_CLAUSE = /^(set aside|reserve|enjoy|let (it )?stand|keep warm|cover and keep|discard|save)/i;
  const PARK = /\b(set aside|transfer (it |them )?to a (plate|bowl|board)|remove (it |them )?to a (plate|bowl|board)|remove from the (pan|skillet) and set aside)\b/i;
  const NEW_VESSEL = /\b(in|into) (a|another|a separate|a second|a clean) ([a-z-]+\s+){0,3}(bowl|saucepan|skillet|pot|pan|dutch oven|jug|measuring cup|food processor|blender|stand mixer)\b/i;
  const COMPONENT = /\b(mixture|batter|dough|dry ingredients|wet ingredients|sauce|dressing|filling|topping|glaze|marinade|syrup|crust|crumble)\b/i;
  const LEAD_IN = /^(meanwhile|then|next|finally|after that|once (it is|they are) [a-z ]+|when [^,]+|while [^,]+|in (a|the) [^,]+|using [^,]+|to make [^,]+|for the [^,]+)\s*,\s*/i;

  // Split the method into clauses: sentences, then "; " and ", then".
  function clausesOf(paragraphs) {
    return paragraphs
      .flatMap((p) => p.split(/(?<=[.!?])\s+(?=[A-Z0-9])/))
      .flatMap((s) => s.split(/;\s+|,\s*(?:and\s+)?then\s+|\.\s+then\s+/i))
      .map((s) => clean(s).replace(/^(and|then)\s+/i, "").replace(/[.!]+$/, ""))
      .filter((s) => s.length > 2);
  }

  // ---------- Reading the paste ----------

  const JUNK = new RegExp(
    "^(?:(?:jump to|print|pin it|pin|save|rate|share|email|prep time|cook time|total time|active time|inactive time|course|cuisine|keywords?|calories|author|servings? size|equipment|video|watch|did you make|tag us|leave a|nutrition|recipe card|scale|us customary|metric|cook mode|prevent your screen)\\b" +
      "|[★☆]|\\d(\\.\\d)? (out of|from|stars?)\\b|\\(?\\d[\\d,]* (reviews?|ratings?|votes?)\\b" +
      "|(prep|cook|total)\\s*:?\\s*\\d+\\s*(min|minutes|hours?|hrs?)\\b)",
    "i"
  );
  const HEADER = {
    ingredients: /^(ingredients?)\b\s*:?\s*$/i,
    steps: /^(instructions?|directions?|method|steps|preparation|how to make( it)?)\b\s*:?\s*$/i,
    notes: /^(notes?|tips?|recipe notes|cook'?s notes)\b\s*:?\s*$/i,
    end: /^(nutrition( facts| information)?|storage|equipment|video)\b\s*:?\s*$/i,
  };
  const BULLET = /^([-–•*▢☐□✓]|\d+[.)]|step\s*\d+[.:)]?)\s*/i;
  const LOOKS_LIKE_INGREDIENT = /^([-–•*▢☐□]\s*)?([\d½⅓⅔¼¾⅛⅜⅝⅞]|a (pinch|handful|dash|few)|pinch|salt|pepper|kosher salt|zest|juice of)/i;
  const YIELD = /^(serves|servings|yield|yields|makes)\b\s*:?\s*(.+)$/i;
  const YIELD_TRAILING = /^(\d+(\s*(-|to)\s*\d+)?)\s+(servings?|people|portions|slices|cookies|muffins|pieces)$/i;

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

  function read(text) {
    const lines = String(text || "").split(/\r?\n/).map(clean).filter(Boolean);
    const out = { title: "", servings: "", ingredients: [], groups: [], method: [], notes: [] };
    let section = null;
    let group = "";
    for (const line of lines) {
      if (HEADER.ingredients.test(line)) { section = "ingredients"; continue; }
      if (HEADER.steps.test(line)) { section = "steps"; continue; }
      if (HEADER.notes.test(line)) { section = "notes"; continue; }
      if (HEADER.end.test(line)) { section = "end"; continue; }
      if (JUNK.test(line) || /^https?:\/\//.test(line)) continue;
      const y = line.match(YIELD) || (!out.ingredients.length && line.match(YIELD_TRAILING));
      if (y) {
        const v = y[0].match(YIELD) ? y[2] : y[0];
        out.servings = /^\d+(\s*(-|to)\s*\d+)?$/.test(v) ? v + " servings" : v;
        continue;
      }
      if (section === "end") continue;
      if (section === "notes") {
        if (out.notes.length < 3 && line.length <= 160) out.notes.push(line.replace(BULLET, ""));
        continue;
      }
      if (section === "ingredients") {
        if (/:$/.test(line) && !/\d/.test(line)) { group = line.replace(/^for (the )?/i, "").replace(/:$/, "").toLowerCase(); continue; }
        out.ingredients.push(line.replace(/^[-–•*▢☐□✓]\s*/, ""));
        out.groups.push(group);
      } else if (section === "steps") {
        if (/:$/.test(line) && line.split(" ").length <= 5) continue;
        out.method.push(line.replace(BULLET, ""));
      } else if (/^(\d+[.)]|step\s*\d+)\s+[A-Z]/i.test(line) || (line.length > 70 && /[.!]$/.test(line))) {
        out.method.push(line.replace(BULLET, ""));
      } else if (LOOKS_LIKE_INGREDIENT.test(line) && line.length < 100) {
        out.ingredients.push(line.replace(/^[-–•*▢☐□]\s*/, ""));
        out.groups.push(group);
      } else if (!out.title && !out.ingredients.length && line.length <= 80) {
        out.title = line;
      } else if (line.length >= 20) {
        out.method.push(line.replace(BULLET, ""));
      }
    }
    return out;
  }

  // ---------- Building the sheet ----------

  function convert(text) {
    const page = read(text);
    if (page.ingredients.length < 2) throw new Error("Couldn't find an ingredient list. Paste the ingredients one per line, under a line that says Ingredients.");
    if (!page.method.length) throw new Error("Couldn't find the method. Paste the steps under a line that says Instructions.");

    const items = page.ingredients.map((raw, i) => {
      const n = normalizeIngredient(raw);
      return { i, text: n.text, prep: n.prep, keys: ingredientKeys(n.text), group: page.groups[i], used: false, branch: null };
    });

    // Find which ingredients a clause names. Full phrases claim their words
    // first, so "chicken broth" doesn't also count as "chicken".
    function named(clause) {
      const words = tokens(clause).filter((w) => !DROP.has(w));
      const taken = new Array(words.length).fill(false);
      const hits = [];
      const claim = (item, at, len) => {
        for (let k = at; k < at + len; k++) taken[k] = true;
        if (!hits.includes(item)) hits.push(item);
      };
      const forms = items
        .flatMap((it) => it.keys.phrases.map((p) => ({ it, p })))
        .sort((a, b) => b.p.length - a.p.length);
      for (const { it, p } of forms) {
        if (hits.includes(it)) continue;
        for (let at = 0; at + p.length <= words.length; at++) {
          if (p.every((w, k) => words[at + k] === w && !taken[at + k])) {
            // Two ingredients with the same name ("cornstarch" twice): the first unused one.
            const twin = items.find((o) => !o.used && !hits.includes(o) && o.keys.phrase.join(" ") === it.keys.phrase.join(" "));
            claim(twin || it, at, p.length);
            break;
          }
        }
      }
      const identity = new Set(items.flatMap((it) => it.keys.ids));
      words.forEach((w, at) => {
        if (taken[at]) return;
        let pool = items.filter((it) => !hits.includes(it) && (it.keys.ids.includes(w) || (it.keys.mods.includes(w) && !identity.has(w))));
        // A shorter word for the same thing: "nuts" for walnuts, "berries" for blueberries.
        if (!pool.length && w.length >= 3) pool = items.filter((it) => !it.used && !hits.includes(it) && it.keys.ids.some((id) => id.length > w.length && id.endsWith(w)));
        if (!pool.length) return;
        const pick = pool.find((it) => !it.used) || pool[0];
        claim(pick, at, 1);
      });
      return hits;
    }

    const prep = [];
    const open = []; // branches: { node, items:Set, parked, label, seq }
    let seq = 0; // when a branch was started, so joins list them in cooking order
    const branchOf = (it) => open.find((b) => b.items.has(it));
    let unusedNote = 0;

    function leafFor(it, verb) {
      it.used = true;
      // The method's own verb for a lone ingredient replaces the same prep ("mash" twice).
      if (it.prep && verb && it.prep.split(" ").pop() === verb) return it.text;
      return it.prep ? { do: it.prep, in: [it.text] } : it.text;
    }

    for (const raw of clausesOf(page.method)) {
      const clause = raw.replace(LEAD_IN, "");
      const hits = named(clause);
      const fresh = hits.filter((it) => !it.used).sort((a, b) => a.i - b.i);
      const known = hits.filter((it) => it.used);

      if (PREP_CLAUSE.test(clause) && !/\b(add|stir|cook|whisk|mix)\b/i.test(clause)) {
        prep.push(clean(raw).replace(/^and\s+/i, "").replace(/^./, (c) => c.toUpperCase()));
        continue;
      }
      if (!fresh.length && (SKIP_CLAUSE.test(clause) || (PARK.test(clause) && !known.length))) {
        if (PARK.test(clause) && open.length) open[open.length - 1].parked = true;
        continue;
      }
      // Unknown verb ("stuff the cavity") but ingredients named: use its first word.
      const action = actionFor(clause, items.flatMap((it) => it.keys.phrases)) || (fresh.length || known.length ? clause.split(/\s+/)[0].toLowerCase().replace(/[^a-z-]/g, "") : null);
      if (!action) continue;
      const verb = action.split(" ")[0];
      const leaves = fresh.map((it) => leafFor(it, fresh.length === 1 ? verb : null));
      const label = fresh.length && fresh.every((it) => it.group && it.group === fresh[0].group) ? fresh[0].group : "";

      // Which open branches does this clause pull in? "The remaining oil" of a
      // divided ingredient is a second helping, not a reference back.
      const pulled = new Set(known.filter((it) => !/\bdivided\b/i.test(it.text)).map(branchOf).filter(Boolean));
      const component = clause.match(COMPONENT);
      if (component) {
        const word = component[1].toLowerCase();
        for (const b of open) if (b.label && b.label.includes(word)) pulled.add(b);
        if (/mixture|dry ingredients|wet ingredients|batter|dough/.test(word) && open.length > 1) open.forEach((b) => pulled.add(b));
      }
      const top = open[open.length - 1];
      const startsNew = fresh.length && !pulled.size && (!top || top.parked || (NEW_VESSEL.test(raw) && open.length >= 1) || (label && top.label && label !== top.label));

      let branch;
      if (startsNew || !open.length) {
        branch = { node: { do: action, in: leaves }, items: new Set(fresh), parked: false, label, seq: seq++ };
        open.push(branch);
      } else {
        // Continue the latest unparked branch, joining any pulled-in ones.
        const base = top && !top.parked ? top : [...pulled][0] || top;
        const joined = [base].concat([...pulled].filter((b) => b !== base)).sort((a, b) => a.seq - b.seq);
        const node = { do: action, in: joined.map((b) => b.node).concat(leaves) };
        branch = { node, items: new Set(joined.flatMap((b) => [...b.items]).concat(fresh)), parked: false, label: joined.length > 1 ? "" : base.label, seq: joined[0].seq };
        for (const b of joined) open.splice(open.indexOf(b), 1);
        open.push(branch);
      }
      if (PARK.test(clause)) branch.parked = true;
    }

    const fixes = [];
    const leftovers = items.filter((it) => !it.used);
    if (leftovers.length) {
      unusedNote = leftovers.length;
      const top = open[open.length - 1];
      const extra = leftovers.map((it) => leafFor(it, null));
      if (top) top.node = { do: top.node.do, in: top.node.in.concat(extra) };
      else open.push({ node: { do: "combine", in: extra }, items: new Set() });
    }
    let tree = open.length > 1 ? { do: "serve", in: open.sort((a, b) => a.seq - b.seq).map((b) => b.node) } : open[0].node;
    if (open.length > 1) fixes.push("Some parts were never brought together in the method, so a final “serve” step joins them.");
    if (unusedNote) fixes.push(`${unusedNote} ingredient${unusedNote === 1 ? " isn't" : "s aren't"} named in the method, so ${unusedNote === 1 ? "it was" : "they were"} added to the last step. Drag ${unusedNote === 1 ? "it" : "them"} to where ${unusedNote === 1 ? "it belongs" : "they belong"}.`);
    if (typeof tree === "string") tree = { do: "combine", in: [tree] };

    return {
      recipe: {
        title: page.title || "Imported recipe",
        category: guessCategory(page.title),
        servings: page.servings,
        prep,
        notes: page.notes,
        tree,
      },
      fixes,
    };
  }

  const api = { convert, normalizeIngredient, actionFor, ingredientKeys, clausesOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RecipeQuickConvert = api;
})(typeof window !== "undefined" ? window : globalThis);
