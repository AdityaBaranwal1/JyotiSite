/* weather.js — Rockland County forecast from the National Weather Service.
   Rendered as newspaper furniture: a masthead "weather ear" and a ruled
   forecast table on the Back Page. Ink only — no colored widget.

   URL resolved once from api.weather.gov/points/41.1489,-74.0048
   (New City, NY — the county seat). NWS allows browser CORS, no key. */

import { weatherIcons, glyphFor } from "./icons.js";

export const FORECAST_URL = "https://api.weather.gov/gridpoints/OKX/30,62/forecast";
const CACHE_KEY = "jyoti-weather-cache";

export function summarizePeriods(periods, nextCount = 6) {
  if (!Array.isArray(periods) || periods.length === 0) return null;
  return { now: periods[0], next: periods.slice(1, 1 + nextCount) };
}

export async function getForecast({ fetchImpl, storage } = {}) {
  const doFetch = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
  try {
    const res = await doFetch(FORECAST_URL, { headers: { Accept: "application/geo+json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const periods = body?.properties?.periods;
    if (!Array.isArray(periods) || !periods.length) throw new Error("no periods");
    try { store?.setItem(CACHE_KEY, JSON.stringify(periods)); } catch { /* ignore */ }
    return { periods, stale: false };
  } catch {
    try {
      const cached = store?.getItem(CACHE_KEY);
      if (cached) return { periods: JSON.parse(cached), stale: true };
    } catch { /* ignore */ }
    return null;
  }
}

const glyphSvg = (p) => weatherIcons[glyphFor(p.shortForecast, p.isDaytime)] || weatherIcons.partly;

/* Masthead ear: WEATHER · ROCKLAND CO., N.Y. / 78° + glyph / "Sunny" */
export async function initWeatherEar(el) {
  const data = await getForecast();
  const s = data && summarizePeriods(data.periods);
  if (!s) { el.hidden = true; return; } // fails closed, never an error box

  el.innerHTML = `
    <div class="we-label">Weather</div>
    <div class="we-now">
      <span class="we-glyph">${glyphSvg(s.now)}</span>
      <span class="we-temp">${s.now.temperature}°${s.now.temperatureUnit}</span>
    </div>
    <div class="we-phrase"></div>
    <div class="we-place">Rockland Co., N.Y.</div>`;
  el.querySelector(".we-phrase").textContent = s.now.shortForecast;
  el.hidden = false;
}

/* Back Page forecast table: day · glyph · temp · phrase, ruled rows. */
export async function initForecastBox(el) {
  const data = await getForecast();
  const s = data && summarizePeriods(data.periods, 6);
  if (!s) { el.hidden = true; return; }

  const rows = [s.now, ...s.next].map((p) => {
    const row = document.createElement("div");
    row.className = "forecast-row";
    row.innerHTML = `<span class="f-day"></span>${glyphSvg(p)}<span class="f-phrase"></span><span class="f-temp"></span>`;
    row.querySelector(".f-day").textContent = p.name;
    row.querySelector(".f-phrase").textContent = p.shortForecast;
    row.querySelector(".f-temp").textContent = `${p.temperature}°${p.temperatureUnit}`;
    return row;
  });
  const slot = el.querySelector("[data-forecast-rows]") || el;
  slot.textContent = "";
  rows.forEach((r) => slot.appendChild(r));
  el.hidden = false;
}
