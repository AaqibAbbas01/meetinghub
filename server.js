require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 1e6,
  pingTimeout: 30000,
  pingInterval: 10000,
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Serve React build in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'client', 'dist')));
}

// ─── In-Memory Storage ───────────────────────────────────────────
const meetings = new Map();   // meetingId -> { id, title, date, time, host, participants, createdAt }
const rooms = new Map();      // roomId -> Set of socket ids

// ─── Email Transporter ──────────────────────────────────────────
let transporter = null;
if (process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  console.log('📧 Email transporter configured');
} else {
  console.log('📧 Email not configured — invites will be logged to console');
}

// ─── API Routes ─────────────────────────────────────────────────

// Create a new instant meeting
app.post('/api/meetings', (req, res) => {
  const { title, date, time, host, attendees } = req.body;
  const id = uuidv4().split('-')[0]; // short 8-char code
  const meeting = {
    id,
    title: title || 'Instant Meeting',
    date: date || new Date().toISOString().split('T')[0],
    time: time || new Date().toTimeString().split(' ')[0].slice(0, 5),
    host: host || 'Anonymous',
    attendees: attendees || [],
    createdAt: new Date().toISOString(),
    link: `http://localhost:5173/meeting?room=${id}`
  };
  meetings.set(id, meeting);
  res.json({ success: true, meeting });
});

// Get meeting details
app.get('/api/meetings/:id', (req, res) => {
  const meeting = meetings.get(req.params.id);
  if (!meeting) {
    return res.status(404).json({ success: false, error: 'Meeting not found' });
  }
  res.json({ success: true, meeting });
});

// List all meetings
app.get('/api/meetings', (req, res) => {
  const list = Array.from(meetings.values()).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
  res.json({ success: true, meetings: list });
});

// Send email invitation
app.post('/api/invite', async (req, res) => {
  const { meetingId, emails, hostName } = req.body;
  const meeting = meetings.get(meetingId);

  if (!meeting) {
    return res.status(404).json({ success: false, error: 'Meeting not found' });
  }

  if (!emails || !emails.length) {
    return res.status(400).json({ success: false, error: 'No email addresses provided' });
  }

  const meetingLink = meeting.link;

  const emailHTML = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #1a1a2e; border-radius: 16px; overflow: hidden;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 32px; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">🎥 MeetFlow</h1>
        <p style="color: rgba(255,255,255,0.9); margin-top: 8px;">You've been invited to a meeting</p>
      </div>
      <div style="padding: 32px; color: #e0e0e0;">
        <h2 style="color: #667eea; margin-top: 0;">${meeting.title}</h2>
        <div style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 20px; margin: 20px 0;">
          <p style="margin: 8px 0;">📅 <strong>Date:</strong> ${meeting.date}</p>
          <p style="margin: 8px 0;">🕐 <strong>Time:</strong> ${meeting.time}</p>
          <p style="margin: 8px 0;">👤 <strong>Host:</strong> ${hostName || meeting.host}</p>
        </div>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${meetingLink}" style="display: inline-block; background: linear-gradient(135deg, #667eea, #764ba2); color: white; text-decoration: none; padding: 14px 40px; border-radius: 30px; font-weight: 600; font-size: 16px;">
            Join Meeting
          </a>
        </div>
        <p style="color: #888; font-size: 13px; text-align: center;">Meeting Code: <strong>${meeting.id}</strong></p>
      </div>
    </div>
  `;

  if (transporter) {
    try {
      await transporter.sendMail({
        from: `"MeetFlow" <${process.env.SMTP_USER}>`,
        to: emails.join(', '),
        subject: `Meeting Invitation: ${meeting.title}`,
        html: emailHTML,
      });
      console.log(`📧 Invitation sent to: ${emails.join(', ')}`);
      res.json({ success: true, message: 'Invitations sent successfully' });
    } catch (err) {
      console.error('Email error:', err);
      res.status(500).json({ success: false, error: 'Failed to send email' });
    }
  } else {
    console.log('\n═══════════════════════════════════════');
    console.log('📧 EMAIL INVITATION (SMTP not configured)');
    console.log('═══════════════════════════════════════');
    console.log(`To: ${emails.join(', ')}`);
    console.log(`Subject: Meeting Invitation: ${meeting.title}`);
    console.log(`Meeting Link: ${meetingLink}`);
    console.log(`Date: ${meeting.date} | Time: ${meeting.time}`);
    console.log('═══════════════════════════════════════\n');
    res.json({ success: true, message: 'Invitation logged to console (SMTP not configured)' });
  }
});

// ─── Google OAuth Callback ──────────────────────────────────────
app.get('/auth/google/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.redirect(`http://localhost:5173?google_error=${encodeURIComponent(error)}`);
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await tokenRes.json();

    if (!tokenRes.ok) {
      return res.redirect(`http://localhost:5173?google_error=${encodeURIComponent(tokens.error_description || tokens.error)}`);
    }

    // Redirect back to client with access token in URL fragment
    res.redirect(`http://localhost:5173?google_access_token=${encodeURIComponent(tokens.access_token)}`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect(`http://localhost:5173?google_error=server_error`);
  }
});

// ─── Google Calendar API Route ──────────────────────────────────
app.post('/api/calendar/create-event', async (req, res) => {
  const { title, date, time, duration, meetingLink, attendees, accessToken } = req.body;

  if (!accessToken) {
    return res.status(401).json({ success: false, error: 'Google access token required' });
  }

  try {
    const startDateTime = new Date(`${date}T${time}:00`);
    const endDateTime = new Date(startDateTime.getTime() + (duration || 60) * 60 * 1000);

    const event = {
      summary: title,
      description: `MeetFlow Video Meeting\n\nJoin here: ${meetingLink}`,
      start: {
        dateTime: startDateTime.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      end: {
        dateTime: endDateTime.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      attendees: (attendees || []).map(email => ({ email })),
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 10 },
          { method: 'email', minutes: 30 },
        ],
      },
    };

    const response = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      }
    );

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ success: false, error: err.error?.message || 'Failed to create event' });
    }

    const data = await response.json();
    res.json({ success: true, event: data });
  } catch (err) {
    console.error('Calendar error:', err);
    res.status(500).json({ success: false, error: 'Failed to create calendar event' });
  }
});

// ─── Catch-all for React SPA routing (production) ───────────────
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'dist', 'index.html'));
  });
}

// ─── Socket.io Signaling ────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`🔌 User connected: ${socket.id}`);

  // Join a room
  socket.on('join-room', ({ roomId, userName }) => {
    socket.join(roomId);
    socket.roomId = roomId;
    socket.userName = userName || 'Anonymous';

    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Map());
    }
    rooms.get(roomId).set(socket.id, { id: socket.id, name: socket.userName });

    // Notify others in the room
    socket.to(roomId).emit('user-joined', {
      userId: socket.id,
      userName: socket.userName,
      participants: Array.from(rooms.get(roomId).values())
    });

    // Send existing participants to the joiner
    socket.emit('room-users', {
      participants: Array.from(rooms.get(roomId).values())
    });

    console.log(`👤 ${socket.userName} joined room ${roomId} (${rooms.get(roomId).size} users)`);
  });

  // WebRTC Signaling
  socket.on('offer', ({ to, offer }) => {
    socket.to(to).emit('offer', { from: socket.id, offer, userName: socket.userName });
  });

  socket.on('answer', ({ to, answer }) => {
    socket.to(to).emit('answer', { from: socket.id, answer });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    socket.to(to).emit('ice-candidate', { from: socket.id, candidate });
  });

  // Screen sharing notifications
  socket.on('screen-share-started', ({ roomId }) => {
    socket.to(roomId).emit('screen-share-started', { userId: socket.id, userName: socket.userName });
  });

  socket.on('screen-share-stopped', ({ roomId }) => {
    socket.to(roomId).emit('screen-share-stopped', { userId: socket.id });
  });

  // Whiteboard events
  socket.on('whiteboard-draw', ({ roomId, data }) => {
    socket.to(roomId).emit('whiteboard-draw', { userId: socket.id, data });
  });

  socket.on('whiteboard-clear', ({ roomId }) => {
    socket.to(roomId).emit('whiteboard-clear', { userId: socket.id });
  });

  socket.on('whiteboard-undo', ({ roomId, data }) => {
    socket.to(roomId).emit('whiteboard-undo', { userId: socket.id, data });
  });

  // Text board events
  socket.on('textboard-update', ({ roomId, content }) => {
    socket.to(roomId).emit('textboard-update', { userId: socket.id, content });
  });

  // Chat messages
  socket.on('chat-message', ({ roomId, message }) => {
    io.to(roomId).emit('chat-message', {
      userId: socket.id,
      userName: socket.userName,
      message,
      timestamp: new Date().toISOString()
    });
  });

  // Recording notification
  socket.on('recording-started', ({ roomId }) => {
    socket.to(roomId).emit('recording-started', { userName: socket.userName });
  });

  socket.on('recording-stopped', ({ roomId }) => {
    socket.to(roomId).emit('recording-stopped', { userName: socket.userName });
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (socket.roomId && rooms.has(socket.roomId)) {
      rooms.get(socket.roomId).delete(socket.id);
      if (rooms.get(socket.roomId).size === 0) {
        rooms.delete(socket.roomId);
      } else {
        socket.to(socket.roomId).emit('user-left', {
          userId: socket.id,
          userName: socket.userName,
          participants: Array.from(rooms.get(socket.roomId).values())
        });
      }
    }
    console.log(`🔌 User disconnected: ${socket.id}`);
  });
});

// ─── Start Server ───────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🚀 MeetFlow server running at http://localhost:${PORT}\n`);
});
