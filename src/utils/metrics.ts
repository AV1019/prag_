/**
 * Metrics collection utility for monitoring and observability
 * 
 * Provides utilities to track:
 * - Messages received and processed
 * - Processing time
 * - Error rates
 * - Queue size
 * 
 * Metrics are compatible with monitoring systems like Prometheus, Grafana, etc.
 */

import { MetricData } from '../types';
import { logger } from './logger';

/**
 * Metric types for categorization
 */
export enum MetricType {
  COUNTER = 'counter',
  GAUGE = 'gauge',
  HISTOGRAM = 'histogram'
}

/**
 * Metrics collector class for tracking application metrics
 */
export class MetricsCollector {
  private metrics: MetricData[] = [];
  private enabled: boolean;
  private maxMetricsStored: number;
  
  // Counters
  private messagesReceived = 0;
  private messagesProcessed = 0;
  private messagesErrored = 0;
  
  // Gauges
  private currentQueueSize = 0;
  
  // Histograms (stored as arrays for percentile calculation)
  private processingTimes: number[] = [];
  private maxProcessingTimeSamples = 1000;

  constructor() {
    this.enabled = process.env.METRICS_ENABLED !== 'false'; // Enabled by default
    this.maxMetricsStored = parseInt(process.env.MAX_METRICS_STORED || '10000', 10);
    
    if (this.enabled) {
      logger.info('Metrics collection enabled', {
        maxMetricsStored: this.maxMetricsStored
      });
    }
  }

  /**
   * Record a generic metric
   * 
   * @param name - Metric name
   * @param value - Metric value
   * @param labels - Additional labels for the metric
   */
  recordMetric(name: string, value: number, labels: Record<string, string> = {}): void {
    if (!this.enabled) return;

    const metric: MetricData = {
      name,
      value,
      labels,
      timestamp: Date.now()
    };

    this.metrics.push(metric);
    
    // Prevent unbounded growth
    if (this.metrics.length > this.maxMetricsStored) {
      this.metrics.shift();
    }
  }

  /**
   * Increment message received counter
   * 
   * @param labels - Additional labels (e.g., message type, source)
   */
  incrementMessagesReceived(labels: Record<string, string> = {}): void {
    this.messagesReceived++;
    this.recordMetric('messages_received_total', this.messagesReceived, labels);
  }

  /**
   * Increment message processed counter
   * 
   * @param labels - Additional labels (e.g., intent, success status)
   */
  incrementMessagesProcessed(labels: Record<string, string> = {}): void {
    this.messagesProcessed++;
    this.recordMetric('messages_processed_total', this.messagesProcessed, labels);
  }

  /**
   * Increment message error counter
   * 
   * @param labels - Additional labels (e.g., error type, error code)
   */
  incrementMessagesErrored(labels: Record<string, string> = {}): void {
    this.messagesErrored++;
    this.recordMetric('messages_errored_total', this.messagesErrored, labels);
  }

  /**
   * Record processing time for a message
   * 
   * @param durationMs - Processing duration in milliseconds
   * @param labels - Additional labels (e.g., intent, handler)
   */
  recordProcessingTime(durationMs: number, labels: Record<string, string> = {}): void {
    this.processingTimes.push(durationMs);
    
    // Keep only recent samples
    if (this.processingTimes.length > this.maxProcessingTimeSamples) {
      this.processingTimes.shift();
    }
    
    this.recordMetric('message_processing_duration_ms', durationMs, labels);
  }

  /**
   * Update current queue size
   * 
   * @param size - Current queue size
   * @param labels - Additional labels (e.g., queue type)
   */
  updateQueueSize(size: number, labels: Record<string, string> = {}): void {
    this.currentQueueSize = size;
    this.recordMetric('queue_size', size, labels);
  }

  /**
   * Get current error rate (errors per total messages)
   * 
   * @returns Error rate between 0 and 1
   */
  getErrorRate(): number {
    const totalMessages = this.messagesReceived;
    if (totalMessages === 0) return 0;
    return this.messagesErrored / totalMessages;
  }

  /**
   * Get average processing time
   * 
   * @returns Average processing time in milliseconds
   */
  getAverageProcessingTime(): number {
    if (this.processingTimes.length === 0) return 0;
    const sum = this.processingTimes.reduce((acc, val) => acc + val, 0);
    return sum / this.processingTimes.length;
  }

  /**
   * Get processing time percentile
   * 
   * @param percentile - Percentile to calculate (0-100)
   * @returns Processing time at the given percentile
   */
  getProcessingTimePercentile(percentile: number): number {
    if (this.processingTimes.length === 0) return 0;
    
    const sorted = [...this.processingTimes].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Get all recorded metrics
   * 
   * @returns Array of all metrics
   */
  getMetrics(): MetricData[] {
    return [...this.metrics];
  }

  /**
   * Get metrics summary for monitoring dashboards
   * 
   * @returns Summary of key metrics
   */
  getMetricsSummary(): {
    messagesReceived: number;
    messagesProcessed: number;
    messagesErrored: number;
    errorRate: number;
    currentQueueSize: number;
    avgProcessingTime: number;
    p50ProcessingTime: number;
    p95ProcessingTime: number;
    p99ProcessingTime: number;
  } {
    return {
      messagesReceived: this.messagesReceived,
      messagesProcessed: this.messagesProcessed,
      messagesErrored: this.messagesErrored,
      errorRate: this.getErrorRate(),
      currentQueueSize: this.currentQueueSize,
      avgProcessingTime: this.getAverageProcessingTime(),
      p50ProcessingTime: this.getProcessingTimePercentile(50),
      p95ProcessingTime: this.getProcessingTimePercentile(95),
      p99ProcessingTime: this.getProcessingTimePercentile(99)
    };
  }

  /**
   * Export metrics in Prometheus format
   * 
   * @returns Metrics in Prometheus text format
   */
  exportPrometheusFormat(): string {
    const lines: string[] = [];
    
    // Messages received
    lines.push('# HELP messages_received_total Total number of messages received');
    lines.push('# TYPE messages_received_total counter');
    lines.push(`messages_received_total ${this.messagesReceived}`);
    
    // Messages processed
    lines.push('# HELP messages_processed_total Total number of messages processed');
    lines.push('# TYPE messages_processed_total counter');
    lines.push(`messages_processed_total ${this.messagesProcessed}`);
    
    // Messages errored
    lines.push('# HELP messages_errored_total Total number of messages that errored');
    lines.push('# TYPE messages_errored_total counter');
    lines.push(`messages_errored_total ${this.messagesErrored}`);
    
    // Error rate
    lines.push('# HELP error_rate Current error rate (errors / total messages)');
    lines.push('# TYPE error_rate gauge');
    lines.push(`error_rate ${this.getErrorRate()}`);
    
    // Queue size
    lines.push('# HELP queue_size Current message queue size');
    lines.push('# TYPE queue_size gauge');
    lines.push(`queue_size ${this.currentQueueSize}`);
    
    // Processing time summary
    lines.push('# HELP message_processing_duration_ms_avg Average message processing time');
    lines.push('# TYPE message_processing_duration_ms_avg gauge');
    lines.push(`message_processing_duration_ms_avg ${this.getAverageProcessingTime()}`);
    
    lines.push('# HELP message_processing_duration_ms_p50 50th percentile processing time');
    lines.push('# TYPE message_processing_duration_ms_p50 gauge');
    lines.push(`message_processing_duration_ms_p50 ${this.getProcessingTimePercentile(50)}`);
    
    lines.push('# HELP message_processing_duration_ms_p95 95th percentile processing time');
    lines.push('# TYPE message_processing_duration_ms_p95 gauge');
    lines.push(`message_processing_duration_ms_p95 ${this.getProcessingTimePercentile(95)}`);
    
    lines.push('# HELP message_processing_duration_ms_p99 99th percentile processing time');
    lines.push('# TYPE message_processing_duration_ms_p99 gauge');
    lines.push(`message_processing_duration_ms_p99 ${this.getProcessingTimePercentile(99)}`);
    
    return lines.join('\n');
  }

  /**
   * Clear all stored metrics
   */
  clearMetrics(): void {
    this.metrics = [];
  }

  /**
   * Reset all counters and gauges
   */
  resetCounters(): void {
    this.messagesReceived = 0;
    this.messagesProcessed = 0;
    this.messagesErrored = 0;
    this.currentQueueSize = 0;
    this.processingTimes = [];
    this.clearMetrics();
    
    logger.info('Metrics counters reset');
  }

  /**
   * Check if metrics collection is enabled
   * 
   * @returns True if metrics are enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

/**
 * Singleton metrics collector instance
 */
export const metricsCollector = new MetricsCollector();

/**
 * Utility function to measure execution time of an async function
 * 
 * @param fn - Async function to measure
 * @param labels - Additional labels
 * @returns Result of the function
 */
export async function measureExecutionTime<T>(
  fn: () => Promise<T>,
  labels: Record<string, string> = {}
): Promise<T> {
  const startTime = Date.now();
  
  try {
    const result = await fn();
    const duration = Date.now() - startTime;
    metricsCollector.recordProcessingTime(duration, { ...labels, status: 'success' });
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    metricsCollector.recordProcessingTime(duration, { ...labels, status: 'error' });
    throw error;
  }
}

/**
 * Utility function to track message processing
 * Automatically increments counters and records timing
 * 
 * @param fn - Message processing function
 * @param labels - Labels for the metrics
 * @returns Result of the processing function
 */
export async function trackMessageProcessing<T>(
  fn: () => Promise<T>,
  labels: Record<string, string> = {}
): Promise<T> {
  metricsCollector.incrementMessagesReceived(labels);
  const startTime = Date.now();
  
  try {
    const result = await fn();
    const duration = Date.now() - startTime;
    
    metricsCollector.incrementMessagesProcessed({ ...labels, status: 'success' });
    metricsCollector.recordProcessingTime(duration, { ...labels, status: 'success' });
    
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    
    metricsCollector.incrementMessagesErrored({ ...labels, status: 'error' });
    metricsCollector.recordProcessingTime(duration, { ...labels, status: 'error' });
    
    throw error;
  }
}
