// utils/imageCompressor.js

const sharp = require('sharp');
const logger = require('./logger');

/**
 * Compress and optimize image buffer
 * @param {Buffer} buffer - Original image buffer
 * @param {Object} options - Compression options
 * @returns {Promise<Buffer>} - Compressed image buffer
 */
const compressImage = async (buffer, options = {}) => {
  try {
    const {
      maxWidth = 1920,
      maxHeight = 1920,
      quality = 80,
      format = 'jpeg', // jpeg, png, webp
      fit = 'inside', // inside, cover, contain, fill
    } = options;

    // Get image metadata
    const metadata = await sharp(buffer).metadata();
    logger.info(`Original image: ${metadata.format}, ${metadata.width}x${metadata.height}, ${Math.round(buffer.length / 1024)}KB`);

    // Compress based on format
    let compressed = sharp(buffer)
      .resize(maxWidth, maxHeight, {
        fit,
        withoutEnlargement: true, // Don't upscale smaller images
      });

    // Apply format-specific compression
    switch (format.toLowerCase()) {
      case 'jpeg':
      case 'jpg':
        compressed = compressed.jpeg({
          quality,
          progressive: true,
          mozjpeg: true, // Use mozjpeg for better compression
        });
        break;
      case 'png':
        compressed = compressed.png({
          quality,
          compressionLevel: 9,
          adaptiveFiltering: true,
        });
        break;
      case 'webp':
        compressed = compressed.webp({
          quality,
          effort: 6, // 0-6, higher = better compression but slower
        });
        break;
      default:
        compressed = compressed.jpeg({ quality });
    }

    const outputBuffer = await compressed.toBuffer();
    
    const compressionRatio = ((1 - outputBuffer.length / buffer.length) * 100).toFixed(2);
    logger.info(`Compressed image: ${Math.round(outputBuffer.length / 1024)}KB (${compressionRatio}% reduction)`);

    return outputBuffer;
  } catch (error) {
    logger.error(`Image compression failed: ${error.message}`);
    throw new Error('Failed to compress image');
  }
};

/**
 * Compress profile photo with specific settings
 * @param {Buffer} buffer - Original image buffer
 * @returns {Promise<Buffer>} - Compressed image buffer
 */
const compressProfilePhoto = async (buffer) => {
  return compressImage(buffer, {
    maxWidth: 800,
    maxHeight: 800,
    quality: 85,
    format: 'jpeg',
    fit: 'cover',
  });
};

/**
 * Compress product image with specific settings
 * @param {Buffer} buffer - Original image buffer
 * @returns {Promise<Buffer>} - Compressed image buffer
 */
const compressProductImage = async (buffer) => {
  return compressImage(buffer, {
    maxWidth: 1200,
    maxHeight: 1200,
    quality: 90,
    format: 'jpeg',
    fit: 'inside',
  });
};

/**
 * Compress review photo with specific settings
 * @param {Buffer} buffer - Original image buffer
 * @returns {Promise<Buffer>} - Compressed image buffer
 */
const compressReviewPhoto = async (buffer) => {
  return compressImage(buffer, {
    maxWidth: 1000,
    maxHeight: 1000,
    quality: 85,
    format: 'jpeg',
    fit: 'inside',
  });
};

/**
 * Validate if buffer is a valid image
 * @param {Buffer} buffer - Image buffer
 * @returns {Promise<boolean>} - Whether buffer is a valid image
 */
const isValidImage = async (buffer) => {
  try {
    const metadata = await sharp(buffer).metadata();
    return !!metadata.format;
  } catch (error) {
    return false;
  }
};

module.exports = {
  compressImage,
  compressProfilePhoto,
  compressProductImage,
  compressReviewPhoto,
  isValidImage,
};
