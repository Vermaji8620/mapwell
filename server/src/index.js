import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDB } from './config/db.js';
import { errorHandler } from './middleware/errorHandler.js';
import { Jurisdiction } from './models/Jurisdiction.js';
import { seedDatabase } from './scripts/seed.js';

// Route Imports
import jurisdictionRoutes from './routes/jurisdictionRoutes.js';
import tractRoutes from './routes/tractRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import assessmentRoutes from './routes/assessmentRoutes.js';
import findingRoutes from './routes/findingRoutes.js';
import reportRoutes from './routes/reportRoutes.js';
import dataManagementRoutes from './routes/dataManagementRoutes.js';
import sessionRoutes from './routes/sessionRoutes.js';
import authRoutes from './routes/authRoutes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(morgan('dev'));

let isSeeded = false;

// Ensure DB is connected for serverless invocations
app.use(async (req, res, next) => {
  try {
    await connectDB();
    if (!isSeeded && mongoose.connection.readyState === 1) {
      isSeeded = true;
      try {
        const count = await Jurisdiction.countDocuments();
        if (count === 0) {
          console.log('[Auto-Seed] Database is empty. Running initial seed in serverless...');
          await seedDatabase();
        }
      } catch (seedErr) {
        console.warn('[Auto-Seed Warning]:', seedErr.message);
      }
    }
    next();
  } catch (err) {
    next(err);
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'MapWell Geospatial Health Platform API',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Mount Routes
app.use('/api/jurisdictions', jurisdictionRoutes);
app.use('/api/tracts', tractRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/assessments', assessmentRoutes);
app.use('/api/findings', findingRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/data', dataManagementRoutes);
app.use('/api/session', sessionRoutes);
app.use('/api/auth', authRoutes);

// Central Error Handler
app.use(errorHandler);

// Start server (only when running standalone server process)
async function startServer() {
  try {
    await connectDB();

    // Auto-seed if database is empty
    const count = await Jurisdiction.countDocuments();
    if (count === 0) {
      console.log('[Auto-Seed] Database is empty. Running initial seed...');
      await seedDatabase();
    }

    const server = app.listen(PORT, () => {
      console.log(`[MapWell Server Running] http://localhost:${PORT}`);
    });

    return server;
  } catch (err) {
    console.error('[Startup Failure]:', err);
    process.exit(1);
  }
}

if (!process.env.VERCEL) {
  startServer();
}

export default app;
