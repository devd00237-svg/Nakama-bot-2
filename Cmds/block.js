/**
 * Commande /block - Gestion du blocage des utilisateurs
 * Permet de bloquer les nouveaux utilisateurs, les anciens, ou tout le monde
 * Les admins ne sont jamais bloqués
 * 
 * Sous-commandes:
 * - /block news [message] : Bloquer uniquement les nouveaux utilisateurs
 * - /block ancien [message] : Bloquer uniquement les anciens utilisateurs
 * - /block activer [message] : Bloquer tout le monde (sauf admins)
 * - /block desactiver : Désactiver tous les blocages
 * - /block status : Voir l'état actuel du blocage
 * 
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande
 * @param {Object} context - Contexte global du bot
 * @returns {string} - Réponse à envoyer
 */

module.exports = async function block(senderId, args, context) {
    const {
        isAdmin,
        log,
        commandData,
        saveDataImmediate
    } = context;

    const senderIdStr = String(senderId);

    // Vérifier si l'utilisateur est admin
    if (!isAdmin(senderId)) {
        return "❌ Désolée, seuls les admins peuvent utiliser cette commande ! 💕";
    }

    // Initialiser les données de blocage si nécessaire
    if (!commandData.has('blockSystem')) {
        commandData.set('blockSystem', {
            mode: 'none', // 'none', 'news', 'ancien', 'all'
            message: "🚫 Désolée, je ne peux pas répondre pour le moment. Réessaie plus tard ! 💕",
            blockedCount: 0,
            lastUpdate: new Date().toISOString()
        });
    }

    const blockData = commandData.get('blockSystem');
    const subCommand = args.split(' ')[0]?.toLowerCase();
    const message = args.substring(subCommand.length).trim();

    // === SOUS-COMMANDE: status ===
    if (!subCommand || subCommand === 'status') {
        let statusMessage = "📊 **État du système de blocage** 📊\n\n";
        
        switch (blockData.mode) {
            case 'none':
                statusMessage += "✅ **Statut:** Aucun blocage actif\n";
                statusMessage += "🔓 Tous les utilisateurs peuvent m'écrire !\n";
                break;
            case 'news':
                statusMessage += "🆕 **Statut:** Nouveaux utilisateurs bloqués\n";
                statusMessage += "📝 **Message de blocage:**\n";
                statusMessage += `"${blockData.message}"\n\n`;
                statusMessage += "👥 Les anciens utilisateurs peuvent toujours m'écrire.\n";
                break;
            case 'ancien':
                statusMessage += "👴 **Statut:** Anciens utilisateurs bloqués\n";
                statusMessage += "📝 **Message de blocage:**\n";
                statusMessage += `"${blockData.message}"\n\n`;
                statusMessage += "🆕 Les nouveaux utilisateurs peuvent m'écrire.\n";
                break;
            case 'all':
                statusMessage += "🚫 **Statut:** Tous les utilisateurs bloqués\n";
                statusMessage += "📝 **Message de blocage:**\n";
                statusMessage += `"${blockData.message}"\n\n`;
                statusMessage += "⚠️ Seuls les admins peuvent m'écrire.\n";
                break;
        }

        statusMessage += `\n📊 Messages bloqués: ${blockData.blockedCount}\n`;
        statusMessage += `🕒 Dernière mise à jour: ${new Date(blockData.lastUpdate).toLocaleString('fr-FR')}\n\n`;
        
        statusMessage += "**Commandes disponibles:**\n";
        statusMessage += "• `/block news [message]` - Bloquer les nouveaux\n";
        statusMessage += "• `/block ancien [message]` - Bloquer les anciens\n";
        statusMessage += "• `/block activer [message]` - Bloquer tout le monde\n";
        statusMessage += "• `/block desactiver` - Désactiver le blocage\n";
        statusMessage += "• `/block status` - Voir cet état\n";

        return statusMessage;
    }

    // === SOUS-COMMANDE: desactiver ===
    if (subCommand === 'desactiver' || subCommand === 'désactiver' || subCommand === 'off') {
        const previousMode = blockData.mode;
        const previousBlockedCount = blockData.blockedCount;

        blockData.mode = 'none';
        blockData.lastUpdate = new Date().toISOString();
        commandData.set('blockSystem', blockData);

        await saveDataImmediate();

        log.info(`🔓 Système de blocage désactivé par admin ${senderId}`);

        return `✅ **Système de blocage désactivé !** ✅\n\n` +
               `🔓 Tous les utilisateurs peuvent maintenant m'écrire !\n\n` +
               `📊 **Statistiques:**\n` +
               `• Mode précédent: ${previousMode === 'news' ? 'Nouveaux bloqués' : previousMode === 'ancien' ? 'Anciens bloqués' : previousMode === 'all' ? 'Tous bloqués' : 'Aucun'}\n` +
               `• Messages bloqués pendant l'activation: ${previousBlockedCount}\n\n` +
               `💕 Tout est revenu à la normale !`;
    }

    // === SOUS-COMMANDE: news ===
    if (subCommand === 'news' || subCommand === 'new' || subCommand === 'nouveau' || subCommand === 'nouveaux') {
        if (!message) {
            return "❌ **Erreur:** Tu dois spécifier un message de blocage !\n\n" +
                   "**Exemple:**\n" +
                   "`/block news Désolée, je n'accepte pas de nouveaux utilisateurs pour le moment. Réessaie plus tard ! 💕`";
        }

        blockData.mode = 'news';
        blockData.message = message;
        blockData.blockedCount = 0; // Réinitialiser le compteur
        blockData.lastUpdate = new Date().toISOString();
        commandData.set('blockSystem', blockData);

        await saveDataImmediate();

        log.info(`🆕 Blocage des nouveaux utilisateurs activé par admin ${senderId}`);

        return `✅ **Blocage des nouveaux utilisateurs activé !** 🆕\n\n` +
               `📝 **Message de blocage configuré:**\n` +
               `"${message}"\n\n` +
               `🔒 Les nouveaux utilisateurs recevront ce message.\n` +
               `✅ Les anciens utilisateurs peuvent toujours m'écrire.\n` +
               `👑 Les admins ne sont jamais bloqués.\n\n` +
               `💡 Tape \`/block desactiver\` pour désactiver le blocage.`;
    }

    // === SOUS-COMMANDE: ancien ===
    if (subCommand === 'ancien' || subCommand === 'anciens' || subCommand === 'old') {
        if (!message) {
            return "❌ **Erreur:** Tu dois spécifier un message de blocage !\n\n" +
                   "**Exemple:**\n" +
                   "`/block ancien Désolée, je ne réponds plus aux anciens utilisateurs pour le moment. 💕`";
        }

        blockData.mode = 'ancien';
        blockData.message = message;
        blockData.blockedCount = 0; // Réinitialiser le compteur
        blockData.lastUpdate = new Date().toISOString();
        commandData.set('blockSystem', blockData);

        await saveDataImmediate();

        log.info(`👴 Blocage des anciens utilisateurs activé par admin ${senderId}`);

        return `✅ **Blocage des anciens utilisateurs activé !** 👴\n\n` +
               `📝 **Message de blocage configuré:**\n` +
               `"${message}"\n\n` +
               `🔒 Les anciens utilisateurs recevront ce message.\n` +
               `🆕 Les nouveaux utilisateurs peuvent m'écrire.\n` +
               `👑 Les admins ne sont jamais bloqués.\n\n` +
               `💡 Tape \`/block desactiver\` pour désactiver le blocage.`;
    }

    // === SOUS-COMMANDE: activer (tout le monde) ===
    if (subCommand === 'activer' || subCommand === 'all' || subCommand === 'tout' || subCommand === 'tous') {
        if (!message) {
            return "❌ **Erreur:** Tu dois spécifier un message de blocage !\n\n" +
                   "**Exemple:**\n" +
                   "`/block activer Désolée, je suis en maintenance. Reviens plus tard ! 💕`";
        }

        blockData.mode = 'all';
        blockData.message = message;
        blockData.blockedCount = 0; // Réinitialiser le compteur
        blockData.lastUpdate = new Date().toISOString();
        commandData.set('blockSystem', blockData);

        await saveDataImmediate();

        log.info(`🚫 Blocage de tous les utilisateurs activé par admin ${senderId}`);

        return `✅ **Blocage de TOUS les utilisateurs activé !** 🚫\n\n` +
               `📝 **Message de blocage configuré:**\n` +
               `"${message}"\n\n` +
               `🔒 Tous les utilisateurs (nouveaux ET anciens) recevront ce message.\n` +
               `👑 Seuls les admins peuvent m'écrire.\n\n` +
               `⚠️ **Attention:** Ceci bloque tout le monde sauf les admins !\n` +
               `💡 Tape \`/block desactiver\` pour désactiver le blocage.`;
    }

    // Commande inconnue
    return "❌ **Sous-commande inconnue !**\n\n" +
           "**Commandes disponibles:**\n" +
           "• `/block status` - Voir l'état du blocage\n" +
           "• `/block news [message]` - Bloquer les nouveaux\n" +
           "• `/block ancien [message]` - Bloquer les anciens\n" +
           "• `/block activer [message]` - Bloquer tout le monde\n" +
           "• `/block desactiver` - Désactiver le blocage\n\n" +
           "💡 Tape `/block status` pour voir l'état actuel.";
};

/**
 * Fonction utilitaire: Vérifier si un utilisateur doit être bloqué
 * Cette fonction doit être appelée dans le webhook principal
 * 
 * @param {string} senderId - ID de l'utilisateur
 * @param {boolean} isNewUser - Si l'utilisateur est nouveau
 * @param {Object} context - Contexte global du bot
 * @returns {Object} - {blocked: boolean, message: string}
 */
module.exports.checkIfBlocked = function(senderId, isNewUser, context) {
    const { isAdmin, commandData, log } = context;
    
    // Les admins ne sont jamais bloqués
    if (isAdmin(senderId)) {
        return { blocked: false, message: null };
    }

    // Vérifier si le système de blocage existe
    if (!commandData.has('blockSystem')) {
        return { blocked: false, message: null };
    }

    const blockData = commandData.get('blockSystem');

    // Vérifier le mode de blocage
    switch (blockData.mode) {
        case 'none':
            return { blocked: false, message: null };
        
        case 'news':
            if (isNewUser) {
                // Incrémenter le compteur
                blockData.blockedCount++;
                commandData.set('blockSystem', blockData);
                
                log.info(`🚫 Nouveau utilisateur ${senderId} bloqué (mode: news)`);
                return { blocked: true, message: blockData.message };
            }
            return { blocked: false, message: null };
        
        case 'ancien':
            if (!isNewUser) {
                // Incrémenter le compteur
                blockData.blockedCount++;
                commandData.set('blockSystem', blockData);
                
                log.info(`🚫 Ancien utilisateur ${senderId} bloqué (mode: ancien)`);
                return { blocked: true, message: blockData.message };
            }
            return { blocked: false, message: null };
        
        case 'all':
            // Incrémenter le compteur
            blockData.blockedCount++;
            commandData.set('blockSystem', blockData);
            
            log.info(`🚫 Utilisateur ${senderId} bloqué (mode: all)`);
            return { blocked: true, message: blockData.message };
        
        default:
            return { blocked: false, message: null };
    }
};

/**
 * Fonction utilitaire: Obtenir les statistiques de blocage
 * 
 * @param {Object} context - Contexte global du bot
 * @returns {Object} - Statistiques de blocage
 */
module.exports.getBlockStats = function(context) {
    const { commandData } = context;
    
    if (!commandData.has('blockSystem')) {
        return {
            active: false,
            mode: 'none',
            blockedCount: 0
        };
    }

    const blockData = commandData.get('blockSystem');
    
    return {
        active: blockData.mode !== 'none',
        mode: blockData.mode,
        message: blockData.message,
        blockedCount: blockData.blockedCount,
        lastUpdate: blockData.lastUpdate
    };
};
