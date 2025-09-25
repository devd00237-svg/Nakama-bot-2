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
        return `👁️ OH ! Je n'ai pas d'image à analyser ! ✨

📸 Envoie-moi d'abord une image, puis tape /vision !
🔍 Je pourrai te dire tout ce que je vois avec mes yeux de robot ! 

💡 ASTUCE : Envoie une photo → tape /vision → Je décris tout ! 👀💕`;
    }
    
    try {
        // Récupérer l'URL de la dernière image
        const lastImageUrl = userLastImage.get(senderIdStr);
        
        // Analyser l'image avec l'API Vision
        log.info(`🔍 Analyse vision pour ${senderId}`);
        
        const visionResult = await analyzeImageWithVision(lastImageUrl);
        
        if (visionResult) {
            // Sauvegarder dans la mémoire
            addToMemory(senderIdStr, 'user', "Analyse d'image demandée");
            addToMemory(senderIdStr, 'bot', `Analyse: ${visionResult}`);
            
            return `👁️ VOICI CE QUE JE VOIS AVEC MES YEUX DE NAKAMA! ✨\n\n${visionResult}\n\n🔍 J'espère que mon analyse te plaît ! Envoie une autre image et tape /vision pour que je regarde encore ! 💕`;
        } else {
            return `👁️ Oh non ! Mes yeux de Nakama ont un petit souci ! 😅

🔧 Ma vision IA est temporairement floue !
📸 Réessaie avec /vision ou envoie une nouvelle image !
💡 Ou tape /help pour voir mes autres talents ! 💖`;
        }
    } catch (error) {
        log.error(`❌ Erreur analyse vision: ${error.message}`);
        return `👁️ Oups ! Une petite erreur dans mes circuits visuels ! 😅

🔧 Mes capteurs sont un peu fatigués, réessaie !
📸 Ou envoie une nouvelle image et retente /vision !
❓ Tape /help si tu as besoin d'aide ! 💖`;
    }
};
