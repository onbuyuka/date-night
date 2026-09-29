# Birthday Date Night 🎂

A little **birthday** web-app to pick where we eat on **Friday, October 2nd
2026** — designed to feel like an iOS app on your phone (and it works on a
computer too, where it shows up as a centred phone).

## How to open it

Double-click **`index.html`** — it opens in any web browser. No install needed.

**On an iPhone:** open the page in Safari, then tap **Share → Add to Home
Screen** to keep it as a real full-screen app icon. 💕

## What's inside

Three tabs along the bottom, just like an app:

- **🎂 Birthday** — a little happy-birthday hello with the date.
- **🍽️ Places** — **10 Copenhagen restaurants** (Osteria 16 has three
  locations), each with a **swipeable photo gallery** (swipe left/right, or tap
  the dots) showing the interior vibe *and* a couple of dishes, plus cuisine,
  address, its Google rating, a pescetarian-fit note, and the real bookable
  table times for 2 guests on Friday 2 Oct 2026. Tap the stars to **rate each
  spot out of 5**.
- **🏆 Ranking** — a live **leaderboard** that ranks the places from your
  ratings so your favourite rises to number one. 👑
- Every card has a **"Website & booking"**, **"Map"** and (where available)
  **"Call"** link.
- Ratings are saved in your browser on this device, so they're still there next
  time you open it. Use **"Reset all votes"** on the Ranking tab to start over.

## The restaurants

| Restaurant | Cuisine | Area |
|---|---|---|
| Scarpetta | Italian trattoria | Nørrebro |
| Llama | Latin American | Indre By |
| Restaurant Spuntino | Italian | Vesterbro |
| Olise | Modern bistro & wine | Vesterbro |
| Boutique Emilia | Handmade pasta | Indre By |
| Donna Restaurant | Italian | Indre By |
| Osteria 16 · Haderslevgade | Italian antipasti | Vesterbro |
| Osteria 16 · Ravnsborggade | Italian antipasti | Nørrebro |
| Osteria 16 · Sønder Boulevard | Italian antipasti | Vesterbro |
| Cleo | Modern shared plates | Nørrebro |

## About the times

The times on each card are **real availability for a table of 2 on Friday
2 Oct 2026**, walked through each restaurant's own booking system on 29 Sep
2026 (COFOCO/bordibyen, easyTable, Fresto and Tebi). Slots change fast and no
table was actually booked, so confirm on the "Website & booking" link. A few
notes captured while checking:

- **Scarpetta (Rantzausgade)** – no online tables for 2; call for cancellations.
- **Donna** – dinner almost full (only 21:15); lunch 11:30–14:30 wide open.
- **Osteria 16 · Haderslevgade / Sønder Boulevard** – only 17:00 for 2; rest waitlist.
- **Osteria 16 · Ravnsborggade** – fully booked for 2; waitlist only.
- **Boutique Emilia** – set tasting menu, 2.5h seating, 500 DKK/person card hold.

Interior photos come from each venue's own website or its Google Maps listing
and are shown by reference (hotlinked), so they always reflect the live image.

## Files

- `index.html` — the app shell (nav bar, three tab screens, tab bar)
- `styles.css` — the iOS-style pink styling
- `app.js` — tabs, star voting, leaderboard and confetti
- `data.js` — the restaurant details (edit here to tweak anything)
