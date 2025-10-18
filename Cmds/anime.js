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
const ANIME_MODEL_VERSION = "5b9072e7f51f8c2f561a30b70dbfffea8062ab6cb51629a13c50af0d2c56bf0e";

// ✅ Protection anti-spam
const userAnimeRequests = new Map();
const ANIME_COOLDOWN_MS = 15000; // 15 secondes entre chaque transformation

module.exports = async function cmdAnime(senderId, args, ctx) {
    const { log, addToMemory, sleep, userLastImage } = ctx;
    const senderIdStr = String(senderId);
    
    // ✅ Vérifier la configuration de l'API
    if (!REPLICATE_API_TOKEN) {
        log.error("❌ REPLICATE_API_TOKEN manquant");
        return `❌ Service non configuré ! Demande à l'admin d'ajouter REPLICATE_API_TOKEN 💕`;
    }
    
    // ✅ PROTECTION ANTI-SPAM
    const now = Date.now();
    if (userAnimeRequests.has(senderIdStr)) {
        const lastRequest = userAnimeRequests.get(senderIdStr);
        const timeSinceLastRequest = now - lastRequest;
        if (timeSinceLastRequest < ANIME_COOLDOWN_MS) {
            const remainingSeconds = Math.ceil((ANIME_COOLDOWN_MS - timeSinceLastRequest) / 1000);
            return `⏰ Patience ! Attends ${remainingSeconds}s avant une nouvelle transformation ! 🎨`;
        }
    }
    
    const command = args.toLowerCase().trim();
    
    // ✅ Commande /anime aide
    if (command === 'aide' || command === 'help') {
        return `🎨 Transformation Anime ! ✨

📸 Étapes :
1. Envoie une photo
2. Tape /anime
3. Reçois ta version anime !

💡 Tu peux aussi :
/anime [URL]

⏰ 15s entre chaque transformation
💕 Amusez-vous bien !`;
    }
    
    // ✅ Déterminer l'image à transformer
    let imageUrl = null;
    
    // URL fournie en argument
    if (command && (command.startsWith('http://') || command.startsWith('https://'))) {
        imageUrl = command;
    }
    // Dernière image envoyée
    else if (userLastImage.has(senderIdStr)) {
        imageUrl = userLastImage.get(senderIdStr);
    }
    // Aucune image
    else {
        return `📸 Envoie-moi d'abord une photo, puis tape /anime ! 💕`;
    }
    
    // ✅ Mettre à jour le cooldown
    userAnimeRequests.set(senderIdStr, now);
    
    addToMemory(senderId, 'user', `/anime`);
    
    try {
        log.info(`🎨 Transformation anime pour ${senderId}`);
        
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
                timeout: 15000
            }
        );
        
        if (createResponse.status !== 201) {
            throw new Error(`Erreur API: ${createResponse.status}`);
        }
        
        const predictionId = createResponse.data.id;
        const getUrl = createResponse.data.urls.get;
        
        log.debug(`🔮 Prédiction: ${predictionId}`);
        
        // ✅ Attendre le résultat (max 45 secondes)
        let attempts = 0;
        const maxAttempts = 45;
        let outputUrl = null;
        
        while (attempts < maxAttempts) {
            await sleep(1000);
            attempts++;
            
            const statusResponse = await axios.get(getUrl, {
                headers: {
                    'Authorization': `Token ${REPLICATE_API_TOKEN}`
                },
                timeout: 10000
            });
            
            const status = statusResponse.data.status;
            
            if (status === 'succeeded') {
                outputUrl = statusResponse.data.output;
                log.info(`✅ Terminé: ${outputUrl}`);
                break;
            } else if (status === 'failed') {
                throw new Error('Transformation échouée');
            } else if (status === 'canceled') {
                throw new Error('Transformation annulée');
            }
        }
        
        if (!outputUrl) {
            throw new Error('Timeout');
        }
        
        addToMemory(senderId, 'assistant', 'Transformation anime OK');
        
        return {
            type: "image",
            url: outputUrl,
            caption: `✨ Ta version anime ! 🎭\n\n💕 Envoie une autre photo pour recommencer !`
        };
        
    } catch (error) {
        log.error(`❌ Erreur anime ${senderId}: ${error.message}`);
        
        userAnimeRequests.delete(senderIdStr);
        
        if (error.response?.status === 401) {
            return `❌ Token API invalide ! Contacte l'admin 💕`;
        } else if (error.response?.status === 422) {
            return `❌ Image invalide ! Envoie une vraie photo 📸💕`;
        } else if (error.message.includes('Timeout')) {
            return `⏰ Transformation trop longue... Réessaie ! 💕`;
        } else {
            return `💔 Erreur technique... Réessaie plus tard ! 💕`;
        }
    }
};

// ✅ Nettoyage automatique
setInterval(() => {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    
    for (const [userId, timestamp] of userAnimeRequests.entries()) {
        if (now - timestamp > oneHour) {
            userAnimeRequests.delete(userId);
        }
    }
}, 60 * 60 * 1000);

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
