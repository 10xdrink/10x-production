// scripts/clearUsers.js
// Script to clear all users from the database
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const logger = require('../utils/logger');

const clearUsers = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    logger.info('Connected to MongoDB');

    // Count users before deletion
    const userCount = await User.countDocuments();
    logger.info(`Found ${userCount} users in the database`);

    if (userCount === 0) {
      logger.info('No users to delete');
      process.exit(0);
    }

    // Ask for confirmation
    console.log('\n⚠️  WARNING: This will delete ALL users from the database!');
    console.log(`Total users to be deleted: ${userCount}`);
    console.log('\nPress Ctrl+C to cancel, or wait 5 seconds to proceed...\n');

    // Wait 5 seconds before proceeding
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Delete all users
    const result = await User.deleteMany({});
    logger.info(`✅ Successfully deleted ${result.deletedCount} users`);

    // Also clear sessions collection if needed
    const sessionsCollection = mongoose.connection.collection('sessions');
    const sessionResult = await sessionsCollection.deleteMany({});
    logger.info(`✅ Successfully deleted ${sessionResult.deletedCount} sessions`);

    console.log('\n✅ All users and sessions have been cleared!\n');

  } catch (error) {
    logger.error('Error clearing users:', error);
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    logger.info('Database connection closed');
    process.exit(0);
  }
};

// Run the script
clearUsers();
