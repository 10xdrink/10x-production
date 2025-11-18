#!/usr/bin/env node
/**
 * Script to extract BillDesk logs for support tickets
 * Usage:
 *   node scripts/getBillDeskLogs.js              - Get last 10 transactions
 *   node scripts/getBillDeskLogs.js <traceId>   - Get specific transaction by trace ID
 *   node scripts/getBillDeskLogs.js --all       - Get all recent logs
 *   node scripts/getBillDeskLogs.js --errors    - Get only error logs
 */

require('dotenv').config();
const billDeskLogger = require('../utils/billDeskLogger');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);

console.log('\n' + '='.repeat(80));
console.log('📋 BILLDESK LOG EXTRACTOR FOR SUPPORT TICKETS');
console.log('='.repeat(80) + '\n');

function formatLog(log) {
  return `
╔════════════════════════════════════════════════════════════════════════════╗
║ BillDesk Transaction Log
╚════════════════════════════════════════════════════════════════════════════╝

📌 TRANSACTION DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Type:              ${log.type}
Trace ID:          ${log.traceId}
Timestamp:         ${log.timestamp}
Timestamp (IST):   ${log.timestampIST}

${log.type === 'REQUEST' ? `
📤 REQUEST INFORMATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
URL:               ${log.url}
Method:            ${log.method}

HEADERS:
  Content-Type:    ${log.headers['Content-Type']}
  Accept:          ${log.headers['Accept']}
  BD-Traceid:      ${log.headers['BD-Traceid']}
  BD-Timestamp:    ${log.headers['BD-Timestamp']}
  Authorization:   ${log.headers['Authorization']}

CREDENTIALS:
  Merchant ID:     ${log.credentials.merchantId}
  Client ID:       ${log.credentials.clientId}
  Key ID:          ${log.credentials.keyId}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 1. ORIGINAL JSON REQUEST (Before Encryption):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${log.jsonRequest ? JSON.stringify(log.jsonRequest, null, 2) : 'N/A'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔐 2. FINAL SIGNED ENCRYPTION STRING (JWS Token - Complete):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${log.payload.fullJwsToken || 'N/A'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
` : ''}

${log.type === 'RESPONSE' ? `
📥 RESPONSE INFORMATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Status Code:       ${log.statusCode}
Status Text:       ${log.statusText}
Processing Time:   ${log.processingTime}ms

RESPONSE HEADERS:
${Object.entries(log.headers || {}).map(([k, v]) => `  ${k}: ${v}`).join('\n')}

RESPONSE BODY:
  Type:            ${log.body?.type || 'N/A'}
  Length:          ${log.body?.length || 0} bytes
  Preview:         ${log.body?.preview || 'N/A'}

FULL RESPONSE BODY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${log.body?.fullBody || 'N/A'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
` : ''}

${log.type === 'ERROR' ? `
❌ ERROR INFORMATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Error Message:     ${log.errorMessage}

Error Stack:
${log.errorStack || 'N/A'}

REQUEST CONTEXT:
${JSON.stringify(log.request || {}, null, 2)}
` : ''}

`.trim();
}

function generateSupportEmail(summary) {
  const requestLog = summary.fullLogs.find(l => l.type === 'REQUEST');
  
  return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📧 EMAIL TEMPLATE FOR BILLDESK SUPPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Subject: Payment Gateway Error - Request Debugging Assistance

Dear BillDesk Support Team,

We are experiencing issues with our payment integration and need your assistance 
in debugging the error. Below are the complete request and response details as requested:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔑 REQUIRED INFORMATION FOR DEBUGGING:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

3️⃣ TRACE ID & TIMESTAMP:
   BD-Traceid:      ${summary.request.bdTraceid}
   BD-Timestamp:    ${summary.request.bdTimestamp}
   Timestamp (IST): ${summary.timestampIST}

4️⃣ REQUEST API URL:
   ${summary.request.url}

MERCHANT CREDENTIALS:
   Merchant ID:     ${summary.request.merchantId}
   Client ID:       ${summary.request.clientId}
   Key ID:          ${summary.request.keyId}
   Authorization:   ${summary.request.hasAuthorization ? 'Present (Basic Auth)' : 'MISSING'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1️⃣ FINAL SIGNED ENCRYPTION STRING (JWS Token):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${requestLog?.payload?.fullJwsToken || 'N/A'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2️⃣ JSON REQUEST STRING (Before Encryption):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${requestLog?.jsonRequest ? JSON.stringify(requestLog.jsonRequest, null, 2) : 'N/A'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📥 RESPONSE RECEIVED:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Status Code:       ${summary.response.statusCode}
Status Text:       ${summary.response.statusText}
Content-Type:      ${summary.response.headers?.['content-type'] || 'N/A'}

Response Body:
${summary.response.bodyPreview}

${summary.error ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ ERROR DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${summary.error.message}
` : ''}

Could you please help us understand why this request is failing and what 
corrections are needed?

Additional Information:
- Environment: ${process.env.NODE_ENV || 'UAT'}
- Server IP: [Please add your server IP]
- Integration Type: JSON REST API v1.2 with JOSE

Thank you for your assistance.

Best regards,
[Your Name]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 COPY THE ABOVE EMAIL AND SEND TO BILLDESK SUPPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ ALL 4 REQUIRED ITEMS ARE INCLUDED ABOVE:
   1. Final Signed Encryption String (JWS Token)
   2. JSON Request String (Original payload before encryption)
   3. Trace ID and Timestamp (BD-Traceid, BD-Timestamp)
   4. Request API URL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();
}

function exportToFile(content, traceId) {
  const outputDir = path.join(__dirname, '../logs/support-tickets');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const filename = `billdesk-${traceId}-${Date.now()}.txt`;
  const filepath = path.join(outputDir, filename);
  
  fs.writeFileSync(filepath, content);
  console.log(`\n✅ Logs exported to: ${filepath}`);
}

// Main execution
if (args.length === 0) {
  // Get last 10 transactions
  console.log('📊 Fetching last 10 transactions...\n');
  const logs = billDeskLogger.getRecentLogs(10);
  
  if (logs.error) {
    console.error('❌ Error:', logs.error);
    console.log('\n💡 Tip: Make sure you have made at least one BillDesk API call.');
    process.exit(1);
  }
  
  if (logs.length === 0) {
    console.log('📭 No logs found. Make a BillDesk API call first.');
    process.exit(0);
  }
  
  logs.forEach((log, index) => {
    console.log(formatLog(log));
    if (index < logs.length - 1) {
      console.log('\n' + '═'.repeat(80) + '\n');
    }
  });
  
  console.log('\n\n💡 TIP: To get detailed summary for a specific transaction:');
  console.log('   node scripts/getBillDeskLogs.js <traceId>');
  
} else if (args[0] === '--all') {
  // Get all logs
  console.log('📊 Fetching all recent transactions...\n');
  const logs = billDeskLogger.getRecentLogs(100);
  
  if (logs.error) {
    console.error('❌ Error:', logs.error);
    process.exit(1);
  }
  
  console.log(`Found ${logs.length} log entries\n`);
  logs.forEach((log, index) => {
    console.log(formatLog(log));
    if (index < logs.length - 1) {
      console.log('\n' + '═'.repeat(80) + '\n');
    }
  });
  
} else if (args[0] === '--errors') {
  // Get only error logs
  console.log('❌ Fetching error logs...\n');
  const logs = billDeskLogger.getRecentLogs(100);
  
  if (logs.error) {
    console.error('❌ Error:', logs.error);
    process.exit(1);
  }
  
  const errors = logs.filter(log => log.type === 'ERROR' || (log.statusCode && log.statusCode >= 400));
  
  if (errors.length === 0) {
    console.log('✅ No errors found in recent logs!');
  } else {
    console.log(`Found ${errors.length} error entries\n`);
    errors.forEach((log, index) => {
      console.log(formatLog(log));
      if (index < errors.length - 1) {
        console.log('\n' + '═'.repeat(80) + '\n');
      }
    });
  }
  
} else {
  // Get specific transaction by trace ID
  const traceId = args[0];
  console.log(`🔍 Searching for transaction: ${traceId}\n`);
  
  const summary = billDeskLogger.generateSupportTicketSummary(traceId);
  
  if (summary.error) {
    console.error('❌ Error:', summary.error);
    process.exit(1);
  }
  
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║ COMPLETE TRANSACTION SUMMARY FOR BILLDESK SUPPORT');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');
  
  // Display all logs for this transaction
  summary.fullLogs.forEach((log, index) => {
    console.log(formatLog(log));
    if (index < summary.fullLogs.length - 1) {
      console.log('\n' + '─'.repeat(80) + '\n');
    }
  });
  
  // Generate support email
  console.log('\n\n');
  console.log(generateSupportEmail(summary));
  
  // Export to file
  const exportContent = `
BillDesk Support Ticket Information
Generated: ${new Date().toISOString()}
Trace ID: ${traceId}

${'='.repeat(80)}

${summary.fullLogs.map(log => formatLog(log)).join('\n\n' + '═'.repeat(80) + '\n\n')}

${'='.repeat(80)}

${generateSupportEmail(summary)}
  `.trim();
  
  exportToFile(exportContent, traceId);
  
  console.log('\n\n💡 NEXT STEPS:');
  console.log('1. Review the logs above');
  console.log('2. Copy the email template');
  console.log('3. Add your server IP address');
  console.log('4. Send to BillDesk support: support@billdesk.com');
  console.log('5. Attach the exported log file for complete details');
}

console.log('\n' + '='.repeat(80) + '\n');
