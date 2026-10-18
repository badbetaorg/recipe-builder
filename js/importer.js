// The Import page: paste a recipe link or text and get a sheet back, either
// from Claude (with the cook's own Anthropic API key, called straight from
// the browser) or from the rule-based quick converter. Either way the result
// opens in the editor for review before it is saved.
(function (root) {
  "use strict";

  const { h } = root.RecipeRender;
  const Core = root.RecipeImportCore;
  const KEY_STORE = "recipe-grid:anthropic-key";
  const HANDOFF = "recipe-grid:import";
  // Pinned SDK build, loaded only when someone converts with Claude.
  const SDK_URL = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.131.0/+esm";
  // Claude Opus 5.5 list prices per million tokens, for the cost estimate.
  const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };

  let sessionKey = "";

  function storedKey() {
    try {
      return localStorage.getItem(KEY_STORE) || "";
    } catch (e) {
      return "";
    }
  }
  function rememberKey(key) {
    try {
      if (key) localStorage.setItem(KEY_STORE, key);
      else localStorage.removeItem(KEY_STORE);
    } catch (e) {
      /* the key still works for this visit */
    }
  }

  let sdk = null;
  async function loadSdk() {
    if (!sdk) {
      const mod = await import(SDK_URL);
      sdk = mod.default || mod.Anthropic;
    }
    return sdk;
  }

  function friendlyError(err, Anthropic) {
    if (Anthropic && err instanceof Anthropic.AuthenticationError) return "Anthropic didn't accept that API key. Check it and try again.";
    if (Anthropic && err instanceof Anthropic.PermissionDeniedError) return "That API key isn't allowed to use this model or web fetch. Check its permissions in the Claude Console.";
    if (Anthropic && err instanceof Anthropic.RateLimitError) return "Your Anthropic account hit a rate limit. Wait a minute and try again.";
    if (Anthropic && err instanceof Anthropic.BadRequestError) return "Anthropic rejected the request: " + (err.error && err.error.error && err.error.error.message ? err.error.error.message : err.message);
    if (Anthropic && err instanceof Anthropic.APIConnectionError) return "Couldn't reach Anthropic. Check your connection and try again.";
    if (Anthropic && err instanceof Anthropic.APIError) return `Anthropic returned an error (${err.status}). Try again in a moment.`;
    return err && err.message ? err.message : "Something went wrong.";
  }

  function estimateCost(usage) {
    const dollars =
      ((usage.input_tokens || 0) * PRICE.input +
        (usage.output_tokens || 0) * PRICE.output +
        (usage.cache_read_input_tokens || 0) * PRICE.cacheRead +
        (usage.cache_creation_input_tokens || 0) * PRICE.cacheWrite) /
      1e6;
    return dollars < 0.01 ? "under 1¢" : "about $" + dollars.toFixed(2);
  }

  // Run the conversion, resuming if the server-side tool loop pauses.
  async function convertWithClaude(input, apiKey, onStage, signal) {
    const Anthropic = await loadSdk();
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    const params = Core.buildRequest(input);
    const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    try {
      for (let round = 0; round < 4; round++) {
        const stream = client.beta.messages.stream(params, { signal });
        stream.on("streamEvent", (event) => {
          if (event.type !== "content_block_start") return;
          const type = event.content_block.type;
          if (type === "server_tool_use") onStage("Reading the recipe page…");
          else if (type === "text") onStage("Laying out the sheet…");
          else if (type === "thinking") onStage("Working out which steps combine what…");
        });
        const message = await stream.finalMessage();
        for (const k of Object.keys(usage)) usage[k] += message.usage[k] || 0;
        if (message.stop_reason === "pause_turn") {
          // Hand the paused turn back unchanged; the server picks up where it stopped.
          params.messages = params.messages.concat({ role: "assistant", content: message.content });
          continue;
        }
        const flat = Core.parseReply(message);
        const result = Core.flatToTree(flat);
        result.cost = estimateCost(usage);
        return result;
      }
      throw new Error("Claude took too many steps reading that page. Try pasting the recipe text instead.");
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
      if (Anthropic && err instanceof Anthropic.APIUserAbortError) throw Object.assign(new Error("Cancelled."), { name: "AbortError" });
      throw new Error(friendlyError(err, Anthropic));
    }
  }

  function handOff(result, how) {
    const notes = [how].concat(result.fixes || []);
    try {
      sessionStorage.setItem(HANDOFF, JSON.stringify({ recipe: result.recipe, notes }));
    } catch (e) {
      root.__recipeImport = { recipe: result.recipe, notes };
    }
    location.hash = "#/review";
  }

  // The recipe waiting for review, if any (read once).
  function takeHandoff() {
    let data = root.__recipeImport || null;
    try {
      const raw = sessionStorage.getItem(HANDOFF);
      if (raw) data = JSON.parse(raw);
    } catch (e) {
      /* fall through to the in-memory copy */
    }
    return data;
  }
  function clearHandoff() {
    root.__recipeImport = null;
    try {
      sessionStorage.removeItem(HANDOFF);
    } catch (e) {
      /* nothing stored */
    }
  }

  function open(container) {
    const saved = storedKey();
    const input = h("textarea", {
      id: "import-input",
      rows: 9,
      placeholder: "https://www.example.com/best-banana-bread\n\n…or paste the whole recipe: title, ingredients and steps.",
    });
    const keyInput = h("input", { id: "import-key", type: "password", autocomplete: "off", spellcheck: "false", placeholder: "sk-ant-…", value: sessionKey || saved });
    const remember = h("input", { id: "import-remember", type: "checkbox", checked: !!saved });
    const status = h("p", { class: "import-status", role: "status", "aria-live": "polite", hidden: true });
    const aiButton = h("button", { type: "button", class: "accent" }, "Convert with Claude");
    const quickButton = h("button", { type: "button" }, "Quick convert");
    const cancelButton = h("button", { type: "button", class: "quiet", hidden: true }, "Cancel");
    const quickHint = h("p", { class: "hint" });
    const keyBox = h(
      "details",
      { class: "key-box", open: saved ? null : true },
      h("summary", {}, saved ? "Claude is set up on this device" : "Set up Claude (one time)"),
      h(
        "div",
        { class: "key-fields" },
        h(
          "p",
          { class: "hint" },
          "Converting with Claude uses your own Anthropic API key, billed to your account at a few cents per recipe. Get a key from the ",
          h("a", { href: "https://console.anthropic.com/settings/keys", target: "_blank", rel: "noopener" }, "Claude Console"),
          ". It goes straight from this browser to Anthropic and nowhere else."
        ),
        h("label", { for: "import-key" }, "Anthropic API key"),
        keyInput,
        h("label", { class: "check" }, remember, " Remember it on this device"),
        h(
          "p",
          { class: "hint small" },
          "Only tick this on your own device: anyone who can use this browser could find a saved key. ",
          saved ? h("button", { type: "button", class: "link-button", onclick: forget }, "Forget the saved key") : null
        )
      )
    );

    function forget() {
      rememberKey("");
      sessionKey = "";
      keyInput.value = "";
      remember.checked = false;
      keyBox.open = true;
      setStatus("The saved key was removed from this device.");
    }

    function setStatus(text, kind) {
      status.hidden = !text;
      status.className = "import-status" + (kind ? " " + kind : "");
      status.textContent = text || "";
    }

    function refreshButtons() {
      const value = input.value.trim();
      const url = Core.isUrl(value);
      quickButton.disabled = !value || url;
      aiButton.disabled = !value;
      quickHint.textContent = url
        ? "Quick convert can't open web pages (browsers block that). Paste the recipe text instead, or convert the link with Claude."
        : "Quick convert works offline and needs no key. It follows the order of the steps, so you may want to regroup a few cells afterwards.";
    }
    input.addEventListener("input", refreshButtons);

    quickButton.addEventListener("click", () => {
      try {
        const result = Core.quickConvert(input.value);
        handOff(result, "Converted with quick import. Check the steps against the original before saving.");
      } catch (err) {
        setStatus(err.message, "error");
      }
    });

    let controller = null;
    let timer = null;
    aiButton.addEventListener("click", async () => {
      const apiKey = keyInput.value.trim();
      if (!apiKey) {
        keyBox.open = true;
        keyInput.focus();
        setStatus("Add your Anthropic API key first.", "error");
        return;
      }
      if (!navigator.onLine) {
        setStatus("You're offline. Converting with Claude needs a connection; quick convert works offline.", "error");
        return;
      }
      sessionKey = apiKey;
      rememberKey(remember.checked ? apiKey : "");
      controller = new AbortController();
      aiButton.disabled = quickButton.disabled = true;
      cancelButton.hidden = false;
      const started = Date.now();
      let stage = Core.isUrl(input.value) ? "Fetching the page…" : "Reading the recipe…";
      const tick = () => setStatus(`${stage} ${Math.round((Date.now() - started) / 1000)}s`, "working");
      tick();
      timer = setInterval(tick, 1000);
      try {
        const result = await convertWithClaude(input.value, apiKey, (s) => { stage = s; tick(); }, controller.signal);
        handOff(result, `Converted by Claude (${result.cost} on your Anthropic account). Check amounts and steps against the source before saving.`);
      } catch (err) {
        setStatus(err.name === "AbortError" ? "Cancelled." : err.message, err.name === "AbortError" ? "" : "error");
      } finally {
        clearInterval(timer);
        controller = null;
        cancelButton.hidden = true;
        refreshButtons();
      }
    });
    cancelButton.addEventListener("click", () => controller && controller.abort());

    container.replaceChildren(
      h(
        "div",
        { class: "wrap page import-page" },
        h(
          "div",
          { class: "editor-head" },
          h(
            "div",
            {},
            h("p", { class: "eyebrow" }, "Bring in a recipe you already have"),
            h("h1", { class: "display" }, "Import a recipe")
          )
        ),
        h(
          "div",
          { class: "editor-cols" },
          h(
            "section",
            { class: "panel strong import-main" },
            h("h2", {}, h("span", { class: "step-no" }, "01"), "Link or text"),
            h("p", { class: "hint" }, "Paste a link to a recipe page, or the recipe itself copied from anywhere."),
            h("label", { for: "import-input", class: "visually-hidden" }, "Recipe link or text"),
            input,
            h("div", { class: "row import-actions" }, aiButton, quickButton, cancelButton),
            status,
            quickHint
          ),
          h(
            "aside",
            { class: "editor-side import-side" },
            h(
              "section",
              { class: "panel" },
              h("h2", {}, h("span", { class: "step-no" }, "02"), "What happens"),
              h(
                "ul",
                { class: "how" },
                h("li", {}, h("strong", {}, "With Claude: "), "it reads the page or text, works out which ingredients are prepared and mixed together, and lays out the sheet with real parallel steps."),
                h("li", {}, h("strong", {}, "Quick convert: "), "no AI and no key. It reads the ingredient list and joins each one in at the first step that mentions it."),
                h("li", {}, "Either way the sheet opens in the builder for you to check. Nothing is saved until you press Save.")
              )
            ),
            keyBox
          )
        )
      )
    );
    refreshButtons();
    input.focus();
  }

  root.RecipeImporter = { open, takeHandoff, clearHandoff };
})(window);
