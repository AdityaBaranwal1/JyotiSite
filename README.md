# Jeevan Jyoti — The Community Paper

A weekly newspaper for the Jeevan Jyoti senior community of Rockland County, New York.
Cream paper, indigo ink, one marigold accent — a hand-made local paper, on the web.

The front page is one thing: **what's on this week**. The month page lays out the weeks
ahead, and a back page carries the puzzles, the almanac and the weather, the way a real
paper does.

## Built for older eyes and older hands

Readers: large, high-contrast type (WCAG AAA), tap targets of at least 48px, no menus to get
lost in, and a text-size control on every page. Designed to be read on a phone by an
eighty-year-old.

Editors are seniors too, so **the Editor's Desk** (`/admin`) is built the same way:

- **One password**, no username. A volunteer stays signed in on their device for two months.
- **Every change goes on the paper the moment it is made.** There is no "publish" step to
  forget. The **Undo** button at the bottom of the screen takes back the last change, and
  **Undo a Mistake** puts back the whole paper as it was before any editing sitting.
- **Weekly programs** (yoga every Monday, and so on) run until someone stops them. Changing
  one starts today; weeks already past stay as they were printed.
- **One date** can be changed or cancelled on its own. A cancelled date stays on the paper
  with a CANCELLED stamp, so nobody turns up to an empty room.
- Plain words throughout, a short form with the rarer details under "More options", and
  times picked from a list instead of a spinner.

## Running it

```
npm install
npm run build                                   # builds the pages into dist/
node tools/set-admin-password.mjs '<password>'  # the volunteers' shared password
PORT=8090 node server.mjs
```

Then open <http://localhost:8090> for the paper and <http://localhost:8090/admin> for the desk.
Setting a new password signs every device out, so tell the volunteers first.

On the homelab the server runs as a systemd user unit, `jyotisite.service`, from this
checkout. It starts at boot and restarts itself if it stops:

```
systemctl --user status jyotisite       # is it up?
systemctl --user restart jyotisite      # after `npm run build`, or a code change to server/
journalctl --user -u jyotisite -f       # its log
```

## Where the paper lives

`data/schedule.json` **is the live paper.** The desk writes it, and the server reads it on
every request, so a change shows at once with no rebuild. Each editing sitting files the
paper it replaced in `data/versions/` (the last 12 are kept); that folder is what **Undo a
Mistake** reads. `data/admin.json` holds the password hash and is never committed.

Because the live paper is a file in this repository, be careful with git here: checking out
an older commit, or `git checkout -- data/`, puts an older paper in front of readers.

A schedule holds:

| Key          | What it is                                                                 |
|--------------|-----------------------------------------------------------------------------|
| `series`     | weekly programs: an RRULE, a `from` date, and an `until` once stopped        |
| `exceptions` | a change to one date of a weekly program (a topic, a time, a cancellation)  |
| `events`     | programs on a single date                                                    |
| `editorsNote`, `defaultZoomLink` | the front-page note, and the usual Zoom room          |

## Tests

```
npm test               # logic: schedule, weekly programs, server, puzzles, theming
npm run test:visual    # the real pages in Chromium: screenshots, the desk, motion
```

The browser suite runs its own server on port 8193 against a scratch copy of the data, built
from the frozen `tests/fixtures/schedule.json`, so it never touches the live paper.

## Structure

| Path               | What's there                                                  |
|--------------------|---------------------------------------------------------------|
| `index.html`       | Front page: masthead, this week's schedule, the editor's note |
| `month.html`       | The month ahead                                               |
| `back-page.html`   | Sudoku, crossword, the almanac, the forecast                  |
| `admin.html`       | The Editor's Desk                                             |
| `server.mjs`, `server/` | The Express server: the pages, the schedule API, sign-in  |
| `css/`             | `paper.css` tokens · `components.css` furniture · `motion.css` · `admin.css` |
| `js/`              | Schedule, weekly programs (`series-edit.js`), the desk, weather, the games |
| `data/`            | The live schedule, the almanac, vendored puzzles              |
| `docs/design-spec.md` | The design rules: type, colour, spacing, motion           |

Weather is live from the National Weather Service.

---

*Set with care for the volunteers of Jeevan Jyoti, “the light of life.”*
