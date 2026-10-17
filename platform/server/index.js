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
  BLOB, servePublicUpload, servePrivateUpload,
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

// On Vercel the app runs as several function instances — the Redis adapter
// makes chat/notification events reach sockets connected to OTHER instances.
// Local / single-instance (no REDIS_URL) keeps the in-memory adapter.
const REDIS_URL = process.env.REDIS_URL || '';
if (REDIS_URL) {
  const { createAdapter } = require('@socket.io/redis-adapter');
  const { Redis } = require('ioredis');
  const pubClient = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  const subClient = pubClient.duplicate();
  io.adapter(createAdapter(pubClient, subClient));
  console.log('Socket.io: Redis adapter active (multi-instance)');
}

app.use(cors());
app.use(express.json());

// Uploaded media (see storage.js):
//  - /uploads/public  → feed images (published content, guests may view)
//  - /uploads/private → album photos & chat attachments (signed URLs only)
ensureDirs();
if (BLOB) {
  // cloud backend: serve straight out of Blob (public redirects, private proxied)
  app.use('/uploads/public', (req, res) => servePublicUpload(req, res));
  app.use('/uploads/private', verifySignedUpload, (req, res) => servePrivateUpload(req, res));
} else {
  app.use('/uploads/public', express.static(PUBLIC_DIR));
  app.use('/uploads/private', verifySignedUpload, express.static(PRIVATE_DIR));
}

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
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Missing token'));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const fresh = await db.prepare('SELECT id, full_name, role, department_id FROM users WHERE id = ?').get(payload.id);
    if (!fresh) return next(new Error('Account no longer exists'));
    socket.user = fresh;
    next();
  } catch {
    next(new Error('Invalid or expired token'));
  }
});
io.on('connection', async (socket) => {
  const u = socket.user;
  socket.join(`user:${u.id}`);
  try {
    // group chat rooms the user belongs to — joined automatically
    (await chatRoutes.roomsForUser(u)).forEach((key) => socket.join(`room:${key}`));
  } catch (e) {
    console.error('[socket] room join failed:', e.message);
  }
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

// Every failure the API can still answer to comes back as JSON — never an
// HTML stack trace (a route's forwarded rejected promise lands here).
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('[api]', err);
  res.status(status).json({
    error: status >= 500 ? 'Something went wrong on the server' : err.message,
  });
});

const PORT = process.env.PORT || 4000;

// Vercel loads the module and needs the handler IMMEDIATELY — so the entry
// is a wrapper that simply holds each request until schema+seed are done
// (local boot keeps using server.listen below, which is gated the same way).
const readyApp = (req, res, next) => {
  db.seeded.then(() => app(req, res, next), (e) => {
    console.error('[boot] database not ready:', e.message);
    res.status(503).json({ error: 'Database is starting — try again in a second' });
  });
};
module.exports = readyApp;

// Boot order: schema + migrations + seed first, then the legacy-upload sweep,
// and only then accept traffic (avoids serving an unseeded database).
db.seeded
  .then(async () => {
    await migrateLegacyUploads(db);
    if (process.env.VERCEL) return; // Vercel serves via module.exports above
    server.listen(PORT, () => {
      console.log(`🤖 ISIGK Robotics API running on http://localhost:${PORT}`);
      // show addresses other devices on the network can use to reach the club
      const addrs = Object.values(require('os').networkInterfaces())
        .flat()
        .filter((n) => n && n.family === 'IPv4' && !n.internal)
        .map((n) => `http://${n.address}:${PORT}`);
      if (addrs.length) console.log(`📡 Club members open: ${addrs.join('   or   ')}`);
    });
  })
  .catch((e) => {
    console.error('FATAL: database failed to initialise:', e);
    process.exit(1);
  });
