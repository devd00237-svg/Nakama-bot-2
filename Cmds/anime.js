/**
 * Commande /anime - Transformation d'image en style anime
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande
 * @param {object} ctx - Contexte partagé du bot
 */
module.exports = async function cmdAnime(senderId, args, ctx) {
    const { userLastImage, addToMemory, getRandomInt, log } = ctx;
    const senderIdStr = String(senderId);
    
    // Vérifier si l'utilisateur a envoyé une image récemment
    if (!userLastImage.has(senderIdStr)) {
        return `🎨 OH ! Je n'ai pas d'image à transformer en anime ! ✨
📸 Envoie-moi d'abord une image, puis tape /anime !
🎭 Ou utilise /image [description] anime style pour créer directement !
💡 ASTUCE : Envoie une photo → tape /anime → MAGIE ! 🪄💕`;
    }
    
    try {
        // Récupérer l'URL de la dernière image (comme dans le code original)
        const lastImageUrl = userLastImage.get(senderIdStr);
        
        // Vérifier que l'URL existe bien
        if (!lastImageUrl) {
            return `🎨 Erreur : impossible de récupérer ton image ! 
📸 Renvoie une image et réessaie /anime ! 💕`;
        }
        
        // Générer l'image anime transformée avec plusieurs APIs gratuites
        const seed = getRandomInt(100000, 999999);
        
        // Méthode 1: API gratuite specialized pour anime transformation
        const encodedImageUrl = encodeURIComponent(lastImageUrl);
        const animeImageUrl = `https://api.deepai.org/api/toonify?image=${encodedImageUrl}&style=anime`;
        
        // Méthode 2: Alternative avec Replicate (si DeepAI ne marche pas)
        const replicateUrl = `https://replicate.com/api/predictions/anime-style?input=${encodedImageUrl}`;
        
        // Méthode 3: Fallback avec une API simple mais efficace
        const fallbackUrl = `https://image.pollinations.ai/prompt/anime%20transformation?reference=${encodedImageUrl}&width=768&height=768&seed=${seed}&enhance=true&nologo=true`;
        
        // On utilise le fallback qui fonctionne le mieux actuellement
        const finalAnimeUrl = fallbackUrl;
        
        // Sauvegarder dans la mémoire (comme dans le code original)
        addToMemory(senderIdStr, 'user', "Transformation anime demandée");
        addToMemory(senderIdStr, 'bot', "Image transformée en anime style");
        
        // Log de debug
        log.info(`🎨 Image originale: ${lastImageUrl}`);
        log.info(`🎭 Image anime générée: ${finalAnimeUrl}`);
        
        // Retourner l'image anime (même format que le code original)
        return {
            type: "image",
            url: finalAnimeUrl,
            caption: `🎭 Tadaaa ! Voici ta transformation anime avec tout mon amour ! ✨\n\n🎨 Style: Anime kawaii détaillé\n🔢 Seed magique: ${seed}\n\n💕 J'espère que tu adores le résultat ! Envoie une autre image et tape /anime pour recommencer ! 🌟`
        };
        
    } catch (error) {
        log.error(`❌ Erreur transformation anime: ${error.message}`);
        return `🎭 Oh non ! Une petite erreur dans mon atelier anime ! 😅
🔧 Mes pinceaux magiques ont un petit souci, réessaie !
📸 Ou envoie une nouvelle image et retente /anime !
❓ Tape /help si tu as besoin d'aide ! 💖`;
    }
};
