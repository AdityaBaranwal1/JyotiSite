/* Ink icon kit — hand-drawn one-color strokes, recolor via currentColor.
   Used by schedule listings (category icons) and the weather ear (glyphs). */

const S = (inner, label) =>
  `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true" ` +
  `fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

/* ---------- Activity category icons ---------- */
export const categoryIcons = {
  // Diya (oil lamp) — "Jyoti" itself; also the default mark
  diya: S(`
    <path d="M14 40 Q 16 52 32 53 Q 48 52 50 40 Q 41 43 32 43 Q 23 43 14 40 Z"/>
    <path d="M32 36 Q 26 30 29 23 Q 31 19 32 16 Q 33 19 35 23 Q 38 30 32 36 Z"/>
    <path d="M20 58 Q 32 61 44 58"/>`),
  yoga: S(`
    <circle cx="32" cy="14" r="6"/>
    <path d="M32 20 L 32 34"/>
    <path d="M32 26 Q 20 28 14 36 M32 26 Q 44 28 50 36"/>
    <path d="M32 34 Q 22 36 16 44 Q 24 48 32 46 Q 40 48 48 44 Q 42 36 32 34 Z"/>`),
  art: S(`
    <path d="M46 10 Q 50 8 53 12 Q 56 16 52 19 L 30 40 Q 26 36 25 34 Z"/>
    <path d="M25 34 Q 18 38 17 45 Q 16 51 10 53 Q 20 56 26 51 Q 31 46 30 40"/>`),
  finance: S(`
    <circle cx="32" cy="32" r="19"/>
    <path d="M38 24 Q 32 20 27 24 Q 23 28 28 31 L 36 34 Q 41 37 37 41 Q 32 45 26 41"/>
    <path d="M32 17 L 32 22 M32 42 L 32 47"/>`),
  computer: S(`
    <rect x="11" y="13" width="42" height="28" rx="2"/>
    <path d="M26 49 Q 32 47 38 49 M22 53 L 42 53 M32 41 L 32 49"/>`),
  health: S(`
    <path d="M32 52 Q 12 38 12 25 Q 12 14 22 14 Q 29 14 32 21 Q 35 14 42 14 Q 52 14 52 25 Q 52 38 32 52 Z"/>
    <path d="M18 32 L 26 32 L 29 26 L 34 38 L 37 32 L 46 32"/>`),
  talk: S(`
    <path d="M12 16 Q 12 12 16 12 L 48 12 Q 52 12 52 16 L 52 36 Q 52 40 48 40 L 26 40 L 15 50 L 18 40 Q 12 40 12 36 Z"/>
    <path d="M21 22 L 43 22 M21 30 L 37 30"/>`),
  music: S(`
    <path d="M24 46 L 24 16 Q 36 12 46 16 L 46 42"/>
    <ellipse cx="18" cy="46" rx="6" ry="5"/>
    <ellipse cx="40" cy="42" rx="6" ry="5"/>
    <path d="M24 24 Q 36 20 46 24"/>`),
};

/* ---------- Weather glyphs (NWS shortForecast → glyph) ---------- */
export const weatherIcons = {
  sun: S(`
    <circle cx="32" cy="32" r="11"/>
    <path d="M32 8 L 32 15 M32 49 L 32 56 M8 32 L 15 32 M49 32 L 56 32 M15 15 L 20 20 M44 44 L 49 49 M49 15 L 44 20 M20 44 L 15 49"/>`),
  moon: S(`
    <path d="M40 12 Q 28 16 28 31 Q 28 46 41 50 Q 33 55 24 51 Q 12 46 12 32 Q 12 18 24 13 Q 32 10 40 12 Z"/>`),
  cloud: S(`
    <path d="M19 44 Q 10 44 10 36 Q 10 29 17 28 Q 18 18 28 17 Q 37 16 41 24 Q 52 24 53 34 Q 53 44 43 44 Z"/>`),
  partly: S(`
    <circle cx="44" cy="20" r="8"/>
    <path d="M44 6 L 44 10 M58 20 L 54 20 M54 10 L 51 13 M54 30 L 51 27"/>
    <path d="M15 50 Q 7 50 7 43 Q 7 37 13 36 Q 14 27 23 26 Q 31 25 34 32 Q 44 32 45 41 Q 45 50 36 50 Z"/>`),
  rain: S(`
    <path d="M19 38 Q 10 38 10 30 Q 10 23 17 22 Q 18 12 28 11 Q 37 10 41 18 Q 52 18 53 28 Q 53 38 43 38 Z"/>
    <path d="M20 45 L 17 53 M30 45 L 27 53 M40 45 L 37 53"/>`),
  snow: S(`
    <path d="M19 36 Q 10 36 10 28 Q 10 21 17 20 Q 18 10 28 9 Q 37 8 41 16 Q 52 16 53 26 Q 53 36 43 36 Z"/>
    <path d="M20 46 L 20 54 M16 50 L 24 50 M32 44 L 32 52 M28 48 L 36 48 M44 46 L 44 54 M40 50 L 48 50"/>`),
  storm: S(`
    <path d="M19 36 Q 10 36 10 28 Q 10 21 17 20 Q 18 10 28 9 Q 37 8 41 16 Q 52 16 53 26 Q 53 36 43 36 Z"/>
    <path d="M33 38 L 26 48 L 32 48 L 28 58 L 38 46 L 32 46 L 36 38 Z"/>`),
  fog: S(`
    <path d="M12 24 Q 22 20 32 24 Q 42 28 52 24 M12 34 Q 22 30 32 34 Q 42 38 52 34 M12 44 Q 22 40 32 44 Q 42 48 52 44"/>`),
  wind: S(`
    <path d="M10 26 L 38 26 Q 46 26 46 19 Q 46 13 40 13 M10 36 L 48 36 Q 56 36 56 43 Q 56 49 50 49 M10 46 L 30 46"/>`),
};

/* Map an NWS shortForecast phrase + daytime flag to a glyph key. */
export function glyphFor(shortForecast = "", isDaytime = true) {
  const f = shortForecast.toLowerCase();
  if (f.includes("thunder")) return "storm";
  if (f.includes("snow") || f.includes("flurr") || f.includes("sleet") || f.includes("ice")) return "snow";
  if (f.includes("rain") || f.includes("shower") || f.includes("drizzle")) return "rain";
  if (f.includes("fog") || f.includes("haze") || f.includes("mist")) return "fog";
  if (f.includes("wind") || f.includes("breez") || f.includes("blustery")) return "wind";
  if (f.includes("partly") || f.includes("mostly sunny") || f.includes("mostly clear")) return "partly";
  if (f.includes("cloud") || f.includes("overcast")) return "cloud";
  if (f.includes("sunny") || f.includes("clear")) return isDaytime ? "sun" : "moon";
  return isDaytime ? "partly" : "moon";
}

export function categoryIcon(category = "") {
  const c = String(category).toLowerCase();
  if (c.includes("yoga") || c.includes("medit") || c.includes("exercise")) return categoryIcons.yoga;
  if (c.includes("art") || c.includes("paint") || c.includes("craft")) return categoryIcons.art;
  if (c.includes("financ") || c.includes("stock") || c.includes("money") || c.includes("market")) return categoryIcons.finance;
  if (c.includes("computer") || c.includes("phone") || c.includes("tech")) return categoryIcons.computer;
  if (c.includes("health") || c.includes("depress") || c.includes("wellness") || c.includes("doctor")) return categoryIcons.health;
  if (c.includes("music") || c.includes("sing") || c.includes("bhajan")) return categoryIcons.music;
  if (c.includes("talk") || c.includes("discussion") || c.includes("social")) return categoryIcons.talk;
  return categoryIcons.diya;
}
