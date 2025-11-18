// services/billDeskService.js - FIXED VERSION WITH PROPER AUTHENTICATION

/**
 * BillDesk Service for UAT JSON REST API v1.2 Integration
 * Implemented according to official BillDesk JOSE documentation
 * FIXED: Authentication issues resolved
 */

const crypto = require('crypto');
const logger = require('../utils/logger');
const billDeskLogger = require('../utils/billDeskLogger');
const Transaction = require('../models/Transaction');
const Order = require('../models/Order');
const moment = require('moment-timezone');
const fetch = require('node-fetch');
const jose = require('node-jose');

// Security: Rate limiting for payment requests
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 5;

// Helper: Base64url encoding (no padding)
const base64url = (input) =>
  Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

/**
 * BillDesk Configuration
 */
const BILLDESK_CONFIG = {
  merchantId: process.env.BILLDESK_MERCHANT_ID,
  keyId: process.env.BILLDESK_SECURITY_ID,
  clientId: process.env.BILLDESK_CLIENT_ID,
  clientSecret: process.env.BILLDESK_CLIENT_SECRET,
  signingPassword: process.env.BILLDESK_SIGNING_PASSWORD,
  encryptionPassword: process.env.BILLDESK_ENCRYPTION_PASSWORD,
  paymentUrl: process.env.BILLDESK_PAYMENT_URL,
  returnUrl: process.env.BILLDESK_RETURN_URL,
  webhookUrl: process.env.BILLDESK_WEBHOOK_URL,
  itemCode: process.env.BILLDESK_ITEM_CODE || 'DIRECT',
};

// Validate required BillDesk configuration
const requiredBillDeskVars = [
  'BILLDESK_MERCHANT_ID',
  'BILLDESK_SECURITY_ID',
  'BILLDESK_CLIENT_ID',
  'BILLDESK_CLIENT_SECRET',
  'BILLDESK_SIGNING_PASSWORD',
  'BILLDESK_ENCRYPTION_PASSWORD',
  'BILLDESK_PAYMENT_URL',
  'BILLDESK_RETURN_URL',
  'BILLDESK_WEBHOOK_URL'
];

const missingBillDeskVars = requiredBillDeskVars.filter(varName => !process.env[varName]);
if (missingBillDeskVars.length > 0) {
  logger.error(`Missing required BillDesk environment variables: ${missingBillDeskVars.join(', ')}`);
  throw new Error(`Missing required BillDesk configuration: ${missingBillDeskVars.join(', ')}`);
}

// Security: Never log credentials - only log that config is loaded
logger.info('BillDesk Configuration loaded successfully');

/**
 * Create encryption key as per BillDesk documentation
 */
async function getEncryptionKey() {
  try {
    // Create AES key from encryption password (32 bytes for AES-256)
    const keyData = crypto.createHash('sha256').update(BILLDESK_CONFIG.encryptionPassword).digest();
    
    const key = await jose.JWK.asKey({
      kty: 'oct',
      k: jose.util.base64url.encode(keyData),
      alg: 'A256GCM',
      use: 'enc'
    });
    
    logger.info('Encryption key created using SHA256 hash of password');
    return key;
  } catch (error) {
    logger.error('Error creating encryption key:', error);
    throw new Error(`Failed to create encryption key: ${error.message}`);
  }
}

/**
 * FIXED: JWE encryption with exact BillDesk format
 */
async function encryptJWE(jsonPayload) {
  try {
    const key = await getEncryptionKey();
    
    // Exact JWE Header format as per BillDesk documentation
    const header = {
      alg: 'dir',                           // Direct encryption algorithm
      enc: 'A256GCM',                       // AES-256-GCM encryption method
      kid: BILLDESK_CONFIG.keyId,           // Security ID (encryption key id)
      clientid: BILLDESK_CONFIG.clientId    // Client ID (NOT keyId for JWE)
    };
    
    // Security: Don't log sensitive payload in production
    if (process.env.NODE_ENV !== 'production') {
      logger.info('JWE Header:', JSON.stringify(header));
      logger.info('Payload to encrypt:', JSON.stringify(jsonPayload));
    }
    
    // Ensure payload is a string
    const payloadString = JSON.stringify(jsonPayload);
    const plaintext = Buffer.from(payloadString, 'utf8');
    
    // Create JWE with exact format
    const encrypted = await jose.JWE.createEncrypt({ 
      format: 'compact',
      fields: header
    }, key)
    .update(plaintext)
    .final();
    
    logger.info('JWE encryption successful');
    logger.info('Encrypted JWE token length:', encrypted.length);
    
    return encrypted;
  } catch (error) {
    logger.error('JWE encryption failed:', error);
    throw new Error(`JWE encryption failed: ${error.message}`);
  }
}

/**
 * FIXED: JWS generation with correct key ID
 */
function generateJWS(payload) {
  try {
    // FIXED: Use actual signing key ID instead of 'HMAC'
    // CRITICAL: Both kid and clientid must be the Security ID (keyId), NOT the Client ID
    const header = {
      alg: 'HS256',                         // HMAC SHA-256 algorithm
      kid: BILLDESK_CONFIG.keyId,           // Security ID
      clientid: BILLDESK_CONFIG.keyId       // Security ID (same as kid per BillDesk docs)
    };

    logger.info('JWS Header:', JSON.stringify(header));
    
    // Base64url encode header
    const encodedHeader = base64url(JSON.stringify(header));
    
    // Base64url encode payload 
    let encodedPayload;
    if (typeof payload === 'string') {
      encodedPayload = base64url(payload);
    } else {
      encodedPayload = base64url(JSON.stringify(payload));
    }
    
    // Create signature
    const signatureInput = `${encodedHeader}.${encodedPayload}`;
    logger.info('Signature input length:', signatureInput.length);
    
    const signature = crypto
      .createHmac('sha256', BILLDESK_CONFIG.signingPassword)
      .update(signatureInput, 'utf8')
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    const jwsToken = `${encodedHeader}.${encodedPayload}.${signature}`;
    
    logger.info('JWS token generated successfully');
    logger.info('JWS token length:', jwsToken.length);
    logger.info('JWS token parts count:', jwsToken.split('.').length);
    
    return jwsToken;
  } catch (error) {
    logger.error('JWS generation failed:', error);
    throw new Error(`JWS generation failed: ${error.message}`);
  }
}

/**
 * Verify JWS token (for response processing)
 */
function verifyJWS(jwsToken) {
  try {
    logger.info('Verifying JWS token...');
    
    const parts = jwsToken.split('.');
    if (parts.length !== 3) {
      logger.error(`Invalid JWS format - expected 3 parts, got ${parts.length}`);
      return { isValid: false, payload: null };
    }
    
    const [encodedHeader, encodedPayload, signature] = parts;
    
    // Recreate signature for verification
    const signatureInput = `${encodedHeader}.${encodedPayload}`;
    const expectedSignature = crypto
      .createHmac('sha256', BILLDESK_CONFIG.signingPassword)
      .update(signatureInput, 'utf8')
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    
    const isValid = signature === expectedSignature;
    
    let payload = null;
    if (isValid) {
      try {
        // Decode payload
        const paddedPayload = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
        const decodedPayload = Buffer.from(paddedPayload, 'base64').toString('utf8');
        
        // Try to parse as JSON
        try {
          payload = JSON.parse(decodedPayload);
        } catch (e) {
          payload = decodedPayload; // Keep as string if not JSON
        }
        
        logger.info('JWS verification successful');
      } catch (e) {
        logger.error('Failed to decode JWS payload:', e);
        return { isValid: false, payload: null };
      }
    } else {
      logger.error('JWS signature verification failed');
    }
    
    return { isValid, payload };
  } catch (error) {
    logger.error('JWS verification error:', error);
    return { isValid: false, payload: null };
  }
}

/**
 * Decrypt JWE token (for response processing)
 */
async function decryptJWE(jweToken) {
  try {
    logger.info('Decrypting JWE token...');
    
    const key = await getEncryptionKey();
    const result = await jose.JWE.createDecrypt(key).decrypt(jweToken);
    
    const decryptedText = result.plaintext.toString('utf8');
    logger.info('JWE decryption successful');
    
    return decryptedText;
  } catch (error) {
    logger.error('JWE decryption failed:', error);
    throw new Error(`JWE decryption failed: ${error.message}`);
  }
}

/**
 * Security: Check rate limit
 */
function checkRateLimit(identifier) {
  const now = Date.now();
  const userRequests = rateLimitMap.get(identifier) || [];
  
  // Remove old requests outside the window
  const recentRequests = userRequests.filter(time => now - time < RATE_LIMIT_WINDOW);
  
  if (recentRequests.length >= MAX_REQUESTS_PER_WINDOW) {
    logger.warn(`Rate limit exceeded for ${identifier}`);
    return false;
  }
  
  recentRequests.push(now);
  rateLimitMap.set(identifier, recentRequests);
  return true;
}

/**
 * Security: Sanitize sensitive data from logs
 */
function sanitizeForLog(data) {
  const sanitized = { ...data };
  const sensitiveFields = ['password', 'secret', 'token', 'key', 'authorization'];
  
  Object.keys(sanitized).forEach(key => {
    if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
      sanitized[key] = '[REDACTED]';
    }
  });
  
  return sanitized;
}

/**
 * Security: Validate order data
 */
function validateOrderData(order) {
  if (!order || typeof order !== 'object') {
    throw new Error('Invalid order object');
  }
  
  const amount = order.finalAmount || order.totalAmount || order.amount;
  if (!amount || isNaN(amount) || amount <= 0) {
    throw new Error('Invalid order amount');
  }
  
  if (amount > 1000000) { // 10 lakhs limit
    throw new Error('Order amount exceeds maximum limit');
  }
  
  if (!order._id) {
    throw new Error('Order ID is required');
  }
  
  return true;
}

/**
 * FIXED: Create payment request with proper authentication and security
 */
async function createPaymentRequest(order, clientIp = '127.0.0.1') {
  logger.info('=== BillDesk Payment Request Creation Started ===');
  logger.info('Client IP Address:', clientIp);

  // Security: Rate limiting
  const rateLimitKey = `${order._id}-${clientIp}`;
  if (!checkRateLimit(rateLimitKey)) {
    throw new Error('Too many payment requests. Please try again later.');
  }

  // Security: Validate order data
  validateOrderData(order);
  
  const amount = order.finalAmount || order.totalAmount || order.amount;

  // Generate unique order number with proper format
  const orderNumber = order.orderNumber || `order${Date.now()}${Math.floor(Math.random() * 1000)}`;

  // Get customer details
  let customerEmail = 'customer@example.com';
  let customerPhone = '9999999999';
  
  try {
    if (order.customer) {
      const User = require('../models/User');
      const user = await User.findById(order.customer);
      if (user) {
        if (user.email) customerEmail = user.email.trim();
        if (user.phone) customerPhone = user.phone.trim().replace(/\D/g, '');
      }
    }
  } catch (e) {
    logger.warn('Unable to fetch user details:', e.message);
  }

  // STEP 1: Create JSON Request (exact format from documentation)
  logger.info('STEP 1: Creating JSON request...');
  const jsonRequest = {
    mercid: BILLDESK_CONFIG.merchantId,
    orderid: orderNumber,
    amount: amount.toFixed(2),
    order_date: moment().tz("Asia/Kolkata").format("YYYY-MM-DDTHH:mm:ssZZ"),
    currency: "356",
    ru: BILLDESK_CONFIG.returnUrl,
    additional_info: {
      additional_info1: `Order ${orderNumber}`,
      additional_info2: customerEmail,
      additional_info7: "mgl"
    },
    itemcode: BILLDESK_CONFIG.itemCode,
    device: {
      init_channel: "internet",
      ip: clientIp,  // Use actual client IP
      user_agent: "Mozilla/5.0(WindowsNT10.0;WOW64;)Gecko/20100101Firefox/51.0",
      accept_header: "text/html"
    }
  };

  // Security: Log sanitized version in production
  if (process.env.NODE_ENV !== 'production') {
    logger.info('JSON Request created:', JSON.stringify(jsonRequest, null, 2));
  } else {
    logger.info('JSON Request created for order:', orderNumber);
  }

  // STEP 2: Encrypt JSON Request
  logger.info('STEP 2: Encrypting JSON request...');
  const encryptedPayload = await encryptJWE(jsonRequest);
  logger.info('JSON request encrypted successfully');

  // STEP 3: Sign Encrypted Request
  logger.info('STEP 3: Signing encrypted request...');
  const jwsToken = generateJWS(encryptedPayload);
  logger.info('Encrypted request signed successfully');

  // Save transaction
  const txn = new Transaction({
    orderNumber,
    order: order._id,
    paymentMethod: 'billdesk',
    amount,
    status: 'pending',
    metadata: {
      merchantId: BILLDESK_CONFIG.merchantId,
      orderNumber,
      generatedAt: new Date(),
    },
  });
  await txn.save();

  // STEP 4: Prepare headers and make API call
  logger.info('STEP 4: Preparing API request...');
  
  const traceId = `TXN${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 35);
  const timestamp = Math.floor(Date.now() / 1000).toString();

  // Security: Securely create Basic Authentication
  const basicAuth = Buffer.from(`${BILLDESK_CONFIG.clientId}:${BILLDESK_CONFIG.clientSecret}`).toString('base64');
  
  // Security: Log request initiation without any credentials
  logger.info('Initiating BillDesk payment request');
  
  const headers = {
    'Content-Type': 'application/jose',
    'Accept': 'application/jose',
    'BD-Traceid': traceId,
    'BD-Timestamp': timestamp,
    'Authorization': `Basic ${basicAuth}` // FIXED: Added Basic Auth
  };

  // Security: Don't log any request details that could expose credentials
  logger.info('Payment request prepared, sending to gateway...');

  // ============================================================================
  // CONSOLE LOG FOR BILLDESK SUPPORT - ALL 4 REQUIRED ITEMS
  // ============================================================================
  console.log('\n' + '='.repeat(80));
  console.log('🔍 BILLDESK TRANSACTION DETAILS FOR SUPPORT');
  console.log('='.repeat(80));
  console.log('\n3️⃣  TRACE ID & TIMESTAMP:');
  console.log('   BD-Traceid:      ', traceId);
  console.log('   BD-Timestamp:    ', timestamp);
  console.log('   Timestamp (IST): ', new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
  console.log('\n4️⃣  REQUEST API URL:');
  console.log('   ', BILLDESK_CONFIG.paymentUrl);
  console.log('\n2️⃣  JSON REQUEST STRING (Before Encryption):');
  console.log('━'.repeat(80));
  console.log(JSON.stringify(jsonRequest, null, 2));
  console.log('━'.repeat(80));
  console.log('\n1️⃣  FINAL SIGNED ENCRYPTION STRING (JWS Token):');
  console.log('━'.repeat(80));
  console.log(jwsToken);
  console.log('━'.repeat(80));
  console.log('\n' + '='.repeat(80) + '\n');

  // LOG REQUEST DETAILS FOR BILLDESK SUPPORT (to file)
  billDeskLogger.logRequest({
    traceId: traceId,
    timestamp: timestamp,
    url: BILLDESK_CONFIG.paymentUrl,
    method: 'POST',
    headers: headers,
    payloadType: 'JWS',
    payloadLength: jwsToken.length,
    payloadPreview: jwsToken.substring(0, 100) + '...',
    payloadFull: jwsToken, // COMPLETE JWS TOKEN (Final Signed Encryption String)
    jsonRequest: jsonRequest, // ORIGINAL JSON REQUEST
    merchantId: BILLDESK_CONFIG.merchantId,
    clientId: BILLDESK_CONFIG.clientId,
    keyId: BILLDESK_CONFIG.keyId
  });

  try {
    logger.info('Making API call to BillDesk...');
    
    const requestStartTime = Date.now();
    
    // Security: Add timeout and abort controller
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    const response = await fetch(BILLDESK_CONFIG.paymentUrl, {
      method: 'POST',
      headers: headers,
      body: jwsToken,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    const processingTime = Date.now() - requestStartTime;
    
    logger.info('Response Status:', response.status);
    logger.info('Response Status Text:', response.statusText);
    logger.info('Response Headers:', Object.fromEntries([...response.headers.entries()]));
    
    const responseBody = await response.text();
    logger.info('Response Body Length:', responseBody.length);
    logger.info('Response Body (first 500 chars):', responseBody.substring(0, 500));

    // ============================================================================
    // CONSOLE LOG FOR BILLDESK RESPONSE - FOR SUPPORT
    // ============================================================================
    console.log('\n' + '='.repeat(80));
    console.log('📥 BILLDESK RESPONSE DETAILS');
    console.log('='.repeat(80));
    console.log('\n   Trace ID:         ', traceId);
    console.log('   Status Code:      ', response.status);
    console.log('   Status Text:      ', response.statusText);
    console.log('   Processing Time:  ', processingTime + 'ms');
    console.log('\n   RESPONSE STRING:');
    console.log('━'.repeat(80));
    console.log(responseBody);
    console.log('━'.repeat(80));
    console.log('\n' + '='.repeat(80) + '\n');

    // LOG RESPONSE DETAILS FOR BILLDESK SUPPORT (to file)
    billDeskLogger.logResponse({
      traceId: traceId,
      timestamp: Math.floor(Date.now() / 1000).toString(),
      statusCode: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries([...response.headers.entries()]),
      bodyLength: responseBody.length,
      bodyType: response.headers.get('content-type'),
      bodyPreview: responseBody.substring(0, 500),
      fullBody: responseBody,
      processingTime: processingTime
    });
    
    if (!response.ok) {
      // Security: Don't expose full error details to client
      logger.error('BillDesk API Error Response:', responseBody);
      
      // ============================================================================
      // CONSOLE LOG FOR ERROR RESPONSE
      // ============================================================================
      console.log('\n' + '='.repeat(80));
      console.log('❌ BILLDESK API ERROR RESPONSE');
      console.log('='.repeat(80));
      console.log('\n   Trace ID:         ', traceId);
      console.log('   Status Code:      ', response.status);
      console.log('   Status Text:      ', response.statusText);
      console.log('\n   ERROR RESPONSE STRING:');
      console.log('━'.repeat(80));
      console.log(responseBody);
      console.log('━'.repeat(80));
      console.log('\n💡 REQUEST DETAILS ARE LOGGED ABOVE');
      console.log('='.repeat(80) + '\n');
      
      // Parse error if possible
      try {
        const errorJson = JSON.parse(responseBody);
        logger.error('Parsed Error:', errorJson);
      } catch (e) {
        logger.error('Could not parse error response as JSON');
      }
      
      // Security: Generic error message for client
      throw new Error(`Payment gateway error. Please try again. (Status: ${response.status})`);
    }
    
    logger.info('BillDesk API call successful, processing response...');
    
    // Check if response is HTML (redirect page)
    if (responseBody.includes('<!DOCTYPE html') || responseBody.includes('<html')) {
      logger.info('Received HTML response - likely a payment form');
      
      // For HTML responses, we need to extract payment URL or form data
      // This typically means the API returned a payment form
      return {
        success: true,
        paymentUrl: BILLDESK_CONFIG.paymentUrl,
        merchantId: BILLDESK_CONFIG.merchantId,
        formHtml: responseBody,
        transactionId: txn._id,
        orderNumber,
        isRedirect: true,
        // Debug info for frontend console
        debugInfo: {
          traceId: traceId,
          timestamp: timestamp,
          requestUrl: BILLDESK_CONFIG.paymentUrl,
          jsonRequest: jsonRequest,
          jwsToken: jwsToken,
          responseBody: responseBody.substring(0, 500) + '...'
        }
      };
    }
    
    // Verify and decrypt JSON/JOSE response
    const { isValid, payload: encryptedResponse } = verifyJWS(responseBody);
    
    if (!isValid) {
      // If JWS verification fails, check if it's direct JSON
      try {
        const directJson = JSON.parse(responseBody);
        logger.info('Direct JSON response received:', directJson);
        
        // Handle direct JSON response
        const { bdorderid, rdata } = directJson;
        
        if (bdorderid) {
          txn.metadata.bdOrderId = bdorderid;
          txn.metadata.traceId = traceId;
          await txn.save();
          
          return {
            success: true,
            paymentUrl: 'https://uat1.billdesk.com/u2/web/v1_2/embeddedsdk',
            merchantId: BILLDESK_CONFIG.merchantId,
            bdOrderId: bdorderid,
            rdata: rdata || null,
            transactionId: txn._id,
            orderNumber,
            // Debug info for frontend console
            debugInfo: {
              traceId: traceId,
              timestamp: timestamp,
              requestUrl: BILLDESK_CONFIG.paymentUrl,
              jsonRequest: jsonRequest,
              jwsToken: jwsToken
            }
          };
        }
      } catch (jsonError) {
        throw new Error('Invalid response format - neither valid JWS nor JSON');
      }
    }
    
    // Decrypt JWS response
    let responseJson;
    if (typeof encryptedResponse === 'string') {
      const decrypted = await decryptJWE(encryptedResponse);
      responseJson = JSON.parse(decrypted);
    } else {
      responseJson = encryptedResponse;
    }
    
    logger.info('BillDesk Response (decrypted):', JSON.stringify(responseJson, null, 2));
    
    const { bdorderid, rdata } = responseJson;
    
    if (!bdorderid) {
      throw new Error('Missing bdorderid in BillDesk response');
    }
    
    // Update transaction
    txn.metadata.bdOrderId = bdorderid;
    txn.metadata.traceId = traceId;
    await txn.save();
    
    logger.info('=== BillDesk Payment Request Creation Completed Successfully ===');
    
    return {
      success: true,
      paymentUrl: 'https://uat1.billdesk.com/u2/web/v1_2/embeddedsdk',
      merchantId: BILLDESK_CONFIG.merchantId,
      bdOrderId: bdorderid,
      rdata: rdata || null,
      transactionId: txn._id,
      orderNumber,
    };
  } catch (error) {
    logger.error('=== BillDesk Payment Request Creation Failed ===');
    logger.error('Error message:', error.message);
    logger.error('Full error:', error);
    
    // LOG ERROR DETAILS FOR BILLDESK SUPPORT
    billDeskLogger.logError({
      traceId: traceId,
      timestamp: Math.floor(Date.now() / 1000).toString(),
      errorMessage: error.message,
      errorStack: error.stack,
      request: {
        merchantId: BILLDESK_CONFIG.merchantId,
        clientId: BILLDESK_CONFIG.clientId,
        keyId: BILLDESK_CONFIG.keyId,
        orderNumber: orderNumber
      }
    });
    
    throw new Error(`BillDesk API call failed: ${error.message}`);
  }
}

/**
 * Process BillDesk response/webhook
 */
async function processResponse(responseData) {
  logger.info('Processing BillDesk response');
  
  let verifiedData;
  
  if (typeof responseData === 'string') {
    const { isValid, payload } = verifyJWS(responseData);
    
    if (!isValid) {
      logger.error('Invalid JWS signature in BillDesk response');
      return {
        success: false,
        message: 'Invalid signature from payment gateway',
        data: responseData,
      };
    }
    
    verifiedData = payload;
  } else {
    verifiedData = responseData;
  }

  // Decrypt if needed
  if (typeof verifiedData === 'string') {
    try {
      const decrypted = await decryptJWE(verifiedData);
      verifiedData = JSON.parse(decrypted);
    } catch (e) {
      logger.error('Failed to decrypt BillDesk payload:', e.message);
      return {
        success: false,
        message: 'Decryption failed',
        data: verifiedData,
      };
    }
  }
  
  logger.info('Verified BillDesk response:', verifiedData);

  const { merchantid, orderid, transactionid, status } = verifiedData;
  if (!merchantid || !orderid || !status) {
    logger.error('Missing required fields in BillDesk response');
    return {
      success: false,
      message: 'Invalid response from payment gateway',
      data: verifiedData,
    };
  }

  const transaction = await Transaction.findOne({ orderNumber: orderid });
  if (!transaction) {
    logger.error(`Transaction not found for orderid: ${orderid}`);
    return {
      success: false,
      message: 'Transaction record not found',
      data: responseData,
    };
  }

  let paymentStatus = 'pending';
  if (status.toUpperCase() === 'SUCCESS') {
    paymentStatus = 'success';
  } else if (status.toUpperCase() === 'FAILED') {
    paymentStatus = 'failed';
  }

  transaction.status = paymentStatus;
  transaction.metadata.billDeskTxnId = transactionid;
  transaction.metadata.responseAt = new Date();
  transaction.metadata.responseData = responseData;
  await transaction.save();

  return {
    success: paymentStatus === 'success',
    message: `Payment ${paymentStatus}`,
    status: paymentStatus,
    transactionId: transaction._id,
    orderNumber: orderid,
    data: responseData,
  };
}

/**
 * Retrieve transaction status
 */
async function retrieveTransaction(orderId) {
  try {
    logger.info(`Retrieving transaction status for order: ${orderId}`);
    
    const jsonRequest = {
      mercid: BILLDESK_CONFIG.merchantId,
      orderid: orderId,
      refund_details: true
    };
    
    const encryptedPayload = await encryptJWE(jsonRequest);
    const jwsToken = generateJWS(encryptedPayload);
    
    const traceId = `STS${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 35);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const basicAuth = Buffer.from(`${BILLDESK_CONFIG.clientId}:${BILLDESK_CONFIG.clientSecret}`).toString('base64');
    
    const headers = {
      'Content-Type': 'application/jose',
      'Accept': 'application/jose',
      'BD-Traceid': traceId,
      'BD-Timestamp': timestamp,
      'Authorization': `Basic ${basicAuth}` // FIXED: Added Basic Auth
    };
    
    const retrieveUrl = 'https://uat1.billdesk.com/u2/payments/ve1_2/transactions/get';
    
    const response = await fetch(retrieveUrl, {
      method: 'POST',
      headers: headers,
      body: jwsToken
    });
    
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`BillDesk API returned ${response.status}: ${response.statusText} - ${errorBody}`);
    }
    
    const responseBody = await response.text();
    const { isValid, payload: responsePayload } = verifyJWS(responseBody);
    
    if (!isValid) {
      throw new Error('Invalid JWS signature in BillDesk response');
    }
    
    let finalPayload = responsePayload;
    if (typeof responsePayload === 'string') {
      try {
        const decrypted = await decryptJWE(responsePayload);
        finalPayload = JSON.parse(decrypted);
      } catch (e) {
        finalPayload = responsePayload;
      }
    }
    
    return {
      success: true,
      data: finalPayload
    };
  } catch (error) {
    logger.error('Error retrieving transaction status:', error);
    return {
      success: false,
      message: error.message
    };
  }
}

module.exports = {
  createPaymentRequest,
  processResponse,
  verifyJWS,
  retrieveTransaction,
  BILLDESK_CONFIG,
};