import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { emptyEvent, emptyLocation } from "../../shared/model";

const origin = "http://127.0.0.1:5174";
const credentials = { username: "browser-test-organiser", password: "only-a-browser-test-password" };

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill(credentials.username);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  const settingUp = await page.getByLabel("Confirm password", { exact: true }).count();
  if (settingUp) await page.getByLabel("Confirm password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: settingUp ? "Create organiser account" : "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Bring people together.", exact: true })).toBeVisible();
}
async function photo(page: Page, name: string) {
  const content = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640; canvas.height = 400;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#d4dfc9"; ctx.fillRect(0, 0, 640, 400);
    ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(320, 200, 85, 0, Math.PI * 2); ctx.fill();
    return canvas.toDataURL("image/png").split(",")[1];
  });
  return { name, mimeType: "image/png", buffer: Buffer.from(content, "base64") };
}

async function addPlace(page: Page, name: string, mapsUrl: string, images = false) {
  await page.getByRole("button", { name: "Add location", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add a location", exact: true });
  await dialog.getByLabel("Google Maps link", { exact: true }).fill(mapsUrl);
  await dialog.getByLabel("Place name", { exact: true }).fill(name);
  await dialog.getByLabel(/^Address/).fill("Copenhagen, Denmark");
  await dialog.getByLabel(/^Our notes/).fill("Please check the pescetarian options.");
  if (images) {
    await dialog.getByLabel("Upload place photos", { exact: true }).setInputFiles([
      await photo(page, "interior.png"), await photo(page, "plate.png"),
    ]);
    await expect(dialog.locator(".upload-preview")).toHaveCount(2);
  }
  await dialog.getByRole("button", { name: "Save location", exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

async function addPerson(page: Page, name: string) {
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Create invitation", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `An invitation for ${name}`, exact: true });
  const link = await dialog.getByLabel("Personal link", { exact: true }).inputValue();
  await dialog.getByRole("button", { name: "Close dialog", exact: true }).click();
  return link;
}

async function inviteOrganiser(page: Page, name: string) {
  await page.getByRole("button", { name: "Manage organisers", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Create organiser invitation", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `An organiser invitation for ${name}`, exact: true });
  const link = await dialog.getByLabel("Organiser invitation link", { exact: true }).inputValue();
  expect(link).toMatch(/#\/join\/[0-9a-f]{64}$/);
  await dialog.getByRole("button", { name: "Close dialog", exact: true }).click();
  return link;
}

async function activateOrganiser(page: Page, link: string, username: string, password: string) {
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Make this space yours.", exact: true })).toBeVisible();
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Activate account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Bring people together.", exact: true })).toBeVisible();
}

test("invite-only accounts activate privately, isolate their events, and can be suspended and reactivated by the owner", async ({ page, browser }) => {
  await signIn(page);
  const username = `browser-invited-${Date.now()}`;
  const password = "private-browser-invitation-password";
  const ownerTitle = `Owner private event ${Date.now()}`;
  const ownTitle = `Invited organiser event ${Date.now()}`;
  const created = await page.request.post("/api/events", {
    headers: { origin }, data: { ...emptyEvent, title: ownerTitle, date: "2026-11-06" },
  });
  expect(created.status()).toBe(201);
  const ownerEvent = await created.json() as { id: string };
  const context = await browser.newContext({ baseURL: origin });
  let organiserId = "";
  let ownEventId = "";
  try {
    const link = await inviteOrganiser(page, username);
    const organiser = await context.newPage();
    await activateOrganiser(organiser, link, username, password);
    await expect(organiser.getByRole("button", { name: "Manage organisers", exact: true })).toHaveCount(0);
    await expect(organiser.getByRole("button", { name: "Your account", exact: true })).toBeVisible();
    await expect(organiser.getByText(ownerTitle, { exact: true })).toHaveCount(0);
    expect((await organiser.request.get(`/api/events/${ownerEvent.id}`)).status()).toBe(403);
    const session = await (await organiser.request.get("/api/session")).json() as { organiserId: string; organiserRole: string };
    organiserId = session.organiserId;
    expect(session.organiserRole).toBe("organiser");
    const own = await organiser.request.post("/api/events", {
      headers: { origin }, data: { ...emptyEvent, title: ownTitle, date: "2026-11-06" },
    });
    expect(own.status()).toBe(201);
    ownEventId = (await own.json() as { id: string }).id;
    await organiser.reload();
    await expect(organiser.getByRole("heading", { name: ownTitle, exact: true })).toBeVisible();
    expect((await page.request.get(`/api/events/${ownEventId}`)).status()).toBe(403);

    await page.reload();
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: `Suspend ${username}`, exact: true }).click();
    await expect(page.getByRole("button", { name: `Reactivate ${username}`, exact: true })).toBeVisible();
    await organiser.reload();
    await expect(organiser.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    expect((await organiser.request.get("/api/events")).status()).toBe(403);
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: `Reactivate ${username}`, exact: true }).click();
    await expect(page.getByRole("button", { name: `Suspend ${username}`, exact: true })).toBeVisible();
    await organiser.getByLabel("Username", { exact: true }).fill(username);
    await organiser.getByLabel("Password", { exact: true }).fill(password);
    await organiser.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(organiser.getByRole("heading", { name: ownTitle, exact: true })).toBeVisible();
    await expect(organiser.getByText(ownerTitle, { exact: true })).toHaveCount(0);
    await expect(organiser.getByRole("button", { name: "Manage organisers", exact: true })).toHaveCount(0);
  } finally {
    try {
      if (organiserId) {
        const reactivated = await page.request.put(`/api/organisers/${organiserId}`, { headers: { origin }, data: { active: true } });
        expect(reactivated.ok()).toBeTruthy();
      }
      if (ownEventId) {
        await context.request.post("/api/auth/login", { headers: { origin }, data: { username, password } });
        expect((await context.request.delete(`/api/events/${ownEventId}`, { headers: { origin } })).ok()).toBeTruthy();
      }
      expect((await page.request.delete(`/api/events/${ownerEvent.id}`, { headers: { origin } })).ok()).toBeTruthy();
    } finally {
      await context.close();
    }
  }
});

test("invite-only accounts use confirmed, one-use reset links and can change their own password without owner controls", async ({ page, browser }) => {
  await signIn(page);
  const username = `browser-reset-${Date.now()}`;
  const password = "original-browser-account-password";
  const replacement = "replacement-browser-account-password";
  const changed = "changed-browser-account-password";
  const originalContext = await browser.newContext({ baseURL: origin });
  const resetContext = await browser.newContext({ baseURL: origin });
  try {
    const link = await inviteOrganiser(page, username);
    const original = await originalContext.newPage();
    await activateOrganiser(original, link, username, password);
    await page.reload();
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: `Create password reset link for ${username}`, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: `Password reset for ${username}`, exact: true });
    const resetLink = await dialog.getByLabel("Password reset link", { exact: true }).inputValue();
    expect(resetLink).toMatch(/#\/reset\/[0-9a-f]{64}$/);
    await dialog.getByRole("button", { name: "Close dialog", exact: true }).click();

    const reset = await resetContext.newPage();
    await reset.goto(resetLink);
    await expect(reset.getByRole("heading", { name: "Reset your password", exact: true })).toBeVisible();
    await expect(reset.getByText(username, { exact: true })).toBeVisible();
    await reset.getByLabel("New password", { exact: true }).fill(replacement);
    await reset.getByLabel("Confirm password", { exact: true }).fill("a-mismatched-browser-password");
    await reset.getByRole("button", { name: "Reset password", exact: true }).click();
    await expect(reset.getByRole("alert")).toContainText("The passwords don’t match.");
    await reset.getByLabel("Confirm password", { exact: true }).fill(replacement);
    await reset.getByRole("button", { name: "Reset password", exact: true }).click();
    await expect(reset.getByRole("heading", { name: "Bring people together.", exact: true })).toBeVisible();
    await original.reload();
    await expect(original.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await original.goto(resetLink);
    await expect(original.getByRole("alert")).toContainText("This link is invalid or has expired.");
    await expect(original.getByRole("button", { name: "Reset password", exact: true })).toHaveCount(0);
    await reset.getByRole("button", { name: "Your account", exact: true }).click();
    await expect(reset.getByLabel("Username", { exact: true })).toHaveValue(username);
    await reset.getByLabel("Current password", { exact: true }).fill(replacement);
    await reset.getByLabel("New password", { exact: true }).fill(changed);
    await reset.getByLabel("Confirm new password", { exact: true }).fill(changed);
    await reset.getByRole("button", { name: "Change password", exact: true }).click();
    await expect(reset.getByRole("status")).toContainText("Your password has been changed.");
    await reset.getByRole("button", { name: "Your events", exact: true }).click();
    await expect(reset.getByRole("button", { name: "Manage organisers", exact: true })).toHaveCount(0);
    expect((await reset.request.get("/api/organisers")).status()).toBe(403);
    expect((await page.request.get("/api/session")).ok()).toBeTruthy();
  } finally {
    await originalContext.close();
    await resetContext.close();
  }
});

test("local organiser and mobile invitees can create, customise, vote, return, and close an event", async ({ page, browser }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const title = `Browser verification ${Date.now()}`;
  let eventId = "";
  const guestContexts: BrowserContext[] = [];
  try {
    await signIn(page);
    await page.getByRole("button", { name: "Create event", exact: true }).click();
    const form = page.getByRole("dialog", { name: "Make a plan", exact: true });
    await form.getByLabel("Event name", { exact: true }).fill(title);
    await form.getByLabel("A little introduction", { exact: true }).fill("A local browser test. This event is removed when the test finishes.");
    await form.getByLabel(/^Date/).fill("2026-11-06");
    await form.getByLabel("City", { exact: true }).fill("Copenhagen");
    await form.getByRole("button", { name: /Just us/ }).click();
    await form.getByLabel("Personal greeting", { exact: true }).fill("An evening for us");
    await form.getByRole("button", { name: /Rosé/ }).click();
    await form.getByLabel("Upload cover photo", { exact: true }).setInputFiles(await photo(page, "cover.png"));
    await expect(form.locator(".upload-preview")).toHaveCount(1);
    await form.getByRole("button", { name: "Create event", exact: true }).click();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    eventId = page.url().split("/event/")[1];
    await addPlace(page, "Scarpetta — Rantzausgade", "https://maps.google.com/?q=Scarpetta,Rantzausgade+7,Copenhagen", true);
    await addPlace(page, "Llama", "https://www.google.com/maps/place/Llama/");
    await page.getByRole("button", { name: /^People/ }).click();
    const alexLink = await addPerson(page, "Alex");
    const jamieLink = await addPerson(page, "Jamie");

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: /After hours/ }).click();
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByText("Event details and theme saved.", { exact: true })).toBeVisible();
    await expect(page.locator(".themed-event")).toHaveCSS("background-color", "rgb(28, 37, 34)");
    await page.getByRole("button", { name: "Open voting", exact: true }).click();
    await expect(page.getByText("Voting open", { exact: true })).toBeVisible();

    const alexContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    guestContexts.push(alexContext);
    const alex = await alexContext.newPage();
    alex.on("pageerror", (error) => errors.push(error.message));
    await alex.goto(alexLink);
    await expect(alex.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(alex.getByText(/Hi Alex/)).toBeVisible();
    await expect(alex.locator(".event-meta").getByText("Copenhagen", { exact: true })).toBeVisible();
    await expect(alex.getByText("An evening for us", { exact: true })).toBeVisible();
    await expect(alex.locator(".mood-decoration-romantic")).toBeVisible();
    await expect(alex.locator(".event-cover img")).toBeVisible();
    await expect.poll(() => alex.locator(".event-cover img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await expect(alex.locator(".themed-event")).toHaveClass(/mood-romantic/);
    await expect(alex.getByRole("button", { name: "Settings", exact: true })).toHaveCount(0);
    const firstCard = alex.locator(".place-card").first();
    await firstCard.scrollIntoViewIfNeeded();
    await expect(firstCard.locator("img").first()).toBeVisible();
    await expect.poll(() => firstCard.locator("img").first().evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await firstCard.getByRole("button", { name: "Show photo 2", exact: true }).click();
    await expect(firstCard.getByRole("button", { name: "Show photo 2", exact: true })).toHaveAttribute("aria-pressed", "true");
    await alex.getByRole("button", { name: "Scarpetta — Rantzausgade: 5 out of 5", exact: true }).click();
    await expect(firstCard.getByText("Saved", { exact: true })).toBeVisible();
    await alex.getByRole("button", { name: "Llama: 3 out of 5", exact: true }).click();
    await expect(alex.getByText("You’re all rated. Nice one.", { exact: false })).toBeVisible();
    expect(await alex.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await alexContext.setOffline(true);
    await alex.getByRole("button", { name: "Scarpetta — Rantzausgade: 1 out of 5", exact: true }).click();
    await expect(alex.getByRole("alert").filter({ hasText: "Cannot reach the planner" }).first()).toBeVisible();
    await expect(alex.getByRole("button", { name: /Scarpetta.*5 out of 5/ })).toHaveAttribute("aria-pressed", "true");
    await alexContext.setOffline(false);
    await alex.reload();
    await expect(alex.getByRole("button", { name: /Scarpetta.*5 out of 5/ })).toHaveAttribute("aria-pressed", "true");
    const secondDevice = await browser.newContext({ viewport: { width: 390, height: 844 } });
    guestContexts.push(secondDevice);
    const returningAlex = await secondDevice.newPage();
    await returningAlex.goto(alexLink);
    await expect(returningAlex.getByRole("button", { name: /Scarpetta.*5 out of 5/ })).toHaveAttribute("aria-pressed", "true");

    const jamieContext = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
    guestContexts.push(jamieContext);
    const jamie = await jamieContext.newPage();
    await jamie.goto(jamieLink);
    await expect(jamie.getByText(/Hi Jamie/)).toBeVisible();
    await jamie.getByRole("button", { name: "Scarpetta — Rantzausgade: 4 out of 5", exact: true }).click();
    await expect(jamie.locator(".place-card").first().getByText("Saved", { exact: true })).toBeVisible();
    await jamie.getByRole("button", { name: "Ranking", exact: true }).click();
    const winningRow = jamie.locator(".ranking-row").filter({ hasText: "Scarpetta" });
    await expect(winningRow.locator(".rank-score strong")).toHaveText("4.5");
    await expect(winningRow.getByText(/2 ratings/)).toBeVisible();
    expect(await jamie.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.getByRole("button", { name: /Sunday/ }).click();
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.locator(".themed-event")).toHaveCSS("background-color", "rgb(248, 244, 235)");
    await page.getByRole("button", { name: "Places", exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath("organiser-desktop.png"), animations: "disabled" });
    await alex.reload();
    await expect(alex.getByRole("button", { name: /Scarpetta.*5 out of 5/ })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => alex.locator(".event-cover img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await alex.screenshot({ path: testInfo.outputPath("guest-mobile.png"), animations: "disabled" });

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Close voting", exact: true }).click();
    await expect(page.getByText("Voting closed", { exact: true })).toBeVisible();
    await alex.reload();
    await expect(alex.getByRole("button", { name: /Scarpetta.*5 out of 5/ })).toBeDisabled();
    await alex.getByRole("button", { name: "Ranking", exact: true }).click();
    await expect(alex.getByText("Final results", { exact: true })).toBeVisible();
    await expect(alex.locator(".event-meta").getByText("Copenhagen", { exact: true })).toBeVisible();
    await expect(alex.locator(".ranking-row").filter({ hasText: "Scarpetta" }).locator(".rank-score strong")).toHaveText("4.5");
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(guestContexts.map((context) => context.close()));
    if (eventId) {
      const response = await page.request.delete(`/api/events/${eventId}`, { headers: { origin } });
      expect(response.ok()).toBeTruthy();
    }
  }
});

test("sign-in recovery help is spaced below the button and centred on desktop and phones", async ({ page }) => {
  await page.route("**/api/session", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ role: null, setupRequired: false }),
  }));
  await page.goto("/");
  const button = page.getByRole("button", { name: "Sign in", exact: true });
  const help = page.getByText("Ask the person who invited you for a password reset link.", { exact: true });
  for (const width of [1440, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(button).toBeVisible();
    await expect(help).toBeVisible();
    await expect(help).toHaveCSS("text-align", "center");
    const buttonBounds = await button.boundingBox();
    const helpBounds = await help.boundingBox();
    expect(helpBounds!.y - (buttonBounds!.y + buttonBounds!.height)).toBeGreaterThanOrEqual(12);
    expect(helpBounds!.x).toBeGreaterThanOrEqual(buttonBounds!.x - 1);
    expect(helpBounds!.x + helpBounds!.width).toBeLessThanOrEqual(buttonBounds!.x + buttonBounds!.width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("welcome and organiser dashboard fit a small phone without horizontal scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /A little less/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Bring people together.", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Create event", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Make a plan", exact: true })).toBeVisible();
  expect(await page.getByRole("dialog").locator('input[type="date"]').evaluate((input: HTMLInputElement) => input.required)).toBe(true);
  await expect(page.getByRole("dialog").getByText("optional", { exact: true })).toHaveCount(0);
  const date = await page.getByRole("dialog").getByLabel("Date", { exact: true }).boundingBox();
  const occasion = await page.getByRole("dialog").getByLabel("Occasion", { exact: true }).boundingBox();
  expect(Math.abs(date!.y - occasion!.y)).toBeLessThan(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("mood previews are distinct and a pasted Maps link prefills the place without technical copy", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Create event", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Make a plan", exact: true });
  await dialog.getByLabel("Event name", { exact: true }).fill("Maps import browser verification");
  await dialog.getByLabel("Date", { exact: true }).fill("2026-11-06");
  for (const [button, mood] of [["Just us", "romantic"], ["Birthday", "birthday"], ["Good company", "friends"], ["Keep it simple", "minimal"]]) {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await dialog.getByRole("button", { name: new RegExp(`^${button}`) }).click();
    await expect(dialog.locator(".mood-sample")).toHaveClass(new RegExp(`mood-${mood}`));
    await expect(dialog.locator(".mood-sample .mood-decoration")).toHaveCount(mood === "minimal" ? 0 : 1);
    if (mood !== "minimal") {
      const decoration = dialog.locator(".mood-decoration > span").first();
      await expect(decoration).toHaveCSS("animation-name", mood === "friends" ? "none" : "mood-float");
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(decoration).toHaveCSS("animation-name", "none");
      await expect(decoration.locator("svg")).toBeVisible();
      expect(await decoration.evaluate((element) => element.getAnimations().length)).toBe(0);
    }
  }
  await dialog.getByRole("button", { name: "Create event", exact: true }).click();
  await page.getByRole("button", { name: "Add location", exact: true }).waitFor();
  const eventId = page.url().split("/event/")[1];
  try {
    await page.getByRole("button", { name: "Add location", exact: true }).click();
    const location = page.getByRole("dialog", { name: "Add a location", exact: true });
    await location.getByLabel("Google Maps link", { exact: true }).fill("https://maps.google.com/?q=Scarpetta,+Rantzausgade+7,+Copenhagen");
    await location.getByRole("button", { name: "Find place", exact: true }).click();
    await expect(location.getByLabel("Place name", { exact: true })).toHaveValue("Scarpetta");
    await expect(location.getByLabel("Address", { exact: true })).toHaveValue("Rantzausgade 7, Copenhagen");
    await expect(location.getByText(/Google API|optional|Sharing links work too/)).toHaveCount(0);
    await location.getByRole("button", { name: "Save location", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Scarpetta", exact: true })).toBeVisible();
  } finally {
    const response = await page.request.delete(`/api/events/${eventId}`, { headers: { origin } });
    expect(response.ok()).toBeTruthy();
  }
});

test("birthday decorations stay static with reduced motion, survive polling, and respect the saved toggle", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page);
  const title = `Birthday decorations ${Date.now()}`;
  const created = await page.request.post("/api/events", {
    headers: { origin },
    data: { ...emptyEvent, title, date: "2026-11-06", occasion: "Birthday", mood: "birthday", decorations: true },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json() as { id: string };
  try {
    await page.goto(`/#/event/${id}`);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    const decorations = page.locator(".event-intro .mood-decoration-birthday");
    await expect(decorations.locator("span")).toHaveCount(5);
    await expect(decorations.locator("span").first()).toHaveCSS("animation-name", "none");
    const original = await decorations.elementHandle();
    await page.waitForResponse((response) => new URL(response.url()).pathname === `/api/events/${id}`
      && response.request().method() === "GET" && response.status() === 200);
    expect(await original!.evaluate((element) => element.isConnected)).toBe(true);
    await expect(decorations.locator("span svg")).toHaveCount(5);
    await page.reload();
    await expect(decorations).toBeVisible();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("Decorative touches", { exact: true }).uncheck();
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(decorations).toHaveCount(0);
    await page.reload();
    await expect(page.locator(".themed-event")).toHaveClass(/mood-birthday/);
    await expect(decorations).toHaveCount(0);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByLabel("Decorative touches", { exact: true })).not.toBeChecked();
    await page.getByLabel("Decorative touches", { exact: true }).check();
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await page.reload();
    await expect(decorations).toBeVisible();
    await expect(decorations.locator("span").first()).toHaveCSS("animation-name", "none");
  } finally {
    const response = await page.request.delete(`/api/events/${id}`, { headers: { origin } });
    expect(response.ok()).toBeTruthy();
  }
});

test("venue lookup previews website details and only imports explicitly selected, permitted photos", async ({ page }, testInfo) => {
  await signIn(page);
  await page.getByRole("button", { name: "Create event", exact: true }).click();
  const eventForm = page.getByRole("dialog", { name: "Make a plan", exact: true });
  await eventForm.getByLabel("Event name", { exact: true }).fill("Venue import verification");
  await eventForm.getByLabel("Date", { exact: true }).fill("2026-11-06");
  await eventForm.getByLabel("City", { exact: true }).fill("Copenhagen");
  await eventForm.getByRole("button", { name: "Create event", exact: true }).click();
  await page.getByRole("button", { name: "Add location", exact: true }).waitFor();
  const credits = page.locator(".data-credits");
  await expect(credits.locator("a")).not.toBeVisible();
  expect(await page.locator("main").innerText()).not.toMatch(/TomTom|Tavily/);
  await credits.locator("summary").click();
  await expect(page.getByRole("link", { name: /TomTom/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /TomTom/ })).toHaveAttribute("href", "https://www.tomtom.com/en-gb/legal/");
  await credits.locator("summary").click();
  const eventId = page.url().split("/event/")[1];
  try {
    await page.getByRole("button", { name: "Add location", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add a location", exact: true });
    await expect(dialog.getByText("Place lookup:", { exact: false })).toHaveCount(0);
    await expect(dialog.getByRole("link", { name: /OpenStreetMap contributors/ })).toHaveCount(0);
    await dialog.getByLabel("Google Maps link", { exact: true }).fill("https://www.google.com/maps/place/Harbour+Kitchen/");
    await expect(dialog.getByLabel("Search area", { exact: true })).not.toBeVisible();
    await expect(dialog.getByLabel("Search area", { exact: true })).toHaveValue("Copenhagen");
    // The provider interval is shared with the preceding browser tests.
    await page.waitForTimeout(1200);
    const [inheritedSearch] = await Promise.all([
      page.waitForRequest((request) => request.url().endsWith("/api/places/search") && request.method() === "POST"),
      dialog.getByRole("button", { name: "Find place", exact: true }).click(),
    ]);
    expect(inheritedSearch.postDataJSON().area).toBe("Copenhagen");
    await expect(dialog.getByRole("region", { name: "Matching places" })).toBeVisible();
    await dialog.getByRole("button", { name: "Use this place", exact: true }).click();
    const preview = dialog.getByRole("region", { name: "Website import preview" });
    await expect(preview).toBeVisible();
    await expect(dialog.getByLabel("Venue website", { exact: true })).toHaveValue("https://venue.example.org/");
    const selectedPhoto = preview.getByRole("checkbox", { name: "Use suggested photo 1", exact: true });
    await expect(selectedPhoto).not.toBeChecked();
    await expect.poll(() => preview.locator(".suggested-photo img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await preview.screenshot({ path: testInfo.outputPath("import-preview.png"), animations: "disabled" });
    await selectedPhoto.check();
    await expect(preview.getByRole("button", { name: "Use selected details", exact: true })).toBeDisabled();
    await preview.getByRole("checkbox", { name: "I have permission to use these photos.", exact: true }).check();
    await preview.getByRole("button", { name: "Use selected details", exact: true }).click();
    await expect(preview).not.toBeVisible();
    await expect(dialog.getByLabel("About the place", { exact: true })).toHaveValue("Fresh fish, seasonal vegetables, and a relaxed room.");
    await expect(dialog.getByLabel("Menu link", { exact: true })).toHaveValue("https://venue.example.org/dinner");
    await expect(dialog.locator(".upload-preview")).toHaveCount(1);
    await dialog.getByRole("button", { name: "Save location", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Harbour Kitchen", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("link", { name: "Venue website", exact: true })).toHaveAttribute("href", "https://venue.example.org/");
    await expect(page.getByRole("link", { name: "Place data", exact: true })).toHaveCount(0);
    await expect(page.locator(".data-credits a")).not.toBeVisible();
    await expect(page.locator('a[href="https://www.openstreetmap.org/copyright"]')).toHaveCount(0);
    await expect.poll(() => page.locator(".place-card img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("City", { exact: true }).fill("Aarhus");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByText("Event details and theme saved.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Places", exact: true }).click();
    await page.getByRole("button", { name: "Add location", exact: true }).click();
    const manual = page.getByRole("dialog", { name: "Add a location", exact: true });
    await expect(manual.getByLabel("Search area", { exact: true })).not.toBeVisible();
    await expect(manual.getByLabel("Search area", { exact: true })).toHaveValue("Aarhus");
    await manual.getByLabel("Google Maps link", { exact: true }).fill("https://www.google.com/maps/place/Another+Branch/");
    await manual.getByLabel("Place name", { exact: true }).fill("My chosen branch");
    await manual.getByLabel("Address", { exact: true }).fill("Another Street 12");
    await manual.getByText("Change search area", { exact: true }).click();
    await manual.getByLabel("Search area", { exact: true }).fill("Odense");
    await page.waitForTimeout(1200);
    const [overriddenSearch] = await Promise.all([
      page.waitForRequest((request) => request.url().endsWith("/api/places/search") && request.method() === "POST"),
      manual.getByRole("button", { name: "Find place", exact: true }).click(),
    ]);
    expect(overriddenSearch.postDataJSON().area).toBe("Odense");
    await expect(manual.getByRole("region", { name: "Matching places" }).getByText("No matching places", { exact: true })).toBeVisible();
    await expect(manual.getByRole("button", { name: "Find place", exact: true })).toBeEnabled();
    await manual.getByLabel("About the place", { exact: true }).fill("Keep my own description.");
    await manual.getByLabel("Venue website", { exact: true }).fill("https://venue.example.org/");
    await manual.getByRole("button", { name: "Read website", exact: true }).click();
    await expect(manual.getByRole("region", { name: "Website import preview" })).toBeVisible();
    await manual.getByRole("button", { name: "Use selected details", exact: true }).click();
    await expect(manual.getByLabel("Place name", { exact: true })).toHaveValue("My chosen branch");
    await expect(manual.getByLabel("Address", { exact: true })).toHaveValue("Another Street 12");
    await expect(manual.getByLabel("About the place", { exact: true })).toHaveValue("Keep my own description.");
  } finally {
    const response = await page.request.delete(`/api/events/${eventId}`, { headers: { origin } });
    expect(response.ok()).toBeTruthy();
  }
});

test("a moved venue website offers domain-first suggestions and requires explicit review", async ({ page }) => {
  await signIn(page);
  const created = await page.request.post("/api/events", {
    headers: { origin },
    data: { ...emptyEvent, title: "Website recovery verification", date: "2026-11-06", city: "Copenhagen" },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json() as { id: string };
  let suggestedReads = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/places/website")
      && request.postDataJSON()?.url === "https://venue.example.org/recovered") suggestedReads++;
  });
  try {
    await page.goto(`/#/event/${id}`);
    await page.getByRole("button", { name: "Add location", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add a location", exact: true });
    await dialog.getByLabel("Google Maps link", { exact: true }).fill("https://www.google.com/maps/place/Recovery+Kitchen/");
    await dialog.getByLabel("About the place", { exact: true }).fill("Keep my handwritten description.");
    await dialog.getByLabel("Our notes", { exact: true }).fill("Please keep these personal notes.");
    await dialog.getByRole("button", { name: "Find place", exact: true }).click();
    await expect(dialog.getByRole("region", { name: "Matching places" })).toBeVisible();
    const [lookup] = await Promise.all([
      page.waitForRequest((request) => request.url().endsWith("/api/places/websites") && request.method() === "POST"),
      dialog.getByRole("button", { name: "Use this place", exact: true }).click(),
    ]);
    expect(lookup.postDataJSON().name).toBe("Recovery Kitchen");
    expect(lookup.postDataJSON().websiteUrl).toBe("https://venue.example.org/obsolete");
    const suggestions = dialog.getByRole("region", { name: "Website suggestions" });
    await expect(suggestions).toBeVisible();
    await expect(suggestions).toContainText("venue.example.org");
    await expect(suggestions.getByText("A different venue abroad", { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("alert").filter({ hasText: "404" })).toBeVisible();
    await expect(dialog.getByLabel("Venue website", { exact: true })).toHaveValue("https://venue.example.org/obsolete");
    expect(suggestedReads).toBe(0);
    await expect(dialog.getByRole("region", { name: "Website import preview" })).toHaveCount(0);
    await page.waitForTimeout(1200);
    const [broader] = await Promise.all([
      page.waitForRequest((request) => request.url().endsWith("/api/places/websites") && request.method() === "POST"),
      suggestions.getByRole("button", { name: "Search more widely", exact: true }).click(),
    ]);
    expect(broader.postDataJSON().broader).toBe(true);
    await expect(suggestions.getByText("A different venue abroad", { exact: true })).toBeVisible();
    expect(suggestedReads).toBe(0);
    await expect(dialog.getByLabel("Venue website", { exact: true })).toHaveValue("https://venue.example.org/obsolete");
    await suggestions.locator(".venue-candidate").filter({ hasText: "Recovery Kitchen - official venue" })
      .getByRole("button", { name: "Read this website", exact: true }).click();
    const preview = dialog.getByRole("region", { name: "Website import preview" });
    await expect(preview).toBeVisible();
    expect(suggestedReads).toBe(1);
    await expect(dialog.getByLabel("Venue website", { exact: true })).toHaveValue("https://venue.example.org/recovered");
    await expect(preview.getByRole("checkbox", { name: "Use suggested photo 1", exact: true })).not.toBeChecked();
    await preview.getByRole("button", { name: "Use selected details", exact: true }).click();
    await expect(dialog.getByLabel("About the place", { exact: true })).toHaveValue("Keep my handwritten description.");
    await expect(dialog.getByLabel("Our notes", { exact: true })).toHaveValue("Please keep these personal notes.");
    await expect(dialog.locator(".upload-preview")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Save location", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Recovery Kitchen", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("link", { name: "Venue website", exact: true }))
      .toHaveAttribute("href", "https://venue.example.org/recovered");
    await expect(page.getByText("Keep my handwritten description.", { exact: true })).toBeVisible();
    const legacy = await page.request.post(`/api/events/${id}/locations`, {
      headers: { origin },
      data: { ...emptyLocation, name: "Legacy venue", mapsUrl: "https://www.google.com/maps/place/Legacy/",
        osmUrl: "https://www.openstreetmap.org/node/12345" },
    });

    expect(legacy.status()).toBe(201);
    await page.reload();
    await expect(page.locator(".data-credits a").first()).not.toBeVisible();
    await page.locator(".data-credits summary").click();
    await expect(page.getByRole("link", { name: /TomTom/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "OpenStreetMap contributors", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Place data", exact: true })).toHaveCount(0);
  } finally {
    const response = await page.request.delete(`/api/events/${id}`, { headers: { origin } });
    expect(response.ok()).toBeTruthy();
  }
});

test("website search exhaustion stays explicit and manual venue entry still works", async ({ page }) => {
  await signIn(page);
  const created = await page.request.post("/api/events", {
    headers: { origin },
    data: { ...emptyEvent, title: "Manual recovery verification", date: "2026-11-06" },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json() as { id: string };
  try {
    await page.route("**/api/places/websites", (route) => route.fulfill({
      status: 429, contentType: "application/json", body: JSON.stringify({ error: "Website search budget reached. Add a website manually." }),
    }));
    await page.goto(`/#/event/${id}`);
    await page.getByRole("button", { name: "Add location", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add a location", exact: true });
    await dialog.getByLabel("Google Maps link", { exact: true }).fill("https://www.google.com/maps/place/My+manual+venue/");
    await dialog.getByLabel("Place name", { exact: true }).fill("My manual venue");
    await dialog.getByLabel("Our notes", { exact: true }).fill("Do not lose this note.");
    await dialog.getByRole("button", { name: "Find website", exact: true }).click();
    await expect(dialog.getByRole("alert").filter({ hasText: "Website search budget reached" })).toBeVisible();
    await dialog.getByLabel("Venue website", { exact: true }).fill("https://venue.example.org/");
    await expect(dialog.getByRole("region", { name: "Website suggestions" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Save location", exact: true }).click();
    await expect(page.getByRole("heading", { name: "My manual venue", exact: true })).toBeVisible();
    await expect(page.getByText("Do not lose this note.", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Venue website", exact: true })).toHaveAttribute("href", "https://venue.example.org/");
  } finally {
    const response = await page.request.delete(`/api/events/${id}`, { headers: { origin } });
    expect(response.ok()).toBeTruthy();
  }
});
