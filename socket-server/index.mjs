import { createServer } from 'http';
import { Server } from 'socket.io';

const httpServer = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.writeHead(200);
  res.end('SkillsXAI Meet Socket Server is running ✅');
});

const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 1e8,
});

const rooms = new Map();

io.on('connection', (socket) => {
  console.log(`🔌 Connected: ${socket.id}`);

  socket.on('join-room', ({ roomId, userName }) => {
    socket.join(roomId);
    socket.roomId = roomId;
    socket.userName = userName || 'Anonymous';

    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    rooms.get(roomId).set(socket.id, { id: socket.id, name: socket.userName });

    // Tell the new user about everyone already in the room
    socket.emit('room-users', {
      participants: Array.from(rooms.get(roomId).values()),
    });

    // Tell everyone else a new user joined
    socket.to(roomId).emit('user-joined', {
      userId: socket.id,
      userName: socket.userName,
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

  socket.on('whiteboard-undo', ({ roomId }) => {
    socket.to(roomId).emit('whiteboard-undo', { userId: socket.id });
  });

  socket.on('textboard-update', ({ roomId, content }) => {
    socket.to(roomId).emit('textboard-update', { userId: socket.id, content });
  });

  socket.on('chat-message', ({ roomId, message }) => {
    io.to(roomId).emit('chat-message', {
      userId: socket.id,
      userName: socket.userName,
      message,
      timestamp: new Date().toISOString(),
    });
  });

  socket.on('recording-started', ({ roomId }) => {
    socket.to(roomId).emit('recording-started', { userName: socket.userName });
  });

  socket.on('recording-stopped', ({ roomId }) => {
    socket.to(roomId).emit('recording-stopped', { userName: socket.userName });
  });

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
        });
      }
    }
    console.log(`🔌 Disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`🚀 SkillsXAI Meet Socket Server running on port ${PORT}`);
});
