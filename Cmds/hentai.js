/**
 * Commande /hentai - Génération de contenu NSFW (+18)
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Description ou mot-clé suivi de "j'accepte"
 * @param {object} ctx - Contexte partagé du bot
 */
module.exports = async function cmdHentai(senderId, args, ctx) {
    const { addToMemory, getMemoryContext, isAdmin, log } = ctx;

    const senderIdStr = String(senderId);

    if (!args.toLowerCase().includes("j'accepte")) {
        return `🔞 Contenu NSFW réservé aux adultes (18+) !
Pour recevoir ce type d'image, tu dois confirmer que tu es majeur(e).

👉 Tape : /hentai [description ou vide] j'accepte

Exemples :
• /hentai elfe magique j'accepte
• /hentai j'accepte

⚠️ Cette commande est limitée à 5 utilisations par jour.
Les administrateurs ne sont pas concernés.`;
    }

    // Vérifier le quota journalier
    if (!isAdmin(senderId)) {
        const context = getMemoryContext(senderIdStr);
        const today = new Date().toISOString().split('T')[0];

        const hentaiUsagesToday = context.filter(entry =>
            entry.role === 'user' &&
            entry.content.toLowerCase().includes('/hentai') &&
            entry.timestamp?.startsWith(today)
        ).length;

        if (hentaiUsagesToday >= 5) {
            return `🚫 Tu as atteint la limite de 5 images hentai pour aujourd'hui.
⏳ Reviens demain, ou demande autre chose en attendant !`;
        }
    }

    try {
        // Nettoyer l'argument
        const cleanPrompt = args.replace(/j'?accepte/gi, '').trim();
        let imageUrl;

        if (!cleanPrompt) {
            // Image aléatoire via nekobot
            const res = await fetch("https://nekobot.xyz/api/image?type=hentai");
            const data = await res.json();
            imageUrl = data.message;
        } else {
            // Génération personnalisée (prompt stylé anime NSFW)
            const encodedPrompt = encodeURIComponent(`nsfw anime ${cleanPrompt}`);
            const seed = Math.floor(Math.random() * 1000000);
            imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=768&height=768&seed=${seed}&nologo=true`;
        }

        // Stocker l'interaction pour suivi
        addToMemory(senderIdStr, 'user', `/hentai ${cleanPrompt || '[random]'} j'accepte`);
        addToMemory(senderIdStr, 'bot', 'Image NSFW générée');

        return {
            type: "image",
            url: imageUrl,
            caption: `🔞 Voici ton image NSFW générée.
📝 ${cleanPrompt || "Image aléatoire"}
📌 Sois toujours respectueux de ce type de contenu.`
        };
    } catch (error) {
        log.error(`❌ Erreur /hentai: ${error.message}`);
        return `💥 Une erreur est survenue pendant la génération de l'image NSFW.
Réessaie dans quelques secondes ou contacte un admin.`;
    }
};
