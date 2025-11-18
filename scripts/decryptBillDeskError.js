/**
 * Decrypt BillDesk Error Response
 * This script decrypts the 422 error response from BillDesk
 */

require('dotenv').config();
const jose = require('node-jose');

// BillDesk error response from your logs
const encryptedError = "eyJhbGciOiJIUzI1NiIsImNsaWVudGlkIjoiYmR1YXQyazU2NHNqIiwia2lkIjoiSE1BQyJ9.ZXlKamJHbGxiblJwWkNJNkltSmtkV0YwTW1zMU5qUnphaUlzSW1WdVl5STZJa0V5TlRaSFEwMGlMQ0poYkdjaU9pSmthWElpTENKcmFXUWlPaUkzYURKM1lrSjFVWEJuUVZVaWZRLi5BbERmSW02M2Zsc0xUT2dpLl92eFVFdllyNlJ5RGtscTdEV3E5bkd0VVhUZXpOWEVJZ0NaRnlnelNobWRONmUwaUhZTFc0OE53eE9EdFpNZXlTdUpwVEJPOU5rWGV1VUtGR0pxQVUzTXladU9rem9mbXJwNEo1bjZ1eTBGUXEteWIzOURybElEX3pQdU5PcDlpZ1dRQWhIZktudWsuWDlTbWZjeDJwYjRYVE5fYlJESEZOZw.BDAPbRNzxc8WV6y8wtSchZIR7gOCX4Kbke8TAFHAn4M";

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

async function verifyAndDecrypt(request, encryptionKey, encryptionKeyId, signingKey, signingKeyId) {
    let verified = await verify(request, signingKey, signingKeyId);
    let decrypted = await decrypt(verified, encryptionKey, encryptionKeyId);
    return decrypted;
}

async function decryptError() {
    console.log('\n========================================');
    console.log('DECRYPTING BILLDESK ERROR RESPONSE');
    console.log('========================================\n');
    
    const encryptionPassword = process.env.BILLDESK_ENCRYPTION_PASSWORD;
    const signingPassword = process.env.BILLDESK_SIGNING_PASSWORD;
    const keyId = process.env.BILLDESK_SECURITY_ID;
    
    console.log('Encrypted Error Response:');
    console.log(encryptedError.substring(0, 100) + '...\n');
    
    // First, decode the JWS header to see what kid is being used
    const parts = encryptedError.split('.');
    const headerB64 = parts[0];
    const headerJson = JSON.parse(Buffer.from(headerB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    console.log('JWS Header:', JSON.stringify(headerJson, null, 2));
    console.log();
    
    // Try decryption with different kid values
    console.log('Attempting to decrypt with different key IDs...\n');
    
    // Try 1: With actual keyId
    try {
        console.log('Try 1: Using keyId =', keyId);
        const decrypted = await verifyAndDecrypt(
            encryptedError,
            encryptionPassword,
            keyId,
            signingPassword,
            keyId
        );
        console.log('✅ Success!');
        console.log('\nDecrypted Error Message:');
        console.log('━'.repeat(80));
        const errorObj = JSON.parse(decrypted);
        console.log(JSON.stringify(errorObj, null, 2));
        console.log('━'.repeat(80));
        return;
    } catch (e) {
        console.log('❌ Failed:', e.message);
    }
    
    // Try 2: With "HMAC" as kid
    try {
        console.log('\nTry 2: Using kid = "HMAC"');
        const decrypted = await verifyAndDecrypt(
            encryptedError,
            encryptionPassword,
            "HMAC",
            signingPassword,
            "HMAC"
        );
        console.log('✅ Success!');
        console.log('\nDecrypted Error Message:');
        console.log('━'.repeat(80));
        const errorObj = JSON.parse(decrypted);
        console.log(JSON.stringify(errorObj, null, 2));
        console.log('━'.repeat(80));
        return;
    } catch (e) {
        console.log('❌ Failed:', e.message);
    }
    
    // Try 3: Verify with HMAC kid, decrypt with actual kid
    try {
        console.log('\nTry 3: Verify with "HMAC", Decrypt with actual keyId');
        const verified = await verify(encryptedError, signingPassword, "HMAC");
        const decrypted = await decrypt(verified, encryptionPassword, keyId);
        console.log('✅ Success!');
        console.log('\nDecrypted Error Message:');
        console.log('━'.repeat(80));
        const errorObj = JSON.parse(decrypted);
        console.log(JSON.stringify(errorObj, null, 2));
        console.log('━'.repeat(80));
        return;
    } catch (e) {
        console.log('❌ Failed:', e.message);
    }
    
    console.log('\n❌ Could not decrypt error response with any method\n');
}

decryptError();
