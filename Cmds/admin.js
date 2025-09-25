/**
 * Commande /admin - Panneau d'administration (Admin seulement)
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande
 * @param {object} ctx - Contexte partagé du bot
 */
module.exports = async function cmdAdmin(senderId, args, ctx) {
    const { isAdmin, userList, userMemory, userLastImage, MISTRAL_API_KEY, PAGE_ACCESS_TOKEN } = ctx;
    
    if (!isAdmin(senderId)) {
        return `🔐 Oh ! Accès réservé aux admins ! ID: ${senderId}\n💕 Tape /help pour voir mes autres talents !`;
    }
    
    if (!args.trim()) {
        return `🔐 PANNEAU ADMIN v4.0 AMICALE + VISION 💖

• /admin stats - Mes statistiques détaillées
• /stats - Statistiques publiques admin
• /broadcast [msg] - Diffusion pleine d'amour
• /restart - Me redémarrer en douceur

📊 MON ÉTAT ACTUEL :
👥 Mes utilisateurs : ${userList.size}
💾 Conversations en cours : ${userMemory.size}
📸 Images en mémoire : ${userLastImage.size}
🤖 IA intelligente : ${MISTRAL_API_KEY ? '✅ JE SUIS BRILLANTE !' : '❌'}
👁️ Vision IA : ${MISTRAL_API_KEY ? '✅ J\'AI DES YEUX DE ROBOT !' : '❌'}
📱 Facebook connecté : ${PAGE_ACCESS_TOKEN ? '✅ PARFAIT !' : '❌'}
👨‍💻 Mon créateur adoré : Durand 💕`;
    }
    
    if (args.trim().toLowerCase() === "stats") {
        return `📊 MES STATISTIQUES DÉTAILLÉES AVEC AMOUR 💖

👥 Utilisateurs totaux : ${userList.size} 💕
💾 Conversations actives : ${userMemory.size}
📸 Images stockées : ${userLastImage.size}
🔐 Admin ID : ${senderId}
👨‍💻 Mon créateur adoré : Durand ✨
📅 Version : 4.0 Amicale + Vision (2025)
🎨 Images générées : ✅ JE SUIS ARTISTE !
🎭 Transformations anime : ✅ KAWAII !
👁️ Analyses visuelles : ✅ J'AI DES YEUX DE ROBOT !
💬 Chat IA : ✅ ON PAPOTE !
🌐 Statut API : ${MISTRAL_API_KEY && PAGE_ACCESS_TOKEN ? '✅ Tout fonctionne parfaitement !' : '❌ Quelques petits soucis'}

⚡ Je suis opérationnelle et heureuse ! 🌟`;
    }
    
    return `❓ Oh ! L'action '${args}' m'est inconnue ! 💕`;
};
