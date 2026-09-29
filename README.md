# Date Night

A mobile‑first web app — styled like a native iOS app — for choosing where to
have dinner on a special evening in Copenhagen. Browse a curated set of
restaurants with swipeable photo galleries, real reservation times, Google
ratings and dietary notes, rate each out of five, and let a live leaderboard
crown the winner.

**Live site:** https://onbuyuka.github.io/date-night/

## Features

- **iOS‑style interface** — frosted navigation bar, a bottom tab bar
  (Home · Places · Ranking), safe‑area handling, and "Add to Home Screen"
  support so it launches full‑screen like an app.
- **Swipeable galleries** — each venue shows its interior and a few dishes,
  with swipe/scroll‑snap and dot indicators.
- **Real availability** — bookable time slots for a table of two, gathered from
  each venue's own reservation system.
- **Google ratings** — star rating and review count per venue.
- **Dietary notes** — a short, per‑venue note (this build highlights
  pescetarian‑friendliness).
- **Live leaderboard** — rate venues out of five and watch the ranking sort
  itself. Ratings persist in the browser via `localStorage`.

## Tech stack

- Vanilla **HTML, CSS and JavaScript** — no framework, no build step, no runtime
  dependencies.
- [Fraunces](https://fonts.google.com/specimen/Fraunces) via Google Fonts.
- Hosted on **GitHub Pages**, deployed from the `gh-pages` branch.

## Project structure

| File | Purpose |
| --- | --- |
| `index.html` | App shell — navigation bar, tab screens, tab bar |
| `styles.css` | Styling (iOS‑inspired) |
| `app.js` | Rendering, tab navigation, galleries, voting, leaderboard |
| `data.js` | Restaurant data — edit here to customise venues |

## Local development

No tooling is required. Clone the repo and open `index.html` directly, or serve
it locally so relative paths and fonts behave exactly as in production:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

## Deployment

- **`main`** holds the source.
- Every push to `main` runs [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml),
  which publishes only the runtime files (`index.html`, `styles.css`, `app.js`,
  `data.js`) to the **`gh-pages`** branch.
- **GitHub Pages** serves the `gh-pages` branch at the live URL above.

To deploy manually, run the workflow from the Actions tab (`workflow_dispatch`).

## Data & imagery

Menus, opening hours, availability, ratings and photographs are sourced from
each restaurant's own website and its Google Maps listing. Images are referenced
(hotlinked) rather than redistributed and remain the property of their
respective owners.
