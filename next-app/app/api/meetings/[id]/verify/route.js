import { getSupabaseServer } from "../../../../../lib/supabase-server";
import { NextResponse } from "next/server";

// POST /api/meetings/:id/verify
export async function POST(req, { params }) {
  const { id } = await params;
  const { passcode, email } = await req.json();

  if (!passcode) {
    return NextResponse.json({ success: false, error: "Passcode is required" }, { status: 400 });
  }

  const db = getSupabaseServer();
  const { data: meeting, error } = await db.from("meetings").select("*").eq("id", id).single();

  if (error || !meeting) {
    return NextResponse.json({ success: false, error: "Meeting not found" }, { status: 404 });
  }

  // Verify passcode
  if (meeting.passcode !== passcode) {
    return NextResponse.json({ success: false, error: "Incorrect passcode" }, { status: 403 });
  }

  // Track who joined (best-effort — doesn't block entry)
  if (email) {
    const isHost = meeting.host_email === email;
    if (!isHost) {
      // Mark as joined if they're an invited attendee
      await db.from("attendees").update({ joined: true }).eq("meeting_id", id).eq("email", email);
    }
  }

  return NextResponse.json({ success: true, meeting: { id: meeting.id, title: meeting.title, host_name: meeting.host_name } });
}
