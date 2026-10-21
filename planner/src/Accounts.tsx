import { useEffect, useState, type ReactNode } from "react";
import type {
  AccountInvitationInfo, IssuedOrganiserInvitation, OrganiserAccount, OrganiserDirectory, PasswordResetInfo, Session,
} from "../shared/model";
import { api, message, navigate, organiserInvitationLink, passwordResetLink } from "./api";
import { Brand, ErrorBox, Form, Icon, Loading, Modal, useTask } from "./ui";

function expiry(value: number): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function AccountLayout({ title, children }: { title: string; children: ReactNode }) {
  return <div className="app">
    <header className="topbar"><div className="topbar-inner"><Brand />
      <button className="back-button" onClick={() => navigate("/")}><Icon name="back" size={18} />Your events</button>
    </div></header>
    <main className="page account-page"><h1>{title}</h1>{children}</main>
  </div>;
}

export function AccountLink({ kind, token, onSessionChange }: {
  kind: "join" | "reset"; token: string; onSessionChange: () => Promise<void>;
}) {
  const [info, setInfo] = useState<AccountInvitationInfo | PasswordResetInfo | null>(null);
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const task = useTask();
  useEffect(() => {
    let active = true;
    setInfo(null); setLoadError("");
    const path = kind === "join" ? "/organiser-invitations" : "/password-resets";
    void api<AccountInvitationInfo | PasswordResetInfo>(`${path}/${token}`)
      .then((value) => { if (active) setInfo(value); })
      .catch((error: unknown) => { if (active) setLoadError(message(error)); });
    return () => { active = false; };
  }, [kind, token, attempt]);
  if (loadError) return <AccountLayout title={kind === "join" ? "Your invitation" : "Reset your password"}>
    <ErrorBox>{loadError}</ErrorBox>
    <p className="muted">This private link may have expired or already been used. Ask the person who sent it for a new one.</p>
    <button className="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button>
  </AccountLayout>;
  if (!info) return <Loading text={kind === "join" ? "Checking your invitation…" : "Checking your reset link…"} />;
  const invitation = "kind" in info ? info : null;
  return <AccountLayout title={kind === "join" ? "Make this space yours." : "Reset your password"}>
    <section className="panel account-form">
      {invitation ? <p>Hi {invitation.name}. {invitation.kind === "owner"
        ? "You’re invited to activate the owner account for this planner."
        : "You’re invited to become an organiser and make plans with your people."} Choose a username and password to get started.</p>
        : <p>Choose a new password for <strong>{"username" in info ? info.username : ""}</strong>.</p>}
      <p className="field-help">This link expires {expiry(info.expiresAt)}.</p>
      <Form onSubmit={() => void task.run(async () => {
        if (password.length < 12) throw new Error("Use at least 12 characters for your password.");
        if (password !== confirmation) throw new Error("The passwords don’t match.");
        if (kind === "join") {
          await api("/organiser-invitations/redeem", "POST", { username: username.trim(), password, token });
        } else {
          await api("/password-resets/redeem", "POST", { token, password });
        }
        setPassword(""); setConfirmation("");
        await onSessionChange();
        navigate("/", true);
      })}>
        <fieldset disabled={task.busy}>
          {kind === "join" && <label>Username<input required minLength={3} maxLength={40} pattern="[a-zA-Z0-9_.-]+"
            autoComplete="username" autoCapitalize="none" spellCheck={false}
            value={username} onChange={(event) => setUsername(event.target.value)} /></label>}
          <label>{kind === "join" ? "Password" : "New password"}<input required type="password" minLength={12} maxLength={128}
            autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <p className="field-help">Use at least 12 characters. A few memorable words work well.</p>
          <label>Confirm password<input required type="password" minLength={12} maxLength={128} autoComplete="new-password"
            value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
          <button className="button primary full-width" type="submit">{task.busy ? "Saving…" : kind === "join" ? "Activate account" : "Reset password"}</button>
        </fieldset>
      </Form>
      {task.error && <ErrorBox>{task.error}</ErrorBox>}
    </section>
  </AccountLayout>;
}

export function YourAccount({ session, onSessionChange }: { session: Session; onSessionChange: () => Promise<void> }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [notice, setNotice] = useState("");
  const task = useTask();
  return <AccountLayout title="Your account">
    <section className="panel account-form">
      <p>Signed in as <strong>{session.name}</strong>.</p>
      <h2>Change password</h2>
      <Form onSubmit={() => {
        setNotice("");
        void task.run(async () => {
          if (newPassword.length < 12) throw new Error("Use at least 12 characters for your password.");
          if (newPassword !== confirmation) throw new Error("The passwords don’t match.");
          await api("/auth/password", "POST", { currentPassword, newPassword });
          setCurrentPassword(""); setNewPassword(""); setConfirmation("");
          await onSessionChange();
          setNotice("Your password has been changed.");
        });
      }}>
        <fieldset disabled={task.busy}>
          <label>Username<input readOnly autoComplete="username" value={session.name ?? ""} /></label>
          <label>Current password<input required type="password" minLength={12} maxLength={128} autoComplete="current-password"
            value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
          <label>New password<input required type="password" minLength={12} maxLength={128} autoComplete="new-password"
            value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
          <p className="field-help">Use at least 12 characters. A few memorable words work well.</p>
          <label>Confirm new password<input required type="password" minLength={12} maxLength={128} autoComplete="new-password"
            value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
          <button className="button primary" type="submit">{task.busy ? "Changing…" : "Change password"}</button>
        </fieldset>
      </Form>
      {task.error && <ErrorBox>{task.error}</ErrorBox>}
      {notice && <p className="notice" role="status"><Icon name="check" size={17} />{notice}</p>}
    </section>
  </AccountLayout>;
}

type PrivateLink = { title: string; label: string; url: string; expiresAt: number; explanation: string };

function PrivateLinkDialog({ link, onClose }: { link: PrivateLink; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const task = useTask();
  return <Modal title={link.title} onClose={onClose}>
    <p className="muted">{link.explanation}</p>
    <label>{link.label}<input className="invitation-input" readOnly value={link.url} onFocus={(event) => event.target.select()} /></label>
    <p className="field-help">Expires {expiry(link.expiresAt)}. Copy this link before closing; it won’t be shown again. Send it privately.</p>
    <button className="button primary full-width" disabled={task.busy} onClick={() => void task.run(async () => {
      if (!navigator.clipboard) throw new Error("Clipboard access isn’t available. Select and copy the link above.");
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    })}><Icon name="copy" size={17} />{task.busy ? "Copying…" : "Copy link"}</button>
    {copied && <p className="notice" role="status">Link copied.</p>}
    {task.error && <ErrorBox>{task.error}</ErrorBox>}
  </Modal>;
}

export function Organisers({ session }: { session: Session }) {
  const [directory, setDirectory] = useState<OrganiserDirectory | null>(null);
  const [loadError, setLoadError] = useState("");
  const [name, setName] = useState("");
  const [notice, setNotice] = useState("");
  const [link, setLink] = useState<PrivateLink | null>(null);
  const task = useTask();
  const owner = session.organiserRole === "owner";
  useEffect(() => {
    if (!owner) return;
    let active = true;
    void api<OrganiserDirectory>("/organisers")
      .then((value) => { if (active) setDirectory(value); })
      .catch((error: unknown) => { if (active) setLoadError(message(error)); });
    return () => { active = false; };
  }, [owner]);
  async function refresh() {
    setDirectory(await api<OrganiserDirectory>("/organisers"));
    setLoadError("");
  }
  function changeAccess(account: OrganiserAccount) {
    const question = account.active
      ? `Suspend ${account.username}? Their events and guest links will be paused, not deleted. Reactivating the account will restore access.`
      : `Reactivate ${account.username}? Their events and guest links will be available again.`;
    if (!window.confirm(question)) return;
    setNotice("");
    void task.run(async () => {
      await api(`/organisers/${account.id}`, "PUT", { active: !account.active });
      setNotice(account.active ? `${account.username} suspended. Their events and guest links are paused, not deleted.` : `${account.username} reactivated.`);
      await refresh();
    });
  }
  if (!owner) return <AccountLayout title="Manage organisers"><ErrorBox>Only the planner owner can manage organisers.</ErrorBox></AccountLayout>;
  return <AccountLayout title="Manage organisers">
    <p className="muted">Invite organisers and manage account access. Each organiser manages their own events.</p>
    {loadError && <><ErrorBox>{loadError}</ErrorBox><button className="button" disabled={task.busy} onClick={() => void task.run(refresh)}>Try again</button></>}
    {task.error && <ErrorBox>{task.error}</ErrorBox>}
    {notice && <p className="notice" role="status"><Icon name="check" size={17} />{notice}</p>}
    {!directory && !loadError && <Loading text="Loading organisers…" />}
    {directory && <div className="organisers-layout">
      <div className="account-lists">
        <section className="panel" aria-labelledby="organisers-heading">
          <h2 id="organisers-heading">Accounts</h2>
          <ul className="account-list">{directory.organisers.map((account) => <li className="account-row" key={account.id}>
            <div className="account-info"><strong>{account.username}{account.id === session.organiserId ? " (you)" : ""}</strong>
              <span>{account.role === "owner" ? "Owner" : account.active ? "Active organiser" : "Suspended organiser"}</span></div>
            {account.role !== "owner" && account.id !== session.organiserId && <div className="account-actions">
              <button className={`button small${account.active ? " danger" : ""}`} disabled={task.busy} onClick={() => changeAccess(account)}
                aria-label={`${account.active ? "Suspend" : "Reactivate"} ${account.username}`}>{account.active ? "Suspend" : "Reactivate"}</button>
              {account.active && <button className="button small" disabled={task.busy} aria-label={`Create password reset link for ${account.username}`}
                onClick={() => {
                  if (!window.confirm(`Create a password reset link for ${account.username}? Send it privately so they can choose a new password.`)) return;
                  setNotice("");
                  void task.run(async () => {
                    const result = await api<{ token: string; expiresAt: number }>(`/organisers/${account.id}/reset`, "POST");
                    setLink({ title: `Password reset for ${account.username}`, label: "Password reset link", url: passwordResetLink(result.token),
                      expiresAt: result.expiresAt, explanation: `Anyone with this one-use link can reset ${account.username}’s password. Share it only with them.` });
                    setNotice(`Password reset link created for ${account.username}.`);
                  });
                }}>Reset password</button>}
            </div>}
          </li>)}</ul>
        </section>
        <section className="panel" aria-labelledby="invitations-heading">
          <h2 id="invitations-heading">Pending invitations</h2>
          {!directory.invitations.length ? <p>No pending invitations.</p> : <ul className="account-list">
            {directory.invitations.map((invitation) => <li className="account-row" key={invitation.id}>
              <div className="account-info"><strong>{invitation.name}</strong><span>Expires {expiry(invitation.expiresAt)}</span></div>
              <button className="button small danger" disabled={task.busy} aria-label={`Revoke invitation for ${invitation.name}`} onClick={() => {
                if (!window.confirm(`Revoke ${invitation.name}’s organiser invitation? Their link will stop working.`)) return;
                setNotice("");
                void task.run(async () => {
                  await api(`/organiser-invitations/${invitation.id}`, "DELETE");
                  setNotice(`Invitation for ${invitation.name} revoked.`);
                  await refresh();
                });
              }}>Revoke</button>
            </li>)}
          </ul>}
        </section>
      </div>
      <section className="panel invite-organiser" aria-labelledby="invite-organiser-heading">
        <h2 id="invite-organiser-heading">Invite an organiser</h2>
        <p>They’ll choose their own username and password using a private, one-use link.</p>
        <Form onSubmit={() => {
          setNotice("");
          void task.run(async () => {
            const result = await api<IssuedOrganiserInvitation>("/organiser-invitations", "POST", { name: name.trim() });
            setName("");
            setLink({ title: `An organiser invitation for ${result.name}`, label: "Organiser invitation link",
              url: organiserInvitationLink(result.token), expiresAt: result.expiresAt,
              explanation: `This link lets ${result.name} create their own organiser account. It isn’t an event guest invitation.` });
            setNotice(`Organiser invitation created for ${result.name}.`);
            await refresh();
          });
        }}>
          <fieldset disabled={task.busy}>
            <label>Name<input required maxLength={80} autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} /></label>
            <button className="button primary full-width" type="submit" disabled={!name.trim()}>{task.busy ? "Working…" : "Create organiser invitation"}</button>
          </fieldset>
        </Form>
      </section>
    </div>}
    {link && <PrivateLinkDialog key={link.url} link={link} onClose={() => setLink(null)} />}
  </AccountLayout>;
}
