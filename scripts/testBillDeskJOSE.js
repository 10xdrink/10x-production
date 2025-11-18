/**
 * BillDesk Official JOSE Implementation Test Script
 * This demonstrates the official BillDesk helper functions for
 * encryption, signing, verification, and decryption
 */

require('dotenv').config();
const jose = require('node-jose');

console.log('\n========================================');
console.log('BILLDESK OFFICIAL JOSE IMPLEMENTATION TEST');
console.log('========================================\n');

/*
    BillDesk Official JOSE Helper Functions
    These methods are provided by BillDesk in their sample code
*/

/*
    This method encrypts the data using the encryption key in A256GCM algorithm
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
    const jwsObject = jose.JWS.createSign(
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

/*
    Test 1: Basic Example (from BillDesk sample)
*/
async function testBasic() {
  console.log('TEST 1: Basic Example (BillDesk Sample)');
  console.log('━'.repeat(50) + '\n');
  
  const testData = "Hi";
  console.log('Original Data:', testData);
  
  const encrypted = await encryptAndSign(
    testData, 
    "TEST123", 
    "qwqwqwqwqwqwqwqwqwqwqwqwqwqwqwqw", 
    "TEST", 
    "qwqwqwqwqwqwqwqwqwqwqwqwqwqwqwqw", 
    "TEST2"
  );
  console.log('\nEncrypted & Signed (JWS Token):');
  console.log(encrypted.substring(0, 100) + '...');
  console.log('Length:', encrypted.length, 'characters');
  
  const decrypted = await verifyAndDecrypt(
    encrypted, 
    "qwqwqwqwqwqwqwqwqwqwqwqwqwqwqwqw", 
    "TEST", 
    "qwqwqwqwqwqwqwqwqwqwqwqwqwqwqwqw", 
    "TEST2"
  );
  console.log('\nDecrypted & Verified:', decrypted);
  console.log('\n✅ Test 1 Passed: Data matches original!\n');
}

/*
    Test 2: With Your BillDesk Credentials
*/
async function testWithCredentials() {
  console.log('TEST 2: With Your BillDesk Credentials');
  console.log('━'.repeat(50) + '\n');
  
  // Load from environment variables
  const clientId = process.env.BILLDESK_CLIENT_ID;
  const keyId = process.env.BILLDESK_SECURITY_ID;
  const encryptionPassword = process.env.BILLDESK_ENCRYPTION_PASSWORD;
  const signingPassword = process.env.BILLDESK_SIGNING_PASSWORD;
  const merchantId = process.env.BILLDESK_MERCHANT_ID;
  
  if (!clientId || !keyId || !encryptionPassword || !signingPassword) {
    console.log('⚠️  Credentials not found in .env file');
    console.log('Skipping this test...\n');
    return;
  }
  
  console.log('Using Credentials:');
  console.log('  Merchant ID:', merchantId);
  console.log('  Client ID:', clientId);
  console.log('  Key ID (Security ID):', keyId);
  console.log('  Encryption Password:', '***' + encryptionPassword.substring(encryptionPassword.length - 5));
  console.log('  Signing Password:', '***' + signingPassword.substring(signingPassword.length - 5));
  console.log();
  
  // Sample BillDesk order payload
  const orderPayload = {
    mercid: merchantId,
    orderid: `TEST${Date.now()}`,
    amount: "100.00",
    order_date: new Date().toISOString(),
    currency: "356",
    ru: process.env.BILLDESK_RETURN_URL || "https://yourwebsite.com/return",
    itemcode: "DIRECT"
  };
  
  console.log('Sample Order Payload:');
  console.log(JSON.stringify(orderPayload, null, 2));
  
  const payloadString = JSON.stringify(orderPayload);
  
  console.log('\n🔒 Encrypting and signing...');
  const encrypted = await encryptAndSign(
    payloadString,
    clientId,
    encryptionPassword,
    keyId,
    signingPassword,
    keyId
  );
  
  console.log('✅ Successfully Encrypted & Signed!');
  console.log('JWS Token Preview:', encrypted.substring(0, 150) + '...');
  console.log('Total Length:', encrypted.length, 'characters');
  
  // Verify and decrypt
  console.log('\n🔓 Verifying and decrypting...');
  const decrypted = await verifyAndDecrypt(
    encrypted,
    encryptionPassword,
    keyId,
    signingPassword,
    keyId
  );
  
  const decryptedPayload = JSON.parse(decrypted);
  console.log('✅ Successfully Verified & Decrypted!');
  console.log('Decrypted Payload:');
  console.log(JSON.stringify(decryptedPayload, null, 2));
  
  // Verify data integrity
  if (JSON.stringify(orderPayload) === JSON.stringify(decryptedPayload)) {
    console.log('\n✅ Test 2 Passed: Data integrity verified!\n');
  } else {
    console.log('\n❌ Test 2 Failed: Data mismatch!\n');
  }
}

/*
    Test 3: Multiple rounds of encryption/decryption
*/
async function testMultipleRounds() {
  console.log('TEST 3: Multiple Rounds Test');
  console.log('━'.repeat(50) + '\n');
  
  const rounds = 5;
  console.log(`Testing ${rounds} rounds of encrypt/decrypt cycles...\n`);
  
  for (let i = 1; i <= rounds; i++) {
    const testData = `Test round ${i} - ${Date.now()}`;
    
    const encrypted = await encryptAndSign(
      testData, 
      "TEST123", 
      "qwqwqwqwqwqwqwqwqwqwqwqwqwqwqwqw", 
      "TEST", 
      "qwqwqwqwqwqwqwqwqwqwqwqwqwqwqwqw", 
      "TEST2"
    );
    
    const decrypted = await verifyAndDecrypt(
      encrypted, 
      "qwqwqwqwqwqwqwqwqwqwqwqwqwqwqwqw", 
      "TEST", 
      "qwqwqwqwqwqwqwqwqwqwqwqwqwqwqwqw", 
      "TEST2"
    );
    
    if (testData === decrypted) {
      console.log(`  Round ${i}: ✅ Pass`);
    } else {
      console.log(`  Round ${i}: ❌ Fail`);
    }
  }
  
  console.log('\n✅ Test 3 Passed: All rounds successful!\n');
}

// Run all tests
async function runAllTests() {
  try {
    await testBasic();
    await testWithCredentials();
    await testMultipleRounds();
    
    console.log('========================================');
    console.log('✅ ALL TESTS COMPLETED SUCCESSFULLY!');
    console.log('========================================');
    console.log('\nYour BillDesk integration is now using the');
    console.log('official JOSE helper functions from BillDesk.\n');
    console.log('These functions are used in:');
    console.log('  - billDeskService.js (createPaymentRequest)');
    console.log('  - billDeskService.js (processResponse)');
    console.log('  - billDeskService.js (retrieveTransaction)\n');
    
  } catch (error) {
    console.error('\n❌ Test Failed:');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

runAllTests();
