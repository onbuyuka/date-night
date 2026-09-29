// Birthday date-night app: renders places, handles 5-star voting, keeps a live
// leaderboard, and switches between the Birthday / Places / Ranking tabs like a
// little iOS app. Votes are saved in the browser (localStorage).

const STORAGE_KEY = "cph-date-night-votes-v1";

function loadVotes() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}
function saveVotes(v) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
}

let votes = loadVotes();

function setVote(id, value) {
  votes[id] = value;
  saveVotes(votes);
  renderStars(id);
  renderLeaderboard();
}
function clearVote(id) {
  delete votes[id];
  saveVotes(votes);
  renderStars(id);
  renderLeaderboard();
}

function starsMarkup(id) {
  const current = votes[id] || 0;
  let html = "";
  for (let i = 1; i <= 5; i++) {
    html += `<button class="star ${i <= current ? "filled" : ""}" data-id="${id}" data-value="${i}" aria-label="${i} star${i > 1 ? "s" : ""}">★</button>`;
  }
  return html;
}

function renderStars(id) {
  const container = document.querySelector(`.stars[data-for="${id}"]`);
  if (container) container.innerHTML = starsMarkup(id);
}

function renderCards() {
  const grid = document.getElementById("grid");
  grid.innerHTML = RESTAURANTS.map((r) => {
    const slots = r.friday.slots.length
      ? r.friday.slots.map((s) => `<span class="slot">${s}</span>`).join("")
      : `<span class="slot none">None online</span>`;
    const gmaps = r.rating
      ? `<a class="g-rating" href="${r.maps}" target="_blank" rel="noopener" aria-label="Google rating ${r.rating} out of 5 from ${r.reviews} reviews">
           <span class="g-logo">G</span>
           <span class="g-stars" style="--pct:${(r.rating / 5) * 100}%">★★★★★</span>
           <b>${r.rating.toFixed(1)}</b>
           <span class="g-count">(${r.reviews.toLocaleString("en-US")})</span>
         </a>`
      : "";
    const pesc = r.pesc
      ? `<div class="pesc-note"><b>For us:</b> ${r.pesc.note}</div>`
      : "";
    const imgs = (r.imgs && r.imgs.length ? r.imgs : [r.img]).filter(Boolean);
    const slides = imgs
      .map(
        (u, i) =>
          `<img class="slide" src="${u}" alt="${r.name} ${i === 0 ? "interior" : "dish"}" loading="lazy" referrerpolicy="no-referrer" draggable="false" />`
      )
      .join("");
    const dots =
      imgs.length > 1
        ? `<div class="dots">${imgs
            .map((_, i) => `<span class="dot ${i === 0 ? "on" : ""}"></span>`)
            .join("")}</div>`
        : "";
    return `
      <article class="card">
        <div class="gallery" data-gallery>
          <div class="gallery-track">${slides}</div>
          <span class="area-tag">${r.area}</span>
          ${dots}
        </div>
        <div class="card-body">
          <h3>${r.name}</h3>
          <p class="meta">${r.address}</p>
          ${gmaps}
          <span class="cuisine">${r.cuisine}</span>
          ${pesc}
          <p class="blurb">${r.blurb}</p>

          <div class="times">
            <div class="label">Available to book</div>
            <div class="slots">${slots}</div>
          </div>

          <div class="links">
            <a href="${r.menuUrl || r.website}" target="_blank" rel="noopener">Menu</a>
            <a href="${r.maps}" target="_blank" rel="noopener">Map</a>
          </div>

          <div class="rating">
            <div class="label">Rate this spot</div>
            <div class="stars" data-for="${r.id}">${starsMarkup(r.id)}</div>
          </div>
        </div>
      </article>`;
  }).join("");

  RESTAURANTS.forEach((r) => renderStars(r.id));
  initGalleries();
}

// Swipe galleries: update dots on scroll, let dots scroll to a slide.
function initGalleries() {
  document.querySelectorAll("[data-gallery]").forEach((gal) => {
    const track = gal.querySelector(".gallery-track");
    const dots = [...gal.querySelectorAll(".dot")];
    if (!track || dots.length === 0) return;
    let raf = null;
    track.addEventListener("scroll", () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const i = Math.round(track.scrollLeft / track.clientWidth);
        dots.forEach((d, di) => d.classList.toggle("on", di === i));
      });
    });
    dots.forEach((d, di) => {
      d.addEventListener("click", () => {
        track.scrollTo({ left: di * track.clientWidth, behavior: "smooth" });
      });
    });
  });
}

function renderLeaderboard() {
  const board = document.getElementById("leaderboard");
  const rated = RESTAURANTS.filter((r) => votes[r.id])
    .map((r) => ({ ...r, score: votes[r.id] }))
    .sort((a, b) => b.score - a.score);

  if (rated.length === 0) {
    board.innerHTML = `<div class="lb-empty">No ratings yet 🌸<br />Head to <b>Places</b> and tap some stars — your ranking blooms here. 💕</div>`;
    return;
  }

  board.innerHTML = rated
    .map((r, i) => {
      const isTop = i === 0;
      const starRow = "★".repeat(r.score) + "☆".repeat(5 - r.score);
      return `
        <div class="lb-row ${isTop ? "top" : ""}">
          <div class="lb-rank">${isTop ? "👑" : i + 1}</div>
          <div class="lb-name">
            ${r.name}
            <small>${r.cuisine} · ${r.area}</small>
          </div>
          <div class="lb-score">
            <span style="color:var(--pink-deep)">${starRow}</span>
            <span class="num">${r.score.toFixed(0)}</span><span class="of">/5</span>
          </div>
        </div>`;
    })
    .join("");
}

// ───────── Tab navigation ─────────
const TITLES = { birthday: "Happy Birthday", places: "Places", ranking: "Leaderboard" };

function showTab(name) {
  document.querySelectorAll(".screen").forEach((s) =>
    s.classList.toggle("active", s.id === "screen-" + name)
  );
  document.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.tab === name)
  );
  const titleEl = document.querySelector(".nav-title");
  if (titleEl) titleEl.textContent = TITLES[name];
  window.scrollTo(0, 0);
  if (name === "ranking") renderLeaderboard();
  if (name === "birthday") burstConfetti();
}

// ───────── Confetti ─────────
let confettiRunning = false;
function burstConfetti() {
  if (confettiRunning) return;
  confettiRunning = true;
  const emojis = ["🎉", "🎊", "💗", "🌸", "✨", "💞", "🎈"];
  const n = 26;
  for (let i = 0; i < n; i++) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    piece.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    piece.style.left = Math.random() * 100 + "vw";
    piece.style.fontSize = 14 + Math.random() * 16 + "px";
    piece.style.animationDuration = 2.4 + Math.random() * 2.2 + "s";
    piece.style.animationDelay = Math.random() * 0.6 + "s";
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 5200);
  }
  setTimeout(() => (confettiRunning = false), 1200);
}

// ───────── Events ─────────
document.addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (tab) { showTab(tab.dataset.tab); return; }

  const goto = e.target.closest("[data-goto]");
  if (goto) { showTab(goto.dataset.goto); return; }

  const star = e.target.closest(".star");
  if (star) { setVote(star.dataset.id, Number(star.dataset.value)); return; }

  const clear = e.target.closest("[data-clear]");
  if (clear) { clearVote(clear.dataset.clear); return; }

  if (e.target.id === "reset-all") {
    if (confirm("Clear all your ratings?")) {
      votes = {};
      saveVotes(votes);
      RESTAURANTS.forEach((r) => renderStars(r.id));
      renderLeaderboard();
    }
  }
});

// ───────── Init ─────────
renderCards();
renderLeaderboard();
showTab("birthday");
