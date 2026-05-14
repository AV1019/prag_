/**
 * MediaHandler
 * Processes and sends media files through WhatsApp using whatsapp-web.js
 */

import { Client, MessageMedia } from 'whatsapp-web.js';
import axios from 'axios';
import fs from 'fs';
import { logger } from '../utils/logger';

const WHATSAPP_MAX_FILE_SIZE = 64 * 1024 * 1024; // 64MB

export class MediaHandler {
  private client: Client | null = null;

  setClient(client: Client): void {
    this.client = client;
  }

  async sendVideo(to: string, videoUrl: string, caption: string): Promise<void> {
    if (!this.client) throw new Error('WhatsApp client not set');

    try {
      logger.info('Sending video', { to, videoUrl });

      // Validate file size
      const validSize = await this.validateFileSize(videoUrl);
      if (!validSize) {
        await this.client.sendMessage(
          to,
          `⚠️ Video file bahut bada hai (64MB se zyada). Link se dekh lo:\n${videoUrl}`
        );
        return;
      }

      const media = await MessageMedia.fromUrl(videoUrl, {
        unsafeMime: true,
      });

      await this.client.sendMessage(to, media, { caption });
      logger.info('Video sent successfully', { to });
    } catch (error) {
      logger.error('Failed to send video', { error, to, videoUrl });
      // Fallback: send the URL as text
      await this.client.sendMessage(
        to,
        `🎬 Video ready hai! Yahan se dekho:\n${videoUrl}\n\n${caption}`
      );
    }
  }

  async sendText(to: string, text: string): Promise<void> {
    if (!this.client) throw new Error('WhatsApp client not set');
    await this.client.sendMessage(to, text);
  }

  async sendLocalVideo(to: string, filePath: string, caption: string): Promise<void> {
    if (!this.client) throw new Error('WhatsApp client not set');

    try {
      logger.info('Sending local video', { to, filePath });

      if (!fs.existsSync(filePath)) {
        throw new Error(`Video file not found: ${filePath}`);
      }

      const media = MessageMedia.fromFilePath(filePath);
      await this.client.sendMessage(to, media, { caption });
      logger.info('Local video sent successfully', { to, filePath });
    } catch (error) {
      logger.error('Failed to send local video', { error, to, filePath });
      // Fallback: send as URL through frontend
      const filename = filePath.split('/').pop();
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      await this.client.sendMessage(
        to,
        `🎬 Video ready! Watch here:\n${frontendUrl}/videos/${filename}\n\n${caption}`
      );
    }
  }

  async sendImage(to: string, imageUrl: string, caption: string): Promise<void> {
    if (!this.client) throw new Error('WhatsApp client not set');

    try {
      logger.info('Sending image', { to, imageUrl });

      // whatsapp-web.js' `MessageMedia.fromUrl` routes the download through
      // its internal puppeteer context, which cannot always reach `localhost`
      // URLs from the host machine (the page runs in a sandboxed browser).
      // To keep localhost dev reliable AND remote URLs working, we fetch the
      // bytes ourselves with axios and attach them as base64.
      const resp = await axios.get<ArrayBuffer>(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 30_000,
      });
      const buf = Buffer.from(resp.data);
      const mime =
        (resp.headers['content-type'] as string | undefined) || 'image/png';
      const filename = (imageUrl.split('/').pop() || 'image.png').split('?')[0];
      const media = new MessageMedia(mime, buf.toString('base64'), filename);

      await this.client.sendMessage(to, media, { caption });
      logger.info('Image sent successfully', { to, bytes: buf.length });
    } catch (error: any) {
      logger.error('Failed to send image', {
        error: error?.message || String(error),
        to,
        imageUrl,
      });
      // Last-resort fallback: send a short note WITHOUT leaking the localhost URL
      await this.client.sendMessage(
        to,
        `📸 ${caption}\n\n(Image could not be attached — please try again in a moment.)`
      );
    }
  }

  /**
   * Send an image straight from in-memory PNG/JPEG bytes. Preferred over
   * `sendImage(url)` when the caller already has the bytes and the source
   * URL is localhost (which WhatsApp's internal fetcher can't always reach).
   */
  async sendImageFromBuffer(
    to: string,
    buf: Buffer,
    caption: string,
    mime: string = 'image/png',
    filename: string = 'image.png'
  ): Promise<void> {
    if (!this.client) throw new Error('WhatsApp client not set');
    const media = new MessageMedia(mime, buf.toString('base64'), filename);
    await this.client.sendMessage(to, media, { caption });
    logger.info('Image sent from buffer', { to, bytes: buf.length });
  }

  async sendDocument(to: string, docUrl: string, filename: string): Promise<void> {
    if (!this.client) throw new Error('WhatsApp client not set');

    try {
      logger.info('Sending document', { to, docUrl, filename });
      const media = await MessageMedia.fromUrl(docUrl, {
        unsafeMime: true,
        filename,
      });
      await this.client.sendMessage(to, media);
      logger.info('Document sent successfully', { to, filename });
    } catch (error) {
      logger.error('Failed to send document', { error, to, docUrl });
      await this.client.sendMessage(to, `📄 Document: ${docUrl}`);
    }
  }

  async validateFileSize(url: string): Promise<boolean> {
    try {
      const response = await axios.head(url, { timeout: 5000 });
      const contentLength = parseInt(response.headers['content-length'] || '0', 10);
      if (contentLength > 0 && contentLength > WHATSAPP_MAX_FILE_SIZE) {
        logger.warn('File too large for WhatsApp', { url, size: contentLength });
        return false;
      }
      return true;
    } catch (error) {
      // If HEAD fails, allow the attempt — wwebjs will handle errors
      logger.debug('Could not check file size via HEAD', { url });
      return true;
    }
  }

  async compressVideo(videoPath: string): Promise<string> {
    // Compression would require ffmpeg — just log and return original for now
    logger.warn('Video compression not implemented, returning original', { videoPath });
    return videoPath;
  }
}
