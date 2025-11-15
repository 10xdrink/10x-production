// services/uploadService.js

const { uploadToS3 } = require('./s3Service');
const logger = require('../utils/logger');

/**
 * Uploads an image buffer to AWS S3.
 * @param {Buffer} buffer - The image buffer.
 * @param {String} folder - The S3 folder where the image will be stored.
 * @returns {Promise<String>} - The URL of the uploaded image.
 */
const uploadToS3Bucket = async (buffer, folder) => {
  try {
    const result = await uploadToS3(buffer, folder, 'image.jpg', 'image/jpeg');
    return result.url;
  } catch (error) {
    logger.error(`Upload to S3 failed: ${error.message}`);
    throw error;
  }
};

// Alias for backward compatibility
const uploadToCloudinary = uploadToS3Bucket;

module.exports = {
  uploadToCloudinary, // Keep old name for compatibility
  uploadToS3Bucket,
};
