import { getSupabaseServer } from "../../../lib/supabase-server";
import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

const getRecurrenceLabel = (r) => {
  if (!r || r === "none") return null;
  if (r.startsWith("custom:")) {
    const days = r.replace("custom:", "").split(",").filter(Boolean);
    return days.length ? `Every ${days.join(", ")}` : null;
  }
  return { daily: "Daily", weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly" }[r] || null;
};

const REMINDER_LABELS = {
  "15":   "15 minutes before",
  "30":   "30 minutes before",
  "60":   "1 hour before",
  "1440": "1 day before",
};

export async function POST(req) {
  const { meetingId, emails, hostName, recurring, reminder } = await req.json();

  const db = getSupabaseServer();
  const { data: meeting } = await db.from("meetings").select("*").eq("id", meetingId).single();

  if (!meeting) {
    return NextResponse.json({ success: false, error: "Meeting not found" }, { status: 404 });
  }

  const emailHtml = (email) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Inter', Arial, sans-serif; background: #0a0a1a; color: #f0f0f5; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 40px auto; background: rgba(255,255,255,0.04); border-radius: 16px; border: 1px solid rgba(255,255,255,0.08); overflow: hidden; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 32px 40px; text-align: center; }
    .header h1 { margin: 0; font-size: 28px; font-weight: 800; color: white; }
    .body { padding: 32px 40px; }
    .detail-row { display: flex; gap: 12px; margin-bottom: 12px; align-items: center; }
    .detail-label { color: #9090b0; font-size: 13px; min-width: 100px; }
    .detail-value { font-weight: 600; font-size: 15px; }
    .passcode-box { background: rgba(102,126,234,0.15); border: 1px solid rgba(102,126,234,0.4); border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0; }
    .passcode-box .label { font-size: 12px; color: #9090b0; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
    .passcode-box .code { font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #667eea; }
    .join-btn { display: block; background: linear-gradient(135deg, #667eea, #764ba2); color: white; text-decoration: none; padding: 16px 40px; border-radius: 50px; font-weight: 700; font-size: 16px; text-align: center; margin: 24px 0; }
    .footer { padding: 20px 40px; border-top: 1px solid rgba(255,255,255,0.08); text-align: center; font-size: 12px; color: #606080; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎥 SkillsXAI Meet Invitation</h1>
    </div>
    <div class="body">
      <p>Hi there! <strong>${hostName}</strong> has invited you to join a meeting.</p>
      <div class="detail-row"><span class="detail-label">📋 Meeting</span><span class="detail-value">${meeting.title}</span></div>
      <div class="detail-row"><span class="detail-label">📅 Date</span><span class="detail-value">${meeting.date}</span></div>
      <div class="detail-row"><span class="detail-label">🕐 Time</span><span class="detail-value">${meeting.time}</span></div>
      <div class="detail-row"><span class="detail-label">👤 Host</span><span class="detail-value">${hostName}</span></div>
      ${getRecurrenceLabel(recurring) ? `<div class="detail-row"><span class="detail-label">🔁 Repeats</span><span class="detail-value">${getRecurrenceLabel(recurring)}</span></div>` : ""}
      ${reminder && REMINDER_LABELS[reminder] ? `<div class="detail-row"><span class="detail-label">⏰ Reminder</span><span class="detail-value">${REMINDER_LABELS[reminder]} — please set a calendar alert</span></div>` : ""}
      
      <div class="passcode-box">
        <div class="label">🔐 Your Meeting Passcode</div>
        <div class="code">${meeting.passcode}</div>
        <p style="font-size:12px;color:#9090b0;margin-top:8px;">Keep this passcode safe — you'll need it to join.</p>
      </div>

      <a href="${meeting.link}" class="join-btn">🚀 Join Meeting</a>
      
      <p style="font-size:13px;color:#9090b0;">Or copy this link: <span style="color:#667eea">${meeting.link}</span></p>
    </div>
    <div class="footer">
      Powered by SkillsXAI Meet — Professional Video Meetings
    </div>
  </div>
</body>
</html>`;

  const configured = process.env.SMTP_USER && process.env.SMTP_PASS;

  if (!configured) {
    console.log("\n═══════════════════════════════════════");
    console.log("📧 EMAIL INVITATIONS (SMTP not configured)");
    console.log("═══════════════════════════════════════");
    emails.forEach(email => {
      console.log(`To: ${email}`);
      console.log(`Meeting: ${meeting.title}`);
      console.log(`Date: ${meeting.date} at ${meeting.time}`);
      console.log(`Passcode: ${meeting.passcode}`);
      console.log(`Link: ${meeting.link}`);
      console.log("═══════════════════════════════════════");
    });
    return NextResponse.json({ success: true, message: "Invitations logged (SMTP not configured)" });
  }

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

    await Promise.all(emails.map(email =>
      transporter.sendMail({
        from: `"SkillsXAI Meet" <${process.env.SMTP_USER}>`,
        to: email,
        subject: `Meeting Invitation: ${meeting.title}`,
        html: emailHtml(email),
      })
    ));

    return NextResponse.json({ success: true, message: `Sent to ${emails.length} recipient(s)` });
  } catch (err) {
    console.error("Email error:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
