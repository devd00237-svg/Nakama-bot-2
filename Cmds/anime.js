/**
 * Commande /anime - Transforme une image en style anime
 * Utilise l'API GRATUITE de Hugging Face (aucune clé requise)
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande
 * @param {object} ctx - Contexte partagé du bot
 */

const axios = require('axios');
const FormData = require('form-data');

// ✅ API GRATUITE Hugging Face - Aucune clé nécessaire !
const ANIME_API_URLS = [
    // API 1: AnimeGAN (le meilleur pour les portraits)
    'https://api-inference.huggingface.co/models/akhaliq/AnimeGANv2',
    // API 2: Anime Diffusion (backup)
    'https://api-inference.huggingface.co/models/Linaqruf/anything-v3.0',
    // API 3: Waifu Diffusion (backup 2)
    'https://api-inference.huggingface.co/models/hakurei/waifu-diffusion'
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
        return `🎨 Transformation Anime Gratuite ! ✨

📸 Étapes simples :
1. Envoie une photo
2. Tape /anime
3. Reçois ta version anime !

💡 Tips :
• Fonctionne mieux avec des portraits
• Photo de face recommandée
• Bonne luminosité

⏰ 10s entre chaque transformation
🆓 100% gratuit, pas de clé API !

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
        
        // ✅ Télécharger l'image
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
            log.error(`❌ Erreur téléchargement: ${downloadError.message}`);
            throw new Error('Image inaccessible');
        }
        
        // ✅ Essayer les différentes APIs Hugging Face
        let resultImageUrl = null;
        let apiUsed = null;
        
        for (let i = 0; i < ANIME_API_URLS.length; i++) {
            const apiUrl = ANIME_API_URLS[i];
            
            try {
                log.debug(`🔄 Essai API ${i + 1}/${ANIME_API_URLS.length}...`);
                
                const response = await axios.post(
                    apiUrl,
                    imageBuffer,
                    {
                        headers: {
                            'Content-Type': 'application/octet-stream'
                        },
                        responseType: 'arraybuffer',
                        timeout: 60000, // 60 secondes max
                        maxContentLength: 10 * 1024 * 1024 // 10MB max
                    }
                );
                
                if (response.status === 200 && response.data) {
                    // Convertir en base64 pour l'envoyer
                    const resultBuffer = Buffer.from(response.data);
                    const base64Image = resultBuffer.toString('base64');
                    resultImageUrl = `data:image/jpeg;base64,${base64Image}`;
                    apiUsed = i + 1;
                    
                    log.info(`✅ Transformation réussie avec API ${apiUsed} (${(resultBuffer.length / 1024).toFixed(2)} KB)`);
                    break;
                }
                
            } catch (apiError) {
                log.warning(`⚠️ API ${i + 1} échouée: ${apiError.message}`);
                
                // Si c'est le modèle qui charge, attendre et réessayer
                if (apiError.response?.status === 503 && i === 0) {
                    log.info(`⏳ Modèle en chargement, attente 10s...`);
                    await sleep(10000);
                    
                    try {
                        const retryResponse = await axios.post(
                            apiUrl,
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
                            const resultBuffer = Buffer.from(retryResponse.data);
                            const base64Image = resultBuffer.toString('base64');
                            resultImageUrl = `data:image/jpeg;base64,${base64Image}`;
                            apiUsed = i + 1;
                            
                            log.info(`✅ Transformation réussie après retry (${(resultBuffer.length / 1024).toFixed(2)} KB)`);
                            break;
                        }
                    } catch (retryError) {
                        log.warning(`⚠️ Retry échoué: ${retryError.message}`);
                    }
                }
                
                // Continuer avec l'API suivante
                if (i < ANIME_API_URLS.length - 1) {
                    await sleep(2000);
                }
            }
        }
        
        if (!resultImageUrl) {
            throw new Error('Toutes les APIs ont échoué');
        }
        
        addToMemory(senderId, 'assistant', 'Transformation anime réussie');
        
        // ✅ IMPORTANT : Avec Messenger, on ne peut pas envoyer de data URI directement
        // Il faut héberger l'image quelque part ou l'envoyer via un service
        
        // Solution temporaire : utiliser une API d'hébergement gratuite
        try {
            const uploadedUrl = await uploadToImgBB(resultImageUrl, log);
            
            return {
                type: "image",
                url: uploadedUrl,
                caption: `✨ Ta version anime ! 🎭

🤖 API ${apiUsed} utilisée
🆓 100% gratuit

💕 Envoie une autre photo pour recommencer !`
            };
            
        } catch (uploadError) {
            log.error(`❌ Erreur upload image: ${uploadError.message}`);
            throw new Error('Erreur hébergement image');
        }
        
    } catch (error) {
        log.error(`❌ Erreur transformation ${senderId}: ${error.message}`);
        
        userAnimeRequests.delete(senderIdStr);
        
        let errorMessage = `💔 Oups... `;
        
        if (error.message.includes('inaccessible')) {
            errorMessage += `Image inaccessible ! 🔒`;
        } else if (error.message.includes('échoué')) {
            errorMessage += `Toutes les APIs sont surchargées ! ⏰`;
        } else if (error.message.includes('hébergement')) {
            errorMessage += `Erreur d'hébergement de l'image ! 📤`;
        } else {
            errorMessage += `Erreur technique ! 🤖`;
        }
        
        errorMessage += `\n\n💡 Réessaie dans quelques instants ! 💕`;
        
        addToMemory(senderId, 'assistant', 'Erreur transformation anime');
        
        return errorMessage;
    }
};

// ✅ FONCTION : Héberger l'image sur ImgBB (gratuit, sans compte)
async function uploadToImgBB(base64Image, log) {
    try {
        // ImgBB permet l'upload anonyme
        const IMGBB_API_KEY = process.env.IMGBB_API_KEY || "d139aa9922a0b30a3e21c9f726049f87"; // Clé publique de démo
        
        // Extraire le base64 pur (sans le préfixe data:)
        const base64Data = base64Image.split(',')[1] || base64Image;
        
        const formData = new FormData();
        formData.append('image', base64Data);
        
        const response = await axios.post(
            `https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`,
            formData,
            {
                headers: formData.getHeaders(),
                timeout: 30000
            }
        );
        
        if (response.data?.data?.url) {
            log.info(`✅ Image hébergée sur ImgBB: ${response.data.data.url}`);
            return response.data.data.url;
        } else {
            throw new Error('Réponse ImgBB invalide');
        }
        
    } catch (error) {
        log.error(`❌ Erreur ImgBB: ${error.message}`);
        
        // Backup : essayer avec Imgur anonyme
        try {
            return await uploadToImgur(base64Image, log);
        } catch (imgurError) {
            throw new Error('Échec hébergement image');
        }
    }
}

// ✅ FONCTION BACKUP : Héberger sur Imgur (anonyme)
async function uploadToImgur(base64Image, log) {
    try {
        const IMGUR_CLIENT_ID = process.env.IMGUR_CLIENT_ID || "546c25a59c58ad7"; // Client ID public
        
        const base64Data = base64Image.split(',')[1] || base64Image;
        
        const response = await axios.post(
            'https://api.imgur.com/3/image',
            { image: base64Data },
            {
                headers: {
                    'Authorization': `Client-ID ${IMGUR_CLIENT_ID}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );
        
        if (response.data?.data?.link) {
            log.info(`✅ Image hébergée sur Imgur: ${response.data.data.link}`);
            return response.data.data.link;
        } else {
            throw new Error('Réponse Imgur invalide');
        }
        
    } catch (error) {
        log.error(`❌ Erreur Imgur: ${error.message}`);
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
