/**
 * MessageRouter
 * Routes messages to appropriate handlers based on content.
 *
 * Language detection and primary intent classification are performed by
 * SarvamIntentAgent (Sarvam-2B / Saaras API, 22 Indic languages).
 * Keyword-based heuristics serve as a fast pre-filter and as an offline
 * fallback when the Sarvam API is unavailable.
 */

import { MessageData, RouteDecision, Intent, HandlerType } from '../types';
import { logger } from '../utils/logger';
import { SarvamIntentAgent } from '../services/SarvamIntentAgent';

// Keyword patterns for intent detection
const VIDEO_KEYWORDS = [
  'video', 'generate', 'banao', 'bana do', 'video banao', 'animation',
  // Hindi
  'वीडियो', 'विडियो', 'वीडियो बनाओ', 'वीडियो दिखाओ',
  // Kannada
  'ವೀಡಿಯೊ', 'ವಿಡಿಯೋ', 'ವೀಡಿಯೊ ಮಾಡಿ', 'ವೀಡಿಯೊ ತೋರಿಸಿ',
];
// Mind-map keywords must be checked BEFORE the generic video keywords —
// "mindmap generate" should not be mis-routed to video. Multi-word phrases
// come first so "mind map" is matched before "map".
const MINDMAP_KEYWORDS = [
  'mindmap', 'mind map', 'mind-map', 'concept map', 'concept-map',
  'flowchart', 'flow chart', 'diagram of',
  // Hinglish
  'mind map banao', 'mindmap banao', 'diagram banao', 'mind map bana do',
  // Hindi
  'मन-मानचित्र', 'मन मानचित्र', 'माइंड मैप', 'संकल्पना मानचित्र',
  // Kannada
  'ಮನಸ್ಸಿನ ನಕ್ಷೆ', 'ಪರಿಕಲ್ಪನೆ ನಕ್ಷೆ', 'ಮೈಂಡ್ ಮ್ಯಾಪ್',
];
// Quiz / MCQ / poll triggers. Multi-word phrases first so "quiz me" wins
// over "me". Checked BEFORE math/explain so "quiz integration" doesn't
// get mis-routed to math_problem on the word "integration".
const QUIZ_KEYWORDS = [
  'quiz me', 'take quiz', 'start quiz', 'quiz on', 'poll on', 'mcq on',
  'test me', 'quiz', 'mcq', 'poll',
  // Hinglish
  'quiz do', 'quiz banao', 'quiz lo', 'test lo', 'poll banao', 'mcq do',
  // Hindi
  'प्रश्नोत्तरी', 'प्रश्न पूछो', 'सवाल पूछो', 'मुझे टेस्ट',
  // Marathi
  'प्रश्न विचार', 'क्विझ',
  // Kannada
  'ಪ್ರಶ್ನೆ ಕೇಳಿ', 'ಕ್ವಿಜ್', 'ಪರೀಕ್ಷೆ',
];
const EXPLAIN_KEYWORDS = ['explain', 'samjhao', 'kya hai', 'what is', 'how does', 'kaise', 'meaning'];
const MATH_KEYWORDS = ['solve', 'calculate', 'equation', 'integral', 'derivative', 'x=', 'x +', '=0', 'math', 'ganit'];
const QUESTION_KEYWORDS = ['?', 'why', 'when', 'where', 'which', 'kyu', 'kab', 'kahan', 'kaun', 'konsa'];


export class MessageRouter {
  private sarvam = new SarvamIntentAgent();

  async route(messageData: MessageData): Promise<RouteDecision> {
    const text = messageData.body.toLowerCase().trim();
    const rawText = messageData.body.trim();

    // Commands bypass Sarvam entirely
    if (this.isCommand(text)) {
      return {
        handler: HandlerType.COMMAND,
        intent: Intent.COMMAND,
        confidence: 1.0,
        parameters: { command: text.replace('!', '').trim() },
      };
    }

    // ── Sarvam language + intent detection ──────────────────────────────────
    const sarvamResult = await this.sarvam.detect(rawText);

    // Attach detected language to messageData so downstream handlers can use it
    (messageData as any).detectedLanguage = sarvamResult.language;
    (messageData as any).detectedLanguageCode = sarvamResult.languageCode;
    if (sarvamResult.transliteratedText) {
      (messageData as any).transliteratedText = sarvamResult.transliteratedText;
    }
    // The output language the user explicitly asked for (separate from the
    // language they typed in). Example: typing "give me this video in kannada"
    // in English → requestedOutputLanguage = KANNADA. Handlers use this to
    // override the session language for THIS request only.
    if (sarvamResult.requestedOutputLanguage) {
      (messageData as any).requestedOutputLanguage =
        sarvamResult.requestedOutputLanguage;
    }

    // When Sarvam returned a high-confidence intent, trust it.
    // For low-confidence results (< 0.65) fall back to keyword heuristics.
    let intent: Intent;
    let confidence: number;
    if (sarvamResult.fromSarvam && sarvamResult.confidence >= 0.65) {
      intent = sarvamResult.intent;
      confidence = sarvamResult.confidence;
    } else {
      intent = this.detectIntent(text);
      confidence = 0.7;
    }

    const parameters: Record<string, any> = {};

    // Topic extraction strategy:
    //   1. Prefer the LLM-extracted topic from Sarvam→Haiku/GPT (it
    //      understands sentences like "Generate me a quiz on dfs" → "dfs").
    //   2. Fall back to the keyword-around extractor for resilience when
    //      the LLM is unreachable.
    const llmTopic = sarvamResult.topic;

    if (intent === Intent.VIDEO_GENERATION) {
      confidence = 0.9;
      parameters.topic = llmTopic || this.extractTopicAroundKeyword(text, VIDEO_KEYWORDS);
    }

    if (intent === Intent.MINDMAP_REQUEST) {
      confidence = 0.9;
      parameters.topic = llmTopic || this.extractTopicAroundKeyword(text, MINDMAP_KEYWORDS);
    }

    if (intent === Intent.QUIZ_REQUEST) {
      confidence = 0.9;
      parameters.topic = llmTopic || this.extractTopicAroundKeyword(text, QUIZ_KEYWORDS);
    }

    if (intent === Intent.MATH_PROBLEM) confidence = 0.85;
    if (intent === Intent.CONCEPT_EXPLANATION) confidence = 0.8;

    const handler = intent === Intent.COMMAND
      ? HandlerType.COMMAND
      : HandlerType.CONTENT_GENERATOR;

    const decision: RouteDecision = { handler, intent, confidence, parameters };

    logger.debug('Route decision', { decision, originalText: text });
    return decision;
  }

  detectIntent(text: string): Intent {
    const lower = text.toLowerCase();

    // Priority order: command > quiz > mindmap > video > math > explain > question
    // Quiz/mindmap are checked BEFORE video because "quiz me" would otherwise
    // never be reached if video appeared first.
    if (this.isCommand(lower)) return Intent.COMMAND;
    if (this.shouldStartQuiz(lower)) return Intent.QUIZ_REQUEST;
    if (this.shouldGenerateMindmap(lower)) return Intent.MINDMAP_REQUEST;
    if (this.shouldGenerateVideo(lower)) return Intent.VIDEO_GENERATION;
    if (this.isMathProblem(lower)) return Intent.MATH_PROBLEM;
    if (this.shouldExplainConcept(lower)) return Intent.CONCEPT_EXPLANATION;
    if (this.shouldAnswerQuestion(lower)) return Intent.QUESTION_ANSWER;

    return Intent.GENERAL_QUERY;
  }

  shouldGenerateVideo(text: string): boolean {
    return VIDEO_KEYWORDS.some((kw) => text.includes(kw));
  }

  shouldGenerateMindmap(text: string): boolean {
    return MINDMAP_KEYWORDS.some((kw) => text.includes(kw));
  }

  shouldStartQuiz(text: string): boolean {
    return QUIZ_KEYWORDS.some((kw) => text.includes(kw));
  }

  shouldAnswerQuestion(text: string): boolean {
    return QUESTION_KEYWORDS.some((kw) => text.includes(kw));
  }

  isCommand(text: string): boolean {
    return text.startsWith('!');
  }

  private isMathProblem(text: string): boolean {
    // Check keywords
    if (MATH_KEYWORDS.some((kw) => text.includes(kw))) return true;
    // Check for mathematical expressions (numbers + operators)
    if (/\d+\s*[+\-*/^=]\s*\d+/.test(text)) return true;
    return false;
  }

  private shouldExplainConcept(text: string): boolean {
    return EXPLAIN_KEYWORDS.some((kw) => text.includes(kw));
  }

  /**
   * Extract the topic around the first matching trigger keyword.
   *
   * Checks BOTH the text before AND after the keyword and returns whichever
   * side has more meaningful content. This matters because users write the
   * trigger in any position:
   *   - "video fourier transform"      → after  = "fourier transform" ✅
   *   - "fourier transform video"      → before = "fourier transform" ✅
   *   - "make a video of fourier"      → after  = "fourier" ✅
   *   - "fourier transform ka video"   → before = "fourier transform" ✅
   *
   * Previously only the "after" side was considered, so trailing-trigger
   * sentences collapsed to an empty topic and the caller's fallback kicked
   * in — often pulling an unrelated topic from recent context.
   *
   * Multi-word keywords are sorted longest-first so "mind map" wins over
   * "map" when both are present.
   */
  private extractTopicAroundKeyword(text: string, keywords: string[]): string {
    const sorted = [...keywords].sort((a, b) => b.length - a.length);
    for (const kw of sorted) {
      const idx = text.indexOf(kw);
      if (idx < 0) continue;
      const before = this.cleanTopicFragment(text.substring(0, idx));
      const after = this.cleanTopicFragment(text.substring(idx + kw.length));
      // Prefer the side with more meaningful content. A very short "before"
      // like "a" / "the" / "make" should not outrank a real "after" topic.
      const beforeScore = before.length >= 3 ? before.length : 0;
      const afterScore = after.length >= 3 ? after.length : 0;
      if (beforeScore === 0 && afterScore === 0) return '';
      return afterScore >= beforeScore ? after : before;
    }
    return '';
  }

  /**
   * Strip connector words and filler so "make a video of fourier transform"
   * → "fourier transform" and "fourier transform ka" → "fourier transform".
   */
  private cleanTopicFragment(raw: string): string {
    return raw
      .trim()
      // Leading filler / articles / verbs
      .replace(/^(please|plz|pls|kindly|and|also|now|abhi|ab)\s+/i, '')
      .replace(/^(make|give|show|send|create|generate|banao|bana\s*do|dikhao|do)\s+/i, '')
      .replace(/^(a|an|the|one|ek|एक)\s+/i, '')
      // Leading connectors
      .replace(/^(of|on|about|for|regarding|ke\s+baare\s+mein|pe|par|ka|ki|ke|को|के|पर|की|ಬಗ್ಗೆ|ಕುರಿತು)\s+/i, '')
      // Trailing connectors (when trigger is at end, "fourier ka video" →
      // before="fourier ka" → strip "ka")
      .replace(/\s+(ka|ki|ke|par|pe|on|of|about|for|ke\s+baare\s+mein|को|के|की|पर|ಬಗ್ಗೆ|ಕುರಿತು)$/i, '')
      .replace(/[?!.।]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
