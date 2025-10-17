/**
 * Commande /image - Génération d'images IA (AI Horde en priorité avec clé anonyme, Pollinations en secours)
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

    // Optimisation du prompt (sans traduction)
    const optimizedPrompt = optimizePromptForImage(prompt);

    try {
        // ⚡ Tentative 1 : AI Horde avec clé anonyme
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

// ⚙️ Génération via AI Horde (avec clé anonyme pour priorité basse)
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
            models: ["stable_diffusion_2.1"],  // Modèle mis à jour pour meilleure qualité
            r2: true
        };

        const res = await fetch("https://aihorde.net/api/v2/generate/async", {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "apikey": "MyCjl90bq7fwEaxobqSPHg"  // Clé anonyme pour accès basique
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            throw new Error(`AI Horde API error: ${res.status} - ${await res.text()}`);
        }

        const data = await res.json();
        if (!data.id) throw new Error("No job ID returned");

        // Attente du résultat avec timeout étendu
        let imageUrl = null;
        const maxAttempts = 60;  // Augmenté pour gérer files d'attente plus longues
        for (let i = 0; i < maxAttempts; i++) {
            const statusRes = await fetch(`https://aihorde.net/api/v2/generate/status/${data.id}`);
            if (!statusRes.ok) {
                throw new Error(`Status check error: ${statusRes.status}`);
            }
            const json = await statusRes.json();
            if (json.done && json.generations?.length > 0) {
                imageUrl = json.generations[0].img;
                break;
            }
            await new Promise(r => setTimeout(r, 3000));  // Pause 3s pour éviter rate limits
        }

        if (!imageUrl) throw new Error("AI Horde timeout after extended wait");
        log.info("✅ Image AI Horde générée avec succès");
        return { success: true, imageUrl, id: data.id };
    } catch (err) {
        log.error(`❌ AI Horde error: ${err.message}`);
        return { success: false, error: err.message };
    }
}

// 🎨 Génération via Pollinations (paramètres optimisés pour Flux)
async function generateWithPollinations(prompt, getRandomInt) {
    try {
        const encodedPrompt = encodeURIComponent(prompt);
        const seed = getRandomInt(100000, 999999);
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=768&height=768&seed=${seed}&enhance=true&nologo=true&model=flux`;
        // Vérifier si l'URL est accessible (optionnel, mais pour robustesse)
        const res = await fetch(imageUrl, { method: 'HEAD' });
        if (!res.ok) throw new Error(`Pollinations URL invalid: ${res.status}`);
        return { success: true, imageUrl, seed };
    } catch (error) {
        log.error(`❌ Pollinations error: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// 🧠 Optimisation du prompt (sans traduction)
function optimizePromptForImage(prompt) {
    let optimized = prompt.trim();
    if (!/high quality|detailed|beautiful/i.test(optimized)) {
        optimized += ", high quality, detailed, realistic lighting, vibrant colors, sharp focus";
    }
    return optimized;
}
