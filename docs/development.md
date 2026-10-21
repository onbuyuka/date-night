# Development and deployment

Technical setup and operating notes for the invite-only Date Night planner.
For the product overview and screenshots, see the [README](../README.md).

**Event planner:** https://date-night.onbuyuka.workers.dev/

## Event planner

The application lives in [`planner/`](../planner/). React and TypeScript provide
the frontend, with a same-origin Worker API and D1 persistence. A small
Node.js service reads public venue websites.

Local development runs entirely on your computer and does not provision
cloud resources. Hosting uses the explicitly selected Free plans; provider
quotas and service availability still apply.

### Capabilities

- Create, edit, and delete your own private events as an organiser.
- Join as an organiser only through an expiring, single-use invitation from
  the owner. Organisers cannot browse or manage each other's events, and the
  owner does not receive an exception to this rule.
- The owner can issue/revoke organiser invitations, create password-reset
  links, and suspend/reactivate accounts. Suspension pauses that organiser's
  events, voting links and hosted photos without deleting their data.
- Change your password from **Your account**. Organiser and event-guest
  sessions are separate, so joining a friend's event preserves your workspace.
- Set an event name, required date, occasion, and introduction.
- Set the event's default city once. Location searches inherit it, with a
  collapsed **Change search area** override when needed. Addresses and map
  positions already present in a Maps link take priority over the default.
- Choose a Romantic, Birthday, Friends, or Minimal mood. Moods change the
  greeting, layout, typography, and decorative touches; colours and accent
  remain independently configurable. Decorations can be disabled per event;
  when reduced motion is requested, enabled decorations remain visible
  without animating.
- Upload a cover photo and up to six gallery photos per location, with
  previews and automatic compression.
- Paste a Google Maps link and explicitly choose **Find place** to expand
  sharing links and search TomTom for matching venues. Confirm the
  branch before applying its name, address, coordinates, and recorded website.
- When a supplied website is missing or cannot be read, review website
  suggestions. Search prefers the known website domain before searching more
  widely. A result is not treated as an official site automatically: choose
  **Read this website** to check it before applying any details.
- Use the discovered website, or paste one yourself, to preview structured
  venue details, menu links, and photo suggestions. Choose which fields to
  apply; existing text is not replaced automatically.
- Photos from a website start unselected and require permission confirmation
  before they are downloaded, compressed, and saved as private local images.
  Google ratings and review counts are not imported.
- Create named participants and personal, passwordless invitation links.
- Rate locations from one to five. Ratings save to the database, remain
  editable while voting is open, and restore when the same invitation is used
  in a different browser session.
- View live group averages and rating counts, refreshed every eight seconds.
  Unrated locations do not count as zero; equal averages share a rank.
- Close or reopen voting, revoke invitations, and generate replacement links
  without deleting saved votes.

### Run locally

From the repository root, in PowerShell:

```powershell
Set-Location .\planner
npm ci
npm run db:migrate
npm run dev
```

Open **http://127.0.0.1:5173/** and create your organiser username and password
on first use. Subsequent visits require sign-in. Participants still use their
personal invitations, without accounts.
The API listens on `127.0.0.1:8787`; Vite proxies browser requests to it.
A restricted public-website reader listens on `127.0.0.1:8791`.
`npm run dev` starts all three local processes.
The development scripts operate locally and do not provision Cloudflare resources. The
first `npm run dev` creates a random authentication key in the ignored
`planner/.dev.vars` file. Never commit that file.
Starting the API directly also runs this setup check. If the key is created
while an older preview is already running, stop and restart the preview so
the API loads it. Do not delete or regenerate an existing key to fix a startup
problem. The health endpoint reports an error until authentication is configured.

For automatic venue and website discovery, add free-plan API keys to that
same ignored `planner/.dev.vars` file:

```dotenv
TOMTOM_API_KEY=your_tomtom_key
TAVILY_API_KEY=your_tavily_key
```

Keep the existing `AUTH_SECRET` unchanged. Never put these keys in frontend
code or variables prefixed with `VITE_`. Restart an older preview after adding
keys so the API loads them. Missing provider configuration is reported
explicitly; manual location and website entry still work.
Use the providers' free plans without payment details, prepaid credit, or
pay-as-you-go. The application never upgrades a plan.

Create an event, add locations and people, and open voting. Copy a person's
invitation and open it in a private/incognito window to try the guest view
without replacing your organiser session.

The development servers deliberately bind to loopback. Local invitation links
work on this computer, not on another phone or over the internet.

### Production deployment

Production uses [`wrangler.production.jsonc`](../planner/wrangler.production.jsonc),
not the local preview configuration. The frontend and API share one HTTPS
origin. The production database starts empty: test accounts, events, votes
and images are not copied. Local test data remains in place.

The website reader is deployed separately using [`render.yaml`](../render.yaml):

- Exactly one Node.js web service on the **Free** plan, with no database,
  disk, npm dependencies or venue-domain allowlist.
- `WEB_READER_SECRET` is generated privately by the hosting service. Save a
  private local copy in `planner/.reader.vars.local` for the backend connection.
  This is not a Render account API key.
- Requests are authenticated; at most three reads run concurrently.
  Actual connection-time DNS checks and TLS validation are retained.
- The reader receives public website/photo URLs only, not organiser
  passwords, guest identities, votes, uploaded private images or search keys.
- The Free service sleeps after inactivity. A first import can take roughly
  a minute to start; the backend allows for this. Normal browsing and voting
  do not depend on this service. It has no production uptime guarantee.

From `planner/`, after reviewing the production target and signing into the
deployment CLI:

```powershell
npm run build
npm test
npm run test:e2e
node scripts/production.mjs prepare
node scripts/production.mjs deploy
node scripts/production.mjs owner-link
```

`prepare` creates or reuses the named production database, applies migrations,
and creates a separate production authentication secret. Provider keys are
read from the ignored local configuration; the reader credential is separate.
`deploy` scans the browser build for known secret values and uploads private
credentials atomically with the Worker version, never as public variables.

There is no public first-visitor signup. `owner-link` writes a one-use,
24-hour owner invitation to the ignored `.owner-invitation.local.html` file.
Open it locally to choose the real owner username/password; do not share it.
Subsequent organiser invitations expire after seven days. Password reset
links expire after 30 minutes. Owner recovery is an operator-only action:

```powershell
node scripts/production.mjs owner-reset
```

That writes an ignored `.owner-reset.local.html` file; it does not change the
password until the link is redeemed. Back up the production authentication
secret separately from the production database. Never delete or regenerate
it as a routine deployment step.

All `.env*`, `.dev.vars*`, `*.local`, and private owner-link files are ignored.
They must never be committed, included in frontend assets, or sent in chat.
Do not add payment details, prepaid credit, or a pay-as-you-go subscription.

### Persistence and access

- The database persists under `planner/.wrangler/state/` across server restarts.
  That directory is ignored by Git; removing it removes the local data.
- Guests receive server-validated sessions. Raw invitation tokens are only
  returned when generated; the database stores their hashes. Copy the link
  before closing the invitation dialog, or generate a replacement later.
- Invitation links are credentials: anyone holding one can use that person's
  ballot. Revoking or replacing a link invalidates their existing sessions.
- The former one-click organiser shortcut has been removed. First-account
  setup is restricted to local loopback hosts and cannot overwrite an existing
  owner. Production requires the privately issued owner invitation.
  Passwords must be at least 12 characters.
- Password verification uses salted PBKDF2-SHA-256 (100,000 iterations, the
  Workers runtime limit) plus an HMAC pepper stored separately from the
  database. Sessions and invitation credentials are stored as hashes.
  Back up `.dev.vars` alongside the database: losing its authentication key
  prevents verification of the existing organiser password.
- Login attempts are limited to ten per source per fifteen minutes.
  Invitations, organiser writes, uploads, and Maps resolution have separate
  limits. Request bodies are bounded while streaming, before full buffering.
  These are application controls, **not a guarantee against DDoS**.
  Production uses HTTPS, strict Origin checks, secure HttpOnly cookies,
  restrictive browser headers and bounded provider budgets. The unchanged
  password hashing passed a hosted runtime probe; free-runtime limits must
  still be monitored under real usage.
- The local D1 identifier is a placeholder. Production has a separate
  database binding and configuration; do not deploy the local configuration.
- Uploaded JPEG, PNG and WebP photos are compressed in the browser and checked
  on the server for file type, dimensions, and size. SVG uploads are rejected.
  Each stored image is limited to 384 KiB, with a 100 MiB workspace photo
  budget. Images are stored in local D1 and require event access to view.
  Unused staged uploads expire after a day; removed event photos are cleaned
  up. Use photographs you have permission to share.
- Maps resolution is organiser-only, follows only approved Maps sharing
  hosts, and bounds both redirect count and network timeout.
- Website requests go through a separate helper using Node's built-in HTTPS
  client. It checks DNS addresses at connection time and pins the checked
  addresses to that TLS connection. Private/reserved addresses, IP-literal
  URLs, non-HTTPS destinations, credentials, and nonstandard ports are
  rejected. Local credentials are never forwarded to venue websites.
  TLS certificate checks remain enabled; organisational network controls are
  not bypassed.
- Website reading respects applicable robots rules, limits redirects and
  response sizes, and parses public metadata rather than executing scripts.
  Sites that block access, require JavaScript, or omit structured details
  may need manual entry.
- Google ratings, menu contents, and reservation availability are not part of
  the planner.

### Free import sources and limits

Place matching uses [TomTom Places Search Discover](https://docs.tomtom.com/places-search-api/documentation/places-search/discover).
The Maps pin biases branch selection; otherwise searches use the event city
or the organiser's search-area override. Name, address and website suggestions
must be checked before use. Normalized candidates are cached for one hour.
Nominatim is no longer used. Existing saved OpenStreetMap source references
are preserved. Source acknowledgements are available under **Data credits**
in the event footer; provider names stay out of the normal interface and
user-facing error messages.

Website discovery uses [Tavily basic search](https://docs.tavily.com/documentation/api-credits).
If an existing website is known, the first search is restricted to its domain;
returned URLs are checked against that domain too. Empty domain results can
trigger one broader search. The organiser can also explicitly choose
**Search more widely**. These results are suggestions, not proof of ownership,
branch identity, or a working menu. Selecting a result only reads its metadata;
it does not save a location or select photos. Suggestions are cached for one day.

- Provider searches are organiser-only. No autocomplete, guest-view polling,
  or voting action calls either provider.
- Only public venue names, addresses, search areas, and Maps coordinates are
  sent. Event descriptions, guests, invitations, and local authentication
  credentials are never included.
- Provider keys are sent only to fixed vendor endpoints. Redirects are not
  followed with credentials. Venue websites use the separate guarded reader
  and never receive these keys.
- D1 enforces provider locks, backoff, and conservative rolling 31-day budgets:
  **4,500 TomTom requests** and **900 Tavily basic searches**. Reservations are
  atomic and survive restarts. Failed attempts count conservatively; cache
  hits do not. These counters cover this app, not playgrounds or other apps
  using the same provider account.
- Only basic Tavily search is requested, at one credit per call. Domain-first
  recovery uses at most two calls per request. No advanced search, generated
  answers, Tavily Extract, Map, Crawl, paid fallback, or LLM is enabled.
- Exhausted budgets, unavailable providers, missing keys, and malformed
  responses produce explicit errors. Manual website and location entry remain
  available.

Website previews are cached for one hour. The importer reads JSON-LD,
Open Graph metadata, and candidate menu links from the chosen page. It does
not crawl a complete site or claim that every venue will publish usable
metadata. HTML is limited to 2 MB after decompression; timeout, redirect, and
public-network restrictions still apply. Reader failures retain their actual
explanation rather than being presented as a missing venue page. Sources
are shown in the preview and on saved cards.

The same public-only website helper runs locally and on the selected Free
hosting service. The backend fails closed when it is not configured or its
private service credential is rejected. Provider data-retention/licensing
terms, quotas, attribution, and resource limits remain operator responsibilities.

### Checks

Run these commands from `planner/`:

```powershell
npm run build
npm test
npm run test:e2e
```

The build checks both frontend and Worker types. API tests use an isolated,
temporary D1 database. Playwright tests exercise the real local frontend and
API on separate test-only ports (5174 and 8789), with an isolated temporary
database. Browser-test startup uses fake credentials only and never loads
local key files. Tests create their own organiser, upload generated photo fixtures,
and use separate organiser and mobile guest sessions. They never create an
account in your local workspace or overwrite its password. Automated tests
use a separate fixture reader/provider server on port 8793 and fake API keys;
they make no external image, venue, or search requests. No extra npm
dependencies are needed for the importer.

On Windows, browser tests use installed Microsoft Edge in headless mode. On
other platforms, install Playwright's Chromium with `npx playwright install chromium`
before running the browser tests.

## Project structure

| Location | Purpose |
| --- | --- |
| [`planner/src/`](../planner/src/) | Frontend, event themes, voting and account screens |
| [`planner/worker/`](../planner/worker/) | API, accounts, permissions and venue import |
| [`planner/migrations/`](../planner/migrations/) | Database schema and additive migrations |
| [`planner/scripts/`](../planner/scripts/) | Local setup, isolated tests, reader and deployment tools |
| [`planner/tests/`](../planner/tests/) | API, reader, production and browser regressions |
| [`render.yaml`](../render.yaml) | Free website-reader blueprint |
| [`screenshots/`](screenshots/) | Product-tour images generated from fictional fixtures |

## Refresh the product screenshots

From `planner/`:

```powershell
npm run screenshots
```

This builds the frontend and captures its real screens against deterministic,
in-memory demo responses. Venue illustrations are drawn locally. The script
does not read key files, access the production API, create accounts or events,
or call external search providers. It stops its preview server when finished.
Review the generated images before committing them.

## Retired prototype

The original static birthday site has been retired. Its source remains
available in Git history. The current frontend and API deploy together at
the planner address above.

The former address, https://onbuyuka.github.io/date-night/, serves only a
redirect. The [`redirect/`](../redirect/) source is published by
[`redirect.yml`](../.github/workflows/redirect.yml) to a minimal `gh-pages`
branch containing `index.html`, `404.html` and `.nojekyll`. It does not host
the planner, user data, credentials or another copy of the application.

GitHub Pages cannot issue a custom server-side 301/302 here, so the stub uses
`location.replace` with an HTML refresh and clickable-link fallback.
Planner hash routes and query parameters are preserved by JavaScript;
obsolete prototype tab fragments are discarded.

Both entry pages include identical static titles, descriptions and Open Graph/
Twitter preview tags, with one public brand image at the main app origin.
Messaging crawlers do not need to run the redirect script or sign in to fetch
these fields. Previews are generic: private event names, guests and invitation
tokens are never embedded in them.

To refresh the original SVG-based social image, run `npm run social-image`
from `planner/`, then rebuild and deploy the planner. The PNG is 1200 x 630;
it does not contain screenshots, event data or third-party photographs.
Keep preview metadata in both HTML entry pages in sync; the redirect tests
check their equality. Previously shared links may keep cached previews until
the messaging service refreshes its cache.
