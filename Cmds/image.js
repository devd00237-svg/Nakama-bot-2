/**
 * Commande /image - Génération d'images IA avec Pollinations
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Description de l'image à générer
 * @param {object} ctx - Contexte partagé du bot
 */

// ✅ Protection anti-spam - Limite de requêtes par utilisateur
const userGenerationLocks = new Map();
const COOLDOWN_MS = 5000; // 5 secondes de cooldown entre chaque génération

module.exports = async function cmdImage(senderId, args, ctx) {
    const { addToMemory, getRandomInt, log } = ctx;
    
    // ✅ PROTECTION 1: Vérifier si l'utilisateur a déjà une génération en cours
    const senderIdStr = String(senderId);
    const now = Date.now();
    
    if (userGenerationLocks.has(senderIdStr)) {
        const lockInfo = userGenerationLocks.get(senderIdStr);
        
        // Si une génération est en cours
        if (lockInfo.generating) {
            log.warning(`⚠️ ${senderId} essaie de générer pendant qu'une génération est en cours`);
            return `⏳ Patience ! Je crée ton image précédente ! 💕`;
        }
        
        // Si cooldown pas encore écoulé
        const timeSinceLastGen = now - lockInfo.lastGenTime;
        if (timeSinceLastGen < COOLDOWN_MS) {
            const remainingSeconds = Math.ceil((COOLDOWN_MS - timeSinceLastGen) / 1000);
            log.warning(`⚠️ ${senderId} en cooldown (${remainingSeconds}s restant)`);
            return `⏰ Attends ${remainingSeconds} seconde${remainingSeconds > 1 ? 's' : ''} ! 💕`;
        }
    }
    
    // ✅ PROTECTION 2: Marquer la génération comme en cours
    userGenerationLocks.set(senderIdStr, {
        generating: true,
        lastGenTime: now
    });
    
    if (!args.trim()) {
        // Libérer le lock si l'utilisateur demande juste l'aide
        userGenerationLocks.set(senderIdStr, {
            generating: false,
            lastGenTime: now
        });
        
        return `🎨 Crée des images ! ✨
🖼️ /image [description]
⚡ /image random - Surprise !`;
    }
    
    let prompt = args.trim();
    
    // Valider le prompt
    if (prompt.length < 3) {
        // Libérer le lock en cas d'erreur de validation
        userGenerationLocks.set(senderIdStr, {
            generating: false,
            lastGenTime: now
        });
        return "❌ Description trop courte ! 💕";
    }
    
    if (prompt.length > 500) {
        // Libérer le lock en cas d'erreur de validation
        userGenerationLocks.set(senderIdStr, {
            generating: false,
            lastGenTime: now
        });
        return "❌ Description trop longue ! 🌸";
    }
    
    // Images aléatoires si demandé
    if (prompt.toLowerCase() === "random") {
        const randomPrompts = [
            "beautiful fairy garden with sparkling flowers and butterflies",
            "cute magical unicorn in enchanted forest with rainbow",
            "adorable robot princess with jeweled crown in castle",
            "dreamy space goddess floating among stars and galaxies",
            "magical mermaid palace underwater with pearl decorations",
            "sweet vintage tea party with pastel colors and roses",
            "cozy cottagecore house with flower gardens and sunshine",
            "elegant anime girl with flowing dress in cherry blossoms",
            "mystical dragon soaring through aurora borealis",
            "cyberpunk city with neon lights and flying cars"
        ];
        prompt = randomPrompts[Math.floor(Math.random() * randomPrompts.length)];
    }
    
    // Optimiser le prompt pour de meilleurs résultats
    const optimizedPrompt = optimizePromptForImageGeneration(prompt);
    
    try {
        // ✅ Création de l'image avec Pollinations
        log.info(`🎨 Création de l'image pour ${senderId}: ${prompt}`);
        
        const pollinationsResult = await generateWithPollinations(optimizedPrompt, getRandomInt);
        
        if (pollinationsResult && pollinationsResult.success) {
            // Sauvegarder dans la mémoire
            addToMemory(senderIdStr, 'user', `Image demandée: ${prompt}`);
            addToMemory(senderIdStr, 'assistant', `Image créée: ${prompt}`);
            
            // ✅ PROTECTION 3: Libérer le lock après succès
            userGenerationLocks.set(senderIdStr, {
                generating: false,
                lastGenTime: Date.now()
            });
            
            log.info(`🌸 Image créée avec succès pour ${senderId}`);
            
            return {
                type: "image",
                url: pollinationsResult.imageUrl,
                caption: `🎨 Image créée avec succès ! ✨
📝 "${prompt}"`
            };
        }
        
        throw new Error('Pollinations generation failed');
        
    } catch (pollinationsError) {
        log.error(`❌ Erreur génération image ${senderId}: ${pollinationsError.message}`);
        
        // ✅ PROTECTION 4: Libérer le lock même en cas d'échec
        userGenerationLocks.set(senderIdStr, {
            generating: false,
            lastGenTime: Date.now()
        });
        
        return `😢 Oups ! Problème pour créer l'image ! 
⏰ Réessaie bientôt ! 💖`;
    }
};

// ✅ Génération avec Pollinations
async function generateWithPollinations(prompt, getRandomInt) {
    try {
        // Encoder le prompt pour l'URL
        const encodedPrompt = encodeURIComponent(prompt);
        
        // Générer avec des paramètres optimisés
        const seed = getRandomInt(100000, 999999);
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=768&height=768&seed=${seed}&enhance=true&nologo=true&model=flux`;
        
        return {
            success: true,
            imageUrl: imageUrl
        };
        
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ✅ Optimisation du prompt pour de meilleurs résultats
function optimizePromptForImageGeneration(prompt) {
    // Nettoyer le prompt
    let optimized = prompt.trim();
    
    // Ajouter des mots-clés pour améliorer la qualité si nécessaire
    const qualityKeywords = ['high quality', 'detailed', 'beautiful', 'artistic', 'masterpiece'];
    const hasQualityKeyword = qualityKeywords.some(keyword => 
        optimized.toLowerCase().includes(keyword)
    );
    
    if (!hasQualityKeyword && optimized.length < 150) {
        optimized += ', high quality, detailed, masterpiece';
    }
    
    return optimized;
}
