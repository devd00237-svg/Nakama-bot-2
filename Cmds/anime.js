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

// ✅ Modèle AnimeGAN v2 sur Replicate
const ANIME_MODEL_VERSION = "5b9072e7f51f8c2f561a30b70dbfffea8062ab6cb51629a13c50af0d2c56bf0e";

// ✅ Protection anti-spam
const userAnimeRequests = new Map();
const ANIME_COOLDOWN_MS = 15000; // 15 secondes

module.exports = async function cmdAnime(senderId, args, ctx) {
    const { log, addToMemory, sleep, userLastImage } = ctx;
    const senderIdStr = String(senderId);
    
    // ✅ Vérifier la configuration
    if (!REPLICATE_API_TOKEN) {
        log.error("❌ REPLICATE_API_TOKEN manquant");
        return `❌ Service non configuré ! Demande à l'admin d'ajouter REPLICATE_API_TOKEN 💕`;
    }
    
    // ✅ Anti-spam
    const now = Date.now();
    if (userAnimeRequests.has(senderIdStr)) {
        const lastRequest = userAnimeRequests.get(senderIdStr);
        const timeSinceLastRequest = now - lastRequest;
        if (timeSinceLastRequest < ANIME_COOLDOWN_MS) {
            const remainingSeconds = Math.ceil((ANIME_COOLDOWN_MS - timeSinceLastRequest) / 1000);
            return `⏰ Attends ${remainingSeconds}s ! 🎨`;
        }
    }
    
    const command = args.toLowerCase().trim();
    
    // ✅ Aide
    if (command === 'aide' || command === 'help') {
        return `🎨 Transformation Anime ! ✨

📸 Étapes :
1. Envoie une photo
2. Tape /anime
3. Magie ! 🎭

⏰ 15s de cooldown
💕 Prête ?`;
    }
    
    // ✅ Récupérer l'image
    let imageUrl = null;
    
    if (command && (command.startsWith('http://') || command.startsWith('https://'))) {
        imageUrl = command;
    } else if (userLastImage.has(senderIdStr)) {
        imageUrl = userLastImage.get(senderIdStr);
    } else {
        return `📸 Envoie-moi d'abord une photo ! 💕`;
    }
    
    userAnimeRequests.set(senderIdStr, now);
    addToMemory(senderId, 'user', `/anime`);
    
    try {
        log.info(`🎨 Transformation anime pour ${senderId}`);
        
        // ✅ SOLUTION : Télécharger l'image et la convertir en base64 data URI
        let imageDataUri;
        
        try {
            log.debug(`📥 Téléchargement image depuis: ${imageUrl.substring(0, 100)}...`);
            
            const imageResponse = await axios.get(imageUrl, {
                responseType: 'arraybuffer',
                timeout: 20000,
                maxContentLength: 10 * 1024 * 1024 // 10MB max
            });
            
            const imageBuffer = Buffer.from(imageResponse.data);
            const contentType = imageResponse.headers['content-type'] || 'image/jpeg';
            const base64Image = imageBuffer.toString('base64');
            imageDataUri = `data:${contentType};base64,${base64Image}`;
            
            log.debug(`✅ Image téléchargée (${(imageBuffer.length / 1024).toFixed(2)} KB)`);
            
        } catch (downloadError) {
            log.error(`❌ Erreur téléchargement image: ${downloadError.message}`);
            throw new Error('Image inaccessible');
        }
        
        // ✅ Créer la prédiction avec l'image en base64
        const createResponse = await axios.post(
            REPLICATE_API_URL,
            {
                version: ANIME_MODEL_VERSION,
                input: {
                    image: imageDataUri
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
            throw new Error(`API Error: ${createResponse.status}`);
        }
        
        const predictionId = createResponse.data.id;
        const getUrl = createResponse.data.urls.get;
        
        log.debug(`🔮 Prédiction créée: ${predictionId}`);
        
        // ✅ Polling pour le résultat
        let attempts = 0;
        const maxAttempts = 60;
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
            
            log.debug(`📊 Statut (${attempts}/${maxAttempts}): ${status}`);
            
            if (status === 'succeeded') {
                outputUrl = statusResponse.data.output;
                log.info(`✅ Transformation terminée: ${outputUrl}`);
                break;
            } else if (status === 'failed') {
                const errorMsg = statusResponse.data.error || 'Unknown error';
                log.error(`❌ Transformation échouée: ${errorMsg}`);
                throw new Error(`Échec: ${errorMsg}`);
            } else if (status === 'canceled') {
                throw new Error('Transformation annulée');
            }
        }
        
        if (!outputUrl) {
            throw new Error('Timeout après 60 secondes');
        }
        
        addToMemory(senderId, 'assistant', 'Transformation anime réussie');
        
        return {
            type: "image",
            url: outputUrl,
            caption: `✨ Ta version anime ! 🎭

💕 Envoie une autre photo pour recommencer !`
        };
        
    } catch (error) {
        log.error(`❌ Erreur transformation anime ${senderId}: ${error.message}`);
        
        // Retirer le cooldown en cas d'erreur
        userAnimeRequests.delete(senderIdStr);
        
        let errorMessage = `💔 Erreur... `;
        
        if (error.response?.status === 401) {
            errorMessage += `Token API invalide ! 🔑`;
        } else if (error.response?.status === 402) {
            errorMessage += `Quota API dépassé ! 📊`;
        } else if (error.response?.status === 422) {
            errorMessage += `Image invalide ! 📸`;
        } else if (error.message.includes('Timeout')) {
            errorMessage += `Trop long... Réessaie ! ⏰`;
        } else if (error.message.includes('inaccessible')) {
            errorMessage += `Image inaccessible ! 🔒`;
        } else {
            errorMessage += `Erreur technique ! 🤖`;
        }
        
        errorMessage += `\n\n💕 Réessaie avec une autre photo !`;
        
        addToMemory(senderId, 'assistant', 'Erreur transformation anime');
        
        return errorMessage;
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
