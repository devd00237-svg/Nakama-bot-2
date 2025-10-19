const path = require('path');

// Commande /block pour gérer le blocage des messages
// Sous-commandes:
// - news [message]: Bloque les nouveaux utilisateurs
// - ancien [message]: Bloque les anciens utilisateurs
// - desactiver: Désactive tout blocage
// - activer [message]: Bloque tout le monde
// Réservé aux admins
// Stockage persistant via commandData (sauvegardé sur GitHub)

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
    const message = parts.slice(1).join(' ').trim();

    try {
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
                log.info(`✅ Blocage désactivé par ${senderId}`);
                return "✅ Tout blocage a été désactivé ! Les messages passent normalement maintenant. ✨";

            case 'activer':
                if (!message) {
                    return "❌ Précise le message à envoyer à tout le monde ! Ex: /block activer Le bot est en maintenance, réessaie plus tard ! 💕";
                }
                commandData.set('blockMode', 'all');
                commandData.set('blockMessage', message);
                await saveDataImmediate();
                log.info(`✅ Blocage activé pour tous par ${senderId}`);
                return `✅ Blocage activé pour TOUS les utilisateurs ! Message: "${message}" 💕\n(Les admins ne sont pas affectés)`;

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
           `/block news [message] - Bloque les nouveaux utilisateurs\n` +
           `/block ancien [message] - Bloque les anciens utilisateurs\n` +
           `/block activer [message] - Bloque tout le monde\n` +
           `/block desactiver - Désactive le blocage\n\n` +
           `💡 Les admins ne sont jamais bloqués ! ✨`;
}
