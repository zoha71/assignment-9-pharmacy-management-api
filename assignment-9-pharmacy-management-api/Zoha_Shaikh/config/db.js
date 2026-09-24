const mongoose = require('mongoose');

let memoryServer = null;

const connectDB = async () => {
  try {
    let mongoUri = process.env.MONGO_URI;

    // Check if valid MongoDB URI is provided
    const isPlaceholderUri = !mongoUri || mongoUri.includes('<user>') || mongoUri.includes('<password>');

    if (isPlaceholderUri) {
      if (process.env.NODE_ENV === 'production') {
        console.error('FATAL: MONGO_URI is required in production environment.');
        process.exit(1);
      }

      if (!memoryServer) {
        console.warn('⚠️ No valid MONGO_URI found in .env. Initializing local in-memory MongoDB server for testing...');
        try {
          const { MongoMemoryServer } = require('mongodb-memory-server');
          memoryServer = await MongoMemoryServer.create();
          mongoUri = memoryServer.getUri();
          process.env.MONGO_URI = mongoUri;
          console.log(`✅ In-Memory MongoDB running at: ${mongoUri}`);
        } catch (memErr) {
          console.error('Failed to initialize in-memory MongoDB:', memErr.message);
          process.exit(1);
        }
      } else {
        mongoUri = memoryServer.getUri();
      }
    }

    if (mongoose.connection.readyState === 1) {
      return mongoose.connection;
    }

    const conn = await mongoose.connect(mongoUri);
    console.log(`📦 MongoDB Connected: ${conn.connection.host} (Database: ${conn.connection.name})`);
    return conn;
  } catch (error) {
    console.error(`❌ MongoDB Connection Error: ${error.message}`);
    process.exit(1);
  }
};

const disconnectDB = async (stopMemoryServer = false) => {
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (stopMemoryServer && memoryServer) {
      await memoryServer.stop();
      memoryServer = null;
    }
  } catch (error) {
    console.error(`Error disconnecting database: ${error.message}`);
  }
};

module.exports = { connectDB, disconnectDB };
