const app = require('./app');
const mongoose = require('mongoose');
const cluster = require('cluster');
const os = require('os');
const logger = require('./utils/logger');

// Handle Uncaught Exceptions
process.on('uncaughtException', (err) => {
  logger.error(`Uncaught Exception: ${err.message}`);
  process.exit(1);
});

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  logger.info('Connected to MongoDB successfully');
})
.catch(err => {
  logger.error(`MongoDB Connection Error: ${err.message}`);
  process.exit(1);
});

// Check if process is master or worker
if (cluster.isMaster && process.env.NODE_ENV === 'production') {
  // Count the machine's CPUs
  const cpuCount = os.cpus().length;
  
  // Create a worker for each CPU
  for (let i = 0; i < cpuCount; i++) {
    cluster.fork();
  }
  
  // Listen for dying workers
  cluster.on('exit', worker => {
    logger.info(`Worker ${worker.id} died. Starting a new worker...`);
    cluster.fork();
  });
} else {
  // Start server
  const PORT = process.env.PORT || 5000;
  const server = app.listen(PORT, () => {
    logger.info(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (err, promise) => {
    logger.error(`Error: ${err.message || err}`);
    // Close server & exit process
    server.close(() => process.exit(1));
  });
}

// Handle SIGTERM for graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully.');
  server.close(() => {
    logger.info('Process terminated.');
  });
});
