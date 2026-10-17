// Installable-app support: register the offline cache, ask the browser to
// keep this site's storage (so saved recipes aren't cleared to free space),
// and offer an Install button where the browser allows one.
(function (root) {
  "use strict";

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    root.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  const standalone = root.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const box = document.getElementById("install");
  if (!box || standalone) return;

  const button = box.querySelector("button");
  const hint = box.querySelector(".install-hint");
  let deferred = null;

  root.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event;
    box.hidden = false;
    button.hidden = false;
    hint.textContent = "Use it like an app, even offline.";
  });
  button.addEventListener("click", async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    deferred = null;
    box.hidden = true;
  });
  root.addEventListener("appinstalled", () => (box.hidden = true));

  if (isIOS) {
    box.hidden = false;
    button.hidden = true;
    hint.textContent = "Install on iPhone or iPad: tap Share, then Add to Home Screen.";
  }
})(window);
