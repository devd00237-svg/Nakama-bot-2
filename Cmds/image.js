/**
 * Commande /image - Génération d'images IA (via Pollinations ou équivalent)
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Description de l'image à générer
 * @param {object} ctx - Contexte partagé du bot
 */

module.exports = async function cmdImage(senderId, args, ctx) {
    const { addToMemory, getRandomInt, log } = ctx;
    
    // ✅ Aide intégrée
    if (!args.trim()) {
        return `🎨 Je peux créer des images magnifiques à partir de ta description ! ✨
🖼️ /image [ta description]
🌸 Exemple : /image paysage féerique coucher soleil
⚡ /image random - Une image surprise !

💡 Donne-moi un maximum de détails pour un rendu parfait !
Styles possibles : réaliste, cartoon, anime, artistique... 💕`;
    }

    let prompt = args.trim();
    const senderIdStr = String(senderId);

    // ✅ Mode aléatoire
    if (prompt.toLowerCase() === "random") {
        const randomPrompts = [
            "beautiful fairy garden with glowing butterflies",
            "cyberpunk city with neon lights and flying cars",
            "cute robot exploring a crystal cave",
            "majestic dragon above snowy mountains",
            "dreamy underwater palace with mermaids",
            "futuristic samurai standing under cherry blossoms",
            "retro cafe in the rain, cinematic lighting",
            "cosmic goddess floating in galaxies",
            "forest spirit surrounded by fireflies",
            "adorable fox in a magical landscape"
        ];
        prompt = randomPrompts[Math.floor(Math.random() * randomPrompts.length)];
    }

    // ✅ Vérifications du prompt
    if (prompt.length < 3) {
        return "❌ Ta description est trop courte ! Donne-moi au moins 3 lettres 💕";
    }
    if (prompt.length > 200) {
        return "❌ Ta description est trop longue ! Maximum 200 caractères 🌸";
    }

    // ✅ Optimisation du prompt
    const optimizedPrompt = optimizePromptForImage(prompt);

    try {
        // ✅ Génération avec Pollinations
        log.info(`🎨 Génération d'image Pollinations pour ${senderId}: ${optimizedPrompt}`);
        const result = await generateWithPollinations(optimizedPrompt, getRandomInt);

        if (result.success) {
            addToMemory(senderIdStr, 'user', `Image demandée: ${prompt}`);
            addToMemory(senderIdStr, 'assistant', `Image générée: ${prompt}`);

            return {
                type: "image",
                url: result.imageUrl,
                caption: `🎨`
            };
        }

        throw new Error(result.error || "Erreur inconnue");

    } catch (error) {
        log.error(`❌ Erreur génération image ${senderId}: ${error.message}`);
        return `😅 Oups ! Mon atelier artistique est un peu surchargé...
⏰ Réessaie dans quelques secondes ou tape /image random pour une surprise ! 💕`;
    }
};

// ✅ Génération avec Pollinations (API publique)
async function generateWithPollinations(prompt, getRandomInt) {
    try {
        const encodedPrompt = encodeURIComponent(prompt);
        const seed = getRandomInt(100000, 999999);
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=768&height=768&seed=${seed}&enhance=true&nologo=true&model=flux`;
        return { success: true, imageUrl, seed };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ✅ Optimisation du prompt
function optimizePromptForImage(prompt) {
    let optimized = prompt.trim();

    // Ajouter des mots de qualité
    if (!/high quality|detailed|beautiful/i.test(optimized)) {
        optimized += ", high quality, detailed, beautiful lighting";
    }

    // Traduction basique français → anglais
    const dictionary = {
        'chat': 'cat',
        'chien': 'dog',
        'paysage': 'landscape',
        'femme': 'woman',
        'homme': 'man',
        'fleur': 'flower',
        'maison': 'house',
        'arbre': 'tree',
        'ciel': 'sky',
        'voiture': 'car'
    };
    for (const [fr, en] of Object.entries(dictionary)) {
        optimized = optimized.replace(new RegExp(`\\b${fr}\\b`, 'gi'), en);
    }

    return optimized;
}
