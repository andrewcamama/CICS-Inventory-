import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { initDatabase, getDbMode } from './server/db.ts';
import authRoutes from './server/routes/authRoutes.ts';
import dashboardRoutes from './server/routes/dashboardRoutes.ts';
import propertyRoutes from './server/routes/propertyRoutes.ts';
import borrowRoutes from './server/routes/borrowRoutes.ts';
import reportRoutes from './server/routes/reportRoutes.ts';
import adminRoutes from './server/routes/adminRoutes.ts';

function resolveServerPort(): number {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      const p = Number(args[i + 1]);
      if (Number.isFinite(p) && p > 0) return p;
    } else if (args[i].startsWith('--port=')) {
      const p = Number(args[i].split('=')[1]);
      if (Number.isFinite(p) && p > 0) return p;
    }
  }

  // In containerized previews where nginx owns NGINX_PORT (e.g. 8080) and forwards to DEFAULT_APP_PORT (3000)
  if (process.env.NGINX_PORT && process.env.PORT === process.env.NGINX_PORT) {
    return Number(process.env.DEFAULT_APP_PORT || 3000);
  }

  return Number(process.env.PORT || 3000);
}

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // same-origin or server-to-server
  const configured = process.env.ALLOWED_ORIGIN?.split(',').map((s) => s.trim()).filter(Boolean) || [];
  if (configured.includes(origin)) return true;
  if (process.env.APP_URL && origin.startsWith(process.env.APP_URL)) return true;

  try {
    const parsed = new URL(origin);
    const host = parsed.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return true;
    if (host.endsWith('.run.app')) return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  } catch {
    return false;
  }
  return false;
}

async function startServer() {
  await initDatabase();

  const app = express();
  const port = resolveServerPort();
  const distDir = path.resolve(process.cwd(), 'dist');
  const hasDist = fs.existsSync(path.join(distDir, 'index.html'));
  const isDev = process.env.NODE_ENV === 'development' || process.env.npm_lifecycle_event === 'dev';
  const isProd = process.env.NODE_ENV === 'production' || (hasDist && !isDev);

  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
      originAgentCluster: false,
      frameguard: false,
    })
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        if (isAllowedOrigin(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Origin not allowed by CICS LAN CORS policy'));
        }
      },
      credentials: true,
    })
  );

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  // API Routes
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, db_mode: getDbMode(), service: 'cics-inventory-api' });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/properties', propertyRoutes);
  app.use('/api/borrow', borrowRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/admin', adminRoutes);

  // API 404 fallback
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  const httpsEnabled = process.env.HTTPS_ENABLED === 'true';
  const keyPath = process.env.SSL_KEY_PATH ? path.resolve(process.cwd(), process.env.SSL_KEY_PATH) : '';
  const certPath = process.env.SSL_CERT_PATH ? path.resolve(process.cwd(), process.env.SSL_CERT_PATH) : '';
  const useHttps = httpsEnabled && keyPath && certPath && fs.existsSync(keyPath) && fs.existsSync(certPath);

  const webServer = useHttps
    ? https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, app)
    : http.createServer(app);

  if (!isProd) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: webServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(
      '/assets',
      express.static(path.join(distDir, 'assets'), {
        maxAge: '1y',
        immutable: true,
        fallthrough: false,
      })
    );
    app.use(
      express.static(distDir, {
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
          }
        },
      })
    );
    app.get('*', (req, res) => {
      if (/\.[a-zA-Z0-9]+$/.test(req.path)) {
        res.status(404).end();
        return;
      }
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  webServer.listen(port, '0.0.0.0', () => {
    const proto = useHttps ? 'https' : 'http';
    console.log(`[CICS Inventory] Server listening on ${proto}://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
