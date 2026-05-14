/**
 * MessageHandler
 * Receives and processes incoming WhatsApp messages
 */

import { Message, Chat, Poll, PollVote } from 'whatsapp-web.js';
import { MessageData, MediaType, Language, PendingQuiz } from '../types';
import { MessageRouter } from './MessageRouter';
import { MediaHandler } from './MediaHandler';
import { ContentGenerator } from '../services/ContentGenerator';
import { ResponseFormatter } from '../services/ResponseFormatter';
import { SpeechToText } from '../services/SpeechToText';
import { SessionStore } from '../storage/SessionStore';
import { logger } from '../utils/logger';
import { trackMessageProcessing } from '../utils/metrics';

export class MessageHandler {
  private router: MessageRouter;
  private mediaHandler: MediaHandler;
  private contentGenerator: ContentGenerator;
  private responseFormatter: ResponseFormatter;
  private sessionStore: SessionStore;
  private speechToText: SpeechToText;

  constructor(
    router: MessageRouter,
    mediaHandler: MediaHandler,
    contentGenerator: ContentGenerator,
    responseFormatter: ResponseFormatter,
    sessionStore: SessionStore,
    speechToText: SpeechToText
  ) {
    this.router = router;
    this.mediaHandler = mediaHandler;
    this.contentGenerator = contentGenerator;
    this.responseFormatter = responseFormatter;
    this.sessionStore = sessionStore;
    this.speechToText = speechToText;
  }

  async handleMessage(message: Message): Promise<void> {
    await trackMessageProcessing(async () => {
      // Validate message first
      if (!this.validateMessage(message)) {
        return;
      }

      const messageData = this.extractMessageData(message);
      logger.info('Processing message', {
        from: messageData.from,
        hasMedia: messageData.hasMedia,
        bodyLength: messageData.body.length,
      });

      // Acknowledge the message
      await this.acknowledgeMessage(message);

      // Get or create user session
      const session = await this.sessionStore.getOrCreateSession(
        messageData.from,
        messageData.fromName
      );

      // --- Voice note → text -------------------------------------------------
      // If the message is a WhatsApp voice note / audio, transcribe it via
      // Sarvam STT and rewrite `messageData.body` so the rest of the pipeline
      // (language picker, greeting, router, video / mindmap intents) treats
      // it exactly like a typed message. This is what lets the user SPEAK
      // "video photosynthesis" and get a video.
      if (
        message.hasMedia &&
        messageData.mediaType === MediaType.AUDIO &&
        !messageData.body.trim()
      ) {
        const transcribed = await this.handleVoiceNote(message, session);
        if (!transcribed) {
          // Nothing useful extracted; error reply already sent by the helper.
          return;
        }
        messageData.body = transcribed;
        messageData.hasMedia = false;
      }

      // Add user message to conversation history
      await this.sessionStore.addMessageToHistory(
        messageData.from,
        'user',
        messageData.body
      );

      // Language selection: intercept 1/2/3/4 at ANY point in the conversation
      const langPick = this.parseLanguageChoice(messageData.body);
      if (langPick) {
        const isSwitch = session.languageSet && session.language !== langPick;
        session.language = langPick;
        session.languageSet = true;
        await this.sessionStore.updateSession(session);
        const confirmations: Partial<Record<Language, string>> = {
          [Language.ENGLISH]: isSwitch
            ? '🔄 Switched to *English*! Your conversation context is saved. Ask away! 📚'
            : '✅ Language set to *English*!\n\nAsk me anything — I\'m here to help you learn! 📚',
          [Language.MARATHI]: isSwitch
            ? '🔄 *मराठी* मध्ये बदलले! संदर्भ लक्षात आहे. विचारा! 📚'
            : '✅ भाषा *मराठी* मध्ये सेट झाली!\n\nकाहीही विचारा — मी मदतीसाठी तयार आहे! 📚',
          [Language.HINDI]: isSwitch
            ? '🔄 *हिन्दी* में बदल दिया! पिछली बातचीत याद है। पूछो! 📚'
            : '✅ भाषा *हिन्दी* में सेट हो गई!\n\nकुछ भी पूछो — मैं मदद के लिए तैयार हूँ! 📚',
          [Language.KANNADA]: isSwitch
            ? '🔄 *ಕನ್ನಡ*ಕ್ಕೆ ಬದಲಾಯಿಸಲಾಗಿದೆ! ಸಂದರ್ಭ ಉಳಿದಿದೆ. ಕೇಳಿ! 📚'
            : '✅ ಭಾಷೆ *ಕನ್ನಡ* ಎಂದು ಹೊಂದಿಸಲಾಗಿದೆ!\n\nಏನಾದರೂ ಕೇಳಿ — ನಾನು ಸಹಾಯ ಮಾಡಲು ಸಿದ್ಧ! 📚',
          [Language.TAMIL]: isSwitch
            ? '🔄 *தமிழ்*க்கு மாற்றப்பட்டது! உரையாடல் சூழல் சேமிக்கப்பட்டது. கேளுங்கள்! 📚'
            : '✅ மொழி *தமிழ்* என அமைக்கப்பட்டது!\n\nஎதையும் கேளுங்கள்! 📚',
          [Language.TELUGU]: isSwitch
            ? '🔄 *తెలుగు*కి మార్చబడింది! సంభాషణ సందర్భం సేవ్ చేయబడింది. అడగండి! 📚'
            : '✅ భాష *తెలుగు*గా సెట్ చేయబడింది!\n\nఏదైనా అడగండి! 📚',
          [Language.MALAYALAM]: isSwitch
            ? '🔄 *മലയാളം*ലേക്ക് മാറ്റി! സംഭാഷണ സന്ദർഭം സംരക്ഷിച്ചു. ചോദിക്കൂ! 📚'
            : '✅ ഭാഷ *മലയാളം* ആയി സജ്ജമാക്കി!\n\nഎന്തും ചോദിക്കൂ! 📚',
          [Language.BENGALI]: isSwitch
            ? '🔄 *বাংলা*য় পরিবর্তন করা হয়েছে! কথোপকথনের প্রসঙ্গ সংরক্ষিত। জিজ্ঞাসা করুন! 📚'
            : '✅ ভাষা *বাংলা* সেট করা হয়েছে!\n\nযেকোনো কিছু জিজ্ঞাসা করুন! 📚',
          [Language.GUJARATI]: isSwitch
            ? '🔄 *ગુજરાતી*માં બદલાયું! વાતચીતનો સંદર્ભ સાચવેલ છે. પૂછો! 📚'
            : '✅ ભાષા *ગુજરાતી* સેટ થઈ!\n\nકંઈપણ પૂછો! 📚',
          [Language.PUNJABI]: isSwitch
            ? '🔄 *ਪੰਜਾਬੀ* ਵਿੱਚ ਬਦਲਿਆ! ਗੱਲਬਾਤ ਦਾ ਸੰਦਰਭ ਸੰਭਾਲਿਆ ਗਿਆ। ਪੁੱਛੋ! 📚'
            : '✅ ਭਾਸ਼ਾ *ਪੰਜਾਬੀ* ਸੈੱਟ ਹੋ ਗਈ!\n\nਕੁਝ ਵੀ ਪੁੱਛੋ! 📚',
        };
        await message.reply(confirmations[langPick] || confirmations[Language.ENGLISH]!);
        return;
      }

      // If language not yet set, show the menu
      if (!session.languageSet) {
        await message.reply(this.getLanguageMenu());
        return;
      }

      // Handle greetings locally — no need to call the LLM
      if (this.isGreeting(messageData.body)) {
        const name = session.userName || messageData.fromName || '';
        const greeting = this.localizedMsg(session.language, {
          english: `👋 Hey${name ? ' ' + name : ''}! Welcome to *Gyan_Intent Bot* 🎓\n\nI can help you with:\n📚 *Ask a question* — Type any doubt\n📐 *Math problems* — Send a problem to solve\n🖼️ *Image solving* — Send a photo of a question\n🎬 *Video* — Type "video [topic]"\n\n🌐 Switch language anytime: send *1/2/3/4*\n\nWhat would you like to learn today?`,
          marathi: `👋 नमस्कार${name ? ' ' + name : ''}! *Gyan_Intent Bot* मध्ये आपले स्वागत आहे 🎓\n\nमी तुम्हाला मदत करू शकतो:\n📚 *प्रश्न विचारा* — कोणतीही शंका लिहा\n📐 *गणित* — प्रॉब्लेम पाठवा, सोडवेन\n🖼️ *फोटोवरून सोडवणे* — प्रश्नाचा फोटो पाठवा\n🎬 *व्हिडिओ* — "video [विषय]" लिहा\n\n🌐 भाषा बदला कधीही: *1/2/3/4* पाठवा\n\nआज काय शिकायचंय?`,
          hindi: `👋 नमस्ते${name ? ' ' + name : ''}! *Gyan_Intent Bot* में आपका स्वागत है 🎓\n\nमैं आपकी मदद कर सकता हूँ:\n📚 *सवाल पूछें* — कोई भी doubt लिखें\n📐 *गणित* — Problem भेजें, हल करूँगा\n🖼️ *फोटो से हल* — Question की photo भेजें\n🎬 *वीडियो* — "video [विषय]" लिखें\n\n🌐 भाषा बदलें कभी भी: *1/2/3/4* भेजें\n\nआज क्या सीखना है?`,
          kannada: `👋 ನಮಸ್ಕಾರ${name ? ' ' + name : ''}! *Gyan_Intent Bot* ಗೆ ಸುಸ್ವಾಗತ 🎓\n\nನಾನು ನಿಮಗೆ ಸಹಾಯ ಮಾಡಬಲ್ಲೆ:\n📚 *ಪ್ರಶ್ನೆ ಕೇಳಿ* — ಯಾವುದೇ doubt ಬರೆಯಿರಿ\n📐 *ಗಣಿತ* — Problem ಕಳುಹಿಸಿ\n🖼️ *ಫೋಟೋದಿಂದ ಪರಿಹಾರ* — Question ನ photo ಕಳುಹಿಸಿ\n🎬 *ವೀಡಿಯೊ* — "video [ವಿಷಯ]" ಬರೆಯಿರಿ\n\n🌐 ಭಾಷೆ ಬದಲಿಸಿ: *1/2/3/4* ಕಳುಹಿಸಿ\n\nಇಂದು ಏನು ಕಲಿಯಬೇಕು?`,
        });
        await message.reply(greeting);
        await this.sessionStore.addMessageToHistory(messageData.from, 'assistant', greeting);
        return;
      }

      // If a quiz is outstanding and the user's message looks like an answer
      // letter (A/B/C/D) or index (1/2/3/4), grade it locally before any
      // other routing. This lets the user just type "B" instead of wording
      // a full question.
      if (session.pendingQuiz) {
        const picked = this.parseQuizAnswer(messageData.body);
        if (picked !== null) {
          await this.gradeQuizAnswer(message, session, picked);
          return;
        }
        // Expire stale quizzes (older than 15 min) silently.
        const QUIZ_TTL_MS = 15 * 60 * 1000;
        if (Date.now() - session.pendingQuiz.askedAt > QUIZ_TTL_MS) {
          session.pendingQuiz = undefined;
          await this.sessionStore.updateSession(session);
        }
      }

      // Handle explicit YouTube / yt link requests locally — no LLM call.
      // Triggers when the user's message mentions "yt" / "youtube" etc.
      // The topic is the rest of the message (minus trigger words), with a
      // fallback to the session's currentContext for follow-ups like
      // "give me yt links".
      if (this.wantsYouTubeLinks(messageData.body)) {
        const stripped = this.stripYouTubeTrigger(messageData.body);
        const ribbon = this.buildYouTubeRibbon(stripped, session);
        if (ribbon) {
          await message.reply(ribbon);
        } else {
          await message.reply(this.localizedMsg(session.language, {
            english: '📺 Tell me the topic for YouTube links. Example: *yt photosynthesis*',
            marathi: '📺 YouTube लिंकसाठी विषय सांगा. उदाहरण: *yt photosynthesis*',
            hindi: '📺 YouTube लिंक के लिए विषय बताइए। उदाहरण: *yt photosynthesis*',
            kannada: '📺 YouTube ಲಿಂಕ್‌ಗಳಿಗಾಗಿ ವಿಷಯವನ್ನು ತಿಳಿಸಿ. ಉದಾಹರಣೆ: *yt photosynthesis*',
          }));
        }
        return;
      }

      // Handle image messages — download and solve via vision
      if (message.hasMedia && (messageData.mediaType === MediaType.IMAGE)) {
        try {
          const imgAck = this.localizedMsg(session.language, {
            english: '🔍 Image received! Analyzing...',
            marathi: '🔍 फोटो मिळाला! विश्लेषण होत आहे...',
            hindi: '🔍 छवि मिल गई! विश्लेषण हो रहा है...',
            kannada: '🔍 ಚಿತ್ರ ಸ್ವೀಕರಿಸಲಾಗಿದೆ! ವಿಶ್ಲೇಷಿಸಲಾಗುತ್ತಿದೆ...',
          });
          await message.reply(imgAck);
          const media = await message.downloadMedia();
          if (media && media.data) {
            const responseText = await this.contentGenerator.solveImage(
              media.data,
              messageData.body || '',
              session
            );
            for (const chunk of this.responseFormatter.formatText(responseText)) {
              await message.reply(chunk);
            }
            await this.sessionStore.addMessageToHistory(
              messageData.from,
              'assistant',
              responseText
            );

            // ── Image + "video" caption → personalized video flow ──────
            // If the user attached a photo AND wrote something like
            // "video", "video banao", "ವೀಡಿಯೊ ಮಾಡಿ", we treat that as a
            // request to ALSO render an explainer video on what the
            // image actually shows. We extract a clean topic from the
            // image via gpt-4o-mini vision, then run our normal video
            // pipeline asynchronously so the user gets their text answer
            // immediately and the video arrives a couple of minutes later.
            const caption = (messageData.body || '').trim();
            if (caption && this.captionTriggersVideo(caption)) {
              const topic = await this.contentGenerator.extractTopicFromImage(
                media.data,
                caption,
              );
              if (topic) {
                await message.reply(this.localizedMsg(session.language, {
                  english: `🎬 Got it! Generating a personalized video on *${topic}*…\nThis usually takes ~2 min.`,
                  marathi: `🎬 समजले! *${topic}* वर तुमच्यासाठी व्हिडिओ तयार करत आहे…\n~२ मिनिटे लागतील.`,
                  hindi: `🎬 समझ गया! *${topic}* पर आपके लिए वीडियो बना रहा हूँ…\n~२ मिनट लगेंगे.`,
                  kannada: `🎬 ಅರ್ಥವಾಯಿತು! *${topic}* ಮೇಲೆ ನಿಮಗಾಗಿ ವೀಡಿಯೊ ತಯಾರಿಸುತ್ತಿದ್ದೇನೆ…\n~೨ ನಿಮಿಷ ತೆಗೆದುಕೊಳ್ಳುತ್ತದೆ.`,
                }));
                // Fire-and-forget: don't await so the message handler
                // returns and the bot stays responsive.
                this.handleVideoGenerationAsync(messageData.from, topic, session)
                  .catch((e) => logger.error('image→video flow failed', { error: e?.message, topic }));
              } else {
                logger.warn('image→video: topic extraction returned empty', { caption });
              }
            }
          } else {
            await message.reply(this.localizedMsg(session.language, {
              english: '⚠️ Could not download the image. Please send again!',
              marathi: '⚠️ फोटो डाउनलोड होऊ शकला नाही. कृपया पुन्हा पाठवा!',
              hindi: '⚠️ छवि डाउनलोड नहीं हो पाई। कृपया दोबारा भेजें!',
              kannada: '⚠️ ಚಿತ್ರ ಡೌನ್‌ಲೋಡ್ ಆಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಕಳುಹಿಸಿ!',
            }));
          }
        } catch (err: any) {
          logger.error('Image processing failed', { error: err.message });
          await message.reply(this.localizedMsg(session.language, {
            english: '⚠️ Could not process the image. Please try again!',
            marathi: '⚠️ फोटो प्रक्रिया होऊ शकली नाही. कृपया पुन्हा प्रयत्न करा!',
            hindi: '⚠️ छवि प्रोसेस नहीं हो पाई। कृपया फिर कोशिश करें!',
            kannada: '⚠️ ಚಿತ್ರ ಪ್ರಕ್ರಿಯೆ ಆಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ!',
          }));
        }
        return;
      }

      // Route the message
      const routeDecision = await this.router.route(messageData);
      logger.info('Message routed', {
        handler: routeDecision.handler,
        intent: routeDecision.intent,
        confidence: routeDecision.confidence,
      });

      // Snapshot the context BEFORE potentially overwriting it, so follow-up
      // handlers (concept_explanation, question_answer) can still reference
      // the topic that was just discussed (e.g. "dfs" after "mindmap dfs").
      const priorContext = (session.currentContext || '').trim();

      // Keep a lightweight context topic for follow-ups like: "what is X" -> "video"
      if (
        routeDecision.intent !== 'video_generation' &&
        routeDecision.intent !== 'command' &&
        messageData.body &&
        messageData.body.trim().length >= 4
      ) {
        try {
          await this.sessionStore.updateContext(messageData.from, messageData.body.trim());
        } catch (error) {
          logger.debug('Could not update session context', { error, from: messageData.from });
        }
      }

      // Handle based on intent
      let responseText: string;
      try {
        switch (routeDecision.intent) {
          case 'video_generation': {
            const requestedTopic = routeDecision.parameters.topic || '';
            const topic = this.resolveVideoTopic(requestedTopic, session);
            // If the user said "...in kannada", swap the session language
            // for THIS request so the video script + voiceover come back
            // in that language even though they typed in English.
            const outLang = (messageData as any).requestedOutputLanguage as Language | undefined;
            const effectiveSession = outLang
              ? { ...session, language: outLang }
              : session;

            if (!topic) {
              responseText = this.localizedMsg(session.language, {
                english: '🎬 Tell me the topic for the video. Example: *video euclid theorem*',
                marathi: '🎬 व्हिडिओचा विषय सांगा. उदाहरण: *video euclid theorem*',
                hindi: '🎬 वीडियो का विषय बताइए। उदाहरण: *video euclid theorem*',
                kannada: '🎬 ವೀಡಿಯೊ ವಿಷಯವನ್ನು ತಿಳಿಸಿ. ಉದಾಹರಣೆ: *video euclid theorem*',
              });
              await message.reply(responseText);
              break;
            }

            // Always go through the backend. It has a topic+language cache,
            // so the first request for a topic takes ~60s and every repeat
            // request (from any user) is returned instantly.
            // Use `effectiveSession.language` so "video photosynthesis in
            // kannada" (typed in English) acks in Kannada too.
            responseText = this.localizedMsg(effectiveSession.language, {
              english: `🎬 Starting video generation!\n\nTopic: ${topic}\n\n⏱️ Hold on — your *1.5-minute context video* will be ready in about *3 minutes*.`,
              marathi: `🎬 व्हिडिओ तयार होत आहे!\n\nविषय: ${topic}\n\n⏱️ थांबा — *१.५-मिनिटाचा context व्हिडिओ* सुमारे *३ मिनिटांत* तयार होईल.`,
              hindi: `🎬 वीडियो बनाना शुरू हो रहा है!\n\nविषय: ${topic}\n\n⏱️ रुकिए — आपका *1.5-मिनट का context वीडियो* लगभग *3 मिनट* में तैयार होगा.`,
              kannada: `🎬 ವೀಡಿಯೊ ರಚನೆ ಪ್ರಾರಂಭವಾಗುತ್ತಿದೆ!\n\nವಿಷಯ: ${topic}\n\n⏱️ ನಿರೀಕ್ಷಿಸಿ — ನಿಮ್ಮ *1.5-ನಿಮಿಷದ context ವೀಡಿಯೊ* ಸುಮಾರು *3 ನಿಮಿಷಗಳಲ್ಲಿ* ಸಿದ್ಧವಾಗುತ್ತದೆ.`,
            });
            await message.reply(responseText);

            // Pass effectiveSession so backend renders the video in the
            // requested output language (e.g. Kannada) rather than the
            // session default.
            void this.handleVideoGenerationAsync(messageData.from, topic, effectiveSession);
            break;
          }

          case 'mindmap_request': {
            const requestedTopic = routeDecision.parameters.topic || '';
            // Reuse the video-topic resolver — same fallback semantics
            // (recent context, last non-trivial user message).
            const topic = this.resolveVideoTopic(requestedTopic, session);
            // Honor "...in <language>" override for this request only.
            const mmOutLang = (messageData as any).requestedOutputLanguage as Language | undefined;
            const mmSession = mmOutLang ? { ...session, language: mmOutLang } : session;

            if (!topic) {
              responseText = this.localizedMsg(mmSession.language, {
                english: '🧠 Tell me the topic for the mindmap. Example: *mindmap photosynthesis*',
                marathi: '🧠 माइंड मॅपचा विषय सांगा. उदाहरण: *mindmap photosynthesis*',
                hindi: '🧠 माइंड मैप का विषय बताइए। उदाहरण: *mindmap photosynthesis*',
                kannada: '🧠 ಮೈಂಡ್ ಮ್ಯಾಪ್ ವಿಷಯವನ್ನು ತಿಳಿಸಿ. ಉದಾಹರಣೆ: *mindmap photosynthesis*',
              });
              await message.reply(responseText);
              break;
            }

            // Persist the clean topic as context so follow-up queries like
            // "Explain branch types" know they refer to THIS topic.
            try {
              await this.sessionStore.updateContext(messageData.from, topic);
            } catch (_) { /* non-fatal */ }

            responseText = this.localizedMsg(mmSession.language, {
              english: `🧠 Generating mindmap on *${topic}* — one moment...`,
              marathi: `🧠 *${topic}* वर माइंड मॅप तयार होत आहे — एक क्षण...`,
              hindi: `🧠 *${topic}* पर माइंड मैप बन रहा है — एक क्षण...`,
              kannada: `🧠 *${topic}* ಕುರಿತು ಮೈಂಡ್‌ಮ್ಯಾಪ್ ರಚಿಸಲಾಗುತ್ತಿದೆ — ಒಂದು ಕ್ಷಣ...`,
            });
            await message.reply(responseText);

            void this.handleMindmapGenerationAsync(messageData.from, topic, mmSession);
            break;
          }

          case 'quiz_request': {
            const requestedTopic = routeDecision.parameters.topic || '';
            const topic = this.resolveVideoTopic(requestedTopic, session);
            // Honor "...in <language>" override for this request only.
            const qOutLang = (messageData as any).requestedOutputLanguage as Language | undefined;
            const qSession = qOutLang ? { ...session, language: qOutLang } : session;

            if (!topic) {
              responseText = this.localizedMsg(qSession.language, {
                english: '📝 Tell me the topic for the quiz. Example: *quiz photosynthesis*',
                marathi: '📝 क्विझचा विषय सांगा. उदाहरण: *quiz photosynthesis*',
                hindi: '📝 क्विज़ का विषय बताइए। उदाहरण: *quiz photosynthesis*',
                kannada: '📝 ಕ್ವಿಜ್ ವಿಷಯವನ್ನು ತಿಳಿಸಿ. ಉದಾಹರಣೆ: *quiz photosynthesis*',
              });
              await message.reply(responseText);
              break;
            }

            await this.handleQuizRequest(message, qSession, topic);
            break;
          }

          case 'concept_explanation': {
            // Honor "...in <language>" override for the answer language.
            const ceOutLang = (messageData as any).requestedOutputLanguage as Language | undefined;
            const ceSession = ceOutLang ? { ...session, language: ceOutLang } : session;
            // Enrich short follow-up queries with the prior context topic so
            // the backend LLM knows e.g. "Explain branch types" is about DFS.
            const ceQuery = this.buildContextAwareQuery(messageData.body, priorContext);
            responseText = await this.contentGenerator.explainConcept(ceQuery, ceSession);
            for (const chunk of this.responseFormatter.formatText(responseText)) {
              await message.reply(chunk);
            }
            break;
          }

          case 'math_problem': {
            const mpOutLang = (messageData as any).requestedOutputLanguage as Language | undefined;
            const mpSession = mpOutLang ? { ...session, language: mpOutLang } : session;
            responseText = await this.contentGenerator.solveMathProblem(messageData.body, mpSession);
            for (const chunk of this.responseFormatter.formatText(responseText)) {
              await message.reply(chunk);
            }
            break;
          }

          case 'question_answer': {
            const qaOutLang = (messageData as any).requestedOutputLanguage as Language | undefined;
            const qaSession = qaOutLang ? { ...session, language: qaOutLang } : session;
            const qaQuery = this.buildContextAwareQuery(messageData.body, priorContext);
            responseText = await this.contentGenerator.answerQuestion(qaQuery, qaSession);
            for (const chunk of this.responseFormatter.formatText(responseText)) {
              await message.reply(chunk);
            }
            break;
          }

          case 'command': {
            const cmd = messageData.body.toLowerCase().replace('!', '').trim();
            if (cmd === 'language') {
              // Reset language so user gets the menu again
              session.languageSet = false;
              await this.sessionStore.updateSession(session);
            }
            responseText = this.handleCommand(messageData.body);
            await message.reply(responseText);
            break;
          }

          default:
            responseText = await this.contentGenerator.answerQuestion(messageData.body, session);
            for (const chunk of this.responseFormatter.formatText(responseText)) {
              await message.reply(chunk);
            }
            break;
        }
      } catch (error) {
        logger.error('Error processing message', { error, from: messageData.from });
        await message.reply(this.localizedMsg(session.language, {
          english: '😔 Something went wrong! Please try again.\n\nCommands:\n• *!help* — Help\n• *video [topic]* — Generate video',
          marathi: '😔 काहीतरी चूक झाली! कृपया पुन्हा प्रयत्न करा.\n\nCommands:\n• *!help* — मदत\n• *video [topic]* — व्हिडिओ बनवा',
          hindi: '😔 कुछ गलत हो गया! कृपया दोबारा कोशिश करें।\n\nCommands:\n• *!help* — मदद\n• *video [topic]* — वीडियो बनाओ',
          kannada: '😔 ಏನೋ ತಪ್ಪಾಗಿದೆ! ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.\n\nCommands:\n• *!help* — ಸಹಾಯ\n• *video [topic]* — ವೀಡಿಯೊ ಮಾಡಿ',
        }));
      }

      // Add bot response to history
      await this.sessionStore.addMessageToHistory(
        messageData.from,
        'assistant',
        responseText! || 'Error response sent'
      );
    }, { handler: 'message_handler' });
  }

  extractMessageData(message: Message): MessageData {
    // using (message as any)._data to get underlying contact info without ts errors
    const contact = (message as any)._data;
    let mediaType: MediaType | undefined;

    if (message.hasMedia) {
      const type = message.type;
      if (type === 'image' || type === 'sticker') mediaType = MediaType.IMAGE;
      // 'ptt' = push-to-talk = WhatsApp voice note. It is AUDIO, not video,
      // so it must go through the speech-to-text pipeline.
      else if (type === 'audio' || type === 'ptt') mediaType = MediaType.AUDIO;
      else if (type === 'video') mediaType = MediaType.VIDEO;
      else if (type === 'document') mediaType = MediaType.DOCUMENT;
    }

    return {
      id: message.id._serialized,
      from: message.from,
      fromName: (contact as any)?.notifyName || 'Unknown',
      body: message.body || '',
      timestamp: message.timestamp,
      hasMedia: message.hasMedia,
      mediaType,
      isGroup: message.from.endsWith('@g.us'),
      groupId: message.from.endsWith('@g.us') ? message.from : undefined,
      mentionedIds: [],
    };
  }

  async downloadMedia(message: Message): Promise<Buffer> {
    const media = await message.downloadMedia();
    if (!media) {
      throw new Error('Failed to download media');
    }
    return Buffer.from(media.data, 'base64');
  }

  validateMessage(message: Message): boolean {
    // Reject status broadcasts
    if (message.from === 'status@broadcast') return false;

    // Allow self-sent messages for testing (message yourself to test the bot)
    // if (message.fromMe) return false;

    // Reject empty messages without media
    if (!message.body && !message.hasMedia) return false;

    return true;
  }

  async acknowledgeMessage(message: Message): Promise<void> {
    try {
      const chat: Chat = await message.getChat();
      await chat.sendSeen();
    } catch (error) {
      logger.debug('Could not send seen receipt', { error });
    }
  }

  private handleCommand(text: string): string {
    const command = text.toLowerCase().replace('!', '').trim();

    switch (command) {
      case 'help':
      case 'madad':
        return `🙏 *Gyan_Intent Bot*\n\nMain kya kar sakti hoon:\n\n📚 *Concept explain* — Koi bhi topic likh ke bhejo\n🎬 *Video generate* — "video [topic]" likh ke bhejo\n📐 *Math solve* — Math problem likh ke bhejo\n🔬 *Science doubts* — Science question likh ke bhejo\n\n*Commands:*\n• !help — Yeh message\n• !status — Bot status\n• !language — Language change karo`;

      case 'status':
        return `✅ *Bot Status*\n\n🟢 Online\n📊 Processing messages normally`;

      case 'language':
        return this.getLanguageMenu();

      default:
        return `❓ Unknown command: !${command}\n\nType *!help* for available commands.`;
    }
  }

  private getLanguageMenu(): string {
    return (
      `🌐 *Welcome to Gyan_Intent Bot!* 🎓\n\n` +
      `Please choose your language:\n\n` +
      `1️⃣  *English*\n` +
      `2️⃣  *मराठी* (Marathi)\n` +
      `3️⃣  *हिन्दी* (Hindi)\n` +
      `4️⃣  *ಕನ್ನಡ* (Kannada)\n` +
      `5️⃣  *தமிழ்* (Tamil)\n` +
      `6️⃣  *తెలుగు* (Telugu)\n` +
      `7️⃣  *മലയാളം* (Malayalam)\n` +
      `8️⃣  *বাংলা* (Bengali)\n` +
      `9️⃣  *ગુજરાતી* (Gujarati)\n` +
      `🔟 *ਪੰਜਾਬੀ* (Punjabi)\n\n` +
      `Reply with *1*–*10*`
    );
  }

  private parseLanguageChoice(text: string): Language | null {
    const t = text.trim().toLowerCase();
    if (t === '1' || t === 'english') return Language.ENGLISH;
    if (t === '2' || t === 'marathi' || t === 'मराठी') return Language.MARATHI;
    if (t === '3' || t === 'hindi' || t === 'हिन्दी' || t === 'हिंदी') return Language.HINDI;
    if (t === '4' || t === 'kannada' || t === 'ಕನ್ನಡ') return Language.KANNADA;
    if (t === '5' || t === 'tamil' || t === 'தமிழ்') return Language.TAMIL;
    if (t === '6' || t === 'telugu' || t === 'తెలుగు') return Language.TELUGU;
    if (t === '7' || t === 'malayalam' || t === 'മലയാളം') return Language.MALAYALAM;
    if (t === '8' || t === 'bengali' || t === 'বাংলা') return Language.BENGALI;
    if (t === '9' || t === 'gujarati' || t === 'ગુજરાતી') return Language.GUJARATI;
    if (t === '10' || t === 'punjabi' || t === 'ਪੰਜਾਬੀ') return Language.PUNJABI;
    return null;
  }

  private localizedMsg(
    lang: Language,
    msgs: { english: string; marathi: string; hindi: string; kannada: string; tamil?: string; telugu?: string; malayalam?: string; bengali?: string; gujarati?: string; punjabi?: string }
  ): string {
    switch (lang) {
      case Language.ENGLISH: return msgs.english;
      case Language.HINDI: return msgs.hindi;
      case Language.KANNADA: return msgs.kannada;
      case Language.MARATHI: return msgs.marathi;
      case Language.TAMIL: return msgs.tamil || msgs.english;
      case Language.TELUGU: return msgs.telugu || msgs.english;
      case Language.MALAYALAM: return msgs.malayalam || msgs.english;
      case Language.BENGALI: return msgs.bengali || msgs.english;
      case Language.GUJARATI: return msgs.gujarati || msgs.english;
      case Language.PUNJABI: return msgs.punjabi || msgs.english;
      default:
        return msgs.english;
    }
  }

  private isGreeting(text: string): boolean {
    const t = text.trim().toLowerCase();
    const greetings = [
      'hi', 'hello', 'hey', 'hola', 'yo', 'sup',
      'high',
      'namaste', 'namaskar', 'hii', 'hiii', 'hiiii',
      'good morning', 'good afternoon', 'good evening',
      'gm', 'gn', 'howdy', 'whats up', "what's up",
      'helo', 'helloo', 'hellooo',
      'नमस्ते', 'नमस्कार', 'ನಮಸ್ಕಾರ',
    ];
    return greetings.includes(t) || /^h+e+l+o+$/i.test(t) || /^h+i+$/i.test(t);
  }

  /**
   * Prepend the prior conversation topic to a short follow-up query so the
   * backend LLM has enough context to answer correctly.
   *
   * Examples:
   *   priorContext="dfs", query="Explain branch types"
   *     → "[Context: dfs]\nExplain branch types"
   *   priorContext="dfs", query="What is the difference between BFS and DFS?"
   *     → unchanged (self-contained, ≥ 7 words)
   */
  private buildContextAwareQuery(query: string, priorContext: string): string {
    if (!priorContext) return query;
    const wordCount = query.trim().split(/\s+/).length;
    // Self-contained if ≥ 7 words — assume no context injection needed.
    if (wordCount >= 7) return query;
    return `[Context: ${priorContext}]\n${query}`;
  }

  private resolveVideoTopic(requestedTopic: string, session: any): string | null {
    const cleanedRequested = (requestedTopic || '').trim();
    if (cleanedRequested && !this.isGenericVideoPrompt(cleanedRequested)) {
      return cleanedRequested;
    }

    const contextTopic = (session.currentContext || '').trim();
    if (contextTopic && !this.isGenericVideoPrompt(contextTopic)) {
      return contextTopic;
    }

    const history = Array.isArray(session.conversationHistory)
      ? session.conversationHistory
      : [];

    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      if (!msg || msg.role !== 'user') continue;
      const text = (msg.content || '').trim();
      if (!text) continue;
      if (text.startsWith('!')) continue;
      if (this.parseLanguageChoice(text)) continue;
      if (this.isGenericVideoPrompt(text)) continue;
      if (text.length < 4) continue;
      return text;
    }

    return null;
  }

  /**
   * Extract the concept nucleus from a user message so YouTube search URLs
   * don't look like "what is dfs? please explain kindly tutorial explanation".
   *
   * Strips common question starters and trailing punctuation in English,
   * Hinglish, Hindi and Kannada, then collapses whitespace. Returns '' if
   * nothing meaningful remains.
   */
  private cleanYouTubeTopic(raw: string): string {
    let t = (raw || '').trim();
    if (!t) return '';

    // Drop leading question / command words
    const prefixes = [
      // English
      'what is', 'what are', "what's", 'whats', 'what does', 'what do',
      'how does', 'how do', 'how is', 'how are', 'how to', 'how can',
      'why is', 'why does', 'why do', 'why are',
      'explain to me', 'explain about', 'explain',
      'define', 'describe', 'tell me about', 'tell me',
      'can you explain', 'please explain',
      // Hinglish / Hindi (roman)
      'kya hai', 'kya hota hai', 'kya matlab', 'kaise kaam karta hai',
      'kaise hota hai', 'kaise', 'kyu', 'kyun', 'kyon',
      'samjhao', 'samjha do', 'bata do', 'batao',
      // Hindi (devanagari)
      'क्या है', 'क्या होता है', 'कैसे', 'क्यों', 'समझाओ', 'बताओ',
      // Kannada
      'ಏನು', 'ಹೇಗೆ', 'ಏಕೆ', 'ವಿವರಿಸಿ', 'ಹೇಳಿ',
    ];
    const lower = t.toLowerCase();
    for (const p of prefixes) {
      if (lower.startsWith(p + ' ') || lower === p) {
        t = t.slice(p.length).trim();
        break;
      }
    }

    // Drop trailing punctuation and leading/trailing fillers
    t = t
      .replace(/[?!.।]+$/g, '')
      .replace(/^(please|plz|pls|kindly)\s+/i, '')
      .replace(/\s+(please|plz|pls|kindly)$/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Ignore very short tokens that would produce noise
    return t.length >= 3 ? t : '';
  }

  /**
   * Build YouTube search links in 3 languages. Uses the cleaned topic if
   * provided, otherwise falls back to the session's tracked context topic so
   * a question like "tell me more" still gets relevant links.
   *
   * Returns null when no meaningful topic can be extracted — callers should
   * skip the YouTube ribbon in that case instead of sending a generic
   * "learning explained" search.
   */
  private getYouTubeLinks(raw: string, session?: any): string | null {
    let topic = this.cleanYouTubeTopic(raw);
    if (!topic && session?.currentContext) {
      topic = this.cleanYouTubeTopic(session.currentContext);
    }
    if (!topic) return null;

    const query = encodeURIComponent(`${topic} explained`);
    const queryHindi = encodeURIComponent(`${topic} in hindi`);
    const queryKannada = encodeURIComponent(`${topic} in kannada`);
    return [
      `🔗 https://www.youtube.com/results?search_query=${query}`,
      `🔗 https://www.youtube.com/results?search_query=${queryHindi}`,
      `🔗 https://www.youtube.com/results?search_query=${queryKannada}`,
    ].join('\n');
  }

  /**
   * Wrap the YouTube links ribbon in localized copy. Returns empty string if
   * no topic is available — caller can safely concat or skip.
   */
  private buildYouTubeRibbon(raw: string, session: any): string {
    const yt = this.getYouTubeLinks(raw, session);
    if (!yt) return '';
    return this.localizedMsg(session.language, {
      english: `📺 *Learn more on YouTube:*\n\n${yt}`,
      marathi: `📺 *YouTube वर अधिक शिका:*\n\n${yt}`,
      hindi: `📺 *YouTube पर और सीखें:*\n\n${yt}`,
      kannada: `📺 *YouTube ನಲ್ಲಿ ಇನ್ನಷ್ಟು ಕಲಿಯಿರಿ:*\n\n${yt}`,
    });
  }

  /**
   * Detect if the user explicitly asked for YouTube / yt links. We only
   * attach the YT ribbon when this returns true — otherwise normal answers
   * stay clean and uncluttered.
   */
  private wantsYouTubeLinks(text: string): boolean {
    const t = (text || '').toLowerCase();
    // Word-boundary match so "ytterbium" or "youthful" don't trigger this.
    return /\b(yt|youtube|you\s*tube|yt\s*links?|youtube\s*links?|yt\s*videos?|youtube\s*videos?)\b/i.test(t)
      || /यूट्यूब|यू ट्यूब/.test(t)
      || /ಯೂಟ್ಯೂಬ್/.test(t);
  }

  /**
   * Remove the explicit yt / youtube trigger words so the remainder is a
   * clean topic usable for search. Used when the whole message is basically
   * "yt <topic>" / "youtube links <topic>".
   */
  private stripYouTubeTrigger(text: string): string {
    return (text || '')
      .replace(/\b(yt\s*links?|youtube\s*links?|yt\s*videos?|youtube\s*videos?|youtube|you\s*tube|yt)\b/gi, ' ')
      .replace(/\b(links?|videos?|par|pe|ke|liye|for|on|of|about|me)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * True if an image caption contains a video-trigger keyword. Used by
   * the image+video flow: when the user sends a photo with caption like
   * "video", "video banao", "ವೀಡಿಯೊ ಮಾಡಿ", we OCR the image, send the
   * text answer, AND auto-render a personalized video on the topic.
   * Mirrors the keyword list in MessageRouter so any phrase that would
   * normally trigger a video also works as an image caption.
   */
  private captionTriggersVideo(text: string): boolean {
    const t = (text || '').toLowerCase();
    if (!t) return false;
    const triggers = [
      'video', 'animation', 'banao', 'bana do',
      'वीडियो', 'विडियो',
      'ವೀಡಿಯೊ', 'ವಿಡಿಯೋ',
    ];
    return triggers.some((kw) => t.includes(kw.toLowerCase()));
  }

  private isGenericVideoPrompt(text: string): boolean {
    const normalized = text.toLowerCase().trim();
    const generic = [
      'video',
      'make video',
      'generate video',
      'video banao',
      'banao video',
      'animation',
      // Hindi
      'वीडियो',
      'वीडियो बनाओ',
      'विडियो',
      'वीडियो दिखाओ',
      // Kannada
      'ವೀಡಿಯೊ',
      'ವೀಡಿಯೊ ಮಾಡಿ',
      'ವಿಡಿಯೋ',
      'ವೀಡಿಯೊ ತೋರಿಸಿ',
    ];
    return generic.includes(normalized);
  }

  private async handleVideoGenerationAsync(to: string, topic: string, session: any): Promise<void> {
    try {
      const onProgress = async ({ stage, progress, elapsedSeconds }: {
        stage: string; progress: number; elapsedSeconds: number;
      }) => {
        const mins = Math.max(1, Math.round(elapsedSeconds / 60));
        const stageLabel: Record<string, { english: string; marathi: string; hindi: string; kannada: string }> = {
          generating_script: {
            english: 'Writing the script',
            marathi: 'स्क्रिप्ट लिहित आहे',
            hindi: 'स्क्रिप्ट लिख रहा हूँ',
            kannada: 'ಸ್ಕ್ರಿಪ್ಟ್ ಬರೆಯುತ್ತಿದ್ದೇನೆ',
          },
          narrating: {
            english: 'Recording narration',
            marathi: 'निवेदन रेकॉर्ड करत आहे',
            hindi: 'नैरेशन रिकॉर्ड कर रहा हूँ',
            kannada: 'ನಿರೂಪಣೆ ರೆಕಾರ್ಡ್ ಮಾಡುತ್ತಿದ್ದೇನೆ',
          },
          rendering: {
            english: 'Rendering video',
            marathi: 'व्हिडिओ तयार करत आहे',
            hindi: 'वीडियो रेंडर कर रहा हूँ',
            kannada: 'ವೀಡಿಯೊ ರೆಂಡರ್ ಮಾಡುತ್ತಿದ್ದೇನೆ',
          },
        };
        const label = stageLabel[stage] ?? stageLabel.rendering;
        const text = this.localizedMsg(session.language, {
          english: `⏳ Still working on *${topic}*.\n${label.english} — ${progress}% · ${mins} min elapsed.`,
          marathi: `⏳ *${topic}* वर काम सुरू आहे.\n${label.marathi} — ${progress}% · ${mins} मिनिटे झाली.`,
          hindi: `⏳ *${topic}* पर काम जारी है.\n${label.hindi} — ${progress}% · ${mins} मिनट बीत गए.`,
          kannada: `⏳ *${topic}* ಮೇಲೆ ಕೆಲಸ ನಡೆಯುತ್ತಿದೆ.\n${label.kannada} — ${progress}% · ${mins} ನಿಮಿಷಗಳಾಗಿವೆ.`,
        });
        try {
          await this.mediaHandler.sendText(to, text);
        } catch (err) {
          logger.debug('Progress nudge send failed', { err, to });
        }
      };

      const videoResult = await this.contentGenerator.generateVideo(topic, session, onProgress);
      if (videoResult.success && videoResult.videoUrl) {
        await this.mediaHandler.sendVideo(
          to,
          videoResult.videoUrl,
          this.localizedMsg(session.language, {
            english: `🎬 ${topic} — Your video is ready!`,
            marathi: `🎬 ${topic} — तुमचा व्हिडिओ तयार आहे!`,
            hindi: `🎬 ${topic} — आपका वीडियो तैयार है!`,
            kannada: `🎬 ${topic} — ನಿಮ್ಮ ವೀಡಿಯೊ ಸಿದ್ಧವಾಗಿದೆ!`,
          })
        );

        // YT ribbon is now opt-in — user must explicitly ask with
        // "yt <topic>" / "youtube links <topic>" to get them.
        return;
      }

      await this.sendVideoFailureMessage(to, session, videoResult.errorMessage || 'Video generation failed');
    } catch (err: any) {
      logger.error('Async video generation failed', { error: err?.message, to, topic });
      await this.sendVideoFailureMessage(
        to,
        session,
        err?.message || 'Video generation failed'
      );
    }
  }

  /**
   * Async mindmap flow: call the backend `/api/v1/mindmap/generate` endpoint,
   * send the rendered PNG as a WhatsApp image, then send a YouTube links
   * ribbon for further study.
   */
  private async handleMindmapGenerationAsync(
    to: string,
    topic: string,
    session: any
  ): Promise<void> {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
    try {
      logger.info('Requesting mindmap from backend', { topic, to });

      const axios = (await import('axios')).default;
      const res = await axios.post(
        `${backendUrl}/api/v1/mindmap/generate`,
        { topic, language: session.language || 'english' },
        { timeout: 60_000 }
      );
      const imageUrl: string | undefined = res.data?.image_url;
      if (!imageUrl) throw new Error('No image_url in backend response');

      const caption = this.localizedMsg(session.language, {
        english: `🧠 *Mindmap: ${topic}*\n\nHere's a visual overview. Ask me to *explain* any branch for more detail.`,
        marathi: `🧠 *माइंड मॅप: ${topic}*\n\nदृश्य सारांश येथे आहे. कोणत्याही शाखेचे *explain* विचारा.`,
        hindi: `🧠 *माइंड मैप: ${topic}*\n\nदृश्य अवलोकन यहाँ है। किसी भी शाखा को *explain* करने को कहें।`,
        kannada: `🧠 *ಮೈಂಡ್ ಮ್ಯಾಪ್: ${topic}*\n\nದೃಶ್ಯ ಸಾರಾಂಶ ಇಲ್ಲಿದೆ. ಯಾವುದೇ ಶಾಖೆಯನ್ನು *explain* ಮಾಡಲು ಕೇಳಿ.`,
      });

      await this.mediaHandler.sendImage(to, imageUrl, caption);
    } catch (err: any) {
      logger.error('Mindmap generation failed', { error: err?.message, to, topic });
      await this.mediaHandler.sendText(to, this.localizedMsg(session.language, {
        english: `😔 Could not generate the mindmap for *${topic}*. Please try again in a moment.`,
        marathi: `😔 *${topic}* वर माइंड मॅप तयार होऊ शकला नाही. कृपया थोड्या वेळाने पुन्हा प्रयत्न करा.`,
        hindi: `😔 *${topic}* का माइंड मैप नहीं बन पाया। कुछ देर में फिर कोशिश करें।`,
        kannada: `😔 *${topic}* ಗೆ ಮೈಂಡ್ ಮ್ಯಾಪ್ ರಚಿಸಲು ಆಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಕೆಲವು ಕ್ಷಣಗಳ ನಂತರ ಪ್ರಯತ್ನಿಸಿ.`,
      }));
    }
  }

  // =========================================================================
  // Quiz flow — ask LLM for a 4-option MCQ, send as a WhatsApp Poll, remember
  // the correct answer in the session so we can grade the user's letter reply.
  // =========================================================================

  /**
   * Ask the backend for a quiz on `topic` in the session's language, send the
   * WhatsApp Poll + a brief prompt, and store the answer in session.pendingQuiz.
   */
  private async handleQuizRequest(
    message: Message,
    session: any,
    topic: string,
  ): Promise<void> {
    // Friendly "generating..." ack so the user sees immediate feedback.
    const ack = this.localizedMsg(session.language, {
      english: `📝 Creating a quiz on *${topic}*...`,
      marathi: `📝 *${topic}* वर क्विझ तयार होत आहे...`,
      hindi: `📝 *${topic}* पर क्विज़ बन रहा है...`,
      kannada: `📝 *${topic}* ಕುರಿತು ಕ್ವಿಜ್ ರಚಿಸಲಾಗುತ್ತಿದೆ...`,
    });
    await message.reply(ack);

    // Fetch per-topic question history for this user so the backend LLM can
    // avoid repeating previously asked questions.
    const topicKey = topic.toLowerCase().trim();
    const quizHistory: Record<string, string[]> = session.quizHistory || {};
    const previouslyAsked: string[] = quizHistory[topicKey] || [];

    const quiz = await this.contentGenerator.generateQuiz(topic, session, previouslyAsked);
    if (!quiz) {
      await message.reply(this.localizedMsg(session.language, {
        english: `😔 Could not generate a quiz on *${topic}*. Please try another topic.`,
        marathi: `😔 *${topic}* वर क्विझ तयार होऊ शकला नाही. कृपया दुसरा विषय वापरून पहा.`,
        hindi: `😔 *${topic}* पर क्विज़ नहीं बन पाया। कृपया दूसरा विषय try करें।`,
        kannada: `😔 *${topic}* ಕುರಿತು ಕ್ವಿಜ್ ರಚಿಸಲು ಆಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಬೇರೆ ವಿಷಯವನ್ನು ಪ್ರಯತ್ನಿಸಿ.`,
      }));
      return;
    }

    // WhatsApp polls show options as plain rows — prefix A/B/C/D so the user
    // can reply with just a letter if the poll UI is hidden/forwarded.
    const letters = ['A', 'B', 'C', 'D'];
    const pollOptions = quiz.options.map((o, i) => `${letters[i]}. ${o}`);
    const pollQuestion = `📝 ${quiz.question}`;

    try {
      // whatsapp-web.js .d.ts quirk: messageSecret is declared as a required
      // field (not optional) even though the runtime happily accepts undefined
      // and auto-generates one. We pass it explicitly to satisfy the type.
      const poll = new Poll(pollQuestion, pollOptions, {
        allowMultipleAnswers: false,
        messageSecret: undefined,
      });
      await message.reply(poll);
    } catch (err: any) {
      // Some whatsapp-web.js builds or older WhatsApp clients don't support
      // polls — fall back to a plain numbered text message so the quiz flow
      // still works end-to-end.
      logger.warn('Poll send failed, falling back to text', { error: err?.message });
      const textQuiz = `📝 *Quiz on ${quiz.topic}*\n\n${quiz.question}\n\n` +
        pollOptions.map((o) => `*${o}*`).join('\n') +
        `\n\nReply with *A*, *B*, *C* or *D*.`;
      await message.reply(textQuiz);
    }

    // Hint so the user knows how to submit their answer. We listen to
    // WhatsApp vote_update events, so tapping the poll is enough — no
    // need to also type a letter. The letter-reply path is still kept as
    // a fallback for clients where votes don't sync (forwarded polls,
    // older WhatsApp builds, etc.).
    const hint = this.localizedMsg(session.language, {
      english: '👉 Tap an option in the poll above — I\'ll tell you right away if you\'re right! (You can also reply with *A / B / C / D*.)',
      marathi: '👉 वरच्या पोलमधून एक पर्याय निवडा — तुम्ही बरोबर आहात का ते मी लगेच सांगेन! (किंवा *A / B / C / D* पाठवा.)',
      hindi: '👉 ऊपर के पोल में एक option टैप करें — मैं तुरंत बताऊँगा कि आप सही हैं या नहीं! (या *A / B / C / D* भेजें.)',
      kannada: '👉 ಮೇಲಿನ ಪೋಲ್‌ನಲ್ಲಿ ಒಂದು ಆಯ್ಕೆಯನ್ನು ಟ್ಯಾಪ್ ಮಾಡಿ — ನೀವು ಸರಿ ಇದ್ದೀರಾ ಎಂದು ನಾನು ತಕ್ಷಣ ಹೇಳುತ್ತೇನೆ! (ಅಥವಾ *A / B / C / D* ಕಳುಹಿಸಿ.)',
    });
    await message.reply(hint);

    // Persist the pending quiz on the session so a later letter reply can be
    // graded locally without another LLM round-trip.
    const pending: PendingQuiz = {
      question: quiz.question,
      options: quiz.options,
      correctIndex: quiz.correctIndex,
      correctLetter: quiz.correctLetter,
      explanation: quiz.explanation,
      topic: quiz.topic,
      askedAt: Date.now(),
    };
    session.pendingQuiz = pending;

    // Record question in per-topic history (cap at 20 per topic to bound
    // Redis size). Next time the user requests a quiz on the same topic the
    // backend LLM will be told to avoid all these questions.
    const updatedHistory = { ...(session.quizHistory || {}) };
    const prevList = updatedHistory[topicKey] || [];
    updatedHistory[topicKey] = [...prevList, quiz.question].slice(-20);
    session.quizHistory = updatedHistory;

    await this.sessionStore.updateSession(session);
  }

  /**
   * Try to parse the user's raw message as a quiz answer.
   * Returns 0..3 for a valid answer or null if the message doesn't look like
   * an answer (A/B/C/D, 1/2/3/4, or the exact option text).
   */
  private parseQuizAnswer(raw: string): number | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    // Single-letter answer — allow trailing punctuation like "B." or "B!".
    const letter = trimmed.match(/^([A-Da-d])\b[\s\.\)\!]*$/);
    if (letter) return letter[1].toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0);
    // Single-digit answer 1-4 (with optional trailing punctuation).
    const digit = trimmed.match(/^([1-4])\b[\s\.\)\!]*$/);
    if (digit) return Number(digit[1]) - 1;
    // "Option B" / "answer: c" / "mera answer B hai" style (lenient).
    const labelled = trimmed.match(/\b(?:option|answer|ans|jawab|उत्तर|ಉತ್ತರ)\s*[:\-]?\s*([A-Da-d1-4])\b/i);
    if (labelled) {
      const ch = labelled[1].toUpperCase();
      if (ch >= 'A' && ch <= 'D') return ch.charCodeAt(0) - 'A'.charCodeAt(0);
      return Number(ch) - 1;
    }
    return null;
  }

  /**
   * Build the localized right/wrong + explanation reply for a quiz answer.
   * Shared by the text-reply path (user types "B") and the poll-vote path
   * (user taps an option in the WhatsApp poll).
   */
  private buildQuizGradingReply(
    q: PendingQuiz,
    session: any,
    pickedIndex: number,
  ): { body: string; isCorrect: boolean } {
    const letters = ['A', 'B', 'C', 'D'];
    const pickedLetter = letters[pickedIndex] ?? '?';
    const correctOption = q.options[q.correctIndex] ?? '';
    const isCorrect = pickedIndex === q.correctIndex;

    const body = isCorrect
      ? this.localizedMsg(session.language, {
          english: `✅ *Correct!* ${pickedLetter} — ${correctOption}\n\n_${q.explanation}_\n\nType *quiz ${q.topic}* for another one, or ask me anything else!`,
          marathi: `✅ *बरोबर!* ${pickedLetter} — ${correctOption}\n\n_${q.explanation}_\n\nदुसरा प्रश्न हवा? *quiz ${q.topic}* पाठवा.`,
          hindi: `✅ *सही!* ${pickedLetter} — ${correctOption}\n\n_${q.explanation}_\n\nएक और? *quiz ${q.topic}* भेजें।`,
          kannada: `✅ *ಸರಿ!* ${pickedLetter} — ${correctOption}\n\n_${q.explanation}_\n\nಇನ್ನೊಂದು ಬೇಕಾ? *quiz ${q.topic}* ಕಳುಹಿಸಿ.`,
        })
      : this.localizedMsg(session.language, {
          english: `❌ *Not quite.* You picked *${pickedLetter}*.\n\n✅ Correct answer: *${q.correctLetter}* — ${correctOption}\n\n_${q.explanation}_\n\nTry another: *quiz ${q.topic}*`,
          marathi: `❌ *चुकले.* तुम्ही *${pickedLetter}* निवडले.\n\n✅ योग्य उत्तर: *${q.correctLetter}* — ${correctOption}\n\n_${q.explanation}_\n\nपुन्हा प्रयत्न: *quiz ${q.topic}*`,
          hindi: `❌ *गलत.* आपने *${pickedLetter}* चुना।\n\n✅ सही उत्तर: *${q.correctLetter}* — ${correctOption}\n\n_${q.explanation}_\n\nफिर से: *quiz ${q.topic}*`,
          kannada: `❌ *ತಪ್ಪು.* ನೀವು *${pickedLetter}* ಆಯ್ಕೆ ಮಾಡಿದಿರಿ.\n\n✅ ಸರಿಯಾದ ಉತ್ತರ: *${q.correctLetter}* — ${correctOption}\n\n_${q.explanation}_\n\nಮತ್ತೊಮ್ಮೆ: *quiz ${q.topic}*`,
        });

    return { body, isCorrect };
  }

  /**
   * Compare the user's typed answer against session.pendingQuiz, reply with
   * the localized right/wrong message, and clear the pending quiz so normal
   * routing resumes.
   */
  private async gradeQuizAnswer(
    message: Message,
    session: any,
    pickedIndex: number,
  ): Promise<void> {
    const q = session.pendingQuiz as PendingQuiz | undefined;
    if (!q) return;

    const { body } = this.buildQuizGradingReply(q, session, pickedIndex);
    await message.reply(body);

    // Clear the pending quiz so the user can go back to asking normal
    // questions without every "B" being treated as a quiz answer.
    session.pendingQuiz = undefined;
    await this.sessionStore.updateSession(session);
  }

  /**
   * Handle a WhatsApp poll vote. Fired by `client.on('vote_update', ...)`
   * when the user taps an option on a poll we sent. Looks up the session,
   * matches the selected option to the pending quiz, and replies inline
   * with the right/wrong feedback — so the user gets instant grading the
   * moment they tap, without also having to type A/B/C/D.
   *
   * Safe no-op if:
   *   - there is no pendingQuiz on the session (poll expired / already graded)
   *   - the user deselected all options (selectedOptions is empty)
   *   - the vote is on a poll we don't recognise (shouldn't normally happen)
   */
  async handlePollVote(vote: PollVote): Promise<void> {
    try {
      const voterId = vote.voter;
      if (!voterId) return;

      // A vote_update fires for every selection change — including
      // deselections. Only act on an actual selection.
      const selected = vote.selectedOptions || [];
      if (selected.length === 0) return;

      const session = await this.sessionStore.getSession(voterId);
      if (!session) {
        logger.debug('Poll vote for unknown session', { voterId });
        return;
      }

      const q = session.pendingQuiz;
      if (!q) {
        logger.debug('Poll vote but no pending quiz', { voterId });
        return;
      }

      // Poll options were sent as "A. ...", "B. ...", "C. ...", "D. ...".
      // Prefer the numeric `id` (0..3) from the SelectedPollOption. Fall
      // back to parsing the leading letter from `name` if id is missing
      // (defensive; id is usually present).
      let pickedIndex = typeof selected[0].id === 'number' ? selected[0].id : -1;
      if (pickedIndex < 0 || pickedIndex > 3) {
        const m = /^([A-D])\./i.exec(selected[0].name || '');
        if (m) pickedIndex = m[1].toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0);
      }
      if (pickedIndex < 0 || pickedIndex > 3) {
        logger.warn('Could not determine poll option index', { selected: selected[0] });
        return;
      }

      const { body } = this.buildQuizGradingReply(q, session, pickedIndex);

      // Reply by quoting the original poll message so the grading reply
      // visually threads off the poll in the chat — nicer UX than a bare
      // sendMessage that floats below.
      try {
        await vote.parentMessage.reply(body);
      } catch (err) {
        // Fallback: send as plain message to the voter's chat.
        logger.debug('parentMessage.reply failed, falling back to sendText', { err });
        await this.mediaHandler.sendText(voterId, body);
      }

      session.pendingQuiz = undefined;
      await this.sessionStore.updateSession(session);
    } catch (err: any) {
      logger.error('handlePollVote failed', { error: err?.message });
    }
  }

  /**
   * Download a WhatsApp voice note / audio message, transcribe it via Sarvam
   * STT, echo the transcript back to the user so they can confirm what we
   * heard, and return the transcript so the caller can treat it like typed
   * input.
   *
   * Returns null on any failure (download, STT, empty transcript) — the user
   * will already have received a localized error message, so the caller
   * should simply stop processing.
   */
  private async handleVoiceNote(
    message: Message,
    session: any,
  ): Promise<string | null> {
    if (!this.speechToText.isEnabled()) {
      await message.reply(this.localizedMsg(session.language, {
        english: '⚠️ Voice notes are not enabled on this bot. Please send a text message instead.',
        marathi: '⚠️ या बॉटवर व्हॉइस नोट्स सक्षम केलेले नाहीत. कृपया मजकूर संदेश पाठवा.',
        hindi: '⚠️ इस बॉट पर वॉइस नोट्स सक्षम नहीं हैं। कृपया टेक्स्ट मैसेज भेजें।',
        kannada: '⚠️ ಈ ಬಾಟ್‌ನಲ್ಲಿ ಧ್ವನಿ ಟಿಪ್ಪಣಿಗಳನ್ನು ಸಕ್ರಿಯಗೊಳಿಸಲಾಗಿಲ್ಲ. ದಯವಿಟ್ಟು ಪಠ್ಯ ಸಂದೇಶವನ್ನು ಕಳುಹಿಸಿ.',
      }));
      return null;
    }

    try {
      await message.reply(this.localizedMsg(session.language, {
        english: '🎙️ Listening to your voice note...',
        marathi: '🎙️ तुमचं व्हॉइस नोट ऐकत आहे...',
        hindi: '🎙️ आपका वॉइस नोट सुन रहा हूँ...',
        kannada: '🎙️ ನಿಮ್ಮ ಧ್ವನಿ ಸಂದೇಶವನ್ನು ಕೇಳುತ್ತಿದ್ದೇನೆ...',
      }));

      const media = await message.downloadMedia();
      if (!media || !media.data) {
        await message.reply(this.localizedMsg(session.language, {
          english: '⚠️ Could not download the voice note. Please send again.',
          marathi: '⚠️ व्हॉइस नोट डाउनलोड होऊ शकला नाही. कृपया पुन्हा पाठवा.',
          hindi: '⚠️ वॉइस नोट डाउनलोड नहीं हो पाया। कृपया दोबारा भेजें।',
          kannada: '⚠️ ಧ್ವನಿ ಟಿಪ್ಪಣಿಯನ್ನು ಡೌನ್‌ಲೋಡ್ ಮಾಡಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಕಳುಹಿಸಿ.',
        }));
        return null;
      }

      const buf = Buffer.from(media.data, 'base64');
      const transcript = await this.speechToText.transcribe(
        buf,
        media.mimetype || 'audio/ogg; codecs=opus',
        session.language,
      );

      if (!transcript) {
        await message.reply(this.localizedMsg(session.language, {
          english: '⚠️ Could not understand the audio. Please try again or send a text message.',
          marathi: '⚠️ ऑडिओ समजू शकलो नाही. कृपया पुन्हा प्रयत्न करा किंवा मजकूर पाठवा.',
          hindi: '⚠️ ऑडियो समझ नहीं आया। कृपया फिर कोशिश करें या टेक्स्ट भेजें।',
          kannada: '⚠️ ಆಡಿಯೋ ಅರ್ಥವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ ಅಥವಾ ಪಠ್ಯ ಕಳುಹಿಸಿ.',
        }));
        return null;
      }

      logger.info('Voice note transcribed', {
        from: message.from,
        language: session.language,
        transcript,
      });

      // Echo the transcript so the user sees what we heard — useful both as
      // user feedback and for debugging STT mistakes.
      await message.reply(`💬 "${transcript}"`);

      return transcript;
    } catch (err: any) {
      logger.error('Voice note transcription failed', {
        error: err?.message,
        from: message.from,
      });
      await message.reply(this.localizedMsg(session.language, {
        english: '⚠️ Audio transcription failed. Please try again.',
        marathi: '⚠️ ऑडिओ प्रक्रिया अयशस्वी झाली. कृपया पुन्हा प्रयत्न करा.',
        hindi: '⚠️ ऑडियो प्रोसेस नहीं हो पाया। कृपया फिर कोशिश करें।',
        kannada: '⚠️ ಆಡಿಯೋ ಪ್ರಕ್ರಿಯೆ ವಿಫಲವಾಗಿದೆ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
      }));
      return null;
    }
  }

  private async sendVideoFailureMessage(to: string, session: any, errorMessage: string): Promise<void> {
    const formatted = this.responseFormatter.formatError(new Error(errorMessage));
    const timeoutLike = /timeout/i.test(errorMessage);

    const localized = timeoutLike
      ? this.localizedMsg(session.language, {
          english: '⏱️ Video is taking longer than usual, but generation is still running. Please try the same topic again after a few minutes if it has not arrived yet.',
          marathi: '⏱️ व्हिडिओला सामान्यपेक्षा जास्त वेळ लागत आहे, पण प्रक्रिया अजून चालू आहे. काही मिनिटांत व्हिडिओ आला नाही तर तोच विषय पुन्हा पाठवा.',
          hindi: '⏱️ वीडियो बनने में सामान्य से अधिक समय लग रहा है, लेकिन प्रक्रिया अभी चल रही है। अगर कुछ मिनट में वीडियो न आए तो वही विषय फिर भेजें।',
          kannada: '⏱️ ವೀಡಿಯೊ ರಚನೆಗೆ ಸಾಮಾನ್ಯಕ್ಕಿಂತ ಹೆಚ್ಚು ಸಮಯ ಬೇಕಾಗಿದೆ, ಆದರೆ ಪ್ರಕ್ರಿಯೆ ಇನ್ನೂ ನಡೆಯುತ್ತಿದೆ. ಕೆಲವು ನಿಮಿಷಗಳಲ್ಲಿ ಬರದಿದ್ದರೆ ಅದೇ ವಿಷಯವನ್ನು ಮತ್ತೆ ಕಳುಹಿಸಿ.',
        })
      : formatted;

    await this.mediaHandler.sendText(to, localized);
  }
}
