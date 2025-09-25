const Youtube = require('youtube-search-api');

/**
 * Commande /music - Recherche et renvoi lien YouTube
 * @param {string} senderId
 * @param {string} args - Titre musique (même mal écrit)
 * @param {object} ctx
 */
module.exports = async function cmdMusic(senderId, args, ctx) {
    const { addToMemory, log } = ctx;

    if (!args.trim()) {
        return `🎵 Tape /music suivi du titre pour recevoir un lien YouTube :
Exemples :
/music blinding light
/music eminem lose yourself`;
    }

    const query = args.trim();

    try {
        // Recherche YouTube gratuite
        const results = await Youtube.GetListByKeyword(query, false, 1);

        if (!results.items || results.items.length === 0) {
            return `😢 Désolé, aucune vidéo trouvée pour "${query}". Essaie un autre titre.`;
        }

        const video = results.items[0];
        const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;

        // Enregistrer dans la mémoire
        addToMemory(String(senderId), 'user', `/music ${query}`);
        addToMemory(String(senderId), 'bot', `Lien YouTube envoyé : ${videoUrl}`);

        return `🎶 Voici le lien YouTube pour "${query}" :
${videoUrl}

ℹ️ Tu peux écouter la musique directement ici.`;
    } catch (error) {
        log.error(`Erreur /music: ${error.message}`);
        return `⚠️ Oups, une erreur est survenue pendant la recherche. Essaie plus tard.`;
    }
};
