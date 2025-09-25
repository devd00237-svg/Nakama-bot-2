/**
 * Commande /start - Présentation du bot
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande
 * @param {object} ctx - Contexte partagé du bot
 */
module.exports = async function cmdStart(senderId, args, ctx) {
    return `💖 Coucou ! Je suis NakamaBot, créée avec amour par Durand ! 

✨ Voici ce que je peux faire pour toi :
🎨 /image [description] - Je crée de magnifiques images avec l'IA !
🎭 /anime - Je transforme ta dernière image en style anime !
👁️ /vision - Je décris ce que je vois sur ta dernière image !
💬 /chat [message] - On peut papoter de tout et de rien !
❓ /help - Toutes mes commandes (tape ça pour voir tout !)

🌸 Je suis là pour t'aider avec le sourire ! N'hésite pas à me demander tout ce que tu veux ! 💕`;
};
