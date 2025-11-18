// scripts/verifyBillDeskAuth.js
// Detailed authentication verification for BillDesk

require('dotenv').config();
const fetch = require('node-fetch');

console.log('\n' + '='.repeat(80));
console.log('🔐 BILLDESK AUTHENTICATION VERIFICATION');
console.log('='.repeat(80) + '\n');

const CONFIG = {
  merchantId: process.env.BILLDESK_MERCHANT_ID,
  keyId: process.env.BILLDESK_SECURITY_ID,
  clientId: process.env.BILLDESK_CLIENT_ID,
  clientSecret: process.env.BILLDESK_CLIENT_SECRET,
  signingPassword: process.env.BILLDESK_SIGNING_PASSWORD,
  encryptionPassword: process.env.BILLDESK_ENCRYPTION_PASSWORD,
  paymentUrl: process.env.BILLDESK_PAYMENT_URL
};

// Step 1: Verify all credentials are present and show lengths (not actual values)
console.log('📋 Step 1: Credential Verification\n');
console.log('Merchant ID:', CONFIG.merchantId);
console.log('Security ID (kid):', CONFIG.keyId);
console.log('Client ID:', CONFIG.clientId);
console.log('Client Secret length:', CONFIG.clientSecret?.length, 'chars');
console.log('Signing Password length:', CONFIG.signingPassword?.length, 'chars');
console.log('Encryption Password length:', CONFIG.encryptionPassword?.length, 'chars');

// Step 2: Test Basic Auth header creation
console.log('\n📋 Step 2: Basic Auth Header Test\n');
const basicAuthString = `${CONFIG.clientId}:${CONFIG.clientSecret}`;
const basicAuth = Buffer.from(basicAuthString).toString('base64');
console.log('Basic Auth String Format: <clientId>:<clientSecret>');
console.log('Client ID:', CONFIG.clientId);
console.log('Client Secret (first 4 chars):', CONFIG.clientSecret?.substring(0, 4) + '...');
console.log('Base64 Encoded (first 20 chars):', basicAuth.substring(0, 20) + '...');
console.log('Full Base64 length:', basicAuth.length, 'chars');

// Step 3: Expected vs Actual credentials check
console.log('\n📋 Step 3: Credential Format Validation\n');

// Check if credentials match expected UAT patterns
const expectedPatterns = {
  merchantId: /^BD[A-Z0-9]+$/,
  securityId: /^[a-zA-Z0-9]+$/,
  clientId: /^[a-z0-9]+$/
};

console.log('Merchant ID format:', expectedPatterns.merchantId.test(CONFIG.merchantId) ? '✅ Valid' : '❌ Invalid');
console.log('Security ID format:', expectedPatterns.securityId.test(CONFIG.keyId) ? '✅ Valid' : '❌ Invalid');
console.log('Client ID format:', expectedPatterns.clientId.test(CONFIG.clientId) ? '✅ Valid' : '❌ Invalid');

// Step 4: Make a simple test call with just Basic Auth (no payload)
console.log('\n📋 Step 4: Testing Basic Auth (without payload)\n');

async function testBasicAuthOnly() {
  try {
    const traceId = `AUTH_TEST_${Date.now()}`;
    const timestamp = Math.floor(Date.now() / 1000).toString();
    
    const headers = {
      'BD-Traceid': traceId,
      'BD-Timestamp': timestamp,
      'Authorization': `Basic ${basicAuth}`
    };
    
    console.log('Making OPTIONS/HEAD request to test auth...');
    console.log('Headers:', {
      'BD-Traceid': traceId,
      'BD-Timestamp': timestamp,
      'Authorization': 'Basic ' + basicAuth.substring(0, 20) + '...'
    });
    
    // Try with minimal request first
    const response = await fetch(CONFIG.paymentUrl, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/jose',
        'Accept': 'application/jose'
      },
      body: 'test' // Minimal body to see what error we get
    });
    
    const responseText = await response.text();
    
    console.log('\nResponse Status:', response.status);
    console.log('Response:', responseText);
    
    if (response.status === 401) {
      console.log('\n⚠️  401 Unauthorized - Possible causes:');
      console.log('   1. IP address not whitelisted (MOST LIKELY if from local machine)');
      console.log('   2. Client ID or Client Secret is incorrect');
      console.log('   3. Credentials are not active in BillDesk system');
      console.log('\n📍 Your request is coming from your LOCAL machine');
      console.log('   BillDesk expects requests from: 13.202.208.101 (your EC2)');
      console.log('   This test WILL fail unless run from EC2 instance');
    } else if (response.status === 400) {
      console.log('\n✅ Authentication might be working!');
      console.log('   (400 Bad Request usually means auth passed but payload is wrong)');
    } else {
      console.log('\n📋 Unexpected status:', response.status);
    }
    
    return response.status;
  } catch (error) {
    console.log('\n❌ Request failed:', error.message);
    return null;
  }
}

// Step 5: Recommendations
async function runVerification() {
  await testBasicAuthOnly();
  
  console.log('\n' + '='.repeat(80));
  console.log('📋 RECOMMENDATIONS');
  console.log('='.repeat(80) + '\n');
  
  console.log('1️⃣  IF you get 401 from LOCAL machine:');
  console.log('   → This is EXPECTED and NORMAL');
  console.log('   → You MUST test from EC2: ssh ubuntu@13.202.208.101');
  console.log('   → Then run: node scripts/testBillDeskCredentials.js\n');
  
  console.log('2️⃣  IF you get 401 from EC2 instance:');
  console.log('   → Ask BillDesk to whitelist IP: 13.202.208.101');
  console.log('   → Verify credentials with BillDesk support\n');
  
  console.log('3️⃣  IF you get 400 or other errors:');
  console.log('   → Authentication is likely working');
  console.log('   → Issue is with payload format (already fixed)\n');
  
  console.log('4️⃣  Current Credentials Being Used:');
  console.log('   → Merchant: ' + CONFIG.merchantId);
  console.log('   → Client ID: ' + CONFIG.clientId);
  console.log('   → Security ID: ' + CONFIG.keyId);
  
  console.log('\n' + '='.repeat(80) + '\n');
}

runVerification();
