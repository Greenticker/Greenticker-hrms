import 'dotenv/config'; // must be first so env vars exist before other modules read them
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { apiRouter } from './server/api.js';
import { connectMongo, flushAndClose, persistAfterWrites } from './server/mongo.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  // Connect to MongoDB first; the server refuses to start without it.
  await connectMongo();

  const app = express();
  const isProduction = process.env.NODE_ENV === 'production';
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  // Ensure dist is built in production if missing
  const distPath = path.resolve(__dirname, 'dist');
  if (isProduction && !fs.existsSync(path.resolve(distPath, 'index.html'))) {
    try {
      console.log('[RHYA HRMS] Building frontend for production...');
      execSync('npm run build', { stdio: 'inherit' });
    } catch (err) {
      console.error('[RHYA HRMS] Failed to build frontend:', err);
    }
  }

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Public static files: ONLY organisation logos (never employee documents)
  const logosDir = path.resolve(__dirname, 'uploads', 'logos');
  fs.mkdirSync(logosDir, { recursive: true });
  app.use('/uploads/logos', express.static(logosDir));

  // Mount API endpoints (changes are saved to MongoDB after every write request)
  app.use('/api', persistAfterWrites);
  app.use('/api', apiRouter);

  if (!isProduction && !fs.existsSync(path.resolve(distPath, 'index.html'))) {
    try {
      console.log('[RHYA HRMS] Building frontend for dev fallback...');
      execSync('npm run build', { stdio: 'inherit' });
    } catch (err) {
      console.error('[RHYA HRMS] Failed to build frontend:', err);
    }
  }

  if (!isProduction) {
    // Development mode: Mount Vite middleware if possible, or fallback to static
    try {
      const { createServer } = await import('vite');
      const vite = await createServer({
        server: {
          middlewareMode: true,
          hmr: process.env.DISABLE_HMR !== 'true',
        },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } catch (e) {
      console.warn('[RHYA HRMS] Vite dev middleware failed to load, falling back to static dist:', e);
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.resolve(distPath, 'index.html'));
      });
    }
  } else {
    // Production mode: Serve static assets
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[RHYA HRMS] Server running on http://0.0.0.0:${PORT}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`[RHYA HRMS] ${signal} received, saving data and shutting down...`);
    server.close();
    await flushAndClose();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

startServer().catch((err) => {
  console.error('[RHYA HRMS] Failed to start server:', err);
  process.exit(1);
});