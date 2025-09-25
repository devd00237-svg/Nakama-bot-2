/**
 * Commande /stats - Statistiques du bot (Admin seulement)
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande
 * @param {object} ctx - Contexte partagé du bot
 */
module.exports = async function cmdStats(senderId, args, ctx) {
    const { isAdmin, userList, userMemory, userLastImage } = ctx;
    
    if (!isAdmin(senderId)) {
        return `🔐 Oh ! Cette commande est réservée aux admins seulement !\nTon ID: ${senderId}\n💕 Mais tu peux utiliser /help pour voir mes autres commandes !`;
    }
    
    return `📊 MES PETITES STATISTIQUES ADMIN ! ✨

👥 Mes amis utilisateurs : ${userList.size} 💕
💾 Conversations en cours : ${userMemory.size}
📸 Images en mémoire : ${userLastImage.size}
🤖 Créée avec amour par : Durand 💖
📅 Version : 4.0 Amicale + Vision (2025)
🎨 Génération d'images : ✅ JE SUIS DOUÉE !
🎭 Transformation anime : ✅ KAWAII !
👁️ Analyse d'images : ✅ J'AI DES YEUX DE ROBOT !
💬 Chat intelligent : ✅ ON PEUT TOUT SE DIRE !
🔐 Accès admin autorisé ✅

⚡ Je suis en ligne et super heureuse de t'aider !
❓ Tape /help pour voir toutes mes capacités ! 🌟`;
};
