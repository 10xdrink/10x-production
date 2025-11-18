// routes/billDeskLogs.js
/**
 * API endpoints to access BillDesk logs for debugging
 * Protected routes - should only be accessible to admins
 */

const express = require('express');
const router = express.Router();
const billDeskLogger = require('../utils/billDeskLogger');
const logger = require('../utils/logger');

/**
 * Get recent BillDesk logs
 * GET /api/billdesk-logs/recent?count=10
 */
router.get('/recent', async (req, res) => {
  try {
    // TODO: Add authentication middleware here
    // if (!req.user || !req.user.isAdmin) {
    //   return res.status(403).json({ error: 'Unauthorized' });
    // }

    const count = parseInt(req.query.count) || 10;
    const logs = billDeskLogger.getRecentLogs(count);
    
    res.json({
      success: true,
      count: logs.length,
      logs: logs
    });
  } catch (error) {
    logger.error('Error fetching recent BillDesk logs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch logs'
    });
  }
});

/**
 * Get logs by trace ID
 * GET /api/billdesk-logs/trace/:traceId
 */
router.get('/trace/:traceId', async (req, res) => {
  try {
    // TODO: Add authentication middleware here
    // if (!req.user || !req.user.isAdmin) {
    //   return res.status(403).json({ error: 'Unauthorized' });
    // }

    const { traceId } = req.params;
    const logs = billDeskLogger.getLogsByTraceId(traceId);
    
    if (!logs || logs.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No logs found for this trace ID'
      });
    }
    
    res.json({
      success: true,
      traceId: traceId,
      count: logs.length,
      logs: logs
    });
  } catch (error) {
    logger.error('Error fetching logs by trace ID:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch logs'
    });
  }
});

/**
 * Generate support ticket summary
 * GET /api/billdesk-logs/support-ticket/:traceId
 */
router.get('/support-ticket/:traceId', async (req, res) => {
  try {
    // TODO: Add authentication middleware here
    // if (!req.user || !req.user.isAdmin) {
    //   return res.status(403).json({ error: 'Unauthorized' });
    // }

    const { traceId } = req.params;
    const summary = billDeskLogger.generateSupportTicketSummary(traceId);
    
    if (summary.error) {
      return res.status(404).json({
        success: false,
        error: summary.error
      });
    }
    
    res.json({
      success: true,
      summary: summary
    });
  } catch (error) {
    logger.error('Error generating support ticket:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate support ticket'
    });
  }
});

/**
 * Clear old logs (keep last 7 days)
 * POST /api/billdesk-logs/cleanup
 */
router.post('/cleanup', async (req, res) => {
  try {
    // TODO: Add authentication middleware here
    // if (!req.user || !req.user.isAdmin) {
    //   return res.status(403).json({ error: 'Unauthorized' });
    // }

    billDeskLogger.clearOldLogs();
    
    res.json({
      success: true,
      message: 'Old logs cleared successfully'
    });
  } catch (error) {
    logger.error('Error clearing old logs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear old logs'
    });
  }
});

module.exports = router;
