/**
 * BillDesk Payment Integration Test Suite
 * Tests the complete payment flow from order creation to payment response
 * 
 * Usage:
 * 1. Set environment variables for BillDesk credentials
 * 2. Run: node tests/billdesk.test.js
 * 3. Check logs/billdesk-test-results.log for detailed output
 */

require('dotenv').config();
const mongoose = require('mongoose');
const billDeskService = require('../services/billDeskService');
const Order = require('../models/Order');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

// Test configuration
const TEST_CONFIG = {
  testAmount: 399.00,
  testCustomerEmail: 'test@10xdrink.com',
  testCustomerPhone: '9876543210',
  clientIp: '192.168.1.1',
  logFile: path.join(__dirname, '../logs/billdesk-test-results.log')
};

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

// Test results storage
const testResults = {
  total: 0,
  passed: 0,
  failed: 0,
  tests: []
};

/**
 * Log test message to console and file
 */
function logTest(message, type = 'info') {
  const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const logMessage = `[${timestamp}] ${message}`;
  
  // Console output with colors
  switch (type) {
    case 'success':
      console.log(`${colors.green}✓ ${message}${colors.reset}`);
      break;
    case 'error':
      console.log(`${colors.red}✗ ${message}${colors.reset}`);
      break;
    case 'warn':
      console.log(`${colors.yellow}⚠ ${message}${colors.reset}`);
      break;
    case 'info':
      console.log(`${colors.blue}ℹ ${message}${colors.reset}`);
      break;
    case 'header':
      console.log(`\n${colors.cyan}${colors.bright}${'='.repeat(80)}${colors.reset}`);
      console.log(`${colors.cyan}${colors.bright}${message}${colors.reset}`);
      console.log(`${colors.cyan}${colors.bright}${'='.repeat(80)}${colors.reset}\n`);
      break;
  }
  
  // File output
  fs.appendFileSync(TEST_CONFIG.logFile, logMessage + '\n');
}

/**
 * Assert helper function
 */
function assert(condition, testName, message) {
  testResults.total++;
  
  if (condition) {
    testResults.passed++;
    testResults.tests.push({ name: testName, status: 'PASSED', message });
    logTest(`${testName}: ${message}`, 'success');
    return true;
  } else {
    testResults.failed++;
    testResults.tests.push({ name: testName, status: 'FAILED', message });
    logTest(`${testName}: ${message}`, 'error');
    return false;
  }
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Test 1: Environment Configuration
 */
async function testEnvironmentConfig() {
  logTest('TEST 1: Environment Configuration', 'header');
  
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
  
  for (const varName of requiredVars) {
    const exists = !!process.env[varName];
    assert(
      exists,
      `ENV_${varName}`,
      exists ? `${varName} is set` : `${varName} is missing`
    );
  }
  
  // Test BillDesk config loading
  try {
    const config = billDeskService.BILLDESK_CONFIG;
    assert(
      config.merchantId && config.clientId,
      'CONFIG_LOADED',
      'BillDesk configuration loaded successfully'
    );
    
    logTest(`Merchant ID: ${config.merchantId}`, 'info');
    logTest(`Client ID: ${config.clientId}`, 'info');
    logTest(`Payment URL: ${config.paymentUrl}`, 'info');
  } catch (error) {
    assert(false, 'CONFIG_LOADED', `Failed to load config: ${error.message}`);
  }
}

/**
 * Test 2: Database Connection
 */
async function testDatabaseConnection() {
  logTest('TEST 2: Database Connection', 'header');
  
  try {
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(process.env.MONGO_URI);
    }
    
    assert(
      mongoose.connection.readyState === 1,
      'DB_CONNECTION',
      'MongoDB connected successfully'
    );
  } catch (error) {
    assert(false, 'DB_CONNECTION', `Database connection failed: ${error.message}`);
    throw error;
  }
}

/**
 * Test 3: Create Test User
 */
async function testCreateUser() {
  logTest('TEST 3: Create Test User', 'header');
  
  try {
    // Delete existing test user
    await User.deleteMany({ email: TEST_CONFIG.testCustomerEmail });
    
    const testUser = new User({
      name: 'BillDesk Test User',
      email: TEST_CONFIG.testCustomerEmail,
      phone: TEST_CONFIG.testCustomerPhone,
      password: 'test@123',
      role: 'user'
    });
    
    await testUser.save();
    
    assert(
      testUser._id,
      'USER_CREATION',
      `Test user created with ID: ${testUser._id}`
    );
    
    return testUser;
  } catch (error) {
    assert(false, 'USER_CREATION', `Failed to create test user: ${error.message}`);
    throw error;
  }
}

/**
 * Test 4: Create Test Order
 */
async function testCreateOrder(testUser) {
  logTest('TEST 4: Create Test Order', 'header');
  
  try {
    const testOrder = new Order({
      orderNumber: `ORD-TEST-${Date.now()}`,
      customer: testUser._id,
      phone: TEST_CONFIG.testCustomerPhone,
      items: [
        {
          product: new mongoose.Types.ObjectId(),
          variant: 'Original',
          packaging: '12 Pack',
          quantity: 1,
          price: 4.81 // USD price
        }
      ],
      totalAmountUSD: 4.81,
      totalAmountINR: TEST_CONFIG.testAmount,
      finalAmount: TEST_CONFIG.testAmount,
      status: 'pending',
      paymentMethod: 'billdesk',
      paymentStatus: 'pending',
      shippingAddress: {
        street: '123 Test Street',
        city: 'Mumbai',
        state: 'Maharashtra',
        zip: '400001',
        country: 'India',
        phone: TEST_CONFIG.testCustomerPhone
      },
      billingAddress: {
        street: '123 Test Street',
        city: 'Mumbai',
        state: 'Maharashtra',
        zip: '400001',
        country: 'India',
        phone: TEST_CONFIG.testCustomerPhone
      }
    });
    
    await testOrder.save();
    
    assert(
      testOrder._id,
      'ORDER_CREATION',
      `Test order created: ${testOrder.orderNumber} (${testOrder._id})`
    );
    
    logTest(`Order Amount: ₹${testOrder.finalAmount}`, 'info');
    logTest(`Customer: ${testUser.email}`, 'info');
    
    return testOrder;
  } catch (error) {
    assert(false, 'ORDER_CREATION', `Failed to create test order: ${error.message}`);
    throw error;
  }
}

/**
 * Test 5: JOSE Encryption/Decryption
 */
async function testJOSEEncryption() {
  logTest('TEST 5: JOSE Encryption & Decryption', 'header');
  
  try {
    const testData = JSON.stringify({
      test: 'BillDesk Payment Test',
      timestamp: Date.now()
    });
    
    logTest('Testing encryption...', 'info');
    const encrypted = await billDeskService.encryptAndSign(
      testData,
      process.env.BILLDESK_CLIENT_ID,
      process.env.BILLDESK_ENCRYPTION_PASSWORD,
      process.env.BILLDESK_SECURITY_ID,
      process.env.BILLDESK_SIGNING_PASSWORD,
      process.env.BILLDESK_SECURITY_ID
    );
    
    assert(
      encrypted && encrypted.length > 0,
      'JOSE_ENCRYPTION',
      `Data encrypted successfully (${encrypted.length} chars)`
    );
    
    logTest('Testing decryption...', 'info');
    const decrypted = await billDeskService.verifyAndDecrypt(
      encrypted,
      process.env.BILLDESK_ENCRYPTION_PASSWORD,
      process.env.BILLDESK_SECURITY_ID,
      process.env.BILLDESK_SIGNING_PASSWORD,
      process.env.BILLDESK_SECURITY_ID
    );
    
    const decryptedData = JSON.parse(decrypted);
    
    assert(
      decryptedData.test === 'BillDesk Payment Test',
      'JOSE_DECRYPTION',
      'Data decrypted and verified successfully'
    );
  } catch (error) {
    assert(false, 'JOSE_ENCRYPTION', `JOSE encryption/decryption failed: ${error.message}`);
  }
}

/**
 * Test 6: Payment Request Creation (Full Flow)
 */
async function testPaymentRequest(testOrder) {
  logTest('TEST 6: BillDesk Payment Request Creation', 'header');
  
  try {
    logTest('Initiating payment request...', 'info');
    
    const paymentResponse = await billDeskService.createPaymentRequest(
      testOrder,
      TEST_CONFIG.clientIp
    );
    
    // Test response structure
    assert(
      paymentResponse.success === true,
      'PAYMENT_SUCCESS_FLAG',
      'Payment response indicates success'
    );
    
    assert(
      paymentResponse.paymentUrl,
      'PAYMENT_URL',
      `Payment URL received: ${paymentResponse.paymentUrl}`
    );
    
    assert(
      paymentResponse.bdOrderId,
      'BD_ORDER_ID',
      `BillDesk Order ID: ${paymentResponse.bdOrderId}`
    );
    
    assert(
      paymentResponse.orderNumber === testOrder.orderNumber,
      'ORDER_NUMBER_MATCH',
      'Order number matches'
    );
    
    assert(
      paymentResponse.transactionId,
      'TRANSACTION_ID',
      `Transaction ID: ${paymentResponse.transactionId}`
    );
    
    // Log full response for debugging
    logTest('\nPayment Response Details:', 'info');
    logTest(JSON.stringify(paymentResponse, null, 2), 'info');
    
    // Check transaction record
    const transaction = await Transaction.findById(paymentResponse.transactionId);
    
    assert(
      transaction && transaction.status === 'pending',
      'TRANSACTION_RECORD',
      `Transaction record created with status: ${transaction?.status}`
    );
    
    logTest('\n🎉 PAYMENT REQUEST SUCCESSFUL!', 'success');
    logTest(`\n📋 Next Steps:`, 'info');
    logTest(`   1. Open payment URL: ${paymentResponse.paymentUrl}`, 'info');
    logTest(`   2. Add bdOrderId as query param: ?bdOrderId=${paymentResponse.bdOrderId}`, 'info');
    logTest(`   3. Complete payment on BillDesk page`, 'info');
    logTest(`   4. Check webhook for response`, 'info');
    
    return paymentResponse;
  } catch (error) {
    assert(false, 'PAYMENT_REQUEST', `Payment request failed: ${error.message}`);
    logTest(`Error stack: ${error.stack}`, 'error');
    throw error;
  }
}

/**
 * Test 7: Transaction Status Retrieval
 */
async function testTransactionRetrieval(orderNumber) {
  logTest('TEST 7: Transaction Status Retrieval', 'header');
  
  try {
    logTest('Retrieving transaction status...', 'info');
    
    const retrieveResponse = await billDeskService.retrieveTransaction(orderNumber);
    
    assert(
      retrieveResponse.success === true,
      'RETRIEVE_SUCCESS',
      'Transaction retrieval successful'
    );
    
    if (retrieveResponse.data) {
      logTest('\nTransaction Status Details:', 'info');
      logTest(JSON.stringify(retrieveResponse.data, null, 2), 'info');
    }
    
    return retrieveResponse;
  } catch (error) {
    assert(false, 'RETRIEVE_TRANSACTION', `Transaction retrieval failed: ${error.message}`);
  }
}

/**
 * Test 8: Mock Webhook Response Processing
 */
async function testWebhookProcessing(orderNumber) {
  logTest('TEST 8: Webhook Response Processing (Mock)', 'header');
  
  try {
    // Create mock webhook response
    const mockResponse = {
      merchantid: process.env.BILLDESK_MERCHANT_ID,
      orderid: orderNumber,
      transactionid: `TXN${Date.now()}`,
      status: 'SUCCESS',
      amount: TEST_CONFIG.testAmount.toFixed(2),
      timestamp: new Date().toISOString()
    };
    
    logTest('Processing mock webhook response...', 'info');
    logTest(JSON.stringify(mockResponse, null, 2), 'info');
    
    const processResult = await billDeskService.processResponse(mockResponse);
    
    assert(
      processResult.success === true,
      'WEBHOOK_PROCESSING',
      'Webhook response processed successfully'
    );
    
    assert(
      processResult.status === 'success',
      'WEBHOOK_STATUS',
      `Payment status updated to: ${processResult.status}`
    );
    
    // Verify transaction update
    const transaction = await Transaction.findOne({ orderNumber });
    
    assert(
      transaction && transaction.status === 'success',
      'TRANSACTION_UPDATE',
      'Transaction status updated in database'
    );
    
    return processResult;
  } catch (error) {
    assert(false, 'WEBHOOK_PROCESSING', `Webhook processing failed: ${error.message}`);
  }
}

/**
 * Test 9: Rate Limiting
 */
async function testRateLimiting(testOrder) {
  logTest('TEST 9: Rate Limiting', 'header');
  
  try {
    logTest('Making 6 rapid requests to test rate limiting...', 'info');
    
    let rateLimitTriggered = false;
    
    for (let i = 0; i < 6; i++) {
      try {
        await billDeskService.createPaymentRequest(testOrder, TEST_CONFIG.clientIp);
        logTest(`Request ${i + 1}: Success`, 'info');
      } catch (error) {
        if (error.message.includes('Too many payment requests')) {
          rateLimitTriggered = true;
          logTest(`Request ${i + 1}: Rate limited (as expected)`, 'success');
          break;
        } else {
          throw error;
        }
      }
      
      await sleep(100);
    }
    
    assert(
      rateLimitTriggered,
      'RATE_LIMITING',
      'Rate limiting triggered after multiple requests'
    );
  } catch (error) {
    assert(false, 'RATE_LIMITING', `Rate limiting test failed: ${error.message}`);
  }
}

/**
 * Test 10: Error Handling
 */
async function testErrorHandling() {
  logTest('TEST 10: Error Handling', 'header');
  
  // Test with invalid order (no amount)
  try {
    const invalidOrder = { _id: new mongoose.Types.ObjectId() };
    await billDeskService.createPaymentRequest(invalidOrder);
    assert(false, 'ERROR_HANDLING_AMOUNT', 'Should have thrown error for invalid amount');
  } catch (error) {
    assert(
      error.message.includes('Invalid order amount'),
      'ERROR_HANDLING_AMOUNT',
      'Correctly validated order amount'
    );
  }
  
  // Test with excessive amount
  try {
    const excessiveOrder = {
      _id: new mongoose.Types.ObjectId(),
      finalAmount: 2000000 // 20 lakhs
    };
    await billDeskService.createPaymentRequest(excessiveOrder);
    assert(false, 'ERROR_HANDLING_MAX', 'Should have thrown error for excessive amount');
  } catch (error) {
    assert(
      error.message.includes('exceeds maximum limit'),
      'ERROR_HANDLING_MAX',
      'Correctly validated maximum amount'
    );
  }
}

/**
 * Generate Test Report
 */
function generateReport() {
  logTest('TEST REPORT', 'header');
  
  const passRate = ((testResults.passed / testResults.total) * 100).toFixed(2);
  
  logTest(`Total Tests: ${testResults.total}`, 'info');
  logTest(`Passed: ${testResults.passed}`, 'success');
  logTest(`Failed: ${testResults.failed}`, 'error');
  logTest(`Pass Rate: ${passRate}%`, passRate === '100.00' ? 'success' : 'warn');
  
  console.log('\n' + '='.repeat(80));
  console.log('DETAILED TEST RESULTS:');
  console.log('='.repeat(80) + '\n');
  
  testResults.tests.forEach((test, index) => {
    const status = test.status === 'PASSED' 
      ? `${colors.green}✓ PASSED${colors.reset}`
      : `${colors.red}✗ FAILED${colors.reset}`;
    
    console.log(`${index + 1}. ${test.name}: ${status}`);
    console.log(`   ${test.message}\n`);
  });
  
  // Write report to file
  const reportPath = path.join(__dirname, '../logs/billdesk-test-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    summary: {
      total: testResults.total,
      passed: testResults.passed,
      failed: testResults.failed,
      passRate: passRate + '%'
    },
    tests: testResults.tests
  }, null, 2));
  
  logTest(`\n📄 Detailed report saved to: ${reportPath}`, 'info');
}

/**
 * Main Test Runner
 */
async function runTests() {
  console.clear();
  
  logTest('🚀 BillDesk Payment Integration Test Suite', 'header');
  logTest(`Started at: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`, 'info');
  logTest(`Log file: ${TEST_CONFIG.logFile}\n`, 'info');
  
  // Clear previous log file
  if (fs.existsSync(TEST_CONFIG.logFile)) {
    fs.unlinkSync(TEST_CONFIG.logFile);
  }
  
  let testUser, testOrder, paymentResponse;
  
  try {
    // Run all tests
    await testEnvironmentConfig();
    await testDatabaseConnection();
    testUser = await testCreateUser();
    testOrder = await testCreateOrder(testUser);
    await testJOSEEncryption();
    paymentResponse = await testPaymentRequest(testOrder);
    
    // Wait a bit before retrieval
    await sleep(2000);
    
    await testTransactionRetrieval(testOrder.orderNumber);
    await testWebhookProcessing(testOrder.orderNumber);
    
    // Optional: Test rate limiting (commented out to avoid rate limit in production)
    // await testRateLimiting(testOrder);
    
    await testErrorHandling();
    
  } catch (error) {
    logTest(`\n❌ Test suite failed with error: ${error.message}`, 'error');
    console.error(error);
  } finally {
    // Generate report
    generateReport();
    
    // Cleanup
    logTest('\nCleaning up test data...', 'info');
    try {
      if (testUser) await User.findByIdAndDelete(testUser._id);
      if (testOrder) await Order.findByIdAndDelete(testOrder._id);
      if (paymentResponse) await Transaction.findByIdAndDelete(paymentResponse.transactionId);
      logTest('Test data cleaned up successfully', 'success');
    } catch (error) {
      logTest(`Cleanup failed: ${error.message}`, 'warn');
    }
    
    // Close database connection
    await mongoose.connection.close();
    logTest('\nDatabase connection closed', 'info');
    
    logTest(`\n✅ Test suite completed at: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`, 'success');
    
    // Exit with appropriate code
    process.exit(testResults.failed > 0 ? 1 : 0);
  }
}

// Run tests if executed directly
if (require.main === module) {
  runTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = {
  runTests,
  testResults
};
