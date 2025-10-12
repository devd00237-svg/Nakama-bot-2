/**
 * NakamaBot - Commande /chat UNIFIÉE avec Gemini + Mistral
 * + Détection commandes 100% IA (Gemini ET Mistral)
 * + Recherche contextuelle (Gemini ET Mistral)
 * + Support Markdown vers Unicode
 * + Optimisation: skip Gemini si toutes les clés sont mortes
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
    // 🆕 OPTIMISATION: Skip si toutes les clés sont mortes
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
        // Convertir le prompt en format messages Mistral
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
        
        // 🆕 Essayer Gemini d'abord si disponible, sinon Mistral
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

Si recherche nécessaire ET continuation contextuelle, ENRICHIS la requête avec entités précédentes.
Si sensible au temps (sports, actualités) sans date, ajoute 2025.

Réponds UNIQUEMENT avec ce JSON:
{
  "needsExternalSearch": true/false,
  "confidence": 0.0-1.0,
  "reason": "explication",
  "searchQuery": "requête_optimisée",
  "usesConversationMemory": true/false
}`;

        let response;
        
        // 🆕 Essayer Gemini d'abord si disponible, sinon Mistral
        if (!checkIfAllGeminiKeysDead()) {
            try {
                response = await callGeminiWithRotation(decisionPrompt);
                log.info(`💎 Décision recherche via Gemini`);
            } catch (geminiError) {
                log.warning(`⚠️ Gemini échec décision: ${geminiError.message}`);
                response = await callMistralUnified(decisionPrompt, ctx, 500);
                log.info(`🔄 Décision recherche via Mistral`);
            }
        } else {
            response = await callMistralUnified(decisionPrompt, ctx, 500);
            log.info(`🔄 Décision recherche via Mistral (Gemini désactivé)`);
        }
        
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        
        if (jsonMatch) {
            const decision = JSON.parse(jsonMatch[0]);
            
            log.info(`🤖 Décision: ${decision.needsExternalSearch ? 'OUI' : 'NON'} (${decision.confidence})`);
            log.info(`📝 Raison: ${decision.reason}`);
            
            if (decision.usesConversationMemory) {
                log.info(`🧠 Utilise mémoire conversationnelle`);
            }
            
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
// 🎯 DÉTECTION COMMANDES - GEMINI OU MISTRAL
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
        
        const detectionPrompt = `Tu es un système de détection de commandes INTELLIGENT.

COMMANDES DISPONIBLES: ${commandsList}

HISTORIQUE RÉCENT:
${recentHistory}

MESSAGE ACTUEL: "${message}"

⚠️ IMPORTANT: La commande /help est DÉJÀ intégrée dans le système conversationnel, ne la détecte PAS.

VRAIES INTENTIONS DE COMMANDES (confidence >= 0.85):
✅ /image: Demande EXPLICITE de CRÉER/GÉNÉRER une image, dessin, illustration (ex: "dessine-moi un chat", "génère une image de...")
✅ /vision: Demande EXPLICITE d'ANALYSER une image déjà envoyée (ex: "décris cette image", "que vois-tu sur la photo")
✅ /anime: Demande EXPLICITE de TRANSFORMER une image en style anime/manga (ex: "transforme en anime", "style manga")
✅ /music: Demande EXPLICITE de RECHERCHER/JOUER une musique sur YouTube (ex: "joue la chanson...", "cherche musique de...")
✅ /clan: Demande EXPLICITE liée aux clans du bot (ex: "créer un clan", "rejoindre clan", "bataille clan")
✅ /rank: Demande EXPLICITE de voir ses STATISTIQUES personnelles dans le bot (ex: "mon niveau", "ma progression", "mon rang")
✅ /contact: Demande EXPLICITE de CONTACTER les administrateurs (ex: "contacter admin", "envoyer message à Durand")
✅ /weather: Demande EXPLICITE de MÉTÉO avec lieu précis (ex: "météo à Paris", "quel temps fait-il à Lyon")

❌ FAUSSES DÉTECTIONS (NE PAS DÉTECTER):
- Questions générales mentionnant un mot-clé: "quel chanteur a chanté cette musique" ≠ /music
- Conversations normales: "j'aime la musique", "le temps passe", "aide mon ami", "besoin d'aide"
- Descriptions: "cette image est belle", "il fait chaud", "niveau débutant"
- Questions informatives: "c'est quoi la météo", "les clans vikings", "comment ça marche"
- Demandes d'aide générale: "aide-moi", "j'ai besoin d'aide" ≠ /help (déjà intégré au système)

RÈGLES STRICTES:
1. L'utilisateur DOIT vouloir UTILISER une fonctionnalité SPÉCIFIQUE du bot
2. Il DOIT y avoir une DEMANDE D'ACTION CLAIRE et DIRECTE
3. Tenir compte du CONTEXTE conversationnel
4. Confidence MINIMUM 0.85 pour valider
5. En cas de doute → NE PAS détecter de commande

Réponds UNIQUEMENT avec ce JSON:
{
  "isCommand": true/false,
  "command": "nom_commande_ou_null",
  "confidence": 0.0-1.0,
  "extractedArgs": "arguments_ou_message_complet",
  "reason": "explication",
  "conversationContext": "analyse_contexte"
}`;

        let response;
        
        // 🆕 Essayer Gemini d'abord si disponible, sinon Mistral
        if (!checkIfAllGeminiKeysDead()) {
            try {
                response = await callGeminiWithRotation(detectionPrompt);
                log.info(`💎 Détection commande via Gemini`);
            } catch (geminiError) {
                log.warning(`⚠️ Gemini échec détection: ${geminiError.message}`);
                response = await callMistralUnified(detectionPrompt, ctx, 500);
                log.info(`🔄 Détection commande via Mistral`);
            }
        } else {
            response = await callMistralUnified(detectionPrompt, ctx, 500);
            log.info(`🔄 Détection commande via Mistral (Gemini désactivé)`);
        }
        
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        
        if (jsonMatch) {
            const aiDetection = JSON.parse(jsonMatch[0]);
            
            const isValid = aiDetection.isCommand && 
                          VALID_COMMANDS.includes(aiDetection.command) && 
                          aiDetection.confidence >= 0.85;
            
            if (isValid) {
                log.info(`🎯 Commande détectée: /${aiDetection.command} (${aiDetection.confidence})`);
                log.info(`📝 Raison: ${aiDetection.reason}`);
                
                return {
                    shouldExecute: true,
                    command: aiDetection.command,
                    args: aiDetection.extractedArgs,
                    confidence: aiDetection.confidence,
                    method: 'ai_unified'
                };
            } else if (aiDetection.confidence > 0.4 && aiDetection.confidence < 0.85) {
                log.info(`🚫 Commande rejetée (confidence ${aiDetection.confidence})`);
            }
        }
        
        return { shouldExecute: false };
        
    } catch (error) {
        log.warning(`⚠️ Erreur détection commandes: ${error.message}`);
        return { shouldExecute: false };
    }
}

// ========================================
// 🎭 GÉNÉRATION RÉPONSE - GEMINI OU MISTRAL
// ========================================

async function generateNaturalResponseWithContext(originalQuery, searchResults, conversationContext, ctx) {
    const { log } = ctx;
    
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
        
        const contextualPrompt = `Tu es NakamaBot, une IA conversationnelle empathique avec MÉMOIRE CONTEXTUELLE.

CONTEXTE TEMPOREL: ${dateTime}

HISTORIQUE COMPLET:
${conversationHistory || "Début de conversation"}

QUESTION ACTUELLE: "${originalQuery}"

INFORMATIONS TROUVÉES:
${resultsText}

INSTRUCTIONS:
- Tu as MÉMOIRE COMPLÈTE de la conversation
- Si référence à quelque chose mentionné avant, tu SAIS de quoi il s'agit
- Réponds en tenant compte du contexte complet
- Ton amical avec quelques emojis
- Maximum 1999 caractères
- NE MENTIONNE JAMAIS que tu as fait une recherche
- NE DIS JAMAIS "d'après mes recherches", "selon les sources"
- Réponds naturellement comme si tu connaissais ces infos
- Markdown simple (**gras**, ### titres, listes)
- PAS d'italique (*texte*)

RÉPONSE NATURELLE:`;

        let response;
        
        // 🆕 Essayer Gemini d'abord si disponible, sinon Mistral
        if (!checkIfAllGeminiKeysDead()) {
            try {
                response = await callGeminiWithRotation(contextualPrompt);
                log.info(`💎 Réponse contextuelle Gemini`);
                
                if (response && response.trim()) {
                    return response;
                }
            } catch (geminiError) {
                log.warning(`⚠️ Gemini échec réponse: ${geminiError.message}`);
            }
        }
        
        // Fallback Mistral
        const messages = [{
            role: "system",
            content: `Tu es NakamaBot avec MÉMOIRE COMPLÈTE. Réponds naturellement. Ne mentionne JAMAIS de recherches. Markdown simple OK.

Historique:
${conversationHistory || "Début"}`
        }, {
            role: "user", 
            content: `Question: "${originalQuery}"

Informations:
${resultsText}

Réponds naturellement (max 2000 chars):`
        }];
        
        const mistralResponse = await ctx.callMistralAPI(messages, 2000, 0.7);
        
        if (mistralResponse) {
            log.info(`🔄 Réponse contextuelle Mistral`);
            return mistralResponse;
        }
        
        throw new Error('Toutes les IA ont échoué');
        
    } catch (error) {
        log.error(`❌ Erreur génération réponse: ${error.message}`);
        
        const topResult = searchResults[0];
        if (topResult) {
            return `D'après ce que je sais, ${topResult.description} 💡`;
        }
        
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
    
    // 🆕 INJECTION RÉSULTATS RECHERCHE
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

    // 🆕 ESSAYER GEMINI D'ABORD SI DISPONIBLE
    if (!checkIfAllGeminiKeysDead()) {
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
                        log.info(`💎 Gemini avec troncature${searchResults ? ' (+ recherche)' : ''}`);
                        return truncatedResponse;
                    }
                }
                
                addToMemory(senderIdStr, 'user', args);
                addToMemory(senderIdStr, 'assistant', styledResponse);
                log.info(`💎 Gemini réponse${searchResults ? ' (+ recherche)' : ''}`);
                return styledResponse;
            }
            
        } catch (geminiError) {
            log.warning(`⚠️ Gemini échec conversation: ${geminiError.message}`);
        }
    } else {
        log.info(`⏩ Gemini désactivé - Utilisation directe de Mistral`);
    }
    
    // 🆕 FALLBACK MISTRAL
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
                    log.info(`🔄 Mistral avec troncature${searchResults ? ' (+ recherche)' : ''}`);
                    return truncatedResponse;
                }
            }
            
            addToMemory(senderIdStr, 'user', args);
            addToMemory(senderIdStr, 'assistant', styledResponse);
            log.info(`🔄 Mistral réponse${searchResults ? ' (+ recherche)' : ''}`);
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
        log.info(`⚙️ Exécution de la commande /${commandName} avec args: "${args.substring(0, 100)}..."`);
        
        const COMMANDS = global.COMMANDS || new Map();
        
        // Vérifier si la commande est chargée dans global.COMMANDS
        if (COMMANDS.has(commandName)) {
            log.debug(`✅ Commande /${commandName} trouvée dans COMMANDS globales`);
            const commandFunction = COMMANDS.get(commandName);
            const result = await commandFunction(senderId, args, ctx);
            log.info(`✅ Résultat commande /${commandName}: ${typeof result === 'object' ? 'Object' : result.substring(0, 100)}`);
            return { success: true, result };
        }
        
        // Sinon, essayer de charger directement depuis le fichier
        const path = require('path');
        const fs = require('fs');
        const commandPath = path.join(__dirname, `${commandName}.js`);
        
        if (fs.existsSync(commandPath)) {
            log.debug(`✅ Fichier commande trouvé: ${commandPath}`);
            delete require.cache[require.resolve(commandPath)];
            const commandModule = require(commandPath);
            
            if (typeof commandModule === 'function') {
                log.debug(`✅ Module commande chargé pour /${commandName}`);
                const result = await commandModule(senderId, args, ctx);
                log.info(`✅ Résultat commande /${commandName}: ${typeof result === 'object' ? 'Object' : result.substring(0, 100)}`);
                return { success: true, result };
            } else {
                log.error(`❌ Le module ${commandName}.js n'exporte pas une fonction`);
                return { success: false, error: `Module ${commandName} invalide` };
            }
        }
        
        log.error(`❌ Commande ${commandName} introuvable (ni dans COMMANDS ni en fichier)`);
        return { success: false, error: `Commande ${commandName} non trouvée` };
        
    } catch (error) {
        log.error(`❌ Erreur fatale lors de l'exécution de /${commandName}: ${error.message}`);
        log.error(`📊 Stack: ${error.stack}`);
        return { success: false, error: error.message };
    }
}

async function generateContextualResponse(originalMessage, commandResult, commandName, ctx) {
    const { log } = ctx;
    
    // Si c'est une image, retourner directement
    if (typeof commandResult === 'object' && commandResult.type === 'image') {
        log.debug(`🖼️ Résultat de type image pour /${commandName}, retour direct`);
        return commandResult;
    }
    
    // Si le résultat est déjà une réponse complète et naturelle, le retourner tel quel
    if (typeof commandResult === 'string' && commandResult.length > 100) {
        log.debug(`📝 Résultat /${commandName} déjà complet, retour direct`);
        return commandResult;
    }
    
    try {
        const contextPrompt = `L'utilisateur a dit: "${originalMessage}"

La commande /${commandName} a retourné: "${commandResult}"

Réponds naturellement et amicalement pour présenter ce résultat (max 400 chars). Markdown simple OK (**gras**, listes), pas d'italique.`;

        let response;
        
        // 🆕 Essayer Gemini d'abord si disponible
        if (!checkIfAllGeminiKeysDead()) {
            try {
                response = await callGeminiWithRotation(contextPrompt);
                if (response && response.trim()) {
                    log.info(`💎 Réponse contextuelle Gemini pour /${commandName}`);
                    return response;
                }
            } catch (geminiError) {
                log.debug(`⚠️ Gemini échec réponse contextuelle: ${geminiError.message}`);
            }
        }
        
        // Fallback Mistral
        response = await ctx.callMistralAPI([
            { role: "system", content: "Tu es NakamaBot. Réponds naturellement pour présenter le résultat d'une commande. Markdown simple OK." },
            { role: "user", content: `Utilisateur: "${originalMessage}"\n\nRésultat commande /${commandName}: "${commandResult}"\n\nPrésente naturellement (max 300 chars):` }
        ], 300, 0.7);
        
        if (response && response.trim()) {
            log.info(`🔄 Réponse contextuelle Mistral pour /${commandName}`);
            return response;
        }
        
        // Si tout échoue, retourner le résultat brut
        log.warning(`⚠️ Échec génération réponse contextuelle, retour résultat brut`);
        return commandResult;
        
    } catch (error) {
        log.error(`❌ Erreur génération réponse contextuelle: ${error.message}`);
        return commandResult;
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
    
    // Délai 5 secondes entre messages
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
    
    // Nettoyage cache
    for (const [signature, timestamp] of recentMessages.entries()) {
        if (currentTime - timestamp > 120000) {
            recentMessages.delete(signature);
        }
    }
    
    try {
        // Message de traitement
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
        
        // Récupérer historique complet
        const conversationHistory = getMemoryContext(String(senderId)).slice(-10);
        
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
        
        // Détection commandes IA (SAUF help qui est intégré au système)
        const intelligentCommand = await detectIntelligentCommands(args, conversationHistory, ctx);
        if (intelligentCommand.shouldExecute) {
            log.info(`🧠 Commande IA détectée: /${intelligentCommand.command} (${intelligentCommand.confidence})`);
            log.info(`📝 Raison: ${intelligentCommand.reason}`);
            log.info(`🎯 Redirection vers processCommand comme si l'user avait tapé /${intelligentCommand.command}`);
            
            // 🔥 NOUVEAU: Rediriger vers processCommand EXACTEMENT comme si l'user avait tapé la commande
            // Sauvegarder le message original dans la mémoire
            addToMemory(String(senderId), 'user', args);
            
            // Construire la commande exacte comme si l'user l'avait tapée
            const simulatedCommand = `/${intelligentCommand.command} ${intelligentCommand.args}`;
            log.info(`🔄 Simulation commande: "${simulatedCommand}"`);
            
            // Libérer la requête active pour permettre processCommand de fonctionner
            activeRequests.delete(senderId);
            
            // Appeler processCommand du contexte (celui du server.js)
            if (ctx.processCommand) {
                try {
                    const commandResponse = await ctx.processCommand(senderId, simulatedCommand);
                    log.info(`✅ Commande /${intelligentCommand.command} exécutée via processCommand`);
                    
                    // Ne pas ajouter à la mémoire ici car processCommand le fait déjà
                    return commandResponse;
                } catch (error) {
                    log.error(`❌ Erreur processCommand pour /${intelligentCommand.command}: ${error.message}`);
                    // Continue vers conversation normale en cas d'erreur
                }
            } else {
                log.error(`❌ ctx.processCommand non disponible - impossible d'exécuter la commande`);
                // Continue vers conversation normale
            }
        } else {
            log.debug(`🔍 Aucune commande détectée dans: "${args.substring(0, 50)}..."`);
        }
        
        // Décision recherche avec mémoire
        const searchDecision = await decideSearchNecessity(args, senderId, conversationHistory, ctx);
        
        let searchResults = null;
        if (searchDecision.needsExternalSearch) {
            log.info(`🔍 Recherche externe: ${searchDecision.reason}`);
            if (searchDecision.usesConversationMemory) {
                log.info(`🧠 Requête enrichie: "${searchDecision.searchQuery}"`);
            }
            
            try {
                searchResults = await performIntelligentSearch(searchDecision.searchQuery, ctx);
                
                if (searchResults && searchResults.length > 0) {
                    log.info(`🔍✅ ${searchResults.length} résultats trouvés`);
                } else {
                    log.warning(`⚠️ Aucun résultat - Conversation normale`);
                    searchResults = null;
                }
            } catch (searchError) {
                log.error(`❌ Erreur recherche: ${searchError.message}`);
                searchResults = null;
            }
        }
        
        // Conversation unifiée avec/sans recherche
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
