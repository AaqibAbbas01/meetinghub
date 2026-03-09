import { auth } from "../../../../auth";
import { getSupabaseServer } from "../../../../lib/supabase-server";
import { NextResponse } from "next/server";

// GET /api/meetings/:id
export async function GET(req, { params }) {
  const { id } = await params;
  const db = getSupabaseServer();

  const { data, error } = await db
    .from("meetings")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ success: false, error: "Meeting not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, meeting: data });
}

// PATCH /api/meetings/:id — update title, date, time, recurring
export async function PATCH(req, { params }) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { title, date, time, recurring } = body;

  const db = getSupabaseServer();

  // Verify ownership
  const { data: meeting } = await db.from("meetings").select("host_email").eq("id", id).single();
  if (!meeting || meeting.host_email !== session.user.email) {
    return NextResponse.json({ success: false, error: "Not authorized to edit this meeting" }, { status: 403 });
  }

  const updates = {};
  if (title !== undefined) updates.title = title;
  if (date !== undefined) updates.date = date;
  if (time !== undefined) updates.time = time;
  if (recurring !== undefined) updates.recurring = recurring;

  const { data, error } = await db.from("meetings").update(updates).eq("id", id).select().single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, meeting: data });
}

// DELETE /api/meetings/:id
export async function DELETE(req, { params }) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getSupabaseServer();

  // Verify ownership
  const { data: meeting } = await db.from("meetings").select("host_email").eq("id", id).single();
  if (!meeting || meeting.host_email !== session.user.email) {
    return NextResponse.json({ success: false, error: "Not authorized to delete this meeting" }, { status: 403 });
  }

  // Delete attendees first (FK constraint)
  await db.from("attendees").delete().eq("meeting_id", id);

  // Delete meeting
  const { error } = await db.from("meetings").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
