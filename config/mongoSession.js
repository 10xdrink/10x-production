// config/mongoSession.js
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);
const logger = require('../utils/logger');
require('dotenv').config();

let mongoStore = null;

try {
  // Create MongoDB session store
  mongoStore = new MongoDBStore({
    uri: process.env.MONGO_URI,
    collection: 'sessions',
    expires: 1000 * 60 * 60 * 24, // 1 day
    connectionOptions: {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    }
  });

  // Handle errors
  mongoStore.on('error', (error) => {
    logger.error('MongoDB Session Store Error:', error);
  });

  mongoStore.on('connected', () => {
    logger.info('MongoDB Session Store connected successfully');
  });

  logger.info('MongoDB Session Store initialized');
} catch (error) {
  logger.error(`Failed to initialize MongoDB Session Store: ${error.message}`);
}

module.exports = mongoStore;
