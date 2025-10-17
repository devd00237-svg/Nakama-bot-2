/**
 * Commande /image - Génération d'images IA (AI Horde en priorité, Pollinations en secours)
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Description de l'image à générer
 * @param {object} ctx - Contexte partagé du bot
 */

const fetch = require("node-fetch");

module.exports = async function cmdImage(senderId, args, ctx) {
    const { addToMemory, getRandomInt, log } = ctx;

    // 🖼️ Message d’aide
    if (!args.trim()) {
        return `🎨 Je crée des images à partir de ta description ! ✨
🖌️ /image [ta description] — ex: /image paysage féerique au coucher du soleil
⚡ /image random — une création surprise !
💡 Plus tu donnes de détails, plus le rendu est précis.
🎭 Styles : réaliste, anime, cartoon, artistique, etc.`;
    }

    let prompt = args.trim();
    const senderIdStr = String(senderId);

    // 🎲 Génération aléatoire
    if (prompt.toLowerCase() === "random") {
        const randomPrompts = [
            "majestic dragon flying above glowing volcano",
            "beautiful futuristic city with neon lights",
            "dreamy anime girl under cherry blossoms",
            "robot painter creating a sunset masterpiece",
            "tiny astronaut exploring a giant flower",
            "mystical forest spirit glowing in moonlight",
            "steampunk castle in the clouds",
            "beautiful African queen with golden jewelry",
            "cute fox surrounded by floating lanterns",
            "cyberpunk samurai walking in the rain"
        ];
        prompt = randomPrompts[Math.floor(Math.random() * randomPrompts.length)];
    }

    // Vérifications
    if (prompt.length < 3) return "❌ Ta description est trop courte ! 💕";
    if (prompt.length > 200) return "❌ Ta description est trop longue ! (max 200 caractères) 🌸";

    // Optimisation du prompt
    const optimizedPrompt = optimizePromptForImage(prompt);

    try {
        // ⚡ Tentative 1 : AI Horde
        log.info(`🎨 Tentative AI Horde pour ${senderId}: ${optimizedPrompt}`);
        const hordeResult = await generateWithAIHorde(optimizedPrompt, log);

        if (hordeResult.success) {
            addToMemory(senderIdStr, 'user', `Image demandée: ${prompt}`);
            addToMemory(senderIdStr, 'assistant', `Image générée via AI Horde: ${prompt}`);
            return {
                type: "image",
                url: hordeResult.imageUrl,
                caption: `🎨 Voici ton image magique ! ✨

📝 "${prompt}"
🤖 Générée par AI Horde
🔢 ID: ${hordeResult.id}

💖 Tape /image pour créer une nouvelle œuvre !`
            };
        }

        throw new Error("AI Horde indisponible");

    } catch (errorAI) {
        log.warning(`⚠️ AI Horde échec pour ${senderId}: ${errorAI.message}`);

        try {
            // 🪄 Fallback : Pollinations
            const pollinationsResult = await generateWithPollinations(optimizedPrompt, getRandomInt);

            if (pollinationsResult.success) {
                addToMemory(senderIdStr, 'user', `Image demandée: ${prompt}`);
                addToMemory(senderIdStr, 'assistant', `Image générée via Pollinations: ${prompt}`);
                return {
                    type: "image",
                    url: pollinationsResult.imageUrl,
                    caption: `🎨 Image générée avec Pollinations ✨

📝 "${prompt}"
🔢 Seed: ${pollinationsResult.seed}

💖 Tape /image pour une nouvelle création !`
                };
            }

            throw new Error("Pollinations indisponible");
        } catch (errorPolli) {
            log.error(`❌ Erreur totale génération image ${senderId}: Horde(${errorAI.message}) + Pollinations(${errorPolli.message})`);
            return `😢 Oups ! Aucun atelier ne répond en ce moment...
🧭 Réessaie dans quelques secondes ou tente /image random ! 💕`;
        }
    }
};

/* === Fonctions d’intégration === */

// ⚙️ Génération via AI Horde
async function generateWithAIHorde(prompt, log) {
    try {
        const payload = {
            prompt,
            params: {
                sampler_name: "k_euler_a",
                cfg_scale: 7,
                steps: 25,
                width: 768,
                height: 768,
                n: 1
            },
            nsfw: false,
            censor_nsfw: true,
            trusted_workers: true,
            models: ["stable_diffusion"],
            r2: true
        };

        const res = await fetch("https://aihorde.net/api/v2/generate/async", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!data.id) throw new Error("No job ID returned");

        // Attente du résultat
        let imageUrl = null;
        for (let i = 0; i < 30; i++) {
            const status = await fetch(`https://aihorde.net/api/v2/generate/status/${data.id}`);
            const json = await status.json();
            if (json.done && json.generations?.length > 0) {
                imageUrl = json.generations[0].img;
                break;
            }
            await new Promise(r => setTimeout(r, 2000)); // pause 2 s
        }

        if (!imageUrl) throw new Error("AI Horde timeout");
        log.info("✅ Image AI Horde générée avec succès");
        return { success: true, imageUrl, id: data.id };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// 🎨 Génération via Pollinations
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

// 🧠 Optimisation du prompt
function optimizePromptForImage(prompt) {
    let optimized = prompt.trim();
    if (!/high quality|detailed|beautiful/i.test(optimized)) {
        optimized += ", high quality, detailed, realistic lighting";
    }

    const translations = {
        'chat': 'cat',
        'chien': 'dog',
        'paysage': 'landscape',
        'fleur': 'flower',
        'femme': 'woman',
        'homme': 'man',
        'voiture': 'car',
        'arbre': 'tree',
        'maison': 'house'
    };
    for (const [fr, en] of Object.entries(translations)) {
        optimized = optimized.replace(new RegExp(`\\b${fr}\\b`, 'gi'), en);
    }

    return optimized;
}
