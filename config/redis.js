// config/redis.js
// NOTE: Redis is NO LONGER used for session management (now using MongoDB).
// However, Redis is still required for BullMQ job queues (emailJob, paymentJob, reportJob).
// If you want to completely remove Redis, you'll need to replace BullMQ with an alternative.

const { createClient } = require('redis');
const logger = require('../utils/logger');
require('dotenv').config();

let redisClient = null;

// Only attempt to connect if REDIS_URL is defined
if (process.env.REDIS_URL) {
  try {
    // Create Redis client with better error handling
    redisClient = createClient({
      url: process.env.REDIS_URL,
      socket: {
        connectTimeout: 5000, // 5 seconds timeout
        reconnectStrategy: (retries) => {
          // Return false to stop retrying after 3 attempts
          if (retries > 3) {
            logger.warn(`Redis connection failed after ${retries} retries, stopping attempts`);
            return false;
          }
          // Exponential backoff with max delay of 3 seconds
          const delay = Math.min(Math.pow(2, retries) * 100, 3000);
          return delay;
        },
      },
    });

    // Log Redis errors but don't crash the app
    redisClient.on('error', (err) => {
      logger.warn(`Redis Client Error: ${err}. Continuing without Redis...`);
    });

    // Connect to Redis (only once)
    (async () => {
      try {
        await redisClient.connect();
        logger.info('Connected to Redis successfully!');
      } catch (err) {
        logger.warn(`Redis connection failed: ${err.message}. Continuing without Redis...`);
        redisClient = null;
      }
    })();

    // Graceful shutdown handling
    const gracefulShutdown = async () => {
      if (redisClient && redisClient.isOpen) {
        try {
          await redisClient.quit();
          logger.info('Redis client disconnected successfully.');
        } catch (error) {
          logger.warn(`Error during Redis client disconnection: ${error.message}`);
        }
      }
    };

    process.on('SIGINT', gracefulShutdown);
    process.on('SIGTERM', gracefulShutdown);
  } catch (error) {
    logger.warn(`Redis initialization error: ${error.message}. Continuing without Redis...`);
    redisClient = null;
  }
} else {
  logger.warn('REDIS_URL not defined. Continuing without Redis...');
}

module.exports = redisClient;
