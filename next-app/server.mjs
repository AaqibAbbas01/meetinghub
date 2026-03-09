import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { Server } from 'socket.io';
import nodemailer from 'nodemailer';
import { v4 as uuidv4 } from 'uuid';

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

// In-Memory Storage
const meetings = new Map();
const rooms = new Map();

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      const { pathname } = parsedUrl;

      // API Routes handled by Next.js normally, but we can intercept if we want to
      if (pathname === '/api/meetings' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(body); } catch { return res.writeHead(400).end(); }
          const { title, date, time, host, attendees } = parsed;
          const id = uuidv4().split('-')[0];
          const meeting = {
            id,
            title: title || 'Instant Meeting',
            date: date || new Date().toISOString().split('T')[0],
            time: time || new Date().toTimeString().split(' ')[0].slice(0, 5),
            host: host || 'Anonymous',
            attendees: attendees || [],
            createdAt: new Date().toISOString(),
            link: `http://${req.headers.host}/meeting?room=${id}`
          };
          meetings.set(id, meeting);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, meeting }));
        });
        return;
      }

      if (pathname === '/api/meetings' && req.method === 'GET') {
        const list = Array.from(meetings.values()).sort(
          (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, meetings: list }));
        return;
      }

      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  const io = new Server(server, {
    cors: { origin: '*' },
    maxHttpBufferSize: 1e8
  });

  io.on('connection', (socket) => {
    console.log(`🔌 User connected: ${socket.id}`);

    socket.on('join-room', ({ roomId, userName }) => {
      socket.join(roomId);
      socket.roomId = roomId;
      socket.userName = userName || 'Anonymous';

      if (!rooms.has(roomId)) {
        rooms.set(roomId, new Map());
      }
      rooms.get(roomId).set(socket.id, { id: socket.id, name: socket.userName });

      socket.to(roomId).emit('user-joined', {
        userId: socket.id,
        userName: socket.userName,
        participants: Array.from(rooms.get(roomId).values())
      });

      socket.emit('room-users', {
        participants: Array.from(rooms.get(roomId).values())
      });
      console.log(`👤 ${socket.userName} joined room ${roomId} (${rooms.get(roomId).size} users)`);
    });

    socket.on('offer', ({ to, offer }) => {
      socket.to(to).emit('offer', { from: socket.id, offer, userName: socket.userName });
    });

    socket.on('answer', ({ to, answer }) => {
      socket.to(to).emit('answer', { from: socket.id, answer });
    });

    socket.on('ice-candidate', ({ to, candidate }) => {
      socket.to(to).emit('ice-candidate', { from: socket.id, candidate });
    });

    socket.on('screen-share-started', ({ roomId }) => {
      socket.to(roomId).emit('screen-share-started', { userId: socket.id, userName: socket.userName });
    });

    socket.on('screen-share-stopped', ({ roomId }) => {
      socket.to(roomId).emit('screen-share-stopped', { userId: socket.id });
    });

    socket.on('whiteboard-draw', ({ roomId, data }) => {
      socket.to(roomId).emit('whiteboard-draw', { userId: socket.id, data });
    });

    socket.on('whiteboard-clear', ({ roomId }) => {
      socket.to(roomId).emit('whiteboard-clear', { userId: socket.id });
    });

    socket.on('whiteboard-undo', ({ roomId, data }) => {
      socket.to(roomId).emit('whiteboard-undo', { userId: socket.id, data });
    });

    socket.on('textboard-update', ({ roomId, content }) => {
      socket.to(roomId).emit('textboard-update', { userId: socket.id, content });
    });

    socket.on('chat-message', ({ roomId, message }) => {
      io.to(roomId).emit('chat-message', {
        userId: socket.id,
        userName: socket.userName,
        message,
        timestamp: new Date().toISOString()
      });
    });

    socket.on('recording-started', ({ roomId }) => {
      socket.to(roomId).emit('recording-started', { userName: socket.userName });
    });

    socket.on('recording-stopped', ({ roomId }) => {
      socket.to(roomId).emit('recording-stopped', { userName: socket.userName });
    });

    // Code compiler sync — broadcast code changes to all other participants in room
    socket.on('code-update', ({ roomId, content, language }) => {
      socket.to(roomId).emit('code-update', { userId: socket.id, content, language });
    });

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

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
