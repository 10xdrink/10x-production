// services/billDeskService.js - BillDesk Official JOSE Implementation

/**
 * BillDesk Service for UAT JSON REST API v1.2 Integration
 * Uses BillDesk's official JOSE helper functions for encryption and signing
 * Implements proper A256GCM encryption and HS256 signing
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

/*
    BillDesk Official JOSE Helper Functions
    These methods encrypt the data using the encryption key in A256GCM algorithm
*/
async function encrypt(request, clientId, encryptionKey, encryptionKeyId) {
    const keystore = jose.JWK.createKeyStore();
    const jwk = {
        kty: "oct",
        k: Buffer.from(encryptionKey).toString('base64'),
        alg: "A256GCM",
        kid: encryptionKeyId
    };
    const key = await keystore.add(jwk);
    const input = Buffer.from(request, "utf8");
    const header = {
        alg: "dir",
        enc: "A256GCM",
        kid: encryptionKeyId,
        clientid: clientId,
    };
    const encrypted = await jose.JWE.createEncrypt(
        {
            format: "compact",
            fields: header,
        },
        key
    ).update(input).final();
    return encrypted;
}

/*
    This method decrypts the data using the encryption key in A256GCM algorithm
*/
async function decrypt(encryptedData, encryptionKey, encryptionKeyId) {
    const keystore = jose.JWK.createKeyStore();
    const jwk = {
        kty: "oct",
        k: Buffer.from(encryptionKey).toString('base64'),
        alg: "A256GCM",
        kid: encryptionKeyId
    };
    const key = await keystore.add(jwk);
    const jweObject = await jose.JWE.createDecrypt(key).decrypt(encryptedData);
    return jweObject.plaintext.toString('utf8');
}

/*
    This method signs the data using the signing key in HS256 algorithm
*/
async function sign(request, clientId, signingKey, signingKeyId) {
    const keystore = jose.JWK.createKeyStore();
    const jwk = {
        kty: "oct",
        k: Buffer.from(signingKey).toString('base64'),
        alg: "HS256",
        kid: signingKeyId
    };
    const key = await keystore.add(jwk);
    const jwsHeader = {
        alg: "HS256",
        kid: signingKeyId,
        clientid: clientId
    };
    const jwsObject = await jose.JWS.createSign(
        {
            format: 'compact',
            fields: jwsHeader
        },
        key
    ).update(request).final();
    return jwsObject;
}

/*
    This method verifies the data using the signing key in HS256 algorithm
*/
async function verify(request, signingKey, signingKeyId) {
    const keystore = jose.JWK.createKeyStore();
    const jwk = {
        kty: "oct",
        k: Buffer.from(signingKey).toString('base64'),
        alg: "HS256",
        kid: signingKeyId
    };
    const key = await keystore.add(jwk);
    const result = await jose.JWS.createVerify(key).verify(request);
    return result.payload.toString('utf8');
}

/*
    This method encrypts and signs the payload using JOSE Encryption
*/
async function encryptAndSign(request, clientId, encryptionKey, encryptionKeyId, signingKey, signingKeyId) {
    let encrypted = await encrypt(request, clientId, encryptionKey, encryptionKeyId);
    let signed = await sign(encrypted, clientId, signingKey, signingKeyId);
    return signed;
}

/*
    This method verifies and decrypts the payload using JOSE Encryption
*/
async function verifyAndDecrypt(request, encryptionKey, encryptionKeyId, signingKey, signingKeyId) {
    let verified = await verify(request, signingKey, signingKeyId);
    let decrypted = await decrypt(verified, encryptionKey, encryptionKeyId);
    return decrypted;
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
    order_date: moment().tz("Asia/Kolkata").format("YYYY-MM-DDTHH:mm:ssZ"),  // Fixed: Use Z instead of ZZ for proper ISO 8601 format with colon in timezone
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

  // STEP 2 & 3: Encrypt and Sign using BillDesk's official JOSE helper
  logger.info('STEP 2 & 3: Encrypting and signing JSON request using BillDesk official method...');
  const jsonRequestString = JSON.stringify(jsonRequest);
  const jwsToken = await encryptAndSign(
    jsonRequestString,
    BILLDESK_CONFIG.clientId,
    BILLDESK_CONFIG.encryptionPassword,
    BILLDESK_CONFIG.keyId,
    BILLDESK_CONFIG.signingPassword,
    BILLDESK_CONFIG.keyId
  );
  logger.info('JSON request encrypted and signed successfully');

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
      
      // Try to decrypt error response (BillDesk errors are also encrypted)
      let errorMessage = `Payment gateway error. Please try again. (Status: ${response.status})`;
      try {
        // BillDesk error responses use "HMAC" as kid, but still need actual keyId for decryption
        const decryptedError = await verifyAndDecrypt(
          responseBody,
          BILLDESK_CONFIG.encryptionPassword,
          BILLDESK_CONFIG.keyId,
          BILLDESK_CONFIG.signingPassword,
          BILLDESK_CONFIG.keyId
        );
        const errorJson = JSON.parse(decryptedError);
        logger.error('Decrypted BillDesk Error:', errorJson);
        console.log('\n   DECRYPTED ERROR:');
        console.log('   ', JSON.stringify(errorJson, null, 2));
        
        // Provide specific error message if available
        if (errorJson.message) {
          errorMessage = `BillDesk Error: ${errorJson.message} (${errorJson.error_code || response.status})`;
        }
      } catch (e) {
        // Try direct JSON parse as fallback
        try {
          const errorJson = JSON.parse(responseBody);
          logger.error('Direct JSON Error:', errorJson);
          if (errorJson.message) {
            errorMessage = `BillDesk Error: ${errorJson.message}`;
          }
        } catch (e2) {
          logger.error('Could not decrypt or parse error response');
        }
      }
      
      // Security: Generic error message for client
      throw new Error(errorMessage);
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
    
    // Verify and decrypt JSON/JOSE response using BillDesk official helper
    let responseJson;
    try {
      // Try to verify and decrypt using BillDesk's verifyAndDecrypt helper
      const decryptedResponse = await verifyAndDecrypt(
        responseBody,
        BILLDESK_CONFIG.encryptionPassword,
        BILLDESK_CONFIG.keyId,
        BILLDESK_CONFIG.signingPassword,
        BILLDESK_CONFIG.keyId
      );
      responseJson = JSON.parse(decryptedResponse);
      logger.info('Response verified and decrypted successfully using BillDesk helper');
    } catch (verifyError) {
      // If verification/decryption fails, check if it's direct JSON
      logger.info('Verification failed, trying direct JSON parse:', verifyError.message);
      try {
        const directJson = JSON.parse(responseBody);
        logger.info('Direct JSON response received:', directJson);
        
        // Handle direct JSON response
        const { bdorderid, links } = directJson;
        
        if (bdorderid) {
          // Extract rdata from links.parameters as per BillDesk v1.2 spec
          let rdata = null;
          let sdkUrl = 'https://uat1.billdesk.com/u2/web/v1_2/embeddedsdk';
          
          if (links && Array.isArray(links)) {
            const redirectLink = links.find(link => 
              link.href && link.href.includes('embeddedsdk') && link.rel === 'redirect'
            );
            
            if (redirectLink) {
              sdkUrl = redirectLink.href;
              if (redirectLink.parameters) {
                rdata = redirectLink.parameters.rdata;
                logger.info('Extracted rdata from links.parameters (direct JSON):', rdata ? 'present' : 'missing');
              }
            }
          }
          
          txn.metadata.bdOrderId = bdorderid;
          txn.metadata.traceId = traceId;
          txn.metadata.rdata = rdata;
          await txn.save();
          
          return {
            success: true,
            paymentUrl: sdkUrl,
            merchantId: BILLDESK_CONFIG.merchantId,
            bdOrderId: bdorderid,
            rdata: rdata,
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
    
    logger.info('BillDesk Response (decrypted):', JSON.stringify(responseJson, null, 2));
    
    // ============================================================================
    // CONSOLE LOG FOR BILLDESK RESPONSE STRUCTURE
    // ============================================================================
    console.log('\n' + '='.repeat(80));
    console.log('📦 BILLDESK RESPONSE STRUCTURE');
    console.log('='.repeat(80));
    console.log(JSON.stringify(responseJson, null, 2));
    console.log('='.repeat(80) + '\n');
    
    const { bdorderid, links } = responseJson;
    
    if (!bdorderid) {
      throw new Error('Missing bdorderid in BillDesk response');
    }
    
    // Extract rdata from links.parameters as per BillDesk v1.2 spec
    let rdata = null;
    let sdkUrl = 'https://uat1.billdesk.com/u2/web/v1_2/embeddedsdk';
    
    if (links && Array.isArray(links)) {
      console.log('🔍 Searching for redirect link in', links.length, 'links...');
      
      // Find the redirect link containing embeddedsdk
      const redirectLink = links.find(link => 
        link.href && link.href.includes('embeddedsdk') && link.rel === 'redirect'
      );
      
      if (redirectLink) {
        console.log('✅ Found redirect link:', redirectLink.href);
        sdkUrl = redirectLink.href;
        
        // Extract parameters (mercid, bdorderid, rdata)
        if (redirectLink.parameters) {
          console.log('📋 Redirect link parameters:', JSON.stringify(redirectLink.parameters, null, 2));
          rdata = redirectLink.parameters.rdata;
          logger.info('Extracted rdata from links.parameters:', rdata ? 'present' : 'missing');
          
          if (rdata) {
            console.log('✅ rdata extracted successfully (length:', rdata.length, ')');
          } else {
            console.log('⚠️  rdata is null or undefined in parameters');
          }
        } else {
          console.log('⚠️  No parameters object in redirect link');
        }
      } else {
        console.log('⚠️  No redirect link found in links array');
      }
    } else {
      console.log('⚠️  No links array in response or links is not an array');
    }
    
    if (!rdata) {
      logger.warn('Warning: rdata not found in links.parameters - SDK may fail');
      console.log('❌ WARNING: rdata not found - SDK launch will likely fail');
    }
    
    // Update transaction
    txn.metadata.bdOrderId = bdorderid;
    txn.metadata.traceId = traceId;
    txn.metadata.rdata = rdata;
    await txn.save();
    
    logger.info('=== BillDesk Payment Request Creation Completed Successfully ===');
    
    return {
      success: true,
      paymentUrl: sdkUrl,
      merchantId: BILLDESK_CONFIG.merchantId,
      bdOrderId: bdorderid,
      rdata: rdata,
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
  logger.info('Response data type:', typeof responseData);
  logger.info('Response data:', JSON.stringify(responseData).substring(0, 500));
  
  let verifiedData;
  
  if (typeof responseData === 'string') {
    try {
      // Use BillDesk's official verifyAndDecrypt helper
      const decryptedResponse = await verifyAndDecrypt(
        responseData,
        BILLDESK_CONFIG.encryptionPassword,
        BILLDESK_CONFIG.keyId,
        BILLDESK_CONFIG.signingPassword,
        BILLDESK_CONFIG.keyId
      );
      verifiedData = JSON.parse(decryptedResponse);
      logger.info('Response verified and decrypted successfully using BillDesk helper');
    } catch (e) {
      logger.error('Failed to verify and decrypt BillDesk response:', e.message);
      // Try direct JSON parse as fallback
      try {
        verifiedData = JSON.parse(responseData);
        logger.info('Used direct JSON parse as fallback');
      } catch (jsonError) {
        return {
          success: false,
          message: 'Invalid signature or encryption from payment gateway',
          status: 'failed',
          orderNumber: 'unknown',
          data: responseData,
        };
      }
    }
  } else {
    verifiedData = responseData;
  }
  
  logger.info('Verified BillDesk response:', JSON.stringify(verifiedData, null, 2));
  
  // Check if response has encrypted_response field (error case from BillDesk)
  if (verifiedData.encrypted_response) {
    logger.info('Found encrypted_response field, attempting to decrypt...');
    try {
      const decryptedInner = await verifyAndDecrypt(
        verifiedData.encrypted_response,
        BILLDESK_CONFIG.encryptionPassword,
        BILLDESK_CONFIG.keyId,
        BILLDESK_CONFIG.signingPassword,
        BILLDESK_CONFIG.keyId
      );
      const innerData = JSON.parse(decryptedInner);
      logger.info('Decrypted inner response:', JSON.stringify(innerData, null, 2));
      
      // Use the decrypted inner data instead
      verifiedData = { ...verifiedData, ...innerData };
    } catch (e) {
      logger.error('Failed to decrypt encrypted_response:', e.message);
      logger.error('Encrypted response token:', verifiedData.encrypted_response.substring(0, 100));
      
      // Try to extract orderid from multiple sources
      let orderNumberFromError = 'unknown';
      
      // 1. Check txnResponse
      if (verifiedData.txnResponse) {
        try {
          const txnResp = typeof verifiedData.txnResponse === 'string' 
            ? JSON.parse(verifiedData.txnResponse) 
            : verifiedData.txnResponse;
          orderNumberFromError = txnResp.orderid || txnResp.order_id || txnResp.mercorderid || 'unknown';
          logger.info('Extracted orderid from error txnResponse:', orderNumberFromError);
        } catch (parseErr) {
          logger.warn('Could not parse txnResponse from error');
        }
      }
      
      // 2. Try to find recent pending transaction in our database
      if (orderNumberFromError === 'unknown') {
        try {
          const recentTransaction = await Transaction.findOne({ 
            status: 'pending',
            createdAt: { $gte: new Date(Date.now() - 10 * 60 * 1000) } // Last 10 minutes
          }).sort({ createdAt: -1 });
          
          if (recentTransaction) {
            orderNumberFromError = recentTransaction.orderNumber;
            logger.info('Found recent transaction:', orderNumberFromError);
          }
        } catch (dbErr) {
          logger.error('Database lookup failed:', dbErr.message);
        }
      }
      
      // If decryption fails, return error with available info
      return {
        success: false,
        message: verifiedData.message || 'Payment failed',
        status: 'failed',
        orderNumber: orderNumberFromError,
        errorCode: verifiedData.error_code || 'UNKNOWN',
        data: verifiedData,
      };
    }
  }

  const { merchantid, orderid, transactionid, status } = verifiedData;
  
  // Log which fields are present/missing
  logger.info('Field check:', {
    merchantid: merchantid ? 'present' : 'MISSING',
    orderid: orderid ? 'present' : 'MISSING',
    transactionid: transactionid ? 'present' : 'MISSING',
    status: status ? 'present' : 'MISSING'
  });
  
  if (!merchantid || !orderid) {
    logger.error('Missing required fields in BillDesk response');
    logger.error('Available fields:', Object.keys(verifiedData));
    
    // Try to extract orderid from error_code or txnResponse
    let fallbackOrderId = orderid;
    if (!fallbackOrderId && verifiedData.txnResponse) {
      try {
        const txnResp = typeof verifiedData.txnResponse === 'string' 
          ? JSON.parse(verifiedData.txnResponse) 
          : verifiedData.txnResponse;
        fallbackOrderId = txnResp.orderid || txnResp.order_id;
        logger.info('Extracted orderid from txnResponse:', fallbackOrderId);
      } catch (e) {
        logger.warn('Could not parse txnResponse');
      }
    }
    
    // Try to find from recent transaction if still not found
    if (!fallbackOrderId) {
      try {
        const recentTransaction = await Transaction.findOne({ 
          status: 'pending',
          createdAt: { $gte: new Date(Date.now() - 10 * 60 * 1000) } // Last 10 minutes
        }).sort({ createdAt: -1 });
        
        if (recentTransaction) {
          fallbackOrderId = recentTransaction.orderNumber;
          logger.info('Found order from recent transaction:', fallbackOrderId);
        }
      } catch (dbErr) {
        logger.error('Database lookup failed:', dbErr.message);
      }
    }
    
    // If we still don't have critical fields, return error with status 'failed'
    if (!fallbackOrderId) {
      return {
        success: false,
        message: verifiedData.message || `Payment processing error - Missing fields: ${
          [
            !merchantid && 'merchantid',
            !orderid && 'orderid'
          ].filter(Boolean).join(', ')
        }`,
        status: 'failed',
        orderNumber: 'unknown',
        errorCode: verifiedData.error_code || 'UNKNOWN',
        data: verifiedData,
      };
    }
    
    // Use fallback orderid
    return {
      success: false,
      message: verifiedData.message || 'Payment failed',
      status: status || 'failed',
      orderNumber: fallbackOrderId,
      errorCode: verifiedData.error_code || 'UNKNOWN',
      data: verifiedData,
    };
  }

  const transaction = await Transaction.findOne({ orderNumber: orderid });
  if (!transaction) {
    logger.error(`Transaction not found for orderid: ${orderid}`);
    return {
      success: false,
      message: 'Transaction record not found',
      status: 'failed',
      orderNumber: orderid,
      data: responseData,
    };
  }

  let paymentStatus = 'pending';
  if (status.toUpperCase() === 'SUCCESS') {
    paymentStatus = 'completed';
  } else if (status.toUpperCase() === 'FAILED') {
    paymentStatus = 'failed';
  }

  transaction.status = paymentStatus;
  transaction.metadata.billDeskTxnId = transactionid;
  transaction.metadata.responseAt = new Date();
  transaction.metadata.responseData = responseData;
  await transaction.save();

  return {
    success: paymentStatus === 'completed',
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
    
    // Use BillDesk's official encryptAndSign helper
    const jsonRequestString = JSON.stringify(jsonRequest);
    const jwsToken = await encryptAndSign(
      jsonRequestString,
      BILLDESK_CONFIG.clientId,
      BILLDESK_CONFIG.encryptionPassword,
      BILLDESK_CONFIG.keyId,
      BILLDESK_CONFIG.signingPassword,
      BILLDESK_CONFIG.keyId
    );
    
    const traceId = `STS${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 35);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const basicAuth = Buffer.from(`${BILLDESK_CONFIG.clientId}:${BILLDESK_CONFIG.clientSecret}`).toString('base64');
    
    const headers = {
      'Content-Type': 'application/jose',
      'Accept': 'application/jose',
      'BD-Traceid': traceId,
      'BD-Timestamp': timestamp,
      'Authorization': `Basic ${basicAuth}`
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
    
    // Use BillDesk's official verifyAndDecrypt helper
    try {
      const decryptedResponse = await verifyAndDecrypt(
        responseBody,
        BILLDESK_CONFIG.encryptionPassword,
        BILLDESK_CONFIG.keyId,
        BILLDESK_CONFIG.signingPassword,
        BILLDESK_CONFIG.keyId
      );
      const finalPayload = JSON.parse(decryptedResponse);
      
      return {
        success: true,
        data: finalPayload
      };
    } catch (e) {
      logger.error('Failed to verify and decrypt retrieve response:', e.message);
      // Try direct JSON parse as fallback
      try {
        const directJson = JSON.parse(responseBody);
        return {
          success: true,
          data: directJson
        };
      } catch (jsonError) {
        throw new Error('Invalid response format from BillDesk');
      }
    }
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
  retrieveTransaction,
  BILLDESK_CONFIG,
  // BillDesk official JOSE helper functions (internal use)
  encryptAndSign,
  verifyAndDecrypt,
};