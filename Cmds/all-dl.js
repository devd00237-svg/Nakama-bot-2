/**
 * Commande ALLDL - Téléchargement universel de médias CORRIGÉE
 * Supporte YouTube, TikTok, Facebook, Instagram, Twitter, etc.
 * Avec système d'auto-téléchargement pour les groupes (admin seulement)
 * ✅ CORRECTION: Ajout système anti-doublons
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - URL ou paramètres (on/off pour auto-download)
 * @param {object} ctx - Contexte du bot
 */

const axios = require('axios');

// Configuration de l'API
const ALLDL_API_URL = 'https://noobs-api.top/dipto/alldl';

// Stockage local des paramètres d'auto-téléchargement par utilisateur/groupe
const autoDownloadSettings = new Map();

// ✅ NOUVEAU: Cache pour éviter les doublons (URL + UserID)
const downloadCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes en millisecondes

module.exports = async function cmdAllDl(senderId, args, ctx) {
    const { log, sendMessage, sendImageMessage, addToMemory, isAdmin } = ctx;
    const senderIdStr = String(senderId);
    
    try {
        if (!args || !args.trim()) {
            const helpMsg = `📥 **Téléchargeur Universel ALLDL**

🔗 **Usage :** \`/alldl [URL]\`

**Plateformes supportées :**
• YouTube (vidéos/shorts)
• TikTok
• Facebook
• Instagram (posts/reels/stories)
• Twitter/X
• Et bien d'autres !

**Commandes admin :**
• \`/alldl on\` - Active l'auto-téléchargement
• \`/alldl off\` - Désactive l'auto-téléchargement

💡 **Exemple :** \`/alldl https://www.youtube.com/watch?v=...\`

⚠️ L'auto-téléchargement permet de télécharger automatiquement toute URL postée (réservé aux admins).`;

            addToMemory(senderIdStr, 'user', args || '/alldl');
            addToMemory(senderIdStr, 'assistant', helpMsg);
            return helpMsg;
        }

        const command = args.trim().toLowerCase();

        // 🔧 GESTION DES PARAMÈTRES AUTO-DOWNLOAD (Admin seulement)
        if (command === 'on' || command === 'off') {
            if (!isAdmin(senderId)) {
                const noPermMsg = "🚫 Seuls les administrateurs peuvent modifier l'auto-téléchargement !";
                addToMemory(senderIdStr, 'user', args);
                addToMemory(senderIdStr, 'assistant', noPermMsg);
                return noPermMsg;
            }

            const isEnabled = command === 'on';
            autoDownloadSettings.set(senderIdStr, isEnabled);
            
            const statusMsg = `🔧 Auto-téléchargement ${isEnabled ? '**activé**' : '**désactivé**'} pour vous !

${isEnabled ? '✅ Toutes les URLs que vous postez seront automatiquement téléchargées.' : '❌ Les URLs ne seront plus téléchargées automatiquement.'}

💡 Tapez \`/alldl ${isEnabled ? 'off' : 'on'}\` pour ${isEnabled ? 'désactiver' : 'activer'}.`;
            
            addToMemory(senderIdStr, 'user', args);
            addToMemory(senderIdStr, 'assistant', statusMsg);
            log.info(`🔧 Auto-download ${isEnabled ? 'activé' : 'désactivé'} pour ${senderId}`);
            return statusMsg;
        }

        // 🔍 VALIDATION DE L'URL
        const url = args.trim();
        
        if (!isValidUrl(url)) {
            const invalidMsg = `❌ URL invalide ! 

📝 **Format attendu :** \`https://...\`

**Exemples valides :**
• \`https://www.youtube.com/watch?v=dQw4w9WgXcQ\`
• \`https://www.tiktok.com/@user/video/123456\`
• \`https://www.instagram.com/p/ABC123/\`
• \`https://www.facebook.com/watch/?v=123456789\`

💡 Astuce : Copiez-collez directement l'URL depuis votre navigateur !`;

            addToMemory(senderIdStr, 'user', args);
            addToMemory(senderIdStr, 'assistant', invalidMsg);
            return invalidMsg;
        }

        // ✅ NOUVEAU: Vérification des doublons
        const cacheKey = `${senderIdStr}_${url}`;
        const now = Date.now();
        
        // Nettoyer le cache des entrées expirées
        cleanExpiredCache();
        
        if (downloadCache.has(cacheKey)) {
            const cacheEntry = downloadCache.get(cacheKey);
            const timeElapsed = now - cacheEntry.timestamp;
            const remainingTime = Math.ceil((CACHE_DURATION - timeElapsed) / 1000);
            
            if (timeElapsed < CACHE_DURATION) {
                const duplicateMsg = `🔄 **Téléchargement récent détecté !**

⚠️ Vous avez déjà téléchargé cette vidéo il y a ${Math.floor(timeElapsed / 1000)} secondes.

🎬 **Vidéo :** ${cacheEntry.title || 'Titre non disponible'}
🔗 **URL :** ${url.length > 60 ? url.substring(0, 60) + '...' : url}

⏱️ Vous pourrez la télécharger à nouveau dans **${remainingTime} secondes**.

💡 Ceci évite les téléchargements en double et préserve les ressources du serveur.`;

                log.info(`🔄 Doublon évité pour ${senderId}: ${url.substring(0, 50)}...`);
                addToMemory(senderIdStr, 'user', args);
                addToMemory(senderIdStr, 'assistant', duplicateMsg);
                return duplicateMsg;
            }
        }

        // 🚀 TÉLÉCHARGEMENT
        log.info(`📥 Début téléchargement pour ${senderId}: ${url.substring(0, 50)}...`);
        
        const downloadingMsg = `⏳ **Téléchargement en cours...**

🔗 URL: ${url.length > 80 ? url.substring(0, 80) + '...' : url}
🎬 Plateforme: ${extractDomain(url)}

💡 Cela peut prendre quelques secondes selon la taille du média...`;

        // Envoyer le message de chargement d'abord
        addToMemory(senderIdStr, 'user', args);
        await sendMessage(senderId, downloadingMsg);

        try {
            // 📡 APPEL À L'API ALLDL
            const apiUrl = `${ALLDL_API_URL}?url=${encodeURIComponent(url)}`;
            log.debug(`📡 Appel API ALLDL: ${apiUrl}`);

            const response = await axios.get(apiUrl, { 
                timeout: 60000, // 60 secondes pour les gros fichiers
                maxRedirects: 5,
                validateStatus: function (status) {
                    return status >= 200 && status < 500; // Accepter même les 4xx pour gestion personnalisée
                }
            });

            log.debug(`📊 Réponse API: Status ${response.status}, Data: ${JSON.stringify(response.data)}`);

            // ✅ NOUVELLE LOGIQUE: Vérification améliorée de la réponse
            if (!response.data || response.status !== 200) {
                throw new Error(`API a retourné le statut ${response.status}`);
            }

            const mediaData = response.data;
            
            // ✅ CORRECTION: Vérifier différentes structures de réponse possibles
            let mediaUrl = null;
            let title = null;
            let author = null;
            let thumbnail = null;
            let duration = null;

            // Structure principale: {result: "url", Title: "...", author: "..."}
            if (mediaData.result) {
                mediaUrl = mediaData.result;
                title = mediaData.Title || mediaData.title || null;
                author = mediaData.author || null;
                thumbnail = mediaData.thumbnail || null;
                duration = mediaData.duration || null;
            }
            // Structure alternative: {url: "...", title: "..."}
            else if (mediaData.url) {
                mediaUrl = mediaData.url;
                title = mediaData.title || mediaData.Title || null;
                author = mediaData.author || null;
            }
            // Structure directe avec médias multiples
            else if (mediaData.medias && mediaData.medias.length > 0) {
                mediaUrl = mediaData.medias[0].url;
                title = mediaData.title || null;
            }
            // Erreur dans la réponse API
            else if (mediaData.error || mediaData.message) {
                throw new Error(mediaData.error || mediaData.message || 'Erreur API non spécifiée');
            }

            if (!mediaUrl) {
                log.error(`❌ Aucune URL de média trouvée dans la réponse: ${JSON.stringify(mediaData)}`);
                throw new Error('URL du média introuvable dans la réponse de l\'API');
            }

            // ✅ VALIDATION DE L'URL DU MÉDIA
            if (!isValidUrl(mediaUrl)) {
                log.error(`❌ URL de média invalide: ${mediaUrl}`);
                throw new Error('L\'API a retourné une URL de média invalide');
            }

            log.info(`✅ Média URL obtenue: ${mediaUrl.substring(0, 100)}...`);

            // ✅ NOUVEAU: Ajouter au cache AVANT l'envoi
            downloadCache.set(cacheKey, {
                timestamp: now,
                title: title,
                mediaUrl: mediaUrl,
                author: author
            });

            // 🎬 PRÉPARATION DU MESSAGE DE RÉSULTAT
            let resultMessage = `✅ **Téléchargement terminé !**\n\n`;
            
            if (title) {
                // Nettoyer le titre (enlever les caractères spéciaux problématiques)
                const cleanTitle = title.replace(/[^\w\s\-\.,!?()]/g, '').substring(0, 100);
                resultMessage += `📽️ **Titre :** ${cleanTitle}\n`;
            }
            
            if (author) {
                const cleanAuthor = author.replace(/[^\w\s\-\.,!?()]/g, '').substring(0, 50);
                resultMessage += `👤 **Auteur :** ${cleanAuthor}\n`;
            }
            
            if (duration) {
                resultMessage += `⏱️ **Durée :** ${duration}\n`;
            }
            
            resultMessage += `🔗 **Source :** ${extractDomain(url)}\n`;
            resultMessage += `📱 **Demandé par :** User ${senderId}\n\n`;
            resultMessage += `💕 **Téléchargé avec amour par NakamaBot !**`;

            // 🚀 TÉLÉCHARGEMENT ET ENVOI DU MÉDIA
            log.info(`📤 Tentative d'envoi du média...`);
            
            try {
                // Premier essai: Envoyer comme vidéo
                const videoResult = await sendVideoMessage(senderId, mediaUrl, resultMessage);
                
                if (videoResult.success) {
                    addToMemory(senderIdStr, 'assistant', resultMessage);
                    log.info(`✅ Vidéo téléchargée avec succès pour ${senderId}`);
                    return { type: 'media_sent', success: true };
                } else {
                    log.warning(`⚠️ Échec envoi vidéo, tentative image...`);
                    
                    // Deuxième essai: Envoyer comme image
                    const imageResult = await sendImageMessage(senderId, mediaUrl, resultMessage);
                    
                    if (imageResult.success) {
                        addToMemory(senderIdStr, 'assistant', resultMessage);
                        log.info(`✅ Image téléchargée avec succès pour ${senderId}`);
                        return { type: 'media_sent', success: true };
                    } else {
                        throw new Error('Impossible d\'envoyer le média ni en vidéo ni en image');
                    }
                }
            } catch (sendError) {
                log.error(`❌ Erreur envoi média: ${sendError.message}`);
                
                // ✅ FALLBACK: Envoyer le lien direct si l'envoi échoue
                const fallbackMsg = `📎 **Lien de téléchargement direct :**

🔗 ${mediaUrl}

${title ? `📽️ **Titre :** ${title}\n` : ''}${author ? `👤 **Auteur :** ${author}\n` : ''}
📱 Cliquez sur le lien pour télécharger le média directement !

💡 **Astuce :** Le lien se téléchargera automatiquement quand vous cliquez dessus.

💕 **Préparé avec amour par NakamaBot !**`;

                addToMemory(senderIdStr, 'assistant', fallbackMsg);
                return fallbackMsg;
            }

        } catch (apiError) {
            log.error(`❌ Erreur API ALLDL: ${apiError.message}`);
            
            // ✅ NOUVEAU: Supprimer du cache en cas d'erreur
            downloadCache.delete(cacheKey);
            
            // ✅ MESSAGES D'ERREUR AMÉLIORÉS ET PLUS SPÉCIFIQUES
            let errorMsg = "❌ **Échec du téléchargement**\n\n";
            
            if (apiError.response?.status === 404) {
                errorMsg += "🚫 **Erreur :** Média introuvable ou URL invalide\n";
                errorMsg += "💡 **Solutions possibles :**\n";
                errorMsg += "   • Vérifiez que l'URL est correcte et complète\n";
                errorMsg += "   • Assurez-vous que le contenu est public\n";
                errorMsg += "   • Réessayez avec une URL différente";
            } else if (apiError.response?.status === 403) {
                errorMsg += "🔒 **Erreur :** Accès refusé (contenu privé ou géo-restreint)\n";
                errorMsg += "💡 **Solutions possibles :**\n";
                errorMsg += "   • Le contenu est peut-être privé\n";
                errorMsg += "   • Il pourrait être géo-restreint\n";
                errorMsg += "   • Essayez avec un autre contenu public";
            } else if (apiError.code === 'ECONNABORTED' || apiError.message.includes('timeout')) {
                errorMsg += "⏰ **Erreur :** Délai d'attente dépassé\n";
                errorMsg += "💡 **Solutions possibles :**\n";
                errorMsg += "   • Le fichier est trop volumineux\n";
                errorMsg += "   • Le serveur est temporairement lent\n";
                errorMsg += "   • Réessayez dans quelques minutes";
            } else if (apiError.response?.status >= 500) {
                errorMsg += "🔧 **Erreur :** Problème serveur temporaire\n";
                errorMsg += "💡 **Solutions possibles :**\n";
                errorMsg += "   • Les serveurs de téléchargement sont occupés\n";
                errorMsg += "   • Réessayez dans 5-10 minutes\n";
                errorMsg += "   • Le service pourrait être en maintenance";
            } else if (apiError.message.includes('API a retourné le statut')) {
                errorMsg += `🐛 **Erreur API :** ${apiError.message}\n`;
                errorMsg += "💡 **Solutions possibles :**\n";
                errorMsg += "   • L'API de téléchargement a un problème temporaire\n";
                errorMsg += "   • Réessayez dans quelques minutes\n";
                errorMsg += "   • Vérifiez que l'URL est supportée";
            } else {
                errorMsg += `🐛 **Erreur technique :** ${apiError.message}\n`;
                errorMsg += "💡 **Solutions possibles :**\n";
                errorMsg += "   • Vérifiez que l'URL est correcte\n";
                errorMsg += "   • Réessayez dans quelques minutes\n";
                errorMsg += "   • Contactez l'admin si le problème persiste";
            }
            
            errorMsg += `\n🔗 **URL testée :** ${url.length > 60 ? url.substring(0, 60) + '...' : url}`;
            errorMsg += `\n🎬 **Plateforme :** ${extractDomain(url)}`;
            errorMsg += "\n\n🆘 Tapez `/help` si vous avez besoin d'aide !";

            addToMemory(senderIdStr, 'assistant', errorMsg);
            return errorMsg;
        }

    } catch (error) {
        log.error(`❌ Erreur générale alldl pour ${senderId}: ${error.message}`);
        
        const generalErrorMsg = `💥 **Oups ! Erreur inattendue**

🐛 Une petite erreur technique s'est produite...

**Solutions possibles :**
• Vérifiez que votre URL est complète et correcte
• Réessayez dans quelques instants  
• Assurez-vous que le contenu est public
• Contactez l'admin si le problème persiste

🔗 **URL :** ${args ? args.substring(0, 60) + '...' : 'Non fournie'}

💕 Désolée pour ce petit désagrément ! Je fais de mon mieux pour vous aider !`;

        addToMemory(senderIdStr, 'assistant', generalErrorMsg);
        return generalErrorMsg;
    }
};

// === FONCTIONS UTILITAIRES AMÉLIORÉES ===

/**
 * ✅ NOUVEAU: Nettoyer le cache des entrées expirées
 */
function cleanExpiredCache() {
    const now = Date.now();
    const expiredKeys = [];
    
    for (const [key, entry] of downloadCache.entries()) {
        if (now - entry.timestamp > CACHE_DURATION) {
            expiredKeys.push(key);
        }
    }
    
    expiredKeys.forEach(key => downloadCache.delete(key));
    
    if (expiredKeys.length > 0) {
        console.log(`🧹 Cache nettoyé: ${expiredKeys.length} entrées expirées supprimées`);
    }
}

/**
 * ✅ NOUVEAU: Obtenir les statistiques du cache
 */
function getCacheStats() {
    const now = Date.now();
    let activeEntries = 0;
    let expiredEntries = 0;
    
    for (const [key, entry] of downloadCache.entries()) {
        if (now - entry.timestamp <= CACHE_DURATION) {
            activeEntries++;
        } else {
            expiredEntries++;
        }
    }
    
    return {
        total: downloadCache.size,
        active: activeEntries,
        expired: expiredEntries
    };
}

/**
 * Valide si une chaîne est une URL valide
 * @param {string} string - Chaîne à valider
 * @returns {boolean} - True si URL valide
 */
function isValidUrl(string) {
    if (!string || typeof string !== 'string') return false;
    
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

/**
 * Extrait le domaine d'une URL avec icônes
 * @param {string} url - URL complète
 * @returns {string} - Nom du domaine avec icône
 */
function extractDomain(url) {
    try {
        const urlObj = new URL(url);
        let domain = urlObj.hostname.toLowerCase();
        
        // Simplifier les domaines connus avec icônes appropriées
        if (domain.includes('youtube.com') || domain.includes('youtu.be')) {
            return '🔴 YouTube';
        } else if (domain.includes('tiktok.com')) {
            return '🎵 TikTok';
        } else if (domain.includes('instagram.com')) {
            return '📸 Instagram';
        } else if (domain.includes('facebook.com') || domain.includes('fb.watch')) {
            return '📘 Facebook';
        } else if (domain.includes('twitter.com') || domain.includes('x.com')) {
            return '🐦 Twitter/X';
        } else if (domain.includes('snapchat.com')) {
            return '👻 Snapchat';
        } else if (domain.includes('pinterest.com')) {
            return '📌 Pinterest';
        } else if (domain.includes('linkedin.com')) {
            return '💼 LinkedIn';
        } else if (domain.includes('reddit.com')) {
            return '🤖 Reddit';
        } else if (domain.includes('twitch.tv')) {
            return '🎮 Twitch';
        } else {
            return '🌐 ' + domain.replace('www.', '');
        }
    } catch (error) {
        return '🌐 Site inconnu';
    }
}

/**
 * ✅ NOUVELLE FONCTION: Envoyer une vidéo avec gestion d'erreur améliorée
 * @param {string} recipientId - ID du destinataire
 * @param {string} videoUrl - URL de la vidéo
 * @param {string} caption - Légende
 * @returns {object} - Résultat de l'envoi
 */
async function sendVideoMessage(recipientId, videoUrl, caption = "") {
    // Cette fonction devrait être définie dans le contexte, mais on va l'émuler
    const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
    
    if (!PAGE_ACCESS_TOKEN) {
        return { success: false, error: "No token" };
    }
    
    const data = {
        recipient: { id: String(recipientId) },
        message: {
            attachment: {
                type: "video",
                payload: {
                    url: videoUrl,
                    is_reusable: true
                }
            }
        }
    };
    
    try {
        const axios = require('axios');
        const response = await axios.post(
            "https://graph.facebook.com/v18.0/me/messages",
            data,
            {
                params: { access_token: PAGE_ACCESS_TOKEN },
                timeout: 30000 // 30 secondes pour les vidéos
            }
        );
        
        if (response.status === 200) {
            // Envoyer la légende séparément si fournie
            if (caption && typeof sendMessage === 'function') {
                await new Promise(resolve => setTimeout(resolve, 1000)); // Attendre 1s
                return await sendMessage(recipientId, caption);
            }
            return { success: true };
        } else {
            return { success: false, error: `API Error ${response.status}` };
        }
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// === AUTO-DOWNLOAD HANDLER AMÉLIORÉ ===

/**
 * Fonction pour gérer l'auto-téléchargement (à intégrer dans le système de messages)
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} messageText - Texte du message
 * @param {object} ctx - Contexte
 */
async function handleAutoDownload(senderId, messageText, ctx) {
    const senderIdStr = String(senderId);
    
    // Vérifier si l'auto-download est activé pour cet utilisateur
    if (!autoDownloadSettings.get(senderIdStr)) return false;
    
    // Chercher des URLs dans le message (regex améliorée)
    const urlRegex = /(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|tiktok\.com\/@[\w.-]+\/video\/|instagram\.com\/(?:p|reel)\/|facebook\.com\/watch\/\?v=|fb\.watch\/|twitter\.com\/[\w]+\/status\/|x\.com\/[\w]+\/status\/)[\w.-]+(?:\S+)?)/gi;
    const urls = messageText.match(urlRegex);
    
    if (urls && urls.length > 0) {
        const url = urls[0]; // Prendre la première URL trouvée
        
        try {
            ctx.log.info(`🤖 Auto-téléchargement déclenché pour ${senderId}: ${url.substring(0, 50)}...`);
            
            // Exécuter la commande alldl automatiquement
            await module.exports(senderId, url, ctx);
            return true;
        } catch (error) {
            ctx.log.warning(`⚠️ Erreur auto-download pour ${senderId}: ${error.message}`);
        }
    }
    
    return false;
}

// Export des fonctions utilitaires
module.exports.handleAutoDownload = handleAutoDownload;
module.exports.autoDownloadSettings = autoDownloadSettings;
module.exports.isValidUrl = isValidUrl;
module.exports.downloadCache = downloadCache; // ✅ NOUVEAU: Export du cache pour debug
module.exports.getCacheStats = getCacheStats; // ✅ NOUVEAU: Export des stats
module.exports.cleanExpiredCache = cleanExpiredCache; // ✅ NOUVEAU: Export du nettoyage
