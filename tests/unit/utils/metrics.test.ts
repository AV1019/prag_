/**
 * Unit tests for metrics utility
 */

import { MetricsCollector, measureExecutionTime, trackMessageProcessing } from '../../../src/utils/metrics';

describe('Metrics Utility', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  describe('MetricsCollector', () => {
    it('should record metrics', () => {
      collector.recordMetric('test_metric', 100, { label: 'value' });
      const metrics = collector.getMetrics();
      expect(metrics.length).toBe(1);
      expect(metrics[0].name).toBe('test_metric');
      expect(metrics[0].value).toBe(100);
    });

    it('should increment messages received', () => {
      collector.incrementMessagesReceived({ type: 'text' });
      const summary = collector.getMetricsSummary();
      expect(summary.messagesReceived).toBe(1);
    });

    it('should increment messages processed', () => {
      collector.incrementMessagesProcessed({ status: 'success' });
      const summary = collector.getMetricsSummary();
      expect(summary.messagesProcessed).toBe(1);
    });

    it('should increment messages errored', () => {
      collector.incrementMessagesErrored({ error: 'test' });
      const summary = collector.getMetricsSummary();
      expect(summary.messagesErrored).toBe(1);
    });

    it('should calculate error rate', () => {
      collector.incrementMessagesReceived();
      collector.incrementMessagesReceived();
      collector.incrementMessagesErrored();
      expect(collector.getErrorRate()).toBe(0.5);
    });

    it('should record processing time', () => {
      collector.recordProcessingTime(100);
      collector.recordProcessingTime(200);
      expect(collector.getAverageProcessingTime()).toBe(150);
    });

    it('should calculate percentiles', () => {
      for (let i = 1; i <= 100; i++) {
        collector.recordProcessingTime(i);
      }
      expect(collector.getProcessingTimePercentile(50)).toBeGreaterThanOrEqual(45);
      expect(collector.getProcessingTimePercentile(50)).toBeLessThanOrEqual(55);
      expect(collector.getProcessingTimePercentile(95)).toBeGreaterThanOrEqual(90);
    });

    it('should update queue size', () => {
      collector.updateQueueSize(10);
      const summary = collector.getMetricsSummary();
      expect(summary.currentQueueSize).toBe(10);
    });

    it('should export Prometheus format', () => {
      collector.incrementMessagesReceived();
      const prometheus = collector.exportPrometheusFormat();
      expect(prometheus).toContain('messages_received_total');
      expect(prometheus).toContain('# TYPE');
      expect(prometheus).toContain('# HELP');
    });

    it('should clear metrics', () => {
      collector.recordMetric('test', 1);
      collector.clearMetrics();
      expect(collector.getMetrics().length).toBe(0);
    });

    it('should reset counters', () => {
      collector.incrementMessagesReceived();
      collector.incrementMessagesProcessed();
      collector.resetCounters();
      const summary = collector.getMetricsSummary();
      expect(summary.messagesReceived).toBe(0);
      expect(summary.messagesProcessed).toBe(0);
    });
  });

  describe('measureExecutionTime', () => {
    it('should measure execution time of async function', async () => {
      const testFn = async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'result';
      };

      const result = await measureExecutionTime(testFn, { operation: 'test' });
      expect(result).toBe('result');
    });

    it('should record metrics on error', async () => {
      const testFn = async () => {
        throw new Error('test error');
      };

      await expect(measureExecutionTime(testFn, { operation: 'test' })).rejects.toThrow('test error');
    });
  });

  describe('trackMessageProcessing', () => {
    it('should track successful message processing', async () => {
      const testFn = async () => {
        return 'processed';
      };

      const result = await trackMessageProcessing(testFn, { intent: 'test' });
      expect(result).toBe('processed');
    });

    it('should track failed message processing', async () => {
      const testFn = async () => {
        throw new Error('processing failed');
      };

      await expect(trackMessageProcessing(testFn, { intent: 'test' })).rejects.toThrow('processing failed');
    });
  });
});
