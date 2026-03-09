"use client";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

function PreJoinPageInner() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const router = useRouter();
  const roomId = searchParams.get("room");

  const [meeting, setMeeting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!roomId) { router.push("/dashboard"); return; }
    fetch(`/api/meetings/${roomId}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) setMeeting(d.meeting);
        else setError("Meeting not found");
      })
      .catch(() => setError("Failed to load meeting"))
      .finally(() => setLoading(false));
  }, [roomId]);

  useEffect(() => {
    if (session?.user?.name) setName(session.user.name);
  }, [session]);

  const handleJoin = async () => {
    const trimmedName = name.trim();
    const trimmedPasscode = passcode.trim();
    if (!trimmedName) { setError("Please enter your name"); return; }
    if (!trimmedPasscode) { setError("Please enter the passcode"); return; }

    setJoining(true);
    setError("");
    try {
      const res = await fetch(`/api/meetings/${roomId}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: trimmedPasscode, email: session?.user?.email }),
      });
      const data = await res.json();
      if (data.success) {
        router.push(`/meeting?room=${roomId}&name=${encodeURIComponent(trimmedName)}`);
      } else {
        setError(data.error || "Invalid passcode. Please check your invite email.");
      }
    } catch {
      setError("Connection error. Please try again.");
    }
    setJoining(false);
  };

  const formatDate = (d, t) => {
    if (!d) return "Instant Meeting";
    const date = new Date(`${d}T${t || "00:00"}:00`);
    return date.toLocaleString([], { weekday: "long", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  if (loading) return (
    <div className="prejoin-loading">
      <div className="loading-spinner"></div>
      <p>Loading meeting details...</p>
    </div>
  );

  return (
    <>
      <div className="bg-gradient"><div className="orb orb-1"></div><div className="orb orb-2"></div><div className="orb orb-3"></div></div>

      <div className="prejoin-container">
        <div className="prejoin-logo"><span>🎥</span> SkillsXAI Meet</div>

        <div className="prejoin-card">
          {meeting ? (
            <>
              <div className="prejoin-meeting-info">
                <div className="prejoin-meeting-icon">📹</div>
                <h2>{meeting.title}</h2>
                <div className="prejoin-meta">
                  <span>🕐 {formatDate(meeting.date, meeting.time)}</span>
                  <span>👤 Hosted by {meeting.host_name}</span>
                </div>
              </div>

              <div className="prejoin-divider"></div>

              <div className="prejoin-form">
                <h3>Enter Meeting</h3>
                <p>Provide your details to join this meeting.</p>

                <div className="form-group">
                  <label>Your Full Name</label>
                  <input
                    className="form-input"
                    placeholder="Enter your name"
                    value={name}
                    onChange={e => setName(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label>Meeting Passcode</label>
                  <input
                    className="form-input passcode-input"
                    placeholder="Enter 6-digit passcode"
                    value={passcode}
                    onChange={e => setPasscode(e.target.value)}
                    maxLength={10}
                    onKeyDown={e => e.key === "Enter" && handleJoin()}
                  />
                  <p className="passcode-hint">📧 Check your invite email for the passcode</p>
                </div>

                {error && <div className="prejoin-error">❌ {error}</div>}

                <button
                  className="btn btn-primary"
                  onClick={handleJoin}
                  disabled={joining}
                  style={{ marginTop: 8 }}
                >
                  {joining ? "Verifying..." : "🚀 Join Meeting"}
                </button>

                <button
                  className="btn btn-secondary"
                  onClick={() => router.push("/dashboard")}
                  style={{ marginTop: 8 }}
                >
                  ← Back to Dashboard
                </button>
              </div>
            </>
          ) : (
            <div className="prejoin-not-found">
              <div style={{ fontSize: 48 }}>😕</div>
              <h2>Meeting Not Found</h2>
              <p>This meeting link may be invalid or the meeting may have been removed.</p>
              <button className="btn btn-primary btn-sm" onClick={() => router.push("/dashboard")} style={{ marginTop: 16 }}>
                Go to Dashboard
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default function PreJoinPage() {
  return (
    <Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#fff", background: "#1a1a2e" }}>Loading...</div>}>
      <PreJoinPageInner />
    </Suspense>
  );
}
