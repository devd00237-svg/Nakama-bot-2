/**
 * Commande /anime - Transforme une image en style anime
 * Utilise Hugging Face Inference API (GRATUIT, sans clé)
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande
 * @param {object} ctx - Contexte partagé du bot
 */

const axios = require('axios');

// ✅ Protection anti-spam
const userAnimeRequests = new Map();
const ANIME_COOLDOWN_MS = 10000; // 10 secondes

// ✅ Modèles Hugging Face GRATUITS pour transformation anime
const ANIME_MODELS = [
    'SG161222/Realistic_Vision_V6.0_B1_noVAE', // Meilleur pour portraits réalistes -> anime
    'prompthero/openjourney', // Style anime/manga
    'XpucT/Deliberate' // Bon pour stylisation
];

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
• Portrait de face recommandé
• Bonne luminosité
• Visage bien visible

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
            log.debug(`📥 Téléchargement image...`);
            
            const imageResponse = await axios.get(imageUrl, {
                responseType: 'arraybuffer',
                timeout: 15000,
                maxContentLength: 5 * 1024 * 1024 // 5MB max
            });
            
            imageBuffer = Buffer.from(imageResponse.data);
            log.debug(`✅ Image téléchargée (${(imageBuffer.length / 1024).toFixed(2)} KB)`);
            
        } catch (downloadError) {
            log.error(`❌ Téléchargement: ${downloadError.message}`);
            throw new Error('Image inaccessible');
        }
        
        // ✅ Transformer avec Hugging Face Image-to-Image
        let resultImageBuffer = null;
        let modelUsed = null;
        
        for (let i = 0; i < ANIME_MODELS.length; i++) {
            const model = ANIME_MODELS[i];
            
            try {
                log.debug(`🔄 Essai modèle ${i + 1}/${ANIME_MODELS.length}: ${model}`);
                
                // ✅ Appel API Hugging Face Inference
                const response = await axios.post(
                    `https://api-inference.huggingface.co/models/${model}`,
                    imageBuffer,
                    {
                        headers: {
                            'Content-Type': 'application/octet-stream'
                        },
                        responseType: 'arraybuffer',
                        timeout: 60000 // 60 secondes
                    }
                );
                
                if (response.status === 200 && response.data) {
                    resultImageBuffer = Buffer.from(response.data);
                    modelUsed = i + 1;
                    
                    log.info(`✅ Transformation OK avec modèle ${modelUsed} (${(resultImageBuffer.length / 1024).toFixed(2)} KB)`);
                    break;
                }
                
            } catch (apiError) {
                log.warning(`⚠️ Modèle ${i + 1} échoué: ${apiError.response?.status || apiError.message}`);
                
                // Si le modèle charge (503), attendre et réessayer
                if (apiError.response?.status === 503 && i === 0) {
                    log.info(`⏳ Modèle en chargement, attente 15s...`);
                    await sleep(15000);
                    
                    try {
                        const retryResponse = await axios.post(
                            `https://api-inference.huggingface.co/models/${model}`,
                            imageBuffer,
                            {
                                headers: {
                                    'Content-Type': 'application/octet-stream'
                                },
                                responseType: 'arraybuffer',
                                timeout: 60000
                            }
                        );
                        
                        if (retryResponse.status === 200 && retryResponse.data) {
                            resultImageBuffer = Buffer.from(retryResponse.data);
                            modelUsed = i + 1;
                            
                            log.info(`✅ OK après retry (${(resultImageBuffer.length / 1024).toFixed(2)} KB)`);
                            break;
                        }
                    } catch (retryError) {
                        log.warning(`⚠️ Retry échoué: ${retryError.message}`);
                    }
                }
                
                // Essayer le modèle suivant
                if (i < ANIME_MODELS.length - 1) {
                    await sleep(2000);
                }
            }
        }
        
        if (!resultImageBuffer) {
            throw new Error('Tous les modèles ont échoué');
        }
        
        // ✅ Héberger l'image sur ImgBB (gratuit)
        try {
            const uploadedUrl = await uploadToImgBB(resultImageBuffer, log);
            
            addToMemory(senderId, 'assistant', 'Transformation anime OK');
            
            return {
                type: "image",
                url: uploadedUrl,
                caption: `✨ Ta version anime ! 🎭

🤖 Modèle ${modelUsed} utilisé
🆓 100% gratuit

💕 Envoie une autre photo !`
            };
            
        } catch (uploadError) {
            log.error(`❌ Upload: ${uploadError.message}`);
            throw new Error('Erreur hébergement');
        }
        
    } catch (error) {
        log.error(`❌ Erreur ${senderId}: ${error.message}`);
        
        userAnimeRequests.delete(senderIdStr);
        
        let errorMessage = `💔 Oups... `;
        
        if (error.message.includes('inaccessible')) {
            errorMessage += `Image inaccessible ! 🔒`;
        } else if (error.message.includes('échoué')) {
            errorMessage += `Service temporairement indisponible ! ⏰`;
        } else if (error.message.includes('hébergement')) {
            errorMessage += `Erreur d'hébergement ! 📤`;
        } else {
            errorMessage += `Erreur technique ! 🤖`;
        }
        
        errorMessage += `\n\n💡 Réessaie dans 30 secondes ! 💕`;
        
        addToMemory(senderId, 'assistant', 'Erreur transformation anime');
        
        return errorMessage;
    }
};

// ✅ Héberger sur ImgBB (100% gratuit, anonyme)
async function uploadToImgBB(imageBuffer, log) {
    try {
        // ImgBB accepte les uploads anonymes (pas de clé API nécessaire pour usage basique)
        // Clé publique de démo - remplace par ta propre clé gratuite sur https://api.imgbb.com/
        const IMGBB_API_KEY = process.env.IMGBB_API_KEY || "d139aa9922a0b30a3e21c9f726049f87";
        
        const base64Image = imageBuffer.toString('base64');
        
        // ImgBB accepte les données en form-urlencoded
        const formData = new URLSearchParams();
        formData.append('image', base64Image);
        
        const response = await axios.post(
            `https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`,
            formData,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                timeout: 30000
            }
        );
        
        if (response.data?.data?.url) {
            log.info(`✅ Image hébergée: ${response.data.data.url}`);
            return response.data.data.url;
        } else {
            throw new Error('Réponse ImgBB invalide');
        }
        
    } catch (error) {
        log.error(`❌ ImgBB: ${error.message}`);
        
        // Backup : Imgur (anonyme)
        try {
            return await uploadToImgur(imageBuffer, log);
        } catch (imgurError) {
            throw new Error('Échec hébergement');
        }
    }
}

// ✅ Backup : Imgur (anonyme)
async function uploadToImgur(imageBuffer, log) {
    try {
        // Client ID public Imgur pour usage anonyme
        const IMGUR_CLIENT_ID = process.env.IMGUR_CLIENT_ID || "546c25a59c58ad7";
        
        const base64Image = imageBuffer.toString('base64');
        
        const response = await axios.post(
            'https://api.imgur.com/3/image',
            { image: base64Image },
            {
                headers: {
                    'Authorization': `Client-ID ${IMGUR_CLIENT_ID}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );
        
        if (response.data?.data?.link) {
            log.info(`✅ Image sur Imgur: ${response.data.data.link}`);
            return response.data.data.link;
        } else {
            throw new Error('Réponse Imgur invalide');
        }
        
    } catch (error) {
        log.error(`❌ Imgur: ${error.message}`);
        throw error;
    }
}

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
