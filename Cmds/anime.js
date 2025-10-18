/**
 * Commande /anime - Transforme une image en style anime
 * Utilise l'API de Hugging Face avec une clé API gratuite (inscription requise sur huggingface.co)
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande
 * @param {object} ctx - Contexte partagé du bot
 */

const axios = require('axios');
const FormData = require('form-data');

// ✅ API Hugging Face - Clé API gratuite requise (inscription sur huggingface.co)
const HF_TOKEN = process.env.HF_TOKEN;
if (!HF_TOKEN) {
    throw new Error('HF_TOKEN manquante dans les variables d\'environnement');
}

const ANIME_API_URLS = [
    // API 1: AnimeGANv2 (meilleur pour les portraits)
    'https://api-inference.huggingface.co/models/akhaliq/AnimeGANv2',
    // API 2: Anything-v3.0 (backup, mieux pour diffusion mais adaptable)
    'https://api-inference.huggingface.co/models/Linaqruf/anything-v3.0',
    // API 3: Waifu Diffusion (backup)
    'https://api-inference.huggingface.co/models/hakurei/waifu-diffusion',
    // API 4: Ajout d'une meilleure option - AnimeGANv3 (si disponible, sinon ajuster)
    'https://api-inference.huggingface.co/models/dyntheg/Animeganv3' // Vérifier l'existence, alternative: 'ironjr/animeganv2-face'
];

// ✅ Protection anti-spam améliorée
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
    
    // ✅ Aide mise à jour
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
🆓 APIs gratuites avec clé HF (inscription gratuite)

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
        
        // ✅ Télécharger l'image avec validation améliorée
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
        
        // ✅ Essayer les différentes APIs Hugging Face avec token
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
                            'Content-Type': 'application/octet-stream',
                            'Authorization': `Bearer ${HF_TOKEN}`
                        },
                        responseType: 'arraybuffer',
                        timeout: 60000, // 60 secondes max
                        maxContentLength: 10 * 1024 * 1024 // 10MB max
                    }
                );
                
                if (response.status === 200 && response.data) {
                    const resultBuffer = Buffer.from(response.data);
                    const base64Image = resultBuffer.toString('base64');
                    resultImageUrl = `data:image/jpeg;base64,${base64Image}`;
                    apiUsed = i + 1;
                    
                    log.info(`✅ Transformation réussie avec API ${apiUsed} (${(resultBuffer.length / 1024).toFixed(2)} KB)`);
                    break;
                }
                
            } catch (apiError) {
                log.warning(`⚠️ API ${i + 1} échouée: ${apiError.message}`);
                
                // Gestion améliorée des erreurs 503 (modèle en chargement)
                if (apiError.response?.status === 503) {
                    log.info(`⏳ Modèle en chargement, attente 15s...`);
                    await sleep(15000);
                    
                    try {
                        const retryResponse = await axios.post(
                            apiUrl,
                            imageBuffer,
                            {
                                headers: {
                                    'Content-Type': 'application/octet-stream',
                                    'Authorization': `Bearer ${HF_TOKEN}`
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
                
                // Pause avant l'API suivante
                if (i < ANIME_API_URLS.length - 1) {
                    await sleep(3000); // Augmenté pour éviter rate limits
                }
            }
        }
        
        if (!resultImageUrl) {
            throw new Error('Toutes les APIs ont échoué');
        }
        
        addToMemory(senderId, 'assistant', 'Transformation anime réussie');
        
        // ✅ Hébergement de l'image (amélioré : require les clés env)
        const IMGBB_API_KEY = process.env.IMGBB_API_KEY;
        const IMGUR_CLIENT_ID = process.env.IMGUR_CLIENT_ID;
        
        if (!IMGBB_API_KEY && !IMGUR_CLIENT_ID) {
            throw new Error('Clé d\'hébergement manquante (IMGBB_API_KEY ou IMGUR_CLIENT_ID)');
        }
        
        try {
            let uploadedUrl;
            if (IMGBB_API_KEY) {
                uploadedUrl = await uploadToImgBB(resultImageUrl, log, IMGBB_API_KEY);
            } else if (IMGUR_CLIENT_ID) {
                uploadedUrl = await uploadToImgur(resultImageUrl, log, IMGUR_CLIENT_ID);
            }
            
            return {
                type: "image",
                url: uploadedUrl,
                caption: `✨ Ta version anime ! 🎭

🤖 API ${apiUsed} utilisée
🆓 Gratuit avec clé HF

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
            errorMessage += `Toutes les APIs sont surchargées ! ⏰ Vérifie ta clé HF.`;
        } else if (error.message.includes('hébergement')) {
            errorMessage += `Erreur d'hébergement de l'image ! 📤 Vérifie tes clés.`;
        } else {
            errorMessage += `Erreur technique ! 🤖`;
        }
        
        errorMessage += `\n\n💡 Réessaie dans quelques instants ! 💕`;
        
        addToMemory(senderId, 'assistant', 'Erreur transformation anime');
        
        return errorMessage;
    }
};

// ✅ FONCTION : Héberger l'image sur ImgBB (clé requise)
async function uploadToImgBB(base64Image, log, apiKey) {
    try {
        const base64Data = base64Image.split(',')[1] || base64Image;
        
        const formData = new FormData();
        formData.append('image', base64Data);
        
        const response = await axios.post(
            `https://api.imgbb.com/1/upload?key=${apiKey}`,
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
        throw error;
    }
}

// ✅ FONCTION BACKUP : Héberger sur Imgur (clé requise)
async function uploadToImgur(base64Image, log, clientId) {
    try {
        const base64Data = base64Image.split(',')[1] || base64Image;
        
        const response = await axios.post(
            'https://api.imgur.com/3/image',
            { image: base64Data },
            {
                headers: {
                    'Authorization': `Client-ID ${clientId}`,
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

// ✅ Nettoyage automatique (inchangé)
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
