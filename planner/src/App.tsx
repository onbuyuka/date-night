import { useCallback, useEffect, useState } from "react";
import type { EventInput, EventSummary, PlannerEvent, Session } from "../shared/model";
import { api, message, navigate } from "./api";
import { EventForm } from "./forms";
import { EventPage } from "./EventPage";
import { AccountLink, Organisers, YourAccount } from "./Accounts";
import { formatDate, themeStyle } from "./themes";
import { Brand, ErrorBox, Form, Icon, Loading, Modal, useTask } from "./ui";

export default function App() {
  const [route, setRoute] = useState(window.location.hash.slice(1) || "/");
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const refreshSession = useCallback(async () => setSession(await api<Session>("/session")), []);
  useEffect(() => {
    void refreshSession().catch((error: unknown) => setError(message(error)));
    const change = () => setRoute(window.location.hash.slice(1) || "/");
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, [refreshSession]);
  if (error) return <div className="page narrow"><Brand /><ErrorBox>{error}</ErrorBox>
    {import.meta.env.DEV && <p className="muted">Run the local API and web servers with <code>npm run dev</code> inside the planner folder.</p>}
    <button className="button primary" onClick={() => window.location.reload()}>Try again</button></div>;
  if (!session) return <Loading />;
  const accountLink = route.match(/^\/(join|reset)\/([0-9a-f]{64})$/);
  if (accountLink) return <AccountLink key={`${accountLink[1]}-${accountLink[2]}`} kind={accountLink[1] === "join" ? "join" : "reset"}
    token={accountLink[2]} onSessionChange={refreshSession} />;
  const invite = route.match(/^\/invite\/([0-9a-f]{64})$/);
  if (invite) return <Redeem key={invite[1]} token={invite[1]} onSessionChange={refreshSession} />;
  const event = route.match(/^\/event\/([^/?]+)$/);
  if (event) return <EventPage key={event[1]} id={event[1]} hasOrganiserSession={session.role === "admin"} onSessionChange={refreshSession} />;
  if (route === "/account" || route === "/organisers") {
    if (session.role !== "admin") return <Welcome session={session} onSessionChange={refreshSession} />;
    return route === "/account" ? <YourAccount session={session} onSessionChange={refreshSession} /> : <Organisers session={session} />;
  }
  if (route !== "/") return <div className="page narrow"><Brand /><ErrorBox>This link could not be found. Check the full invitation URL.</ErrorBox>
    <button className="button" onClick={() => navigate("/")}>Back to workspace</button></div>;
  if (session.role === "admin") return <Dashboard session={session} onSessionChange={refreshSession} />;
  return <Welcome session={session} onSessionChange={refreshSession} />;
}

function Welcome({ session, onSessionChange }: { session: Session; onSessionChange: () => Promise<void> }) {
  const task = useTask();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  return <div className="app">
    <header className="topbar"><div className="topbar-inner"><Brand /><span className="muted small-text">Less planning. More together.</span></div></header>
    <main className="welcome">
      <div className="welcome-copy"><span className="eyebrow">A place for good plans</span><h1>A little less<br />“where shall<br />we go?”</h1>
        <p>Make a shortlist. Bring your people.<br />Find the place everyone’s looking forward to.</p>
        {session.role === "participant" && session.eventId
          ? <button className="button primary large" onClick={() => navigate(`/event/${session.eventId}`)}>Back to your event<Icon name="arrow" /></button>
          : <div className="guest-hint"><Icon name="link" size={19} /><span>Invited to something? Open your personal link to join.</span></div>}
      </div>
      <section className="welcome-panel">
        <div className="illustration" aria-hidden="true"><div className="table-drawing"><i /><i /><i /><i /><span><Icon name="spark" size={36} /></span></div>
          <span className="illustration-label"><Icon name="check" size={15} />Good company. Great choice.</span></div>
        <div className="welcome-panel-copy">
          <span className="eyebrow">Organiser access</span><h2>{session.setupRequired ? "Make this space yours." : "Welcome back."}</h2>
          <p>{session.setupRequired ? "Create your organiser account to start making plans." : "Sign in to create events and manage your invitations."}</p>
          <Form onSubmit={() => void task.run(async () => {
            if (session.setupRequired && password !== confirmation) throw new Error("The passwords don’t match.");
            await api(session.setupRequired ? "/auth/setup" : "/auth/login", "POST", { username, password });
            setPassword(""); setConfirmation(""); await onSessionChange();
          })}>
            <fieldset disabled={task.busy}>
              <label>Username<input required minLength={3} maxLength={40} autoComplete="username" autoCapitalize="none" spellCheck={false}
                value={username} onChange={(e) => setUsername(e.target.value)} /></label>
              <label>Password<input required type="password" minLength={12} maxLength={128}
                autoComplete={session.setupRequired ? "new-password" : "current-password"}
                value={password} onChange={(e) => setPassword(e.target.value)} /></label>
              {session.setupRequired && <><p className="field-help">Use at least 12 characters. A few memorable words work well.</p>
                <label>Confirm password<input required type="password" autoComplete="new-password"
                  value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></label></>}
              <button className="button primary full-width" type="submit">{task.busy ? "Opening…" : session.setupRequired ? "Create organiser account" : "Sign in"}<Icon name="arrow" size={18} /></button>
            </fieldset>
          </Form>
          {task.error && <ErrorBox>{task.error}</ErrorBox>}
          {!session.setupRequired && <p className="field-help">Ask the person who invited you for a password reset link.</p>}
          <p className="local-disclaimer"><Icon name="lock" size={13} />Your guests join with personal invitations, not this account.</p>
        </div>
      </section>
    </main>
    <footer className="workspace-footer"><span>Built around the people, not the paperwork.</span>{import.meta.env.DEV && <span>Local preview</span>}</footer>
  </div>;
}

function Redeem({ token, onSessionChange }: { token: string; onSessionChange: () => Promise<void> }) {
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    async function open() {
      try {
        const response = await api<{ eventId: string }>("/invitations/redeem", "POST", { token });
        await onSessionChange();
        if (active) navigate(`/event/${response.eventId}`, true);
      } catch (error) { if (active) setError(message(error)); }
    }
    void open();
    return () => { active = false; };
  }, [token, onSessionChange]);
  return error ? <div className="page narrow"><Brand /><ErrorBox>{error}</ErrorBox>
    <p className="muted">Your organiser can generate a new personal link without losing your saved ratings.</p></div>
    : <Loading text="Opening your personal invitation…" />;
}

function Dashboard({ session, onSessionChange }: { session: Session; onSessionChange: () => Promise<void> }) {
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const task = useTask();
  useEffect(() => {
    let active = true;
    void api<EventSummary[]>("/events").then((result) => { if (active) setEvents(result); })
      .catch((error: unknown) => { if (active) setError(message(error)); });
    return () => { active = false; };
  }, []);
  async function create(input: EventInput) {
    const event = await api<PlannerEvent>("/events", "POST", input);
    setCreating(false); navigate(`/event/${event.id}`);
  }
  const filtered = events?.filter((event) => (filter === "all" || event.status === filter)
    && event.title.toLowerCase().includes(search.toLowerCase()));
  const totalPeople = events?.reduce((sum, event) => sum + event.participantCount, 0) ?? 0;
  return <div className="app">
    <header className="topbar"><div className="topbar-inner account-topbar"><Brand /><div className="topbar-end account-navigation">
      {session.organiserRole === "owner" && <button className="button small" onClick={() => navigate("/organisers")}>Manage organisers</button>}
      <button className="button small" onClick={() => navigate("/account")}>Your account</button>
      <button className="icon-button" disabled={task.busy} aria-label="Sign out" onClick={() => void task.run(async () => {
        await api("/auth/logout", "POST"); await onSessionChange();
      })}><Icon name="logout" size={18} /></button></div></div></header>
    <main className="page dashboard">
      <div className="dashboard-heading"><div><span className="eyebrow">Your next good plan</span><h1>Bring people together.</h1>
        <p className="muted">The occasion is yours. Let everyone help choose the place.</p></div>
        <button className="button primary" onClick={() => setCreating(true)}><Icon name="plus" size={18} />Create event</button></div>
      {error && <ErrorBox>{error}</ErrorBox>}
      {task.error && <ErrorBox>{task.error}</ErrorBox>}
      {events && <div className="workspace-stats">
        <div><span>On the calendar</span><strong>{events.length}<small>{events.length === 1 ? "event" : "events"}</small></strong></div>
        <div><span>Collecting opinions</span><strong>{events.filter((event) => event.status === "open").length}<small>open for voting</small></strong></div>
        <div><span>Better with company</span><strong>{totalPeople}<small>event participants</small></strong></div>
      </div>}
      {!events && !error && <Loading text="Loading your events…" />}
      {events && events.length > 0 && <div className="dashboard-toolbar">
        <div className="filter-chips" role="group" aria-label="Filter events">
          {[["all", "All events"], ["draft", "Drafts"], ["open", "Voting open"], ["closed", "Closed"]].map(([value, label]) =>
            <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)} aria-pressed={filter === value}>{label}</button>)}
        </div>
        <input className="event-search" type="search" aria-label="Search events" placeholder="Find an event…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>}
      {filtered && filtered.length > 0 && <div className="event-grid">
        {filtered.map((event) => <button className="event-card" key={event.id} style={themeStyle(event.theme, event.accent)} onClick={() => navigate(`/event/${event.id}`)}>
          <div className="event-card-art"><span className={`status status-${event.status}`}><i />{event.status === "open" ? "Voting open" : event.status === "draft" ? "Draft" : "Closed"}</span>
            <span className="event-art-occasion">{event.occasion}</span><span className="event-art-symbol"><Icon name={event.occasion === "Birthday" ? "spark" : event.occasion === "Weekend" ? "calendar" : "pin"} size={56} /></span></div>
          <div className="event-card-body"><span className="card-date">{formatDate(event.date)}{event.city ? ` · ${event.city}` : ""}</span><h2>{event.title}</h2>
            <p>{event.description || "A new plan, waiting for a few good opinions."}</p>
            <div className="event-card-meta"><span><Icon name="pin" size={15} />{event.locationCount} places</span>
              <span><Icon name="users" size={15} />{event.participantCount} people</span><Icon name="arrow" size={18} /></div>
          </div>
        </button>)}
        <button className="new-event-card" onClick={() => setCreating(true)}><span><Icon name="plus" size={27} /></span><h3>Make another plan</h3><p>Big occasion or just a Friday.</p></button>
      </div>}
      {events?.length === 0 && <div className="first-event">
        <div className="first-event-art" aria-hidden="true"><Icon name="spark" size={80} /><span>Good things start somewhere.</span></div>
        <div><span className="eyebrow">A blank canvas, a great evening</span><h2>Your first event is waiting.</h2><p>Pick the occasion, add a few places, and invite your people to have their say.</p>
          <button className="button primary" onClick={() => setCreating(true)}>Create your first event<Icon name="arrow" size={18} /></button>
          <div className="getting-started"><span><b>01</b> Make it yours</span><span><b>02</b> Shortlist places</span><span><b>03</b> Invite & vote</span></div></div>
      </div>}
      {events && events.length > 0 && filtered?.length === 0 && <div className="empty-state"><Icon name="calendar" size={32} /><h2>No events match</h2><p>Try a different name or filter.</p>
        <button className="button" onClick={() => { setSearch(""); setFilter("all"); }}>Clear filters</button></div>}
      <div className="workspace-note"><Icon name="lock" size={16} /><span>Private invitations. Saved opinions. Plans made together.</span></div>
    </main>
    {creating && <Modal title="Make a plan" onClose={() => setCreating(false)}><EventForm creating onSave={create} /></Modal>}
    <footer className="workspace-footer"><span>A place for good plans.</span>{import.meta.env.DEV && <span>Local workspace</span>}</footer>
  </div>;
}
