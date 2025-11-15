// services/s3Service.js

const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const logger = require('../utils/logger');
const crypto = require('crypto');
const path = require('path');

// Initialize S3 Client with flexible region handling
const s3Client = new S3Client({
  region: process.env.AWS_REGION_S3 || 'eu-north-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  // Allow SDK to follow redirects to correct region
  followRegionRedirects: true,
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;

/**
 * Generate a unique file name
 * @param {string} originalName - Original file name
 * @returns {string} - Unique file name
 */
const generateUniqueFileName = (originalName) => {
  const ext = path.extname(originalName);
  const randomString = crypto.randomBytes(16).toString('hex');
  const timestamp = Date.now();
  return `${timestamp}-${randomString}${ext}`;
};

/**
 * Upload file buffer to S3
 * @param {Buffer} buffer - File buffer
 * @param {string} folder - Folder path in S3 bucket
 * @param {string} originalName - Original file name
 * @param {string} mimeType - File MIME type
 * @returns {Promise<{url: string, key: string}>} - S3 URL and key
 */
const uploadToS3 = async (buffer, folder = 'uploads', originalName = 'file', mimeType = 'application/octet-stream') => {
  try {
    const fileName = generateUniqueFileName(originalName);
    const key = folder ? `${folder}/${fileName}` : fileName;

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
      // Make files publicly readable (adjust based on your security requirements)
      // ACL: 'public-read', // Note: ACL is disabled by default on new buckets, use bucket policy instead
    });

    await s3Client.send(command);

    // Construct the public URL using the correct S3 bucket region
    const region = process.env.AWS_REGION_S3 || 'eu-north-1';
    const url = `https://${BUCKET_NAME}.s3.${region}.amazonaws.com/${key}`;
    
    logger.info(`File uploaded to S3 successfully: ${url}`);
    
    return {
      url,
      key,
    };
  } catch (error) {
    logger.error(`S3 upload failed: ${error.message}`);
    
    // Provide helpful error message for region mismatch
    if (error.message && error.message.includes('endpoint')) {
      logger.error(`Bucket region mismatch! Check if bucket '${BUCKET_NAME}' is in region '${process.env.AWS_REGION || 'us-east-1'}'`);
      throw new Error(`S3 region mismatch. Bucket may be in a different region than ${process.env.AWS_REGION || 'us-east-1'}`);
    }
    
    throw new Error('Failed to upload file to S3');
  }
};

/**
 * Delete file from S3
 * @param {string} key - S3 object key
 * @returns {Promise<boolean>} - Success status
 */
const deleteFromS3 = async (key) => {
  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    await s3Client.send(command);
    logger.info(`File deleted from S3: ${key}`);
    return true;
  } catch (error) {
    logger.error(`S3 deletion failed: ${error.message}`);
    throw new Error('Failed to delete file from S3');
  }
};

/**
 * Generate presigned URL for temporary access
 * @param {string} key - S3 object key
 * @param {number} expiresIn - URL expiration time in seconds (default: 1 hour)
 * @returns {Promise<string>} - Presigned URL
 */
const getPresignedUrl = async (key, expiresIn = 3600) => {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn });
    logger.info(`Presigned URL generated for: ${key}`);
    return url;
  } catch (error) {
    logger.error(`Failed to generate presigned URL: ${error.message}`);
    throw new Error('Failed to generate presigned URL');
  }
};

/**
 * Extract S3 key from full URL
 * @param {string} url - Full S3 URL
 * @returns {string|null} - S3 key or null if invalid
 */
const extractKeyFromUrl = (url) => {
  try {
    // Handle S3 URLs in format: https://bucket-name.s3.region.amazonaws.com/key
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    // Remove leading slash
    return pathname.startsWith('/') ? pathname.substring(1) : pathname;
  } catch (error) {
    logger.error(`Failed to extract key from URL: ${error.message}`);
    return null;
  }
};

/**
 * Upload image buffer to S3 (wrapper for backward compatibility)
 * @param {Buffer} buffer - Image buffer
 * @param {Object} options - Upload options
 * @returns {Promise<Object>} - Upload result with secure_url and public_id
 */
const uploadImage = async (buffer, options = {}) => {
  const folder = options.folder || 'images';
  const originalName = options.originalName || 'image.jpg';
  const mimeType = options.mimeType || 'image/jpeg';

  const result = await uploadToS3(buffer, folder, originalName, mimeType);
  
  // Return in Cloudinary-compatible format for easier migration
  return {
    secure_url: result.url,
    url: result.url,
    public_id: result.key,
    key: result.key,
  };
};

/**
 * Delete image from S3 (wrapper for backward compatibility)
 * @param {string} publicId - S3 key (similar to Cloudinary public_id)
 * @returns {Promise<Object>} - Deletion result
 */
const deleteImage = async (publicId) => {
  const success = await deleteFromS3(publicId);
  return {
    result: success ? 'ok' : 'not found',
  };
};

module.exports = {
  uploadToS3,
  deleteFromS3,
  getPresignedUrl,
  extractKeyFromUrl,
  uploadImage,
  deleteImage,
  s3Client,
};
