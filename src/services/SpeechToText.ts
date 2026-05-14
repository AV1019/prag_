/**
 * SpeechToText
 * Transcribes WhatsApp voice notes via Deepgram Speech-to-Text so audio
 * messages flow through the same text pipeline as typed messages
 * (greeting / language / video / mindmap / explain intents).
 *
 * Why Deepgram:
 *   - Accepts OGG/opus (WhatsApp's native voice-note format) natively, so
 *     no ffmpeg transcoding is needed — lower latency, one less dependency.
 *   - Uses a raw binary POST (no multipart boundary quirks that plagued
 *     the previous Sarvam + Node fetch combination).
 *   - $200 signup credit covers >700 hours of audio.
 *
 * Language strategy:
 *   - Session language is mapped to Deepgram's supported set (en/hi).
 *     Marathi & Kannada are not supported by Nova — we fall back to Hindi
 *     for Marathi (closest phonetically) and English for Kannada, with
 *     automatic detection as a safety net.
 *
 * Uses Node 18+ built-in fetch — no new dependencies.
 */

import { logger } from '../utils/logger';

/**
 * Deepgram supported language hints for our 4 UI languages. Marathi & Kannada
 * aren't supported by Nova-2 / Nova-3; using detect_language=true gives us
 * the best available transcription (usually Hindi for Marathi input).
 */
const DEEPGRAM_LANG: Record<string, string | null> = {
  english: 'en-IN',
  hinglish: 'en-IN',
  hindi: 'hi',
  marathi: null, // auto-detect (no direct Marathi support)
  kannada: null, // auto-detect (no direct Kannada support)
  tamil: null,
  telugu: null,
};

export class SpeechToText {
  private readonly apiKey: string;
  private readonly endpoint = 'https://api.deepgram.com/v1/listen';
  private readonly model: string;

  constructor() {
    this.apiKey = process.env.DEEPGRAM_API_KEY || '';
    this.model = process.env.DEEPGRAM_STT_MODEL || 'nova-2';
    if (!this.apiKey) {
      logger.warn('DEEPGRAM_API_KEY not set — voice note transcription will be disabled');
    }
  }

  isEnabled(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * Transcribe a WhatsApp audio blob.
   *
   * @param audioBuffer  Decoded audio bytes (base64-decoded from whatsapp-web.js)
   * @param mimeType     e.g. 'audio/ogg; codecs=opus' for voice notes
   * @param preferredLang Optional; maps to a Deepgram language hint for
   *                      better accuracy. When unknown or unsupported,
   *                      Deepgram auto-detects.
   * @returns            Transcribed text. Empty string if Deepgram returns
   *                      no transcript.
   */
  async transcribe(
    audioBuffer: Buffer,
    mimeType: string,
    preferredLang?: string,
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error('DEEPGRAM_API_KEY not set — cannot transcribe audio');
    }

    // Build query string. If the caller's preferred language is supported
    // by Deepgram, hint it explicitly — otherwise enable auto-detection so
    // Marathi/Kannada voice notes still yield a best-effort transcript.
    const params = new URLSearchParams({
      model: this.model,
      smart_format: 'true',
      punctuate: 'true',
    });
    const langHint = DEEPGRAM_LANG[(preferredLang || '').toLowerCase()];
    if (langHint) {
      params.set('language', langHint);
    } else {
      params.set('detect_language', 'true');
    }

    const url = `${this.endpoint}?${params.toString()}`;

    // Deepgram accepts the raw audio bytes as the request body — no
    // multipart form. We pass through WhatsApp's content-type so Deepgram
    // uses the correct decoder (opus, mp3, wav, etc.).
    //
    // Important: we wrap the Buffer in a Blob so Node's fetch (undici) sets
    // a proper `Content-Length` header. Passing a raw Buffer causes undici
    // to use chunked transfer encoding, which Deepgram's edge rejects with
    // HTTP 408 "Request Time-out — Your browser didn't send a complete
    // request in time."
    const contentType = mimeType || 'audio/ogg';
    const bodyBlob = new Blob([audioBuffer], { type: contentType });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.apiKey}`,
        'Content-Type': contentType,
      },
      body: bodyBlob,
      // 30s is generous for typical ~1min voice notes.
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Deepgram STT ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data: any = await res.json();
    const transcript: string =
      data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
    return transcript.trim();
  }
}
