/**
 * NakamaBot - Commande /chat avec MÉMOIRE CONTEXTUELLE et recherche GRATUITE
 * + Détection commandes 100% IA (pas de mots-clés)
 * + Recherche contextuelle basée sur l'historique de conversation
 * + Support Markdown vers Unicode stylisé pour Facebook Messenger
 * + Système de troncature synchronisé
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

// 🆕 CACHE DE CONTEXTE CONVERSATIONNEL (pour analyse contextuelle)
const conversationContext = new Map(); // senderId -> { lastTopic, entities, intent }

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
// 🧠 ANALYSE CONTEXTUELLE DE CONVERSATION
// ========================================

/**
 * 🆕 EXTRACTION DU CONTEXTE CONVERSATIONNEL
 * Analyse l'historique pour comprendre le sujet actuel et les entités mentionnées
 */
async function analyzeConversationContext(senderId, currentMessage, conversationHistory, ctx) {
    const { log } = ctx;
    
    try {
        // Construire l'historique des 5 derniers messages
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
4. **Référence contextuelle** : le message actuel fait-il référence à quelque chose mentionné avant ? (ex: "leur rang" → référence à une équipe mentionnée)

EXEMPLES:
- Historique: "Le Cameroun est quantième ?" / Actuel: "je veux leur rang dans leur poule"
  → Sujet: "Cameroun football classement", Entités: ["Cameroun", "poule"], Intention: "continuation", Référence: "Cameroun (mentionné précédemment)"

- Historique: "Qui est Messi ?" / Actuel: "combien de buts il a marqué ?"
  → Sujet: "Messi statistiques", Entités: ["Messi", "buts"], Intention: "continuation", Référence: "Messi (mentionné précédemment)"

Réponds UNIQUEMENT avec ce JSON:
{
  "mainTopic": "sujet_principal_complet",
  "entities": ["entité1", "entité2"],
  "intent": "nouvelle_question|continuation|clarification|changement_sujet",
  "contextualReference": "description_de_la_référence_ou_null",
  "enrichedQuery": "requête_de_recherche_enrichie_avec_contexte"
}`;

        const response = await callGeminiWithRotation(contextPrompt);
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        
        if (jsonMatch) {
            const context = JSON.parse(jsonMatch[0]);
            
            // Sauvegarder le contexte pour cet utilisateur
            conversationContext.set(senderId, {
                lastTopic: context.mainTopic,
                entities: context.entities,
                intent: context.intent,
                timestamp: Date.now()
            });
            
            log.info(`🧠 Contexte analysé: ${context.intent} | Sujet: ${context.mainTopic}`);
            if (context.contextualReference) {
                log.info(`🔗 Référence contextuelle détectée: ${context.contextualReference}`);
            }
            
            return context;
        }
        
        throw new Error('Format JSON invalide');
        
    } catch (error) {
        log.warning(`⚠️ Erreur analyse contexte: ${error.message}`);
        
        // Fallback: retourner le message brut
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
// 🤖 DÉCISION IA POUR RECHERCHE (AVEC CONTEXTE)
// ========================================

async function decideSearchNecessity(userMessage, senderId, conversationHistory, ctx) {
    const { log } = ctx;
    
    try {
        // 🆕 D'ABORD: Analyser le contexte conversationnel
        const contextAnalysis = await analyzeConversationContext(senderId, userMessage, conversationHistory, ctx);
        
        // Construire l'historique pour la décision
        const recentHistory = conversationHistory.slice(-5).map(msg => 
            `${msg.role === 'user' ? 'Utilisateur' : 'Bot'}: ${msg.content}`
        ).join('\n');
        
        const decisionPrompt = `Tu es un système de décision intelligent pour un chatbot avec MÉMOIRE CONTEXTUELLE.

HISTORIQUE RÉCENT:
${recentHistory}

MESSAGE ACTUEL: "${userMessage}"

ANALYSE CONTEXTUELLE:
- Sujet principal: ${contextAnalysis.mainTopic}
- Entités clés: ${contextAnalysis.entities.join(', ')}
- Intention: ${contextAnalysis.intent}
- Référence: ${contextAnalysis.contextualReference || 'aucune'}

RÈGLES DE DÉCISION:

✅ RECHERCHE NÉCESSAIRE si:
- Informations récentes/actuelles (actualités, événements 2025-2026)
- Données factuelles spécifiques (classements sportifs, prix, statistiques, dates)
- Questions de continuation nécessitant des données externes (ex: "leur rang" après avoir parlé d'une équipe)
- Informations locales/géographiques
- Questions sur personnes publiques récentes
- Météo, cours, résultats sportifs

❌ PAS DE RECHERCHE si:
- Conversations générales/philosophiques
- Conseils/opinions personnelles
- Questions sur le bot lui-même
- Créativité (histoires, poèmes)
- Explications de concepts généraux que l'IA connaît
- Questions existantes dans la base de connaissances

🔍 REQUÊTE ENRICHIE:
Si recherche nécessaire ET que c'est une continuation contextuelle, ENRICHIS la requête avec les entités précédentes.
Exemple: Message actuel "leur rang dans leur poule" + Contexte "Cameroun football" → Requête: "Cameroun classement poule football 2025"

Réponds UNIQUEMENT avec ce JSON:
{
  "needsExternalSearch": true/false,
  "confidence": 0.0-1.0,
  "reason": "explication_détaillée",
  "searchQuery": "requête_optimisée_avec_contexte",
  "usesConversationMemory": true/false
}`;

        const response = await callGeminiWithRotation(decisionPrompt);
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        
        if (jsonMatch) {
            const decision = JSON.parse(jsonMatch[0]);
            
            log.info(`🤖 Décision recherche: ${decision.needsExternalSearch ? 'OUI' : 'NON'} (${decision.confidence})`);
            log.info(`📝 Raison: ${decision.reason}`);
            
            if (decision.usesConversationMemory) {
                log.info(`🧠 Utilise la mémoire conversationnelle pour enrichir la recherche`);
            }
            
            return decision;
        }
        
        throw new Error('Format invalide');
        
    } catch (error) {
        log.warning(`⚠️ Erreur décision recherche: ${error.message}`);
        
        // Fallback simple
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
// 🎯 DÉTECTION COMMANDES 100% IA (PAS DE MOTS-CLÉS)
// ========================================

const VALID_COMMANDS = [
    'help', 'image', 'vision', 'anime', 'music', 
    'clan', 'rank', 'contact', 'weather'
];

async function detectIntelligentCommands(message, conversationHistory, ctx) {
    const { log } = ctx;
    
    try {
        const commandsList = VALID_COMMANDS.map(cmd => `/${cmd}`).join(', ');
        
        // Construire l'historique pour contexte
        const recentHistory = conversationHistory.slice(-3).map(msg => 
            `${msg.role === 'user' ? 'Utilisateur' : 'Bot'}: ${msg.content}`
        ).join('\n');
        
        const detectionPrompt = `Tu es un système de détection de commandes ULTRA-INTELLIGENT avec MÉMOIRE CONTEXTUELLE.

COMMANDES DISPONIBLES: ${commandsList}

HISTORIQUE RÉCENT:
${recentHistory}

MESSAGE ACTUEL: "${message}"

ANALYSE INTENTION PROFONDE:

🎯 VRAIS INTENTIONS (confidence 0.85-1.0):
✅ help: Demande d'aide, guide, liste des fonctionnalités
✅ image: Demande explicite de création/génération d'image, dessin, illustration
✅ vision: Demande d'analyse d'une image, description visuelle (suppose qu'une image est envoyée)
✅ anime: Demande de transformation en style anime/manga d'une image
✅ music: Demande de recherche de musique sur YouTube, jouer une chanson
✅ clan: Demande liée aux clans du bot (rejoindre, créer, bataille)
✅ rank: Demande de statistiques personnelles, niveau, progression dans le bot
✅ contact: Demande de contacter les administrateurs, signaler un problème
✅ weather: Demande de météo, prévisions, température

❌ FAUSSES DÉTECTIONS (confidence 0.0-0.4):
- Questions générales mentionnant un mot-clé: "quel chanteur a chanté cette musique" ≠ /music
- Conversations normales: "j'aime la musique", "le temps passe", "aide mon ami"
- Descriptions: "cette image est belle", "il fait chaud", "niveau débutant"
- Questions informatives: "c'est quoi la météo", "les clans vikings"

RÈGLES STRICTES:
1. L'utilisateur DOIT vouloir UTILISER une fonctionnalité du bot
2. Il DOIT y avoir une DEMANDE D'ACTION claire dirigée vers le bot
3. Tenir compte du CONTEXTE conversationnel (si on vient de parler de football et il dit "leur classement", ce n'est PAS une commande)
4. Ne détecte une commande QUE si confidence >= 0.85

Réponds UNIQUEMENT avec ce JSON:
{
  "isCommand": true/false,
  "command": "nom_commande_ou_null",
  "confidence": 0.0-1.0,
  "extractedArgs": "arguments_extraits_ou_message_complet",
  "reason": "explication_détaillée",
  "conversationContext": "analyse_du_contexte"
}`;

        const response = await callGeminiWithRotation(detectionPrompt);
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        
        if (jsonMatch) {
            const aiDetection = JSON.parse(jsonMatch[0]);
            
            // Validation stricte: seuil élevé de 0.85
            const isValid = aiDetection.isCommand && 
                          VALID_COMMANDS.includes(aiDetection.command) && 
                          aiDetection.confidence >= 0.85;
            
            if (isValid) {
                log.info(`🎯 Commande IA détectée: /${aiDetection.command} (${aiDetection.confidence})`);
                log.info(`📝 Raison: ${aiDetection.reason}`);
                log.info(`🧠 Contexte: ${aiDetection.conversationContext}`);
                
                return {
                    shouldExecute: true,
                    command: aiDetection.command,
                    args: aiDetection.extractedArgs,
                    confidence: aiDetection.confidence,
                    method: 'ai_100percent'
                };
            } else if (aiDetection.confidence > 0.4 && aiDetection.confidence < 0.85) {
                log.info(`🚫 Commande rejetée (confidence ${aiDetection.confidence}): ${aiDetection.reason}`);
            }
        }
        
        return { shouldExecute: false };
        
    } catch (error) {
        log.warning(`⚠️ Erreur détection IA commandes: ${error.message}`);
        return { shouldExecute: false };
    }
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
        
        const contextualPrompt = `Tu es NakamaBot, une IA conversationnelle empathique avec MÉMOIRE CONTEXTUELLE.

CONTEXTE TEMPOREL: ${dateTime}

HISTORIQUE COMPLET DE CONVERSATION:
${conversationHistory || "Début de conversation"}

QUESTION ACTUELLE: "${originalQuery}"

INFORMATIONS TROUVÉES VIA RECHERCHE:
${resultsText}

INSTRUCTIONS CRITIQUES:
- Tu as une MÉMOIRE COMPLÈTE de toute la conversation ci-dessus
- Si l'utilisateur fait référence à quelque chose mentionné avant (ex: "leur rang", "combien de buts", "son âge"), tu SAIS de quoi il parle grâce à l'historique
- Réponds en tenant compte de TOUT le contexte précédent
- Ton conversationnel et amical avec quelques emojis
- Maximum 1999 caractères
- NE MENTIONNE JAMAIS que tu as fait une recherche
- NE DIS JAMAIS "d'après mes recherches", "selon les sources", "j'ai trouvé"
- Réponds naturellement comme si tu connaissais déjà ces informations
- Si c'est une question de suivi (ex: "leur rang" après avoir parlé du Cameroun), intègre naturellement le contexte
- Utilise Markdown simple (**gras**, ### titres, listes)
- PAS d'italique (*texte*)

EXEMPLE DE RÉPONSE CONTEXTUELLE:
Historique: "Le Cameroun est quantième ?" → Bot: "Le Cameroun est 56ème..."
Actuel: "leur rang dans leur poule" → Bot: "Le Cameroun est 2ème de sa poule avec..."

RÉPONSE NATURELLE EN CONTINUITÉ:`;

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
                content: `Tu es NakamaBot avec MÉMOIRE COMPLÈTE. Tu connais tout l'historique. Réponds naturellement en tenant compte du contexte. Ne mentionne JAMAIS de recherches. Markdown simple OK.

Historique complet:
${conversationContext ? conversationContext.map(msg => `${msg.role === 'user' ? 'Utilisateur' : 'NakamaBot'}: ${msg.content}`).join('\n') : "Début"}`
            }, {
                role: "user", 
                content: `Question actuelle: "${originalQuery}"

Informations trouvées:
${searchResults.map(r => `${r.title}: ${r.description}`).join('\n')}

Réponds naturellement en continuité de la conversation, comme si tu connaissais déjà ces infos (max 2000 chars):`
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
// 💬 CONVERSATION UNIFIÉE AVEC RECHERCHE INTÉGRÉE
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
    
    // 🆕 INJECTION DYNAMIQUE DES RÉSULTATS DE RECHERCHE
    let searchContext = "";
    if (searchResults && searchResults.length > 0) {
        searchContext = `\n\n🔍 INFORMATIONS RÉCENTES DISPONIBLES (utilise-les naturellement si pertinent):
${searchResults.map((result, index) => 
    `${index + 1}. ${result.title}: ${result.description}`
).join('\n\n')}

⚠️ IMPORTANT: Ne mentionne JAMAIS que tu as fait une recherche. Intègre ces informations naturellement dans ta réponse comme si tu les connaissais déjà.`;
    }
    
    const systemPrompt = `Tu es NakamaBot, une IA conversationnelle avancée avec MÉMOIRE CONTEXTUELLE créée par Durand et Cécile.

CONTEXTE TEMPOREL: ${dateTime}

INTELLIGENCE & PERSONNALITÉ:
- Empathique, créative et intuitive avec MÉMOIRE COMPLÈTE de la conversation
- Tu te souviens de TOUT ce qui a été dit dans l'historique ci-dessous
- Si l'utilisateur fait référence à quelque chose mentionné avant, tu SAIS de quoi il parle
- Pédagogue naturelle qui explique clairement
- Adaptable selon contexte

CAPACITÉS:
🎨 Création d'images ("dessine-moi...")
👁️ Analyse d'images ("regarde cette image")
🌸 Transformation anime ("style manga")
🎵 Recherche musicale YouTube ("joue...")
🛡️ Système clans et batailles ("clan")
📊 Progression et niveau ("mon niveau")
📞 Contact admin ("contacter admin")
🔍 Recherche intelligente automatique avec mémoire contextuelle
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
- UTILISE ta MÉMOIRE: si l'utilisateur dit "et lui ?", "combien ?", "leur classement ?", tu sais de qui/quoi il parle grâce à l'historique
- Si des informations récentes sont disponibles ci-dessous, intègre-les naturellement sans jamais dire "j'ai trouvé" ou "d'après mes recherches"

HISTORIQUE COMPLET:
${conversationHistory ? conversationHistory : 'Début de conversation'}
${searchContext}

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
                    log.info(`💎 Gemini avec troncature${searchResults ? ' (+ recherche intégrée)' : ''}`);
                    return truncatedResponse;
                }
            }
            
            addToMemory(senderIdStr, 'user', args);
            addToMemory(senderIdStr, 'assistant', styledResponse);
            log.info(`💎 Gemini réponse normale${searchResults ? ' (+ recherche intégrée)' : ''}`);
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
                        log.info(`🔄 Mistral avec troncature${searchResults ? ' (+ recherche intégrée)' : ''}`);
                        return truncatedResponse;
                    }
                }
                
                addToMemory(senderIdStr, 'user', args);
                addToMemory(senderIdStr, 'assistant', styledResponse);
                log.info(`🔄 Mistral fallback${searchResults ? ' (+ recherche intégrée)' : ''}`);
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
// 🛡️ FONCTION PRINCIPALE AVEC MÉMOIRE
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
        
        // 🆕 RÉCUPÉRER L'HISTORIQUE COMPLET pour analyse contextuelle
        const conversationHistory = getMemoryContext(String(senderId)).slice(-10); // 10 derniers messages
        
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
        
        // 🆕 DÉTECTION COMMANDES 100% IA avec historique
        const intelligentCommand = await detectIntelligentCommands(args, conversationHistory, ctx);
        if (intelligentCommand.shouldExecute) {
            log.info(`🧠 Commande IA détectée: /${intelligentCommand.command} (${intelligentCommand.confidence})`);
            
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
        
        // 🆕 DÉCISION RECHERCHE AVEC MÉMOIRE CONTEXTUELLE (en arrière-plan)
        const searchDecision = await decideSearchNecessity(args, senderId, conversationHistory, ctx);
        
        let searchResults = null;
        if (searchDecision.needsExternalSearch) {
            log.info(`🔍 Recherche externe nécessaire: ${searchDecision.reason}`);
            if (searchDecision.usesConversationMemory) {
                log.info(`🧠 Requête enrichie avec mémoire: "${searchDecision.searchQuery}"`);
            }
            
            try {
                // Lancer la recherche en parallèle (ne bloque pas la conversation)
                searchResults = await performIntelligentSearch(searchDecision.searchQuery, ctx);
                
                if (searchResults && searchResults.length > 0) {
                    log.info(`🔍✅ ${searchResults.length} résultats trouvés - Intégration dans la conversation`);
                } else {
                    log.warning(`⚠️ Aucun résultat trouvé - Conversation normale`);
                    searchResults = null;
                }
            } catch (searchError) {
                log.error(`❌ Erreur recherche: ${searchError.message} - Continuation en conversation normale`);
                searchResults = null;
            }
        }
        
        // 🆕 CONVERSATION UNIFIÉE: avec ou sans résultats de recherche
        // La conversation continue naturellement, les résultats sont juste injectés si disponibles
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
module.exports.getNextGeminiKey = getNextGeminiKey;
module.exports.markKeyAsFailed = markKeyAsFailed;
module.exports.parseMarkdown = parseMarkdown;
module.exports.toBold = toBold;
module.exports.toUnderline = toUnderline;
module.exports.toStrikethrough = toStrikethrough;
