/**
 * Commande /rank - Génère et affiche une carte de rang avec image
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments (non utilisés)
 * @param {object} ctx - Contexte partagé du bot 
 */

const axios = require('axios');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Configuration du système de niveaux
const DELTA_NEXT = 5;
const expToLevel = (exp) => Math.floor((1 + Math.sqrt(1 + 8 * exp / DELTA_NEXT)) / 2);
const levelToExp = (level) => Math.floor(((Math.pow(level, 2) - level) * DELTA_NEXT) / 2);

// Stockage temporaire des données utilisateur
const userExp = new Map();

// Fonction pour obtenir l'avatar utilisateur via l'API Facebook
async function getUserAvatar(userId, ctx) {
    const { PAGE_ACCESS_TOKEN } = ctx;
    if (!PAGE_ACCESS_TOKEN) return null;
    
    try {
        const response = await axios.get(`https://graph.facebook.com/v18.0/${userId}`, {
            params: {
                fields: 'picture.width(200).height(200)',
                access_token: PAGE_ACCESS_TOKEN
            },
            timeout: 10000
        });
        return response.data.picture?.data?.url || null;
    } catch (error) {
        return null;
    }
}

// Fonction pour obtenir le nom utilisateur via l'API Facebook
async function getUserName(userId, ctx) {
    const { PAGE_ACCESS_TOKEN } = ctx;
    if (!PAGE_ACCESS_TOKEN) return `Utilisateur ${userId.substring(0, 8)}`;
    
    try {
        const response = await axios.get(`https://graph.facebook.com/v18.0/${userId}`, {
            params: {
                fields: 'name',
                access_token: PAGE_ACCESS_TOKEN
            },
            timeout: 10000
        });
        return response.data.name || `Utilisateur ${userId.substring(0, 8)}`;
    } catch (error) {
        return `Utilisateur ${userId.substring(0, 8)}`;
    }
}

// Fonction pour télécharger et traiter l'avatar
async function processAvatar(avatarUrl) {
    try {
        if (!avatarUrl) {
            // Créer un avatar par défaut avec Sharp
            const defaultAvatar = Buffer.from(`
                <svg width="120" height="120" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                        <linearGradient id="defaultGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
                            <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
                        </linearGradient>
                    </defs>
                    <circle cx="60" cy="60" r="60" fill="url(#defaultGrad)"/>
                    <text x="60" y="80" text-anchor="middle" fill="white" font-size="50" font-family="Arial">👤</text>
                </svg>
            `);
            
            return await sharp(defaultAvatar)
                .png()
                .resize(120, 120)
                .toBuffer();
        }

        // Télécharger et traiter l'avatar
        const response = await axios.get(avatarUrl, {
            responseType: 'arraybuffer',
            timeout: 10000
        });

        return await sharp(response.data)
            .resize(120, 120)
            .png()
            .toBuffer();

    } catch (error) {
        // Retourner avatar par défaut en cas d'erreur
        const defaultAvatar = Buffer.from(`
            <svg width="120" height="120" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <linearGradient id="defaultGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
                        <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
                    </linearGradient>
                </defs>
                <circle cx="60" cy="60" r="60" fill="url(#defaultGrad)"/>
                <text x="60" y="80" text-anchor="middle" fill="white" font-size="50" font-family="Arial">👤</text>
            </svg>
        `);
        
        return await sharp(defaultAvatar)
            .png()
            .resize(120, 120)
            .toBuffer();
    }
}

// Fonction pour créer le SVG de la carte de rang
function createRankCardSVG(data) {
    const { name, level, exp, expNextLevel, currentExp, rank, totalUsers } = data;
    
    // Calculer la progression
    const progress = currentExp / expNextLevel;
    const progressPercent = Math.round(progress * 100);
    const progressWidth = 400 * progress;
    
    // Échapper les caractères spéciaux XML
    const escapedName = name.replace(/[<>&'"]/g, (char) => {
        const entities = { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' };
        return entities[char];
    });

    return `
    <svg width="800" height="300" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <!-- Dégradé principal -->
            <linearGradient id="mainGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
                <stop offset="50%" style="stop-color:#764ba2;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#f093fb;stop-opacity:1" />
            </linearGradient>
            
            <!-- Dégradé pour la barre de progression -->
            <linearGradient id="progressGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:#00ff88;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#00d4ff;stop-opacity:1" />
            </linearGradient>
            
            <!-- Masque circulaire pour l'avatar -->
            <clipPath id="avatarClip">
                <circle cx="90" cy="90" r="60"/>
            </clipPath>
            
            <!-- Filtre d'ombre -->
            <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
                <feDropShadow dx="2" dy="2" stdDeviation="3" flood-color="rgba(0,0,0,0.3)"/>
            </filter>
        </defs>
        
        <!-- Fond principal -->
        <rect width="800" height="300" fill="url(#mainGrad)"/>
        
        <!-- Overlay semi-transparent -->
        <rect width="800" height="300" fill="rgba(0, 0, 0, 0.3)"/>
        
        <!-- Espace réservé pour l'avatar (sera remplacé par l'image) -->
        <rect id="avatar-placeholder" x="30" y="30" width="120" height="120" fill="transparent"/>
        
        <!-- Bordure de l'avatar -->
        <circle cx="90" cy="90" r="62" fill="none" stroke="#ffffff" stroke-width="4" filter="url(#shadow)"/>
        
        <!-- Nom d'utilisateur -->
        <text x="180" y="70" fill="#ffffff" font-family="Arial, sans-serif" font-size="36" font-weight="bold" filter="url(#shadow)">${escapedName}</text>
        
        <!-- Niveau -->
        <text x="180" y="120" fill="#FFD700" font-family="Arial, sans-serif" font-size="48" font-weight="bold" filter="url(#shadow)">Niveau ${level}</text>
        
        <!-- Rang -->
        <text x="180" y="150" fill="#ffffff" font-family="Arial, sans-serif" font-size="24" filter="url(#shadow)">Rang ${rank}/${totalUsers}</text>
        
        <!-- Barre de progression - Fond -->
        <rect x="180" y="180" width="400" height="30" rx="15" ry="15" fill="rgba(255, 255, 255, 0.2)"/>
        
        <!-- Barre de progression - Remplissage -->
        <rect x="180" y="180" width="${progressWidth}" height="30" rx="15" ry="15" fill="url(#progressGrad)"/>
        
        <!-- Texte de progression -->
        <text x="380" y="202" fill="#ffffff" font-family="Arial, sans-serif" font-size="18" text-anchor="middle" font-weight="bold">
            ${currentExp}/${expNextLevel} XP (${progressPercent}%)
        </text>
        
        <!-- XP Total -->
        <text x="180" y="250" fill="#ffffff" font-family="Arial, sans-serif" font-size="20">XP Total: ${exp}</text>
        
        <!-- Décorations avec icônes SVG -->
        <!-- Trophée -->
        <g transform="translate(710, 25)">
            <circle cx="20" cy="20" r="18" fill="#FFD700" stroke="#FFA500" stroke-width="2"/>
            <path d="M10 15 L15 10 L25 10 L30 15 L28 18 L25 16 L15 16 L12 18 Z" fill="#FFA500"/>
            <rect x="18" y="20" width="4" height="8" fill="#8B4513"/>
            <rect x="16" y="28" width="8" height="3" fill="#8B4513"/>
            <text x="20" y="18" fill="white" font-size="8" text-anchor="middle" font-weight="bold">1</text>
        </g>
        
        <!-- Étoile -->
        <g transform="translate(710, 75)">
            <circle cx="20" cy="20" r="18" fill="#FFD700" stroke="#FFA500" stroke-width="2"/>
            <path d="M20 8 L22 16 L30 16 L24 21 L26 29 L20 24 L14 29 L16 21 L10 16 L18 16 Z" fill="#FFA500"/>
        </g>
        
        <!-- Cible -->
        <g transform="translate(710, 125)">
            <circle cx="20" cy="20" r="18" fill="#FFD700" stroke="#FFA500" stroke-width="2"/>
            <circle cx="20" cy="20" r="14" fill="none" stroke="#FFA500" stroke-width="2"/>
            <circle cx="20" cy="20" r="10" fill="none" stroke="#FFA500" stroke-width="2"/>
            <circle cx="20" cy="20" r="6" fill="none" stroke="#FFA500" stroke-width="2"/>
            <circle cx="20" cy="20" r="3" fill="#FFA500"/>
        </g>
    </svg>`;
}

// Génération de la carte de rang avec Sharp + SVG
async function generateRankCard(data) {
    try {
        // Créer le SVG de base
        const svgContent = createRankCardSVG(data);
        
        // Traiter l'avatar
        const avatarBuffer = await processAvatar(data.avatar);
        
        // Créer l'avatar circulaire
        const circularAvatar = await sharp(avatarBuffer)
            .resize(120, 120)
            .composite([{
                input: Buffer.from(`
                    <svg width="120" height="120">
                        <circle cx="60" cy="60" r="60" fill="white"/>
                    </svg>
                `),
                blend: 'dest-in'
            }])
            .png()
            .toBuffer();
        
        // Créer l'image finale en composant le SVG avec l'avatar
        const finalImage = await sharp(Buffer.from(svgContent))
            .composite([{
                input: circularAvatar,
                left: 30,
                top: 30
            }])
            .png()
            .toBuffer();
        
        return finalImage;
        
    } catch (error) {
        throw new Error(`Erreur génération carte: ${error.message}`);
    }
}

// Génération d'une carte de rang textuelle (fallback)
function generateTextRankCard(data) {
    const { name, level, exp, expNextLevel, currentExp, rank, totalUsers } = data;
    
    const progressWidth = 20;
    const progress = Math.floor((currentExp / expNextLevel) * progressWidth);
    const progressBar = '█'.repeat(progress) + '░'.repeat(progressWidth - progress);
    
    return `🏆 **CARTE DE RANG** 🏆

👤 **${name}**
📊 **Niveau:** ${level}
🎯 **Rang:** ${rank}/${totalUsers}

📈 **Expérience:**
${progressBar} ${Math.round((currentExp / expNextLevel) * 100)}%
${currentExp}/${expNextLevel} XP (Total: ${exp} XP)

✨ Continue à discuter pour gagner plus d'XP !`;
}

// Fonction pour créer une URL accessible pour l'image
async function createAccessibleImageUrl(imageBuffer, userId, ctx) {
    try {
        // Option 1: Essayer d'utiliser l'URL du serveur si définie
        if (process.env.SERVER_URL) {
            const tempDir = path.join(__dirname, '..', 'temp');
            
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            
            const fileName = `rank_${userId}_${Date.now()}.png`;
            const filePath = path.join(tempDir, fileName);
            
            fs.writeFileSync(filePath, imageBuffer);
            
            const publicUrl = `${process.env.SERVER_URL}/temp/${fileName}`;
            
            return { filePath, url: publicUrl, isFile: true };
        }
        
        // Option 2: Fallback vers Data URL (Base64)
        const base64 = imageBuffer.toString('base64');
        const dataUrl = `data:image/png;base64,${base64}`;
        
        return { filePath: null, url: dataUrl, isFile: false };
        
    } catch (error) {
        ctx.log.warning(`⚠️ Erreur création URL image: ${error.message}`);
        return null;
    }
}

// Fonction pour nettoyer les fichiers temporaires
function cleanupTempFile(filePath) {
    if (!filePath) return;
    
    setTimeout(() => {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (error) {
            // Nettoyage silencieux
        }
    }, 10000);
}

module.exports = async function cmdRank(senderId, args, ctx) {
    const { log, userList, addToMemory, saveDataImmediate } = ctx;
    const senderIdStr = String(senderId);
    
    try {
        // Ajouter l'utilisateur s'il n'existe pas
        if (!userList.has(senderIdStr)) {
            userList.add(senderIdStr);
            await saveDataImmediate();
        }
        
        // Initialiser l'expérience si nécessaire
        if (!userExp.has(senderIdStr)) {
            userExp.set(senderIdStr, 0);
        }
        
        const exp = userExp.get(senderIdStr);
        const level = expToLevel(exp);
        const expForCurrentLevel = levelToExp(level);
        const expForNextLevel = levelToExp(level + 1);
        const expNextLevel = expForNextLevel - expForCurrentLevel;
        const currentExp = exp - expForCurrentLevel;
        
        // Calculer le rang
        const allUsersWithExp = Array.from(userExp.entries())
            .filter(([id, exp]) => exp > 0)
            .map(([id, exp]) => ({ id, exp }))
            .sort((a, b) => b.exp - a.exp);
        
        const userRank = allUsersWithExp.findIndex(user => user.id === senderIdStr) + 1;
        const totalUsers = allUsersWithExp.length;
        
        // Obtenir les informations utilisateur
        const [userName, userAvatar] = await Promise.all([
            getUserName(senderId, ctx),
            getUserAvatar(senderId, ctx)
        ]);
        
        const rankData = {
            name: userName,
            level: level,
            exp: exp,
            expNextLevel: expNextLevel,
            currentExp: currentExp,
            rank: userRank || 1,
            totalUsers: Math.max(totalUsers, 1),
            avatar: userAvatar
        };
        
        try {
            // Essayer de générer l'image avec Sharp + SVG
            const imageBuffer = await generateRankCard(rankData);
            const imageResult = await createAccessibleImageUrl(imageBuffer, senderIdStr, ctx);
            
            if (!imageResult) {
                throw new Error("Impossible de créer l'URL de l'image");
            }
            
            log.info(`🏆 Carte de rang générée avec Sharp+SVG (${imageResult.isFile ? 'fichier' : 'base64'}) pour ${userName} - Niveau ${level}, Rang #${userRank}`);
            
            // Programmer le nettoyage du fichier temporaire si nécessaire
            if (imageResult.isFile) {
                cleanupTempFile(imageResult.filePath);
            }
            
            return {
                type: 'image',
                url: imageResult.url,
                caption: `🏆 Voici ta carte de rang, ${userName} ! ✨\n\n📊 Niveau ${level} • Rang ${userRank}/${totalUsers}\n💫 Continue à discuter pour gagner plus d'XP !`
            };
            
        } catch (imageError) {
            log.warning(`⚠️ Erreur génération image avec Sharp pour ${userName}: ${imageError.message}`);
            // Fallback vers carte textuelle
            const rankCard = generateTextRankCard(rankData);
            log.info(`🏆 Carte de rang générée (texte fallback) pour ${userName} - Niveau ${level}, Rang #${userRank}`);
            addToMemory(senderIdStr, 'assistant', rankCard);
            return rankCard;
        }
        
    } catch (error) {
        log.error(`❌ Erreur commande rank: ${error.message}`);
        return "💥 Oops ! Erreur lors de la génération de ta carte de rang ! Réessaie plus tard ! 💕";
    }
};

// Fonction d'extension pour ajouter de l'expérience
module.exports.addExp = function(userId, expGain = 1) {
    const userIdStr = String(userId);
    
    if (!userExp.has(userIdStr)) {
        userExp.set(userIdStr, 0);
    }
    
    const currentExp = userExp.get(userIdStr);
    const newExp = currentExp + expGain;
    userExp.set(userIdStr, newExp);
    
    const oldLevel = expToLevel(currentExp);
    const newLevel = expToLevel(newExp);
    
    return {
        expGained: expGain,
        totalExp: newExp,
        levelUp: newLevel > oldLevel,
        oldLevel: oldLevel,
        newLevel: newLevel
    };
};

// Fonction pour obtenir les données d'expérience
module.exports.getExpData = function() {
    return Object.fromEntries(userExp);
};

// Fonction pour charger les données d'expérience
module.exports.loadExpData = function(data) {
    if (data && typeof data === 'object') {
        Object.entries(data).forEach(([userId, exp]) => {
            if (typeof exp === 'number' && exp >= 0) {
                userExp.set(userId, exp);
            }
        });
    }
};
