const pool = require('../../config/db');
const BackendErrorHandler = require('../utils/backendErrorHandler');
const { performanceMonitor } = require('../utils/performanceMonitor');

/**
 * ✅ CRITICAL FIX: Enhanced error logging and monitoring API endpoints
 */
class ErrorController {
  /**
   * Log frontend errors
   */
  static async logFrontendError(req, res) {
    const endTiming = performanceMonitor.startTiming('logFrontendError');
    
    try {
      const { message, stack, url, timestamp, userAgent, errorType, projectId } = req.body;
      
      if (!message) {
        return res.status(400).json(BackendErrorHandler.createErrorResponse(
          new Error('Message is required'),
          'logFrontendError'
        ));
      }

      // Log to console for immediate visibility
      console.error(`❌ Frontend Error: ${message}`);
      console.error(`📍 URL: ${url}`);
      console.error(`🕐 Timestamp: ${timestamp}`);
      if (stack) console.error(`📋 Stack: ${stack}`);
      if (projectId) console.error(`🏗️ Project ID: ${projectId}`);

      // Save to database
      await pool.query(
        `INSERT INTO frontend_error_logs 
         (message, stack_trace, url, user_agent, error_type, project_id, timestamp, user_id) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          message,
          stack,
          url,
          userAgent,
          errorType || 'general',
          projectId,
          timestamp || new Date().toISOString(),
          req.user?.id || null
        ]
      );

      endTiming();
      
      res.json(BackendErrorHandler.createSuccessResponse(
        { logged: true },
        'Error logged successfully'
      ));
    } catch (error) {
      endTiming();
      console.error('❌ Failed to log frontend error:', error);
      
      // Don't fail the request if logging fails
      res.json(BackendErrorHandler.createSuccessResponse(
        { logged: false, error: 'Failed to log error' },
        'Error logging failed but request completed'
      ));
    }
  }

  /**
   * Log performance metrics
   */
  static async logPerformanceMetrics(req, res) {
    const endTiming = performanceMonitor.startTiming('logPerformanceMetrics');
    
    try {
      const { metrics, url, timestamp } = req.body;
      
      if (!metrics) {
        return res.status(400).json(BackendErrorHandler.createErrorResponse(
          new Error('Metrics are required'),
          'logPerformanceMetrics'
        ));
      }

      // Log to console for monitoring
      console.log(`📊 Performance Metrics:`, {
        url,
        timestamp,
        operations: Object.keys(metrics).length
      });

      // Save to database
      await pool.query(
        `INSERT INTO performance_metrics 
         (metrics_data, url, timestamp, user_id) 
         VALUES ($1, $2, $3, $4)`,
        [
          JSON.stringify(metrics),
          url,
          timestamp || new Date().toISOString(),
          req.user?.id || null
        ]
      );

      endTiming();
      
      res.json(BackendErrorHandler.createSuccessResponse(
        { logged: true },
        'Performance metrics logged successfully'
      ));
    } catch (error) {
      endTiming();
      console.error('❌ Failed to log performance metrics:', error);
      
      // Don't fail the request if logging fails
      res.json(BackendErrorHandler.createSuccessResponse(
        { logged: false, error: 'Failed to log metrics' },
        'Performance logging failed but request completed'
      ));
    }
  }

  /**
   * Get error statistics
   */
  static async getErrorStatistics(req, res) {
    const endTiming = performanceMonitor.startTiming('getErrorStatistics');
    
    try {
      const { projectId, startDate, endDate, errorType } = req.query;
      
      let query = `
        SELECT 
          DATE_TRUNC('hour', timestamp) as hour,
          error_type,
          COUNT(*) as count
        FROM frontend_error_logs
        WHERE timestamp >= $1 AND timestamp <= $2
      `;
      
      const params = [
        startDate || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        endDate || new Date().toISOString()
      ];
      
      let paramIndex = 3;
      
      if (projectId) {
        query += ` AND project_id = $${paramIndex}`;
        params.push(projectId);
        paramIndex++;
      }
      
      if (errorType) {
        query += ` AND error_type = $${paramIndex}`;
        params.push(errorType);
        paramIndex++;
      }
      
      query += `
        GROUP BY hour, error_type
        ORDER BY hour DESC, count DESC
        LIMIT 1000
      `;

      const result = await pool.query(query, params);
      
      endTiming();
      
      res.json(BackendErrorHandler.createSuccessResponse(
        result.rows,
        'Error statistics retrieved successfully'
      ));
    } catch (error) {
      endTiming();
      console.error('❌ Failed to get error statistics:', error);
      
      res.status(500).json(BackendErrorHandler.createErrorResponse(
        error,
        'getErrorStatistics'
      ));
    }
  }

  /**
   * Get performance statistics
   */
  static async getPerformanceStatistics(req, res) {
    const endTiming = performanceMonitor.startTiming('getPerformanceStatistics');
    
    try {
      const { projectId, startDate, endDate, operation } = req.query;
      
      let query = `
        SELECT 
          DATE_TRUNC('hour', timestamp) as hour,
          metrics_data,
          url,
          timestamp
        FROM performance_metrics
        WHERE timestamp >= $1 AND timestamp <= $2
      `;
      
      const params = [
        startDate || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        endDate || new Date().toISOString()
      ];
      
      let paramIndex = 3;
      
      if (projectId) {
        query += ` AND project_id = $${paramIndex}`;
        params.push(projectId);
        paramIndex++;
      }
      
      if (operation) {
        query += ` AND metrics_data->>'${operation}' IS NOT NULL`;
      }
      
      query += `
        ORDER BY timestamp DESC
        LIMIT 1000
      `;

      const result = await pool.query(query, params);
      
      endTiming();
      
      res.json(BackendErrorHandler.createSuccessResponse(
        result.rows,
        'Performance statistics retrieved successfully'
      ));
    } catch (error) {
      endTiming();
      console.error('❌ Failed to get performance statistics:', error);
      
      res.status(500).json(BackendErrorHandler.createErrorResponse(
        error,
        'getPerformanceStatistics'
      ));
    }
  }

  /**
   * Get system health status
   */
  static async getSystemHealth(req, res) {
    const endTiming = performanceMonitor.startTiming('getSystemHealth');
    
    try {
      // Check database connectivity
      const dbStart = performanceMonitor.startTiming('dbHealthCheck');
      const dbResult = await pool.query('SELECT 1');
      const dbDuration = dbStart();
      
      // Get recent errors count
      const errorsResult = await pool.query(`
        SELECT COUNT(*) as recent_errors
        FROM frontend_error_logs
        WHERE timestamp > NOW() - INTERVAL '1 hour'
      `);
      
      // Get recent performance metrics
      const perfResult = await pool.query(`
        SELECT COUNT(*) as recent_metrics
        FROM performance_metrics
        WHERE timestamp > NOW() - INTERVAL '1 hour'
      `);
      
      endTiming();
      
      const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        components: {
          database: {
            status: dbResult.rows.length > 0 ? 'healthy' : 'unhealthy',
            responseTime: Math.round(dbDuration),
            lastCheck: new Date().toISOString()
          },
          errors: {
            recentCount: parseInt(errorsResult.rows[0].recent_errors),
            status: parseInt(errorsResult.rows[0].recent_errors) < 10 ? 'healthy' : 'warning'
          },
          performance: {
            recentMetrics: parseInt(perfResult.rows[0].recent_metrics),
            status: parseInt(perfResult.rows[0].recent_metrics) > 0 ? 'healthy' : 'warning'
          }
        }
      };
      
      // Determine overall status
      const hasUnhealthy = Object.values(health.components).some(comp => comp.status === 'unhealthy');
      const hasWarning = Object.values(health.components).some(comp => comp.status === 'warning');
      
      if (hasUnhealthy) {
        health.status = 'unhealthy';
      } else if (hasWarning) {
        health.status = 'warning';
      }
      
      res.json(BackendErrorHandler.createSuccessResponse(
        health,
        'System health retrieved successfully'
      ));
    } catch (error) {
      endTiming();
      console.error('❌ Failed to get system health:', error);
      
      res.status(500).json(BackendErrorHandler.createErrorResponse(
        error,
        'getSystemHealth'
      ));
    }
  }

  /**
   * Clear old logs (maintenance endpoint)
   */
  static async clearOldLogs(req, res) {
    const endTiming = performanceMonitor.startTiming('clearOldLogs');
    
    try {
      const { daysToKeep = 30 } = req.body;
      
      if (!req.user?.isAdmin) {
        return res.status(403).json(BackendErrorHandler.createErrorResponse(
          new Error('Admin access required'),
          'clearOldLogs'
        ));
      }
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
      
      // Clear frontend error logs
      const frontendResult = await pool.query(
        'DELETE FROM frontend_error_logs WHERE timestamp < $1',
        [cutoffDate]
      );
      
      // Clear performance metrics
      const perfResult = await pool.query(
        'DELETE FROM performance_metrics WHERE timestamp < $1',
        [cutoffDate]
      );
      
      // Clear backend error logs
      const backendResult = await pool.query(
        'DELETE FROM error_logs WHERE timestamp < $1',
        [cutoffDate]
      );
      
      endTiming();
      
      res.json(BackendErrorHandler.createSuccessResponse(
        {
          frontendErrorsDeleted: frontendResult.rowCount,
          performanceMetricsDeleted: perfResult.rowCount,
          backendErrorsDeleted: backendResult.rowCount,
          cutoffDate: cutoffDate.toISOString()
        },
        'Old logs cleared successfully'
      ));
    } catch (error) {
      endTiming();
      console.error('❌ Failed to clear old logs:', error);
      
      res.status(500).json(BackendErrorHandler.createErrorResponse(
        error,
        'clearOldLogs'
      ));
    }
  }
}

module.exports = ErrorController;