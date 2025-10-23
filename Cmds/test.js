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
        
        // Limiter à 2 sources pour éviter les timeouts
        for (const url of sources.slice(0, 2)) {
            try {
                const response = await axios.get(url, {
                    headers: {
                        'User-Agent': SEARCH_CONFIG.webScraping.userAgent
                    },
                    timeout: SEARCH_CONFIG.webScraping.timeout
                });
                
                const $ = cheerio.load(response.data);
                
                // Extraction pour Google News
                $('div[data-nid]').slice(0, 2).each((i, elem) => {
                    const title = $(elem).find('h3').text().trim();
                    const snippet = $(elem).find('div[role="heading"]').next().text().trim();
                    const link = 'https://news.google.com' + $(elem).find('a').attr('href');
                    
                    if (title && snippet) {
                        results.push({
                            title,
                            description: snippet,
                            link: link || 'N/A',
                            source: 'google_news'
                        });
                    }
                });
                
                // Extraction pour Yahoo
                $('li.searchCenterMiddle_li').slice(0, 2).each((i, elem) => {
                    const title = $(elem).find('h3').text().trim();
                    const snippet = $(elem).find('.compText p').text().trim();
                    const link = $(elem).find('a').attr('href');
                    
                    if (title && snippet) {
                        results.push({
                            title,
                            description: snippet,
                            link: link || 'N/A',
                            source: 'yahoo'
                        });
                    }
                });
            } catch (error) {
                log.warning(`⚠️ Scraping échec pour ${url}: ${error.message}`);
            }
            await new Promise(r => setTimeout(r, SEARCH_RETRY_DELAY));
        }
        
        if (results.length > 0) {
            searchCache.set(cacheKey, { results, timestamp: Date.now() });
            log.info(`🌐 Scraping: ${results.length} résultats pour "${query}"`);
            return results;
        }
        
        return [];
        
    } catch (error) {
        log.warning(`⚠️ Scraping global échec: ${error.message}`);
        return [];
    }
}

// ========================================
// 🔍 DÉCISION DE RECHERCHE
// ========================================

async function decideSearchNecessity(userMessage, senderId, conversationHistory, ctx) {
    const { log } = ctx;
    
    const prompt = `Analyse ce message utilisateur: "${userMessage}"
    
Historique récent: ${conversationHistory.map(m => `${m.role}: ${m.content}`).join('\n')}
    
Décide si une recherche externe est nécessaire pour répondre précisément et à jour.
    
Critères pour OUI:
- Question factuelle sur actualités récentes (2025+)
- Demande d'informations précises (prix, dates, stats)
- Sujet technique/dynamique (tech, finance, science)
- Demande de sources ou liens

Critères pour NON:
- Conversation générale
- Opinion personnelle
- Commandes bot internes
- Questions hypothétiques
- Sujets intemporels (maths basiques, histoire ancienne)

Réponds en JSON:
{
  "needsExternalSearch": boolean,
  "reason": string (courte explication),
  "searchQuery": string (si needsExternalSearch true, requête optimisée, sinon "")
}`;

    try {
        let decisionStr = await callGeminiWithRotation(prompt);
        if (!decisionStr) {
            decisionStr = await callMistralUnified(prompt, ctx, 150);
        }
        
        const decision = JSON.parse(decisionStr);
        
        log.debug(`🔍 Décision recherche: ${decision.needsExternalSearch ? 'OUI' : 'NON'} - ${decision.reason}`);
        
        return decision;
        
    } catch (error) {
        log.error(`❌ Erreur décision recherche: ${error.message}`);
        return {
            needsExternalSearch: false,
            reason: 'Erreur - Pas de recherche',
            searchQuery: ''
        };
    }
}

// ========================================
// 🌐 RECHERCHE INTELLIGENTE
// ========================================

async function performIntelligentSearch(query, ctx) {
    const { log } = ctx;
    
    if (!query) return null;
    
    try {
        await new Promise(r => setTimeout(r, SEARCH_GLOBAL_COOLDOWN));
        
        log.info(`🔍 Recherche intelligente: "${query.substring(0, 50)}..."`);
        
        const [ddgResults, wikiResults, scrapeResults] = await Promise.all([
            searchDuckDuckGo(query, log),
            searchWikipedia(query, log),
            searchWebScraping(query, log)
        ]);
        
        const allResults = [...ddgResults, ...wikiResults, ...scrapeResults]
            .sort((a, b) => b.description.length - a.description.length)
            .slice(0, 6);
        
        if (allResults.length === 0) {
            log.warning(`⚠️ Aucune résultat pour "${query}"`);
            return null;
        }
        
        const formattedResults = allResults.map(r => 
            `Titre: ${r.title}\nDescription: ${r.description}\nSource: ${r.source}\nLien: ${r.link}`
        ).join('\n\n');
        
        return formattedResults;
        
    } catch (error) {
        log.error(`❌ Erreur recherche intelligente: ${error.message}`);
        return null;
    }
}

// ========================================
// 💬 RÉPONSE NATURELLE AVEC CONTEXTE
// ========================================

async function generateNaturalResponseWithContext(userMessage, conversationHistory, searchResults, ctx) {
    const { log } = ctx;
    
    const systemPrompt = `Tu es NakamaBot, une assistante IA très gentille, amicale et bienveillante, comme une bonne amie. Nous sommes en 2025. Réponds toujours en français avec une personnalité chaleureuse, positive et encourageante. Utilise des émoticônes mignonnes 💕✨. Limite à 1500 caractères max.

Si résultats recherche fournis, intègre-les naturellement sans lister mécaniquement. Commence par reformuler la question amicalement, donne l'info clé, ajoute ton avis gentil si pertinent, termine par une question pour continuer la conversation.

Markdown simple: **gras**, __souligné__, ~~barré~~, • pour listes. Pas d'italique.

Historique: ${conversationHistory.map(m => `${m.role}: ${m.content}`).join('\n')}

Résultats recherche (si pertinents): ${searchResults || 'Aucun'}`;

    const userPrompt = `Réponds à: "${userMessage}" de manière amicale et naturelle.`;

    try {
        let response = await callGeminiWithRotation([systemPrompt, userPrompt].join('\n'));
        if (!response) {
            response = await callMistralUnified(systemPrompt + '\n' + userPrompt, ctx, 1000);
        }
        
        // 🆕 Nettoyer la réponse
        response = cleanResponse(response);

        return response;
        
    } catch (error) {
        log.error(`❌ Erreur réponse naturelle: ${error.message}`);
        return "Oh mince, je suis un peu perdue là... Peux-tu reformuler s'il te plaît ? 💕";
    }
}

// ========================================
// 🔍 DÉTECTION COMMANDES INTELLIGENTES
// ========================================

const VALID_COMMANDS = [
    'help', 'aide', 'image', 'anime', 'vision', 'search', 'recherche', 'chat', 'contact', 'stats', 'clan', 'rank', 'echecs' // Ajouté echecs
];

async function detectIntelligentCommands(userMessage, conversationHistory, ctx) {
    const { log } = ctx;
    
    const prompt = `Analyse ce message utilisateur: "${userMessage}"

Historique récent: ${conversationHistory.map(m => `${m.role}: ${m.content}`).join('\n')}

Détecte si c'est une commande implicite pour NakamaBot.

Commandes valides: ${VALID_COMMANDS.join(', ')}

Règles:
- Seulement si intention claire (ex: "génère une image de chat" → image)
- Confidence: 0-1 (1 = certain, 0.7+ pour exécuter)
- Args: extrait le reste du message
- Retourne "none" si aucune

Pour /image: seuil assoupli (0.6+ si mention "image" ou "génère visuel")

Réponds en JSON:
{
  "command": string (sans /, ou "none"),
  "args": string,
  "confidence": number (0-1),
  "reason": string
}`;

    try {
        let detectionStr = await callGeminiWithRotation(prompt);
        if (!detectionStr) {
            detectionStr = await callMistralUnified(prompt, ctx, 200);
        }
        
        const detection = JSON.parse(detectionStr);
        
        // Fix: Strip slash if present
        detection.command = detection.command.replace('/', '').trim();
        
        const threshold = detection.command === 'image' ? 0.6 : 0.7;
        
        const shouldExecute = detection.command !== 'none' && 
                              VALID_COMMANDS.includes(detection.command) && 
                              detection.confidence >= threshold;
        
        log.info(`🧠 Détection commande: ${detection.command} (conf: ${detection.confidence}) - Execute: ${shouldExecute}`);
        
        return {
            shouldExecute,
            command: detection.command,
            args: detection.args || '',
            confidence: detection.confidence,
            reason: detection.reason
        };
        
    } catch (error) {
        log.error(`❌ Erreur détection commande: ${error.message}`);
        return {
            shouldExecute: false,
            command: 'none',
            args: '',
            confidence: 0,
            reason: 'Erreur détection'
        };
    }
}

// ========================================
// 🔄 CONVERSATION AVEC FALLBACK
// ========================================

async function handleConversationWithFallback(senderId, args, ctx, searchResults = null) {
    const { addToMemory, getMemoryContext, log, truncatedMessages, splitMessageIntoChunks } = ctx;
    
    const senderIdStr = String(senderId);
    const conversationHistory = getMemoryContext(senderIdStr).slice(-8);
    
    try {
        let response;
        
        try {
            response = await generateNaturalResponseWithContext(args, conversationHistory, searchResults, ctx);
        } catch (error) {
            log.warning(`⚠️ Gemini échoué, fallback Mistral: ${error.message}`);
            response = await callMistralUnified(
                `Réponds amicalement à: "${args}"\nHistorique: ${conversationHistory.map(m => m.content).join('\n')}\nRecherche: ${searchResults || 'Aucune'}`,
                ctx,
                800
            );
        }
        
        if (!response) {
            throw new Error('Aucune réponse des IA');
        }
        
        const styledResponse = parseMarkdown(response);
        
        // 🆕 Gestion troncature synchronisée
        const chunks = splitMessageIntoChunks(styledResponse, 2000);
        
        if (chunks.length > 0) {
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
