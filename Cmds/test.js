/**
 * NakamaBot - Commande /chat avec recherche GRATUITE et rotation des clés Gemini
 * + Support Markdown vers Unicode stylisé pour Facebook Messenger
 * + Système de troncature synchronisé avec le serveur principal
 * + Délai de 5 secondes entre messages utilisateurs distincts
 * + 🆕 RECHERCHE GRATUITE: DuckDuckGo, Wikipedia, Web Scraping
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Message de conversation
 * @param {object} ctx - Contexte partagé du bot 
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");
const cheerio = require("cheerio"); // Pour web scraping

// ========================================
// 🔑 CONFIGURATION APIs
// ========================================

// Configuration APIs avec rotation des clés Gemini
const GEMINI_API_KEYS = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.split(',').map(key => key.trim()) : [];

// 🆕 RECHERCHE GRATUITE - Pas de clés API nécessaires !
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

// Configuration des délais pour la rotation et les retries
const SEARCH_RETRY_DELAY = 2000; // Délai entre tentatives (2 secondes)
const SEARCH_GLOBAL_COOLDOWN = 3000; // Délai global entre recherches

// État global pour la rotation des clés Gemini
let currentGeminiKeyIndex = 0;
const failedKeys = new Set();

// 🛡️ PROTECTION ANTI-DOUBLONS RENFORCÉE
const activeRequests = new Map();
const recentMessages = new Map();

// 🕐 CACHE DE RECHERCHE (évite de refaire les mêmes recherches)
const searchCache = new Map();
const CACHE_TTL = 3600000; // 1 heure

// ========================================
// 🎨 FONCTIONS DE PARSING MARKDOWN → UNICODE
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

function toItalic(str) {
    return str; // Désactivé pour Messenger
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
    
    // Titres
    parsed = parsed.replace(/^###\s+(.+)$/gm, (match, title) => `🔹 ${toBold(title.trim())}`);
    
    // Gras
    parsed = parsed.replace(/\*\*([^*]+)\*\*/g, (match, content) => toBold(content));
    
    // Souligné
    parsed = parsed.replace(/__([^_]+)__/g, (match, content) => toUnderline(content));
    
    // Barré
    parsed = parsed.replace(/~~([^~]+)~~/g, (match, content) => toStrikethrough(content));
    
    // Listes
    parsed = parsed.replace(/^[\s]*[-*]\s+(.+)$/gm, (match, content) => `• ${content.trim()}`);
    
    return parsed;
}

// ========================================
// 🔑 GESTION ROTATION CLÉS GEMINI
// ========================================

function getNextGeminiKey() {
    if (GEMINI_API_KEYS.length === 0) {
        throw new Error('Aucune clé Gemini configurée');
    }
    
    if (failedKeys.size >= GEMINI_API_KEYS.length) {
        failedKeys.clear();
        currentGeminiKeyIndex = 0;
    }
    
    let attempts = 0;
    while (attempts < GEMINI_API_KEYS.length) {
        const key = GEMINI_API_KEYS[currentGeminiKeyIndex];
        currentGeminiKeyIndex = (currentGeminiKeyIndex + 1) % GEMINI_API_KEYS.length;
        
        if (!failedKeys.has(key)) return key;
        attempts++;
    }
    
    failedKeys.clear();
    currentGeminiKeyIndex = 0;
    return GEMINI_API_KEYS[0];
}

function markKeyAsFailed(apiKey) {
    failedKeys.add(apiKey);
}

async function callGeminiWithRotation(prompt, maxRetries = GEMINI_API_KEYS.length) {
    let lastError = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const apiKey = getNextGeminiKey();
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
            
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
// 🆕 RECHERCHE GRATUITE - 3 MÉTHODES
// ========================================

/**
 * 🦆 MÉTHODE 1: DuckDuckGo HTML (Pas de clé API, scraping HTML)
 * Avantages: Gratuit, rapide, respecte la vie privée
 */
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
            const titleElem = $(elem).find('.result__title');
            const snippetElem = $(elem).find('.result__snippet');
            const linkElem = $(elem).find('.result__url');
            
            const title = titleElem.text().trim();
            const snippet = snippetElem.text().trim();
            const link = linkElem.attr('href') || titleElem.find('a').attr('href');
            
            if (title && snippet) {
                results.push({
                    title,
                    description: snippet,
                    link: link || 'N/A',
                    source: 'duckduckgo'
                });
            }
        });
        
        if (results.length > 0) {
            searchCache.set(cacheKey, { results, timestamp: Date.now() });
            log.info(`🦆 DuckDuckGo: ${results.length} résultats pour "${query}"`);
            return results;
        }
        
        return [];
        
    } catch (error) {
        log.warning(`⚠️ DuckDuckGo échec: ${error.message}`);
        return [];
    }
}

/**
 * 📚 MÉTHODE 2: Wikipedia API (Gratuit, officiel, fiable)
 * Avantages: API officielle, données structurées, multilingue
 */
async function searchWikipedia(query, log) {
    const cacheKey = `wiki_${query.toLowerCase()}`;
    const cached = searchCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
        log.info(`💾 Cache Wikipedia hit pour: ${query}`);
        return cached.results;
    }
    
    try {
        // Recherche de pages
        const searchUrl = `${SEARCH_CONFIG.wikipedia.baseUrl}/page/search/${encodeURIComponent(query)}`;
        const searchResponse = await axios.get(searchUrl, {
            params: { limit: SEARCH_CONFIG.wikipedia.maxResults },
            timeout: SEARCH_CONFIG.wikipedia.timeout
        });
        
        if (!searchResponse.data.pages || searchResponse.data.pages.length === 0) {
            return [];
        }
        
        const results = [];
        
        // Récupérer les résumés
        for (const page of searchResponse.data.pages.slice(0, 2)) {
            try {
                const summaryUrl = `${SEARCH_CONFIG.wikipedia.baseUrl}/page/summary/${encodeURIComponent(page.title)}`;
                const summaryResponse = await axios.get(summaryUrl, {
                    timeout: SEARCH_CONFIG.wikipedia.timeout
                });
                
                const summary = summaryResponse.data;
                results.push({
                    title: summary.title,
                    description: summary.extract,
                    link: summary.content_urls?.desktop?.page || 'https://fr.wikipedia.org',
                    source: 'wikipedia'
                });
            } catch (error) {
                // Ignorer erreurs individuelles
            }
        }
        
        if (results.length > 0) {
            searchCache.set(cacheKey, { results, timestamp: Date.now() });
            log.info(`📚 Wikipedia: ${results.length} résultats pour "${query}"`);
            return results;
        }
        
        return [];
        
    } catch (error) {
        log.warning(`⚠️ Wikipedia échec: ${error.message}`);
        return [];
    }
}

/**
 * 🌐 MÉTHODE 3: Web Scraping Direct (Sites d'actualités français)
 * Avantages: Actualités en temps réel, informations locales
 */
async function searchWebScraping(query, log) {
    const cacheKey = `scrape_${query.toLowerCase()}`;
    const cached = searchCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL / 2)) { // Cache plus court
        log.info(`💾 Cache Scraping hit pour: ${query}`);
        return cached.results;
    }
    
    try {
        // Sources françaises fiables
        const sources = [
            `https://news.google.com/search?q=${encodeURIComponent(query)}&hl=fr&gl=FR&ceid=FR:fr`,
            `https://search.yahoo.com/search?p=${encodeURIComponent(query)}&fr=yfp-t`
        ];
        
        const results = [];
        
        for (const url of sources) {
            try {
                const response = await axios.get(url, {
                    headers: { 'User-Agent': SEARCH_CONFIG.webScraping.userAgent },
                    timeout: SEARCH_CONFIG.webScraping.timeout
                });
                
                const $ = cheerio.load(response.data);
                
                // Google News
                if (url.includes('news.google.com')) {
                    $('article').slice(0, 3).each((i, elem) => {
                        const title = $(elem).find('a').first().text().trim();
                        const snippet = $(elem).find('p').text().trim();
                        
                        if (title && snippet) {
                            results.push({
                                title,
                                description: snippet,
                                link: 'https://news.google.com',
                                source: 'google_news'
                            });
                        }
                    });
                }
                
                // Yahoo Search
                if (url.includes('yahoo.com')) {
                    $('.dd.algo').slice(0, 2).each((i, elem) => {
                        const title = $(elem).find('h3').text().trim();
                        const snippet = $(elem).find('.compText').text().trim();
                        
                        if (title && snippet) {
                            results.push({
                                title,
                                description: snippet,
                                link: 'N/A',
                                source: 'yahoo'
                            });
                        }
                    });
                }
                
                if (results.length >= 3) break;
                
            } catch (error) {
                // Continue avec la source suivante
            }
        }
        
        if (results.length > 0) {
            searchCache.set(cacheKey, { results, timestamp: Date.now() });
            log.info(`🌐 Web Scraping: ${results.length} résultats pour "${query}"`);
            return results;
        }
        
        return [];
        
    } catch (error) {
        log.warning(`⚠️ Web Scraping échec: ${error.message}`);
        return [];
    }
}

/**
 * 🎯 RECHERCHE INTELLIGENTE COMBINÉE (Essaye les 3 méthodes)
 * Cascade: DuckDuckGo → Wikipedia → Web Scraping
 */
async function performIntelligentSearch(query, ctx) {
    const { log } = ctx;
    
    try {
        // Méthode 1: DuckDuckGo (Prioritaire)
        if (SEARCH_CONFIG.duckduckgo.enabled) {
            const ddgResults = await searchDuckDuckGo(query, log);
            if (ddgResults.length > 0) return ddgResults;
        }
        
        // Délai court entre méthodes
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Méthode 2: Wikipedia (Pour questions encyclopédiques)
        if (SEARCH_CONFIG.wikipedia.enabled) {
            const wikiResults = await searchWikipedia(query, log);
            if (wikiResults.length > 0) return wikiResults;
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Méthode 3: Web Scraping (Actualités récentes)
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

// ========================================
// 🛡️ FONCTION PRINCIPALE
// ========================================

module.exports = async function cmdChat(senderId, args, ctx) {
    const { addToMemory, getMemoryContext, callMistralAPI, log, 
            truncatedMessages, splitMessageIntoChunks, isContinuationRequest } = ctx;
    
    // Protection anti-doublons
    const messageSignature = `${senderId}_${args.trim().toLowerCase()}`;
    const currentTime = Date.now();
    
    if (recentMessages.has(messageSignature)) {
        const lastProcessed = recentMessages.get(messageSignature);
        if (currentTime - lastProcessed < 30000) {
            log.warning(`🚫 Message dupliqué ignoré pour ${senderId}`);
            return;
        }
    }
    
    if (activeRequests.has(senderId)) {
        log.warning(`🚫 Demande en cours ignorée pour ${senderId}`);
        return;
    }
    
    // Délai de 5 secondes entre messages
    const lastMessageTime = Array.from(recentMessages.entries())
        .filter(([sig]) => sig.startsWith(`${senderId}_`))
        .map(([, timestamp]) => timestamp)
        .sort((a, b) => b - a)[0] || 0;
        
    if (lastMessageTime && (currentTime - lastMessageTime < 5000)) {
        const waitMessage = "🕒 Veuillez patienter 5 secondes avant d'envoyer un nouveau message...";
        addToMemory(String(senderId), 'assistant', waitMessage);
        await ctx.sendMessage(senderId, waitMessage);
        return;
    }
    
    activeRequests.set(senderId, `${senderId}_${currentTime}`);
    recentMessages.set(messageSignature, currentTime);
    
    // Nettoyage cache ancien
    for (const [signature, timestamp] of recentMessages.entries()) {
        if (currentTime - timestamp > 120000) {
            recentMessages.delete(signature);
        }
    }
    
    try {
        // Message de traitement
        if (args.trim() && !isContinuationRequest(args)) {
            const processingMessage = "🕒 Traitement en cours...";
            addToMemory(String(senderId), 'assistant', processingMessage);
            await ctx.sendMessage(senderId, processingMessage);
        }
        
        if (!args.trim()) {
            const welcomeMsg = "💬 Salut je suis NakamaBot! Je suis là pour toi ! Dis-moi ce qui t'intéresse et on va avoir une conversation géniale ! ✨";
            const styledWelcome = parseMarkdown(welcomeMsg);
            addToMemory(String(senderId), 'assistant', styledWelcome);
            return styledWelcome;
        }
        
        // Gestion continuation
        const senderIdStr = String(senderId);
        if (isContinuationRequest(args)) {
            const truncatedData = truncatedMessages.get(senderIdStr);
            if (truncatedData) {
                const { fullMessage, lastSentPart } = truncatedData;
                const lastSentIndex = fullMessage.indexOf(lastSentPart) + lastSentPart.length;
                const remainingMessage = fullMessage.substring(lastSentIndex);
                
                if (remainingMessage.trim()) {
                    const chunks = splitMessageIntoChunks(remainingMessage, 2000);
                    const nextChunk = parseMarkdown(chunks[0]);
                    
                    if (chunks.length > 1) {
                        truncatedMessages.set(senderIdStr, {
                            fullMessage,
                            lastSentPart: lastSentPart + chunks[0],
                            timestamp: new Date().toISOString()
                        });
                        
                        const continuationMsg = nextChunk + "\n\n📝 *Tape \"continue\" pour la suite...*";
                        addToMemory(senderIdStr, 'user', args);
                        addToMemory(senderIdStr, 'assistant', continuationMsg);
                        return continuationMsg;
                    } else {
                        truncatedMessages.delete(senderIdStr);
                        addToMemory(senderIdStr, 'user', args);
                        addToMemory(senderIdStr, 'assistant', nextChunk);
                        return nextChunk;
                    }
                } else {
                    truncatedMessages.delete(senderIdStr);
                    const endMsg = "✅ C'est tout ! Y a-t-il autre chose que je puisse faire pour toi ? 💫";
                    addToMemory(senderIdStr, 'user', args);
                    addToMemory(senderIdStr, 'assistant', endMsg);
                    return endMsg;
                }
            } else {
                const noTruncMsg = "🤔 Il n'y a pas de message en cours à continuer. Pose-moi une nouvelle question ! 💡";
                addToMemory(senderIdStr, 'user', args);
                addToMemory(senderIdStr, 'assistant', noTruncMsg);
                return noTruncMsg;
            }
        }
        
        // Détection contact admin
        const contactIntention = detectContactAdminIntention(args);
        if (contactIntention.shouldContact) {
            log.info(`📞 Intention contact admin: ${contactIntention.reason}`);
            const contactSuggestion = generateContactSuggestion(contactIntention.reason, contactIntention.extractedMessage);
            const styledContact = parseMarkdown(contactSuggestion);
            
            addToMemory(String(senderId), 'user', args);
            addToMemory(String(senderId), 'assistant', styledContact);
            return styledContact;
        }
        
        // Détection commandes intelligentes
        const intelligentCommand = await detectIntelligentCommands(args, ctx);
        if (intelligentCommand.shouldExecute) {
            log.info(`🧠 Commande détectée: /${intelligentCommand.command}`);
            
            try {
                const commandResult = await executeCommandFromChat(senderId, intelligentCommand.command, intelligentCommand.args, ctx);
                
                if (commandResult.success) {
                    if (typeof commandResult.result === 'object' && commandResult.result.type === 'image') {
                        addToMemory(String(senderId), 'user', args);
                        return commandResult.result;
                    }
                    
                    const contextualResponse = await generateContextualResponse(args, commandResult.result, intelligentCommand.command, ctx);
                    const styledResponse = parseMarkdown(contextualResponse);
                    
                    addToMemory(String(senderId), 'user', args);
                    addToMemory(String(senderId), 'assistant', styledResponse);
                    return styledResponse;
                }
            } catch (error) {
                log.error(`❌ Erreur commande IA: ${error.message}`);
            }
        }
        
        // Décision recherche externe
        const searchDecision = await decideSearchNecessity(args, senderId, ctx);
        
        if (searchDecision.needsExternalSearch) {
            log.info(`🔍 Recherche externe nécessaire: ${searchDecision.reason}`);
            
            try {
                const conversationContext = getMemoryContext(String(senderId)).slice(-8);
                const searchResults = await performIntelligentSearch(searchDecision.searchQuery, ctx);
                
                if (searchResults && searchResults.length > 0) {
                    const naturalResponse = await generateNaturalResponseWithContext(args, searchResults, conversationContext, ctx);
                    
                    if (naturalResponse) {
                        const styledNatural = parseMarkdown(naturalResponse);
                        
                        if (styledNatural.length > 2000) {
                            const chunks = splitMessageIntoChunks(styledNatural, 2000);
                            const firstChunk = chunks[0];
                            
                            if (chunks.length > 1) {
                                truncatedMessages.set(senderIdStr, {
                                    fullMessage: styledNatural,
                                    lastSentPart: firstChunk,
                                    timestamp: new Date().toISOString()
                                });
                                
                                const truncatedResponse = firstChunk + "\n\n📝 *Tape \"continue\" pour la suite...*";
                                addToMemory(String(senderId), 'user', args);
                                addToMemory(String(senderId), 'assistant', truncatedResponse);
                                return truncatedResponse;
                            }
                        }
                        
                        addToMemory(String(senderId), 'user', args);
                        addToMemory(String(senderId), 'assistant', styledNatural);
                        log.info(`🔍✅ Recherche terminée avec succès`);
                        return styledNatural;
                    }
                }
            } catch (searchError) {
                log.error(`❌ Erreur recherche: ${searchError.message}`);
            }
        }
        
        // Conversation classique
        return await handleConversationWithFallback(senderId, args, ctx);
        
    } finally {
        activeRequests.delete(senderId);
        log.debug(`🔓 Demande libérée pour ${senderId}`);
    }
};

// ========================================
// 🤖 DÉCISION IA POUR RECHERCHE
// ========================================

async function decideSearchNecessity(userMessage, senderId, ctx) {
    const { log } = ctx;
    
    try {
        const decisionPrompt = `Tu es un système de décision pour un chatbot.

MESSAGE: "${userMessage}"

Détermine si une recherche web est nécessaire.

✅ OUI pour:
- Infos récentes (actualités 2025-2026)
- Données factuelles (prix, statistiques, dates)
- Infos locales/géographiques
- Questions sur personnes publiques récentes
- Météo, cours, résultats sportifs

❌ NON pour:
- Conversations générales
- Conseils/opinions
- Questions sur le bot
- Créativité (histoires, poèmes)
- Explications concepts généraux

JSON uniquement:
{
  "needsExternalSearch": true/false,
  "confidence": 0.0-1.0,
  "reason": "explication",
  "searchQuery": "requête optimisée"
}`;

        const response = await callGeminiWithRotation(decisionPrompt);
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        
        if (jsonMatch) {
            const decision = JSON.parse(jsonMatch[0]);
            log.info(`🤖 Décision: ${decision.needsExternalSearch ? 'OUI' : 'NON'} (${decision.confidence})`);
            return decision;
        }
        
        throw new Error('Format invalide');
        
    } catch (error) {
        log.warning(`⚠️ Erreur décision: ${error.message}`);
        return detectSearchKeywords(userMessage);
    }
}

function detectSearchKeywords(message) {
    const lowerMessage = message.toLowerCase();
    
    const indicators = [
        { patterns: [/\b(202[4-6]|actualité|récent|nouveau|news)\b/], weight: 0.9 },
        { patterns: [/\b(prix|coût|combien|tarif)\b/], weight: 0.8 },
        { patterns: [/\b(météo|temps|température)\b/], weight: 0.9 },
        { patterns: [/\b(où|lieu|localisation)\b/], weight: 0.7 }
    ];
    
    let weight = 0;
    for (const indicator of indicators) {
        for (const pattern of indicator.patterns) {
            if (pattern.test(lowerMessage)) {
                weight += indicator.weight;
                break;
            }
        }
    }
    
    return {
        needsExternalSearch: weight > 0.6,
        searchQuery: message,
        confidence: Math.min(weight, 1.0),
        reason: 'fallback_keywords'
    };
}

// ========================================
// 🎭 GÉNÉRATION RÉPONSE AVEC CONTEXTE
// ========================================

async function generateNaturalResponseWithContext(originalQuery, searchResults, conversationContext, ctx) {
    const { log, callMistralAPI } = ctx;
    
    const now = new Date();
    const dateTime = now.toLocaleString('fr-FR', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit',
        timeZone: 'Europe/Paris'
    });
    
    try {
        const resultsText = searchResults.map((result, index) => 
            `${index + 1}. ${result.title}: ${result.description}`
        ).join('\n\n');
        
        let conversationHistory = "";
        if (conversationContext && conversationContext.length > 0) {
            conversationHistory = conversationContext.map(msg => 
                `${msg.role === 'user' ? 'Utilisateur' : 'NakamaBot'}: ${msg.content}`
            ).join('\n') + '\n';
        }
        
        const contextualPrompt = `Tu es NakamaBot, une IA conversationnelle empathique.

CONTEXTE TEMPOREL: ${dateTime}

HISTORIQUE:
${conversationHistory || "Début de conversation"}

QUESTION: "${originalQuery}"

INFORMATIONS TROUVÉES:
${resultsText}

INSTRUCTIONS:
- Réponds en tenant compte de TOUT le contexte précédent
- Si référence à conversation antérieure, tu t'en souviens
- Ton conversationnel et amical avec quelques emojis
- Maximum 1999 caractères
- NE MENTIONNE JAMAIS que tu as fait une recherche
- NE DIS JAMAIS "d'après mes recherches" ou "selon les sources"
- Réponds naturellement comme dans une conversation continue
- Utilise Markdown simple (**gras**, ### titres, listes)
- PAS d'italique (*texte*)

RÉPONSE NATURELLE:`;

        const response = await callGeminiWithRotation(contextualPrompt);
        
        if (response && response.trim()) {
            log.info(`🎭 Réponse contextuelle Gemini générée`);
            return response;
        }
        
        throw new Error('Réponse Gemini vide');
        
    } catch (geminiError) {
        log.warning(`⚠️ Gemini échec: ${geminiError.message}`);
        
        try {
            const messages = [{
                role: "system",
                content: `Tu es NakamaBot. Tu connais l'historique. Réponds naturellement. Ne mentionne jamais de recherches. Markdown simple OK.

Historique:
${conversationContext ? conversationContext.map(msg => `${msg.role === 'user' ? 'Utilisateur' : 'NakamaBot'}: ${msg.content}`).join('\n') : "Début"}`
            }, {
                role: "user", 
                content: `Question: "${originalQuery}"

Infos:
${searchResults.map(r => `${r.title}: ${r.description}`).join('\n')}

Réponds naturellement (max 2000 chars):`
            }];
            
            const mistralResponse = await callMistralAPI(messages, 2000, 0.7);
            
            if (mistralResponse) {
                log.info(`🔄 Réponse contextuelle Mistral générée`);
                return mistralResponse;
            }
            
            throw new Error('Mistral échec aussi');
            
        } catch (mistralError) {
            log.error(`❌ Erreur totale: ${mistralError.message}`);
            
            const topResult = searchResults[0];
            if (topResult) {
                return `D'après ce que je sais, ${topResult.description} 💡`;
            }
            
            return null;
        }
    }
}

// ========================================
// 💬 CONVERSATION CLASSIQUE
// ========================================

async function handleConversationWithFallback(senderId, args, ctx) {
    const { addToMemory, getMemoryContext, callMistralAPI, log, 
            splitMessageIntoChunks, truncatedMessages } = ctx;
    
    const context = getMemoryContext(String(senderId)).slice(-8);
    const messageCount = context.filter(msg => msg.role === 'user').length;
    
    const now = new Date();
    const dateTime = now.toLocaleString('fr-FR', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit',
        timeZone: 'Europe/Paris'
    });
    
    let conversationHistory = "";
    if (context.length > 0) {
        conversationHistory = context.map(msg => 
            `${msg.role === 'user' ? 'Utilisateur' : 'Assistant'}: ${msg.content}`
        ).join('\n') + '\n';
    }
    
    const systemPrompt = `Tu es NakamaBot, une IA conversationnelle avancée créée par Durand et Cécile.

CONTEXTE TEMPOREL: ${dateTime}

INTELLIGENCE & PERSONNALITÉ:
- Empathique, créative et intuitive
- Tu comprends les émotions et intentions
- Pédagogue naturelle
- Adaptable selon contexte

CAPACITÉS:
🎨 Création d'images ("dessine-moi...")
👁️ Analyse d'images ("regarde cette image")
🌸 Transformation anime ("style manga")
🎵 Recherche musicale YouTube ("joue...")
🛡️ Système clans et batailles ("clan")
📊 Progression et niveau ("mon niveau")
📞 Contact admin ("contacter admin")
🔍 Recherche intelligente automatique
🆘 Guide complet ("aide")

DIRECTIVES:
- Langue selon utilisateur
- Maximum 1999 caractères
- Quelques emojis avec parcimonie
- Évite répétitions
- ${messageCount >= 5 ? 'Suggère /help si pertinent' : ''}
- Pour questions techniques: "Demande à Durand ou Cécile !"
- Recommande /contact pour problèmes graves
- Markdown simple OK (**gras**, ### titres, listes)
- PAS d'italique

${conversationHistory ? `Historique:\n${conversationHistory}` : ''}

Utilisateur: ${args}`;

    const senderIdStr = String(senderId);

    try {
        const geminiResponse = await callGeminiWithRotation(systemPrompt);
        
        if (geminiResponse && geminiResponse.trim()) {
            const styledResponse = parseMarkdown(geminiResponse);
            
            if (styledResponse.length > 2000) {
                const chunks = splitMessageIntoChunks(styledResponse, 2000);
                const firstChunk = chunks[0];
                
                if (chunks.length > 1) {
                    truncatedMessages.set(senderIdStr, {
                        fullMessage: styledResponse,
                        lastSentPart: firstChunk,
                        timestamp: new Date().toISOString()
                    });
                    
                    const truncatedResponse = firstChunk + "\n\n📝 *Tape \"continue\" pour la suite...*";
                    addToMemory(senderIdStr, 'user', args);
                    addToMemory(senderIdStr, 'assistant', truncatedResponse);
                    log.info(`💎 Gemini avec troncature`);
                    return truncatedResponse;
                }
            }
            
            addToMemory(senderIdStr, 'user', args);
            addToMemory(senderIdStr, 'assistant', styledResponse);
            log.info(`💎 Gemini réponse normale`);
            return styledResponse;
        }
        
        throw new Error('Réponse Gemini vide');
        
    } catch (geminiError) {
        log.warning(`⚠️ Gemini échec: ${geminiError.message}`);
        
        try {
            const messages = [{ role: "system", content: systemPrompt }];
            messages.push(...context);
            messages.push({ role: "user", content: args });
            
            const mistralResponse = await callMistralAPI(messages, 2000, 0.75);
            
            if (mistralResponse) {
                const styledResponse = parseMarkdown(mistralResponse);
                
                if (styledResponse.length > 2000) {
                    const chunks = splitMessageIntoChunks(styledResponse, 2000);
                    const firstChunk = chunks[0];
                    
                    if (chunks.length > 1) {
                        truncatedMessages.set(senderIdStr, {
                            fullMessage: styledResponse,
                            lastSentPart: firstChunk,
                            timestamp: new Date().toISOString()
                        });
                        
                        const truncatedResponse = firstChunk + "\n\n📝 *Tape \"continue\" pour la suite...*";
                        addToMemory(senderIdStr, 'user', args);
                        addToMemory(senderIdStr, 'assistant', truncatedResponse);
                        log.info(`🔄 Mistral avec troncature`);
                        return truncatedResponse;
                    }
                }
                
                addToMemory(senderIdStr, 'user', args);
                addToMemory(senderIdStr, 'assistant', styledResponse);
                log.info(`🔄 Mistral fallback`);
                return styledResponse;
            }
            
            throw new Error('Mistral échec');
            
        } catch (mistralError) {
            log.error(`❌ Erreur totale: ${mistralError.message}`);
            
            const errorResponse = "🤔 J'ai rencontré une difficulté technique. Peux-tu reformuler ? 💫";
            const styledError = parseMarkdown(errorResponse);
            addToMemory(senderIdStr, 'assistant', styledError);
            return styledError;
        }
    }
}

// ========================================
// 🧠 DÉTECTION COMMANDES INTELLIGENTES
// ========================================

const VALID_COMMANDS = [
    'help', 'image', 'vision', 'anime', 'music', 
    'clan', 'rank', 'contact', 'weather'
];

async function detectIntelligentCommands(message, ctx) {
    const { log } = ctx;
    
    try {
        const commandsList = VALID_COMMANDS.map(cmd => `/${cmd}`).join(', ');
        
        const detectionPrompt = `Tu es un système de détection de commandes ultra-précis.

COMMANDES: ${commandsList}

MESSAGE: "${message}"

VRAIS INTENTIONS (confidence 0.8-1.0):
✅ help: "aide", "help", "que peux-tu faire"
✅ image: "dessine", "crée une image", "génère"
✅ vision: "regarde cette image", "analyse"
✅ anime: "transforme en anime", "style manga"
✅ music: "joue cette musique", "trouve sur YouTube"
✅ clan: "rejoindre clan", "bataille"
✅ rank: "mon niveau", "mes stats"
✅ contact: "contacter admin", "signaler"
✅ weather: "météo", "quel temps"

FAUSSES DÉTECTIONS (0.0-0.3):
❌ Questions générales mentionnant un mot
❌ Conversations: "j'aime la musique"
❌ Descriptions: "cette image est belle"

JSON uniquement:
{
  "isCommand": true/false,
  "command": "nom_ou_null",
  "confidence": 0.0-1.0,
  "extractedArgs": "arguments",
  "reason": "explication"
}`;

        const response = await callGeminiWithRotation(detectionPrompt);
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        
        if (jsonMatch) {
            const aiDetection = JSON.parse(jsonMatch[0]);
            
            const isValid = aiDetection.isCommand && 
                          VALID_COMMANDS.includes(aiDetection.command) && 
                          aiDetection.confidence >= 0.8;
            
            if (isValid) {
                log.info(`🎯 Commande: /${aiDetection.command} (${aiDetection.confidence})`);
                
                return {
                    shouldExecute: true,
                    command: aiDetection.command,
                    args: aiDetection.extractedArgs,
                    confidence: aiDetection.confidence,
                    method: 'ai_contextual'
                };
            }
        }
        
        return { shouldExecute: false };
        
    } catch (error) {
        log.warning(`⚠️ Erreur détection: ${error.message}`);
        return await fallbackStrictKeywordDetection(message, log);
    }
}

async function fallbackStrictKeywordDetection(message, log) {
    const lowerMessage = message.toLowerCase().trim();
    
    const strictPatterns = [
        { command: 'help', patterns: [/^(aide|help|guide)$/] },
        { command: 'image', patterns: [/^dessine(-moi)?\s+/, /^(crée|génère)\s+(une\s+)?(image|dessin)/] },
        { command: 'vision', patterns: [/^regarde\s+(cette\s+)?(image|photo)/, /^(analyse|décris)\s+/] },
        { command: 'music', patterns: [/^(joue|lance|play)\s+/, /^trouve\s+.*musique/] },
        { command: 'clan', patterns: [/^(rejoindre|créer|mon)\s+clan/] },
        { command: 'rank', patterns: [/^(mon\s+)?(niveau|rang|stats)/] },
        { command: 'contact', patterns: [/^contacter\s+admin/] },
        { command: 'weather', patterns: [/^(météo|quel\s+temps)/] }
    ];
    
    for (const { command, patterns } of strictPatterns) {
        for (const pattern of patterns) {
            if (pattern.test(lowerMessage)) {
                log.info(`🔑 Fallback: /${command}`);
                return {
                    shouldExecute: true,
                    command,
                    args: message,
                    confidence: 0.9,
                    method: 'fallback_strict'
                };
            }
        }
    }
    
    return { shouldExecute: false };
}

// ========================================
// ✉️ DÉTECTION CONTACT ADMIN
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
                if (category.reason === 'question_creation') {
                    return { shouldContact: false };
                }
                return {
                    shouldContact: true,
                    reason: category.reason,
                    extractedMessage: message
                };
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
    
    const reasonData = reasonMessages[reason] || {
        title: "📞 **Contact Admin**",
        message: "Tu as besoin de contacter les admins !"
    };
    
    const preview = extractedMessage.length > 60 ? extractedMessage.substring(0, 60) + "..." : extractedMessage;
    
    return `${reasonData.title}\n\n${reasonData.message}\n\n💡 Utilise \`/contact [ton message]\` pour les contacter.\n\n📝 Ton message: "${preview}"\n\n⚡ Limite: 2 messages/jour\n📨 Tu recevras une réponse !\n\n💕 En attendant, tape /help pour voir mes fonctionnalités !`;
}

// ========================================
// ⚙️ EXÉCUTION COMMANDE
// ========================================

async function executeCommandFromChat(senderId, commandName, args, ctx) {
    try {
        const COMMANDS = global.COMMANDS || new Map();
        
        if (!COMMANDS.has(commandName)) {
            const path = require('path');
            const fs = require('fs');
            const commandPath = path.join(__dirname, `${commandName}.js`);
            
            if (fs.existsSync(commandPath)) {
                delete require.cache[require.resolve(commandPath)];
                const commandModule = require(commandPath);
                
                if (typeof commandModule === 'function') {
                    const result = await commandModule(senderId, args, ctx);
                    return { success: true, result };
                }
            }
        } else {
            const commandFunction = COMMANDS.get(commandName);
            const result = await commandFunction(senderId, args, ctx);
            return { success: true, result };
        }
        
        return { success: false, error: `Commande ${commandName} non trouvée` };
        
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function generateContextualResponse(originalMessage, commandResult, commandName, ctx) {
    if (typeof commandResult === 'object' && commandResult.type === 'image') {
        return commandResult;
    }
    
    try {
        const contextPrompt = `Utilisateur: "${originalMessage}"
Résultat /${commandName}: "${commandResult}"

Réponds naturellement et amicalement (max 400 chars). Markdown simple OK, pas d'italique.`;

        const response = await callGeminiWithRotation(contextPrompt);
        return response || commandResult;
        
    } catch (error) {
        const { callMistralAPI } = ctx;
        try {
            const response = await callMistralAPI([
                { role: "system", content: "Réponds naturellement. Markdown simple OK." },
                { role: "user", content: `Utilisateur: "${originalMessage}"\nRésultat: "${commandResult}"\nPrésente naturellement (max 200 chars)` }
            ], 200, 0.7);
            
            return response || commandResult;
        } catch (mistralError) {
            return commandResult;
        }
    }
}

// ========================================
// 📤 EXPORTS
// ========================================

module.exports.detectIntelligentCommands = detectIntelligentCommands;
module.exports.VALID_COMMANDS = VALID_COMMANDS;
module.exports.executeCommandFromChat = executeCommandFromChat;
module.exports.detectContactAdminIntention = detectContactAdminIntention;
module.exports.decideSearchNecessity = decideSearchNecessity;
module.exports.performIntelligentSearch = performIntelligentSearch;
module.exports.generateNaturalResponseWithContext = generateNaturalResponseWithContext;
module.exports.callGeminiWithRotation = callGeminiWithRotation;
module.exports.getNextGeminiKey = getNextGeminiKey;
module.exports.markKeyAsFailed = markKeyAsFailed;
module.exports.parseMarkdown = parseMarkdown;
module.exports.toBold = toBold;
module.exports.toItalic = toItalic;
module.exports.toUnderline = toUnderline;
module.exports.toStrikethrough = toStrikethrough;
