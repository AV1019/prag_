/**
 * ContentGenerator
 * Interfaces with FastAPI backend LangGraph agents and OpenAI to generate educational content
 */

import axios, { AxiosInstance } from 'axios';
import {
  UserSession,
  VideoResult,
  IntentProcessResponse,
  VideoStatusResponse,
  VideoProgressCallback,
} from '../types';
import { logger } from '../utils/logger';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';
const POLL_INTERVAL = 5000; // 5 seconds
// 30 min max wait. Matches the backend's own 30-min Remotion poll window
// (see backend/app/api/v1/endpoints/video.py::_poll_remotion_job) so the bot
// doesn't show a false "timed out" message while the backend + Remotion are
// still happily rendering a long topic (e.g. "detailed timeline of Shivaji
// Maharaj" → 20+ scenes).
const MAX_POLL_ATTEMPTS = 360;

export class ContentGenerator {
  private api: AxiosInstance;

  constructor() {
    this.api = axios.create({
      baseURL: BACKEND_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        ...(INTERNAL_API_KEY ? { 'X-API-Key': INTERNAL_API_KEY } : {}),
      },
    });
  }

  async generateVideo(
    topic: string,
    context: UserSession,
    onProgress?: VideoProgressCallback,
  ): Promise<VideoResult> {
    try {
      logger.info('Requesting video generation', { topic, userId: context.userId });

      const response = await this.api.post('/api/v1/video/generate', {
        concept: topic,
        language: context.language || 'english',
        user_id: context.userId,
      });

      const data = response.data || {};

      // Backend returned a cache hit — already completed, no polling needed.
      if (data.status === 'completed' && data.video_url) {
        logger.info('Video cache hit', { topic, url: data.video_url });
        return {
          success: true,
          videoUrl: data.video_url,
          topic,
        };
      }

      const jobId = data.job_id;
      if (!jobId) {
        return {
          success: false,
          errorMessage: 'No job ID returned from video generation',
        };
      }

      return await this.pollVideoStatus(jobId, onProgress);
    } catch (error: any) {
      logger.error('Video generation failed', { error: error.message, topic });
      return {
        success: false,
        errorMessage: error.message || 'Video generation failed',
      };
    }
  }

  private async pollVideoStatus(
    jobId: string,
    onProgress?: VideoProgressCallback,
  ): Promise<VideoResult> {
    // Nudge cadence.
    // Target render budget is ~3 min for a 1.5-min video. We stay SILENT
    // for the first 3.5 min and only send a "still cooking" nudge after
    // that (and then every 2 min). Successful renders deliver the video
    // with zero noisy progress chatter.
    const QUIET_WINDOW_MS = 3.5 * 60 * 1000;
    const NUDGE_INTERVAL_MS = 2 * 60 * 1000;
    const startedAt = Date.now();
    let lastNudgeAt = 0;

    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));

      try {
        const response = await this.api.get<VideoStatusResponse>(
          `/api/v1/video/status/${jobId}`
        );
        const status = response.data;

        if (status.status === 'completed') {
          return {
            success: true,
            videoUrl: status.video_url,
            topic: jobId,
          };
        }

        if (status.status === 'failed') {
          return {
            success: false,
            errorMessage: status.error_message || status.error || 'Video generation failed',
          };
        }

        // Still processing. Fire a "still cooking" nudge only AFTER the quiet
        // window — short fast-context renders land inside it and stay silent.
        if (onProgress) {
          const elapsedMs = Date.now() - startedAt;
          if (elapsedMs >= QUIET_WINDOW_MS && elapsedMs - lastNudgeAt >= NUDGE_INTERVAL_MS) {
            lastNudgeAt = elapsedMs;
            try {
              await onProgress({
                stage: status.status || 'rendering',
                progress: Math.round(status.progress ?? 0),
                elapsedSeconds: Math.round(elapsedMs / 1000),
              });
            } catch (err) {
              logger.debug('onProgress callback failed', { err });
            }
          }
        }

        logger.debug('Video still processing', { jobId, attempt: i + 1 });
      } catch (error) {
        logger.warn('Error polling video status', { jobId, error });
      }
    }

    return {
      success: false,
      errorMessage: 'Video generation timed out',
    };
  }

  async explainConcept(query: string, context: UserSession): Promise<string> {
    try {
      logger.info('Requesting concept explanation', { query, userId: context.userId });

      const response = await this.api.post<IntentProcessResponse>('/api/v1/intent/analyze', {
        query,
        modality: 'text',
        language: context.language || 'marathi',
        user_id: context.userId,
      });

      return response.data.explanation || 'Concept explanation generate nahi ho paya. Please try again!';
    } catch (error: any) {
      logger.error('Concept explanation failed', { error: error.message, query });
      return this.generateFallbackResponse(query);
    }
  }

  async answerQuestion(question: string, context: UserSession): Promise<string> {
    try {
      logger.info('Answering question', { question, userId: context.userId });

      const response = await this.api.post<IntentProcessResponse>('/api/v1/intent/analyze', {
        query: question,
        modality: 'text',
        language: context.language || 'marathi',
        user_id: context.userId,
      });

      return response.data.explanation || 'Jawab generate nahi ho paya. Please try again!';
    } catch (error: any) {
      logger.error('Question answering failed', { error: error.message, question });
      return this.generateFallbackResponse(question);
    }
  }

  async solveMathProblem(problem: string, context: UserSession): Promise<string> {
    try {
      logger.info('Solving math problem', { problem, userId: context.userId });

      const response = await this.api.post<IntentProcessResponse>('/api/v1/intent/analyze', {
        query: `Solve this math problem step by step: ${problem}`,
        modality: 'text',
        language: context.language || 'marathi',
        user_id: context.userId,
      });

      return response.data.explanation || 'Math problem solve nahi ho paya. Please try again!';
    } catch (error: any) {
      logger.error('Math problem solving failed', { error: error.message, problem });
      return this.generateFallbackResponse(problem);
    }
  }

  /**
   * Extract a concise educational topic phrase (2-5 words) from an image
   * for use as a `concept` in video generation. Used when the user sends
   * a photo whose caption contains a video-trigger word ("video", "banao",
   * "ವೀಡಿಯೊ" etc.) so we can auto-render a personalized explainer on
   * exactly what the image shows.
   */
  async extractTopicFromImage(
    imageBase64: string,
    caption: string,
  ): Promise<string | null> {
    try {
      const ctx = caption ? ` The user said: "${caption}".` : '';
      const query =
        `Identify the main educational topic in this image in ENGLISH. ` +
        `Reply with ONLY 2-5 words naming the topic (e.g. "Pythagoras theorem", ` +
        `"photosynthesis", "binary search", "newton third law"). No explanation, ` +
        `no quotes, no punctuation.${ctx}`;
      const response = await this.api.post<IntentProcessResponse>(
        '/api/v1/intent/analyze',
        {
          query,
          modality: 'visual',
          image: imageBase64,
          language: 'english',
        },
        { timeout: 30000 },
      );
      const raw = (response.data.explanation || '').trim();
      // Take the first non-empty line, strip markdown / punctuation, cap length.
      const topic = raw
        .split('\n')
        .map((s) => s.trim())
        .find((s) => s.length > 0) ?? '';
      const clean = topic
        .replace(/^[\-\*•\d\.\s"`'']+/, '')
        .replace(/[*"`'']/g, '')
        .replace(/\.$/, '')
        .trim()
        .slice(0, 60);
      logger.info('Topic extracted from image', { topic: clean, caption });
      return clean || null;
    } catch (err: any) {
      logger.error('Topic extraction failed', { error: err?.message });
      return null;
    }
  }

  async solveImage(imageBase64: string, caption: string, context: UserSession): Promise<string> {
    try {
      logger.info('Solving image', { userId: context.userId, hasCaption: !!caption, imgLen: imageBase64.length });

      const response = await this.api.post<IntentProcessResponse>('/api/v1/intent/analyze', {
        query: caption || 'Analyze and solve this',
        modality: 'visual',
        image: imageBase64,
        language: context.language || 'english',
        user_id: context.userId,
      }, {
        timeout: 60000,
      });

      return response.data.explanation || 'Image analyze nahi ho paya. Please try again!';
    } catch (error: any) {
      logger.error('Image solving failed', { error: error.message });
      return this.generateFallbackResponse(caption || 'image analysis');
    }
  }

  /**
   * Generate a 4-option MCQ on the given topic by calling the backend.
   * Returns null if the backend call fails so the caller can send a
   * friendly fallback message instead of crashing.
   */
  async generateQuiz(
    topic: string,
    context: UserSession,
    previouslyAsked: string[] = [],
  ): Promise<QuizResult | null> {
    try {
      logger.info('Requesting quiz generation', { topic, userId: context.userId, previouslyAsked: previouslyAsked.length });
      const response = await this.api.post('/api/v1/quiz/generate', {
        topic,
        language: context.language || 'english',
        difficulty: 'medium',
        previously_asked: previouslyAsked,
      }, {
        timeout: 30000,
      });
      const d = response.data || {};
      if (!d.question || !Array.isArray(d.options) || d.options.length !== 4) {
        logger.warn('Quiz payload malformed', { data: d });
        return null;
      }
      return {
        question: String(d.question),
        options: d.options.map((o: unknown) => String(o)),
        correctIndex: Number(d.correct_index ?? 0),
        correctLetter: String(d.correct_letter || 'ABCD'[Number(d.correct_index ?? 0)]),
        explanation: String(d.explanation || ''),
        topic: String(d.topic || topic),
        language: String(d.language || context.language || 'english'),
      };
    } catch (error: any) {
      logger.error('Quiz generation failed', { error: error.message, topic });
      return null;
    }
  }

  private generateFallbackResponse(query: string): string {
    return `📝 Aapne pucha: "${query}"\n\nAbhi backend se connect nahi ho pa raha. Please thodi der baad try karo.\n\n🎬 Video chahiye? "video ${query}" likh ke bhejo!`;
  }
}

export interface QuizResult {
  question: string;
  options: string[];     // exactly 4
  correctIndex: number;  // 0..3
  correctLetter: string; // 'A' | 'B' | 'C' | 'D'
  explanation: string;
  topic: string;
  language: string;
}
