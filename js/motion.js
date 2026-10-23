/* motion.js — the little JavaScript the paper's motion needs. Everything
   here is optional: without it, or with Reduce Motion on, the page is
   simply already printed. The movements themselves live in css/motion.css. */

const reduceQuery = typeof matchMedia === "function"
  ? matchMedia("(prefers-reduced-motion: reduce)")
  : null;

export const motionOK = () => !reduceQuery?.matches;

/* Runs a DOM update as a same-document view transition when the browser
   has them and the reader welcomes motion; otherwise just runs it. `kind`
   picks the choreography in motion.css (html[data-vt="…"]). */
export function transition(update, kind = "swap") {
  if (!motionOK() || typeof document.startViewTransition !== "function") {
    update();
    return;
  }
  const root = document.documentElement;
  root.dataset.vt = kind;
  const t = document.startViewTransition(update);
  t.finished.finally(() => { delete root.dataset.vt; });
}

/* ---------- Rules drawn as the reader reaches them ----------
   Rules already on screen are left alone. Rules below the fold are set
   waiting (undrawn) while they are out of sight, then drawn when they
   scroll in. Nothing on screen is ever hidden by this. */
function armRules() {
  if (!motionOK() || !("IntersectionObserver" in window)) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.remove("is-waiting");
      e.target.classList.add("is-arriving");
      io.unobserve(e.target);
    }
  }, { rootMargin: "0px 0px -12% 0px" });

  for (const rule of document.querySelectorAll("hr.thick-thin")) {
    if (rule.getBoundingClientRect().top < innerHeight) continue;
    rule.classList.add("is-waiting");
    io.observe(rule);
  }
}

/* Pages that fetch their schedule grow after load and push their lower
   rules down, so they arm once main.js says the content is in (with a
   fallback, so a slow network never leaves rules waiting). */
function boot() {
  if (!document.getElementById("datebook")) { armRules(); return; }
  let armed = false;
  const once = () => { if (!armed) { armed = true; armRules(); } };
  document.addEventListener("jj:rendered", once, { once: true });
  setTimeout(once, 2500);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
}
