import { auth } from "../../../auth";
import { getSupabaseServer } from "../../../lib/supabase-server";
import { v4 as uuidv4 } from "uuid";
import { NextResponse } from "next/server";

function generatePasscode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// GET /api/meetings — list meetings for current user
export async function GET(req) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const db = getSupabaseServer();

  // Meetings hosted by user
  const { data: hosted } = await db
    .from("meetings")
    .select("*")
    .eq("host_email", session.user.email)
    .order("created_at", { ascending: false });

  // Meetings user is invited to
  const { data: attendeeRows } = await db
    .from("attendees")
    .select("meeting_id")
    .eq("email", session.user.email);

  const invitedIds = (attendeeRows || []).map(r => r.meeting_id);
  let invited = [];
  if (invitedIds.length > 0) {
    const { data } = await db.from("meetings").select("*").in("id", invitedIds).order("created_at", { ascending: false });
    invited = data || [];
  }

  // Merge & deduplicate
  const all = [...(hosted || []), ...invited];
  const seen = new Set();
  const meetings = all.filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; });
  meetings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return NextResponse.json({ success: true, meetings });
}

// POST /api/meetings — create a meeting
export async function POST(req) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { title, host, date, time, emails, instant, recurring } = body;

  const id = uuidv4().split("-")[0];
  const passcode = generatePasscode();
  const link = `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/prejoin?room=${id}`;

  const db = getSupabaseServer();

  // Local date helper (avoids UTC-vs-local mismatch)
  const localDate = () => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`;
  };
  const localTime = () => {
    const n = new Date();
    return `${String(n.getHours()).padStart(2,"0")}:${String(n.getMinutes()).padStart(2,"0")}`;
  };

  const meeting = {
    id,
    title: title || `${host || "Anonymous"}'s Meeting`,
    date: date || localDate(),
    time: time || localTime(),
    host_name: host || session.user.name || "Anonymous",
    host_email: session.user.email,
    passcode,
    link,
    instant: !!instant,
    recurring: recurring || "none",
    created_at: new Date().toISOString(),
  };

  // Try full insert; if optional columns (recurring, etc.) don't exist yet, retry with core fields
  let { error } = await db.from("meetings").insert(meeting);
  if (error) {
    console.warn("Full insert failed:", error.message, "— retrying with core fields…");
    const { recurring: _r, ...core } = meeting;
    const { error: err2 } = await db.from("meetings").insert(core);
    if (err2) {
      console.error("Core insert also failed:", err2.message);
      return NextResponse.json({ success: false, error: "Database error: " + err2.message }, { status: 500 });
    }
  }

  // Add invited emails to attendees table
  const emailList = emails ? emails.split(",").map(e => e.trim()).filter(Boolean) : [];
  if (emailList.length > 0) {
    const rows = emailList.map(email => ({ meeting_id: id, email }));
    await db.from("attendees").insert(rows);
  }

  return NextResponse.json({ success: true, meeting });
}
