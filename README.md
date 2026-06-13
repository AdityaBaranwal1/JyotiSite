# Jeevan Jyoti — The Community Paper

A weekly newspaper for the Jeevan Jyoti senior community of Rockland County, New York.
Cream paper, indigo ink, one marigold accent — a hand-made local paper, on the web.

The front page is one thing: **what's on this week**. A back page carries the puzzles,
the almanac, and the weather, the way a real paper does.

## Built for older eyes

Large, high-contrast type (WCAG AAA), generous tap targets, no menus to get lost in, and a
reader text-size control on every page. Designed to be read on a phone by an eighty-year-old.

## Running it

No build step, no framework — just static files.

```
python -m http.server 8000
```

Then open <http://localhost:8000>.

```
npm test        # logic: schedule, theming, sudoku, crossword
```

## Structure

| Path            | What's there                                              |
|-----------------|-----------------------------------------------------------|
| `index.html`    | Front page — masthead, this week's schedule, editor's note |
| `back-page.html`| Sudoku, crossword, the almanac, the forecast              |
| `css/`          | `paper.css` design tokens · `components.css` furniture     |
| `js/`           | Schedule, theming, weather, and the two games             |
| `data/`         | The weekly schedule, the almanac, vendored puzzles        |

Weather is live from the National Weather Service. The schedule reads from a local JSON file
today, with seams ready for Google Sheets or Airtable when the community chooses one.

---

*Set with care for the volunteers of Jeevan Jyoti — जीवन ज्योति, “the light of life.”*
