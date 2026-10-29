import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

let memoryServer = null;

export async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (uri && uri.trim() !== '') {
    try {
      console.log('Connecting to configured MongoDB database...');
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 5000
      });
      console.log(`[MongoDB Connected] Host: ${mongoose.connection.host}, Database: ${mongoose.connection.name}`);
      return;
    } catch (err) {
      console.warn(`[MongoDB Warning] Could not connect to MONGODB_URI: ${err.message}`);
      if (process.env.USE_MEMORY_DB_FALLBACK !== 'true') {
        throw err;
      }
      console.log('Falling back to local in-memory MongoDB server as configured...');
    }
  }

  // Fallback: in-memory MongoDB instance
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
    const memoryUri = memoryServer.getUri();
    await mongoose.connect(memoryUri);
    console.log(`[Local Fallback Active] Connected to In-Memory MongoDB at: ${memoryUri}`);
    console.log('[Notice] You can provide your real remote MongoDB URI in .env at any time.');
  } catch (memErr) {
    console.error('[MongoDB Error] Failed to initialize fallback database:', memErr.message);
    throw memErr;
  }
}

export async function disconnectDB() {
  await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop();
  }
}
