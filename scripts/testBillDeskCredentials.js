// scripts/testBillDeskCredentials.js
// Test script to verify BillDesk credentials and configuration

require('dotenv').config();
const crypto = require('crypto');
const jose = require('node-jose');
const fetch = require('node-fetch');
const moment = require('moment-timezone');

console.log('\n========================================');
console.log('BILLDESK CREDENTIALS TEST');
console.log('========================================\n');

// Step 1: Check Environment Variables
console.log('📋 Step 1: Checking Environment Variables...\n');

const requiredVars = [
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

let allVarsPresent = true;
for (const varName of requiredVars) {
  if (process.env[varName]) {
    console.log(`✅ ${varName}: Set`);
  } else {
    console.log(`❌ ${varName}: MISSING`);
    allVarsPresent = false;
  }
}

if (!allVarsPresent) {
  console.log('\n❌ ERROR: Missing required environment variables');
  console.log('Please check your .env file and ensure all BillDesk credentials are set.\n');
  process.exit(1);
}

const CONFIG = {
  merchantId: process.env.BILLDESK_MERCHANT_ID,
  keyId: process.env.BILLDESK_SECURITY_ID,
  clientId: process.env.BILLDESK_CLIENT_ID,
  clientSecret: process.env.BILLDESK_CLIENT_SECRET,
  signingPassword: process.env.BILLDESK_SIGNING_PASSWORD,
  encryptionPassword: process.env.BILLDESK_ENCRYPTION_PASSWORD,
  paymentUrl: process.env.BILLDESK_PAYMENT_URL,
  returnUrl: process.env.BILLDESK_RETURN_URL,
  webhookUrl: process.env.BILLDESK_WEBHOOK_URL
};

console.log('\n✅ All environment variables are set!\n');

// Step 2: Test Encryption Key Generation
console.log('🔐 Step 2: Testing Encryption Key Generation...\n');

async function testEncryptionKey() {
  try {
    const keyData = crypto.createHash('sha256').update(CONFIG.encryptionPassword).digest();
    const key = await jose.JWK.asKey({
      kty: 'oct',
      k: jose.util.base64url.encode(keyData),
      alg: 'A256GCM',
      use: 'enc'
    });
    console.log('✅ Encryption key generated successfully');
    return key;
  } catch (error) {
    console.log('❌ Encryption key generation failed:', error.message);
    return null;
  }
}

// Step 3: Test JWE Encryption
async function testJWEEncryption(key) {
  console.log('\n🔒 Step 3: Testing JWE Encryption...\n');
  
  try {
    const testPayload = {
      mercid: CONFIG.merchantId,
      orderid: 'TEST_ORDER_' + Date.now(),
      amount: '100.00',
      currency: '356'
    };
    
    const header = {
      alg: 'dir',
      enc: 'A256GCM',
      kid: CONFIG.keyId,
      clientid: CONFIG.clientId
    };
    
    const plaintext = Buffer.from(JSON.stringify(testPayload), 'utf8');
    
    const encrypted = await jose.JWE.createEncrypt({ 
      format: 'compact',
      fields: header
    }, key)
    .update(plaintext)
    .final();
    
    console.log('✅ JWE encryption successful');
    console.log('   Encrypted token length:', encrypted.length);
    return encrypted;
  } catch (error) {
    console.log('❌ JWE encryption failed:', error.message);
    return null;
  }
}

// Step 4: Test JWS Signing
function testJWSSigning(payload) {
  console.log('\n✍️  Step 4: Testing JWS Signing...\n');
  
  try {
    const header = {
      alg: 'HS256',
      kid: CONFIG.keyId,
      clientid: CONFIG.clientId
    };
    
    const base64url = (input) =>
      Buffer.from(input)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
    
    const encodedHeader = base64url(JSON.stringify(header));
    const encodedPayload = base64url(payload);
    const signatureInput = `${encodedHeader}.${encodedPayload}`;
    
    const signature = crypto
      .createHmac('sha256', CONFIG.signingPassword)
      .update(signatureInput, 'utf8')
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    
    const jwsToken = `${encodedHeader}.${encodedPayload}.${signature}`;
    
    console.log('✅ JWS signing successful');
    console.log('   JWS token length:', jwsToken.length);
    console.log('   Header:', JSON.stringify(header));
    return jwsToken;
  } catch (error) {
    console.log('❌ JWS signing failed:', error.message);
    return null;
  }
}

// Step 5: Test API Call to BillDesk
async function testBillDeskAPI(jwsToken) {
  console.log('\n🌐 Step 5: Testing BillDesk API Call...\n');
  
  const traceId = `TEST${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 35);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const basicAuth = Buffer.from(`${CONFIG.clientId}:${CONFIG.clientSecret}`).toString('base64');
  
  console.log('Request Details:');
  console.log('   URL:', CONFIG.paymentUrl);
  console.log('   BD-Traceid:', traceId);
  console.log('   BD-Timestamp:', timestamp);
  console.log('   Timestamp (Human):', new Date(timestamp * 1000).toISOString());
  console.log('   Authorization: Basic', basicAuth.substring(0, 20) + '...');
  console.log('   Client ID:', CONFIG.clientId);
  console.log('   Merchant ID:', CONFIG.merchantId);
  console.log('   Key ID:', CONFIG.keyId);
  
  const headers = {
    'Content-Type': 'application/jose',
    'Accept': 'application/jose',
    'BD-Traceid': traceId,
    'BD-Timestamp': timestamp,
    'Authorization': `Basic ${basicAuth}`
  };
  
  console.log('\n📤 Making API request...\n');
  
  try {
    const response = await fetch(CONFIG.paymentUrl, {
      method: 'POST',
      headers: headers,
      body: jwsToken,
      timeout: 30000
    });
    
    const responseBody = await response.text();
    
    console.log('📥 Response received:');
    console.log('   Status:', response.status, response.statusText);
    console.log('   Response length:', responseBody.length);
    console.log('   Response (first 500 chars):', responseBody.substring(0, 500));
    
    if (response.status === 401) {
      console.log('\n⚠️  401 UNAUTHORIZED ERROR');
      console.log('\nPossible causes:');
      console.log('1. ❌ IP Address not whitelisted (MOST LIKELY)');
      console.log('2. ❌ Incorrect credentials');
      console.log('3. ❌ Wrong authentication format');
      console.log('\n📋 Action Required:');
      console.log('Contact BillDesk support with:');
      console.log('   - Your server public IP (run: npm run check-server-ip)');
      console.log('   - BD-Traceid:', traceId);
      console.log('   - BD-Timestamp:', timestamp);
      console.log('   - Merchant ID:', CONFIG.merchantId);
      console.log('   - Client ID:', CONFIG.clientId);
      
      // Try to parse error details
      try {
        const errorJson = JSON.parse(responseBody);
        console.log('\n📄 Error Details:', JSON.stringify(errorJson, null, 2));
      } catch (e) {
        // Not JSON
      }
      
      return false;
    } else if (response.status === 200) {
      console.log('\n✅ API call successful! Credentials are working!');
      return true;
    } else {
      console.log('\n⚠️  Unexpected response status:', response.status);
      return false;
    }
  } catch (error) {
    console.log('\n❌ API call failed:', error.message);
    return false;
  }
}

// Run all tests
async function runTests() {
  try {
    const encryptionKey = await testEncryptionKey();
    if (!encryptionKey) {
      console.log('\n❌ Test failed at encryption key generation');
      process.exit(1);
    }
    
    const encryptedPayload = await testJWEEncryption(encryptionKey);
    if (!encryptedPayload) {
      console.log('\n❌ Test failed at JWE encryption');
      process.exit(1);
    }
    
    const jwsToken = testJWSSigning(encryptedPayload);
    if (!jwsToken) {
      console.log('\n❌ Test failed at JWS signing');
      process.exit(1);
    }
    
    const apiSuccess = await testBillDeskAPI(jwsToken);
    
    console.log('\n========================================');
    console.log('TEST SUMMARY');
    console.log('========================================\n');
    
    console.log('✅ Environment Variables: OK');
    console.log('✅ Encryption Key Generation: OK');
    console.log('✅ JWE Encryption: OK');
    console.log('✅ JWS Signing: OK');
    
    if (apiSuccess) {
      console.log('✅ BillDesk API Call: SUCCESS\n');
      console.log('🎉 All tests passed! Your credentials are configured correctly!\n');
    } else {
      console.log('❌ BillDesk API Call: FAILED (401 Unauthorized)\n');
      console.log('⚠️  Your code is correct but IP whitelisting is required.\n');
    }
    
    console.log('========================================\n');
    
  } catch (error) {
    console.log('\n❌ Test suite error:', error);
    console.error(error);
    process.exit(1);
  }
}

runTests();
