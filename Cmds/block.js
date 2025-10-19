const path = require('path');

// Commande /block pour gérer le blocage des messages
// Sous-commandes:
// - news [message]: Bloque les nouveaux utilisateurs
// - ancien [message]: Bloque les anciens utilisateurs
// - desactiver: Désactive tout blocage général (la blacklist reste active)
// - activer [message]: Bloque tout le monde
// - blacklist add [userId] [message optionnel]: Ajoute un utilisateur à la liste noire (bloqué à vie)
// - blacklist remove [userId]: Retire un utilisateur de la liste noire
// - blacklist list: Liste les utilisateurs en liste noire
// Réservé aux admins
// Stockage persistant via commandData (sauvegardé sur GitHub)
// La liste noire bloque les utilisateurs de manière permanente, même si le blocage général est désactivé.
// Les admins ne sont jamais bloqués, même en liste noire.

module.exports = async function blockCommand(senderId, args, context) {
    const { isAdmin, commandData, saveDataImmediate, sendMessage, log } = context;

    if (!isAdmin(senderId)) {
        log.warning(`⚠️ Tentative non-admin pour /block par ${senderId}`);
        return "❌ Cette commande est réservée aux administrateurs ! 💕";
    }

    if (!args || typeof args !== 'string') {
        return getUsage();
    }

    const parts = args.trim().split(/\s+/);
    const subcmd = parts[0].toLowerCase();
    let message = parts.slice(1).join(' ').trim();

    try {
        // Initialiser la blacklist si elle n'existe pas
        if (!commandData.has('blacklist')) {
            commandData.set('blacklist', new Map());
        }
        const blacklist = commandData.get('blacklist');

        switch (subcmd) {
            case 'news':
                if (!message) {
                    return "❌ Précise le message à envoyer aux nouveaux utilisateurs ! Ex: /block news Désolée, les nouveaux messages sont bloqués pour le moment ! 💕";
                }
                commandData.set('blockMode', 'new');
                commandData.set('blockMessage', message);
                await saveDataImmediate();
                log.info(`✅ Blocage activé pour les nouveaux par ${senderId}`);
                return `✅ Blocage activé pour les NOUVEAUX utilisateurs ! Message: "${message}" 💕\n(Les admins ne sont pas affectés)`;

            case 'ancien':
                if (!message) {
                    return "❌ Précise le message à envoyer aux anciens utilisateurs ! Ex: /block ancien Désolée, les messages sont bloqués pour maintenance ! 💕";
                }
                commandData.set('blockMode', 'old');
                commandData.set('blockMessage', message);
                await saveDataImmediate();
                log.info(`✅ Blocage activé pour les anciens par ${senderId}`);
                return `✅ Blocage activé pour les ANCIENS utilisateurs ! Message: "${message}" 💕\n(Les admins ne sont pas affectés)`;

            case 'desactiver':
                commandData.delete('blockMode');
                commandData.delete('blockMessage');
                await saveDataImmediate();
                log.info(`✅ Blocage général désactivé par ${senderId}`);
                return "✅ Tout blocage général a été désactivé ! Les messages passent normalement maintenant (sauf pour les utilisateurs en liste noire). ✨";

            case 'activer':
                if (!message) {
                    return "❌ Précise le message à envoyer à tout le monde ! Ex: /block activer Le bot est en maintenance, réessaie plus tard ! 💕";
                }
                commandData.set('blockMode', 'all');
                commandData.set('blockMessage', message);
                await saveDataImmediate();
                log.info(`✅ Blocage activé pour tous par ${senderId}`);
                return `✅ Blocage activé pour TOUS les utilisateurs ! Message: "${message}" 💕\n(Les admins ne sont pas affectés)`;

            case 'blacklist':
                const blacklistSub = parts[1] ? parts[1].toLowerCase() : '';
                if (!blacklistSub) {
                    return getUsage();
                }

                switch (blacklistSub) {
                    case 'add':
                        const userIdToAdd = parts[2];
                        const blacklistMsg = parts.slice(3).join(' ').trim() || "Désolée, tu es bloqué(e) à vie sur ce bot. Contacte un admin si c'est une erreur. 💔";
                        if (!userIdToAdd) {
                            return "❌ Précise l'ID de l'utilisateur à ajouter ! Ex: /block blacklist add 1234567890 Message optionnel";
                        }
                        blacklist.set(userIdToAdd, blacklistMsg);
                        await saveDataImmediate();
                        log.info(`✅ Utilisateur ${userIdToAdd} ajouté à la blacklist par ${senderId}`);
                        return `✅ Utilisateur ${userIdToAdd} ajouté à la liste noire ! Message: "${blacklistMsg}" 💔\n(Il sera bloqué à vie, même si le blocage général est désactivé.)`;

                    case 'remove':
                        const userIdToRemove = parts[2];
                        if (!userIdToRemove) {
                            return "❌ Précise l'ID de l'utilisateur à retirer ! Ex: /block blacklist remove 1234567890";
                        }
                        if (blacklist.delete(userIdToRemove)) {
                            await saveDataImmediate();
                            log.info(`✅ Utilisateur ${userIdToRemove} retiré de la blacklist par ${senderId}`);
                            return `✅ Utilisateur ${userIdToRemove} retiré de la liste noire ! Il peut maintenant utiliser le bot normalement. ✨`;
                        } else {
                            return `❌ Utilisateur ${userIdToRemove} non trouvé dans la liste noire. 🤔`;
                        }

                    case 'list':
                        if (blacklist.size === 0) {
                            return "📋 La liste noire est vide pour le moment ! ✨";
                        }
                        let listResponse = "📋 Utilisateurs en liste noire :\n\n";
                        for (const [userId, msg] of blacklist.entries()) {
                            listResponse += `• ${userId}: "${msg}"\n`;
                        }
                        return listResponse;

                    default:
                        return getUsage();
                }

            default:
                return getUsage();
        }
    } catch (error) {
        log.error(`❌ Erreur /block: ${error.message}`);
        return "💥 Oh non ! Erreur lors de la gestion du blocage. Réessaie ! 💕";
    }
};

function getUsage() {
    return `📋 Utilisation de /block (admin seulement) :\n\n` +
           `**Blocage général :**\n` +
           `/block news [message] - Bloque les nouveaux utilisateurs\n` +
           `/block ancien [message] - Bloque les anciens utilisateurs\n` +
           `/block activer [message] - Bloque tout le monde\n` +
           `/block desactiver - Désactive le blocage général (la liste noire reste active)\n\n` +
           `**Liste noire (blocage permanent) :**\n` +
           `/block blacklist add [userId] [message optionnel] - Ajoute un utilisateur bloqué à vie\n` +
           `/block blacklist remove [userId] - Retire un utilisateur de la liste noire\n` +
           `/block blacklist list - Liste les utilisateurs bloqués à vie\n\n` +
           `💡 Les admins ne sont jamais bloqués ! La liste noire persiste même après désactivation du blocage général. ✨`;
}
