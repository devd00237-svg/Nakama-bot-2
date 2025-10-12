/**
 * NakamaBot - Commande /chat UNIFIÉE avec Gemini + Mistral
 * + Détection commandes 100% IA (Gemini ET Mistral)
 * + Recherche contextuelle (Gemini ET Mistral) avec intégration Google Search du serveur
 * + Support Markdown vers Unicode
 * + Optimisation: skip Gemini si toutes les clés sont mortes
 * + Exécution parfaite des commandes détectées (/image, /vision, etc.)
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Message de conversation
 * @param {object} ctx - Contexte partagé du bot 
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");
const cheerio = require("cheerio");

// ========================================
// 🔑 CONFIGURATION APIs
// ========================================

const GEMINI_API_KEYS = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.split(',').map(key => key.trim()) : [];
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || "";

// 🆕 RECHERCHE INTÉGRÉE AVEC SERVEUR (utilise webSearch du serveur si disponible)
const SEARCH_CONFIG = {
    duckduckgo: {
        enabled: true,
        baseUrl: 'https://html.duckduckgo.com/html/',
        timeout: 8000,
        maxResults: 5
    },
    wikipedia: {
        enabled: true,
        baseUrl: 'https://fr.wikipedia.org/api/rest_v1',
        timeout: 6000,
        maxResults: 3
    },
    webScraping: {
        enabled: true,
        timeout: 10000,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
};

const SEARCH_RETRY_DELAY = 2000;
const SEARCH_GLOBAL_COOLDOWN = 3000;

// État global
let currentGeminiKeyIndex = 0;
const failedKeys = new Set();
const activeRequests = new Map();
const recentMessages = new Map();
const searchCache = new Map();
const CACHE_TTL = 3600000; // 1 heure

// 🆕 CACHE DE CONTEXTE CONVERSATIONNEL
const conversationContext = new Map();

// 🆕 ÉTAT GEMINI: si toutes les clés sont mortes, on skip Gemini
let allGeminiKeysDead = false;
let lastGeminiCheck = 0;
const GEMINI_RECHECK_INTERVAL = 300000; // 5 minutes

// ========================================
// 🎨 FONCTIONS MARKDOWN → UNICODE
// ========================================

const UNICODE_MAPPINGS = {
    bold: {
        'a': '𝗮', 'b': '𝗯', 'c': '𝗰', 'd': '𝗱', 'e': '𝗲', 'f': '𝗳', 'g': '𝗴', 'h': '𝗵', 'i': '𝗶', 'j': '𝗷', 'k': '𝗸', 'l': '𝗹', 'm': '𝗺',
        'n': '𝗻', 'o': '𝗼', 'p': '𝗽', 'q': '𝗾', 'r': '𝗿', 's': '𝘀', 't': '𝘁', 'u': '𝘂', 'v': '𝘃', 'w': '𝘄', 'x': '𝘅', 'y': '𝘆', 'z': '𝘇',
        'A': '𝗔', 'B': '𝗕', 'C': '𝗖', 'D': '𝗗', 'E': '𝗘', 'F': '𝗙', 'G': '𝗚', 'H': '𝗛', 'I': '𝗜', 'J': '𝗝', 'K': '𝗞', 'L': '𝗟', 'M': '𝗠',
        'N': '𝗡', 'O': '𝗢', 'P': '𝗣', 'Q': '𝗤', 'R': '𝗥', 'S': '𝗦', 'T': '𝗧', 'U': '𝗨', 'V': '𝗩', 'W': '𝗪', 'X': '𝗫', 'Y': '𝗬', 'Z': '𝗭',
        '0': '𝟬', '1': '𝟭', '2': '𝟮', '3': '𝟯', '4': '𝟰', '5': '𝟱', '6': '𝟲', '7': '𝟳', '8': '𝟴', '9': '𝟵'
    }
};

function toBold(str) {
    return str.split('').map(char => UNICODE_MAPPINGS.bold[char] || char).join('');
}

function toUnderline(str) {
    return str.split('').map(char => char + '\u0332').join('');
}

function toStrikethrough(str) {
    return str.split('').map(char => char + '\u0336').join('');
}

function parseMarkdown(text) {
    if (!text || typeof text !== 'string') return text;
    
    let parsed = text;
    parsed = parsed.replace(/^###\s+(.+)$/gm, (match, title) => `🔹 ${toBold(title.trim())}`);
    parsed = parsed.replace(/\*\*([^*]+)\*\*/g, (match, content) => toBold(content));
    parsed = parsed.replace(/__([^_]+)__/g, (match, content) => toUnderline(content));
    parsed = parsed.replace(/~~([^~]+)~~/g, (match, content) => toStrikethrough(content));
    parsed = parsed.replace(/^[\s]*[-*]\s+(.+)$/gm, (match, content) => `• ${content.trim()}`);
    
    return parsed;
}

// ========================================
// 🔑 GESTION ROTATION CLÉS GEMINI
// ========================================

function checkIfAllGeminiKeysDead() {
    if (GEMINI_API_KEYS.length === 0) {
        allGeminiKeysDead = true;
        return true;
    }
    
    const now = Date.now();
    
    // Recheck toutes les 5 minutes
    if (allGeminiKeysDead && (now - lastGeminiCheck > GEMINI_RECHECK_INTERVAL)) {
        allGeminiKeysDead = false;
        failedKeys.clear();
        currentGeminiKeyIndex = 0;
        lastGeminiCheck = now;
        return false;
    }
    
    if (failedKeys.size >= GEMINI_API_KEYS.length) {
        allGeminiKeysDead = true;
        lastGeminiCheck = now;
        return true;
    }
    
    return false;
}

function getNextGeminiKey() {
    if (GEMINI_API_KEYS.length === 0) {
        throw new Error('Aucune clé Gemini configurée');
    }
    
    if (checkIfAllGeminiKeysDead()) {
        throw new Error('Toutes les clés Gemini sont mortes');
    }
    
    let attempts = 0;
    while (attempts < GEMINI_API_KEYS.length) {
        const key = GEMINI_API_KEYS[currentGeminiKeyIndex];
        currentGeminiKeyIndex = (currentGeminiKeyIndex + 1) % GEMINI_API_KEYS.length;
        
        if (!failedKeys.has(key)) return key;
        attempts++;
    }
    
    throw new Error('Aucune clé Gemini disponible');
}

function markKeyAsFailed(apiKey) {
    failedKeys.add(apiKey);
    checkIfAllGeminiKeysDead();
}

async function callGeminiWithRotation(prompt, maxRetries = GEMINI_API_KEYS.length) {
    if (checkIfAllGeminiKeysDead()) {
        throw new Error('Toutes les clés Gemini sont inutilisables - Utilisation de Mistral');
    }
    
    let lastError = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const apiKey = getNextGeminiKey();
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // Mise à jour vers un modèle plus récent/stable
            
            const result = await model.generateContent(prompt);
            const response = result.response.text();
            
            if (response && response.trim()) {
                failedKeys.delete(apiKey);
                return response;
            }
            
            throw new Error('Réponse Gemini vide');
            
        } catch (error) {
            lastError = error;
            
            if (error.message.includes('API_KEY') || error.message.includes('quota') || error.message.includes('limit')) {
                const currentKey = GEMINI_API_KEYS[(currentGeminiKeyIndex - 1 + GEMINI_API_KEYS.length) % GEMINI_API_KEYS.length];
                markKeyAsFailed(currentKey);
            }
            
            if (attempt === maxRetries - 1) throw lastError;
        }
    }
    
    throw lastError || new Error('Toutes les clés Gemini ont échoué');
}

// ========================================
// 🆕 APPEL MISTRAL UNIFIÉ
// ========================================

async function callMistralUnified(prompt, ctx, maxTokens = 2000) {
    const { callMistralAPI, log } = ctx;
    
    if (!MISTRAL_API_KEY) {
        throw new Error('Clé Mistral non configurée');
    }
    
    try {
        const messages = [
            {
                role: "system",
                content: "Tu es NakamaBot, une IA conversationnelle avancée. Tu réponds en JSON structuré ou en texte selon le contexte."
            },
            {
                role: "user",
                content: prompt
            }
        ];
        
        const response = await callMistralAPI(messages, maxTokens, 0.7);
        
        if (!response) {
            throw new Error('Réponse Mistral vide');
        }
        
        log.info(`🔄 Mistral utilisé avec succès`);
        return response;
        
    } catch (error) {
        log.error(`❌ Erreur Mistral: ${error.message}`);
        throw error;
    }
}

// ========================================
// 🆕 RECHERCHE GRATUITE - INTÉGRATION GOOGLE SEARCH DU SERVEUR
// ========================================

async function performIntelligentSearch(query, ctx) {
    const { log, webSearch } = ctx; // Intégration du webSearch du serveur
    
    try {
        // Priorité au Google Search du serveur si disponible
        if (typeof webSearch === 'function') {
            log.info(`🔍 Recherche via Google Search serveur pour: "${query}"`);
            const googleResults = await webSearch(query);
            
            if (googleResults && typeof googleResults === 'string' && googleResults.includes('🔍')) {
                // Parser les résultats du serveur en array d'objets
                const results = googleResults.split('\n\n').slice(1).map(block => {
                    const lines = block.split('\n');
                    return {
                        title: lines[0]?.replace(/^\d+\.\s*\*\*/, '').replace(/\*\*$/, '').trim() || '',
                        description: lines[1]?.trim() || '',
                        link: lines[2]?.replace(/^🔗\s*/, '').trim() || '',
                        source: 'google'
                    };
                }).filter(r => r.title);
                
                if (results.length > 0) return results;
            }
        }
        
        // Fallback aux recherches locales
        log.info(`🔄 Fallback recherche locale pour: "${query}"`);
        
        if (SEARCH_CONFIG.duckduckgo.enabled) {
            const ddgResults = await searchDuckDuckGo(query, log);
            if (ddgResults.length > 0) return ddgResults;
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
        if (SEARCH_CONFIG.wikipedia.enabled) {
            const wikiResults = await searchWikipedia(query, log);
            if (wikiResults.length > 0) return wikiResults;
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
        if (SEARCH_CONFIG.webScraping.enabled) {
            const scrapeResults = await searchWebScraping(query, log);
            if (scrapeResults.length > 0) return scrapeResults;
        }
        
        log.warning(`⚠️ Aucun résultat trouvé pour: ${query}`);
        return [];
        
    } catch (error) {
        log.error(`❌ Erreur recherche combinée: ${error.message}`);
        return [];
    }
}

// Fonctions de recherche locales (inchangées, mais optimisées pour performance)
async function searchDuckDuckGo(query, log) {
    const cacheKey = `ddg_${query.toLowerCase()}`;
    const cached = searchCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
        log.info(`💾 Cache DuckDuckGo hit pour: ${query}`);
        return cached.results;
    }
    
    try {
        const response = await axios.post(
            SEARCH_CONFIG.duckduckgo.baseUrl,
            `q=${encodeURIComponent(query)}&kl=fr-fr`,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': SEARCH_CONFIG.webScraping.userAgent
                },
                timeout: SEARCH_CONFIG.duckduckgo.timeout
            }
        );
        
        const $ = cheerio.load(response.data);
        const results = [];
        
        $('.result').slice(0, SEARCH_CONFIG.duckduckgo.maxResults).each((i, elem) => {
            const title = $(elem).find('.result__title').text().trim();
            const snippet = $(elem).find('.result__snippet').text().trim();
            const link = $(elem).find('.result__url').attr('href') || '';
            
            if (title && snippet) {
                results.push({ title, description: snippet, link, source: 'duckduckgo' });
            }
        });
        
        if (results.length > 0) {
            searchCache.set(cacheKey, { results, timestamp: Date.now() });
            return results;
        }
        
        return [];
        
    } catch (error) {
        log.warning(`⚠️ DuckDuckGo échec: ${error.message}`);
        return [];
    }
}

async function searchWikipedia(query, log) {
    const cacheKey = `wiki_${query.toLowerCase()}`;
    const cached = searchCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
        log.info(`💾 Cache Wikipedia hit pour: ${query}`);
        return cached.results;
    }
    
    try {
        const searchUrl = `${SEARCH_CONFIG.wikipedia.baseUrl}/page/search/${encodeURIComponent(query)}`;
        const searchResponse = await axios.get(searchUrl, {
            params: { limit: SEARCH_CONFIG.wikipedia.maxResults },
            timeout: SEARCH_CONFIG.wikipedia.timeout
        });
        
        if (!searchResponse.data.pages || searchResponse.data.pages.length === 0) return [];
        
        const results = [];
        for (const page of searchResponse.data.pages.slice(0, SEARCH_CONFIG.wikipedia.maxResults)) {
            const summaryUrl = `${SEARCH_CONFIG.wikipedia.baseUrl}/page/summary/${encodeURIComponent(page.title)}`;
            const summaryResponse = await axios.get(summaryUrl, { timeout: SEARCH_CONFIG.wikipedia.timeout });
            const summary = summaryResponse.data;
            results.push({
                title: summary.title,
                description: summary.extract,
                link: summary.content_urls?.desktop?.page || 'https://fr.wikipedia.org',
                source: 'wikipedia'
            });
        }
        
        if (results.length > 0) {
            searchCache.set(cacheKey, { results, timestamp: Date.now() });
            return results;
        }
        
        return [];
        
    } catch (error) {
        log.warning(`⚠️ Wikipedia échec: ${error.message}`);
        return [];
    }
}

async function searchWebScraping(query, log) {
    const cacheKey = `scrape_${query.toLowerCase()}`;
    const cached = searchCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL / 2)) {
        log.info(`💾 Cache Scraping hit pour: ${query}`);
        return cached.results;
    }
    
    try {
        const sources = [
            `https://news.google.com/search?q=${encodeURIComponent(query)}&hl=fr&gl=FR&ceid=FR:fr`,
            `https://search.yahoo.com/search?p=${encodeURIComponent(query)}&fr=yfp-t`
        ];
        
        const results = [];
        
        for (const url of sources) {
            const response = await axios.get(url, {
                headers: { 'User-Agent': SEARCH_CONFIG.webScraping.userAgent },
                timeout: SEARCH_CONFIG.webScraping.timeout
            });
            
            const $ = cheerio.load(response.data);
            
            if (url.includes('news.google.com')) {
                $('article').slice(0, 3).each((i, elem) => {
                    const title = $(elem).find('a').first().text().trim();
                    const snippet = $(elem).find('p').text().trim();
                    if (title && snippet) {
                        results.push({ title, description: snippet, link: 'https://news.google.com', source: 'google_news' });
                    }
                });
            }
            
            if (url.includes('yahoo.com')) {
                $('.dd.algo').slice(0, 2).each((i, elem) => {
                    const title = $(elem).find('h3').text().trim();
                    const snippet = $(elem).find('.compText').text().trim();
                    if (title && snippet) {
                        results.push({ title, description: snippet, link: 'N/A', source: 'yahoo' });
                    }
                });
            }
            
            if (results.length >= 3) break;
        }
        
        if (results.length > 0) {
            searchCache.set(cacheKey, { results, timestamp: Date.now() });
            return results;
        }
        
        return [];
        
    } catch (error) {
        log.warning(`⚠️ Web Scraping échec: ${error.message}`);
        return [];
    }
}

// ========================================
// 🧠 ANALYSE CONTEXTUELLE - GEMINI OU MISTRAL
// ========================================

async function analyzeConversationContext(senderId, currentMessage, conversationHistory, ctx) {
    const { log } = ctx;
    
    try {
        const recentHistory = conversationHistory.slice(-5).map(msg => 
            `${msg.role === 'user' ? 'Utilisateur' : 'Bot'}: ${msg.content}`
        ).join('\n');
        
        const contextPrompt = `Analyse le contexte conversationnel.

HISTORIQUE:
${recentHistory}

MESSAGE: "${currentMessage}"

Extraire:
- Sujet principal
- Entités clés
- Intention (nouvelle_question, continuation, clarification, changement_sujet)
- Référence contextuelle

Répondre en JSON:
{
  "mainTopic": "sujet",
  "entities": ["ent1", "ent2"],
  "intent": "intention",
  "contextualReference": "ref ou null",
  "enrichedQuery": "requête enrichie"
}`;

        let response = await tryGeminiFirst(contextPrompt, ctx, log, 'Analyse contexte');
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        
        if (jsonMatch) {
            const context = JSON.parse(jsonMatch[0]);
            conversationContext.set(senderId, { ...context, timestamp: Date.now() });
            return context;
        }
        
        throw new Error('Format JSON invalide');
        
    } catch (error) {
        log.warning(`⚠️ Erreur analyse contexte: ${error.message}`);
        return {
            mainTopic: currentMessage,
            entities: [],
            intent: 'nouvelle_question',
            contextualReference: null,
            enrichedQuery: currentMessage
        };
    }
}

// 🆕 FONCTION UTILITAIRE: Essayer Gemini d'abord, fallback Mistral
async function tryGeminiFirst(prompt, ctx, log, label = '') {
    if (!checkIfAllGeminiKeysDead()) {
        try {
            const response = await callGeminiWithRotation(prompt);
            log.info(`💎 ${label} via Gemini`);
            return response;
        } catch (error) {
            log.warning(`⚠️ Gemini échec ${label}: ${error.message}`);
        }
    }
    
    const response = await callMistralUnified(prompt, ctx, 500);
    log.info(`🔄 ${label} via Mistral`);
    return response;
}

// ========================================
// 🤖 DÉCISION IA RECHERCHE - GEMINI OU MISTRAL
// ========================================

async function decideSearchNecessity(userMessage, senderId, conversationHistory, ctx) {
    const { log } = ctx;
    
    try {
        const contextAnalysis = await analyzeConversationContext(senderId, userMessage, conversationHistory, ctx);
        
        const recentHistory = conversationHistory.slice(-5).map(msg => 
            `${msg.role === 'user' ? 'Utilisateur' : 'Bot'}: ${msg.content}`
        ).join('\n');
        
        const decisionPrompt = `Décision recherche web.

HISTORIQUE:
${recentHistory}

MESSAGE: "${userMessage}"

CONTEXTE:
- Sujet: ${contextAnalysis.mainTopic}
- Entités: ${contextAnalysis.entities.join(', ')}
- Intention: ${contextAnalysis.intent}
- Référence: ${contextAnalysis.contextualReference || 'aucune'}

Règles:
- Recherche si actualités, faits récents, stats, météo, sports
- Pas si conversation générale, conseils, créativité

Enrichir requête si continuation.
Ajouter 2025 si sensible au temps.

JSON:
{
  "needsExternalSearch": true/false,
  "confidence": 0.0-1.0,
  "reason": "explication",
  "searchQuery": "requête",
  "usesConversationMemory": true/false
}`;

        let response = await tryGeminiFirst(decisionPrompt, ctx, log, 'Décision recherche');
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        
        if (jsonMatch) {
            const decision = JSON.parse(jsonMatch[0]);
            log.info(`🤖 Recherche: ${decision.needsExternalSearch ? 'OUI' : 'NON'} (${decision.confidence}) - ${decision.reason}`);
            return decision;
        }
        
        throw new Error('Format invalide');
        
    } catch (error) {
        log.warning(`⚠️ Erreur décision recherche: ${error.message}`);
        return {
            needsExternalSearch: false,
            confidence: 0.5,
            reason: 'fallback',
            searchQuery: userMessage,
            usesConversationMemory: false
        };
    }
}

// ========================================
// 🎯 DÉTECTION COMMANDES - GEMINI OU MISTRAL (OPTIMISÉE)
// ========================================

const VALID_COMMANDS = [
    'image', 'vision', 'anime', 'music', 
    'clan', 'rank', 'contact', 'weather'
];

async function detectIntelligentCommands(message, conversationHistory, ctx) {
    const { log } = ctx;
    
    try {
        const commandsList = VALID_COMMANDS.map(cmd => `/${cmd}`).join(', ');
        
        const recentHistory = conversationHistory.slice(-3).map(msg => 
            `${msg.role === 'user' ? 'Utilisateur' : 'Bot'}: ${msg.content}`
        ).join('\n');
        
        const detectionPrompt = `Détection commande intelligente.

COMMANDES: ${commandsList}

HISTORIQUE:
${recentHistory}

MESSAGE: "${message}"

Règles strictes:
- Confidence >= 0.85
- Demande d'action claire
- Pas /help (intégré)
- Vraies intentions seulement (ex: "génère image" = /image)

JSON:
{
  "isCommand": true/false,
  "command": "nom ou null",
  "confidence": 0.0-1.0,
  "extractedArgs": "args",
  "reason": "explication",
  "conversationContext": "analyse"
}`;

        let response = await tryGeminiFirst(detectionPrompt, ctx, log, 'Détection commande');
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        
        if (jsonMatch) {
            const detection = JSON.parse(jsonMatch[0]);
            const isValid = detection.isCommand && VALID_COMMANDS.includes(detection.command) && detection.confidence >= 0.85;
            
            if (isValid) {
                log.info(`🎯 Commande: /${detection.command} (${detection.confidence}) - ${detection.reason}`);
                return { shouldExecute: true, command: detection.command, args: detection.extractedArgs || message };
            }
        }
        
        return { shouldExecute: false };
        
    } catch (error) {
        log.warning(`⚠️ Erreur détection commande: ${error.message}`);
        return { shouldExecute: false };
    }
}

// ========================================
// ✉️ DÉTECTION CONTACT ADMIN (INCHANGÉE)
// ========================================

function detectContactAdminIntention(message) {
    const lowerMessage = message.toLowerCase();
    
    const patterns = [
        { patterns: [/(?:contacter|parler).*?(?:admin|durand)/i], reason: 'contact_direct' },
        { patterns: [/(?:problème|bug|erreur).*?grave/i], reason: 'probleme_technique' },
        { patterns: [/(?:signaler|reporter)/i], reason: 'signalement' },
        { patterns: [/(?:suggestion|propose|idée)/i], reason: 'suggestion' },
        { patterns: [/(?:qui a créé|créateur)/i], reason: 'question_creation' },
        { patterns: [/(?:plainte|réclamation)/i], reason: 'plainte' }
    ];
    
    for (const category of patterns) {
        for (const pattern of category.patterns) {
            if (pattern.test(message)) {
                if (category.reason === 'question_creation') return { shouldContact: false };
                return { shouldContact: true, reason: category.reason, extractedMessage: message };
            }
        }
    }
    
    return { shouldContact: false };
}

function generateContactSuggestion(reason, extractedMessage) {
    const reasonMessages = {
        'contact_direct': { title: "💌 **Contact Admin**", message: "Tu veux contacter les administrateurs !" },
        'probleme_technique': { title: "🔧 **Problème Technique**", message: "Problème technique détecté !" },
        'signalement': { title: "🚨 **Signalement**", message: "Tu veux signaler quelque chose !" },
        'suggestion': { title: "💡 **Suggestion**", message: "Tu as une suggestion !" },
        'plainte': { title: "📝 **Réclamation**", message: "Tu as une réclamation !" }
    };
    
    const reasonData = reasonMessages[reason] || { title: "📞 **Contact Admin**", message: "Tu as besoin de contacter les admins !" };
    
    const preview = extractedMessage.length > 60 ? extractedMessage.substring(0, 60) + "..." : extractedMessage;
    
    return `${reasonData.title}\n\n${reasonData.message}\n\n💡 Utilise \`/contact [ton message]\` pour les contacter.\n\n📝 Ton message: "${preview}"\n\n⚡ Limite: 2 messages/jour\n📨 Tu recevras une réponse !\n\n💕 En attendant, tape /help pour voir mes fonctionnalités !`;
}

// ========================================
// ⚙️ EXÉCUTION COMMANDE (OPTIMISÉE)
// ========================================

async function executeCommandFromChat(senderId, commandName, args, ctx) {
    const { log, processCommand } = ctx;
    
    try {
        log.info(`⚙️ Exécution /${commandName} avec args: "${args.substring(0, 100)}..."`);
        
        // Utiliser directement processCommand du serveur pour une exécution parfaite
        if (typeof processCommand === 'function') {
            const simulatedCommand = `/${commandName} ${args.trim()}`;
            const result = await processCommand(senderId, simulatedCommand);
            log.info(`✅ Commande /${commandName} exécutée via processCommand`);
            return { success: true, result };
        } else {
            log.error(`❌ processCommand non disponible dans ctx`);
            return { success: false, error: 'Exécution commande impossible' };
        }
        
    } catch (error) {
        log.error(`❌ Erreur exécution /${commandName}: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// ========================================
// 💬 CONVERSATION UNIFIÉE - GEMINI OU MISTRAL
// ========================================

async function handleConversationWithFallback(senderId, args, ctx, searchResults = null) {
    const { addToMemory, getMemoryContext, log, splitMessageIntoChunks, truncatedMessages } = ctx;
    
    const senderIdStr = String(senderId);
    const context = getMemoryContext(senderIdStr).slice(-8);
    
    const now = new Date();
    const dateTime = now.toLocaleString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
    
    let conversationHistory = context.map(msg => `${msg.role === 'user' ? 'Utilisateur' : 'Assistant'}: ${msg.content}`).join('\n') + '\n';
    
    let searchContext = "";
    if (searchResults && searchResults.length > 0) {
        searchContext = `\n\n🔍 INFOS RÉCENTES (intègre naturellement):
${searchResults.map((r, i) => `${i+1}. ${r.title}: ${r.description}`).join('\n\n')}

⚠️ Ne mentionne PAS de recherche.`;
    }
    
    const systemPrompt = `Tu es NakamaBot, IA conversationnelle avancée avec MÉMOIRE, créée par Durand et Cécile.

TEMPS: ${dateTime}

PERSONNALITÉ: Empathique, créative, intuitive. Souviens-toi de TOUT.

CAPACITÉS: Images, analyse, anime, musique, clans, rank, contact, recherche auto.

DIRECTIVES:
- Langue utilisateur
- Max 1999 chars
- Emojis parcimonie
- Markdown simple (**gras**, ### titres, listes)
- Intègre infos naturellement
- Questions tech: "Demande à Durand ou Cécile!"
- Problèmes: /contact

HISTORIQUE:
${conversationHistory || 'Début'}
${searchContext}

Utilisateur: ${args}`;

    // Essayer Gemini d'abord
    if (!checkIfAllGeminiKeysDead()) {
        try {
            const geminiResponse = await callGeminiWithRotation(systemPrompt);
            if (geminiResponse.trim()) {
                return await processResponse(senderIdStr, geminiResponse, args, ctx, 'Gemini');
            }
        } catch (error) {
            log.warning(`⚠️ Gemini échec conversation: ${error.message}`);
        }
    }
    
    // Fallback Mistral
    try {
        const messages = [{ role: "system", content: systemPrompt }, ...context, { role: "user", content: args }];
        const mistralResponse = await ctx.callMistralAPI(messages, 2000, 0.75);
        if (mistralResponse) {
            return await processResponse(senderIdStr, mistralResponse, args, ctx, 'Mistral');
        }
        throw new Error('Mistral échec');
    } catch (error) {
        log.error(`❌ Erreur conversation: ${error.message}`);
        const errorMsg = "🤔 Difficulté technique. Reformule ? 💫";
        addToMemory(senderIdStr, 'assistant', errorMsg);
        return errorMsg;
    }
}

// 🆕 FONCTION UTILITAIRE: Traiter la réponse (parse, troncature, mémoire)
async function processResponse(senderIdStr, rawResponse, args, ctx, source) {
    const { addToMemory, log, splitMessageIntoChunks, truncatedMessages } = ctx;
    
    const styledResponse = parseMarkdown(rawResponse);
    
    if (styledResponse.length > 2000) {
        const chunks = splitMessageIntoChunks(styledResponse, 2000);
        const firstChunk = chunks[0];
        
        if (chunks.length > 1) {
            truncatedMessages.set(senderIdStr, {
                fullMessage: styledResponse,
                lastSentPart: firstChunk,
                timestamp: new Date().toISOString()
            });
            
            const truncated = firstChunk + "\n\n📝 *Tape \"continue\" pour la suite...*";
            addToMemory(senderIdStr, 'user', args);
            addToMemory(senderIdStr, 'assistant', truncated);
            log.info(`📏 ${source} avec troncature`);
            return truncated;
        }
    }
    
    addToMemory(senderIdStr, 'user', args);
    addToMemory(senderIdStr, 'assistant', styledResponse);
    log.info(`✅ ${source} réponse`);
    return styledResponse;
}

// ========================================
// 🛡️ FONCTION PRINCIPALE - RÉÉCRITE ET OPTIMISÉE
// ========================================

module.exports = async function cmdChat(senderId, args, ctx) {
    const { addToMemory, getMemoryContext, log, truncatedMessages, splitMessageIntoChunks, isContinuationRequest } = ctx;
    
    const senderIdStr = String(senderId);
    const messageSignature = `${senderId}_${args.trim().toLowerCase()}`;
    const currentTime = Date.now();
    
    // Anti-doublons et cooldown
    if (recentMessages.has(messageSignature) && currentTime - recentMessages.get(messageSignature) < 30000) {
        log.warning(`🚫 Dupliqué ignoré pour ${senderId}`);
        return;
    }
    
    const lastMessageTime = Math.max(...Array.from(recentMessages.entries())
        .filter(([sig]) => sig.startsWith(`${senderId}_`))
        .map(([, ts]) => ts) || [0]);
    
    if (currentTime - lastMessageTime < 5000) {
        const waitMsg = "🕒 Patiente 5 secondes...";
        addToMemory(senderIdStr, 'assistant', waitMsg);
        return waitMsg;
    }
    
    recentMessages.set(messageSignature, currentTime);
    activeRequests.set(senderId, currentTime);
    
    // Nettoyage recentMessages
    for (const [sig, ts] of recentMessages.entries()) {
        if (currentTime - ts > 120000) recentMessages.delete(sig);
    }
    
    try {
        if (!args.trim()) {
            const welcome = "💬 Salut ! Je suis NakamaBot, prête pour une super conversation ! ✨";
            addToMemory(senderIdStr, 'assistant', welcome);
            return welcome;
        }
        
        const conversationHistory = getMemoryContext(senderIdStr).slice(-10);
        
        // Gestion continuation
        if (isContinuationRequest(args)) {
            const truncatedData = truncatedMessages.get(senderIdStr);
            if (truncatedData) {
                const { fullMessage, lastSentPart } = truncatedData;
                const remaining = fullMessage.substring(fullMessage.indexOf(lastSentPart) + lastSentPart.length);
                
                if (remaining.trim()) {
                    const chunks = splitMessageIntoChunks(remaining, 2000);
                    const nextChunk = chunks[0];
                    
                    if (chunks.length > 1) {
                        truncatedMessages.set(senderIdStr, {
                            fullMessage,
                            lastSentPart: lastSentPart + chunks[0],
                            timestamp: new Date().toISOString()
                        });
                        
                        const continuation = nextChunk + "\n\n📝 *Tape \"continue\" pour la suite...*";
                        addToMemory(senderIdStr, 'user', args);
                        addToMemory(senderIdStr, 'assistant', continuation);
                        return continuation;
                    } else {
                        truncatedMessages.delete(senderIdStr);
                        addToMemory(senderIdStr, 'user', args);
                        addToMemory(senderIdStr, 'assistant', nextChunk);
                        return nextChunk;
                    }
                } else {
                    truncatedMessages.delete(senderIdStr);
                    const end = "✅ C'est tout ! Autre chose ? 💫";
                    addToMemory(senderIdStr, 'user', args);
                    addToMemory(senderIdStr, 'assistant', end);
                    return end;
                }
            } else {
                const noTrunc = "🤔 Pas de suite. Nouvelle question ? 💡";
                addToMemory(senderIdStr, 'user', args);
                addToMemory(senderIdStr, 'assistant', noTrunc);
                return noTrunc;
            }
        }
        
        // Détection contact admin
        const contactIntention = detectContactAdminIntention(args);
        if (contactIntention.shouldContact) {
            const suggestion = generateContactSuggestion(contactIntention.reason, contactIntention.extractedMessage);
            addToMemory(senderIdStr, 'user', args);
            addToMemory(senderIdStr, 'assistant', suggestion);
            return suggestion;
        }
        
        // Détection commandes IA
        const intelligentCommand = await detectIntelligentCommands(args, conversationHistory, ctx);
        if (intelligentCommand.shouldExecute) {
            const { command, args: commandArgs } = intelligentCommand;
            addToMemory(senderIdStr, 'user', args);
            
            const execResult = await executeCommandFromChat(senderId, command, commandArgs, ctx);
            if (execResult.success) {
                // Si résultat est image ou string, le retourner directement (processCommand gère la mémoire)
                return execResult.result;
            } else {
                const fallback = "🤔 Erreur exécution commande. Reformule ? 💫";
                addToMemory(senderIdStr, 'assistant', fallback);
                return fallback;
            }
        }
        
        // Décision recherche
        const searchDecision = await decideSearchNecessity(args, senderId, conversationHistory, ctx);
        let searchResults = null;
        
        if (searchDecision.needsExternalSearch) {
            searchResults = await performIntelligentSearch(searchDecision.searchQuery, ctx);
        }
        
        // Conversation unifiée
        return await handleConversationWithFallback(senderId, args, ctx, searchResults);
        
    } finally {
        activeRequests.delete(senderId);
    }
};

// ========================================
// 📤 EXPORTS
// ========================================

module.exports.detectIntelligentCommands = detectIntelligentCommands;
module.exports.VALID_COMMANDS = VALID_COMMANDS;
module.exports.executeCommandFromChat = executeCommandFromChat;
module.exports.detectContactAdminIntention = detectContactAdminIntention;
module.exports.decideSearchNecessity = decideSearchNecessity;
module.exports.performIntelligentSearch = performIntelligentSearch;
module.exports.analyzeConversationContext = analyzeConversationContext;
module.exports.callGeminiWithRotation = callGeminiWithRotation;
module.exports.callMistralUnified = callMistralUnified;
module.exports.getNextGeminiKey = getNextGeminiKey;
module.exports.markKeyAsFailed = markKeyAsFailed;
module.exports.checkIfAllGeminiKeysDead = checkIfAllGeminiKeysDead;
module.exports.parseMarkdown = parseMarkdown;
module.exports.toBold = toBold;
module.exports.toUnderline = toUnderline;
module.exports.toStrikethrough = toStrikethrough;
