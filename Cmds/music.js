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
        return `🎵 /music [titre] - Ex: /music blinding light`;
    }

    const query = args.trim();

    try {
        // Recherche YouTube gratuite
        const results = await Youtube.GetListByKeyword(query, false, 1);

        if (!results.items || results.items.length === 0) {
            return `😢 Aucune vidéo pour "${query}".`;
        }

        const video = results.items[0];
        const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;

        // Enregistrer dans la mémoire
        addToMemory(String(senderId), 'user', `/music ${query}`);
        addToMemory(String(senderId), 'assistant', `Lien: ${videoUrl}`);

        return `🎶 Voici le lien : ${videoUrl}`;
    } catch (error) {
        log.error(`Erreur /music: ${error.message}`);
        return `⚠️ Erreur recherche. Réessaie.`;
    }
};
