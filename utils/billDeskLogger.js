// utils/billDeskLogger.js
/**
 * Specialized logger for BillDesk API debugging
 * Captures all details needed for BillDesk support tickets
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class BillDeskLogger {
  constructor() {
    this.logDir = path.join(__dirname, '../logs');
    this.debugLogFile = path.join(this.logDir, 'billdesk-debug.log');
    
    // Ensure logs directory exists
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Log complete request/response cycle for BillDesk support
   */
  logTransaction(data) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      timestampIST: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      ...data
    };

    // Write to dedicated debug file
    const logLine = JSON.stringify(logEntry, null, 2) + '\n' + '='.repeat(80) + '\n';
    fs.appendFileSync(this.debugLogFile, logLine);

    // Also log to console in development
    if (process.env.NODE_ENV !== 'production') {
      console.log('\n' + '='.repeat(80));
      console.log('🔍 BILLDESK DEBUG LOG');
      console.log('='.repeat(80));
      console.log(JSON.stringify(logEntry, null, 2));
      console.log('='.repeat(80) + '\n');
    }

    return logEntry;
  }

  /**
   * Log complete API request details
   */
  logRequest(details) {
    const requestLog = {
      type: 'REQUEST',
      traceId: details.traceId,
      timestamp: details.timestamp,
      url: details.url,
      method: details.method,
      headers: {
        'Content-Type': details.headers['Content-Type'],
        'Accept': details.headers['Accept'],
        'BD-Traceid': details.headers['BD-Traceid'],
        'BD-Timestamp': details.headers['BD-Timestamp'],
        'Authorization': details.headers['Authorization'] ? '[PRESENT]' : '[MISSING]'
      },
      payload: {
        type: details.payloadType,
        length: details.payloadLength,
        preview: details.payloadPreview,
        fullJwsToken: details.payloadFull // COMPLETE JWS TOKEN
      },
      jsonRequest: details.jsonRequest, // ORIGINAL JSON REQUEST
      credentials: {
        merchantId: details.merchantId,
        clientId: details.clientId,
        keyId: details.keyId
      }
    };

    this.logTransaction(requestLog);
    logger.info('BillDesk request logged', { traceId: details.traceId });
    
    return requestLog;
  }

  /**
   * Log complete API response details
   */
  logResponse(details) {
    const responseLog = {
      type: 'RESPONSE',
      traceId: details.traceId,
      timestamp: details.timestamp,
      statusCode: details.statusCode,
      statusText: details.statusText,
      headers: details.headers,
      body: {
        length: details.bodyLength,
        type: details.bodyType,
        preview: details.bodyPreview,
        fullBody: details.fullBody ? details.fullBody.substring(0, 5000) : null
      },
      processingTime: details.processingTime
    };

    this.logTransaction(responseLog);
    logger.info('BillDesk response logged', { 
      traceId: details.traceId, 
      status: details.statusCode 
    });
    
    return responseLog;
  }

  /**
   * Log error with full context
   */
  logError(details) {
    const errorLog = {
      type: 'ERROR',
      traceId: details.traceId,
      timestamp: details.timestamp,
      errorMessage: details.errorMessage,
      errorStack: details.errorStack,
      request: details.request,
      response: details.response
    };

    this.logTransaction(errorLog);
    logger.error('BillDesk error logged', { 
      traceId: details.traceId, 
      error: details.errorMessage 
    });
    
    return errorLog;
  }

  /**
   * Get last N log entries for support ticket
   */
  getRecentLogs(count = 10) {
    try {
      if (!fs.existsSync(this.debugLogFile)) {
        return { error: 'No logs found' };
      }

      const content = fs.readFileSync(this.debugLogFile, 'utf8');
      const entries = content.split('='.repeat(80)).filter(e => e.trim());
      
      const recent = entries.slice(-count).map(entry => {
        try {
          return JSON.parse(entry.trim());
        } catch (e) {
          return { raw: entry };
        }
      });

      return recent;
    } catch (error) {
      logger.error('Error reading BillDesk logs:', error);
      return { error: error.message };
    }
  }

  /**
   * Get logs by trace ID
   */
  getLogsByTraceId(traceId) {
    try {
      if (!fs.existsSync(this.debugLogFile)) {
        return { error: 'No logs found' };
      }

      const content = fs.readFileSync(this.debugLogFile, 'utf8');
      const entries = content.split('='.repeat(80)).filter(e => e.trim());
      
      const matching = entries
        .map(entry => {
          try {
            return JSON.parse(entry.trim());
          } catch (e) {
            return null;
          }
        })
        .filter(entry => entry && entry.traceId === traceId);

      return matching;
    } catch (error) {
      logger.error('Error searching BillDesk logs:', error);
      return { error: error.message };
    }
  }

  /**
   * Generate support ticket summary
   */
  generateSupportTicketSummary(traceId) {
    const logs = this.getLogsByTraceId(traceId);
    
    if (!logs || logs.length === 0) {
      return { error: 'No logs found for trace ID: ' + traceId };
    }

    const request = logs.find(l => l.type === 'REQUEST');
    const response = logs.find(l => l.type === 'RESPONSE');
    const error = logs.find(l => l.type === 'ERROR');

    const summary = {
      traceId: traceId,
      timestamp: request?.timestamp || 'N/A',
      timestampIST: request?.timestampIST || 'N/A',
      
      request: {
        bdTraceid: request?.headers?.['BD-Traceid'],
        bdTimestamp: request?.headers?.['BD-Timestamp'],
        url: request?.url,
        merchantId: request?.credentials?.merchantId,
        clientId: request?.credentials?.clientId,
        keyId: request?.credentials?.keyId,
        hasAuthorization: request?.headers?.Authorization === '[PRESENT]'
      },
      
      response: {
        statusCode: response?.statusCode,
        statusText: response?.statusText,
        headers: response?.headers,
        bodyPreview: response?.body?.preview
      },
      
      error: error ? {
        message: error.errorMessage,
        stack: error.errorStack
      } : null,

      fullLogs: logs
    };

    return summary;
  }

  /**
   * Clear old logs (keep last 7 days)
   */
  clearOldLogs() {
    try {
      if (!fs.existsSync(this.debugLogFile)) {
        return;
      }

      const content = fs.readFileSync(this.debugLogFile, 'utf8');
      const entries = content.split('='.repeat(80)).filter(e => e.trim());
      
      const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
      
      const recentEntries = entries.filter(entry => {
        try {
          const log = JSON.parse(entry.trim());
          const logTime = new Date(log.timestamp).getTime();
          return logTime > sevenDaysAgo;
        } catch (e) {
          return false;
        }
      });

      const newContent = recentEntries.join('\n' + '='.repeat(80) + '\n');
      fs.writeFileSync(this.debugLogFile, newContent);
      
      logger.info('BillDesk logs cleaned', { 
        kept: recentEntries.length, 
        removed: entries.length - recentEntries.length 
      });
    } catch (error) {
      logger.error('Error clearing old BillDesk logs:', error);
    }
  }
}

module.exports = new BillDeskLogger();
