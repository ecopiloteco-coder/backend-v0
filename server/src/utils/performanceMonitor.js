const pool = require('../../config/db');

/**
 * ✅ CRITICAL FIX: Performance monitoring and metrics collection for hierarchy operations
 */
class PerformanceMonitor {
  constructor() {
    this.metrics = new Map();
    this.slowQueries = [];
    this.alerts = [];
    this.isEnabled = process.env.NODE_ENV !== 'test';
  }

  /**
   * Start timing an operation
   */
  startTiming(operation) {
    if (!this.isEnabled) return () => {};
    
    const startTime = process.hrtime.bigint();
    
    return () => {
      const endTime = process.hrtime.bigint();
      const duration = Number(endTime - startTime) / 1_000_000; // Convert to milliseconds
      this.recordMetric(operation, duration);
      return duration;
    };
  }

  /**
   * Record metric for an operation
   */
  recordMetric(operation, duration) {
    if (!this.isEnabled) return;
    
    if (!this.metrics.has(operation)) {
      this.metrics.set(operation, {
        count: 0,
        totalDuration: 0,
        minDuration: Infinity,
        maxDuration: 0,
        durations: [],
        slowCount: 0
      });
    }

    const metric = this.metrics.get(operation);
    metric.count++;
    metric.totalDuration += duration;
    metric.minDuration = Math.min(metric.minDuration, duration);
    metric.maxDuration = Math.max(metric.maxDuration, duration);
    metric.durations.push(duration);

    // Keep only last 100 measurements to prevent memory issues
    if (metric.durations.length > 100) {
      metric.durations.shift();
    }

    // Track slow operations (>1 second)
    if (duration > 1000) {
      metric.slowCount++;
      this.recordSlowQuery(operation, duration);
    }

    // Log warnings for very slow operations
    if (duration > 5000) {
      console.warn(`⏱️ Very slow operation detected: ${operation} took ${duration.toFixed(2)}ms`);
    }
  }

  /**
   * Record slow query for analysis
   */
  recordSlowQuery(operation, duration) {
    const slowQuery = {
      operation,
      duration,
      timestamp: new Date().toISOString(),
      stack: new Error().stack // Capture stack trace for debugging
    };

    this.slowQueries.push(slowQuery);

    // Keep only last 50 slow queries
    if (this.slowQueries.length > 50) {
      this.slowQueries.shift();
    }
  }

  /**
   * Get performance metrics for an operation
   */
  getMetrics(operation) {
    const metric = this.metrics.get(operation);
    if (!metric || metric.count === 0) {
      return null;
    }

    const avgDuration = metric.totalDuration / metric.count;
    const recentAvg = metric.durations.length > 0 
      ? metric.durations.reduce((sum, d) => sum + d, 0) / metric.durations.length 
      : avgDuration;

    return {
      operation,
      count: metric.count,
      avgDuration: Math.round(avgDuration),
      recentAvgDuration: Math.round(recentAvg),
      minDuration: Math.round(metric.minDuration === Infinity ? 0 : metric.minDuration),
      maxDuration: Math.round(metric.maxDuration),
      slowCount: metric.slowCount,
      slowRate: Math.round((metric.slowCount / metric.count) * 100),
      lastMeasurements: metric.durations.slice(-10) // Last 10 measurements
    };
  }

  /**
   * Get all performance metrics
   */
  getAllMetrics() {
    const result = {};
    for (const [operation] of this.metrics) {
      result[operation] = this.getMetrics(operation);
    }
    return result;
  }

  /**
   * Get slow queries report
   */
  getSlowQueriesReport() {
    return this.slowQueries.map(query => ({
      operation: query.operation,
      duration: Math.round(query.duration),
      timestamp: query.timestamp
    }));
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary() {
    const allMetrics = this.getAllMetrics();
    const operations = Object.keys(allMetrics);
    
    if (operations.length === 0) {
      return {
        totalOperations: 0,
        slowOperations: 0,
        averageDuration: 0,
        slowestOperation: null,
        fastestOperation: null
      };
    }

    let totalOperations = 0;
    let totalDuration = 0;
    let slowOperations = 0;
    let slowestOperation = null;
    let fastestOperation = null;

    for (const operation of operations) {
      const metric = allMetrics[operation];
      if (metric) {
        totalOperations += metric.count;
        totalDuration += metric.avgDuration * metric.count;
        slowOperations += metric.slowCount;

        if (!slowestOperation || metric.maxDuration > slowestOperation.duration) {
          slowestOperation = {
            operation,
            duration: metric.maxDuration
          };
        }

        if (!fastestOperation || metric.minDuration < fastestOperation.duration) {
          fastestOperation = {
            operation,
            duration: metric.minDuration
          };
        }
      }
    }

    return {
      totalOperations,
      slowOperations,
      averageDuration: totalOperations > 0 ? Math.round(totalDuration / totalOperations) : 0,
      slowestOperation,
      fastestOperation,
      slowOperationRate: totalOperations > 0 ? Math.round((slowOperations / totalOperations) * 100) : 0
    };
  }

  /**
   * Check for performance issues and generate alerts
   */
  checkPerformanceIssues() {
    const alerts = [];
    const summary = this.getPerformanceSummary();

    // Alert if slow operation rate is high (>10%)
    if (summary.slowOperationRate > 10) {
      alerts.push({
        type: 'HIGH_SLOW_OPERATION_RATE',
        severity: 'WARNING',
        message: `High slow operation rate: ${summary.slowOperationRate}% of operations are slow`,
        details: {
          slowOperations: summary.slowOperations,
          totalOperations: summary.totalOperations
        }
      });
    }

    // Alert if average duration is high (>2 seconds)
    if (summary.averageDuration > 2000) {
      alerts.push({
        type: 'HIGH_AVERAGE_DURATION',
        severity: 'WARNING',
        message: `High average operation duration: ${summary.averageDuration}ms`,
        details: {
          averageDuration: summary.averageDuration
        }
      });
    }

    // Alert for individual very slow operations (>10 seconds)
    for (const query of this.slowQueries) {
      if (query.duration > 10000) {
        alerts.push({
          type: 'VERY_SLOW_OPERATION',
          severity: 'CRITICAL',
          message: `Very slow operation detected: ${query.operation} took ${query.duration}ms`,
          details: query
        });
      }
    }

    this.alerts = alerts;
    return alerts;
  }

  /**
   * Save metrics to database
   */
  async saveMetricsToDatabase() {
    if (!this.isEnabled) return;

    try {
      const metrics = this.getAllMetrics();
      const summary = this.getPerformanceSummary();
      const alerts = this.checkPerformanceIssues();

      await pool.query(
        `INSERT INTO performance_metrics (metrics_data, summary_data, alerts_data, timestamp) 
         VALUES ($1, $2, $3, $4)`,
        [JSON.stringify(metrics), JSON.stringify(summary), JSON.stringify(alerts), new Date()]
      );

      console.log('✅ Performance metrics saved to database');
    } catch (error) {
      console.error('❌ Failed to save performance metrics:', error);
    }
  }

  /**
   * Get performance report
   */
  getPerformanceReport() {
    const summary = this.getPerformanceSummary();
    const allMetrics = this.getAllMetrics();
    const slowQueries = this.getSlowQueriesReport();
    const alerts = this.checkPerformanceIssues();

    return {
      timestamp: new Date().toISOString(),
      summary,
      metrics: allMetrics,
      slowQueries,
      alerts,
      recommendations: this.generateRecommendations(summary, alerts)
    };
  }

  /**
   * Generate performance recommendations
   */
  generateRecommendations(summary, alerts) {
    const recommendations = [];

    if (summary.slowOperationRate > 20) {
      recommendations.push({
        type: 'PERFORMANCE',
        priority: 'HIGH',
        message: 'Consider optimizing slow operations - more than 20% of operations are slow',
        actions: [
          'Review database indexes',
          'Optimize query performance',
          'Consider caching strategies'
        ]
      });
    }

    if (summary.averageDuration > 3000) {
      recommendations.push({
        type: 'PERFORMANCE',
        priority: 'HIGH',
        message: 'Average operation duration is high - consider performance optimization',
        actions: [
          'Analyze slow queries',
          'Review transaction complexity',
          'Consider batch operations'
        ]
      });
    }

    const criticalAlerts = alerts.filter(alert => alert.severity === 'CRITICAL');
    if (criticalAlerts.length > 0) {
      recommendations.push({
        type: 'CRITICAL',
        priority: 'URGENT',
        message: `${criticalAlerts.length} critical performance issues detected`,
        actions: [
          'Investigate critical slow operations immediately',
          'Check database performance',
          'Review system resources'
        ]
      });
    }

    return recommendations;
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics.clear();
    this.slowQueries = [];
    this.alerts = [];
    console.log('✅ Performance metrics reset');
  }

  /**
   * Get performance insights
   */
  getPerformanceInsights() {
    const report = this.getPerformanceReport();
    const insights = [];

    // Analyze trends
    for (const [operation, metric] of Object.entries(report.metrics)) {
      if (metric && metric.recentAvgDuration > metric.avgDuration * 1.5) {
        insights.push({
          type: 'DEGRADATION',
          operation,
          message: `${operation} performance has degraded (recent avg: ${metric.recentAvgDuration}ms vs overall avg: ${metric.avgDuration}ms)`,
          severity: 'WARNING'
        });
      }

      if (metric && metric.slowRate > 30) {
        insights.push({
          type: 'CONSISTENTLY_SLOW',
          operation,
          message: `${operation} is consistently slow (${metric.slowRate}% slow operations)`,
          severity: 'CRITICAL'
        });
      }
    }

    return insights;
  }
}

// Create singleton instance
const performanceMonitor = new PerformanceMonitor();

/**
 * ✅ CRITICAL FIX: Database query performance monitoring
 */
class QueryPerformanceMonitor {
  constructor() {
    this.queryMetrics = new Map();
    this.isEnabled = process.env.NODE_ENV !== 'test';
  }

  /**
   * Monitor database query execution
   */
  async monitorQuery(query, params, operation) {
    if (!this.isEnabled) return query;

    const endTiming = performanceMonitor.startTiming(`db:${operation}`);
    
    try {
      const result = await query;
      const duration = endTiming();
      
      this.recordQueryMetric(operation, query.toString(), duration, params);
      
      return result;
    } catch (error) {
      const duration = endTiming();
      this.recordQueryError(operation, query.toString(), error, duration, params);
      throw error;
    }
  }

  /**
   * Record query metric
   */
  recordQueryMetric(operation, query, duration, params) {
    if (!this.queryMetrics.has(operation)) {
      this.queryMetrics.set(operation, {
        count: 0,
        totalDuration: 0,
        avgDuration: 0,
        queries: []
      });
    }

    const metric = this.queryMetrics.get(operation);
    metric.count++;
    metric.totalDuration += duration;
    metric.avgDuration = metric.totalDuration / metric.count;

    // Store query details (limit to prevent memory issues)
    metric.queries.push({
      query: this.sanitizeQuery(query),
      duration,
      timestamp: new Date().toISOString(),
      paramCount: params ? params.length : 0
    });

    if (metric.queries.length > 20) {
      metric.queries.shift();
    }

    // Log slow queries
    if (duration > 500) { // 500ms threshold
      console.warn(`⏱️ Slow query detected: ${operation} took ${duration.toFixed(2)}ms`);
      console.warn(`Query: ${this.sanitizeQuery(query)}`);
    }
  }

  /**
   * Record query error
   */
  recordQueryError(operation, query, error, duration, params) {
    console.error(`❌ Query error in ${operation} (took ${duration.toFixed(2)}ms):`, error);
    console.error(`Query: ${this.sanitizeQuery(query)}`);
  }

  /**
   * Sanitize query for logging (remove sensitive data)
   */
  sanitizeQuery(query) {
    if (typeof query !== 'string') {
      return query.toString();
    }
    
    // Remove sensitive data patterns
    return query
      .replace(/\$\d+/g, '?') // Replace parameter placeholders
      .replace(/VALUES \([^)]+\)/g, 'VALUES (?)') // Replace VALUES clauses
      .replace(/= '[^']*'/g, "= '?'") // Replace string literals
      .substring(0, 200); // Limit length for logging
  }

  /**
   * Get query performance report
   */
  getQueryPerformanceReport() {
    const report = {};
    
    for (const [operation, metric] of this.queryMetrics.entries()) {
      report[operation] = {
        totalQueries: metric.count,
        avgDuration: Math.round(metric.avgDuration),
        recentQueries: metric.queries.slice(-5) // Last 5 queries
      };
    }
    
    return report;
  }
}

const queryPerformanceMonitor = new QueryPerformanceMonitor();

module.exports = {
  PerformanceMonitor,
  QueryPerformanceMonitor,
  performanceMonitor,
  queryPerformanceMonitor
};