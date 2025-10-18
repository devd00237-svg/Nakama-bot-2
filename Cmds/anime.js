/**
 * Commande /anime - Transforme une image en style anime
 * Utilise DeepAI API (GRATUIT avec crédits mensuels)
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande
 * @param {object} ctx - Contexte partagé du bot
 */

const axios = require('axios');
const FormData = require('form-data');

// ✅ Configuration DeepAI API (GRATUIT)
const DEEPAI_API_KEY = process.env.DEEPAI_API_KEY || "quickstart-QUdJIGlzIGNvbWluZy4uLi4K";

// ✅ Endpoints DeepAI pour transformation anime
const DEEPAI_ENDPOINTS = [
    'https://api.deepai.org/api/toonify', // Meilleur pour portraits
    'https://api.deepai.org/api/CNNMRF', // Style artistique
    'https://api.deepai.org/api/deepdream' // Style créatif
];

// ✅ Protection anti-spam
const userAnimeRequests = new Map();
const ANIME_COOLDOWN_MS = 10000; // 10 secondes

module.exports = async function cmdAnime(senderId, args, ctx) {
    const { log, addToMemory, sleep, userLastImage } = ctx;
    const senderIdStr = String(senderId);
    
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

📸 Mode d'emploi :
1. Envoie une photo
2. Tape /anime
3. Magie ! 🎭

💡 Conseils :
• Portrait de face = meilleur résultat
• Bonne luminosité
• Photo claire

⏰ 10s entre transformations
🆓 100% gratuit !

💕 Prête ?`;
    }
    
    // ✅ Récupérer l'image
    let imageUrl = null;
    
    if (command && (command.startsWith('http://') || command.startsWith('https://'))) {
        imageUrl = command;
    } else if (userLastImage.has(senderIdStr)) {
        imageUrl = userLastImage.get(senderIdStr);
    } else {
        return `📸 Envoie une photo d'abord ! 💕`;
    }
    
    userAnimeRequests.set(senderIdStr, now);
    addToMemory(senderId, 'user', `/anime`);
    
    try {
        log.info(`🎨 Transformation anime pour ${senderId}`);
        
        // ✅ Télécharger l'image Facebook
        let imageBuffer;
        
        try {
            log.debug(`📥 Téléchargement...`);
            
            const imageResponse = await axios.get(imageUrl, {
                responseType: 'arraybuffer',
                timeout: 15000,
                maxContentLength: 5 * 1024 * 1024
            });
            
            imageBuffer = Buffer.from(imageResponse.data);
            log.debug(`✅ Image (${(imageBuffer.length / 1024).toFixed(2)} KB)`);
            
        } catch (downloadError) {
            log.error(`❌ Téléchargement: ${downloadError.message}`);
            throw new Error('Image inaccessible');
        }
        
        // ✅ Transformer avec DeepAI
        let resultUrl = null;
        let endpointUsed = null;
        
        for (let i = 0; i < DEEPAI_ENDPOINTS.length; i++) {
            const endpoint = DEEPAI_ENDPOINTS[i];
            
            try {
                log.debug(`🔄 Essai endpoint ${i + 1}/${DEEPAI_ENDPOINTS.length}`);
                
                const formData = new FormData();
                formData.append('image', imageBuffer, {
                    filename: 'image.jpg',
                    contentType: 'image/jpeg'
                });
                
                const response = await axios.post(endpoint, formData, {
                    headers: {
                        ...formData.getHeaders(),
                        'api-key': DEEPAI_API_KEY
                    },
                    timeout: 60000
                });
                
                if (response.status === 200 && response.data?.output_url) {
                    resultUrl = response.data.output_url;
                    endpointUsed = i + 1;
                    
                    log.info(`✅ Transformation OK (endpoint ${endpointUsed})`);
                    break;
                }
                
            } catch (apiError) {
                log.warning(`⚠️ Endpoint ${i + 1} échoué: ${apiError.response?.status || apiError.message}`);
                
                // Si rate limit ou modèle en charge, attendre
                if (apiError.response?.status === 429 || apiError.response?.status === 503) {
                    if (i === 0) {
                        log.info(`⏳ Attente 10s...`);
                        await sleep(10000);
                        
                        try {
                            const retryFormData = new FormData();
                            retryFormData.append('image', imageBuffer, {
                                filename: 'image.jpg',
                                contentType: 'image/jpeg'
                            });
                            
                            const retryResponse = await axios.post(endpoint, retryFormData, {
                                headers: {
                                    ...retryFormData.getHeaders(),
                                    'api-key': DEEPAI_API_KEY
                                },
                                timeout: 60000
                            });
                            
                            if (retryResponse.status === 200 && retryResponse.data?.output_url) {
                                resultUrl = retryResponse.data.output_url;
                                endpointUsed = i + 1;
                                
                                log.info(`✅ OK après retry (endpoint ${endpointUsed})`);
                                break;
                            }
                        } catch (retryError) {
                            log.warning(`⚠️ Retry échoué`);
                        }
                    }
                }
                
                // Essayer l'endpoint suivant
                if (i < DEEPAI_ENDPOINTS.length - 1) {
                    await sleep(2000);
                }
            }
        }
        
        if (!resultUrl) {
            throw new Error('Tous les endpoints ont échoué');
        }
        
        addToMemory(senderId, 'assistant', 'Transformation anime OK');
        
        return {
            type: "image",
            url: resultUrl,
            caption: `✨ Ta version anime ! 🎭

🤖 Style ${endpointUsed} utilisé
🆓 Gratuit via DeepAI

💕 Envoie une autre photo !`
        };
        
    } catch (error) {
        log.error(`❌ Erreur ${senderId}: ${error.message}`);
        
        userAnimeRequests.delete(senderIdStr);
        
        let errorMessage = `💔 Oups... `;
        
        if (error.message.includes('inaccessible')) {
            errorMessage += `Image inaccessible ! 🔒`;
        } else if (error.message.includes('échoué')) {
            errorMessage += `Service temporairement indisponible ! ⏰`;
        } else if (error.response?.status === 402) {
            errorMessage += `Quota API dépassé ! 📊\nUtilise ta propre clé DeepAI gratuite sur deepai.org`;
        } else {
            errorMessage += `Erreur technique ! 🤖`;
        }
        
        errorMessage += `\n\n💡 Réessaie dans 30 secondes ! 💕`;
        
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
