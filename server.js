const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(bodyParser.json());

// Configuration 
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "nakamaverifytoken";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "";
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || "";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const GITHUB_USERNAME = process.env.GITHUB_USERNAME || "";
const GITHUB_REPO = process.env.GITHUB_REPO || "nakamabot-data";
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT || 5000}`;
const ADMIN_IDS = new Set(
    (process.env.ADMIN_IDS || "").split(",").map(id => id.trim()).filter(id => id)
);

// ✅ NOUVEAU: Configuration Google Search API avec rotation
const GOOGLE_API_KEYS = (process.env.GOOGLE_API_KEYS || "").split(",").map(key => key.trim()).filter(key => key);
const GOOGLE_SEARCH_ENGINE_IDS = (process.env.GOOGLE_SEARCH_ENGINE_IDS || "").split(",").map(id => id.trim()).filter(id => id);

// Variables pour la rotation des clés Google
let currentGoogleKeyIndex = 0;
let currentSearchEngineIndex = 0;
const googleKeyUsage = new Map(); // Suivre l'utilisation des clés
const GOOGLE_DAILY_LIMIT = 100; // Limite par clé par jour
const GOOGLE_RETRY_DELAY = 5000; // Délai entre les tentatives (augmenté pour éviter 429)
const userSpamData = new Map(); // Tracker anti-spam par user

// Mémoire du bot (stockage local temporaire + sauvegarde permanente GitHub)
const userMemory = new Map();
const userList = new Set();
const userLastImage = new Map();
const clanData = new Map(); // Stockage des données spécifiques aux commandes

// ✅ NOUVEAU: Référence vers la commande rank pour le système d'expérience
let rankCommand = null;

// 🆕 AJOUT: Gestion des messages tronqués avec chunks
const truncatedMessages = new Map(); // senderId -> { fullMessage, lastSentPart }

// Configuration des logs
const log = {
    info: (msg) => console.log(`${new Date().toISOString()} - INFO - ${msg}`),
    error: (msg) => console.error(`${new Date().toISOString()} - ERROR - ${msg}`),
    warning: (msg) => console.warn(`${new Date().toISOString()} - WARNING - ${msg}`),
    debug: (msg) => console.log(`${new Date().toISOString()} - DEBUG - ${msg}`)
};

// === FONCTIONS DE GESTION DES MESSAGES TRONQUÉS ===

/**
 * Divise un message en chunks de taille appropriée pour Messenger
 * @param {string} text - Texte complet
 * @param {number} maxLength - Taille maximale par chunk (défaut: 2000)
 * @returns {Array} - Array des chunks
 */
function splitMessageIntoChunks(text, maxLength = 2000) {
    if (!text || text.length <= maxLength) {
        return [text];
    }
    
    const chunks = [];
    let currentChunk = '';
    const lines = text.split('\n');
    
    for (const line of lines) {
        // Si ajouter cette ligne dépasse la limite
        if (currentChunk.length + line.length + 1 > maxLength) {
            // Si le chunk actuel n'est pas vide, le sauvegarder
            if (currentChunk.trim()) {
                chunks.push(currentChunk.trim());
                currentChunk = '';
            }
            
            // Si la ligne elle-même est trop longue, la couper
            if (line.length > maxLength) {
                const words = line.split(' ');
                let currentLine = '';
                
                for (const word of words) {
                    if (currentLine.length + word.length + 1 > maxLength) {
                        if (currentLine.trim()) {
                            chunks.push(currentLine.trim());
                            currentLine = word;
                        } else {
                            // Mot unique trop long, le couper brutalement
                            chunks.push(word.substring(0, maxLength - 3) + '...');
                            currentLine = word.substring(maxLength - 3);
                        }
                    } else {
                        currentLine += (currentLine ? ' ' : '') + word;
                    }
                }
                
                if (currentLine.trim()) {
                    currentChunk = currentLine;
                }
            } else {
                currentChunk = line;
            }
        } else {
            currentChunk += (currentChunk ? '\n' : '') + line;
        }
    }
    
    // Ajouter le dernier chunk s'il n'est pas vide
    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
    }
    
    return chunks.length > 0 ? chunks : [text];
}

/**
 * Détecte si l'utilisateur demande la suite d'un message tronqué
 * @param {string} message - Message de l'utilisateur
 * @returns {boolean} - True si c'est une demande de continuation
 */
function isContinuationRequest(message) {
    const lowerMessage = message.toLowerCase().trim();
    const continuationPatterns = [
        /^(continue|continuer?)$/,
        /^(suite|la suite)$/,
        /^(après|ensuite)$/,
        /^(plus|encore)$/,
        /^(next|suivant)$/,
        /^\.\.\.$/,
        /^(termine|fini[sr]?)$/
    ];
    
    return continuationPatterns.some(pattern => pattern.test(lowerMessage));
}

// === GESTION GOOGLE SEARCH API AVEC ROTATION ===

/**
 * Obtient la prochaine clé Google API disponible
 * @returns {Object|null} - {apiKey, searchEngineId, keyIndex, engineIndex} ou null
 */
function getNextGoogleKey() {
    if (GOOGLE_API_KEYS.length === 0 || GOOGLE_SEARCH_ENGINE_IDS.length === 0) {
        log.warning("⚠️ Aucune clé Google Search API configurée");
        return null;
    }
    
    const today = new Date().toDateString();
    
    // ✅ CORRECTION: Essayer toutes les combinaisons sans distinction de taille
    const totalKeys = GOOGLE_API_KEYS.length;
    const totalEngines = GOOGLE_SEARCH_ENGINE_IDS.length;
    const totalCombinations = totalKeys * totalEngines;
    
    // Essayer toutes les combinaisons possibles
    for (let attempt = 0; attempt < totalCombinations; attempt++) {
        const keyIndex = (currentGoogleKeyIndex + Math.floor(attempt / totalEngines)) % totalKeys;
        const engineIndex = (currentSearchEngineIndex + (attempt % totalEngines)) % totalEngines;
        
        const apiKey = GOOGLE_API_KEYS[keyIndex];
        const searchEngineId = GOOGLE_SEARCH_ENGINE_IDS[engineIndex];
        const keyId = `${keyIndex}-${engineIndex}-${today}`;
        
        const usage = googleKeyUsage.get(keyId) || 0;
        
        if (usage < GOOGLE_DAILY_LIMIT) {
            log.debug(`🔑 Utilisation clé Google ${keyIndex}/${engineIndex}: ${usage}/${GOOGLE_DAILY_LIMIT}`);
            return {
                apiKey,
                searchEngineId,
                keyIndex,
                engineIndex,
                keyId,
                usage
            };
        }
    }
    
    log.error("❌ Toutes les clés Google Search API ont atteint leur limite quotidienne");
    return null;
}

/**
 * Met à jour l'usage d'une clé Google et fait tourner les indices
 * @param {string} keyId - ID de la clé utilisée
 * @param {number} keyIndex - Index de la clé
 * @param {number} engineIndex - Index du moteur
 * @param {boolean} success - Si la requête a réussi
 */
function updateGoogleKeyUsage(keyId, keyIndex, engineIndex, success) {
    if (success) {
        googleKeyUsage.set(keyId, (googleKeyUsage.get(keyId) || 0) + 1);
        log.debug(`📈 Usage clé Google ${keyIndex}/${engineIndex}: ${googleKeyUsage.get(keyId)}/${GOOGLE_DAILY_LIMIT}`);
    }
    
    // Faire tourner les indices pour la prochaine utilisation
    currentSearchEngineIndex = (currentSearchEngineIndex + 1) % GOOGLE_SEARCH_ENGINE_IDS.length;
    if (currentSearchEngineIndex === 0) {
        currentGoogleKeyIndex = (currentGoogleKeyIndex + 1) % GOOGLE_API_KEYS.length;
    }
}

/**
 * Effectue une recherche Google avec rotation des clés
 * @param {string} query - Requête de recherche
 * @param {number} numResults - Nombre de résultats (défaut: 5)
 * @returns {Array|null} - Résultats de recherche ou null
 */
async function googleSearch(query, numResults = 5) {
    if (!query || typeof query !== 'string') {
        log.warning("⚠️ Requête de recherche vide");
        return null;
    }
    
    const googleKey = getNextGoogleKey();
    if (!googleKey) {
        return null;
    }
    
    const { apiKey, searchEngineId, keyIndex, engineIndex, keyId } = googleKey;
    
    try {
        log.info(`🔍 Recherche Google avec clé ${keyIndex}/${engineIndex}: "${query.substring(0, 50)}..."`);
        
        // ✅ CORRECTION: Ajouter un délai pour éviter le rate limiting (augmenté à 1000ms)
        await sleep(1000);
        
        const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
            params: {
                key: apiKey,
                cx: searchEngineId,
                q: query,
                num: Math.min(numResults, 10), // Maximum 10 résultats par requête
                safe: 'active',
                lr: 'lang_fr', // Priorité au français
                gl: 'fr' // Géolocalisation France
            },
            timeout: 15000 // ✅ CORRECTION: Timeout plus long
        });
        
        if (response.status === 200 && response.data.items) {
            updateGoogleKeyUsage(keyId, keyIndex, engineIndex, true);
            
            const results = response.data.items.map(item => ({
                title: item.title,
                link: item.link,
                snippet: item.snippet,
                displayLink: item.displayLink
            }));
            
            log.info(`✅ ${results.length} résultats Google trouvés avec clé ${keyIndex}/${engineIndex}`);
            return results;
        } else {
            log.warning(`⚠️ Réponse Google vide avec clé ${keyIndex}/${engineIndex}`);
            return null;
        }
        
    } catch (error) {
        if (error.response) {
            const status = error.response.status;
            const errorData = error.response.data;
            
            if (status === 403) {
                if (errorData.error?.errors?.[0]?.reason === 'dailyLimitExceeded') {
                    log.warning(`⚠️ Limite quotidienne atteinte pour clé Google ${keyIndex}/${engineIndex}`);
                    // Marquer cette clé comme épuisée
                    googleKeyUsage.set(keyId, GOOGLE_DAILY_LIMIT);
                    
                    // ✅ CORRECTION: Essayer avec la clé suivante SEULEMENT s'il y en a d'autres
                    const totalCombinations = GOOGLE_API_KEYS.length * GOOGLE_SEARCH_ENGINE_IDS.length;
                    if (totalCombinations > 1) {
                        log.info("🔄 Tentative avec clé suivante...");
                        await sleep(GOOGLE_RETRY_DELAY);
                        return await googleSearch(query, numResults);
                    } else {
                        log.warning("⚠️ Une seule combinaison clé/moteur disponible et épuisée");
                        return null;
                    }
                } else if (errorData.error?.errors?.[0]?.reason === 'keyInvalid') {
                    log.error(`❌ Clé Google API invalide ${keyIndex}/${engineIndex}`);
                } else {
                    log.error(`❌ Erreur Google API 403 avec clé ${keyIndex}/${engineIndex}: ${JSON.stringify(errorData)}`);
                }
            } else if (status === 429) {
                log.warning(`⚠️ Rate limit Google avec clé ${keyIndex}/${engineIndex}, retry avec délai plus long...`);
                
                // ✅ AMÉLIORATION: Boucle de retry avec backoff exponentiel (jusqu'à 3 tentatives)
                let retrySuccess = false;
                let retryDelay = GOOGLE_RETRY_DELAY;
                for (let retryAttempt = 1; retryAttempt <= 3; retryAttempt++) {
                    await sleep(retryDelay);
                    try {
                        const retryResponse = await axios.get('https://www.googleapis.com/customsearch/v1', {
                            params: {
                                key: apiKey,
                                cx: searchEngineId,
                                q: query,
                                num: Math.min(numResults, 10),
                                safe: 'active',
                                lr: 'lang_fr',
                                gl: 'fr'
                            },
                            timeout: 20000
                        });
                        
                        if (retryResponse.status === 200 && retryResponse.data.items) {
                            updateGoogleKeyUsage(keyId, keyIndex, engineIndex, true);
                            
                            const results = retryResponse.data.items.map(item => ({
                                title: item.title,
                                link: item.link,
                                snippet: item.snippet,
                                displayLink: item.displayLink
                            }));
                            
                            log.info(`✅ ${results.length} résultats Google trouvés avec clé ${keyIndex}/${engineIndex} (retry ${retryAttempt})`);
                            retrySuccess = true;
                            return results;
                        }
                    } catch (retryError) {
                        log.warning(`⚠️ Échec retry ${retryAttempt} pour clé ${keyIndex}/${engineIndex}: ${retryError.message}`);
                        retryDelay *= 2; // Backoff exponentiel
                    }
                }
                
                if (!retrySuccess) {
                    // Essayer la clé suivante si disponible
                    const totalCombinations = GOOGLE_API_KEYS.length * GOOGLE_SEARCH_ENGINE_IDS.length;
                    if (totalCombinations > 1) {
                        log.info("🔄 Tentative avec clé suivante après rate limit...");
                        await sleep(1000); // Délai supplémentaire avant de switcher
                        return await googleSearch(query, numResults);
                    }
                }
                return null;
            } else {
                log.error(`❌ Erreur Google API ${status} avec clé ${keyIndex}/${engineIndex}: ${error.message}`);
            }
        } else {
            log.error(`❌ Erreur réseau Google Search: ${error.message}`);
        }
        
        updateGoogleKeyUsage(keyId, keyIndex, engineIndex, false);
        return null;
    }
}

// ✅ RECHERCHE WEB AMÉLIORÉE avec Google Search API + fallback Mistral + gestion rate limiting
async function webSearch(query) {
    if (!query || typeof query !== 'string') {
        return "Oh non ! Je n'ai pas compris ta recherche... 🤔";
    }
    
    try {
        // ✅ CORRECTION: Vérifier si Google Search est disponible avant d'essayer
        if (GOOGLE_API_KEYS.length === 0 || GOOGLE_SEARCH_ENGINE_IDS.length === 0) {
            log.info(`🔄 Google Search non configuré, utilisation de Mistral pour: "${query}"`);
            return await fallbackMistralSearch(query);
        }
        
        // Essayer d'abord avec Google Search API
        const googleResults = await googleSearch(query, 5);
        
        if (googleResults && googleResults.length > 0) {
            // Formater les résultats Google pour une réponse amicale
            let response = `🔍 J'ai trouvé ça pour "${query}" :\n\n`;
            
            googleResults.slice(0, 3).forEach((result, index) => {
                response += `${index + 1}. **${result.title}**\n`;
                response += `${result.snippet}\n`;
                response += `🔗 ${result.link}\n\n`;
            });
            
            if (googleResults.length > 3) {
                response += `... et ${googleResults.length - 3} autres résultats ! 📚\n`;
            }
            
            response += "\n💡 Besoin de plus d'infos ? N'hésite pas à me poser des questions ! 💕";
            return response;
        } else {
            // ✅ CORRECTION: Fallback propre vers Mistral
            log.info(`🔄 Google Search échoué, fallback Mistral pour: "${query}"`);
            return await fallbackMistralSearch(query);
        }
        
    } catch (error) {
        log.error(`❌ Erreur recherche complète: ${error.message}`);
        
        // ✅ CORRECTION: Si erreur 429, passer directement au fallback
        if (error.response?.status === 429) {
            log.info(`🔄 Rate limit détecté, utilisation du fallback Mistral pour: "${query}"`);
            return await fallbackMistralSearch(query);
        }
        
        return "Oh non ! Une petite erreur de recherche... Désolée ! 💕";
    }
}

// ✅ NOUVELLE FONCTION: Fallback Mistral séparée pour éviter la duplication
async function fallbackMistralSearch(query) {
    try {
        const searchContext = `Recherche web pour '${query}' en 2025. Je peux répondre avec mes connaissances de 2025.`;
        const messages = [{
            role: "system",
            content: `Tu es NakamaBot, une assistante IA très gentille et amicale qui aide avec les recherches. Nous sommes en 2025. Réponds à cette recherche: '${query}' avec tes connaissances de 2025. Si tu ne sais pas, dis-le gentiment. Réponds en français avec une personnalité amicale et bienveillante, maximum 400 caractères.`
        }];
        
        const mistralResult = await callMistralAPI(messages, 200, 0.3);
        
        if (mistralResult) {
            return `🤖 Voici ce que je sais sur "${query}" :\n\n${mistralResult}\n\n💕 (Recherche basée sur mes connaissances - Pour des infos plus récentes, réessaie plus tard !)`;
        } else {
            return `😔 Désolée, je n'arrive pas à trouver d'infos sur "${query}" pour le moment... Réessaie plus tard ? 💕`;
        }
    } catch (error) {
        log.error(`❌ Erreur fallback Mistral: ${error.message}`);
        return `😔 Désolée, impossible de rechercher "${query}" maintenant... Réessaie plus tard ? 💕`;
    }
}

// === GESTION GITHUB API ===

// Encoder en base64 pour GitHub
function encodeBase64(content) {
    return Buffer.from(JSON.stringify(content, null, 2), 'utf8').toString('base64');
}

// Décoder depuis base64 GitHub
function decodeBase64(content) {
    return JSON.parse(Buffer.from(content, 'base64').toString('utf8'));
}

// URL de base pour l'API GitHub
const getGitHubApiUrl = (filename) => {
    return `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/contents/${filename}`;
};

// Créer le repository GitHub si nécessaire
async function createGitHubRepo() {
    if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
        log.error("❌ GITHUB_TOKEN ou GITHUB_USERNAME manquant pour créer le repo");
        return false;
    }

    try {
        const checkResponse = await axios.get(
            `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}`,
            {
                headers: {
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json'
                },
                timeout: 10000
            }
        );
        
        if (checkResponse.status === 200) {
            log.info(`✅ Repository ${GITHUB_REPO} existe déjà`);
            return true;
        }
    } catch (error) {
        if (error.response?.status === 404) {
            try {
                const createResponse = await axios.post(
                    'https://api.github.com/user/repos',
                    {
                        name: GITHUB_REPO,
                        description: 'Sauvegarde des données NakamaBot - Créé automatiquement',
                        private: true,
                        auto_init: true
                    },
                    {
                        headers: {
                            'Authorization': `token ${GITHUB_TOKEN}`,
                            'Accept': 'application/vnd.github.v3+json'
                        },
                        timeout: 15000
                    }
                );

                if (createResponse.status === 201) {
                    log.info(`🎉 Repository ${GITHUB_REPO} créé avec succès !`);
                    log.info(`📝 URL: https://github.com/${GITHUB_USERNAME}/${GITHUB_REPO}`);
                    return true;
                }
            } catch (createError) {
                log.error(`❌ Erreur création repository: ${createError.message}`);
                return false;
            }
        } else {
            log.error(`❌ Erreur vérification repository: ${error.message}`);
            return false;
        }
    }

    return false;
}

// Variable pour éviter les sauvegardes simultanées
let isSaving = false;
let saveQueue = [];

// === SAUVEGARDE GITHUB AVEC SUPPORT CLANS ET EXPÉRIENCE ===
async function saveDataToGitHub() {
    if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
        log.debug("🔄 Pas de sauvegarde GitHub (config manquante)");
        return;
    }

    if (isSaving) {
        log.debug("⏳ Sauvegarde déjà en cours, ajout à la queue");
        return new Promise((resolve) => {
            saveQueue.push(resolve);
        });
    }

    isSaving = true;

    try {
        log.debug(`💾 Tentative de sauvegarde sur GitHub: ${GITHUB_USERNAME}/${GITHUB_REPO}`);
        
        const filename = 'nakamabot-data.json';
        const url = getGitHubApiUrl(filename);
        
        const dataToSave = {
            userList: Array.from(userList),
            userMemory: Object.fromEntries(userMemory),
            userLastImage: Object.fromEntries(userLastImage),
            
            // ✅ NOUVEAU: Sauvegarder les données d'expérience
            userExp: rankCommand ? rankCommand.getExpData() : {},
            
            // 🆕 NOUVEAU: Sauvegarder les messages tronqués
            truncatedMessages: Object.fromEntries(truncatedMessages),
            
            // ✅ NOUVEAU: Sauvegarder l'usage des clés Google
            googleKeyUsage: Object.fromEntries(googleKeyUsage),
            currentGoogleKeyIndex,
            currentSearchEngineIndex,
            
            // Données des clans et autres commandes
            clanData: commandContext.clanData || null,
            commandData: Object.fromEntries(clanData),
            
            lastUpdate: new Date().toISOString(),
            version: "4.0 Amicale + Vision + GitHub + Clans + Rank + Truncation + Google Search",
            totalUsers: userList.size,
            totalConversations: userMemory.size,
            totalImages: userLastImage.size,
            totalTruncated: truncatedMessages.size,
            totalClans: commandContext.clanData ? Object.keys(commandContext.clanData.clans || {}).length : 0,
            totalUsersWithExp: rankCommand ? Object.keys(rankCommand.getExpData()).length : 0,
            totalGoogleKeys: GOOGLE_API_KEYS.length,
            totalSearchEngines: GOOGLE_SEARCH_ENGINE_IDS.length,
            bot: "NakamaBot",
            creator: "Durand"
        };

        const commitData = {
            message: `🤖 Sauvegarde automatique NakamaBot - ${new Date().toISOString()}`,
            content: encodeBase64(dataToSave)
        };

        let maxRetries = 3;
        let success = false;

        for (let attempt = 1; attempt <= maxRetries && !success; attempt++) {
            try {
                const existingResponse = await axios.get(url, {
                    headers: {
                        'Authorization': `token ${GITHUB_TOKEN}`,
                        'Accept': 'application/vnd.github.v3+json'
                    },
                    timeout: 10000
                });

                if (existingResponse.data?.sha) {
                    commitData.sha = existingResponse.data.sha;
                }

                const response = await axios.put(url, commitData, {
                    headers: {
                        'Authorization': `token ${GITHUB_TOKEN}`,
                        'Accept': 'application/vnd.github.v3+json'
                    },
                    timeout: 15000
                });

                if (response.status === 200 || response.status === 201) {
                    const clanCount = commandContext.clanData ? Object.keys(commandContext.clanData.clans || {}).length : 0;
                    const expDataCount = rankCommand ? Object.keys(rankCommand.getExpData()).length : 0;
                    log.info(`💾 Données sauvegardées sur GitHub (${userList.size} users, ${userMemory.size} convs, ${userLastImage.size} imgs, ${clanCount} clans, ${expDataCount} exp, ${truncatedMessages.size} trunc, ${GOOGLE_API_KEYS.length} Google keys)`);
                    success = true;
                } else {
                    log.error(`❌ Erreur sauvegarde GitHub: ${response.status}`);
                }

            } catch (retryError) {
                if (retryError.response?.status === 409 && attempt < maxRetries) {
                    log.warning(`⚠️ Conflit SHA détecté (409), tentative ${attempt}/${maxRetries}, retry dans 1s...`);
                    await sleep(1000);
                    continue;
                } else if (retryError.response?.status === 404 && attempt === 1) {
                    log.debug("📝 Premier fichier, pas de SHA nécessaire");
                    delete commitData.sha;
                    continue;
                } else {
                    throw retryError;
                }
            }
        }

        if (!success) {
            log.error("❌ Échec de sauvegarde après plusieurs tentatives");
        }

    } catch (error) {
        if (error.response?.status === 404) {
            log.error("❌ Repository GitHub introuvable pour la sauvegarde (404)");
            log.error(`🔍 Repository utilisé: ${GITHUB_USERNAME}/${GITHUB_REPO}`);
        } else if (error.response?.status === 401) {
            log.error("❌ Token GitHub invalide pour la sauvegarde (401)");
        } else if (error.response?.status === 403) {
            log.error("❌ Accès refusé GitHub pour la sauvegarde (403)");
        } else if (error.response?.status === 409) {
            log.warning("⚠️ Conflit SHA persistant - sauvegarde ignorée pour éviter les blocages");
        } else {
            log.error(`❌ Erreur sauvegarde GitHub: ${error.message}`);
        }
    } finally {
        isSaving = false;
        
        const queueCallbacks = [...saveQueue];
        saveQueue = [];
        queueCallbacks.forEach(callback => callback());
    }
}

// === CHARGEMENT GITHUB AVEC SUPPORT CLANS ET EXPÉRIENCE ===
async function loadDataFromGitHub() {
    if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
        log.warning("⚠️ Configuration GitHub manquante, utilisation du stockage temporaire uniquement");
        return;
    }

    try {
        log.info(`🔍 Tentative de chargement depuis GitHub: ${GITHUB_USERNAME}/${GITHUB_REPO}`);
        
        const filename = 'nakamabot-data.json';
        const url = getGitHubApiUrl(filename);
        
        const response = await axios.get(url, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            timeout: 10000
        });

        if (response.status === 200 && response.data.content) {
            const data = decodeBase64(response.data.content);
            
            // Charger userList
            if (data.userList && Array.isArray(data.userList)) {
                data.userList.forEach(userId => userList.add(userId));
                log.info(`✅ ${data.userList.length} utilisateurs chargés depuis GitHub`);
            }

            // Charger userMemory
            if (data.userMemory && typeof data.userMemory === 'object') {
                Object.entries(data.userMemory).forEach(([userId, memory]) => {
                    if (Array.isArray(memory)) {
                        userMemory.set(userId, memory);
                    }
                });
                log.info(`✅ ${Object.keys(data.userMemory).length} conversations chargées depuis GitHub`);
            }

            // Charger userLastImage
            if (data.userLastImage && typeof data.userLastImage === 'object') {
                Object.entries(data.userLastImage).forEach(([userId, imageUrl]) => {
                    userLastImage.set(userId, imageUrl);
                });
                log.info(`✅ ${Object.keys(data.userLastImage).length} images chargées depuis GitHub`);
            }

            // 🆕 NOUVEAU: Charger les messages tronqués
            if (data.truncatedMessages && typeof data.truncatedMessages === 'object') {
                Object.entries(data.truncatedMessages).forEach(([userId, truncData]) => {
                    if (truncData && typeof truncData === 'object') {
                        truncatedMessages.set(userId, truncData);
                    }
                });
                log.info(`✅ ${Object.keys(data.truncatedMessages).length} messages tronqués chargés depuis GitHub`);
            }

            // ✅ NOUVEAU: Charger les données anti-spam
            if (data.userSpamData && typeof data.userSpamData === 'object') {
                Object.entries(data.userSpamData).forEach(([userId, spamInfo]) => {
                    userSpamData.set(userId, spamInfo);
                });
                log.info(`✅ ${Object.keys(data.userSpamData).length} données anti-spam chargées depuis GitHub`);
            }

            // ✅ NOUVEAU: Charger l'usage des clés Google
            if (data.googleKeyUsage && typeof data.googleKeyUsage === 'object') {
                Object.entries(data.googleKeyUsage).forEach(([keyId, usage]) => {
                    googleKeyUsage.set(keyId, usage);
                });
                log.info(`✅ ${Object.keys(data.googleKeyUsage).length} données d'usage Google chargées depuis GitHub`);
            }

            // Charger les indices des clés Google
            if (typeof data.currentGoogleKeyIndex === 'number') {
                currentGoogleKeyIndex = data.currentGoogleKeyIndex;
            }
            if (typeof data.currentSearchEngineIndex === 'number') {
                currentSearchEngineIndex = data.currentSearchEngineIndex;
            }

            // ✅ NOUVEAU: Charger les données d'expérience
            if (data.userExp && typeof data.userExp === 'object' && rankCommand) {
                rankCommand.loadExpData(data.userExp);
                log.info(`✅ ${Object.keys(data.userExp).length} données d'expérience chargées depuis GitHub`);
            }

            // Charger les données des clans
            if (data.clanData && typeof data.clanData === 'object') {
                commandContext.clanData = data.clanData;
                const clanCount = Object.keys(data.clanData.clans || {}).length;
                log.info(`✅ ${clanCount} clans chargés depuis GitHub`);
            }

            // Charger autres données de commandes
            if (data.commandData && typeof data.commandData === 'object') {
                Object.entries(data.commandData).forEach(([key, value]) => {
                    clanData.set(key, value);
                });
                log.info(`✅ ${Object.keys(data.commandData).length} données de commandes chargées depuis GitHub`);
            }

            log.info("🎉 Données chargées avec succès depuis GitHub !");
        }
    } catch (error) {
        if (error.response?.status === 404) {
            log.warning("📁 Aucune sauvegarde trouvée sur GitHub - Première utilisation");
            log.info("🔧 Création du fichier de sauvegarde initial...");
            
            const repoCreated = await createGitHubRepo();
            if (repoCreated) {
                await saveDataToGitHub();
            }
        } else if (error.response?.status === 401) {
            log.error("❌ Token GitHub invalide (401) - Vérifiez votre GITHUB_TOKEN");
        } else if (error.response?.status === 403) {
            log.error("❌ Accès refusé GitHub (403) - Vérifiez les permissions de votre token");
        } else {
            log.error(`❌ Erreur chargement GitHub: ${error.message}`);
            if (error.response) {
                log.error(`📊 Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
            }
        }
    }
}

// Sauvegarder automatiquement toutes les 5 minutes
let saveInterval;
function startAutoSave() {
    if (saveInterval) {
        clearInterval(saveInterval);
    }
    
    saveInterval = setInterval(async () => {
        await saveDataToGitHub();
    }, 5 * 60 * 1000); // 5 minutes
    
    log.info("🔄 Sauvegarde automatique GitHub activée (toutes les 5 minutes)");
}

// Sauvegarder lors de changements importants (non-bloquant)
async function saveDataImmediate() {
    saveDataToGitHub().catch(err => 
        log.debug(`🔄 Sauvegarde en arrière-plan: ${err.message}`)
    );
}

// === UTILITAIRES ===

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Appel API Mistral avec retry
async function callMistralAPI(messages, maxTokens = 200, temperature = 0.7) {
    if (!MISTRAL_API_KEY) {
        return null;
    }
    
    const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${MISTRAL_API_KEY}`
    };
    
    const data = {
        model: "mistral-small-latest",
        messages: messages,
        max_tokens: maxTokens,
        temperature: temperature
    };
    
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const response = await axios.post(
                "https://api.mistral.ai/v1/chat/completions",
                data,
                { headers, timeout: 30000 }
            );
            
            if (response.status === 200) {
                return response.data.choices[0].message.content;
            } else if (response.status === 401) {
                log.error("❌ Clé API Mistral invalide");
                return null;
            } else {
                if (attempt === 0) {
                    await sleep(2000);
                    continue;
                }
                return null;
            }
        } catch (error) {
            if (attempt === 0) {
                await sleep(2000);
                continue;
            }
            log.error(`❌ Erreur Mistral: ${error.message}`);
            return null;
        }
    }
    
    return null;
}

// Analyser une image avec l'API Vision de Mistral
async function analyzeImageWithVision(imageUrl) {
    if (!MISTRAL_API_KEY) {
        return null;
    }
    
    try {
        const headers = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${MISTRAL_API_KEY}`
        };
        
        const messages = [{
            role: "user",
            content: [
                {
                    type: "text",
                    text: "Décris en détail ce que tu vois dans cette image en français. Sois précise et descriptive, comme si tu expliquais à un(e) ami(e). Maximum 300 mots avec des emojis mignons. 💕"
                },
                {
                    type: "image_url",
                    image_url: {
                        url: imageUrl
                    }
                }
            ]
        }];
        
        const data = {
            model: "pixtral-12b-2409",
            messages: messages,
            max_tokens: 400,
            temperature: 0.3
        };
        
        const response = await axios.post(
            "https://api.mistral.ai/v1/chat/completions",
            data,
            { headers, timeout: 30000 }
        );
        
        if (response.status === 200) {
            return response.data.choices[0].message.content;
        } else {
            log.error(`❌ Erreur Vision API: ${response.status}`);
            return null;
        }
    } catch (error) {
        log.error(`❌ Erreur analyse image: ${error.message}`);
        return null;
    }
}

// ✅ GESTION CORRIGÉE DE LA MÉMOIRE - ÉVITER LES DOUBLONS
function addToMemory(userId, msgType, content) {
    if (!userId || !msgType || !content) {
        log.debug("❌ Paramètres manquants pour addToMemory");
        return;
    }
    
    if (content.length > 1500) {
        content = content.substring(0, 1400) + "...[tronqué]";
    }
    
    if (!userMemory.has(userId)) {
        userMemory.set(userId, []);
    }
    
    const memory = userMemory.get(userId);
    
    // ✅ NOUVELLE LOGIQUE: Vérifier les doublons
    if (memory.length > 0) {
        const lastMessage = memory[memory.length - 1];
        
        if (lastMessage.type === msgType && lastMessage.content === content) {
            log.debug(`🔄 Doublon évité pour ${userId}: ${msgType.substring(0, 50)}...`);
            return;
        }
        
        if (msgType === 'assistant' && lastMessage.type === 'assistant') {
            const similarity = calculateSimilarity(lastMessage.content, content);
            if (similarity > 0.8) {
                log.debug(`🔄 Doublon assistant évité (similarité: ${Math.round(similarity * 100)}%)`);
                return;
            }
        }
    }
    
    memory.push({
        type: msgType,
        content: content,
        timestamp: new Date().toISOString()
    });
    
    if (memory.length > 8) {
        memory.shift();
    }
    
    log.debug(`💭 Ajouté en mémoire [${userId}]: ${msgType} (${content.length} chars)`);
    
    saveDataImmediate().catch(err => 
        log.debug(`🔄 Erreur sauvegarde mémoire: ${err.message}`)
    );
}

// ✅ FONCTION UTILITAIRE: Calculer la similarité entre deux textes
function calculateSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;
    
    const normalize = (text) => text.toLowerCase().replace(/[^\w\s]/g, '').trim();
    const norm1 = normalize(text1);
    const norm2 = normalize(text2);
    
    if (norm1 === norm2) return 1;
    
    const words1 = new Set(norm1.split(/\s+/));
    const words2 = new Set(norm2.split(/\s+/));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
}

function getMemoryContext(userId) {
    const context = [];
    const memory = userMemory.get(userId) || [];
    
    for (const msg of memory) {
        const role = msg.type === 'user' ? 'user' : 'assistant';
        context.push({ role, content: msg.content });
    }
    
    return context;
}

function isAdmin(userId) {
    return ADMIN_IDS.has(String(userId));
}

// === FONCTIONS D'ENVOI AVEC GESTION DE TRONCATURE ===

async function sendMessage(recipientId, text) {
    if (!PAGE_ACCESS_TOKEN) {
        log.error("❌ PAGE_ACCESS_TOKEN manquant");
        return { success: false, error: "No token" };
    }
    
    if (!text || typeof text !== 'string') {
        log.warning("⚠️ Message vide");
        return { success: false, error: "Empty message" };
    }
    
    // 🆕 GESTION INTELLIGENTE DES MESSAGES LONGS
    if (text.length > 2000) {
        log.info(`📏 Message long détecté (${text.length} chars) pour ${recipientId} - Division en chunks`);
        
        const chunks = splitMessageIntoChunks(text, 2000);
        
        if (chunks.length > 1) {
            // Envoyer le premier chunk avec indicateur de continuation
            const firstChunk = chunks[0] + "\n\n📝 *Tape \"continue\" pour la suite...*";
            
            // Sauvegarder l'état de troncature
            truncatedMessages.set(String(recipientId), {
                fullMessage: text,
                lastSentPart: chunks[0]
            });
            
            // Sauvegarder immédiatement
            saveDataImmediate();
            
            return await sendSingleMessage(recipientId, firstChunk);
        }
    }
    
    // Message normal
    return await sendSingleMessage(recipientId, text);
}

async function sendSingleMessage(recipientId, text) {
    let finalText = text;
    if (finalText.length > 2000 && !finalText.includes("✨ [Message tronqué avec amour]")) {
        finalText = finalText.substring(0, 1950) + "...\n✨ [Message tronqué avec amour]";
    }
    
    const data = {
        recipient: { id: String(recipientId) },
        message: { text: finalText }
    };
    
    try {
        const response = await axios.post(
            "https://graph.facebook.com/v18.0/me/messages",
            data,
            {
                params: { access_token: PAGE_ACCESS_TOKEN },
                timeout: 15000
            }
        );
        
        if (response.status === 200) {
            return { success: true };
        } else {
            log.error(`❌ Erreur Facebook API: ${response.status}`);
            return { success: false, error: `API Error ${response.status}` };
        }
    } catch (error) {
        log.error(`❌ Erreur envoi: ${error.message}`);
        return { success: false, error: error.message };
    }
}

async function sendImageMessage(recipientId, imageUrl, caption = "") {
    if (!PAGE_ACCESS_TOKEN) {
        log.error("❌ PAGE_ACCESS_TOKEN manquant");
        return { success: false, error: "No token" };
    }
    
    if (!imageUrl) {
        log.warning("⚠️ URL d'image vide");
        return { success: false, error: "Empty image URL" };
    }
    
    const data = {
        recipient: { id: String(recipientId) },
        message: {
            attachment: {
                type: "image",
                payload: {
                    url: imageUrl,
                    is_reusable: true
                }
            }
        }
    };
    
    try {
        const response = await axios.post(
            "https://graph.facebook.com/v18.0/me/messages",
            data,
            {
                params: { access_token: PAGE_ACCESS_TOKEN },
                timeout: 20000
            }
        );
        
        if (response.status === 200) {
            if (caption) {
                await sleep(500);
                return await sendMessage(recipientId, caption);
            }
            return { success: true };
        } else {
            log.error(`❌ Erreur envoi image: ${response.status}`);
            return { success: false, error: `API Error ${response.status}` };
        }
    } catch (error) {
        log.error(`❌ Erreur envoi image: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// === CHARGEMENT DES COMMANDES ===

const COMMANDS = new Map();

// === CONTEXTE DES COMMANDES AVEC SUPPORT CLANS ET EXPÉRIENCE ===
const commandContext = {
    // Variables globales
    VERIFY_TOKEN,
    PAGE_ACCESS_TOKEN,
    MISTRAL_API_KEY,
    GITHUB_TOKEN,
    GITHUB_USERNAME,
    GITHUB_REPO,
    ADMIN_IDS,
    
    // ✅ NOUVEAU: Variables Google Search
    GOOGLE_API_KEYS,
    GOOGLE_SEARCH_ENGINE_IDS,
    googleKeyUsage,
    currentGoogleKeyIndex,
    currentSearchEngineIndex,
    
    userMemory,
    userList,
    userLastImage,
    
    // ✅ AJOUT: Données persistantes pour les commandes
    clanData: null, // Sera initialisé par les commandes
    commandData: clanData, // Map pour autres données de commandes
    
    // 🆕 AJOUT: Gestion des messages tronqués
    truncatedMessages,
    
    // Fonctions utilitaires
    log,
    sleep,
    getRandomInt,
    callMistralAPI,
    analyzeImageWithVision,
    webSearch,
    googleSearch, // ✅ NOUVEAU: Accès direct à Google Search
    addToMemory,
    getMemoryContext,
    isAdmin,
    sendMessage,
    sendImageMessage,
    
    // 🆕 AJOUT: Fonctions de gestion de troncature
    splitMessageIntoChunks,
    isContinuationRequest,

    userSpamData, // ✅ NOUVEAU: Tracker anti-spam
    
    // Fonctions de sauvegarde GitHub
    saveDataToGitHub,
    saveDataImmediate,
    loadDataFromGitHub,
    createGitHubRepo
};

// ✅ FONCTION loadCommands MODIFIÉE pour capturer la commande rank
function loadCommands() {
    const commandsDir = path.join(__dirname, 'Cmds');
    
    if (!fs.existsSync(commandsDir)) {
        log.error("❌ Dossier 'Cmds' introuvable");
        return;
    }
    
    const commandFiles = fs.readdirSync(commandsDir).filter(file => file.endsWith('.js'));
    
    log.info(`🔍 Chargement de ${commandFiles.length} commandes...`);
    
    for (const file of commandFiles) {
        try {
            const commandPath = path.join(commandsDir, file);
            const commandName = path.basename(file, '.js');
            
            delete require.cache[require.resolve(commandPath)];
            
            const commandModule = require(commandPath);
            
            if (typeof commandModule !== 'function') {
                log.error(`❌ ${file} doit exporter une fonction`);
                continue;
            }
            
            COMMANDS.set(commandName, commandModule);
            
            // ✅ NOUVEAU: Capturer la commande rank pour l'expérience
            if (commandName === 'rank') {
                rankCommand = commandModule;
                log.info(`🎯 Système d'expérience activé avec la commande rank`);
            }
            
            log.info(`✅ Commande '${commandName}' chargée`);
            
        } catch (error) {
            log.error(`❌ Erreur chargement ${file}: ${error.message}`);
        }
    }
    
    log.info(`🎉 ${COMMANDS.size} commandes chargées avec succès !`);
}

// === FONCTION ANTI-SPAM ===
function isSpam(senderId, message) {
    if (isAdmin(senderId)) return false; // Les admins bypass l'anti-spam
    
    // Normaliser le message pour ignorer les accents et casse
    const normalized = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    
    // Détection spécifique pour les patterns connus
    if (normalized === 'du brood' || normalized.includes('le blocage est lance')) {
        return true;
    }
    
    let spamInfo = userSpamData.get(senderId);
    if (!spamInfo) {
        spamInfo = {
            lastMsg: '',
            repeatCount: 0,
            messages: [], // Timestamps des messages récents
            lastCleanup: Date.now()
        };
    }
    
    const now = Date.now();
    
    // Nettoyage des anciens timestamps (garder seulement les 60 dernières secondes)
    spamInfo.messages = spamInfo.messages.filter(ts => now - ts < 60000);
    spamInfo.messages.push(now);
    
    // Rate limiting: > 10 messages en 60s = spam
    if (spamInfo.messages.length > 10) {
        userSpamData.set(senderId, spamInfo);
        return true;
    }
    
    // Détection de répétition
    const normLast = spamInfo.lastMsg.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (normalized === normLast) {
        spamInfo.repeatCount++;
        if (spamInfo.repeatCount >= 3) {
            userSpamData.set(senderId, spamInfo);
            return true;
        }
    } else {
        spamInfo.repeatCount = 1;
        spamInfo.lastMsg = message;
    }
    
    userSpamData.set(senderId, spamInfo);
    return false;
}

async function processCommand(senderId, messageText) {
    const senderIdStr = String(senderId);
    
    if (!messageText || typeof messageText !== 'string') {
        return "🤖 Oh là là ! Message vide ! Tape /start ou /help pour commencer notre belle conversation ! 💕";
    }
    
    messageText = messageText.trim();
    
    // 🆕 GESTION DES DEMANDES DE CONTINUATION EN PRIORITÉ
    if (isContinuationRequest(messageText)) {
        const truncatedData = truncatedMessages.get(senderIdStr);
        if (truncatedData) {
            const { fullMessage, lastSentPart } = truncatedData;
            
            // Trouver où on s'était arrêté
            const lastSentIndex = fullMessage.indexOf(lastSentPart) + lastSentPart.length;
            const remainingMessage = fullMessage.substring(lastSentIndex);
            
            if (remainingMessage.trim()) {
                const chunks = splitMessageIntoChunks(remainingMessage, 2000);
                const nextChunk = chunks[0];
                
                // Mettre à jour le cache avec la nouvelle partie envoyée
                if (chunks.length > 1) {
                    truncatedMessages.set(senderIdStr, {
                        fullMessage: fullMessage,
                        lastSentPart: lastSentPart + nextChunk
                    });
                    
                    // Ajouter un indicateur de continuation
                    const continuationMsg = nextChunk + "\n\n📝 *Tape \"continue\" pour la suite...*";
                    addToMemory(senderIdStr, 'user', messageText);
                    addToMemory(senderIdStr, 'assistant', continuationMsg);
                    saveDataImmediate(); // Sauvegarder l'état
                    return continuationMsg;
                } else {
                    // Message terminé
                    truncatedMessages.delete(senderIdStr);
                    addToMemory(senderIdStr, 'user', messageText);
                    addToMemory(senderIdStr, 'assistant', nextChunk);
                    saveDataImmediate(); // Sauvegarder l'état
                    return nextChunk;
                }
            } else {
                // Plus rien à envoyer
                truncatedMessages.delete(senderIdStr);
                const endMsg = "✅ C'est tout ! Y a-t-il autre chose que je puisse faire pour toi ? 💫";
                addToMemory(senderIdStr, 'user', messageText);
                addToMemory(senderIdStr, 'assistant', endMsg);
                saveDataImmediate(); // Sauvegarder l'état
                return endMsg;
            }
        } else {
            // Pas de message tronqué en cours
            const noTruncMsg = "🤔 Il n'y a pas de message en cours à continuer. Pose-moi une nouvelle question ! 💡";
            addToMemory(senderIdStr, 'user', messageText);
            addToMemory(senderIdStr, 'assistant', noTruncMsg);
            return noTruncMsg;
        }
    }
    
    if (!messageText.startsWith('/')) {
        if (COMMANDS.has('chat')) {
            return await COMMANDS.get('chat')(senderId, messageText, commandContext);
        }
        return "🤖 Coucou ! Tape /start ou /help pour découvrir ce que je peux faire ! ✨";
    }
    
    const parts = messageText.substring(1).split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');
    
    if (COMMANDS.has(command)) {
        try {
            return await COMMANDS.get(command)(senderId, args, commandContext);
        } catch (error) {
            log.error(`❌ Erreur commande ${command}: ${error.message}`);
            return `💥 Oh non ! Petite erreur dans /${command} ! Réessaie ou tape /help ! 💕`;
        }
    }
    
    return `❓ Oh ! La commande /${command} m'est inconnue ! Tape /help pour voir tout ce que je sais faire ! ✨💕`;
}

// === ROUTES EXPRESS ===

// === ROUTE D'ACCUEIL MISE À JOUR ===
app.get('/', (req, res) => {
    const clanCount = commandContext.clanData ? Object.keys(commandContext.clanData.clans || {}).length : 0;
    const expDataCount = rankCommand ? Object.keys(rankCommand.getExpData()).length : 0;
    
    res.json({
        status: "🤖 NakamaBot v4.0 Amicale + Vision + GitHub + Clans + Rank + Truncation + Google Search Online ! 💖",
        creator: "Durand",
        personality: "Super gentille et amicale, comme une très bonne amie",
        year: "2025",
        commands: COMMANDS.size,
        users: userList.size,
        conversations: userMemory.size,
        images_stored: userLastImage.size,
        clans_total: clanCount,
        users_with_exp: expDataCount,
        truncated_messages: truncatedMessages.size,
        google_api_keys: GOOGLE_API_KEYS.length,
        google_search_engines: GOOGLE_SEARCH_ENGINE_IDS.length,
        version: "4.0 Amicale + Vision + GitHub + Clans + Rank + Truncation + Google Search",
        storage: {
            type: "GitHub API",
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
            persistent: Boolean(GITHUB_TOKEN && GITHUB_USERNAME),
            auto_save: "Every 5 minutes",
            includes: ["users", "conversations", "images", "clans", "command_data", "user_exp", "truncated_messages", "google_key_usage"]
        },
        features: [
            "Génération d'images IA",
            "Transformation anime", 
            "Analyse d'images IA",
            "Chat intelligent et doux",
            "Système de clans persistant",
            "Système de ranking et expérience",
            "Cartes de rang personnalisées",
            "Gestion intelligente des messages longs",
            "Continuation automatique des réponses",
            "Recherche Google avec rotation de clés",
            "Fallback recherche IA",
            "Broadcast admin",
            "Stats réservées admin",
            "Sauvegarde permanente GitHub"
        ],
        last_update: new Date().toISOString()
    });
});

// Webhook Facebook Messenger
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        log.info('✅ Webhook vérifié');
        res.status(200).send(challenge);
    } else {
        log.warning('❌ Échec vérification webhook');
        res.status(403).send('Verification failed');
    }
});

// ✅ WEBHOOK PRINCIPAL CORRIGÉ - BLACKLIST FIX
app.post('/webhook', async (req, res) => {
    try {
        const data = req.body;
        
        if (!data) {
            log.warning('⚠️ Aucune donnée reçue');
            return res.status(400).json({ error: "No data received" });
        }
        
        for (const entry of data.entry || []) {
            for (const event of entry.messaging || []) {
                const senderId = event.sender?.id;
                
                if (!senderId) {
                    continue;
                }
                
                const senderIdStr = String(senderId);
                
                if (event.message && !event.message.is_echo) {
                    const wasNewUser = !userList.has(senderIdStr);
                    userList.add(senderIdStr);
                    
                    if (wasNewUser) {
                        log.info(`👋 Nouvel utilisateur: ${senderId}`);
                        saveDataImmediate();
                    }
                    
                    // ✅ CORRECTION BLACKLIST: Vérification du blocage avec gestion correcte
                    if (!isAdmin(senderIdStr)) {
                        const blockMode = clanData.get('blockMode');
                        const blockMsg = clanData.get('blockMessage');
                        
                        // ✅ FIX: Récupérer la blacklist correctement depuis clanData (Map)
                        const blacklist = clanData.get('blacklist');
                        if (blacklist && blacklist instanceof Map) {
                            const blacklistMsg = blacklist.get(senderIdStr);
                            if (blacklistMsg) {
                                const sendResult = await sendMessage(senderId, blacklistMsg);
                                if (sendResult.success) {
                                    log.info(`🚫 Blacklist bloqué pour ${senderId}`);
                                }
                                continue; // Ignorer le message
                            }
                        }
                        
                        // Puis le blocage général
                        if (blockMode && blockMsg) {
                            let isBlocked = false;
                            
                            if (blockMode === 'all') {
                                isBlocked = true;
                            } else if (blockMode === 'new' && wasNewUser) {
                                isBlocked = true;
                            } else if (blockMode === 'old' && !wasNewUser) {
                                isBlocked = true;
                            }
                            
                            if (isBlocked) {
                                const sendResult = await sendMessage(senderId, blockMsg);
                                if (sendResult.success) {
                                    log.info(`🚫 Message bloqué pour ${senderId} (mode: ${blockMode})`);
                                }
                                continue; // Passer à l'événement suivant
                            }
                        }
                    }
                    
                    if (event.message.attachments) {
                        for (const attachment of event.message.attachments) {
                            if (attachment.type === 'image') {
                                const imageUrl = attachment.payload?.url;
                                if (imageUrl) {
                                    userLastImage.set(senderIdStr, imageUrl);
                                    log.info(`📸 Image reçue de ${senderId}`);
                                    
                                    addToMemory(senderId, 'user', '[Image envoyée]');
                                    
                                    // ✅ NOUVEAU: Ajouter de l'expérience pour l'envoi d'image
                                    if (rankCommand) {
                                        const expResult = rankCommand.addExp(senderId, 2); // 2 XP pour une image
                                        
                                        if (expResult.levelUp) {
                                            log.info(`🎉 ${senderId} a atteint le niveau ${expResult.newLevel} (image) !`);
                                        }
                                    }
                                    
                                    saveDataImmediate();
                                    
                                    const response = "✅";
                                    
                                    const sendResult = await sendMessage(senderId, response);
                                    if (sendResult.success) {
                                        addToMemory(senderId, 'assistant', response);
                                    }
                                    continue;
                                }
                            }
                        }
                    }
                    
                    const messageText = event.message.text?.trim();
                    
                    if (messageText) {
                        log.info(`📨 Message de ${senderId}: ${messageText.substring(0, 50)}...`);
                        
                        // ✅ NOUVEAU: Vérification anti-spam
                        if (isSpam(senderIdStr, messageText)) {
                            log.info(`🚫 Spam détecté de ${senderId}: ${messageText.substring(0, 50)}...`);
                            continue; // Ignorer le message sans réponse
                        }
                        
                        // ✅ NOUVEAU: Ajouter de l'expérience pour chaque message
                        if (messageText && rankCommand) {
                            const expResult = rankCommand.addExp(senderId, 1);
                            
                            // Notifier si l'utilisateur a monté de niveau
                            if (expResult.levelUp) {
                                log.info(`🎉 ${senderId} a atteint le niveau ${expResult.newLevel} !`);
                            }
                            
                            // Sauvegarder les données mises à jour
                            saveDataImmediate();
                        }
                        
                        const response = await processCommand(senderId, messageText);
                        
                        if (response) {
                            if (typeof response === 'object' && response.type === 'image') {
                                const sendResult = await sendImageMessage(senderId, response.url, response.caption);
                                
                                if (sendResult.success) {
                                    log.info(`✅ Image envoyée à ${senderId}`);
                                } else {
                                    log.warning(`❌ Échec envoi image à ${senderId}`);
                                    const fallbackMsg = "🎨 Image créée avec amour mais petite erreur d'envoi ! Réessaie ! 💕";
                                    const fallbackResult = await sendMessage(senderId, fallbackMsg);
                                    if (fallbackResult.success) {
                                        addToMemory(senderId, 'assistant', fallbackMsg);
                                    }
                                }
                            } else if (typeof response === 'string') {
                                const sendResult = await sendMessage(senderId, response);
                                
                                if (sendResult.success) {
                                    log.info(`✅ Réponse envoyée à ${senderId}`);
                                } else {
                                    log.warning(`❌ Échec envoi à ${senderId}`);
                                }
                            }
                        }
                    }
                }
            }
        }
    } catch (error) {
        log.error(`❌ Erreur webhook: ${error.message}`);
        return res.status(500).json({ error: `Webhook error: ${error.message}` });
    }
    
    res.status(200).json({ status: "ok" });
});

// ✅ NOUVELLE ROUTE: Statistiques Google Search
app.get('/google-stats', (req, res) => {
    const today = new Date().toDateString();
    const keyStats = [];
    
    for (let keyIndex = 0; keyIndex < GOOGLE_API_KEYS.length; keyIndex++) {
        for (let engineIndex = 0; engineIndex < GOOGLE_SEARCH_ENGINE_IDS.length; engineIndex++) {
            const keyId = `${keyIndex}-${engineIndex}-${today}`;
            const usage = googleKeyUsage.get(keyId) || 0;
            const remaining = GOOGLE_DAILY_LIMIT - usage;
            
            keyStats.push({
                keyIndex,
                engineIndex,
                searchEngineId: GOOGLE_SEARCH_ENGINE_IDS[engineIndex],
                usage,
                remaining,
                limit: GOOGLE_DAILY_LIMIT,
                percentage: Math.round((usage / GOOGLE_DAILY_LIMIT) * 100)
            });
        }
    }
    
    res.json({
        success: true,
        date: today,
        currentKeyIndex: currentGoogleKeyIndex,
        currentEngineIndex: currentSearchEngineIndex,
        totalKeys: GOOGLE_API_KEYS.length,
        totalEngines: GOOGLE_SEARCH_ENGINE_IDS.length,
        totalCombinations: GOOGLE_API_KEYS.length * GOOGLE_SEARCH_ENGINE_IDS.length,
        keyStats: keyStats,
        summary: {
            totalUsage: keyStats.reduce((sum, stat) => sum + stat.usage, 0),
            totalRemaining: keyStats.reduce((sum, stat) => sum + stat.remaining, 0),
            averageUsage: Math.round(keyStats.reduce((sum, stat) => sum + stat.percentage, 0) / keyStats.length),
            exhaustedKeys: keyStats.filter(stat => stat.remaining <= 0).length
        },
        timestamp: new Date().toISOString()
    });
});

// Route pour créer un nouveau repository GitHub
app.post('/create-repo', async (req, res) => {
    try {
        if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
            return res.status(400).json({
                success: false,
                error: "GITHUB_TOKEN ou GITHUB_USERNAME manquant"
            });
        }

        const repoCreated = await createGitHubRepo();
        
        if (repoCreated) {
            res.json({
                success: true,
                message: "Repository GitHub créé avec succès !",
                repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
                url: `https://github.com/${GITHUB_USERNAME}/${GITHUB_REPO}`,
                instructions: [
                    "Le repository a été créé automatiquement",
                    "Les données seront sauvegardées automatiquement",
                    "Vérifiez que le repository est privé pour la sécurité"
                ],
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(500).json({
                success: false,
                error: "Impossible de créer le repository"
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Route pour tester la connexion GitHub
app.get('/test-github', async (req, res) => {
    try {
        if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
            return res.status(400).json({
                success: false,
                error: "Configuration GitHub manquante",
                missing: {
                    token: !GITHUB_TOKEN,
                    username: !GITHUB_USERNAME
                }
            });
        }

        const repoUrl = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}`;
        const response = await axios.get(repoUrl, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            timeout: 10000
        });

        res.json({
            success: true,
            message: "Connexion GitHub OK !",
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
            url: `https://github.com/${GITHUB_USERNAME}/${GITHUB_REPO}`,
            status: response.status,
            private: response.data.private,
            created_at: response.data.created_at,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        let errorMessage = error.message;
        let suggestions = [];

        if (error.response?.status === 404) {
            errorMessage = "Repository introuvable (404)";
            suggestions = [
                "Vérifiez que GITHUB_USERNAME et GITHUB_REPO sont corrects",
                "Utilisez POST /create-repo pour créer automatiquement le repository"
            ];
        } else if (error.response?.status === 401) {
            errorMessage = "Token GitHub invalide (401)";
            suggestions = ["Vérifiez votre GITHUB_TOKEN"];
        } else if (error.response?.status === 403) {
            errorMessage = "Accès refusé (403)";
            suggestions = ["Vérifiez les permissions de votre token (repo, contents)"];
        }

        res.status(error.response?.status || 500).json({
            success: false,
            error: errorMessage,
            suggestions: suggestions,
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
            timestamp: new Date().toISOString()
        });
    }
});

// ✅ NOUVELLE ROUTE: Tester les clés Google Search
app.get('/test-google', async (req, res) => {
    try {
        if (GOOGLE_API_KEYS.length === 0 || GOOGLE_SEARCH_ENGINE_IDS.length === 0) {
            return res.status(400).json({
                success: false,
                error: "Configuration Google Search manquante",
                missing: {
                    apiKeys: GOOGLE_API_KEYS.length === 0,
                    searchEngines: GOOGLE_SEARCH_ENGINE_IDS.length === 0
                },
                instructions: [
                    "Ajoutez GOOGLE_API_KEYS (séparées par des virgules)",
                    "Ajoutez GOOGLE_SEARCH_ENGINE_IDS (séparés par des virgules)",
                    "Obtenez vos clés sur https://console.developers.google.com"
                ]
            });
        }

        const testQuery = "test search";
        const results = await googleSearch(testQuery, 3);

        if (results && results.length > 0) {
            res.json({
                success: true,
                message: "Google Search API fonctionne !",
                testQuery: testQuery,
                resultsFound: results.length,
                sampleResult: results[0],
                configuration: {
                    totalApiKeys: GOOGLE_API_KEYS.length,
                    totalSearchEngines: GOOGLE_SEARCH_ENGINE_IDS.length,
                    totalCombinations: GOOGLE_API_KEYS.length * GOOGLE_SEARCH_ENGINE_IDS.length,
                    currentKeyIndex: currentGoogleKeyIndex,
                    currentEngineIndex: currentSearchEngineIndex
                },
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(500).json({
                success: false,
                error: "Google Search API ne fonctionne pas",
                testQuery: testQuery,
                configuration: {
                    totalApiKeys: GOOGLE_API_KEYS.length,
                    totalSearchEngines: GOOGLE_SEARCH_ENGINE_IDS.length
                },
                suggestions: [
                    "Vérifiez que vos clés API Google sont valides",
                    "Vérifiez que vos Search Engine IDs sont corrects",
                    "Vérifiez que les APIs sont activées dans Google Console",
                    "Consultez /google-stats pour voir l'usage des clés"
                ],
                timestamp: new Date().toISOString()
            });
        }

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Route pour forcer une sauvegarde
app.post('/force-save', async (req, res) => {
    try {
        await saveDataToGitHub();
        const clanCount = commandContext.clanData ? Object.keys(commandContext.clanData.clans || {}).length : 0;
        const expDataCount = rankCommand ? Object.keys(rankCommand.getExpData()).length : 0;
        
        res.json({
            success: true,
            message: "Données sauvegardées avec succès sur GitHub !",
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
            timestamp: new Date().toISOString(),
            stats: {
                users: userList.size,
                conversations: userMemory.size,
                images: userLastImage.size,
                clans: clanCount,
                users_with_exp: expDataCount,
                truncated_messages: truncatedMessages.size,
                google_key_usage_entries: googleKeyUsage.size
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Route pour recharger les données depuis GitHub
app.post('/reload-data', async (req, res) => {
    try {
        await loadDataFromGitHub();
        const clanCount = commandContext.clanData ? Object.keys(commandContext.clanData.clans || {}).length : 0;
        const expDataCount = rankCommand ? Object.keys(rankCommand.getExpData()).length : 0;
        
        res.json({
            success: true,
            message: "Données rechargées avec succès depuis GitHub !",
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
            timestamp: new Date().toISOString(),
            stats: {
                users: userList.size,
                conversations: userMemory.size,
                images: userLastImage.size,
                clans: clanCount,
                users_with_exp: expDataCount,
                truncated_messages: truncatedMessages.size,
                google_key_usage_entries: googleKeyUsage.size
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// === STATISTIQUES PUBLIQUES MISES À JOUR AVEC EXPÉRIENCE ET TRONCATURE ===
app.get('/stats', (req, res) => {
    const clanCount = commandContext.clanData ? Object.keys(commandContext.clanData.clans || {}).length : 0;
    const expDataCount = rankCommand ? Object.keys(rankCommand.getExpData()).length : 0;
    
    res.json({
        users_count: userList.size,
        conversations_count: userMemory.size,
        images_stored: userLastImage.size,
        clans_total: clanCount,
        users_with_exp: expDataCount,
        truncated_messages: truncatedMessages.size,
        google_api_keys: GOOGLE_API_KEYS.length,
        google_search_engines: GOOGLE_SEARCH_ENGINE_IDS.length,
        commands_available: COMMANDS.size,
        version: "4.0 Amicale + Vision + GitHub + Clans + Rank + Truncation + Google Search",
        creator: "Durand",
        personality: "Super gentille et amicale, comme une très bonne amie",
        year: 2025,
        storage: {
            type: "GitHub API",
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
            persistent: Boolean(GITHUB_TOKEN && GITHUB_USERNAME),
            auto_save_interval: "5 minutes",
            data_types: ["users", "conversations", "images", "clans", "command_data", "user_exp", "truncated_messages", "google_key_usage"]
        },
        features: [
            "AI Image Generation",
            "Anime Transformation", 
            "AI Image Analysis",
            "Friendly Chat",
            "Persistent Clan System",
            "User Ranking System",
            "Experience & Levels",
            "Smart Message Truncation",
            "Message Continuation",
            "Google Search with Key Rotation",
            "AI Fallback Search",
            "Admin Stats",
            "Help Suggestions",
            "GitHub Persistent Storage"
        ],
        note: "Statistiques détaillées réservées aux admins via /stats"
    });
});

// === SANTÉ DU BOT MISE À JOUR AVEC EXPÉRIENCE ET TRONCATURE ===
app.get('/health', (req, res) => {
    const clanCount = commandContext.clanData ? Object.keys(commandContext.clanData.clans || {}).length : 0;
    const expDataCount = rankCommand ? Object.keys(rankCommand.getExpData()).length : 0;
    
    const healthStatus = {
        status: "healthy",
        personality: "Super gentille et amicale, comme une très bonne amie 💖",
        services: {
            ai: Boolean(MISTRAL_API_KEY),
            vision: Boolean(MISTRAL_API_KEY),
            facebook: Boolean(PAGE_ACCESS_TOKEN),
            github_storage: Boolean(GITHUB_TOKEN && GITHUB_USERNAME),
            google_search: GOOGLE_API_KEYS.length > 0 && GOOGLE_SEARCH_ENGINE_IDS.length > 0,
            ranking_system: Boolean(rankCommand),
            message_truncation: true
        },
        data: {
            users: userList.size,
            conversations: userMemory.size,
            images_stored: userLastImage.size,
            clans_total: clanCount,
            users_with_exp: expDataCount,
            truncated_messages: truncatedMessages.size,
            commands_loaded: COMMANDS.size,
            google_keys: GOOGLE_API_KEYS.length,
            search_engines: GOOGLE_SEARCH_ENGINE_IDS.length
        },
        version: "4.0 Amicale + Vision + GitHub + Clans + Rank + Truncation + Google Search",
        creator: "Durand",
        repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
        timestamp: new Date().toISOString()
    };
    
    const issues = [];
    if (!MISTRAL_API_KEY) {
        issues.push("Clé IA manquante");
    }
    if (!PAGE_ACCESS_TOKEN) {
        issues.push("Token Facebook manquant");
    }
    if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
        issues.push("Configuration GitHub manquante");
    }
    if (GOOGLE_API_KEYS.length === 0 || GOOGLE_SEARCH_ENGINE_IDS.length === 0) {
        issues.push("Configuration Google Search manquante");
    }
    if (COMMANDS.size === 0) {
        issues.push("Aucune commande chargée");
    }
    if (!rankCommand) {
        issues.push("Système de ranking non chargé");
    }
    
    if (issues.length > 0) {
        healthStatus.status = "degraded";
        healthStatus.issues = issues;
    }
    
    const statusCode = healthStatus.status === "healthy" ? 200 : 503;
    res.status(statusCode).json(healthStatus);
});

// === SERVEUR DE FICHIERS STATIQUES POUR LES IMAGES TEMPORAIRES ===

app.use('/temp', express.static(path.join(__dirname, 'temp')));

// Middleware pour nettoyer automatiquement les anciens fichiers temporaires
app.use('/temp', (req, res, next) => {
    // Nettoyer les fichiers de plus de 1 heure
    const tempDir = path.join(__dirname, 'temp');
    if (fs.existsSync(tempDir)) {
        const files = fs.readdirSync(tempDir);
        const now = Date.now();
        
        files.forEach(file => {
            const filePath = path.join(tempDir, file);
            const stats = fs.statSync(filePath);
            const ageInMs = now - stats.mtime.getTime();
            
            // Supprimer si plus d'1 heure (3600000 ms)
            if (ageInMs > 3600000) {
                try {
                    fs.unlinkSync(filePath);
                    log.debug(`🗑️ Fichier temporaire nettoyé: ${file}`);
                } catch (error) {
                    // Nettoyage silencieux
                }
            }
        });
    }
    next();
});

// Route pour voir l'historique des commits GitHub
app.get('/github-history', async (req, res) => {
    try {
        if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
            return res.status(400).json({
                success: false,
                error: "Configuration GitHub manquante"
            });
        }

        const commitsUrl = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/commits`;
        const response = await axios.get(commitsUrl, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            params: {
                per_page: 10
            },
            timeout: 10000
        });

        const commits = response.data.map(commit => ({
            message: commit.commit.message,
            date: commit.commit.author.date,
            sha: commit.sha.substring(0, 7),
            author: commit.commit.author.name
        }));

        res.json({
            success: true,
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
            commits: commits,
            total_shown: commits.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        res.status(error.response?.status || 500).json({
            success: false,
            error: error.message,
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`
        });
    }
});

// 🆕 NOUVELLE ROUTE: Nettoyer les messages tronqués (admin uniquement)
app.post('/clear-truncated', (req, res) => {
    const clearedCount = truncatedMessages.size;
    truncatedMessages.clear();
    
    // Sauvegarder immédiatement
    saveDataImmediate();
    
    res.json({
        success: true,
        message: `${clearedCount} conversations tronquées nettoyées`,
        timestamp: new Date().toISOString()
    });
});

// ✅ NOUVELLE ROUTE: Réinitialiser les compteurs Google (admin uniquement)
app.post('/reset-google-counters', (req, res) => {
    const clearedCount = googleKeyUsage.size;
    googleKeyUsage.clear();
    currentGoogleKeyIndex = 0;
    currentSearchEngineIndex = 0;
    
    // Sauvegarder immédiatement
    saveDataImmediate();
    
    res.json({
        success: true,
        message: `${clearedCount} compteurs Google réinitialisés`,
        newKeyIndex: currentGoogleKeyIndex,
        newEngineIndex: currentSearchEngineIndex,
        timestamp: new Date().toISOString()
    });
});

// === DÉMARRAGE MODIFIÉ AVEC SYSTÈME D'EXPÉRIENCE ET TRONCATURE ===

const PORT = process.env.PORT || 5000;

async function startBot() {
    log.info("🚀 Démarrage NakamaBot v4.0 Amicale + Vision + GitHub + Clans + Rank + Truncation + Google Search");
    log.info("💖 Personnalité super gentille et amicale, comme une très bonne amie");
    log.info("👨‍💻 Créée par Durand");
    log.info("📅 Année: 2025");

    log.info("📥 Chargement des données depuis GitHub...");
    await loadDataFromGitHub();

    loadCommands();

    // ✅ NOUVEAU: Charger les données d'expérience après le chargement des commandes
    if (rankCommand) {
        log.info("🎯 Système d'expérience détecté et prêt !");
    } else {
        log.warning("⚠️ Commande rank non trouvée - Système d'expérience désactivé");
    }

    const missingVars = [];
    if (!PAGE_ACCESS_TOKEN) {
        missingVars.push("PAGE_ACCESS_TOKEN");
    }
    if (!MISTRAL_API_KEY) {
        missingVars.push("MISTRAL_API_KEY");
    }
    if (!GITHUB_TOKEN) {
        missingVars.push("GITHUB_TOKEN");
    }
    if (!GITHUB_USERNAME) {
        missingVars.push("GITHUB_USERNAME");
    }
    if (GOOGLE_API_KEYS.length === 0) {
        missingVars.push("GOOGLE_API_KEYS");
    }
    if (GOOGLE_SEARCH_ENGINE_IDS.length === 0) {
        missingVars.push("GOOGLE_SEARCH_ENGINE_IDS");
    }

    if (missingVars.length > 0) {
        log.error(`❌ Variables manquantes: ${missingVars.join(', ')}`);
    } else {
        log.info("✅ Configuration complète OK");
    }

    const clanCount = commandContext.clanData ? Object.keys(commandContext.clanData.clans || {}).length : 0;
    const expDataCount = rankCommand ? Object.keys(rankCommand.getExpData()).length : 0;

    log.info(`🎨 ${COMMANDS.size} commandes disponibles`);
    log.info(`👥 ${userList.size} utilisateurs en mémoire`);
    log.info(`💬 ${userMemory.size} conversations en mémoire`);
    log.info(`🖼️ ${userLastImage.size} images en mémoire`);
    log.info(`🏰 ${clanCount} clans en mémoire`);
    log.info(`⭐ ${expDataCount} utilisateurs avec expérience`);
    log.info(`📝 ${truncatedMessages.size} conversations tronquées en cours`);
    log.info(`🔑 ${GOOGLE_API_KEYS.length} clés Google API configurées`);
    log.info(`🔍 ${GOOGLE_SEARCH_ENGINE_IDS.length} moteurs de recherche configurés`);
    log.info(`📊 ${GOOGLE_API_KEYS.length * GOOGLE_SEARCH_ENGINE_IDS.length} combinaisons possibles`);
    log.info(`🔐 ${ADMIN_IDS.size} administrateurs`);
    log.info(`📂 Repository: ${GITHUB_USERNAME}/${GITHUB_REPO}`);
    log.info(`🌐 Serveur sur le port ${PORT}`);
    
    startAutoSave();
    
    log.info("🎉 NakamaBot Amicale + Vision + GitHub + Clans + Rank + Truncation + Google Search prête à aider avec gentillesse !");

    app.listen(PORT, () => {
        log.info(`🌐 Serveur démarré sur le port ${PORT}`);
        log.info("💾 Sauvegarde automatique GitHub activée");
        log.info("📏 Gestion intelligente des messages longs activée");
        log.info("🔍 Recherche Google avec rotation de clés activée");
        log.info(`📊 Dashboard: https://github.com/${GITHUB_USERNAME}/${GITHUB_REPO}`);
    });
}

// Fonction de nettoyage lors de l'arrêt
async function gracefulShutdown() {
    log.info("🛑 Arrêt du bot avec tendresse...");
    
    if (saveInterval) {
        clearInterval(saveInterval);
        log.info("⏹️ Sauvegarde automatique arrêtée");
    }
    
    try {
        log.info("💾 Sauvegarde finale des données sur GitHub...");
        await saveDataToGitHub();
        log.info("✅ Données sauvegardées avec succès !");
    } catch (error) {
        log.error(`❌ Erreur sauvegarde finale: ${error.message}`);
    }
    
    // Nettoyage final des messages tronqués
    const truncatedCount = truncatedMessages.size;
    if (truncatedCount > 0) {
        log.info(`🧹 Nettoyage de ${truncatedCount} conversations tronquées en cours...`);
        truncatedMessages.clear();
    }
    
    // Résumé final des clés Google
    const googleUsageCount = googleKeyUsage.size;
    if (googleUsageCount > 0) {
        log.info(`📊 ${googleUsageCount} entrées d'usage Google sauvegardées`);
    }
    
    log.info("👋 Au revoir ! Données sauvegardées sur GitHub !");
    log.info(`📂 Repository: https://github.com/${GITHUB_USERNAME}/${GITHUB_REPO}`);
    process.exit(0);
}

// Gestion propre de l'arrêt
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// Gestion des erreurs non capturées
process.on('uncaughtException', async (error) => {
    log.error(`❌ Erreur non capturée: ${error.message}`);
    await gracefulShutdown();
});

process.on('unhandledRejection', async (reason, promise) => {
    log.error(`❌ Promesse rejetée: ${reason}`);
    await gracefulShutdown();
});

// 🆕 NETTOYAGE PÉRIODIQUE: Nettoyer les messages tronqués anciens (plus de 24h)
setInterval(() => {
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000; // 24 heures en millisecondes
    let cleanedCount = 0;
    
    for (const [userId, data] of truncatedMessages.entries()) {
        // Si le message n'a pas de timestamp ou est trop ancien
        if (!data.timestamp || (now - new Date(data.timestamp).getTime() > oneDayMs)) {
            truncatedMessages.delete(userId);
            cleanedCount++;
        }
    }
    
    if (cleanedCount > 0) {
        log.info(`🧹 Nettoyage automatique: ${cleanedCount} conversations tronquées expirées supprimées`);
        saveDataImmediate(); // Sauvegarder le nettoyage
    }
}, 60 * 60 * 1000); // Vérifier toutes les heures

// ✅ NOUVEAU NETTOYAGE PÉRIODIQUE: Nettoyer les anciens compteurs Google (plus de 7 jours)
setInterval(() => {
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000; // 7 jours en millisecondes
    const today = new Date().toDateString();
    let cleanedCount = 0;
    
    for (const [keyId, usage] of googleKeyUsage.entries()) {
        // Extraire la date du keyId (format: keyIndex-engineIndex-date)
        const datePart = keyId.split('-')[2];
        if (datePart && datePart !== today) {
            try {
                const keyDate = new Date(datePart).getTime();
                if (now - keyDate > sevenDaysMs) {
                    googleKeyUsage.delete(keyId);
                    cleanedCount++;
                }
            } catch (error) {
                // Si on ne peut pas parser la date, supprimer la clé
                googleKeyUsage.delete(keyId);
                cleanedCount++;
            }
        }
    }
    
    if (cleanedCount > 0) {
        log.info(`🧹 Nettoyage Google: ${cleanedCount} anciens compteurs de clés supprimés`);
        saveDataImmediate(); // Sauvegarder le nettoyage
    }
}, 24 * 60 * 60 * 1000); // Vérifier tous les jours

// Démarrer le bot
startBot().catch(error => {
    log.error(`❌ Erreur démarrage: ${error.message}`);
    process.exit(1);
});
