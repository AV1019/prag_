/**
 * ResponseFormatter
 * Formats AI-generated content for WhatsApp message constraints
 */

import { VideoResult, FormattedResponse, MediaType } from '../types';

const MAX_MESSAGE_LENGTH = 4096;

export class ResponseFormatter {
  /**
   * Format and split text to fit WhatsApp's 4096 char limit
   */
  formatText(text: string): string[] {
    if (!text || text.trim().length === 0) {
      return ['🤖 Could not generate a response. Please try again!'];
    }

    const cleaned = text.trim();
    if (cleaned.length <= MAX_MESSAGE_LENGTH) {
      return [cleaned];
    }

    return this.splitLongMessage(cleaned);
  }

  /**
   * Format video response with caption
   */
  formatVideoResponse(video: VideoResult): FormattedResponse {
    if (video.success && video.videoUrl) {
      const caption = video.explanation
        ? `🎬 *${video.topic || 'Video'}*\n\n${video.explanation}`
        : `🎬 *${video.topic || 'Video'}* — Here's your video!`;

      return {
        text: caption,
        mediaUrl: video.videoUrl,
        mediaType: MediaType.VIDEO,
        caption,
      };
    }

    return {
      text: `⚠️ Could not generate the video.\n\n${video.errorMessage || 'Unknown error'}\n\nPlease try again!`,
    };
  }

  /**
   * Format error message for user — friendly Hinglish
   */
  formatError(error: Error): string {
    const errorMsg = error.message || 'Unknown error';

    if (errorMsg.includes('timeout') || errorMsg.includes('Timeout')) {
      return '⏱️ The request took too long. Please try again after some time!';
    }

    if (errorMsg.includes('network') || errorMsg.includes('ECONNREFUSED')) {
      return '🌐 Network issue detected. Please check your internet and try again!';
    }

    return `😔 Something went wrong: ${errorMsg}\n\nPlease try again or type *!help*.`;
  }

  /**
   * Add contextual emojis to text based on topic
   */
  addEmojis(text: string, context: string): string {
    const lower = context.toLowerCase();

    if (lower.includes('math') || lower.includes('equation') || lower.includes('ganit')) {
      return `📐 ${text}`;
    }
    if (lower.includes('science') || lower.includes('physics') || lower.includes('vigyan')) {
      return `🔬 ${text}`;
    }
    if (lower.includes('chemistry') || lower.includes('rasayan')) {
      return `⚗️ ${text}`;
    }
    if (lower.includes('biology') || lower.includes('jeevan')) {
      return `🧬 ${text}`;
    }
    if (lower.includes('history') || lower.includes('itihas')) {
      return `📜 ${text}`;
    }
    if (lower.includes('code') || lower.includes('programming')) {
      return `💻 ${text}`;
    }

    return `📚 ${text}`;
  }

  /**
   * Split long messages at sentence boundaries
   */
  splitLongMessage(text: string): string[] {
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= MAX_MESSAGE_LENGTH) {
        chunks.push(remaining);
        break;
      }

      // Find the best split point (sentence boundary near the limit)
      let splitIndex = remaining.lastIndexOf('. ', MAX_MESSAGE_LENGTH);
      if (splitIndex === -1 || splitIndex < MAX_MESSAGE_LENGTH * 0.5) {
        splitIndex = remaining.lastIndexOf('\n', MAX_MESSAGE_LENGTH);
      }
      if (splitIndex === -1 || splitIndex < MAX_MESSAGE_LENGTH * 0.5) {
        splitIndex = remaining.lastIndexOf(' ', MAX_MESSAGE_LENGTH);
      }
      if (splitIndex === -1) {
        splitIndex = MAX_MESSAGE_LENGTH;
      }

      chunks.push(remaining.substring(0, splitIndex + 1).trim());
      remaining = remaining.substring(splitIndex + 1).trim();
    }

    // Add continuation indicators
    if (chunks.length > 1) {
      for (let i = 0; i < chunks.length; i++) {
        chunks[i] = `(${i + 1}/${chunks.length}) ${chunks[i]}`;
      }
    }

    return chunks;
  }
}
