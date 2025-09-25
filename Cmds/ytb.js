// Cmds/ytb.js - Commande YouTube optimisée pour Render
// Mémoire temporaire + Cloudinary backup + Anti-rate-limit YouTube

const axios = require("axios");
const ytdl = require("@distube/ytdl-core");
const fs = require("fs");
const path = require("path");

// Cloudinary (optionnel)
let cloudinary = null;
try {
    cloudinary = require('cloudinary').v2;
    if (process.env.CLOUDINARY_CLOUD_NAME) {
        cloudinary.config({
            cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
            api_key: process.env.CLOUDINARY_API_KEY,
            api_secret: process.env.CLOUDINARY_API_SECRET
        });
    }
} catch (e) {
    // Cloudinary pas installé
}

// Créer le dossier tmp temporaire en mémoire
const tmpDir = '/tmp';
if (!fs.existsSync(tmpDir)) {
    try {
        fs.mkdirSync(tmpDir, { recursive: true });
    } catch (e) {
        // Si /tmp n'est pas accessible, utiliser un dossier local
        const localTmp = path.join(process.cwd(), 'temp');
        if (!fs.existsSync(localTmp)) {
            fs.mkdirSync(localTmp, { recursive: true });
        }
    }
}

// Cache en mémoire pour éviter les requêtes répétées
const searchCache = new Map();
const videoInfoCache = new Map();

// Rate limiting pour YouTube
let lastYouTubeRequest = 0;
const YOUTUBE_RATE_LIMIT = 2000; // 2 secondes entre les requêtes

async function waitForYouTube() {
    const now = Date.now();
    const timeSinceLastRequest = now - lastYouTubeRequest;
    
    if (timeSinceLastRequest < YOUTUBE_RATE_LIMIT) {
        const waitTime = YOUTUBE_RATE_LIMIT - timeSinceLastRequest;
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    lastYouTubeRequest = Date.now();
}

// User agents rotatifs pour éviter la détection
const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
];

function getRandomUserAgent() {
    return userAgents[Math.floor(Math.random() * userAgents.length)];
}

// Utilitaires
function formatNumber(num) {
    if (!num || isNaN(num)) return '0';
    if (num >= 1000000000) return (num / 1000000000).toFixed(1) + 'B';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

function parseAbbreviatedNumber(string) {
    if (!string) return 0;
    const match = string.replace(/[,\s]/g, '').match(/([\d.]+)([MBK]?)/);
    if (match) {
        let [, num, multi] = match;
        num = parseFloat(num);
        return Math.round(multi === 'M' ? num * 1000000 :
            multi === 'B' ? num * 1000000000 :
            multi === 'K' ? num * 1000 : num);
    }
    return 0;
}

// Stream avec retry et timeout optimisé
async function getStreamAndSize(url, filename = "") {
    const maxRetries = 3;
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await axios({
                method: "GET",
                url,
                responseType: "stream",
                headers: {
                    'Range': 'bytes=0-',
                    'User-Agent': getRandomUserAgent(),
                    'Accept': '*/*',
                    'Accept-Encoding': 'gzip, deflate',
                    'Connection': 'keep-alive'
                },
                timeout: 45000, // 45 secondes
                maxRedirects: 5
            });
            
            if (filename) response.data.path = filename;
            
            const totalLength = parseInt(response.headers["content-length"]) || 0;
            return {
                stream: response.data,
                size: totalLength
            };
        } catch (error) {
            lastError = error;
            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, attempt * 2000));
            }
        }
    }
    
    throw new Error(`Erreur de stream après ${maxRetries} tentatives: ${lastError.message}`);
}

// Recherche YouTube optimisée avec cache et rate limiting
async function searchYoutube(keyWord) {
    const cacheKey = keyWord.toLowerCase().trim();
    
    // Vérifier le cache
    if (searchCache.has(cacheKey)) {
        const cached = searchCache.get(cacheKey);
        if (Date.now() - cached.timestamp < 300000) { // 5 minutes
            return cached.results;
        }
    }
    
    await waitForYouTube();
    
    try {
        const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(keyWord)}`;
        const response = await axios.get(url, {
            headers: {
                'User-Agent': getRandomUserAgent(),
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            },
            timeout: 20000
        });
        
        const html = response.data;
        const jsonMatch = html.match(/ytInitialData\s*=\s*({.+?});/);
        
        if (!jsonMatch) {
            throw new Error("Impossible d'extraire les données YouTube");
        }
        
        const data = JSON.parse(jsonMatch[1]);
        const videos = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];
        
        const results = [];
        for (const video of videos.slice(0, 6)) { // Limiter à 6 résultats
            if (video.videoRenderer?.lengthText?.simpleText && video.videoRenderer?.videoId) {
                results.push({
                    id: video.videoRenderer.videoId,
                    title: video.videoRenderer.title.runs?.[0]?.text || 'Titre indisponible',
                    thumbnail: video.videoRenderer.thumbnail?.thumbnails?.pop()?.url || '',
                    duration: video.videoRenderer.lengthText.simpleText,
                    channel: {
                        name: video.videoRenderer.ownerText?.runs?.[0]?.text || 'Chaîne inconnue',
                        id: video.videoRenderer.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId || ''
                    }
                });
            }
        }
        
        // Mettre en cache
        searchCache.set(cacheKey, {
            results,
            timestamp: Date.now()
        });
        
        // Nettoyer le cache (garder max 50 entrées)
        if (searchCache.size > 50) {
            const oldestKey = searchCache.keys().next().value;
            searchCache.delete(oldestKey);
        }
        
        return results;
    } catch (error) {
        if (error.response?.status === 429) {
            throw new Error("YouTube rate limit - Réessaie dans quelques minutes");
        }
        throw new Error(`Erreur de recherche: ${error.message}`);
    }
}

// Informations vidéo avec cache
async function getVideoInfo(videoId) {
    // Nettoyer l'ID
    if (videoId.includes('youtube.com') || videoId.includes('youtu.be')) {
        const match = videoId.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
        videoId = match ? match[1] : videoId;
    }
    
    // Vérifier le cache
    if (videoInfoCache.has(videoId)) {
        const cached = videoInfoCache.get(videoId);
        if (Date.now() - cached.timestamp < 600000) { // 10 minutes
            return cached.info;
        }
    }
    
    await waitForYouTube();
    
    try {
        const response = await axios.get(`https://www.youtube.com/watch?v=${videoId}`, {
            headers: {
                'User-Agent': getRandomUserAgent(),
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache'
            },
            timeout: 20000
        });
        
        const html = response.data;
        
        const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
        if (!playerMatch) {
            throw new Error("Vidéo non accessible ou privée");
        }
        
        const playerData = JSON.parse(playerMatch[1]);
        const videoDetails = playerData.videoDetails;
        
        if (!videoDetails || videoDetails.isLiveContent) {
            throw new Error("Vidéo non supportée (live ou privée)");
        }
        
        const result = {
            videoId: videoDetails.videoId,
            title: videoDetails.title,
            lengthSeconds: parseInt(videoDetails.lengthSeconds) || 0,
            viewCount: parseInt(videoDetails.viewCount) || 0,
            likes: 0,
            uploadDate: "Date inconnue",
            thumbnails: videoDetails.thumbnail?.thumbnails || [],
            author: videoDetails.author || 'Auteur inconnu',
            channel: {
                name: videoDetails.author || 'Chaîne inconnue',
                subscriberCount: 0,
                thumbnails: []
            }
        };
        
        // Mettre en cache
        videoInfoCache.set(videoId, {
            info: result,
            timestamp: Date.now()
        });
        
        // Nettoyer le cache
        if (videoInfoCache.size > 30) {
            const oldestKey = videoInfoCache.keys().next().value;
            videoInfoCache.delete(oldestKey);
        }
        
        return result;
    } catch (error) {
        if (error.response?.status === 429) {
            throw new Error("YouTube rate limit - Patiente 2-3 minutes");
        }
        throw new Error(`Erreur vidéo: ${error.message}`);
    }
}

// Upload vers Cloudinary (si disponible)
async function uploadToCloudinary(filePath, resourceType = 'auto') {
    if (!cloudinary || !process.env.CLOUDINARY_CLOUD_NAME) {
        return null;
    }
    
    try {
        const result = await cloudinary.uploader.upload(filePath, {
            resource_type: resourceType,
            public_id: `nakamabot_${Date.now()}`,
            overwrite: true,
            folder: 'nakamabot_youtube',
            expires_at: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24h
        });
        
        return {
            url: result.secure_url,
            public_id: result.public_id
        };
    } catch (error) {
        return null;
    }
}

// Téléchargement vidéo optimisé
async function downloadVideo(videoInfo, context) {
    const { sendMessage, log } = context;
    const MAX_SIZE = 83 * 1024 * 1024; // 83MB
    
    try {
        await waitForYouTube();
        
        const info = await ytdl.getInfo(videoInfo.videoId, {
            requestOptions: {
                headers: {
                    'User-Agent': getRandomUserAgent()
                }
            }
        });
        
        const formats = info.formats;
        
        // Chercher format optimal
        const videoFormat = formats
            .filter(f => {
                return f.hasVideo && f.hasAudio && 
                       f.contentLength && 
                       parseInt(f.contentLength) < MAX_SIZE &&
                       f.container === 'mp4';
            })
            .sort((a, b) => {
                const qualityOrder = { 'tiny': 1, 'small': 2, 'medium': 3, 'large': 4 };
                return (qualityOrder[a.quality] || 0) - (qualityOrder[b.quality] || 0);
            })[0];
        
        if (!videoFormat) {
            return {
                success: false,
                message: "⭕ Aucune vidéo compatible trouvée ! La vidéo est trop lourde (> 83MB) ou dans un format non supporté ! 💕"
            };
        }
        
        const stream = await getStreamAndSize(videoFormat.url, `${videoInfo.videoId}.mp4`);
        
        if (stream.size > MAX_SIZE) {
            return {
                success: false,
                message: "⭕ Vidéo trop lourde après vérification ! Essaie /ytb audio à la place ! 💕"
            };
        }
        
        // Utiliser /tmp pour Render
        const filename = `${videoInfo.videoId}_${Date.now()}.mp4`;
        const savePath = path.join('/tmp', filename);
        const writeStream = fs.createWriteStream(savePath);
        
        stream.stream.pipe(writeStream);
        
        return new Promise((resolve) => {
            let timeout = setTimeout(() => {
                writeStream.destroy();
                resolve({
                    success: false,
                    message: "⏱️ Timeout de téléchargement ! Vidéo trop longue à traiter ! 💕"
                });
            }, 120000); // 2 minutes max
            
            writeStream.on('finish', async () => {
                clearTimeout(timeout);
                
                // Essayer d'uploader vers Cloudinary si disponible
                const cloudinaryResult = await uploadToCloudinary(savePath, 'video');
                
                resolve({
                    success: true,
                    filePath: savePath,
                    filename: filename,
                    size: stream.size,
                    cloudinaryUrl: cloudinaryResult?.url || null
                });
            });
            
            writeStream.on('error', (error) => {
                clearTimeout(timeout);
                resolve({
                    success: false,
                    message: `❌ Erreur téléchargement : ${error.message} ! 💕`
                });
            });
        });
        
    } catch (error) {
        if (error.message.includes('rate limit') || error.message.includes('429')) {
            return {
                success: false,
                message: "🚦 YouTube nous demande de ralentir ! Réessaie dans 2-3 minutes ! En attendant, utilise /ytb info ! 💕"
            };
        }
        
        return {
            success: false,
            message: `💥 Erreur : ${error.message} ! Réessaie avec une vidéo plus courte ! 💕`
        };
    }
}

// Téléchargement audio optimisé
async function downloadAudio(videoInfo, context) {
    const { sendMessage, log } = context;
    const MAX_SIZE = 27 * 1024 * 1024; // 27MB
    
    try {
        await waitForYouTube();
        
        const info = await ytdl.getInfo(videoInfo.videoId, {
            requestOptions: {
                headers: {
                    'User-Agent': getRandomUserAgent()
                }
            }
        });
        
        const formats = info.formats;
        
        const audioFormat = formats
            .filter(f => {
                return f.hasAudio && !f.hasVideo && 
                       f.contentLength && 
                       parseInt(f.contentLength) < MAX_SIZE;
            })
            .sort((a, b) => parseInt(b.audioBitrate || 0) - parseInt(a.audioBitrate || 0))[0];
        
        if (!audioFormat) {
            return {
                success: false,
                message: "⭕ Aucun audio compatible ! Trop lourd (> 27MB) ou format non supporté ! 💕"
            };
        }
        
        const stream = await getStreamAndSize(audioFormat.url, `${videoInfo.videoId}.webm`);
        
        if (stream.size > MAX_SIZE) {
            return {
                success: false,
                message: "⭕ Audio trop lourd après vérification ! 💕"
            };
        }
        
        const filename = `${videoInfo.videoId}_${Date.now()}.webm`;
        const savePath = path.join('/tmp', filename);
        const writeStream = fs.createWriteStream(savePath);
        
        stream.stream.pipe(writeStream);
        
        return new Promise((resolve) => {
            let timeout = setTimeout(() => {
                writeStream.destroy();
                resolve({
                    success: false,
                    message: "⏱️ Timeout audio ! 💕"
                });
            }, 90000); // 1.5 minutes
            
            writeStream.on('finish', async () => {
                clearTimeout(timeout);
                
                const cloudinaryResult = await uploadToCloudinary(savePath, 'video'); // 'video' pour audio aussi
                
                resolve({
                    success: true,
                    filePath: savePath,
                    filename: filename,
                    size: stream.size,
                    cloudinaryUrl: cloudinaryResult?.url || null
                });
            });
            
            writeStream.on('error', (error) => {
                clearTimeout(timeout);
                resolve({
                    success: false,
                    message: `❌ Erreur audio : ${error.message} ! 💕`
                });
            });
        });
        
    } catch (error) {
        if (error.message.includes('rate limit') || error.message.includes('429')) {
            return {
                success: false,
                message: "🚦 YouTube rate limit ! Patiente 2-3 minutes ! 💕"
            };
        }
        
        return {
            success: false,
            message: `💥 Erreur audio : ${error.message} ! 💕`
        };
    }
}

// Nettoyage automatique des fichiers temporaires
function cleanupTempFiles() {
    try {
        const tempDir = '/tmp';
        if (fs.existsSync(tempDir)) {
            const files = fs.readdirSync(tempDir);
            const now = Date.now();
            
            files.forEach(file => {
                if (file.includes('_') && (file.endsWith('.mp4') || file.endsWith('.webm'))) {
                    const filePath = path.join(tempDir, file);
                    const stats = fs.statSync(filePath);
                    const age = now - stats.mtime.getTime();
                    
                    // Supprimer les fichiers de plus de 10 minutes
                    if (age > 600000) {
                        fs.unlinkSync(filePath);
                    }
                }
            });
        }
    } catch (e) {
        // Ignorer les erreurs de nettoyage
    }
}

// Nettoyage automatique toutes les 5 minutes
setInterval(cleanupTempFiles, 300000);

// Fonction principale
module.exports = async function(senderId, args, context) {
    const { log, sendMessage } = context;
    
    try {
        if (!args.trim()) {
            const cloudinaryStatus = (cloudinary && process.env.CLOUDINARY_CLOUD_NAME) ? "✅ Activé" : "❌ Non configuré";
            
            return `🎥 **YouTube Downloader Pro** 📺

**Commandes :**
• \`/ytb video [recherche/lien]\` - Vidéo (< 83MB)
• \`/ytb audio [recherche/lien]\` - Audio (< 27MB)  
• \`/ytb info [recherche/lien]\` - Informations

**Exemples :**
• \`/ytb video minecraft song\`
• \`/ytb audio https://youtu.be/abc123\`

⚙️ **Statut Cloudinary :** ${cloudinaryStatus}
🔄 **Cache :** ${searchCache.size} recherches, ${videoInfoCache.size} vidéos
⚠️ **Anti Rate-Limit :** 2s entre requêtes

💡 **Conseils :**
• Vidéos courtes = plus de succès
• Si "rate limit" → attendre 2-3 min
• /ytb info fonctionne toujours !`;
        }
        
        const parts = args.trim().split(' ');
        const command = parts[0].toLowerCase();
        const query = parts.slice(1).join(' ').trim();
        
        if (!['video', 'audio', 'info'].includes(command)) {
            return "❌ Commande invalide ! Utilise : `video`, `audio` ou `info` 💕";
        }
        
        if (!query) {
            return `❌ Qu'est-ce que je dois chercher ? 🔍\nExemple : \`/ytb ${command} fallen kingdom\` 💕`;
        }
        
        const youtubeRegex = /^(?:https?:\/\/)?(?:m\.|www\.)?(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})(?:\S+)?$/;
        const isYouTubeUrl = youtubeRegex.test(query);
        
        let videoInfo;
        
        if (isYouTubeUrl) {
            await sendMessage(senderId, "🔍 Analyse du lien... ⏳");
            const match = query.match(youtubeRegex);
            const videoId = match ? match[1] : null;
            
            if (!videoId) {
                return "❌ Lien YouTube invalide ! 💕";
            }
            
            videoInfo = await getVideoInfo(videoId);
        } else {
            await sendMessage(senderId, `🔍 Recherche YouTube pour "${query}"... ⏳`);
            
            const searchResults = await searchYoutube(query);
            
            if (searchResults.length === 0) {
                return `❌ Aucun résultat pour "${query}" ! Essaie d'autres mots-clés ! 💕`;
            }
            
            const firstResult = searchResults[0];
            videoInfo = await getVideoInfo(firstResult.id);
        }
        
        // Traitement des commandes
        if (command === 'info') {
            const duration = videoInfo.lengthSeconds;
            const hours = Math.floor(duration / 3600);
            const minutes = Math.floor((duration % 3600) / 60);
            const seconds = duration % 60;
            const formattedDuration = hours > 0 
                ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
                : `${minutes}:${seconds.toString().padStart(2, '0')}`;
            
            return `🎥 **Informations Vidéo**

📺 **Titre :** ${videoInfo.title}
🏪 **Chaîne :** ${videoInfo.channel.name}
⏱️ **Durée :** ${formattedDuration}
👀 **Vues :** ${formatNumber(videoInfo.viewCount)}
🆔 **ID :** ${videoInfo.videoId}
🔗 **Lien :** https://youtu.be/${videoInfo.videoId}

💡 Utilise \`/ytb video\` ou \`/ytb audio\` pour télécharger ! ✨`;
        }
        
        if (command === 'video') {
            await sendMessage(senderId, `⬇️ Téléchargement vidéo "${videoInfo.title.substring(0, 50)}..."... Patiente ! 💕`);
            
            const result = await downloadVideo(videoInfo, context);
            
            if (!result.success) {
                return result.message;
            }
            
            const sizeInMB = Math.round(result.size / 1024 / 1024 * 100) / 100;
            
            // Nettoyer après 2 minutes
            setTimeout(() => {
                if (fs.existsSync(result.filePath)) {
                    fs.unlinkSync(result.filePath);
                }
            }, 120000);
            
            if (result.cloudinaryUrl) {
                return `✅ **Vidéo téléchargée !**

📺 **${videoInfo.title}**
📁 **Taille :** ${sizeInMB} MB
🌐 **Lien Cloudinary :** ${result.cloudinaryUrl}

💡 **Note :** Lien valide 24h, télécharge vite ! 💕`;
            } else {
                return `✅ **Vidéo prête !**

📺 **${videoInfo.title}**
📁 **Taille :** ${sizeInMB} MB

⚠️ **Fichier en mémoire temporaire**
💡 L'envoi direct de fichiers sera disponible prochainement !
🔗 En attendant : https://youtu.be/${videoInfo.videoId}`;
            }
        }
        
        if (command === 'audio') {
            await sendMessage(senderId, `🎵 Téléchargement audio "${videoInfo.title.substring(0, 50)}..."... Un instant ! 💕`);
            
            const result = await downloadAudio(videoInfo, context);
            
            if (!result.success) {
                return result.message;
            }
            
            const sizeInMB = Math.round(result.size / 1024 / 1024 * 100) / 100;
            
            setTimeout(() => {
                if (fs.existsSync(result.filePath)) {
                    fs.unlinkSync(result.filePath);
                }
            }, 120000);
            
            if (result.cloudinaryUrl) {
                return `✅ **Audio téléchargé !**

🎵 **${videoInfo.title}**
📁 **Taille :** ${sizeInMB} MB
🌐 **Lien Cloudinary :** ${result.cloudinaryUrl}

💡 **Note :** Lien valide 24h ! 💕`;
            } else {
                return `✅ **Audio prêt !**

🎵 **${videoInfo.title}**
📁 **Taille :** ${sizeInMB} MB

⚠️ **Fichier temporaire créé**
💡 L'envoi direct sera disponible bientôt !`;
            }
        }
        
    } catch (error) {
        log.error(`❌ Erreur YouTube: ${error.message}`);
        
        if (error.message.includes('rate limit') || error.message.includes('429')) {
            return `🚦 **YouTube Rate Limit !**

YouTube nous demande de ralentir un peu ! 😅

💡 **Solutions :**
• Attendre 2-3 minutes avant de réessayer
• Utiliser \`/ytb info\` (pas de limite)
• Essayer avec un autre terme de recherche

⏰ **Status :** Dernière requête il y a ${Math.round((Date.now() - lastYouTubeRequest) / 1000)}s

💕 Je serai de nouveau opérationnelle dans quelques minutes !`;
        }
        
        if (error.message.includes('timeout')) {
            return "⏱️ YouTube met du temps à répondre ! Réessaie dans quelques instants ! 💕";
        }
        
        if (error.message.includes('Video unavailable')) {
            return "📺 Cette vidéo n'est pas disponible ! (privée, supprimée, ou geo-bloquée) 💕";
        }
        
        return `💥 Erreur technique ! 

🔧 **Détails :** ${error.message}

💡 **Suggestions :**
• Réessayer dans quelques minutes
• Utiliser des vidéos plus courtes
• Vérifier que la vidéo est publique

💕 Tape \`/ytb\` pour revoir l'aide !`;
    }
};
