import { useCallback, useEffect, useState } from "react";
import type { EventDetail, EventInput, EventLocation, PlannerEvent } from "../shared/model";
import { api, invitationLink, message, navigate } from "./api";
import { EventForm, LocationForm } from "./forms";
import { formatDate, themeStyle, themes } from "./themes";
import { Brand, ErrorBox, Form, Gallery, Icon, Loading, Modal, useTask, type IconName } from "./ui";
import { moods, MoodDetails } from "./moods";

type Tab = "places" | "ranking" | "people" | "settings";
const tabIcons: Record<Tab, IconName> = { places: "pin", ranking: "trophy", people: "users", settings: "settings" };
const tabLabels: Record<Tab, string> = { places: "Places", ranking: "Ranking", people: "People", settings: "Settings" };

export function EventPage({ id, hasOrganiserSession, onSessionChange }: {
  id: string; hasOrganiserSession: boolean; onSessionChange: () => Promise<void>;
}) {
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [error, setError] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const [tab, setTab] = useState<Tab>("places");
  const [locationEditor, setLocationEditor] = useState<EventLocation | "new" | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [voteError, setVoteError] = useState("");
  const [invitation, setInvitation] = useState<{ name: string; link: string } | null>(null);
  const [notice, setNotice] = useState("");
  const actions = useTask();

  const refresh = useCallback(async () => {
    const next = await api<EventDetail>(`/events/${id}`);
    setDetail(next);
    setRefreshError("");
  }, [id]);
  useEffect(() => {
    let active = true;
    async function load(initial: boolean) {
      try {
        const next = await api<EventDetail>(`/events/${id}`);
        if (active) { setDetail(next); setError(""); setRefreshError(""); }
      } catch (error) {
        if (active) {
          if (initial) setError(message(error));
          else setRefreshError(message(error));
        }
      }
    }
    void load(true);
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void load(false); }, 8000);
    return () => { active = false; window.clearInterval(interval); };
  }, [id]);

  async function rate(locationId: string, score: number | null) {
    if (savingId) return;
    setSavingId(locationId);
    setVoteError("");
    setSavedId(null);
    try {
      await api(`/events/${id}/ratings/${locationId}`, "PUT", { score });
      await refresh();
      setSavedId(locationId);
    } catch (error) { setVoteError(message(error)); }
    finally { setSavingId(null); }
  }
  async function changeStatus(status: PlannerEvent["status"]) {
    if (!detail) return;
    if (status === "closed" && !window.confirm("Close voting? Everyone can still view the final results, but ratings will be locked.")) return;
    await actions.run(async () => {
      await api(`/events/${id}`, "PUT", eventInput({ ...detail.event, status }));
      await refresh();
      setNotice(status === "open" ? "Voting is open. Personal invitations are ready to use." : "Voting closed. These are the final results.");
    });
  }
  async function copy(text: string, success: string) {
    await actions.run(async () => {
      if (!navigator.clipboard) throw new Error("Clipboard access isn't available. Select and copy the link in the invitation box.");
      await navigator.clipboard.writeText(text);
      setNotice(success);
    });
  }

  if (error) return <div className="page narrow"><Brand /><ErrorBox>{error}</ErrorBox>
    <p className="muted">Open the personal link sent by your organiser, or return to your workspace.</p>
    <button className="button" onClick={() => navigate("/")}>Back to workspace</button></div>;
  if (!detail) return <Loading text="Opening your event…" />;

  const { event, locations, myRatings, viewer } = detail;
  const admin = viewer.role === "admin";
  const voted = Object.keys(myRatings).length;
  const tabs: Tab[] = admin ? ["places", "ranking", "people", "settings"] : ["places", "ranking"];
  const closed = event.status !== "open";

  return <div className={`app themed-event mood-${event.mood}`} style={themeStyle(event.theme, event.accent)}>
    <header className="topbar">
      <div className="topbar-inner account-topbar">
        {admin ? <button className="back-button" onClick={() => navigate("/")}><Icon name="back" size={18} /><span>All events</span></button> : <Brand />}
        <div className="topbar-end account-navigation">
          {!admin && hasOrganiserSession && <button className="back-button" onClick={() => navigate("/")}>Your events</button>}
          {hasOrganiserSession && <button className="button small" onClick={() => navigate("/account")}>Your account</button>}
          <span className={`status status-${event.status}`}><i />{event.status === "open" ? "Voting open" : event.status === "closed" ? "Voting closed" : "Draft"}</span>
          {admin && <span className="organiser-badge">Organiser</span>}
        </div>
      </div>
    </header>
    <main className="event-layout">
      <section className="event-intro">
        <MoodDetails mood={event.mood} decorations={event.decorations} />
        {(event.greeting || moods[event.mood].greeting) && <p className="personal-greeting">{event.greeting || moods[event.mood].greeting}</p>}
        <div className="event-eyebrow"><span>{event.occasion}</span><span className="dot-separator">·</span><Icon name="calendar" size={15} /><span>{formatDate(event.date)}</span></div>
        <h1>{event.title}</h1>
        {event.description && <p className="event-description">{event.description}</p>}
        <div className="event-meta">{event.city && <span><Icon name="pin" size={16} />{event.city}</span>}
          <span><Icon name="pin" size={16} />{locations.length} {locations.length === 1 ? "place" : "places"}</span>
          <span><Icon name="users" size={16} />{detail.participantCount} {detail.participantCount === 1 ? "person" : "people"}</span>
          <span>{detail.completedCount} finished rating</span></div>
        {event.coverUrl && <div className="event-cover"><Gallery name={event.title} urls={[event.coverUrl]} /></div>}
        {admin && <div className="event-admin-actions">
          {event.status !== "open" ? <button className="button primary" disabled={actions.busy || !locations.length || !detail.participantCount}
            onClick={() => void changeStatus("open")}><Icon name="check" size={17} />{event.status === "closed" ? "Reopen voting" : "Open voting"}</button>
            : <button className="button" disabled={actions.busy} onClick={() => void changeStatus("closed")}><Icon name="lock" size={17} />Close voting</button>}
          {event.status === "draft" && <p className="field-help">Add places and people, then open voting to activate invitations.</p>}
        </div>}
        {!admin && <div className="your-progress">
          <div><span>Hi {viewer.name}. {closed ? "Here’s where the group landed." : voted === locations.length && locations.length ? "You’re all rated. Nice one." : "Where would you like to go?"}</span>
            <strong>{voted}<span> / {locations.length}</span></strong></div>
          <progress aria-label="Your rating progress" value={voted} max={Math.max(1, locations.length)} />
          {!closed && <p>Your ratings save automatically. Tap a selected star again to clear it.</p>}
        </div>}
      </section>
      {(actions.error || voteError) && <ErrorBox>{actions.error || voteError}</ErrorBox>}
      {refreshError && <ErrorBox>Live refresh paused: {refreshError} <button className="text-button" onClick={() => void actions.run(refresh)}>Try again</button></ErrorBox>}
      {notice && <div className="notice" role="status"><Icon name="check" size={17} />{notice}<button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice("")}><Icon name="close" size={16} /></button></div>}
      <nav className="event-tabs" aria-label="Event sections">
        {tabs.map((item) => <button key={item} className={tab === item ? "active" : ""} aria-current={tab === item ? "page" : undefined}
          onClick={() => { setTab(item); setNotice(""); }}><Icon name={tabIcons[item]} size={18} />{tabLabels[item]}
          {item === "people" && <span className="tab-count">{detail.participantCount}</span>}</button>)}
      </nav>
      <section className="event-content">
        {tab === "places" && <>
          {admin && <div className="section-bar"><p className="muted">The shortlist. Every branch gets its own place.</p>
            <button className="button primary" onClick={() => setLocationEditor("new")}><Icon name="plus" size={17} />Add location</button></div>}
          {!locations.length ? <div className="empty-state">
            <span className="empty-icon"><Icon name="pin" size={30} /></span><h2>It starts with a place</h2>
            <p>Add a Google Maps link, confirm the name, and give your guests something to look forward to.</p>
            {admin && <button className="button primary" onClick={() => setLocationEditor("new")}><Icon name="plus" size={18} />Add your first location</button>}
          </div> : <div className="places-grid">
            {locations.map((location, i) => <article className="place-card" key={location.id}>
              <div className="place-photo"><Gallery name={location.name} urls={location.imageUrls} />
                <span className="place-number">{String(i + 1).padStart(2, "0")}</span>
                {admin && <button className="photo-edit icon-button" aria-label={`Edit ${location.name}`} onClick={() => setLocationEditor(location)}><Icon name="edit" size={17} /></button>}
              </div>
              <div className="place-body">
                <h2>{location.name}</h2>
                {location.address && <p className="place-address"><Icon name="pin" size={14} />{location.address}</p>}
                {location.description && <p className="place-description">{location.description}</p>}
                {location.note && <div className="place-note"><strong>Our notes</strong><p>{location.note}</p></div>}
                <div className="place-links">
                  {location.menuUrl && <a href={location.menuUrl} target="_blank" rel="noopener noreferrer">Menu<Icon name="arrow" size={15} /></a>}
                  <a href={location.mapsUrl} target="_blank" rel="noopener noreferrer">Google Maps<Icon name="arrow" size={15} /></a>
                </div>
                {location.websiteUrl && <div className="place-sources">
                  <a href={location.websiteUrl} target="_blank" rel="noopener noreferrer">Venue website</a>
                </div>}
                {!admin && <div className="rating-block">
                  <div className="rating-label"><span>{closed ? "Your rating" : "Your pick?"}</span>
                    <span role="status" className="save-state">{savingId === location.id ? "Saving…" : savedId === location.id ? <><Icon name="check" size={13} />Saved</> : null}</span></div>
                  <div className="stars" role="group" aria-label={`Rate ${location.name}`}>
                    {[1, 2, 3, 4, 5].map((score) => <button key={score} className={(myRatings[location.id] ?? 0) >= score ? "filled" : ""}
                      disabled={closed || savingId !== null} aria-pressed={myRatings[location.id] === score}
                      aria-label={`${location.name}: ${score} out of 5${myRatings[location.id] === score ? " (tap to clear)" : ""}`}
                      onClick={() => void rate(location.id, myRatings[location.id] === score ? null : score)}><Icon name="star" size={29} filled /></button>)}
                  </div>
                </div>}
                {admin && <div className="place-admin"><span>Guest ratings appear in Ranking</span><button className="text-button" onClick={() => setLocationEditor(location)}>Edit place</button></div>}
              </div>
            </article>)}
          </div>}
        </>}
        {tab === "ranking" && <Ranking detail={detail} />}
        {tab === "people" && admin && <People detail={detail} refresh={refresh}
          showInvitation={setInvitation} run={actions.run} />}
        {tab === "settings" && admin && <div className="settings-layout">
          <div className="panel"><EventForm initial={event} onSave={async (input) => {
            await api(`/events/${id}`, "PUT", { ...input, status: event.status });
            await refresh(); setNotice("Event details and theme saved.");
          }} /></div>
          <aside className="settings-aside"><div className="panel"><Icon name="eye" size={24} /><h3>Your event, your way</h3>
            <p>Theme changes apply to every guest’s invitation. Their ratings stay exactly where they are.</p>
            <p>Current theme: <strong>{themes[event.theme].name}</strong></p></div>
            <div className="panel danger-zone"><h3>Delete event</h3><p>This removes the locations, participants, and all saved ratings.</p>
              <button className="button danger" onClick={() => {
                if (window.confirm(`Permanently delete “${event.title}” and all its ratings?`)) {
                  void actions.run(async () => { await api(`/events/${id}`, "DELETE"); navigate("/"); });
                }
              }}>Delete this event</button>
            </div>
          </aside>
        </div>}
      </section>
      <footer className="event-footer"><Icon name="spark" size={14} /><span>A little less back-and-forth. A great place to get together.</span></footer>
      <details className="data-credits">
        <summary>Data credits</summary>
        <p><a href="https://www.tomtom.com/en-gb/legal/" target="_blank" rel="noopener noreferrer">Place search © TomTom</a></p>
        {locations.some((location) => location.osmUrl) && <p>
          Place data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>
        </p>}
      </details>
    </main>
    {admin && locationEditor && <Modal title={locationEditor === "new" ? "Add a location" : "Edit location"} onClose={() => setLocationEditor(null)}>
      <LocationForm initial={locationEditor === "new" ? undefined : locationEditor} eventCity={event.city} onSave={async (input) => {
        await api(`/events/${id}/locations${locationEditor === "new" ? "" : `/${locationEditor.id}`}`, locationEditor === "new" ? "POST" : "PUT", input);
        await refresh(); setLocationEditor(null); setNotice("Location saved.");
      }} />
      {locationEditor !== "new" && <button className="text-button danger-text" disabled={actions.busy} onClick={() => {
        if (window.confirm(`Remove “${locationEditor.name}”? All ratings for this location will be removed too.`)) {
          void actions.run(async () => { await api(`/events/${id}/locations/${locationEditor.id}`, "DELETE"); await refresh(); setLocationEditor(null); });
        }
      }}><Icon name="trash" size={15} />Remove location</button>}
    </Modal>}
    {admin && invitation && <Modal title={`An invitation for ${invitation.name}`} onClose={() => setInvitation(null)}>
      <div className="invitation-icon"><Icon name="link" size={30} /></div>
      <p className="muted">This is {invitation.name}’s personal voting link. Keep it private: anyone with it can use their ballot.</p>
      <label>Personal link<input className="invitation-input" readOnly value={invitation.link} onFocus={(e) => e.target.select()} /></label>
      {event.status === "draft" && <p className="inline-note">Open voting before sending this invitation.</p>}
      <button className="button primary full-width" onClick={() => void copy(invitation.link, "Invitation copied.")}><Icon name="copy" size={17} />Copy invitation</button>
      {actions.error && <ErrorBox>{actions.error}</ErrorBox>}
      <p className="field-help">Copy it before closing. We only store a hash of the invitation; you can generate a new one later without losing votes.</p>
    </Modal>}
    <button className="session-exit" onClick={() => void actions.run(async () => {
      await api(admin ? "/auth/logout" : "/invitations/leave", "POST"); await onSessionChange(); navigate("/");
    })} disabled={actions.busy}>{admin ? "Sign out" : "Leave event"}<Icon name="logout" size={14} /></button>
  </div>;
}

function eventInput(event: PlannerEvent): EventInput {
  const { title, description, city, date, occasion, theme, accent, coverUrl, status, mood, greeting, decorations } = event;
  return { title, description, city, date, occasion, theme, accent, coverUrl, status, mood, greeting, decorations };
}

function Ranking({ detail }: { detail: EventDetail }) {
  const [sort, setSort] = useState<"score" | "votes">("score");
  const results = detail.locations.map((location) => ({
    location, result: detail.results.find((r) => r.locationId === location.id) ?? { average: null, count: 0 },
  })).sort((a, b) => sort === "score"
    ? (b.result.average ?? -1) - (a.result.average ?? -1) || b.result.count - a.result.count || a.location.position - b.location.position
    : b.result.count - a.result.count || (b.result.average ?? -1) - (a.result.average ?? -1));
  const votes = detail.results.reduce((count, r) => count + r.count, 0);
  return <>
    <div className="ranking-summary">
      <div><span className="eyebrow">{detail.event.status === "closed" ? "Final results" : "The group’s shortlist"}</span>
        <h2>{votes ? "Good taste, all together." : "The best plans take a few opinions."}</h2>
        <p>{votes ? `${votes} ratings from your group. Unrated places never count as zero.` : "The first ratings will appear here. Everyone’s vote counts equally."}</p></div>
      <div className="participation"><strong>{detail.completedCount}<span>/{detail.participantCount}</span></strong><span>finished rating</span></div>
    </div>
    {results.length > 0 && <div className="section-bar"><span className="muted">Average out of 5 · updates every 8 seconds</span>
      <label className="sort-control"><span>Sort by</span><select value={sort} onChange={(e) => setSort(e.target.value === "votes" ? "votes" : "score")}>
        <option value="score">Average rating</option><option value="votes">Rating count</option>
      </select></label></div>}
    <div className="ranking-list">{results.map(({ location, result }, i) => {
      const rank = result.average === null ? null : sort === "score"
        ? 1 + results.filter((r) => r.result.average !== null && r.result.average > result.average!).length
        : 1 + results.filter((r) => r.result.count > result.count).length;
      return <article key={location.id} className={`ranking-row ${rank === 1 ? "first" : ""}`}>
        <span className="rank">{rank === 1 ? <Icon name="trophy" size={22} /> : rank ?? "—"}</span>
        <div className="rank-name"><h3>{location.name}</h3><span>{result.count} {result.count === 1 ? "rating" : "ratings"}{location.address ? ` · ${location.address}` : ""}</span></div>
        <div className="rank-score">{result.average === null ? <span className="no-score">—</span> : <><strong>{result.average.toFixed(1)}</strong><span>/ 5</span></>}</div>
        <div className="score-track" aria-hidden="true"><span style={{ width: `${(result.average ?? 0) * 20}%` }} /></div>
        <span className="sr-only">Position {rank ?? i + 1}</span>
      </article>;
    })}</div>
    {!results.length && <div className="empty-state"><Icon name="trophy" size={36} /><h2>No locations just yet</h2><p>The organiser’s shortlist will appear here.</p></div>}
    <p className="ranking-footnote">Equal averages share a rank. Ratings can change while voting is open.</p>
  </>;
}

function People({ detail, refresh, showInvitation, run }: {
  detail: EventDetail; refresh: () => Promise<void>;
  showInvitation: (value: { name: string; link: string }) => void;
  run: (work: () => Promise<void>) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const task = useTask();
  return <div className="people-layout">
    <div>
      <div className="section-bar"><h2>The people make the plan.</h2><span className="muted">{detail.participantCount} invited</span></div>
      <div className="panel people-list">
        {!detail.participants.length && <p className="muted">Your guest list is waiting. Add someone to create their invitation.</p>}
        {detail.participants.map((person) => <div className="person-row" key={person.id}>
          <span className="avatar">{person.name.charAt(0).toUpperCase()}</span>
          <div className="person-info"><strong>{person.name}</strong>
            <span>{person.ratedCount} of {detail.locations.length} rated{!person.invited ? " · invitation revoked" : ""}</span>
            <progress aria-label={`${person.name}'s progress`} value={person.ratedCount} max={Math.max(1, detail.locations.length)} /></div>
          <div className="person-actions">
            <button className="button small" onClick={() => {
              if (person.invited && !window.confirm(`Create a new invitation for ${person.name}? Their old link and sessions will stop working. Saved votes are kept.`)) return;
              void run(async () => {
                const response = await api<{ inviteToken: string }>(`/events/${detail.event.id}/participants/${person.id}/invitation`, "POST");
                await refresh(); showInvitation({ name: person.name, link: invitationLink(response.inviteToken) });
              });
            }}><Icon name="link" size={15} />New link</button>
            {person.invited && <button className="icon-button" aria-label={`Revoke ${person.name}'s invitation`} title="Revoke invitation" onClick={() => {
              if (window.confirm(`Revoke ${person.name}’s invitation and active sessions? Their votes will be kept.`)) {
                void run(async () => { await api(`/events/${detail.event.id}/participants/${person.id}/invitation`, "DELETE"); await refresh(); });
              }
            }}><Icon name="lock" size={16} /></button>}
            <button className="icon-button" aria-label={`Remove ${person.name}`} title="Remove participant" onClick={() => {
              if (window.confirm(`Remove ${person.name} and all their ratings?`)) {
                void run(async () => { await api(`/events/${detail.event.id}/participants/${person.id}`, "DELETE"); await refresh(); });
              }
            }}><Icon name="trash" size={16} /></button>
          </div>
        </div>)}
      </div>
    </div>
    <aside className="panel add-person"><span className="eyebrow">Make room for someone</span><h3>Add a participant</h3>
      <p>No account, no password. Just a name and a personal invitation.</p>
      <Form onSubmit={() => void task.run(async () => {
        const response = await api<{ id: string; inviteToken: string; name: string }>(`/events/${detail.event.id}/participants`, "POST", { name });
        await refresh(); setName(""); showInvitation({ name: response.name, link: invitationLink(response.inviteToken) });
      })}>
        <label>Name<input required maxLength={80} placeholder="e.g. Alex" value={name} disabled={task.busy} onChange={(e) => setName(e.target.value)} /></label>
        {task.error && <ErrorBox>{task.error}</ErrorBox>}
        <button className="button primary full-width" disabled={task.busy || !name.trim()}>{task.busy ? "Adding…" : "Create invitation"}<Icon name="plus" size={17} /></button>
      </Form>
      <div className="inline-note"><Icon name="lock" size={17} /><span>Personal links act like keys. Send each one privately, not to the group chat.</span></div>
    </aside>
  </div>;
}
