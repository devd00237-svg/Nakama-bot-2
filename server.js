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

// Headers pour GitHub API
const getGitHubHeaders = () => ({
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'NakamaBot-App'
});

// Fonction pour charger les données depuis GitHub
async function loadDataFromGitHub() {
    if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
        log.warning("⚠️ Configuration GitHub incomplète - Utilisation mémoire locale uniquement");
        return;
    }
    
    try {
        // Charger userList
        const userListResponse = await axios.get(getGitHubApiUrl('userList.json'), {
            headers: getGitHubHeaders(),
            timeout: 10000
        });
        const userListData = decodeBase64(userListResponse.data.content);
        userList = new Set(userListData);
        
        // Charger userMemory
        const userMemoryResponse = await axios.get(getGitHubApiUrl('userMemory.json'), {
            headers: getGitHubHeaders(),
            timeout: 10000
        });
        const userMemoryData = decodeBase64(userMemoryResponse.data.content);
        userMemory = new Map(Object.entries(userMemoryData));
        
        // Charger userLastImage
        const userLastImageResponse = await axios.get(getGitHubApiUrl('userLastImage.json'), {
            headers: getGitHubHeaders(),
            timeout: 10000
        });
        const userLastImageData = decodeBase64(userLastImageResponse.data.content);
        userLastImage = new Map(Object.entries(userLastImageData));
        
        // Charger clanData
        const clanDataResponse = await axios.get(getGitHubApiUrl('clanData.json'), {
            headers: getGitHubHeaders(),
            timeout: 10000
        });
        const clanDataData = decodeBase64(clanDataResponse.data.content);
        clanData = new Map(Object.entries(clanDataData));
        
        // Charger truncatedMessages
        const truncatedResponse = await axios.get(getGitHubApiUrl('truncatedMessages.json'), {
            headers: getGitHubHeaders(),
            timeout: 10000
        });
        const truncatedData = decodeBase64(truncatedResponse.data.content);
        truncatedMessages = new Map(Object.entries(truncatedData));
        
        // Charger googleKeyUsage
        const googleUsageResponse = await axios.get(getGitHubApiUrl('googleKeyUsage.json'), {
            headers: getGitHubHeaders(),
            timeout: 10000
        });
        const googleUsageData = decodeBase64(googleUsageResponse.data.content);
        googleKeyUsage = new Map(Object.entries(googleUsageData));
        
        // Charger données d'expérience si rankCommand existe
        if (rankCommand) {
            const expResponse = await axios.get(getGitHubApiUrl('userExp.json'), {
                headers: getGitHubHeaders(),
                timeout: 10000
            });
            const expData = decodeBase64(expResponse.data.content);
            rankCommand.loadExpData(expData);
        }
        
        log.info("✅ Données chargées depuis GitHub avec succès !");
    } catch (error) {
        if (error.response && error.response.status === 404) {
            log.warning("⚠️ Fichiers GitHub non trouvés - Initialisation nouvelle base de données");
        } else {
            log.error(`❌ Erreur chargement GitHub: ${error.message}`);
        }
    }
}

// Fonction pour sauvegarder les données sur GitHub
async function saveDataToGitHub() {
    if (!GITHUB_TOKEN || !GITHUB_USERNAME) return;
    
    try {
        // Sauvegarder userList
        const userListContent = encodeBase64(Array.from(userList));
        const userListSha = await getFileSha('userList.json');
        await axios.put(getGitHubApiUrl('userList.json'), {
            message: 'Update userList',
            content: userListContent,
            sha: userListSha
        }, {
            headers: getGitHubHeaders()
        });
        
        // Sauvegarder userMemory
        const userMemoryContent = encodeBase64(Object.fromEntries(userMemory));
        const userMemorySha = await getFileSha('userMemory.json');
        await axios.put(getGitHubApiUrl('userMemory.json'), {
            message: 'Update userMemory',
            content: userMemoryContent,
            sha: userMemorySha
        }, {
            headers: getGitHubHeaders()
        });
        
        // Sauvegarder userLastImage
        const userLastImageContent = encodeBase64(Object.fromEntries(userLastImage));
        const userLastImageSha = await getFileSha('userLastImage.json');
        await axios.put(getGitHubApiUrl('userLastImage.json'), {
            message: 'Update userLastImage',
            content: userLastImageContent,
            sha: userLastImageSha
        }, {
            headers: getGitHubHeaders()
        });
        
        // Sauvegarder clanData
        const clanDataContent = encodeBase64(Object.fromEntries(clanData));
        const clanDataSha = await getFileSha('clanData.json');
        await axios.put(getGitHubApiUrl('clanData.json'), {
            message: 'Update clanData',
            content: clanDataContent,
            sha: clanDataSha
        }, {
            headers: getGitHubHeaders()
        });
        
        // Sauvegarder truncatedMessages
        const truncatedContent = encodeBase64(Object.fromEntries(truncatedMessages));
        const truncatedSha = await getFileSha('truncatedMessages.json');
        await axios.put(getGitHubApiUrl('truncatedMessages.json'), {
            message: 'Update truncatedMessages',
            content: truncatedContent,
            sha: truncatedSha
        }, {
            headers: getGitHubHeaders()
        });
        
        // Sauvegarder googleKeyUsage
        const googleUsageContent = encodeBase64(Object.fromEntries(googleKeyUsage));
        const googleUsageSha = await getFileSha('googleKeyUsage.json');
        await axios.put(getGitHubApiUrl('googleKeyUsage.json'), {
            message: 'Update googleKeyUsage',
            content: googleUsageContent,
            sha: googleUsageSha
        }, {
            headers: getGitHubHeaders()
        });
        
        // Sauvegarder données d'expérience si rankCommand existe
        if (rankCommand) {
            const expContent = encodeBase64(rankCommand.getExpData());
            const expSha = await getFileSha('userExp.json');
            await axios.put(getGitHubApiUrl('userExp.json'), {
                message: 'Update userExp',
                content: expContent,
                sha: expSha
            }, {
                headers: getGitHubHeaders()
            });
        }
        
        log.info("💾 Données sauvegardées sur GitHub !");
    } catch (error) {
        log.error(`❌ Erreur sauvegarde GitHub: ${error.message}`);
    }
}

// Fonction pour obtenir le SHA d'un fichier GitHub (pour update)
async function getFileSha(filename) {
    try {
        const response = await axios.get(getGitHubApiUrl(filename), {
            headers: getGitHubHeaders(),
            timeout: 5000
        });
        return response.data.sha;
    } catch (error) {
        if (error.response && error.response.status === 404) {
            // Si fichier non trouvé, créer nouveau
            await axios.put(getGitHubApiUrl(filename), {
                message: `Create ${filename}`,
                content: encodeBase64({}) // Fichier vide initial
            }, {
                headers: getGitHubHeaders()
            });
            log.info(`📄 Fichier ${filename} créé sur GitHub`);
            return await getFileSha(filename);
        }
        throw error;
    }
}

// Sauvegarde immédiate
function saveDataImmediate() {
    saveDataToGitHub();
}

// Auto-save toutes les 5 minutes
let saveInterval;
function startAutoSave() {
    saveInterval = setInterval(saveDataToGitHub, 5 * 60 * 1000);
}

// === CHARGEMENT DES COMMANDES ===
const COMMANDS = new Map();
const commandContext = {
    log,
    sendMessage,
    clanData,
    addExp, // Fonction pour ajouter de l'exp (définit plus bas)
    getExpData: () => rankCommand ? rankCommand.getExpData() : {}
};

async function loadCommands() {
    const commandsDir = path.join(__dirname, 'commands');
    const files = fs.readdirSync(commandsDir);
    
    for (const file of files) {
        if (file.endsWith('.js')) {
            const commandName = file.slice(0, -3);
            const commandPath = path.join(commandsDir, file);
            delete require.cache[require.resolve(commandPath)]; // Pour hot reload
            const commandModule = require(commandPath);
            
            if (typeof commandModule === 'function') {
                COMMANDS.set(commandName, commandModule);
                log.info(`🎯 Commande /${commandName} chargée !`);
                
                if (commandName === 'rank') {
                    rankCommand = commandModule;
                    log.info("⭐ Système d'expérience activé !");
                }
            }
        }
    }
}

// === FONCTION D'EXPÉRIENCE BASIQUE (SI RANK NON CHARGÉ) ===
function addExp(senderId, amount) {
    if (rankCommand) {
        rankCommand.addExp(senderId, amount, commandContext);
    }
}

// === FONCTION SLEEP ===
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// === ENVOI MESSAGE FACEBOOK ===
async function sendMessage(senderId, text) {
    try {
        const response = await axios.post(`https://graph.facebook.com/v2.6/me/messages`, {
            recipient: { id: senderId },
            message: { text },
            messaging_type: 'RESPONSE'
        }, {
            params: { access_token: PAGE_ACCESS_TOKEN },
            timeout: 10000
        });
        
        return { success: true, messageId: response.data.message_id };
    } catch (error) {
        log.error(`❌ Erreur envoi message: ${error.message}`);
        return { success: false };
    }
}

// === GESTION MÉMOIRE ===
function addToMemory(senderId, role, content) {
    if (!userMemory.has(senderId)) {
        userMemory.set(senderId, []);
    }
    userMemory.get(senderId).push({ role, content });
    
    // Limiter à 20 messages par utilisateur
    if (userMemory.get(senderId).length > 20) {
        userMemory.get(senderId).shift();
    }
}

function getMemoryContext(senderId) {
    return userMemory.get(senderId) || [];
}

// === APPEL API MISTRAL ===
async function callMistralAPI(messages, maxTokens = 2000, temperature = 0.7) {
    if (!MISTRAL_API_KEY) return null;
    
    try {
        const response = await axios.post('https://api.mistral.ai/v1/chat/completions', {
            model: 'mistral-large-latest',
            messages,
            max_tokens: maxTokens,
            temperature
        }, {
            headers: {
                'Authorization': `Bearer ${MISTRAL_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });
        
        return response.data.choices[0].message.content.trim();
    } catch (error) {
        log.error(`❌ Erreur Mistral: ${error.message}`);
        return null;
    }
}

// === WEBHOOK VERIFICATION ===
app.get('/webhook', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
        log.info("✅ Webhook vérifié !");
        res.status(200).send(req.query['hub.challenge']);
    } else {
        res.sendStatus(403);
    }
});

// === WEBHOOK PRINCIPAL ===
app.post('/webhook', (req, res) => {
    const body = req.body;
    
    if (body.object === 'page') {
        body.entry.forEach(entry => {
            const webhookEvent = entry.messaging[0];
            const senderId = webhookEvent.sender.id;
            
            userList.add(senderId);
            
            if (webhookEvent.message) {
                handleMessage(senderId, webhookEvent.message);
            }
        });
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// === GESTION DES MESSAGES ===
async function handleMessage(senderId, message) {
    try {
        if (message.attachments) {
            const attachment = message.attachments[0];
            
            if (attachment.type === 'image') {
                const imageUrl = attachment.payload.url;
                userLastImage.set(senderId, imageUrl);
                
                // Modification: Répondre uniquement avec ✅
                await sendMessage(senderId, "✅");
                return;
            }
            
            // Autres types d'attachments si nécessaire
            await sendMessage(senderId, "Désolée, je ne gère que les images pour le moment ! 💕");
            return;
        }
        
        let text = message.text || '';
        
        if (!text.trim()) return;
        
        // Gestion continuation
        if (isContinuationRequest(text)) {
            const truncatedData = truncatedMessages.get(senderId);
            if (truncatedData) {
                const { fullMessage, lastSentPart } = truncatedData;
                const lastSentIndex = fullMessage.indexOf(lastSentPart) + lastSentPart.length;
                const remainingMessage = fullMessage.substring(lastSentIndex);
                
                if (remainingMessage.trim()) {
                    const chunks = splitMessageIntoChunks(remainingMessage);
                    const nextChunk = chunks[0];
                    
                    if (chunks.length > 1) {
                        truncatedMessages.set(senderId, {
                            fullMessage,
                            lastSentPart: lastSentPart + nextChunk,
                            timestamp: new Date().toISOString()
                        });
                        await sendMessage(senderId, nextChunk + "\n\n📝 Tape \"continue\" pour la suite...");
                    } else {
                        truncatedMessages.delete(senderId);
                        await sendMessage(senderId, nextChunk);
                    }
                } else {
                    truncatedMessages.delete(senderId);
                    await sendMessage(senderId, "✅ C'est tout ! 💫");
                }
            } else {
                await sendMessage(senderId, "🤔 Pas de message à continuer ! 💕");
            }
            return;
        }
        
        // Détection commande
        if (text.startsWith('/')) {
            const [commandName, ...argsArr] = text.slice(1).split(' ');
            const args = argsArr.join(' ');
            
            const command = COMMANDS.get(commandName.toLowerCase());
            if (command) {
                const result = await command(senderId, args, commandContext);
                if (result) {
                    if (typeof result === 'object' && result.type === 'image') {
                        await sendMessage(senderId, result.message);
                    } else {
                        const chunks = splitMessageIntoChunks(result);
                        
                        if (chunks.length > 1) {
                            truncatedMessages.set(senderId, {
                                fullMessage: result,
                                lastSentPart: chunks[0],
                                timestamp: new Date().toISOString()
                            });
                            await sendMessage(senderId, chunks[0] + "\n\n📝 Tape \"continue\" pour la suite...");
                        } else {
                            await sendMessage(senderId, result);
                        }
                    }
                }
                addExp(senderId, 10); // Exp pour commande
            } else {
                await sendMessage(senderId, "🤔 Commande inconnue ! Tape /help pour la liste ! 💕");
            }
            return;
        }
        
        // Conversation normale
        const context = getMemoryContext(senderId);
        const messages = [{
            role: "system",
            content: "Tu es NakamaBot, une IA super gentille et amicale, comme une très bonne amie. Réponds avec empathie et humour léger. Nous sommes en 2025."
        }, ...context, { role: "user", content: text }];
        
        const response = await callMistralAPI(messages);
        
        if (response) {
            const chunks = splitMessageIntoChunks(response);
            
            if (chunks.length > 1) {
                truncatedMessages.set(senderId, {
                    fullMessage: response,
                    lastSentPart: chunks[0],
                    timestamp: new Date().toISOString()
                });
                await sendMessage(senderId, chunks[0] + "\n\n📝 Tape \"continue\" pour la suite...");
            } else {
                await sendMessage(senderId, response);
            }
            
            addToMemory(senderId, 'user', text);
            addToMemory(senderId, 'assistant', response);
            addExp(senderId, 5); // Exp pour message
        } else {
            await sendMessage(senderId, "Désolée, petite erreur ! Réessaie ? 💕");
        }
    } catch (error) {
        log.error(`❌ Erreur handleMessage: ${error.message}`);
        await sendMessage(senderId, "Oups, petite erreur ! Réessaie plus tard ? 💕");
    }
}

// Route pour tester Google Search API
app.get('/test-google', async (req, res) => {
    const testQuery = req.query.q || "test query";
    
    try {
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
