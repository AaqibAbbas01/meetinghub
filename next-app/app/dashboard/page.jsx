"use client";
import { useSession, signOut } from "next-auth/react";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";

// ── Constants ─────────────────────────────────────────────────
const RECURRENCE_OPTIONS = [
  { value: "none",     label: "Does not repeat" },
  { value: "daily",    label: "Daily" },
  { value: "weekly",   label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly",  label: "Monthly" },
  { value: "custom",   label: "🗓 Custom (pick days)" },
];

const DAYS_OF_WEEK = [
  { key: "Sun" }, { key: "Mon" }, { key: "Tue" }, { key: "Wed" },
  { key: "Thu" }, { key: "Fri" }, { key: "Sat" },
];

const REMINDER_OPTIONS = [
  { value: "none",  label: "No reminder" },
  { value: "15",    label: "15 minutes before" },
  { value: "30",    label: "30 minutes before" },
  { value: "60",    label: "1 hour before" },
  { value: "1440",  label: "1 day before" },
];

const EMPTY_FORM = () => {
  const d = new Date(Date.now() + 60 * 60 * 1000); // default: 1 hour from now
  // Use local date (not UTC) to avoid next-day drift in UTC+X timezones
  const localDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const localTime = `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  return {
    title: "",
    date: localDate,
    time: localTime,
    recurring: "none",
    customDays: [],
    reminder: "none",
  };
};

// ── Gmail-style Email Chip Input ──────────────────────────────
function EmailChipInput({ chips, setChips, placeholder = "Type email and press Enter…" }) {
  const [inputVal, setInputVal] = useState("");
  const inputRef = useRef(null);

  const addChip = (raw) => {
    const emails = raw
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    const next = [...chips];
    emails.forEach((e) => { if (!next.includes(e)) next.push(e); });
    setChips(next);
  };

  const handleKeyDown = (e) => {
    if (["Enter", ",", "Tab"].includes(e.key)) {
      e.preventDefault();
      if (inputVal.trim()) { addChip(inputVal); setInputVal(""); }
    } else if (e.key === "Backspace" && !inputVal && chips.length > 0) {
      setChips(chips.slice(0, -1));
    }
  };

  const handleBlur = () => {
    if (inputVal.trim()) { addChip(inputVal); setInputVal(""); }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    addChip(e.clipboardData.getData("text"));
  };

  return (
    <div className="email-chip-container" onClick={() => inputRef.current?.focus()}>
      {chips.map((chip, i) => (
        <span className="email-chip" key={chip + i}>
          <span className="chip-text">{chip}</span>
          <button
            className="chip-remove"
            type="button"
            onClick={(e) => { e.stopPropagation(); setChips(chips.filter((_, j) => j !== i)); }}
          >×</button>
        </span>
      ))}
      <input
        ref={inputRef}
        className="chip-input"
        value={inputVal}
        onChange={(e) => setInputVal(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onPaste={handlePaste}
        placeholder={chips.length === 0 ? placeholder : ""}
      />
    </div>
  );
}

// ── 3-dot Card Context Menu ───────────────────────────────────
function CardMenu({ onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="card-menu-wrapper" ref={ref}>
      <button
        className="card-menu-btn"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        title="Options"
      >⋮</button>
      {open && (
        <div className="card-menu-dropdown">
          <button className="card-menu-item" onClick={() => { setOpen(false); onEdit(); }}>✏️ Edit</button>
          <button className="card-menu-item danger" onClick={() => { setOpen(false); onDelete(); }}>🗑️ Delete</button>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [meetings, setMeetings]     = useState([]);
  const [activeTab, setActiveTab]   = useState("upcoming");
  const [loading, setLoading]       = useState(true);
  const [scheduling, setScheduling] = useState(false);
  const [saving, setSaving]         = useState(false);

  const [showSchedule, setShowSchedule] = useState(false);
  const [showInstant,  setShowInstant]  = useState(false);
  const [showEdit,     setShowEdit]     = useState(false);
  const [editTarget,   setEditTarget]   = useState(null);

  const [form,        setForm]        = useState(EMPTY_FORM());
  const [emailChips,  setEmailChips]  = useState([]);
  const [editForm,    setEditForm]    = useState(EMPTY_FORM());
  const [instantName, setInstantName] = useState("");
  const [joinCode,    setJoinCode]    = useState("");

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    if (status === "authenticated") {
      setInstantName(session.user.name || "");
      loadMeetings();
    }
  }, [status]);

  const loadMeetings = async () => {
    setLoading(true);
    try {
      const res  = await fetch("/api/meetings");
      const data = await res.json();
      if (data.success) setMeetings(data.meetings);
    } catch {}
    setLoading(false);
  };

  const handleInstantMeeting = async () => {
    const name = (instantName || session?.user?.name || "Anonymous").trim();
    try {
      const res  = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `${name}'s Meeting`, host: name, instant: true }),
      });
      const data = await res.json();
      if (data.success) router.push(`/meeting?room=${data.meeting.id}&name=${encodeURIComponent(name)}`);
    } catch {}
  };

  const handleJoin = () => {
    let code = joinCode.trim();
    if (!code) return;
    if (code.includes("room=")) {
      try { code = new URL(code, window.location.origin).searchParams.get("room") || code; } catch {}
    }
    router.push(`/prejoin?room=${code}`);
  };

  const handleSchedule = async () => {
    if (!form.title.trim()) return alert("Please enter a meeting title");
    if (form.recurring === "custom" && form.customDays.length === 0)
      return alert("Please select at least one day for custom recurrence");
    setScheduling(true);
    const hostName = session?.user?.name || "Anonymous";
    const recurringValue = form.recurring === "custom"
      ? `custom:${form.customDays.join(",")}`
      : form.recurring;
    try {
      const res  = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title, host: hostName,
          date: form.date,   time: form.time,
          emails: emailChips.join(","),
          recurring: recurringValue,
          reminder: form.reminder,
        }),
      });
      const data = await res.json();
      if (data.success) {
        if (emailChips.length > 0) {
          await fetch("/api/invite", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ meetingId: data.meeting.id, emails: emailChips, hostName, recurring: recurringValue, reminder: form.reminder }),
          });
        }
        setShowSchedule(false); setForm(EMPTY_FORM()); setEmailChips([]);
        loadMeetings();
        const rl = recLabel(data.meeting.recurring);
        alert(
          `✅ Meeting scheduled!\n\n📋 Passcode: ${data.meeting.passcode}\n🔗 Link: ${data.meeting.link}` +
          (data.meeting.recurring && data.meeting.recurring !== "none" ? `\n🔁 Repeats: ${rl}` : "")
        );
      }
    } catch (e) { alert("Failed: " + e.message); }
    setScheduling(false);
  };

  const handleEdit = async () => {
    if (!editForm.title.trim() || !editTarget) return;
    if (editForm.recurring === "custom" && !(editForm.customDays || []).length)
      return alert("Please select at least one day for custom recurrence");
    setSaving(true);
    const recurringVal = editForm.recurring === "custom"
      ? `custom:${(editForm.customDays || []).join(",")}`
      : editForm.recurring;
    try {
      const res  = await fetch(`/api/meetings/${editTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editForm.title, date: editForm.date, time: editForm.time, recurring: recurringVal }),
      });
      const data = await res.json();
      if (data.success) { setShowEdit(false); setEditTarget(null); loadMeetings(); }
      else alert(data.error || "Failed to update");
    } catch (e) { alert("Failed: " + e.message); }
    setSaving(false);
  };

  const handleDelete = async (meeting) => {
    if (!confirm(`Delete "${meeting.title}"?\n\nThis cannot be undone.`)) return;
    try {
      const res  = await fetch(`/api/meetings/${meeting.id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) setMeetings((prev) => prev.filter((m) => m.id !== meeting.id));
      else alert(data.error || "Failed to delete");
    } catch (e) { alert("Failed: " + e.message); }
  };

  const openEditModal = (meeting) => {
    setEditTarget(meeting);
    const raw = meeting.recurring || "none";
    const isCustom = raw.startsWith("custom:");
    setEditForm({
      title: meeting.title,
      date: meeting.date || new Date().toISOString().split("T")[0],
      time: meeting.time || "09:00",
      recurring: isCustom ? "custom" : raw,
      customDays: isCustom ? raw.replace("custom:", "").split(",").filter(Boolean) : [],
    });
    setShowEdit(true);
  };

  const isHost   = (m) => m.host_email === session?.user?.email;
  // Past = 2 hours after scheduled time — gives a window to join even if slightly late
  const isPast   = (m) => {
    if (!m.date) return false;
    const end = new Date(`${m.date}T${m.time || "23:59"}:00`).getTime() + 2 * 60 * 60 * 1000;
    return end < Date.now();
  };
  const upcoming = meetings.filter((m) => !isPast(m));
  const past     = meetings.filter((m) => isPast(m));
  const hosted   = meetings.filter((m) => isHost(m));
  const filtered = activeTab === "upcoming" ? upcoming : past;

  const formatDate = (d, t) => {
    if (!d) return "Instant";
    return new Date(`${d}T${t || "00:00"}:00`).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  const recLabel = (val) => {
    if (!val || val === "none") return "";
    if (val.startsWith("custom:")) {
      const days = val.replace("custom:", "").split(",").filter(Boolean);
      return days.length ? `Every ${days.join(", ")}` : "Custom";
    }
    return RECURRENCE_OPTIONS.find((r) => r.value === val)?.label || val;
  };

  if (status === "loading") return <div className="dash-loading"><div className="loading-spinner"></div></div>;
  if (!session) return null;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <>
      <div className="bg-gradient">
        <div className="orb orb-1"></div><div className="orb orb-2"></div><div className="orb orb-3"></div>
      </div>

      <div className="dashboard-layout">
        {/* ── Sidebar ──────────────────────────────────── */}
        <aside className="dash-sidebar">
          <div className="dash-logo"><span>🎥</span> MeetFlow</div>
          <nav className="dash-nav">
            <button className="dash-nav-item active">📅 My Meetings</button>
            <button className="dash-nav-item" onClick={() => setShowInstant(true)}>⚡ New Meeting</button>
            <button className="dash-nav-item" onClick={() => setShowSchedule(true)}>📋 Schedule</button>
          </nav>
          <div className="dash-user">
            <img src={session.user.image || "/avatar-placeholder.png"} alt="" className="dash-avatar" />
            <div className="dash-user-info">
              <span className="dash-user-name">{session.user.name}</span>
              <span className="dash-user-email">{session.user.email}</span>
            </div>
            <button className="dash-signout" onClick={() => signOut({ callbackUrl: "/login" })} title="Sign out">↩</button>
          </div>
        </aside>

        {/* ── Main ─────────────────────────────────────── */}
        <main className="dash-main">
          {/* Header */}
          <div className="dash-header">
            <div>
              <h1>{greeting}, {session.user.name?.split(" ")[0]} 👋</h1>
              <p className="dash-subtitle">Manage your meetings, track attendance, and collaborate seamlessly.</p>
            </div>
            <div className="dash-header-actions">
              <button className="btn btn-secondary btn-sm" onClick={() => setShowInstant(true)}>⚡ Instant</button>
              <button className="btn btn-primary btn-sm"   onClick={() => setShowSchedule(true)}>📋 Schedule</button>
            </div>
          </div>

          {/* Stats */}
          {!loading && (
            <div className="stats-bar">
              <div className="stat-card"><div className="stat-icon">📊</div><div className="stat-number">{meetings.length}</div><div className="stat-label">Total Meetings</div></div>
              <div className="stat-card"><div className="stat-icon">🗓️</div><div className="stat-number">{upcoming.length}</div><div className="stat-label">Upcoming</div></div>
              <div className="stat-card"><div className="stat-icon">✅</div><div className="stat-number">{past.length}</div><div className="stat-label">Completed</div></div>
              <div className="stat-card"><div className="stat-icon">👑</div><div className="stat-number">{hosted.length}</div><div className="stat-label">Hosted by You</div></div>
            </div>
          )}

          {/* Quick join */}
          <div className="quick-join-bar">
            <input
              className="form-input"
              placeholder="Enter meeting code or paste invite link to join…"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              style={{ flex: 1 }}
            />
            <button className="btn btn-primary btn-sm" onClick={handleJoin}>🤝 Join</button>
          </div>

          {/* Tabs */}
          <div className="dash-tabs">
            <button className={`dash-tab ${activeTab === "upcoming" ? "active" : ""}`} onClick={() => setActiveTab("upcoming")}>
              Upcoming {upcoming.length > 0 && <span className="tab-badge">{upcoming.length}</span>}
            </button>
            <button className={`dash-tab ${activeTab === "past" ? "active" : ""}`} onClick={() => setActiveTab("past")}>
              Past {past.length > 0 && <span className="tab-badge">{past.length}</span>}
            </button>
          </div>

          {/* Meetings */}
          {loading ? (
            <div className="dash-loading-inline"><div className="loading-spinner"></div></div>
          ) : filtered.length === 0 ? (
            <div className="dash-empty">
              <div className="dash-empty-icon">{activeTab === "upcoming" ? "📅" : "🕐"}</div>
              <h3>{activeTab === "upcoming" ? "No upcoming meetings" : "No past meetings"}</h3>
              <p>{activeTab === "upcoming" ? "Schedule a meeting or start an instant session" : "Your completed meetings will appear here"}</p>
              {activeTab === "upcoming" && (
                <button className="btn btn-primary btn-sm" style={{ marginTop: 16 }} onClick={() => setShowSchedule(true)}>📋 Schedule a Meeting</button>
              )}
            </div>
          ) : (
            <div className="meetings-grid">
              {filtered.map((m) => (
                <div className="meeting-card" key={m.id}>
                  <div className="meeting-card-header">
                    <div className="meeting-card-icon">{isHost(m) ? "👑" : "📧"}</div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <div className="meeting-card-badge">{isHost(m) ? "Host" : "Invited"}</div>
                      {m.recurring && m.recurring !== "none" && (
                        <div className="recurring-badge">🔁 {recLabel(m.recurring)}</div>
                      )}
                      {isHost(m) && <CardMenu onEdit={() => openEditModal(m)} onDelete={() => handleDelete(m)} />}
                    </div>
                  </div>
                  <h3 className="meeting-card-title">{m.title}</h3>
                  <div className="meeting-card-meta">
                    <span>🕐 {formatDate(m.date, m.time)}</span>
                    <span>👤 {m.host_name}</span>
                    <span>🔑 Code: <strong>{m.id}</strong></span>
                    {m.passcode && <span>🔐 Passcode: <strong>{m.passcode}</strong></span>}
                  </div>
                  <div className="meeting-card-actions">
                    <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => router.push(`/prejoin?room=${m.id}`)}>Join Meeting</button>
                    <button className="btn btn-secondary btn-sm" title="Copy invite link" onClick={() => navigator.clipboard.writeText(m.link)}>🔗 Copy</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {/* ── Instant Meeting Modal ──────────────────── */}
      {showInstant && (
        <div className="modal-overlay active" onClick={(e) => e.target === e.currentTarget && setShowInstant(false)}>
          <div className="modal">
            <h2>⚡ Start Instant Meeting</h2>
            <p>Create a room right now and share the link with others.</p>
            <div className="form-group">
              <label>YOUR NAME</label>
              <input className="form-input" value={instantName} onChange={(e) => setInstantName(e.target.value)} placeholder="Enter your name" onKeyDown={(e) => e.key === "Enter" && handleInstantMeeting()} />
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
              <button className="btn btn-primary" onClick={handleInstantMeeting}>🚀 Start Now</button>
              <button className="btn btn-secondary" onClick={() => setShowInstant(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Schedule Modal ─────────────────────────── */}
      {showSchedule && (
        <div className="modal-overlay active" onClick={(e) => e.target === e.currentTarget && setShowSchedule(false)}>
          <div className="modal modal-scroll" style={{ maxWidth: 580 }}>
            <div className="modal-header">
              <div>
                <h2>📋 Schedule Meeting</h2>
                <p>Set up a meeting and send passcode-protected invites.</p>
              </div>
              <button className="modal-close" onClick={() => { setShowSchedule(false); setEmailChips([]); setForm(EMPTY_FORM()); }}>✕</button>
            </div>

            <div className="form-group">
              <label>MEETING TITLE</label>
              <input className="form-input" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Team Standup, Weekly Sync…" />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>DATE</label>
                <input type="date" className="form-input" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
              </div>
              <div className="form-group">
                <label>TIME</label>
                <input type="time" className="form-input" value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>REPEAT</label>
                <select className="form-input" value={form.recurring} onChange={(e) => setForm((f) => ({ ...f, recurring: e.target.value, customDays: [] }))}>
                  {RECURRENCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>REMINDER</label>
                <select className="form-input" value={form.reminder} onChange={(e) => setForm((f) => ({ ...f, reminder: e.target.value }))}>
                  {REMINDER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>

            {form.recurring === "custom" && (
              <div className="form-group">
                <label>PICK DAYS</label>
                <div className="day-picker">
                  {DAYS_OF_WEEK.map((d) => (
                    <button
                      key={d.key} type="button"
                      className={`day-pill${form.customDays.includes(d.key) ? " active" : ""}`}
                      onClick={() => setForm((f) => ({
                        ...f,
                        customDays: f.customDays.includes(d.key)
                          ? f.customDays.filter((x) => x !== d.key)
                          : [...f.customDays, d.key],
                      }))}
                    >{d.key}</button>
                  ))}
                </div>
                {form.customDays.length > 0 && (
                  <span className="field-hint">📅 Repeats every {form.customDays.join(", ")}</span>
                )}
              </div>
            )}

            <div className="form-group">
              <label>INVITE BY EMAIL</label>
              <EmailChipInput chips={emailChips} setChips={setEmailChips} />
              <span className="field-hint">Press Enter, comma, or Tab after each address • Paste multiple at once</span>
            </div>

            <div className="modal-footer">
              <p className="modal-hint">🔐 A 6-digit passcode is auto-generated for every invite.</p>
              <div className="modal-actions">
                <button className="btn btn-secondary btn-sm" onClick={() => { setShowSchedule(false); setEmailChips([]); setForm(EMPTY_FORM()); }}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={handleSchedule} disabled={scheduling}>
                  {scheduling ? "⏳ Scheduling…" : "📨 Schedule & Send Invites"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Modal ─────────────────────────────── */}
      {showEdit && editTarget && (
        <div className="modal-overlay active" onClick={(e) => e.target === e.currentTarget && setShowEdit(false)}>
          <div className="modal modal-scroll" style={{ maxWidth: 560 }}>
            <div className="modal-header">
              <div>
                <h2>✏️ Edit Meeting</h2>
                <p>Update details for <strong>{editTarget.title}</strong></p>
              </div>
              <button className="modal-close" onClick={() => { setShowEdit(false); setEditTarget(null); }}>✕</button>
            </div>
            <div className="form-group">
              <label>MEETING TITLE</label>
              <input className="form-input" value={editForm.title} onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>DATE</label>
                <input type="date" className="form-input" value={editForm.date} onChange={(e) => setEditForm((f) => ({ ...f, date: e.target.value }))} />
              </div>
              <div className="form-group">
                <label>TIME</label>
                <input type="time" className="form-input" value={editForm.time} onChange={(e) => setEditForm((f) => ({ ...f, time: e.target.value }))} />
              </div>
            </div>
            <div className="form-group">
              <label>REPEAT</label>
              <select className="form-input" value={editForm.recurring} onChange={(e) => setEditForm((f) => ({ ...f, recurring: e.target.value, customDays: [] }))}>
                {RECURRENCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            {editForm.recurring === "custom" && (
              <div className="form-group">
                <label>PICK DAYS</label>
                <div className="day-picker">
                  {DAYS_OF_WEEK.map((d) => (
                    <button
                      key={d.key} type="button"
                      className={`day-pill${(editForm.customDays || []).includes(d.key) ? " active" : ""}`}
                      onClick={() => setEditForm((f) => ({
                        ...f,
                        customDays: (f.customDays || []).includes(d.key)
                          ? (f.customDays || []).filter((x) => x !== d.key)
                          : [...(f.customDays || []), d.key],
                      }))}
                    >{d.key}</button>
                  ))}
                </div>
                {(editForm.customDays || []).length > 0 && (
                  <span className="field-hint">📅 Repeats every {(editForm.customDays || []).join(", ")}</span>
                )}
              </div>
            )}
            <div className="modal-footer">
              <div className="modal-actions">
                <button className="btn btn-secondary btn-sm" onClick={() => { setShowEdit(false); setEditTarget(null); }}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={handleEdit} disabled={saving}>
                  {saving ? "⏳ Saving…" : "✅ Save Changes"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
