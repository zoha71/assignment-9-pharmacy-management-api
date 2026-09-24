const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const { connectDB } = require('./config/db');
const { notFound, errorHandler } = require('./middleware/errorHandler');

// Load environment variables
dotenv.config();

// Fail-fast environment variable validation
if (!process.env.JWT_SECRET) {
  console.error('FATAL ERROR: JWT_SECRET environment variable is not defined.');
  process.exit(1);
}

const app = express();

// Trust proxy for Render deployment (ensures rate-limiter and IP tracking work correctly)
app.set('trust proxy', 1);

// Security Headers
app.use(helmet());

// Cross-Origin Resource Sharing
const corsOptions = {
  origin: process.env.CORS_ORIGIN && process.env.CORS_ORIGIN !== '*'
    ? process.env.CORS_ORIGIN.split(',')
    : true,
  credentials: true
};
app.use(cors(corsOptions));

// Body Parser with payload size limit
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Health Check Endpoint (Render Health Check)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API Root Info
app.get('/', (req, res) => {
  res.status(200).json({
    name: 'Pharmacy & Healthcare Store REST API',
    version: '1.0.0',
    documentation: '/README.md',
    endpoints: {
      health: '/health',
      auth: '/api/auth',
      medicines: '/api/medicines',
      orders: '/api/orders',
      reports: '/api/reports'
    }
  });
});

// Mount Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/medicines', require('./routes/medicineRoutes'));
app.use('/api/orders', require('./routes/orderRoutes'));
app.use('/api/reports', require('./routes/reportRoutes'));

// 404 and Error Handling Middlewares
app.use(notFound);
app.use(errorHandler);

const PORT = parseInt(process.env.PORT, 10) || 5000;
const HOST = '0.0.0.0';

// Connect to Database first, then start listening
const startServer = async () => {
  await connectDB();
  const server = app.listen(PORT, HOST, () => {
    console.log(`🚀 Pharmacy Management API running in ${process.env.NODE_ENV || 'development'} mode on http://${HOST}:${PORT}`);
  });
  return server;
};

// Export app and server starter for testing
if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
