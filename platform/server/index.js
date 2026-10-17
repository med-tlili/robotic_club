// ============================================================
//  index.js — ISIGK Robotics Club API + Socket.io
// ============================================================
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const db = require('./db'); // initializes schema + seed
const { setIO } = require('./notify');
const { JWT_SECRET } = require('./middleware/auth');
const {
  PUBLIC_DIR, PRIVATE_DIR, ensureDirs, verifySignedUpload, migrateLegacyUploads,
} = require('./storage');

const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const deptRoutes = require('./routes/departments');
const goalsRoutes = require('./routes/goals');
const postsRoutes = require('./routes/posts');
const eventsRoutes = require('./routes/events');
const applicationsRoutes = require('./routes/applications');
const tasksRoutes = require('./routes/tasks');
const notificationsRoutes = require('./routes/notifications');
const chatRoutes = require('./routes/chat');
const reportsRoutes = require('./routes/reports');
const mediaRoutes = require('./routes/media');
const hrRoutes = require('./routes/hr');
const plansRoutes = require('./routes/plans');
const financeRoutes = require('./routes/finance');
const storageRoutes = require('./routes/storage');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// Uploaded media (see storage.js):
//  - /uploads/public  → feed images (published content, guests may view)
//  - /uploads/private → album photos & chat attachments (signed URLs only)
ensureDirs();
migrateLegacyUploads(db);
app.use('/uploads/public', express.static(PUBLIC_DIR));
app.use('/uploads/private', verifySignedUpload, express.static(PRIVATE_DIR));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/departments', deptRoutes);
app.use('/api/goals', goalsRoutes);
app.use('/api/posts', postsRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/applications', applicationsRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/hr', hrRoutes);
app.use('/api/plans', plansRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/storage', storageRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', club: 'ISIGK Robotics' }));

// Socket.io — authenticated via JWT; each user joins room 'user:<id>'
// so notifications and chat can be pushed live.
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Missing token'));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const fresh = db.prepare('SELECT id, full_name, role, department_id FROM users WHERE id = ?').get(payload.id);
    if (!fresh) return next(new Error('Account no longer exists'));
    socket.user = fresh;
    next();
  } catch {
    next(new Error('Invalid or expired token'));
  }
});
io.on('connection', (socket) => {
  const u = socket.user;
  socket.join(`user:${u.id}`);
  // group chat rooms the user belongs to — joined automatically
  chatRoutes.roomsForUser(u).forEach((key) => socket.join(`room:${key}`));
  // DM rooms joined on demand when the client opens a private conversation
  socket.on('chat:join', (key) => {
    if (String(key).startsWith('private:')) {
      socket.join(chatRoutes.dmRoom(u.id, Number(String(key).split(':')[1])));
    }
  });
  socket.on('chat:leave', (key) => {
    if (String(key).startsWith('private:')) {
      socket.leave(chatRoutes.dmRoom(u.id, Number(String(key).split(':')[1])));
    }
  });
  socket.on('disconnect', () => {});
});
app.set('io', io);
setIO(io);

// ---- production: serve the built client (single-process deploy) ----
// In dev the Vite server on :5173 does this; in production `npm run build`
// emits client/dist which we serve here with an SPA fallback for react-router.
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist));
  // SPA fallback: any non-API GET returns index.html (client router takes over)
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/socket.io')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`🤖 ISIGK Robotics API running on http://localhost:${PORT}`));
