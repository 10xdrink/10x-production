// scripts/deleteTestUser.js
// Utility script to delete a test user from the database

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const deleteUser = async (email) => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');

    // Find and delete the user
    const user = await User.findOne({ email });
    
    if (!user) {
      console.log(`❌ No user found with email: ${email}`);
      process.exit(0);
    }

    await User.deleteOne({ email });
    console.log(`✅ Successfully deleted user: ${email}`);
    console.log(`   User ID: ${user._id}`);
    console.log(`   Name: ${user.name}`);
    console.log(`   Role: ${user.role}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
    process.exit(0);
  }
};

// Get email from command line argument
const email = process.argv[2];

if (!email) {
  console.error('❌ Please provide an email address');
  console.log('Usage: node deleteTestUser.js <email>');
  process.exit(1);
}

deleteUser(email);
