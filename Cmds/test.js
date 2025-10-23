/**
 * Commande /chat UNIFIÉE avec Gemini + Mistral
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
        
        for (const source of sources) {
            try {
                const response = await axios.get(source, {
                    headers: { 'User-Agent': SEARCH_CONFIG.webScraping.userAgent },
                    timeout: SEARCH_CONFIG.webScraping.timeout
                });
                
                const $ = cheerio.load(response.data);
                
                // Extraction Google News
                $('div[data-n-ca-at]').slice(0, 3).each((i, elem) => {
                    const title = $(elem).find('h3').text().trim();
                    const link = 'https://news.google.com' + $(elem).find('a').attr('href');
                    const snippet = $(elem).find('p').text().trim();
                    if (title && link) results.push({ title, description: snippet, link, source: 'google_news' });
                });
                
                // Extraction Yahoo
                $('.algo').slice(0, 3).each((i, elem) => {
                    const title = $(elem).find('h3').text().trim();
                    const link = $(elem).find('a').attr('href');
                    const snippet = $(elem).find('.compText').text().trim();
                    if (title && link) results.push({ title, description: snippet, link, source: 'yahoo' });
                });
                
                await new Promise(resolve => setTimeout(resolve, SEARCH_RETRY_DELAY));
            } catch (error) {
                log.warning(`⚠️ Scraping échec pour ${source}: ${error.message}`);
            }
        }
        
        // Dédupliquer par link
        const uniqueResults = Array.from(new Map(results.map(r => [r.link, r])).values());
        
        if (uniqueResults.length > 0) {
            searchCache.set(cacheKey, { results: uniqueResults, timestamp: Date.now() });
            log.info(`🕸️ Scraping: ${uniqueResults.length} résultats pour "${query}"`);
            return uniqueResults;
        }
        
        return [];
        
    } catch (error) {
        log.warning(`⚠️ Scraping global échec: ${error.message}`);
        return [];
    }
}

// 🆕 Fonction principale de recherche intelligente
async function performIntelligentSearch(query, ctx) {
    const { log } = ctx;
    log.info(`🔍 Recherche intelligente pour: "${query}"`);
    
    const sources = [];
    
    if (SEARCH_CONFIG.duckduckgo.enabled) {
        sources.push(searchDuckDuckGo(query, log));
    }
    
    if (SEARCH_CONFIG.wikipedia.enabled) {
        sources.push(searchWikipedia(query, log));
    }
    
    if (SEARCH_CONFIG.webScraping.enabled) {
        sources.push(searchWebScraping(query, log));
    }
    
    try {
        const allResults = await Promise.allSettled(sources);
        
        const validResults = allResults
            .filter(result => result.status === 'fulfilled' && result.value && result.value.length > 0)
            .flatMap(result => result.value)
            .sort((a, b) => b.description.length - a.description.length)
            .slice(0, 6);
        
        if (validResults.length === 0) {
            log.warning(`⚠️ Aucune source n'a retourné de résultats pour "${query}"`);
            return null;
        }
        
        log.info(`✅ Recherche: ${validResults.length} résultats uniques`);
        return validResults;
        
    } catch (error) {
        log.error(`❌ Erreur recherche intelligente: ${error.message}`);
        return null;
    }
}

// 🆕 Fonction pour décider si une recherche externe est nécessaire
async function decideSearchNecessity(userMessage, senderId, conversationHistory, ctx) {
    const { log } = ctx;
    
    const prompt = `Analyse ce message: "${userMessage}"

Historique récent (5 derniers échanges):
${conversationHistory.slice(-5).map(msg => `${msg.role}: ${msg.content}`).join('\n')}

Décide si une recherche externe est nécessaire (oui/non) et pourquoi (raison courte). Si oui, propose une requête de recherche optimisée (en français, max 10 mots).

Réponds en JSON: {"needsSearch": boolean, "searchQuery": string or null, "reason": string}`;

    try {
        let response = await callGeminiWithRotation(prompt);
        if (!response) {
            response = await callMistralUnified(prompt, ctx, 200);
        }
        
        const parsed = JSON.parse(response);
        
        if (parsed.needsSearch) {
            log.info(`🔍 Recherche nécessaire: ${parsed.reason}`);
            return {
                needsExternalSearch: true,
                searchQuery: parsed.searchQuery || userMessage,
                reason: parsed.reason
            };
        }
        
        return { needsExternalSearch: false };
        
    } catch (error) {
        log.warning(`⚠️ Erreur décision recherche: ${error.message}`);
        return { needsExternalSearch: false };
    }
}

// 🆕 Fonction pour générer une réponse naturelle avec résultats de recherche
async function generateNaturalResponseWithContext(originalMessage, searchResults, ctx) {
    const { log, callMistralAPI } = ctx;
    
    try {
        const formattedResults = searchResults.map(r => 
            `Titre: ${r.title}\nDescription: ${r.description}\nLien: ${r.link}\nSource: ${r.source}`
        ).join('\n\n');
        
        const contextPrompt = `L'utilisateur a dit: "${originalMessage}"

Résultats de recherche:
${formattedResults}

Génère une réponse naturelle et amicale basée sur ces infos. Structure:
- Introduction amicale
- Résumé des infos clés
- Sources citées
- Question pour continuer

Max 800 chars. Markdown simple OK.`;

        let response = await callGeminiWithRotation(contextPrompt);
        if (!response) {
            response = await callMistralAPI([
                { role: "system", content: "Tu es NakamaBot. Réponds naturellement et amicalement avec les résultats de recherche. Markdown simple OK." },
                { role: "user", content: contextPrompt }
            ], 800, 0.7);
        }
        
        return cleanResponse(response);
        
    } catch (error) {
        log.error(`❌ Erreur réponse avec contexte: ${error.message}`);
        return "Désolée, j'ai eu un petit souci avec la recherche... Peux-tu reformuler ? 💕";
    }
}

// ========================================
// 🧠 DÉTECTION INTELLIGENTE COMMANDES
// ========================================

const VALID_COMMANDS = [
    'help', 'aide', 'commands', 'commandes',
    'image', 'img', 'genimage', 'generateimage',
    'analyse', 'analyze', 'vision', 'describe',
    'meme', 'memegen', 'creatememe',
    'anime', 'toanime', 'animefy',
    'chat', 'talk', 'converse',
    'recherche', 'search', 'websearch',
    'clan', 'clans', 'createclan', 'joinclan',
    'rank', 'level', 'exp', 'experience',
    'echecs', 'chess', 'playchess' // 🆕 Ajout pour /echecs
];

async function detectIntelligentCommands(userMessage, conversationHistory, ctx) {
    const { log } = ctx;
    
    const prompt = `Analyse ce message: "${userMessage}"

Historique récent (3 derniers échanges):
${conversationHistory.slice(-3).map(msg => `${msg.role}: ${msg.content}`).join('\n')}

Décide si c'est une commande implicite parmi: ${VALID_COMMANDS.join(', ')}

Si oui, extrais:
- Nom commande (sans /, lowercase)
- Arguments (reste du message)
- Confiance (0-100)

Si confiance < 70, réponds: {"shouldExecute": false}

Si c'est /image ou /img, seuil à 50.

Réponds en JSON strict: {"shouldExecute": boolean, "command": string, "args": string, "confidence": number}`;

    try {
        let response = await callGeminiWithRotation(prompt);
        if (!response) {
            response = await callMistralUnified(prompt, ctx, 200);
        }
        
        const parsed = JSON.parse(response);
        
        if (parsed.shouldExecute && VALID_COMMANDS.includes(parsed.command.toLowerCase())) {
            log.info(`🧠 Commande détectée: /${parsed.command} (confiance: ${parsed.confidence})`);
            return parsed;
        }
        
        return { shouldExecute: false };
        
    } catch (error) {
        log.warning(`⚠️ Erreur détection commande: ${error.message}`);
        return { shouldExecute: false };
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

/**
 * Fonction pour gérer la conversation avec fallback
 * @param {string} senderId
 * @param {string} args
 * @param {object} ctx
 * @param {array|null} searchResults
 * @returns {string|object}
 */
async function handleConversationWithFallback(senderId, args, ctx, searchResults) {
    const { addToMemory, getMemoryContext, log, truncatedMessages, splitMessageIntoChunks } = ctx;
    
    const senderIdStr = String(senderId);
    const conversationHistory = getMemoryContext(senderIdStr);
    
    const systemPrompt = "Tu es NakamaBot, une IA super gentille et amicale, comme une très bonne amie. Réponds en français avec une personnalité bienveillante et chaleureuse. Utilise des emojis pour rendre la conversation fun. Si tu as des résultats de recherche, intègre-les naturellement.";
    
    let userPrompt = `${systemPrompt}\n\nHistorique:\n${conversationHistory.slice(-8).map(msg => `${msg.role}: ${msg.content}`).join('\n')}\n\nUtilisateur: ${args}`;
    
    if (searchResults) {
        const formattedResults = searchResults.map(r => `${r.title}: ${r.description} (${r.link})`).join('\n');
        userPrompt += `\n\nRésultats recherche: ${formattedResults}`;
    }
    
    try {
        let response = await callGeminiWithRotation(userPrompt);
        
        if (!response || !response.trim()) {
            response = await callMistralUnified(userPrompt, ctx, 2000);
        }
        
        if (!response || !response.trim()) {
            throw new Error('Réponse vide des IAs');
        }
        
        const styledResponse = parseMarkdown(cleanResponse(response));
        
        const chunks = splitMessageIntoChunks(styledResponse, 2000);
        
        if (chunks.length > 1) {
            const firstChunk = chunks[0];
            truncatedMessages.set(senderIdStr, {
                fullMessage: styledResponse,
                lastSentPart: firstChunk,
                timestamp: new Date().toISOString()
            });
            
            const truncatedResponse = firstChunk + "\n\n📝 *Tape \"continue\" pour la suite...*";
            addToMemory(senderIdStr, 'user', args);
            addToMemory(senderIdStr, 'assistant', truncatedResponse);
            return truncatedResponse;
        } else {
            addToMemory(senderIdStr, 'user', args);
            addToMemory(senderIdStr, 'assistant', styledResponse);
            return styledResponse;
        }
        
    } catch (error) {
        log.error(`❌ Erreur conversation: ${error.message}`);
        
        const errorResponse = "🤔 J'ai rencontré une difficulté technique. Peux-tu reformuler ? 💫";
        const styledError = parseMarkdown(errorResponse);
        addToMemory(senderIdStr, 'assistant', styledError);
        return styledError;
    }
}

/**
 * Fonction pour analyser le contexte conversationnel (non utilisée directement mais exportée)
 * @param {array} history
 * @returns {string}
 */
function analyzeConversationContext(history) {
    // Logique d'analyse simplifiée
    return history.slice(-3).map(msg => msg.content).join(' ');
}
