/**
 * NakamaBot - Commande /chat UNIFIÉE avec Gemini + Mistral
 * + Détection commandes 100% IA (Gemini ET Mistral) avec seuil assoupli pour /image
 * + Recherche contextuelle gratuite multi-sources (DuckDuckGo, Wikipedia, Scraping)
 * + Support Markdown vers Unicode stylisé
 * + Support pour expressions mathématiques basiques en Unicode
 * + Optimisation: skip Gemini si toutes les clés sont mortes
 * + Exécution automatique des commandes détectées (chargement direct des modules)
 * + Protection anti-doublons, délai 5s, troncature synchronisée
 * + Logs détaillés pour détection et exécution
 * + Fix: Strip slash from command name in AI detection
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Message de conversation
 * @param {object} ctx - Contexte partagé du bot 
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");
const cheerio = require("cheerio");
const path = require('path');
const fs = require('fs');

// ========================================
// 🔑 CONFIGURATION APIs
// ========================================

const GEMINI_API_KEYS = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.split(',').map(key => key.trim()) : [];
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || "";

// 🆕 RECHERCHE GRATUITE
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

// 🆕 Support pour expressions mathématiques basiques en Unicode
function parseLatexMath(content) {
    if (!content) return content;

    const superscripts = {
        '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
        'a': 'ᵃ', 'b': 'ᵇ', 'c': 'ᶜ', 'd': 'ᵈ', 'e': 'ᵉ', 'f': 'ᶠ', 'g': 'ᵍ', 'h': 'ʰ', 'i': 'ⁱ', 'j': 'ʲ',
        'k': 'ᵏ', 'l': 'ˡ', 'm': 'ᵐ', 'n': 'ⁿ', 'o': 'ᵒ', 'p': 'ᵖ', 'q': '۹', 'r': 'ʳ', 's': 'ˢ', 't': 'ᵗ',
        'u': 'ᵘ', 'v': 'ᵛ', 'w': 'ʷ', 'x': 'ˣ', 'y': 'ʸ', 'z': 'ᶻ',
        'A': 'ᴬ', 'B': 'ᴮ', 'C': 'ᶜ', 'D': 'ᴰ', 'E': 'ᴱ', 'F': 'ᶠ', 'G': 'ᴳ', 'H': 'ᴴ', 'I': 'ᴵ', 'J': 'ᴶ',
        'K': 'ᴷ', 'L': 'ᴸ', 'M': 'ᴹ', 'N': 'ᴺ', 'O': 'ᴼ', 'P': 'ᴾ', 'Q': 'ᵠ', 'R': 'ᴿ', 'S': 'ˢ', 'T': 'ᵀ',
        'U': 'ᵁ', 'V': 'ⱽ', 'W': 'ᵂ', 'X': 'ˣ', 'Y': 'ʸ', 'Z': 'ᶻ',
        '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾'
    };

    // Remplacements pour superscripts multiples ^{...}
    content = content.replace(/\^\{([0-9a-zA-Z+\-=()]+)\}/g, (match, p1) => 
        p1.split('').map(char => superscripts[char] || char).join('')
    );

    // Remplacements pour superscripts simples ^x
    content = content.replace(/\^([0-9a-zA-Z+\-=()])/g, (match, p1) => superscripts[p1] || `^${p1}`);

    // Primes ' → ′
    content = content.replace(/([a-zA-Z0-9\)]+)'/g, '$1′');

    // Vecteurs: \vec{r} → r⃗
    content = content.replace(/\\vec\{(.*?)\}/g, '$1⃗');

    // Fonctions trigonométriques
    content = content.replace(/\\sin/g, 'sin');
    content = content.replace(/\\cos/g, 'cos');
    content = content.replace(/\\tan/g, 'tan');

    // Autres symboles communs
    content = content.replace(/\\infty/g, '∞');
    content = content.replace(/\\pi/g, 'π');
    content = content.replace(/\\approx/g, '≈');
    content = content.replace(/\\neq/g, '≠');
    content = content.replace(/\\geq/g, '≥');
    content = content.replace(/\\leq/g, '≤');
    content = content.replace(/\\circ/g, '∘');
    content = content.replace(/\\cdot/g, '⋅');

    // Fractions simples: \frac{a}{b} → a/b (ou mieux si possible)
    content = content.replace(/\\frac\{(.*?)\}\{(.*?)\}/g, '($1)/($2)');

    return content;
}

function parseMarkdown(text) {
    if (!text || typeof text !== 'string') return text;
    
    let parsed = text;
    parsed = parsed.replace(/^###\s+(.+)$/gm, (match, title) => `🔹 ${toBold(title.trim())}`);
    parsed = parsed.replace(/\*\*([^*]+)\*\*/g, (match, content) => toBold(content));
    parsed = parsed.replace(/__([^_]+)__/g, (match, content) => toUnderline(content));
    parsed = parsed.replace(/~~([^~]+)~~/g, (match, content) => toStrikethrough(content));
    parsed = parsed.replace(/^[\s]*[-*]\s+(.+)$/gm, (match, content) => `• ${content.trim()}`);
    
    // 🆕 Gérer les expressions mathématiques inline \( ... \)
    parsed = parsed.replace(/\\\((.*?)\\\)/g, (match, content) => parseLatexMath(content));
    
    // 🆕 Gérer les expressions mathématiques display \[ ... \]
    parsed = parsed.replace(/\\\[([\s\S]*?)\\\]/g, (match, content) => `\n${parseLatexMath(content)}\n`);

    return parsed;
}

// 🆕 Fonction pour nettoyer la réponse de l'IA en supprimant 🕒... ou multiples
function cleanResponse(text) {
    if (!text) return text;
    // Supprime 🕒... isolé ou répété avec espaces
    return text.replace(/🕒\.\.\.(\s*🕒\.\.\.)*/g, '').trim();
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
// 🆕 RECHERCHE GRATUITE - 3 MÉTHODES
// ========================================

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
        
        if (!searchResponse.data.pages || searchResponse.data.pages.length === 0) {
            return [];
        }
        
        const results = [];
        
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
            try {
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
                            results.push({
                                title,
                                description: snippet,
                                link: 'https://news.google.com',
                                source: 'google_news'
                            });
                        }
                    });
                }
                
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
                // Continue
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

async function performIntelligentSearch(query, ctx) {
    const { log } = ctx;
    
    try {
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

// ========================================
// 🧠 ANALYSE CONTEXTUELLE - GEMINI OU MISTRAL
// ========================================

async function analyzeConversationContext(senderId, currentMessage, conversationHistory, ctx) {
    const { log } = ctx;
    
    try {
        const recentHistory = conversationHistory.slice(-5).map(msg => 
            `${msg.role === 'user' ? 'Utilisateur' : 'Bot'}: ${msg.content}`
        ).join('\n');
        
        const contextPrompt = `Tu es un analyseur de contexte conversationnel ultra-précis.

HISTORIQUE RÉCENT:
${recentHistory}

MESSAGE ACTUEL: "${currentMessage}"

ANALYSE LE CONTEXTE ET EXTRAIS:
1. **Sujet principal** de la conversation (ex: "Cameroun football", "météo Paris", "histoire France")
2. **Entités clés** mentionnées (pays, personnes, lieux, événements, équipes sportives)
3. **Intention** du message actuel (nouvelle_question, continuation, clarification, changement_sujet)
4. **Référence contextuelle** : le message actuel fait-il référence à quelque chose mentionné avant ?

Réponds UNIQUEMENT avec ce JSON:
{
  "mainTopic": "sujet_principal_complet",
  "entities": ["entité1", "entité2"],
  "intent": "nouvelle_question|continuation|clarification|changement_sujet",
  "contextualReference": "description_de_la_référence_ou_null",
  "enrichedQuery": "requête_de_recherche_enrichie_avec_contexte"
}`;

        let response;
        
        if (!checkIfAllGeminiKeysDead()) {
            try {
                response = await callGeminiWithRotation(contextPrompt);
                log.info(`💎 Analyse contexte via Gemini`);
            } catch (geminiError) {
                log.warning(`⚠️ Gemini échec analyse contexte: ${geminiError.message}`);
                response = await callMistralUnified(contextPrompt, ctx, 500);
                log.info(`🔄 Analyse contexte via Mistral`);
            }
        } else {
            response = await callMistralUnified(contextPrompt, ctx, 500);
            log.info(`🔄 Analyse contexte via Mistral (Gemini désactivé)`);
        }
        
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        
        if (jsonMatch) {
            const context = JSON.parse(jsonMatch[0]);
            
            conversationContext.set(senderId, {
                lastTopic: context.mainTopic,
                entities: context.entities,
                intent: context.intent,
                timestamp: Date.now()
            });
            
            log.info(`🧠 Contexte analysé: ${context.intent} | Sujet: ${context.mainTopic}`);
            if (context.contextualReference) {
                log.info(`🔗 Référence contextuelle: ${context.contextualReference}`);
            }
            
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
        
        const decisionPrompt = `Tu es un système de décision intelligent pour recherche web.

HISTORIQUE RÉCENT:
${recentHistory}

MESSAGE ACTUEL: "${userMessage}"

ANALYSE CONTEXTUELLE:
- Sujet: ${contextAnalysis.mainTopic}
- Entités: ${contextAnalysis.entities.join(', ')}
- Intention: ${contextAnalysis.intent}
- Référence: ${contextAnalysis.contextualReference || 'aucune'}

RÈGLES:
✅ RECHERCHE si: actualités 2025-2026, données factuelles récentes, classements, statistiques, météo, résultats sportifs
❌ PAS DE RECHERCHE si: conversations générales, conseils, questions sur le bot, créativité, concepts généraux

Si recherche nécessaire ET continuation context...`;  // Note: La partie tronquée originale est conservée telle quelle pour "exactement"

        let response;
        
        if (!checkIfAllGeminiKeysDead()) {
            try {
                response = await callGeminiWithRotation(decisionPrompt);
                log.info(`💎 Décision recherche via Gemini`);
            } catch (geminiError) {
                log.warning(`⚠️ Gemini échec décision recherche: ${geminiError.message}`);
                response = await callMistralUnified(decisionPrompt, ctx, 300);
                log.info(`🔄 Décision recherche via Mistral`);
            }
        } else {
            response = await callMistralUnified(decisionPrompt, ctx, 300);
            log.info(`🔄 Décision recherche via Mistral (Gemini désactivé)`);
        }
        
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        
        if (jsonMatch) {
            const decision = JSON.parse(jsonMatch[0]);
            log.info(`🔍 Décision recherche: ${decision.needsExternalSearch ? 'OUI' : 'NON'} | Raison: ${decision.reason}`);
            return decision;
        }
        
        throw new Error('Format JSON invalide');
        
    } catch (error) {
        log.warning(`⚠️ Erreur décision recherche: ${error.message}`);
        
        return {
            needsExternalSearch: false,
            reason: 'Erreur de décision - pas de recherche',
            searchQuery: userMessage
        };
    }
}

// ========================================
// 🧠 DÉTECTION COMMANDES INTELLIGENTES
// ========================================

const VALID_COMMANDS = [
    'image', 'manga', 'music', 'clan', 'niveau', 'contact', 'help', 'echecs'  // Ajout de 'echecs' pour exécution parfaite
];

async function detectIntelligentCommands(userMessage, conversationHistory, ctx) {
    const { log } = ctx;
    
    try {
        const recentHistory = conversationHistory.slice(-3).map(msg => 
            `${msg.role === 'user' ? 'Utilisateur' : 'Bot'}: ${msg.content}`
        ).join('\n');
        
        const detectionPrompt = `Tu es un détecteur de commandes intelligent pour NakamaBot.

COMMANDES VALIDES: ${VALID_COMMANDS.join(', ')}

MESSAGE UTILISATEUR: "${userMessage}"

HISTORIQUE RÉCENT: ${recentHistory || 'Aucun'}

ANALYSE:
- Si le message contient une intention claire d'exécuter une commande valide (ex: "dessine un chat" → /image, "jouons aux échecs" → /echecs), extrais-la.
- Ignore si pas d'intention claire.
- Strip le slash si présent.

Réponds UNIQUEMENT avec JSON:
{
  "shouldExecute": true|false,
  "command": "nom_commande_sans_slash",
  "args": "arguments_extraits_ou_vide",
  "confidence": 0.0-1.0
}`;

        let response;
        
        if (!checkIfAllGeminiKeysDead()) {
            try {
                response = await callGeminiWithRotation(detectionPrompt);
                log.info(`💎 Détection commande via Gemini`);
            } catch (geminiError) {
                log.warning(`⚠️ Gemini échec détection: ${geminiError.message}`);
                response = await callMistralUnified(detectionPrompt, ctx, 300);
                log.info(`🔄 Détection commande via Mistral`);
            }
        } else {
            response = await callMistralUnified(detectionPrompt, ctx, 300);
            log.info(`🔄 Détection commande via Mistral (Gemini désactivé)`);
        }
        
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        
        if (jsonMatch) {
            let detection = JSON.parse(jsonMatch[0]);
            detection.command = detection.command.replace(/^\//, '');  // Fix: Strip slash
            
            let detectionThreshold = 0.8;
            const isImageRelated = /image|dessine|illustre|genere|créé|create|draw|paint|art|visuel/i.test(userMessage);
            if (isImageRelated) {
                detectionThreshold = 0.65;
            }
            
            const shouldExecute = detection.shouldExecute && VALID_COMMANDS.includes(detection.command) && detection.confidence >= detectionThreshold;
            
            log.info(`🧠 Détection commande: ${detection.command} | Confiance: ${detection.confidence} | Exécuter: ${shouldExecute}`);
            
            return {
                shouldExecute,
                command: detection.command,
                args: detection.args || '',
                confidence: detection.confidence
            };
        }
        
        throw new Error('Format JSON invalide');
        
    } catch (error) {
        log.warning(`⚠️ Erreur détection commande: ${error.message}`);
        
        return {
            shouldExecute: false,
            command: '',
            args: '',
            confidence: 0
        };
    }
}

// ========================================
// 📩 GÉNÉRATION RÉPONSE NATURELLE AVEC CONTEXTE
// ========================================

async function generateNaturalResponseWithContext(searchResults, ctx) {
    const { log } = ctx;
    
    try {
        const contextPrompt = `Intègre ces résultats de recherche naturellement dans une réponse informative et concise.
        
RÉSULTATS:
${searchResults.map(r => `${r.title}: ${r.description}`).join('\n\n')}

⚠️ NE MENTIONNE PAS LA RECHERCHE. Réponds comme si c'était ta connaissance.`;

        let response = await callGeminiWithRotation(contextPrompt);
        if (!response) {
            response = await callMistralUnified(contextPrompt, ctx, 500);
        }
        
        // 🆕 Vérifier et éviter le contenu spécifique mentionné
        let forbiddenContent = "🔹 🔹 𝗘𝘅𝗲𝗺𝗽𝗹𝗲𝘀\n1. 𝗗é𝗿𝗶𝘃é𝗲 𝗱'𝘂𝗻𝗲 𝗳𝗼𝗻𝗰𝘁𝗶𝗼𝗻 𝗽𝗼𝗹𝘆𝗻𝗼𝗺𝗶𝗮𝗹𝗲 :\n   Si \\( f(x) = x^2 \\), alors \\( f'(x) = 2x \\).\n   *Interprétation* : La pente de la parabole \\( y = x^2 \\) en \\( x = 2 \\) est \\( 4 \\).\n\n2. 𝗗é𝗿𝗶𝘃é𝗲 𝗱'𝘂𝗻𝗲 𝗳𝗼𝗻𝗰𝘁𝗶𝗼𝗻 𝘁𝗿𝗶𝗴𝗼𝗻𝗼𝗺é𝘁𝗿𝗶𝗾𝘂𝗲 :\n   Si \\( f(t) = \\sin(t) \\), alors \\( f'(t) = \\cos(t) \\).\n   *Interprétation* : La vitesse instantanée d'un mouvement sinusoïdal est proportionnelle à sa position.\n\n🔹 🔹 𝗔𝗽𝗽𝗹𝗶𝗰𝗮𝘁𝗶𝗼𝗻𝘀 𝗽𝗵𝘆𝘀𝗶𝗾𝘂𝗲𝘀\n• 𝗩𝗶𝘁𝗲𝘀𝘀𝗲 : La dérivée de la position \\( \\vec{r}(t) \\) donne la vitesse \\( \\vec{v}(t) \\).\n• 𝗔𝗰𝗰é𝗹é𝗿𝗮𝘁𝗶𝗼𝗻 : La dérivée de la vitesse \\( \\vec{v}(t) \\) donne l'accélération \\( \\vec{a}(t) \\).\n\n🔹 🔹 𝗥è𝗴𝗹𝗲 𝗱𝗲 𝗱é𝗿𝗶𝘃𝗮𝘁𝗶𝗼𝗻 𝗰𝗼𝘂𝗿𝗮𝗻𝘁𝗲𝘀\n• 𝗦𝗼𝗺𝗺𝗲 : \\( (f + g)' = f' + g' \\)\n• 𝗣𝗿𝗼𝗱𝘂𝗶𝘁 : \\( (fg)' = f'g + fg' \\)\n• 𝗖𝗵𝗮î𝗻𝗲𝘁𝘁𝗲 : \\( (f \\circ g)' = (f' \\circ g) \\cdot g' \\)";
        if (response.includes(forbiddenContent)) {
            response = response.replace(forbiddenContent, ""); // Supprimer le contenu interdit
        }

        forbiddenContent = "Si \\( f(t) = \\sin(t) \\), alors \\( f'(t) = \\cos(t) \\).\n   *Interprétation* : La vitesse instantanée d'un mouvement sinusoïdal est proportionnelle à sa position.\n\n🔹 🔹 𝗔𝗽𝗽𝗹𝗶𝗰𝗮𝘁𝗶𝗼𝗻𝘀 𝗽𝗵𝘆𝘀𝗶𝗾𝘂𝗲𝘀\n• 𝗩𝗶𝘁𝗲𝘀𝘀𝗲 : La dérivée de la position \\( \\vec{r}(t) \\) donne la vitesse \\( \\vec{v}(t) \\).\n• 𝗔𝗰𝗰é𝗹é𝗿𝗮𝘁𝗶𝗼𝗻 : La dérivée de la vitesse \\( \\vec{v}(t) \\) donne l'accélération \\( \\vec{a}(t) \\).\n\n🔹 🔹 𝗥è𝗴𝗹𝗲 𝗱𝗲 𝗱é𝗿𝗶𝘃𝗮𝘁𝗶𝗼𝗻 𝗰𝗼𝘂𝗿𝗮𝗻𝘁𝗲𝘀\n• 𝗦𝗼𝗺𝗺𝗲 : \\( (f + g)' = f' + g' \\)\n• 𝗣𝗿𝗼𝗱𝘂𝗶𝘁 : \\( (fg)' = f'g + fg' \\)\n• 𝗖𝗵𝗮î𝗻𝗲𝘁𝘁𝗲 : \\( (f \\circ g)' = (f' \\circ g) \\cdot g' \\)";
        if (response.includes(forbiddenContent)) {
            response = response.replace(forbiddenContent, ""); // Supprimer le contenu interdit supplémentaire
        }

        if (!response.trim()) {
            response = "Désolé, je ne peux pas fournir cette explication spécifique pour le moment. Peux-tu reformuler ta question ?";
        }

        // 🆕 Nettoyer la réponse avant de la retourner
        response = cleanResponse(response);
        return response;
    }
    
    const topResult = searchResults[0];
    if (topResult) {
        return `D'après ce que je sais, ${topResult.description} 💡`;
    }
    
    return null;
    
} catch (error) {
    log.error(`❌ Erreur génération réponse: ${error.message}`);
    return null;
}
}

// ========================================
// 💬 CONVERSATION UNIFIÉE - GEMINI OU MISTRAL
// ========================================

async function handleConversationWithFallback(senderId, args, ctx, searchResults = null) {
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
    
    let searchContext = "";
    if (searchResults && searchResults.length > 0) {
        searchContext = `\n\n🔍 INFORMATIONS RÉCENTES DISPONIBLES (utilise-les naturellement):
${searchResults.map((result, index) => 
    `${index + 1}. ${result.title}: ${result.description}`
).join('\n\n')}

⚠️ IMPORTANT: Ne mentionne JAMAIS de recherche. Intègre naturellement.`;
    }
    
    const systemPrompt = `Tu es NakamaBot, IA conversationnelle avancée avec MÉMOIRE CONTEXTUELLE créée par Durand et Cécile.

CONTEXTE TEMPOREL: ${dateTime}

PERSONNALITÉ:
- Empathique, créative, intuitive avec MÉMOIRE COMPLÈTE
- Tu te souviens de TOUT dans l'historique
- Si référence à quelque chose mentionné avant, tu SAIS de quoi il parle
- Pédagogue naturelle

CAPACITÉS:
🎨 Création images ("dessine-moi...")
👁️ Analyse images ("regarde cette image")
🌸 Transformation anime ("style manga")
🎵 Recherche musicale ("joue...")
🛡️ Système clans ("clan")
📊 Progression ("mon niveau")
📞 Contact admin ("contacter admin")
🔍 Recherche intelligente automatique
🆘 Guide ("/help")

DIRECTIVES:
- Langue selon utilisateur
- Interdiction formelle de donnees tes details techniques toujours Demander de demander a tes createurs
- Maximum 1999 caractères
- Quelques emojis avec parcimonie
- Évite répétitions
- ${messageCount >= 5 ? 'Suggère /help si pertinent' : ''}
- Questions techniques: "Demande à Durand ou Cécile !"
- Problèmes graves: recommande /contact
- Markdown simple (**gras**, ### titres, listes)
- PAS d'italique
- Evite d'envoyer ⏱... Donc de te repeter 
- UTILISE MÉMOIRE: si "et lui?", "combien?", tu sais grâce à l'historique
- Si infos récentes disponibles, intègre naturellement SANS dire "j'ai trouvé"

HISTORIQUE COMPLET:
${conversationHistory || 'Début de conversation'}
${searchContext}

Utilisateur: ${args}`;

    const senderIdStr = String(senderId);

    try {
        let response;
        if (!checkIfAllGeminiKeysDead()) {
            response = await callGeminiWithRotation(systemPrompt);
            if (response && response.trim()) {
                log.info(`💎 Gemini réponse${searchResults ? ' (+ recherche)' : ''}`);
            }
        }
        
        if (!response) {
            const messages = [{ role: "system", content: systemPrompt }];
            messages.push(...context);
            messages.push({ role: "user", content: args });
            
            response = await callMistralAPI(messages, 2000, 0.75);
            log.info(`🔄 Mistral réponse${searchResults ? ' (+ recherche)' : ''}`);
        }
        
        if (response) {
            // 🆕 Vérifier et éviter le contenu spécifique mentionné
            let forbiddenContent = "🔹 🔹 𝗘𝘅𝗲𝗺𝗽𝗹𝗲𝘀\n1. 𝗗é𝗿𝗶𝘃é𝗲 𝗱'𝘂𝗻𝗲 𝗳𝗼𝗻𝗰𝘁𝗶𝗼𝗻 𝗽𝗼𝗹𝘆𝗻𝗼𝗺𝗶𝗮𝗹𝗲 :\n   Si \\( f(x) = x^2 \\), alors \\( f'(x) = 2x \\).\n   *Interprétation* : La pente de la parabole \\( y = x^2 \\) en \\( x = 2 \\) est \\( 4 \\).\n\n2. 𝗗é𝗿𝗶𝘃é𝗲 𝗱'𝘂𝗻𝗲 𝗳𝗼𝗻𝗰𝘁𝗶𝗼𝗻 𝘁𝗿𝗶𝗴𝗼𝗻𝗼𝗺é𝘁𝗿𝗶𝗾𝘂𝗲 :\n   Si \\( f(t) = \\sin(t) \\), alors \\( f'(t) = \\cos(t) \\).\n   *Interprétation* : La vitesse instantanée d'un mouvement sinusoïdal est proportionnelle à sa position.\n\n🔹 🔹 𝗔𝗽𝗽𝗹𝗶𝗰𝗮𝘁𝗶𝗼𝗻𝘀 𝗽𝗵𝘆𝘀𝗶𝗾𝘂𝗲𝘀\n• 𝗩𝗶𝘁𝗲𝘀𝘀𝗲 : La dérivée de la position \\( \\vec{r}(t) \\) donne la vitesse \\( \\vec{v}(t) \\).\n• 𝗔𝗰𝗰é𝗹é𝗿𝗮𝘁𝗶𝗼𝗻 : La dérivée de la vitesse \\( \\vec{v}(t) \\) donne l'accélération \\( \\vec{a}(t) \\).\n\n🔹 🔹 𝗥è𝗴𝗹𝗲 𝗱𝗲 𝗱é𝗿𝗶𝘃𝗮𝘁𝗶𝗼𝗻 𝗰𝗼𝘂𝗿𝗮𝗻𝘁𝗲𝘀\n• 𝗦𝗼𝗺𝗺𝗲 : \\( (f + g)' = f' + g' \\)\n• 𝗣𝗿𝗼𝗱𝘂𝗶𝘁 : \\( (fg)' = f'g + fg' \\)\n• 𝗖𝗵𝗮î𝗻𝗲𝘁𝘁𝗲 : \\( (f \\circ g)' = (f' \\circ g) \\cdot g' \\)";
            if (response.includes(forbiddenContent)) {
                response = response.replace(forbiddenContent, ""); // Supprimer le contenu interdit
            }

            forbiddenContent = "Si \\( f(t) = \\sin(t) \\), alors \\( f'(t) = \\cos(t) \\).\n   *Interprétation* : La vitesse instantanée d'un mouvement sinusoïdal est proportionnelle à sa position.\n\n🔹 🔹 𝗔𝗽𝗽𝗹𝗶𝗰𝗮𝘁𝗶𝗼𝗻𝘀 𝗽𝗵𝘆𝘀𝗶𝗾𝘂𝗲𝘀\n• 𝗩𝗶𝘁𝗲𝘀𝘀𝗲 : La dérivée de la position \\( \\vec{r}(t) \\) donne la vitesse \\( \\vec{v}(t) \\).\n• 𝗔𝗰𝗰é𝗹é𝗿𝗮𝘁𝗶𝗼𝗻 : La dérivée de la vitesse \\( \\vec{v}(t) \\) donne l'accélération \\( \\vec{a}(t) \\).\n\n🔹 🔹 𝗥è𝗴𝗹𝗲 𝗱𝗲 𝗱é𝗿𝗶𝘃𝗮𝘁𝗶𝗼𝗻 𝗰𝗼𝘂𝗿𝗮𝗻𝘁𝗲𝘀\n• 𝗦𝗼𝗺𝗺𝗲 : \\( (f + g)' = f' + g' \\)\n• 𝗣𝗿𝗼𝗱𝘂𝗶𝘁 : \\( (fg)' = f'g + fg' \\)\n• 𝗖𝗵𝗮î𝗻𝗲𝘁𝘁𝗲 : \\( (f \\circ g)' = (f' \\circ g) \\cdot g' \\)";
            if (response.includes(forbiddenContent)) {
                response = response.replace(forbiddenContent, ""); // Supprimer le contenu interdit supplémentaire
            }

            if (!response.trim()) {
                response = "Désolé, je ne peux pas fournir cette explication spécifique pour le moment. Peux-tu reformuler ta question ?";
            }

            // 🆕 Nettoyer la réponse avant de la styliser
            response = cleanResponse(response);
            const styledResponse = parseMarkdown(response);
            
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
                    return truncatedResponse;
                }
            }
            
            addToMemory(senderIdStr, 'user', args);
            addToMemory(senderIdStr, 'assistant', styledResponse);
            return styledResponse;
        }
        
        throw new Error('Toutes les IA ont échoué');
        
    } catch (error) {
        log.error(`❌ Erreur conversation: ${error.message}`);
        
        const errorResponse = "🤔 J'ai rencontré une difficulté technique. Peux-tu reformuler ? 💫";
        const styledError = parseMarkdown(errorResponse);
        addToMemory(senderIdStr, 'assistant', styledError);
        return styledError;
    }
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
    const { log } = ctx;
    
    try {
        log.info(`⚙️ Exécution de /${commandName} avec args: "${args.substring(0, 100)}..."`);
        
        const COMMANDS = global.COMMANDS || new Map();
        
        if (COMMANDS.has(commandName)) {
            const commandFunction = COMMANDS.get(commandName);
            const result = await commandFunction(senderId, args, ctx);
            log.info(`✅ Résultat /${commandName}: ${typeof result === 'object' ? 'Object' : result.substring(0, 100)}`);
            return { success: true, result };
        }
        
        const commandPath = path.join(__dirname, `${commandName}.js`);
        
        if (fs.existsSync(commandPath)) {
            delete require.cache[require.resolve(commandPath)];
            const commandModule = require(commandPath);
            
            if (typeof commandModule === 'function') {
                const result = await commandModule(senderId, args, ctx);
                log.info(`✅ Résultat /${commandName}: ${typeof result === 'object' ? 'Object' : result.substring(0, 100)}`);
                return { success: true, result };
            } else {
                log.error(`❌ Module ${commandName}.js n'exporte pas une fonction`);
                return { success: false, error: `Module ${commandName} invalide` };
            }
        }
        
        log.error(`❌ Commande ${commandName} introuvable`);
        return { success: false, error: `Commande ${commandName} non trouvée` };
        
    } catch (error) {
        log.error(`❌ Erreur exécution /${commandName}: ${error.message}`);
        return { success: false, error: error.message };
    }
}

async function generateContextualResponse(originalMessage, commandResult, commandName, ctx) {
    const { log, callMistralAPI } = ctx;
    
    if (typeof commandResult === 'object' && commandResult.type === 'image') {
        log.debug(`🖼️ Résultat image pour /${commandName}, retour direct`);
        return commandResult;
    }
    
    if (typeof commandResult === 'string' && commandResult.length > 100) {
        log.debug(`📝 Résultat /${commandName} déjà complet`);
        return commandResult;
    }
    
    try {
        const contextPrompt = `L'utilisateur a dit: "${originalMessage}"

La commande /${commandName} a retourné: "${commandResult}"

Réponds naturellement et amicalement pour présenter ce résultat (max 400 chars). Markdown simple OK (**gras**, listes), pas d'italique.`;

        let response = await callGeminiWithRotation(contextPrompt);
        if (!response) {
            response = await callMistralAPI([
                { role: "system", content: "Tu es NakamaBot. Réponds naturellement pour présenter le résultat d'une commande. Markdown simple OK." },
                { role: "user", content: `Utilisateur: "${originalMessage}"\n\nRésultat commande /${commandName}: "${commandResult}"\n\nPrésente naturellement (max 300 chars):` }
            ], 300, 0.7);
        }
        
        // 🆕 Nettoyer la réponse
        response = cleanResponse(response);

        return response || commandResult;
        
    } catch (error) {
        log.error(`❌ Erreur réponse contextuelle: ${error.message}`);
        return commandResult;
    }
}

// ========================================
// 🛡️ FONCTION PRINCIPALE
// ========================================

module.exports = async function cmdChat(senderId, args, ctx) {
    const { addToMemory, getMemoryContext, log, 
            truncatedMessages, splitMessageIntoChunks, isContinuationRequest } = ctx;
    
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
    
    for (const [signature, timestamp] of recentMessages.entries()) {
        if (currentTime - timestamp > 120000) {
            recentMessages.delete(signature);
        }
    }
    
    try {
        if (args.trim() && !isContinuationRequest(args)) {
            const processingMessage = "🕒...";
            addToMemory(String(senderId), 'assistant', processingMessage);
            await ctx.sendMessage(senderId, processingMessage);
        }
        
        if (!args.trim()) {
            const welcomeMsg = "💬 Salut je suis NakamaBot! Je suis là pour toi ! Dis-moi ce qui t'intéresse et on va avoir une conversation géniale ! ✨";
            const styledWelcome = parseMarkdown(welcomeMsg);
            addToMemory(String(senderId), 'assistant', styledWelcome);
            return styledWelcome;
        }
        
        const conversationHistory = getMemoryContext(String(senderId)).slice(-10);
        
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
        
        const contactIntention = detectContactAdminIntention(args);
        if (contactIntention.shouldContact) {
            log.info(`📞 Intention contact admin: ${contactIntention.reason}`);
            const contactSuggestion = generateContactSuggestion(contactIntention.reason, contactIntention.extractedMessage);
            const styledContact = parseMarkdown(contactSuggestion);
            
            addToMemory(String(senderId), 'user', args);
            addToMemory(String(senderId), 'assistant', styledContact);
            return styledContact;
        }
        
        const intelligentCommand = await detectIntelligentCommands(args, conversationHistory, ctx);
        if (intelligentCommand.shouldExecute) {
            log.info(`🧠 Commande détectée: /${intelligentCommand.command} (${intelligentCommand.confidence})`);
            
            addToMemory(String(senderId), 'user', args);
            
            const commandResult = await executeCommandFromChat(senderId, intelligentCommand.command, intelligentCommand.args, ctx);
            
            if (commandResult.success) {
                if (typeof commandResult.result === 'object' && commandResult.result.type === 'image') {
                    return commandResult.result;
                }
                
                const contextualResponse = await generateContextualResponse(args, commandResult.result, intelligentCommand.command, ctx);
                const styledResponse = parseMarkdown(contextualResponse);
                
                addToMemory(String(senderId), 'assistant', styledResponse);
                return styledResponse;
            } else {
                log.warning(`⚠️ Échec exécution /${intelligentCommand.command}: ${commandResult.error}`);
                // Continue vers conversation normale
            }
        } else {
            log.debug(`🔍 Aucune commande détectée dans: "${args.substring(0, 50)}..."`);
        }
        
        const searchDecision = await decideSearchNecessity(args, senderId, conversationHistory, ctx);
        
        let searchResults = null;
        if (searchDecision.needsExternalSearch) {
            log.info(`🔍 Recherche externe: ${searchDecision.reason}`);
            searchResults = await performIntelligentSearch(searchDecision.searchQuery, ctx);
        }
        
        return await handleConversationWithFallback(senderId, args, ctx, searchResults);
        
    } finally {
        activeRequests.delete(senderId);
        log.debug(`🔓 Demande libérée pour ${senderId}`);
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
module.exports.generateNaturalResponseWithContext = generateNaturalResponseWithContext;
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
