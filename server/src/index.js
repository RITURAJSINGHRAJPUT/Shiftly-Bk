import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import prisma from './db.js';
import authRoutes from './routes/auth.routes.js';
import employeeRoutes from './routes/employee.routes.js';
import shiftRoutes from './routes/shift.routes.js';
import attendanceRoutes from './routes/attendance.routes.js';
import leaveRoutes from './routes/leave.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import organizationRoutes from './routes/organization.routes.js';
import brandRoutes from './routes/brand.routes.js';
import outletRoutes from './routes/outlet.routes.js';
import shiftTemplateRoutes from './routes/shiftTemplate.routes.js';
import { apiLimiter } from './middleware/rateLimit.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The built client, when there is one.
 *
 * In production this process serves both the app and the API from one origin,
 * so there is one URL and CORS never enters into it. In development the file
 * does not exist — Vite serves the client and proxies /api here — so this is
 * inert without needing a flag anyone has to remember to set. The rolled-back
 * attempt gated it on SERVE_CLIENT, which was unset on Render and produced
 * `Cannot GET /`.
 */
const CLIENT_DIST = join(__dirname, '../../client/dist');
const CLIENT_INDEX = join(CLIENT_DIST, 'index.html');
const serveClient = existsSync(CLIENT_INDEX);

/**
 * Only when a separate origin exists.
 *
 * Serving the client from this process makes every request same-origin, so CORS
 * has nothing to permit. The old hardcoded localhost list would have refused the
 * deployed origin outright.
 */
if (process.env.CORS_ORIGIN) {
  app.use(cors({ origin: process.env.CORS_ORIGIN.split(',').map((o) => o.trim()), credentials: true }));
}

app.use(express.json());

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path !== '/api/notifications/count') {
      console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    }
  });
  next();
});

// A backstop on everything. The strict credential limiter is applied inside
// auth.routes.js, on the two endpoints that actually check a password.
app.use('/api', apiLimiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/shifts', shiftRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/leaves', leaveRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/brands', brandRoutes);
app.use('/api/outlets', outletRoutes);
app.use('/api/shift-templates', shiftTemplateRoutes);

/**
 * Health check — deliberately able to fail.
 *
 * It used to return `{ status: 'ok' }` unconditionally, which meant a deployment
 * with a wrong DATABASE_URL went green and then 500'd on every real request. A
 * health check that cannot report ill health is decoration.
 */
app.get('/api/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
  } catch (err) {
    // Prisma's messages open with blank lines and then a preamble naming the
    // call — "Invalid `prisma.$queryRaw()` invocation:" — before the line that
    // actually says what went wrong. Taking the first non-empty line reports the
    // preamble, which tells an operator nothing; skip it and take the cause.
    const detail = String(err.message)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .find((l) => !/^Invalid `prisma\./.test(l)) ?? err.message;
    res.status(503).json({ status: 'error', database: 'unreachable', error: detail });
  }
});

// 404 for unmatched API routes, declared before the SPA fallback so an unknown
// endpoint answers with JSON rather than quietly returning the HTML shell — which
// reads to a client as a successful request that parsed to nothing.
app.use('/api', (req, res) => {
  res.status(404).json({ error: `No such endpoint: ${req.method} /api${req.path}` });
});

if (serveClient) {
  app.use(express.static(CLIENT_DIST));

  // Express 5 rejects `app.get('*')` — the bare wildcard is no longer a valid
  // path pattern and throws at startup. Plain middleware, after the /api 404
  // above, so only genuine client routes reach it.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.sendFile(CLIENT_INDEX);
  });
}

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Bookends Shiftly listening on port ${PORT}`);
  console.log(serveClient
    ? '📦 Serving the built client from client/dist'
    : '🔧 API only — run the Vite dev server for the client');
  console.log(`📋 Health check: /api/health\n`);
});
