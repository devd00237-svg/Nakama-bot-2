/**
 * Commande /anime - Transforme une image en style anime avec Replicate API
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande
 * @param {object} ctx - Contexte partagé du bot
 */

const axios = require('axios');

// ✅ Configuration Replicate API
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || "";
const REPLICATE_API_URL = "https://api.replicate.com/v1/predictions";

// ✅ Modèle AnimeGAN v2 sur Replicate (gratuit)
const ANIME_MODEL_VERSION = "cjwbw/animeganv2:8e754e0e16f2a27a38b2ab0c6f29c7e408e99c4a5bb1f70b8e12d7d2b7b8e0a7";

// ✅ Protection anti-spam
const userAnimeRequests = new Map();
const ANIME_COOLDOWN_MS = 30000; // 30 secondes entre chaque transformation

// ✅ États de traitement
const ProcessingState = {
    WAITING_IMAGE: 'waiting_image',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    ERROR: 'error'
};

module.exports = async function cmdAnime(senderId, args, ctx) {
    const { log, addToMemory, sleep, sendMessage, sendImageMessage, userLastImage } = ctx;
    const senderIdStr = String(senderId);
    
    // ✅ Vérifier la configuration de l'API
    if (!REPLICATE_API_TOKEN) {
        log.error("❌ REPLICATE_API_TOKEN manquant");
        return `❌ Désolée ! La transformation anime n'est pas configurée...

🔧 Configuration nécessaire :
• Variable d'environnement REPLICATE_API_TOKEN
• Obtiens ta clé gratuite sur https://replicate.com

💕 Demande à l'admin de configurer ça !`;
    }
    
    // ✅ PROTECTION ANTI-SPAM
    const now = Date.now();
    if (userAnimeRequests.has(senderIdStr)) {
        const lastRequest = userAnimeRequests.get(senderIdStr);
        const timeSinceLastRequest = now - lastRequest;
        if (timeSinceLastRequest < ANIME_COOLDOWN_MS) {
            const remainingSeconds = Math.ceil((ANIME_COOLDOWN_MS - timeSinceLastRequest) / 1000);
            return `⏰ Patience ! Attends ${remainingSeconds}s avant une nouvelle transformation ! 🎨✨`;
        }
    }
    
    const command = args.toLowerCase().trim();
    
    // ✅ Commande /anime aide
    if (command === 'aide' || command === 'help' || !command) {
        return `🎨 Transformation Anime avec IA ! ✨

📸 Comment ça marche ?
1️⃣ Envoie-moi une photo
2️⃣ Tape /anime
3️⃣ Reçois ta version anime ! 🧑‍🎤

💡 Exemples d'usage :
• /anime - Transformer la dernière image
• /anime [URL] - Transformer une image depuis une URL

⚡ Fonctionnalités :
✨ Style anime professionnel
🎭 Préserve les traits du visage
🌈 Couleurs vibrantes
🖼️ Haute qualité

⏰ Cooldown : 30 secondes
🆓 Service gratuit via Replicate

💕 Prêt(e) à devenir un personnage d'anime ?`;
    }
    
    // ✅ Déterminer l'image à transformer
    let imageUrl = null;
    
    // Cas 1 : URL fournie en argument
    if (command && (command.startsWith('http://') || command.startsWith('https://'))) {
        imageUrl = command;
        log.info(`🖼️ URL fournie par ${senderId}: ${imageUrl}`);
    }
    // Cas 2 : Dernière image envoyée par l'utilisateur
    else if (userLastImage.has(senderIdStr)) {
        imageUrl = userLastImage.get(senderIdStr);
        log.info(`🖼️ Utilisation dernière image de ${senderId}`);
    }
    // Cas 3 : Aucune image disponible
    else {
        return `📸 Oh non ! Je n'ai pas d'image à transformer !

💡 Solutions :
1️⃣ Envoie-moi d'abord une photo
2️⃣ Puis tape /anime
OU
3️⃣ Tape /anime [URL de ton image]

Exemple :
/anime https://exemple.com/photo.jpg

✨ Essaie et deviens un personnage d'anime ! 💕`;
    }
    
    // ✅ Valider l'URL de l'image
    if (!isValidImageUrl(imageUrl)) {
        return `❌ Cette URL ne semble pas valide !

💡 L'URL doit :
• Commencer par http:// ou https://
• Pointer vers une image (jpg, jpeg, png)

Exemple valide :
/anime https://exemple.com/photo.jpg

Réessaie avec une bonne URL ! 💕`;
    }
    
    // ✅ Mettre à jour le cooldown
    userAnimeRequests.set(senderIdStr, now);
    
    // ✅ Message de début de traitement
    addToMemory(senderId, 'user', `/anime - Transformation anime demandée`);
    
    await sendMessage(senderId, `🎨 Transformation en cours... ✨

📸 Image analysée
🧠 IA en action
⏳ Ça peut prendre 10-30 secondes...

💕 Patience, la magie opère !`);
    
    try {
        // ✅ Appeler l'API Replicate pour la transformation
        log.info(`🎨 Début transformation anime pour ${senderId}`);
        
        const animeImageUrl = await transformToAnime(imageUrl, log);
        
        if (!animeImageUrl) {
            throw new Error("Transformation échouée - URL vide");
        }
        
        log.info(`✅ Transformation réussie pour ${senderId}: ${animeImageUrl}`);
        
        // ✅ Envoyer l'image transformée
        const caption = `✨ Ta transformation anime est prête ! 🎭

🎨 Style : AnimeGAN v2
⚡ Qualité : Professionnelle
💖 Créée avec amour par IA

💡 Envoie une autre photo et tape /anime pour une nouvelle transformation !`;
        
        addToMemory(senderId, 'assistant', 'Transformation anime réussie');
        
        return {
            type: "image",
            url: animeImageUrl,
            caption: caption
        };
        
    } catch (error) {
        log.error(`❌ Erreur transformation anime pour ${senderId}: ${error.message}`);
        
        // ✅ Retirer le cooldown en cas d'erreur pour permettre un nouvel essai
        userAnimeRequests.delete(senderIdStr);
        
        let errorMessage = `💔 Oh non ! Transformation échouée...

🔍 Raison possible :
`;
        
        if (error.message.includes('timeout')) {
            errorMessage += `⏰ Délai d'attente dépassé
💡 L'IA a pris trop de temps
🔄 Réessaie dans quelques instants !`;
        } else if (error.message.includes('invalid')) {
            errorMessage += `❌ Image invalide ou inaccessible
💡 Vérifie que l'URL est correcte
📸 Ou envoie une nouvelle photo !`;
        } else if (error.message.includes('quota')) {
            errorMessage += `📊 Quota API dépassé
💡 Réessaie plus tard
🆓 Service gratuit limité`;
        } else {
            errorMessage += `🤖 Erreur technique temporaire
💡 Réessaie dans quelques instants
📧 Si le problème persiste, contacte l'admin`;
        }
        
        errorMessage += `\n\n💕 Désolée pour le désagrément !`;
        
        addToMemory(senderId, 'assistant', 'Erreur transformation anime');
        
        return errorMessage;
    }
};

// ✅ FONCTION: Transformer une image en style anime avec Replicate
async function transformToAnime(imageUrl, log) {
    try {
        log.debug(`🚀 Appel API Replicate pour: ${imageUrl}`);
        
        // ✅ Créer une prédiction
        const createResponse = await axios.post(
            REPLICATE_API_URL,
            {
                version: ANIME_MODEL_VERSION,
                input: {
                    image: imageUrl
                }
            },
            {
                headers: {
                    'Authorization': `Token ${REPLICATE_API_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            }
        );
        
        if (createResponse.status !== 201) {
            throw new Error(`Erreur création prédiction: ${createResponse.status}`);
        }
        
        const predictionId = createResponse.data.id;
        const getUrl = createResponse.data.urls.get;
        
        log.debug(`🔮 Prédiction créée: ${predictionId}`);
        
        // ✅ Attendre que la transformation soit terminée (polling)
        let attempts = 0;
        const maxAttempts = 60; // 60 tentatives = 60 secondes max
        let predictionStatus = 'starting';
        let outputUrl = null;
        
        while (attempts < maxAttempts) {
            await sleep(1000); // Attendre 1 seconde entre chaque vérification
            attempts++;
            
            try {
                const statusResponse = await axios.get(getUrl, {
                    headers: {
                        'Authorization': `Token ${REPLICATE_API_TOKEN}`
                    },
                    timeout: 10000
                });
                
                predictionStatus = statusResponse.data.status;
                
                log.debug(`📊 Statut (tentative ${attempts}/${maxAttempts}): ${predictionStatus}`);
                
                if (predictionStatus === 'succeeded') {
                    outputUrl = statusResponse.data.output;
                    log.info(`✅ Transformation terminée: ${outputUrl}`);
                    break;
                } else if (predictionStatus === 'failed') {
                    const errorMsg = statusResponse.data.error || 'Erreur inconnue';
                    throw new Error(`Transformation échouée: ${errorMsg}`);
                } else if (predictionStatus === 'canceled') {
                    throw new Error('Transformation annulée');
                }
                
                // Statuts intermédiaires : starting, processing
                
            } catch (statusError) {
                if (attempts >= maxAttempts - 1) {
                    throw statusError;
                }
                // Continuer à essayer si ce n'est pas la dernière tentative
            }
        }
        
        if (!outputUrl) {
            throw new Error(`Timeout: transformation non terminée après ${maxAttempts} secondes`);
        }
        
        return outputUrl;
        
    } catch (error) {
        if (error.response) {
            const status = error.response.status;
            const errorData = error.response.data;
            
            if (status === 401) {
                log.error('❌ Token Replicate invalide');
                throw new Error('invalid - Token API invalide');
            } else if (status === 402) {
                log.error('❌ Quota Replicate dépassé');
                throw new Error('quota - Quota API dépassé');
            } else if (status === 422) {
                log.error(`❌ Image invalide: ${JSON.stringify(errorData)}`);
                throw new Error('invalid - Image non valide ou inaccessible');
            } else {
                log.error(`❌ Erreur Replicate ${status}: ${JSON.stringify(errorData)}`);
                throw new Error(`Erreur API ${status}`);
            }
        } else if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
            log.error('❌ Timeout Replicate');
            throw new Error('timeout - Délai d\'attente dépassé');
        } else {
            log.error(`❌ Erreur transformation: ${error.message}`);
            throw error;
        }
    }
}

// ✅ FONCTION: Valider une URL d'image
function isValidImageUrl(url) {
    if (!url || typeof url !== 'string') {
        return false;
    }
    
    // Vérifier que c'est une URL valide
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return false;
    }
    
    // Vérifier que c'est une image (optionnel mais recommandé)
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const urlLower = url.toLowerCase();
    const hasImageExtension = imageExtensions.some(ext => urlLower.includes(ext));
    
    // Accepter aussi les URLs sans extension visible (API, CDN, etc.)
    // Donc on ne fait pas de vérification stricte sur l'extension
    
    return true;
}

// ✅ FONCTION: Délai (utilitaire)
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ✅ Nettoyage automatique des cooldowns anciens (plus d'1 heure)
setInterval(() => {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    let cleanedCount = 0;
    
    for (const [userId, timestamp] of userAnimeRequests.entries()) {
        if (now - timestamp > oneHour) {
            userAnimeRequests.delete(userId);
            cleanedCount++;
        }
    }
    
    if (cleanedCount > 0) {
        console.log(`🧹 ${cleanedCount} cooldowns anime nettoyés`);
    }
}, 60 * 60 * 1000); // Vérifier toutes les heures
