/**
 * Currency utility functions for the backend
 */
const logger = require('./logger');

// Conversion rate from USD to INR (1 USD = ~83 INR as of current rate)
const USD_TO_INR_RATE = 83;

/**
 * Determines if a price value is likely already in INR
 * @param {number} price - Price to check
 * @returns {boolean} - True if price is likely in INR already
 */
const isLikelyInr = (price) => {
  // Don't apply any heuristic and always assume it's in USD and needs conversion
  // This simplifies the logic and prevents inconsistencies
  return false;
};

/**
 * Safely converts a price from USD to INR if needed
 * @param {number} price - Price to potentially convert
 * @returns {number} - Price in INR
 */
const safeConvertToInr = (price) => {
  if (typeof price !== 'number' || isNaN(price)) {
    logger.warn(`Invalid price value for conversion: ${price}, type: ${typeof price}`);
    return 0;
  }
  
  // Skip conversion if likely already in INR
  if (isLikelyInr(price)) {
    logger.debug(`Price ${price} appears to already be in INR, skipping conversion`);
    return price;
  }
  
  const inrPrice = price * USD_TO_INR_RATE;
  logger.debug(`Converted ${price} USD to ${inrPrice} INR`);
  return inrPrice;
};

/**
 * Converts a price from USD to INR
 * @param {number} usdPrice - Price in USD
 * @returns {number} - Price converted to INR
 */
const convertUsdToInr = (usdPrice) => {
  if (typeof usdPrice !== 'number' || isNaN(usdPrice)) {
    logger.warn(`Invalid USD price value for conversion: ${usdPrice}, type: ${typeof usdPrice}`);
    return 0;
  }
  
  // Check if the price is likely already in INR (if it's a larger number)
  if (isLikelyInr(usdPrice)) {
    logger.info(`Price ${usdPrice} appears to already be in INR, skipping conversion`);
    return usdPrice;
  }
  
  const inrPrice = usdPrice * USD_TO_INR_RATE;
  logger.debug(`Converted ${usdPrice} USD to ${inrPrice} INR`);
  return inrPrice;
};

/**
 * Formats a price in INR with the ₹ symbol and 2 decimal places
 * @param {number} price - Price to format
 * @returns {string} - Formatted price with ₹ symbol
 */
const formatPriceINR = (price) => {
  if (typeof price !== 'number' || isNaN(price)) {
    logger.warn(`Invalid price value for formatting: ${price}, type: ${typeof price}`);
    return '₹0.00';
  }
  return `₹${price.toFixed(2)}`;
};

/**
 * Formats a price in INR with the ₹ symbol and no decimal places, with thousands separator
 * @param {number} price - Price to format
 * @returns {string} - Formatted price with ₹ symbol and thousands separator
 */
const formatPriceINRDisplay = (price) => {
  if (typeof price !== 'number' || isNaN(price)) {
    logger.warn(`Invalid price value for display formatting: ${price}, type: ${typeof price}`);
    return '₹0';
  }
  
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(Math.round(price));
  } catch (err) {
    logger.error(`Error formatting price ${price}: ${err.message}`);
    return `₹${Math.round(price)}`;
  }
};

/**
 * Converts a USD price to INR
 * This is useful for storing prices in the database
 * @param {number} usdPrice - Price in USD
 * @returns {number} - Price in INR (without currency symbol)
 */
const storeUsdAsInr = (usdPrice) => {
  return convertUsdToInr(usdPrice);
};

module.exports = {
  USD_TO_INR_RATE,
  convertUsdToInr,
  safeConvertToInr,
  isLikelyInr,
  formatPriceINR,
  formatPriceINRDisplay
}; 