/**
 * QRAuthenticator
 * Handles QR code generation and authentication flow
 */

import QRCode from 'qrcode';
import { logger } from '../utils/logger';

export class QRAuthenticator {
  private qrDataUrl: string | null = null;

  /**
   * Generate QR code as base64 data URL from raw QR string
   */
  async generateQR(qrData: string): Promise<string> {
    try {
      if (!qrData) {
        throw new Error('QR data is empty or undefined');
      }

      logger.debug('Generating QR code', { dataLength: qrData.length });

      const dataUrl = await QRCode.toDataURL(qrData, {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
      });

      if (!dataUrl) {
        throw new Error('QR code generation returned empty data URL');
      }

      this.qrDataUrl = dataUrl;
      logger.info('QR code generated successfully', { dataUrlLength: dataUrl.length });
      return dataUrl;
    } catch (error) {
      logger.error('Failed to generate QR code', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Save QR code image to file system
   */
  async saveQRImage(qrData: string): Promise<string> {
    const path = './qr-code.png';
    try {
      await QRCode.toFile(path, qrData, {
        width: 300,
        margin: 2,
      });
      logger.info('QR code saved to file', { path });
      return path;
    } catch (error) {
      logger.error('Failed to save QR image', { error });
      throw error;
    }
  }

  /**
   * Log QR code readiness and print to terminal
   */
  notifyQRReady(qrData: string): void {
    logger.info('QR code is ready for scanning');
    // Print QR in terminal for quick scanning
    try {
      const qrTerminal = require('qrcode-terminal');
      qrTerminal.generate(qrData, { small: true });
    } catch {
      logger.info('QR terminal display unavailable, use /qr endpoint');
    }
  }

  /**
   * Handle successful authentication — clear QR data
   */
  handleAuthSuccess(): void {
    logger.info('Authentication successful');
    this.qrDataUrl = null;
  }

  /**
   * Handle authentication failure
   */
  handleAuthFailure(error: Error): void {
    logger.error('Authentication failed', { error: error.message });
    this.qrDataUrl = null;
  }

  /**
   * Get current QR code data URL (for Express endpoint)
   */
  getQRDataUrl(): string | null {
    return this.qrDataUrl;
  }

  /**
   * Check if QR code is available for scanning
   */
  hasQR(): boolean {
    return this.qrDataUrl !== null;
  }
}
