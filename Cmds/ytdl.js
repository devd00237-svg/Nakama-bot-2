// Désactiver la vérification de mise à jour ytdl
process.env.YTDL_NO_UPDATE = 'true';

const ytdl = require('@distube/ytdl-core'); // Utiliser @ distube/ytdl-core (plus stable)

// Cache pour éviter les doublons
const downloadCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const autoDownloadSettings = new Map();

// Configuration pour Render Free
const RENDER_CONFIG = {
    timeout: 25000, // 25s max sur Render Free
    maxRetries: 2,
    userAgents: [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ]
};

module.exports = async function cmdYouTubeDl(senderId, args, ctx) {
    const { log, sendMessage, addToMemory, isAdmin } = ctx;
    const senderIdStr = String(senderId);
    
    try {
        // Afficher l'aide si aucun argument
        if (!args?.trim()) {
            const helpMsg = `🔴 **Téléchargeur YouTube YTDL**

📗 **Usage :** \`/ytdl [URL_YOUTUBE]\`

**URLs supportées :**
• \`https://www.youtube.com/watch?v=...\`
• \`https://youtu.be/...\`
• \`https://www.youtube.com/shorts/...\`

**Commandes admin :**
• \`/ytdl on\` - Active l'auto-téléchargement
• \`/ytdl off\` - Désactive l'auto-téléchargement

💡 **Exemple :** \`/ytdl https://www.youtube.com/watch?v=dQw4w9WgXcQ\`

⚡ **Optimisé pour Render Free !**`;

            addToMemory(senderIdStr, 'user', args || '/ytdl');
            addToMemory(senderIdStr, 'assistant', helpMsg);
            return helpMsg;
        }

        const command = args.trim().toLowerCase();

        // Gestion des paramètres auto-download
        if (command === 'on' || command === 'off') {
            if (!isAdmin(senderId)) {
                const noPermMsg = "🚫 Seuls les administrateurs peuvent modifier l'auto-téléchargement !";
                addToMemory(senderIdStr, 'user', args);
                addToMemory(senderIdStr, 'assistant', noPermMsg);
                return noPermMsg;
            }

            const isEnabled = command === 'on';
            autoDownloadSettings.set(senderIdStr, isEnabled);
            
            const statusMsg = `🔧 Auto-téléchargement YouTube ${isEnabled ? '**activé**' : '**désactivé**'} !`;
            addToMemory(senderIdStr, 'user', args);
            addToMemory(senderIdStr, 'assistant', statusMsg);
            safeLog(log, 'info', `🔧 Auto-download ${isEnabled ? 'ON' : 'OFF'} pour ${senderId}`);
            return statusMsg;
        }

        // Validation URL
        const url = args.trim();
        if (!isValidYouTubeUrl(url)) {
            const invalidMsg = `❌ **URL YouTube invalide !**

📝 **Formats acceptés :**
• \`https://www.youtube.com/watch?v=VIDEO_ID\`
• \`https://youtu.be/VIDEO_ID\`
• \`https://www.youtube.com/shorts/VIDEO_ID\`

💡 Copiez l'URL directement depuis YouTube !`;

            addToMemory(senderIdStr, 'user', args);
            addToMemory(senderIdStr, 'assistant', invalidMsg);
            return invalidMsg;
        }

        // Vérification cache anti-doublons
        const cacheKey = `${senderIdStr}_${url}`;
        const now = Date.now();
        cleanExpiredCache();
        
        if (downloadCache.has(cacheKey)) {
            const cacheEntry = downloadCache.get(cacheKey);
            const timeElapsed = now - cacheEntry.timestamp;
            
            if (timeElapsed < CACHE_DURATION) {
                const remainingTime = Math.ceil((CACHE_DURATION - timeElapsed) / 1000);
                const duplicateMsg = `🔄 Téléchargement récent ! Réessayez dans ${remainingTime}s.`;
                
                safeLog(log, 'debug', `🔄 Cache hit pour ${senderId}`);
                addToMemory(senderIdStr, 'user', args);
                addToMemory(senderIdStr, 'assistant', duplicateMsg);
                return duplicateMsg;
            }
        }

        // Message de chargement
        const loadingMsg = `⏳ **Téléchargement YouTube en cours...**

📗 URL: ${shortenUrl(url)}
🔴 Extraction des informations...
⚡ Optimisé Render Free`;

        addToMemory(senderIdStr, 'user', args);
        await sendMessage(senderId, loadingMsg);

        // Validation initiale
        if (!ytdl.validateURL(url)) {
            throw new Error('URL YouTube invalide selon ytdl-core');
        }

        safeLog(log, 'info', `📡 [RENDER] Extraction YouTube: ${shortenUrl(url)}`);

        // Configuration optimisée pour Render Free
        const info = await downloadWithRetry(url, log);
        
        if (!info?.videoDetails) {
            throw new Error('Impossible d\'obtenir les informations vidéo');
        }

        const videoDetails = info.videoDetails;
        const title = videoDetails.title;
        const author = videoDetails.author?.name || videoDetails.ownerChannelName || 'Inconnu';
        const duration = formatDuration(videoDetails.lengthSeconds);
        const viewCount = formatNumber(videoDetails.viewCount);

        safeLog(log, 'info', `✅ [RENDER] Infos: "${title.substring(0, 30)}..." par ${author}`);

        // Sélection format optimisée Render
        const format = selectBestFormatForRender(info.formats);
        
        if (!format?.url) {
            throw new Error('Aucun format compatible Render trouvé');
        }

        safeLog(log, 'info', `🎬 [RENDER] Format: ${format.qualityLabel || format.quality}`);

        // Ajouter au cache
        downloadCache.set(cacheKey, {
            timestamp: now,
            title: title,
            author: author,
            videoId: videoDetails.videoId
        });

        // Message de résultat
        const resultMessage = `✅ **YouTube téléchargé !**

🎬 **Titre :** ${cleanText(title, 70)}
📺 **Chaîne :** ${cleanText(author, 40)}
${duration ? `⏱️ **Durée :** ${duration}\n` : ''}${viewCount ? `👀 **Vues :** ${viewCount}\n` : ''}🎯 **Qualité :** ${format.qualityLabel || format.quality}
⚡ **Serveur :** Render Free

💕 **Téléchargé par NakamaBot !**`;

        // Envoi avec timeout Render
        try {
            safeLog(log, 'info', `📤 [RENDER] Envoi vidéo...`);
            
            const videoResult = await sendVideoMessageRender(senderId, format.url, resultMessage, ctx);
            
            if (videoResult.success) {
                addToMemory(senderIdStr, 'assistant', resultMessage);
                safeLog(log, 'info', `✅ [RENDER] Succès pour ${senderId}`);
                return { type: 'media_sent', success: true };
            } else {
                throw new Error(`Envoi échoué: ${videoResult.error}`);
            }
        } catch (sendError) {
            console.warn(`⚠️ [RENDER] Échec envoi: ${sendError.message}`);
            
            // Fallback: lien direct (compatible Render)
            const fallbackMsg = `🔗 **Lien YouTube direct :**

📗 **URL :** ${format.url}

🎬 **Titre :** ${cleanText(title, 50)}
📺 **Chaîne :** ${cleanText(author, 30)}
${duration ? `⏱️ **Durée :** ${duration}\n` : ''}🎯 **Qualité :** ${format.qualityLabel || format.quality}

📱 Cliquez pour télécharger !
⚡ Via Render Free`;

            addToMemory(senderIdStr, 'assistant', fallbackMsg);
            return fallbackMsg;
        }

    } catch (error) {
        safeLog(log, 'error', `❌ [RENDER] Erreur ytdl pour ${senderId}: ${error.message}`);
        
        // Supprimer du cache
        const cacheKey = `${senderIdStr}_${args?.trim()}`;
        downloadCache.delete(cacheKey);
        
        let errorMsg = "❌ **Échec téléchargement YouTube**\n\n";
        
        // Messages d'erreur spécifiques Render
        if (error.statusCode === 410 || error.message.includes('410')) {
            errorMsg += "🚫 **Erreur 410 :** Format expiré\n";
            errorMsg += "💡 **Solutions Render Free :**\n";
            errorMsg += "   • Les URLs YouTube expirent rapidement\n";
            errorMsg += "   • Réessayez immédiatement\n";
            errorMsg += "   • Utilisez `/alldl` comme alternative";
        } else if (error.statusCode === 403 || error.message.includes('403')) {
            errorMsg += "🚫 **Erreur 403 :** Accès refusé\n";
            errorMsg += "   • YouTube bloque parfois Render Free\n";
            errorMsg += "   • Attendez 30 secondes et réessayez\n";
            errorMsg += "   • Contactez l'admin si persistant";
        } else if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
            errorMsg += "⏰ **Timeout Render :** Délai dépassé\n";
            errorMsg += "   • Serveur Render Free limité à 25s\n";
            errorMsg += "   • Vidéo trop lourde pour Render\n";
            errorMsg += "   • Essayez une vidéo plus courte";
        } else if (error.message.includes('Video unavailable')) {
            errorMsg += "🚫 **Vidéo non disponible**\n";
            errorMsg += "   • Vidéo privée, supprimée ou restreinte\n";
            errorMsg += "   • Restriction géographique possible";
        } else {
            errorMsg += `🐛 **Erreur technique :** ${error.message.substring(0, 80)}\n`;
            errorMsg += "💡 **Solutions Render Free :**\n";
            errorMsg += "   • Réessayez dans 30 secondes\n";
            errorMsg += "   • Utilisez `/alldl` comme alternative\n";
            errorMsg += "   • Préférez des vidéos courtes (<5 min)";
        }
        
        errorMsg += `\n📗 **URL :** ${shortenUrl(args?.trim())}`;
        errorMsg += "\n⚡ **Serveur :** Render Free";

        addToMemory(senderIdStr, 'assistant', errorMsg);
        return errorMsg;
    }
};

// === FONCTIONS OPTIMISÉES RENDER ===

async function downloadWithRetry(url, log, retryCount = 0) {
    const userAgent = RENDER_CONFIG.userAgents[retryCount % RENDER_CONFIG.userAgents.length];
    
    const options = {
        requestOptions: {
            timeout: RENDER_CONFIG.timeout,
            headers: {
                'User-Agent': userAgent,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate',
                'Connection': 'keep-alive'
            }
        }
    };
    
    try {
        console.log(`🔄 [RENDER] Tentative ${retryCount + 1}/${RENDER_CONFIG.maxRetries + 1}`);
        const info = await ytdl.getInfo(url, options);
        return info;
    } catch (error) {
        if (retryCount < RENDER_CONFIG.maxRetries) {
            console.warn(`⚠️ [RENDER] Échec tentative ${retryCount + 1}: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, 2000)); // Attendre 2s
            return downloadWithRetry(url, log, retryCount + 1);
        }
        throw error;
    }
}

function selectBestFormatForRender(formats) {
    if (!formats?.length) {
        console.log('🚫 [RENDER] Aucun format disponible');
        return null;
    }
    
    console.log(`📋 [RENDER] ${formats.length} formats trouvés`);
    
    // Pour Render Free: privilégier formats légers et rapides
    const renderCompatible = formats.filter(f => {
        const hasValidUrl = f.url && f.url.includes('googlevideo.com');
        const isNotHeavy = !f.contentLength || parseInt(f.contentLength) < 50000000; // <50MB
        const isNotLive = !f.isLive;
        
        return hasValidUrl && isNotHeavy && isNotLive;
    });
    
    console.log(`✅ [RENDER] ${renderCompatible.length} formats compatibles`);
    
    // Préférer audio+video légers
    const videoFormats = renderCompatible.filter(f => f.hasVideo && f.hasAudio);
    
    if (videoFormats.length > 0) {
        // Préférer 360p ou 480p (optimal pour Render Free)
        const selected = videoFormats.find(f => f.qualityLabel === '360p') ||
                        videoFormats.find(f => f.qualityLabel === '480p') ||
                        videoFormats.find(f => f.quality === 'medium') ||
                        videoFormats.find(f => f.quality === 'small') ||
                        videoFormats[0];
        
        if (selected) {
            console.log(`🎯 [RENDER] Sélectionné: ${selected.qualityLabel || selected.quality}`);
            return selected;
        }
    }
    
    // Fallback: audio seulement (plus léger)
    const audioFormats = renderCompatible.filter(f => f.hasAudio && !f.hasVideo);
    
    if (audioFormats.length > 0) {
        const audioSelected = audioFormats.find(f => f.audioBitrate && f.audioBitrate <= 128) || audioFormats[0];
        console.log(`🎵 [RENDER] Audio sélectionné: ${audioSelected.audioBitrate}kbps`);
        return audioSelected;
    }
    
    console.log('❌ [RENDER] Aucun format compatible Render trouvé');
    return null;
}

async function sendVideoMessageRender(recipientId, videoUrl, caption = "", ctx) {
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
                    is_reusable: false
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
                timeout: 20000 // 20s max pour Render Free
            }
        );
        
        if (response.status === 200) {
            if (caption && ctx.sendMessage) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                await ctx.sendMessage(recipientId, caption);
            }
            return { success: true };
        }
        return { success: false, error: `API Error ${response.status}` };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// === FONCTIONS UTILITAIRES AVEC LOG SÉCURISÉ ===

function safeLog(log, level, message) {
    try {
        if (log && typeof log[level] === 'function') {
            log[level](message);
        } else {
            console[level] ? console[level](message) : console.log(`[${level.toUpperCase()}] ${message}`);
        }
    } catch (error) {
        console.log(`[${level.toUpperCase()}] ${message}`);
    }
}

function isValidYouTubeUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const youtubeRegex = /^https?:\/\/(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]{11}(\S+)?$/;
    return youtubeRegex.test(url);
}

function formatDuration(seconds) {
    if (!seconds) return null;
    const sec = parseInt(seconds);
    const hours = Math.floor(sec / 3600);
    const minutes = Math.floor((sec % 3600) / 60);
    const remainingSeconds = sec % 60;
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function formatNumber(num) {
    if (!num) return null;
    const number = parseInt(num);
    if (number >= 1000000) return (number / 1000000).toFixed(1) + 'M';
    if (number >= 1000) return (number / 1000).toFixed(1) + 'K';
    return number.toString();
}

function shortenUrl(url) {
    if (!url) return 'URL manquante';
    return url.length > 50 ? url.substring(0, 50) + '...' : url;
}

function cleanText(text, maxLength = 100) {
    if (!text) return 'Non disponible';
    return text.replace(/[^\w\s\-\.,!?()\[\]]/g, '').substring(0, maxLength).trim();
}

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
        console.log(`🧹 [RENDER] Cache nettoyé: ${expiredKeys.length} entrées`);
    }
}

// Auto-download handler
async function handleYouTubeAutoDownload(senderId, messageText, ctx) {
    const senderIdStr = String(senderId);
    
    if (!autoDownloadSettings.get(senderIdStr)) return false;
    
    const youtubeRegex = /(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)[\w-]{11}(?:\S+)?)/gi;
    const urls = messageText.match(youtubeRegex);
    
    if (urls?.length > 0) {
        const url = urls[0];
        try {
            safeLog(ctx.log, 'info', `🔴 [RENDER] Auto-download: ${shortenUrl(url)}`);
            await module.exports(senderId, url, ctx);
            return true;
        } catch (error) {
            safeLog(ctx.log, 'warn', `⚠️ [RENDER] Auto-download error: ${error.message}`);
        }
    }
    return false;
}

// Exports
module.exports.handleYouTubeAutoDownload = handleYouTubeAutoDownload;
module.exports.autoDownloadSettings = autoDownloadSettings;
module.exports.isValidYouTubeUrl = isValidYouTubeUrl;
