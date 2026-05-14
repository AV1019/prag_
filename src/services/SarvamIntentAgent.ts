/**
 * SarvamIntentAgent
 *
 * Wraps the Sarvam AI Saaras API to perform two tasks in a single call:
 *   1. Language identification  — 22 Indic languages + English
 *   2. Intent classification    — maps the user's message to one of the
 *                                  Intent enum values understood by the rest
 *                                  of the pipeline.
 *
 * Fallback: if the Sarvam call fails or returns low confidence the agent
 * falls back to the existing keyword-based router so the bot keeps working
 * even without API access.
 */

import axios, { AxiosInstance } from 'axios';
import { Intent, Language } from '../types';
import { logger } from '../utils/logger';

// ─── Sarvam language code → Language enum mapping ────────────────────────────
const SARVAM_LANG_MAP: Record<string, Language> = {
  kn: Language.KANNADA,
  hi: Language.HINDI,
  mr: Language.MARATHI,
  en: Language.ENGLISH,
  ta: Language.TAMIL,
  te: Language.TELUGU,
  ml: Language.MALAYALAM,
  bn: Language.BENGALI,
  gu: Language.GUJARATI,
  pa: Language.PUNJABI,
  // Map remaining Indic languages to HINDI as closest fallback
  or: Language.HINDI,
  as: Language.HINDI,
  ur: Language.HINDI,
  sa: Language.HINDI,
};

// ─── Intent label → Intent enum ───────────────────────────────────────────────
const INTENT_LABEL_MAP: Record<string, Intent> = {
  video_generation: Intent.VIDEO_GENERATION,
  mindmap_request: Intent.MINDMAP_REQUEST,
  quiz_request: Intent.QUIZ_REQUEST,
  concept_explanation: Intent.CONCEPT_EXPLANATION,
  question_answer: Intent.QUESTION_ANSWER,
  math_problem: Intent.MATH_PROBLEM,
  code_help: Intent.CODE_HELP,
  general_query: Intent.GENERAL_QUERY,
};

export interface SarvamIntentResult {
  language: Language;
  /** BCP-47 code returned by Sarvam, e.g. "kn", "hi", "en" */
  languageCode: string;
  intent: Intent;
  /** Transliterated text in Latin script (useful for downstream LLMs) */
  transliteratedText?: string;
  confidence: number;
  /** true → answered by Sarvam API; false → keyword fallback was used */
  fromSarvam: boolean;
  /**
   * Language the user EXPLICITLY asked the response/output to be in.
   * Different from `language` (the language the user typed in).
   * Example: user types "give me this video in kannada" in English →
   *   language = ENGLISH, requestedOutputLanguage = KANNADA.
   * Undefined if the user didn't request a specific output language.
   */
  requestedOutputLanguage?: Language;
  /**
   * The actual topic / subject the user is asking about, extracted by the
   * LLM. Example: "Generate me a quiz on dfs" → topic = "dfs".
   * Lets us avoid brittle keyword extraction. Undefined for chatter /
   * greetings where no topic is meaningful.
   */
  topic?: string;
}

const SARVAM_BASE_URL = 'https://api.sarvam.ai';

// ─── Output-language phrase → Language enum mapping ──────────────────────────
// Used by the pure rule-based output-language extractor. No LLM involved.
// Each entry lists the trigger words/native-script labels for that language.
// The user said: "for any lang or audio use Deepgram + Sarvam, no AI model" —
// so we keep language detection rule-based and reserve LLMs strictly for
// intent classification.
const OUTPUT_LANGUAGE_PATTERNS: Array<{ lang: Language; labels: string[] }> = [
  { lang: Language.ENGLISH,   labels: ['english', 'angrezi', 'ಇಂಗ್ಲಿಷ್', 'अंग्रेजी', 'इंग्रजी', 'ஆங்கிலம்', 'ఇంగ్లీష్', 'ഇംഗ്ലീഷ്', 'ইংরেজি', 'અંગ્રેજી', 'ਅੰਗਰੇਜ਼ੀ'] },
  { lang: Language.HINDI,     labels: ['hindi', 'हिंदी', 'हिन्दी', 'ಹಿಂದಿ', 'இந்தி', 'హిందీ', 'ഹിന്ദി', 'হিন্দি', 'હિન્દી', 'ਹਿੰਦੀ'] },
  { lang: Language.MARATHI,   labels: ['marathi', 'मराठी', 'ಮರಾಠಿ', 'மராத்தி', 'మరాఠీ', 'മറാത്തി', 'মারাঠি', 'મરાઠી', 'ਮਰਾਠੀ'] },
  { lang: Language.KANNADA,   labels: ['kannada', 'ಕನ್ನಡ', 'कन्नड़', 'कन्नड', 'கன்னடம்', 'కన్నడ', 'കന്നഡ', 'কন্নড়', 'કન્નડ', 'ਕੰਨੜ'] },
  { lang: Language.TAMIL,     labels: ['tamil', 'தமிழ்', 'तमिल', 'ತಮಿಳು', 'తమిళం', 'തമിഴ്', 'তামিল', 'તમિલ', 'ਤਮਿਲ'] },
  { lang: Language.TELUGU,    labels: ['telugu', 'తెలుగు', 'तेलुगु', 'ತೆಲುಗು', 'தெலுங்கு', 'തെലുങ്ക്', 'তেলুগু', 'તેલુગુ', 'ਤੇਲਗੁ'] },
  { lang: Language.MALAYALAM, labels: ['malayalam', 'മലയാളം', 'मलयालम', 'ಮಲಯಾಳಂ', 'மலையாளம்', 'మలయాళం', 'মালয়ালম', 'મલયાલમ', 'ਮਲਯਾਲਮ'] },
  { lang: Language.BENGALI,   labels: ['bengali', 'bangla', 'বাংলা', 'বাঙালি', 'बंगाली', 'ಬಂಗಾಳಿ', 'வங்காளம்', 'బెంగాలీ', 'ബംഗാളി', 'બંગાળી', 'ਬੰਗਾਲੀ'] },
  { lang: Language.GUJARATI,  labels: ['gujarati', 'ગુજરાતી', 'गुजराती', 'ಗುಜರಾತಿ', 'குஜராத்தி', 'గుజరాతీ', 'ഗുജറാത്തി', 'গুজরাটি', 'ਗੁਜਰਾਤੀ'] },
  { lang: Language.PUNJABI,   labels: ['punjabi', 'panjabi', 'ਪੰਜਾਬੀ', 'पंजाबी', 'ಪಂಜಾಬಿ', 'பஞ்சாபி', 'పంజాబీ', 'പഞ്ചാബി', 'পাঞ্জাবি', 'પંજાબી'] },
];

// Connector phrases that typically precede / follow a language name when the
// user specifies output language. e.g. "in kannada", "kannada में", "ಕನ್ನಡದಲ್ಲಿ".
// We only treat a language match as an output-language request if such a
// connector is present — otherwise we'd misfire on "what is kannada" which
// is asking ABOUT the language, not requesting output IN it.
const OUTPUT_LANGUAGE_CONNECTORS = [
  // English
  /\bin\s+([a-z]+)\b/i,
  /\binto\s+([a-z]+)\b/i,
  /\b([a-z]+)\s+(?:me|mein|main)\b/i,           // hinglish: "kannada me", "hindi mein"
  /\b([a-z]+)\s+language\b/i,
  /\bin\s+([a-z]+)\s+language\b/i,
  /\btranslate\s+(?:to|into)\s+([a-z]+)\b/i,
  // Hindi/Marathi devanagari: "हिंदी में", "मराठीत", "कन्नड़ में"
  /([\u0900-\u097F]+)\s*(?:में|मध्ये|मधे)/u,
  // Kannada: "ಕನ್ನಡದಲ್ಲಿ", "ಹಿಂದಿಯಲ್ಲಿ"
  /([\u0C80-\u0CFF]+)(?:ದಲ್ಲಿ|ಯಲ್ಲಿ)/u,
  // Tamil: "தமிழில்", "ஆங்கிலத்தில்"
  /([\u0B80-\u0BFF]+)(?:இல்|ல்|த்தில்)/u,
  // Telugu: "తెలుగులో"
  /([\u0C00-\u0C7F]+)(?:లో)/u,
  // Malayalam: "മലയാളത്തിൽ"
  /([\u0D00-\u0D7F]+)(?:ത്തിൽ|ിൽ)/u,
  // Bengali: "বাংলায়"
  /([\u0980-\u09FF]+)(?:য়|তে)/u,
  // Gujarati: "ગુજરાતીમાં"
  /([\u0A80-\u0AFF]+)(?:માં)/u,
  // Punjabi: "ਪੰਜਾਬੀ ਵਿੱਚ"
  /([\u0A00-\u0A7F]+)\s*(?:ਵਿੱਚ|ਵਿਚ)/u,
];

/**
 * Extract the user's requested output language from a message using ONLY
 * rule-based matching (no LLM call). Returns undefined if the user didn't
 * explicitly ask for a specific output language.
 *
 * Strategy: find a connector phrase (e.g. "in <X>", "<X> में") and check if
 * the captured token matches any of our language labels.
 */
export function extractRequestedOutputLanguage(text: string): Language | undefined {
  if (!text) return undefined;
  const lower = text.toLowerCase();

  // First check connector-based extraction (covers "in kannada", "हिंदी में",
  // "ಕನ್ನಡದಲ್ಲಿ" etc.)
  for (const pattern of OUTPUT_LANGUAGE_CONNECTORS) {
    const m = text.match(pattern) || lower.match(pattern);
    if (!m) continue;
    const captured = m[1]?.toLowerCase();
    if (!captured) continue;
    for (const { lang, labels } of OUTPUT_LANGUAGE_PATTERNS) {
      if (labels.some((l) => captured === l.toLowerCase() || captured.includes(l.toLowerCase()))) {
        return lang;
      }
    }
  }

  // Fallback: scan for a language label adjacent to a clear "output" intent
  // verb (give/want/need) — covers "give me kannada video" without "in".
  const giveIntent = /\b(give|send|want|need|chahiye|chahta|chahti|do|please)\b/i.test(lower);
  if (giveIntent) {
    for (const { lang, labels } of OUTPUT_LANGUAGE_PATTERNS) {
      for (const l of labels) {
        // Word-boundary check on Latin labels, plain includes for Indic.
        const ll = l.toLowerCase();
        const isLatin = /^[a-z]+$/.test(ll);
        const hit = isLatin
          ? new RegExp(`\\b${ll}\\b`, 'i').test(lower)
          : text.includes(l);
        if (hit) return lang;
      }
    }
  }

  return undefined;
}

const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
const OPENAI_BASE_URL = 'https://api.openai.com';
// Claude Haiku 3.5 — cheap, fast, strong reasoning for intent + slot extraction.
const HAIKU_MODEL = 'claude-3-5-haiku-20241022';
// GPT-4o-mini — used as a fallback reasoner if Anthropic is unreachable.
const OPENAI_FALLBACK_MODEL = 'gpt-4o-mini';

export class SarvamIntentAgent {
  private api: AxiosInstance;
  private anthropic: AxiosInstance;
  private openai: AxiosInstance;
  private readonly apiKey: string;
  private readonly anthropicKey: string;
  private readonly openaiKey: string;

  constructor() {
    this.apiKey = process.env.SARVAM_API_KEY || '';
    this.anthropicKey = process.env.ANTHROPIC_API_KEY || '';
    this.openaiKey = process.env.OPENAI_API_KEY || '';
    this.api = axios.create({
      baseURL: SARVAM_BASE_URL,
      timeout: 8000,
      headers: {
        'Content-Type': 'application/json',
        'API-Subscription-Key': this.apiKey,
      },
    });
    this.anthropic = axios.create({
      baseURL: ANTHROPIC_BASE_URL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.anthropicKey,
        'anthropic-version': '2023-06-01',
      },
    });
    this.openai = axios.create({
      baseURL: OPENAI_BASE_URL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.openaiKey}`,
      },
    });
  }

  /**
   * Detect language + classify intent for an incoming message.
   * Falls back to keyword heuristics when the API is unreachable.
   */
  async detect(text: string): Promise<SarvamIntentResult> {
    if (!this.apiKey) {
      logger.warn('[SarvamIntentAgent] SARVAM_API_KEY not set — using fallback');
      return this.keywordFallback(text);
    }

    try {
      // ── Step 1: Language identification ─────────────────────────────────
      const langResponse = await this.api.post('/text-lid', {
        input: text,
      });

      const langCode: string =
        (langResponse.data?.language_code as string) ?? 'en';
      const language = SARVAM_LANG_MAP[langCode] ?? Language.ENGLISH;

      // ── Step 2: Transliteration (Latin ← Indic) for downstream LLMs ────
      let transliteratedText: string | undefined;
      if (langCode !== 'en') {
        try {
          const xlitResponse = await this.api.post('/transliterate', {
            input: text,
            source_language_code: langCode,
            target_language_code: 'en-IN',
            numerals_format: 'international',
          });
          transliteratedText =
            (xlitResponse.data?.transliterated_text as string) ?? undefined;
        } catch {
          // transliteration is best-effort; ignore errors
        }
      }

      // ── Step 3: Intent classification (LLM) ─────────────────────────────
      // Cascade (cheapest-first):
      //   1. Claude Haiku 3.5  — primary intent classifier
      //   2. GPT-4o-mini        — fallback if Anthropic is unreachable
      //   3. Sarvam-2B          — last LLM fallback
      const classifyText = transliteratedText || text;
      const reasoner = await this.classifyViaHaiku(classifyText)
        .catch(async (err) => {
          logger.warn('[SarvamIntentAgent] Haiku failed, trying GPT-4o-mini', {
            err: err?.message,
          });
          return this.classifyViaOpenAI(classifyText);
        })
        .catch(async (err) => {
          logger.warn('[SarvamIntentAgent] GPT-4o-mini failed, trying Sarvam-2B', {
            err: err?.message,
          });
          return this.classifyIntentViaSarvam(classifyText);
        });

      // ── Step 4: Output-language extraction (rule-based, NO LLM) ─────────
      // Per-user requirement: "for any lang or audio use Deepgram + Sarvam,
      // no AI model". So we run a deterministic regex scan over the
      // (optionally transliterated) text. Cheaper, faster, and predictable.
      const requestedOutputLanguage = extractRequestedOutputLanguage(text)
        || (transliteratedText
            ? extractRequestedOutputLanguage(transliteratedText)
            : undefined);

      return {
        language,
        languageCode: langCode,
        intent: reasoner.intent,
        transliteratedText,
        confidence: reasoner.confidence,
        fromSarvam: true,
        requestedOutputLanguage,
        topic: (reasoner as { topic?: string }).topic,
      };
    } catch (err: any) {
      logger.warn('[SarvamIntentAgent] API error — using fallback', {
        message: err.message,
      });
      return this.keywordFallback(text);
    }
  }

  // ── Private: Claude Haiku reasoner (INTENT + TOPIC slot) ──────────────
  // Language detection is rule-based per project policy; intent + topic
  // extraction stay on the LLM because they need actual reasoning (e.g.
  // "Generate me a quiz on dfs" → topic=dfs, NOT "me a").

  private async classifyViaHaiku(
    text: string,
  ): Promise<{ intent: Intent; confidence: number; topic?: string }> {
    if (!this.anthropicKey) {
      throw new Error('ANTHROPIC_API_KEY not set');
    }

    const systemPrompt = `You are an intent + topic extractor for an educational WhatsApp bot.

Return JSON with three fields:

1. "intent" — EXACTLY ONE of:
   video_generation, mindmap_request, quiz_request, concept_explanation,
   question_answer, math_problem, code_help, general_query

2. "topic" — the actual subject / concept the user is asking about, stripped
   of trigger words ("video", "quiz", "mindmap", "explain", "in kannada",
   filler verbs, articles, etc.). Use null for chatter/greetings.
   Examples:
     "Generate me a quiz on dfs"           → "dfs"
     "video photosynthesis in kannada"     → "photosynthesis"
     "explain euclid theorem in hindi"     → "euclid theorem"
     "fourier transform ka video banao"    → "fourier transform"
     "hi there"                              → null
     "solve 2x + 3 = 11"                    → "2x + 3 = 11"

3. "confidence" — float 0.0-1.0 for the intent classification.

Respond with ONLY valid JSON, no prose, no markdown fences. Schema:
{"intent": "<label>", "topic": "<topic or null>", "confidence": <0.0-1.0>}`;

    const response = await this.anthropic.post('/v1/messages', {
      model: HAIKU_MODEL,
      max_tokens: 200,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: 'user', content: text }],
    });

    const raw: string = response.data?.content?.[0]?.text ?? '{}';
    const cleaned = raw.replace(/```json\s*|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    const intent =
      INTENT_LABEL_MAP[parsed.intent as string] ?? Intent.GENERAL_QUERY;
    const confidence: number =
      typeof parsed.confidence === 'number' ? parsed.confidence : 0.85;
    const topicRaw = parsed.topic;
    const topic =
      typeof topicRaw === 'string' && topicRaw.trim() && topicRaw.toLowerCase() !== 'null'
        ? topicRaw.trim()
        : undefined;

    logger.info('[SarvamIntentAgent] Haiku classified', { text, intent, topic, confidence });
    return { intent, confidence, topic };
  }

  // ── Private: GPT-4o-mini reasoner (INTENT + TOPIC slot, fallback) ─────────

  private async classifyViaOpenAI(
    text: string,
  ): Promise<{ intent: Intent; confidence: number; topic?: string }> {
    if (!this.openaiKey) {
      throw new Error('OPENAI_API_KEY not set');
    }

    const systemPrompt = `You are an intent + topic extractor for an educational WhatsApp bot.
Return JSON: {"intent": "<label>", "topic": "<topic or null>", "confidence": <0.0-1.0>}

Intent labels (pick exactly one):
  video_generation, mindmap_request, quiz_request, concept_explanation,
  question_answer, math_problem, code_help, general_query

topic = the subject the user is asking about, stripped of trigger words
(video/quiz/mindmap/explain), language requests ("in kannada"), filler
verbs and articles. Use null for chatter / greetings.

Examples:
  "Generate me a quiz on dfs"           → {"intent":"quiz_request","topic":"dfs","confidence":0.95}
  "video photosynthesis in kannada"     → {"intent":"video_generation","topic":"photosynthesis","confidence":0.95}
  "fourier transform ka video banao"    → {"intent":"video_generation","topic":"fourier transform","confidence":0.9}
  "hi"                                    → {"intent":"general_query","topic":null,"confidence":0.7}`;

    const response = await this.openai.post('/v1/chat/completions', {
      model: OPENAI_FALLBACK_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 200,
    });

    const raw: string = response.data?.choices?.[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw);

    const intent =
      INTENT_LABEL_MAP[parsed.intent as string] ?? Intent.GENERAL_QUERY;
    const confidence: number =
      typeof parsed.confidence === 'number' ? parsed.confidence : 0.8;
    const topicRaw = parsed.topic;
    const topic =
      typeof topicRaw === 'string' && topicRaw.trim() && topicRaw.toLowerCase() !== 'null'
        ? topicRaw.trim()
        : undefined;

    logger.info('[SarvamIntentAgent] GPT-4o-mini classified', { text, intent, topic, confidence });
    return { intent, confidence, topic };
  }

  // ── Private: LLM-based intent classification via Sarvam Saaras (fallback) ─

  private async classifyIntentViaSarvam(
    text: string,
  ): Promise<{ intent: Intent; confidence: number }> {
    const systemPrompt = `You are an intent classifier for an educational WhatsApp bot.
Classify the user message into EXACTLY ONE of these intents:
  video_generation, mindmap_request, quiz_request, concept_explanation,
  question_answer, math_problem, code_help, general_query

Respond with a JSON object only:
{"intent": "<intent_label>", "confidence": <0.0-1.0>}`;

    const response = await this.api.post('/chat/completions', {
      model: 'sarvam-2b',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    });

    const content: string =
      response.data?.choices?.[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(content);
    const intent =
      INTENT_LABEL_MAP[parsed.intent as string] ?? Intent.GENERAL_QUERY;
    const confidence: number =
      typeof parsed.confidence === 'number' ? parsed.confidence : 0.7;

    return { intent, confidence };
  }

  // ── Private: keyword heuristic fallback (runs without API access) ────────

  private keywordFallback(text: string): SarvamIntentResult {
    const t = text.toLowerCase();

    let intent = Intent.GENERAL_QUERY;
    let language = Language.ENGLISH;

    // Language detection by script
    if (/[\u0C80-\u0CFF]/.test(text)) language = Language.KANNADA;
    else if (/[\u0900-\u097F]/.test(text)) language = Language.HINDI;

    // Intent detection by keywords
    if (
      /video|banao|animation|ವೀಡಿಯೊ|वीडियो/.test(t) &&
      !/mindmap|mind map/.test(t)
    ) {
      intent = Intent.VIDEO_GENERATION;
    } else if (/mindmap|mind map|diagram|flowchart|ಮೈಂಡ್|माइंड/.test(t)) {
      intent = Intent.MINDMAP_REQUEST;
    } else if (/quiz|mcq|poll|test me|ಕ್ವಿಜ್|प्रश्नोत्तरी/.test(t)) {
      intent = Intent.QUIZ_REQUEST;
    } else if (/solve|calculate|equation|integral|derivative|ganit/.test(t)) {
      intent = Intent.MATH_PROBLEM;
    } else if (/code|debug|function|algorithm|program/.test(t)) {
      intent = Intent.CODE_HELP;
    } else if (/explain|samjhao|what is|how does|kya hai/.test(t)) {
      intent = Intent.CONCEPT_EXPLANATION;
    } else if (/\?|why|when|where|kyu|kab/.test(t)) {
      intent = Intent.QUESTION_ANSWER;
    }

    return {
      language,
      languageCode: language === Language.KANNADA ? 'kn' : language === Language.HINDI ? 'hi' : 'en',
      intent,
      confidence: 0.6,
      fromSarvam: false,
    };
  }
}
