/**
 * Commande /restart - Redémarrage du bot (Admin seulement)
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande
 * @param {object} ctx - Contexte partagé du bot
 */
module.exports = async function cmdRestart(senderId, args, ctx) {
    const { isAdmin, sendMessage, log } = ctx;
    
    if (!isAdmin(senderId)) {
        return `🔐 Oh ! Cette commande est réservée aux admins !\nTon ID: ${senderId}\n💕 Tape /help pour voir ce que tu peux faire !`;
    }
    
    try {
        log.info(`🔄 Redémarrage demandé par admin ${senderId}`);
        
        // Envoyer confirmation avant redémarrage
        await sendMessage(senderId, "🔄 Je redémarre avec amour... À très bientôt ! 💖✨");
        
        // Forcer l'arrêt du processus (Render va le redémarrer automatiquement)
        setTimeout(() => {
            process.exit(0);
        }, 2000);
        
        return "🔄 Redémarrage initié avec tendresse ! Je reviens dans 2 secondes ! 💕";
    } catch (error) {
        log.error(`❌ Erreur redémarrage: ${error.message}`);
        return `❌ Oups ! Petite erreur lors du redémarrage : ${error.message} 💕`;
    }
};
