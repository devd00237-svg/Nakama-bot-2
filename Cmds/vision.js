/**
 * Commande /vision - Analyse d'images avec IA
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande
 * @param {object} ctx - Contexte partagé du bot
 */
module.exports = async function cmdVision(senderId, args, ctx) {
    const { userLastImage, addToMemory, analyzeImageWithVision, log } = ctx;
    const senderIdStr = String(senderId);
    
    // Vérifier si l'utilisateur a envoyé une image récemment
    if (!userLastImage.has(senderIdStr)) {
        return `👁️ Envoie une image d'abord ! ✨`;
    }
    
    try {
        // Récupérer l'URL de la dernière image
        const lastImageUrl = userLastImage.get(senderIdStr);
        
        // Analyser l'image avec l'API Vision
        log.info(`🔍 Analyse vision pour ${senderId}`);
        
        const visionResult = await analyzeImageWithVision(lastImageUrl);
        
        if (visionResult) {
            // Sauvegarder dans la mémoire
            addToMemory(senderIdStr, 'user', "Analyse d'image");
            addToMemory(senderIdStr, 'assistant', `Analyse: ${visionResult}`);
            
            return `👁️ L'image nous montre que ${visionResult}. ✨`;
        } else {
            return `👁️ Problème d'analyse. Réessaie ! 😅`;
        }
    } catch (error) {
        log.error(`❌ Erreur analyse vision: ${error.message}`);
        return `👁️ Erreur technique. Réessaie ! 😅`;
    }
};
