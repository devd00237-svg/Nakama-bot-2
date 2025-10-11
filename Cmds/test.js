// commands/emoji.js

/**
 * Commande /emoji - Réagit au message avec un emoji
 * Exemple: /emoji thumbsup → Répond avec 👍
 * Si pas d'argument, choisit un emoji aléatoire
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Nom de l'emoji (thumbsup, heart, etc.)
 * @param {object} ctx - Contexte du bot
 * @returns {string} - Message de confirmation ou emoji direct
 */

const EMOJI_MAP = {
    thumbsup: '👍',
    heart: '❤️',
    laugh: '😂',
    wow: '😮',
    sad: '😢',
    angry: '😡',
    like: '👍',
    love: '❤️',
    haha: '😂',
    yay: '🎉',
    // Ajoutez plus d'emojis si nécessaire
};

const RANDOM_EMOJIS = ['😊', '🎉', '👍', '❤️', '😂', '😎', '🌟', '🚀'];

module.exports = async function emojiCommand(senderId, args, ctx) {
    const { log, sendMessage } = ctx;
    
    try {
        let emoji;
        
        if (args.trim()) {
            const lowerArgs = args.toLowerCase().trim();
            emoji = EMOJI_MAP[lowerArgs];
            
            if (!emoji) {
                // Si pas trouvé, utiliser l'argument comme emoji direct si c'est un emoji
                if (/^[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]$/u.test(lowerArgs)) {
                    emoji = lowerArgs;
                } else {
                    return "🤔 Emoji non reconnu ! Essaie thumbsup, heart, laugh... ou envoie directement l'emoji ! 💕";
                }
            }
        } else {
            // Emoji aléatoire si pas d'argument
            emoji = RANDOM_EMOJIS[Math.floor(Math.random() * RANDOM_EMOJIS.length)];
        }
        
        // Envoyer l'emoji comme message
        const sendResult = await sendMessage(senderId, emoji);
        
        if (sendResult.success) {
            log.info(`✅ Emoji ${emoji} envoyé à ${senderId}`);
            return emoji; // Retourner l'emoji pour la mémoire
        } else {
            return "😔 Petite erreur pour envoyer l'emoji... Réessaie ! 💕";
        }
        
    } catch (error) {
        log.error(`❌ Erreur commande /emoji: ${error.message}`);
        return "😢 Oups, erreur avec l'emoji ! Réessaie plus tard ? 💕";
    }
};
