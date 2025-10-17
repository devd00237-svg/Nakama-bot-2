/**
 * Commande /image - Génération d'images IA avec AI Horde (Pollinations en fallback)
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Description de l'image à générer
 * @param {object} ctx - Contexte partagé du bot
 */
const axios = require("axios");

// Configuration AI Horde
const AI_HORDE_API_URL = "https://stablehorde.net/api/v2";
const AI_HORDE_API_KEY = process.env.AI_HORDE_API_KEY || "MyCjl90bq7fwEaxobqSPHg"; // Clé anonyme par défaut

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
        // ✅ PRIORITÉ: Essayer d'abord avec AI Horde
        log.info(`🎨 Tentative génération AI Horde pour ${senderId}: ${prompt}`);
        
        const hordeResult = await generateWithAIHorde(optimizedPrompt, log);
        
        if (hordeResult && hordeResult.success) {
            // Sauvegarder dans la mémoire
            addToMemory(senderIdStr, 'user', `Image demandée: ${prompt}`);
            addToMemory(senderIdStr, 'assistant', `Image créée: ${prompt}`);
            
            // ✅ PROTECTION 3: Libérer le lock après succès
            userGenerationLocks.set(senderIdStr, {
                generating: false,
                lastGenTime: Date.now()
            });
            
            log.info(`💎 Image AI Horde créée avec succès pour ${senderId}`);
            
            return {
                type: "image",
                url: hordeResult.imageUrl,
                caption: `🎨 Image créée avec succès ! ✨
📝 "${prompt}"`
            };
        }
        
        throw new Error('AI Horde generation failed');
        
    } catch (hordeError) {
        log.warning(`⚠️ AI Horde échec pour ${senderId}: ${hordeError.message}`);
        
        try {
            // ✅ FALLBACK: Utiliser Pollinations si AI Horde échoue
            log.info(`🔄 Fallback Pollinations pour ${senderId}`);
            
            const pollinationsResult = await generateWithPollinations(optimizedPrompt, getRandomInt);
            
            if (pollinationsResult && pollinationsResult.success) {
                // Sauvegarder dans la mémoire
                addToMemory(senderIdStr, 'user', `Image demandée: ${prompt}`);
                addToMemory(senderIdStr, 'assistant', `Image créée: ${prompt}`);
                
                // ✅ PROTECTION 4: Libérer le lock après succès fallback
                userGenerationLocks.set(senderIdStr, {
                    generating: false,
                    lastGenTime: Date.now()
                });
                
                log.info(`🌸 Image Pollinations créée avec succès pour ${senderId}`);
                
                return {
                    type: "image",
                    url: pollinationsResult.imageUrl,
                    caption: `🎨 Image créée avec succès ! ✨
📝 "${prompt}"`
                };
            }
            
            throw new Error('Pollinations generation also failed');
            
        } catch (pollinationsError) {
            log.error(`❌ Erreur totale génération image ${senderId}: AI Horde(${hordeError.message}) + Pollinations(${pollinationsError.message})`);
            
            // ✅ PROTECTION 5: Libérer le lock même en cas d'échec total
            userGenerationLocks.set(senderIdStr, {
                generating: false,
                lastGenTime: Date.now()
            });
            
            return `😢 Oups ! Problème pour créer l'image ! 
⏰ Réessaie bientôt ! 💖`;
        }
    }
};

// ✅ Helper pour attendre (sleep)
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ✅ Génération avec AI Horde (Stable Horde)
async function generateWithAIHorde(prompt, log) {
    try {
        const startTime = Date.now();
        
        // Étape 1: Créer une requête de génération
        const generatePayload = {
            prompt: prompt,
            params: {
                n: 1, // Nombre d'images
                width: 512, // Largeur (512, 768, 1024)
                height: 512, // Hauteur
                steps: 30, // Nombre d'étapes (20-50 recommandé)
                cfg_scale: 7.5, // Guidance scale (7-12 recommandé)
                sampler_name: "k_euler_a", // Sampler (k_euler_a, k_dpmpp_2m, etc.)
                seed: Math.floor(Math.random() * 4294967295).toString(),
                karras: true,
                denoising_strength: 0.75,
                post_processing: ["RealESRGAN_x4plus"] // Upscaling optionnel
            },
            nsfw: false, // Pas de contenu NSFW
            censor_nsfw: true,
            models: ["Deliberate", "Dreamshaper", "stable_diffusion"] // Modèles préférés
        };
        
        // Envoyer la requête
        log.info(`📤 Envoi requête AI Horde...`);
        const generateResponse = await axios.post(
            `${AI_HORDE_API_URL}/generate/async`,
            generatePayload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': AI_HORDE_API_KEY
                },
                timeout: 10000 // 10 secondes timeout pour l'envoi
            }
        );
        
        const requestId = generateResponse.data.id;
        log.info(`✅ Requête créée avec ID: ${requestId}`);
        
        // Étape 2: Polling pour vérifier le statut
        let attempts = 0;
        const maxAttempts = 60; // Max 2 minutes d'attente (2 secondes x 60)
        
        while (attempts < maxAttempts) {
            await sleep(2000); // Attendre 2 secondes
            
            const checkResponse = await axios.get(
                `${AI_HORDE_API_URL}/generate/check/${requestId}`,
                {
                    headers: { 'apikey': AI_HORDE_API_KEY },
                    timeout: 5000
                }
            );
            
            const status = checkResponse.data;
            log.info(`⏳ Statut AI Horde: ${status.done ? 'Terminé' : `En attente (${status.wait_time}s restant)`}`);
            
            // Si la génération est terminée
            if (status.done) {
                // Récupérer l'image
                const statusResponse = await axios.get(
                    `${AI_HORDE_API_URL}/generate/status/${requestId}`,
                    {
                        headers: { 'apikey': AI_HORDE_API_KEY },
                        timeout: 5000
                    }
                );
                
                const generations = statusResponse.data.generations;
                
                if (generations && generations.length > 0) {
                    const generation = generations[0];
                    const waitTime = Math.round((Date.now() - startTime) / 1000);
                    
                    log.info(`✅ Image AI Horde générée en ${waitTime}s`);
                    
                    return {
                        success: true,
                        imageUrl: generation.img
                    };
                }
            }
            
            // Si la requête a été mise en file d'attente
            if (status.waiting > 0 || status.processing > 0) {
                log.info(`⏳ File d'attente: ${status.queue_position || 0} positions, ${status.wait_time || 0}s estimés`);
            }
            
            attempts++;
        }
        
        // Timeout après le nombre max de tentatives
        throw new Error('Timeout: Image generation took too long');
        
    } catch (error) {
        log.error(`❌ Erreur AI Horde: ${error.message}`);
        
        if (error.response) {
            log.error(`   Status: ${error.response.status}`);
            log.error(`   Data: ${JSON.stringify(error.response.data)}`);
        }
        
        return { success: false, error: error.message };
    }
}

// ✅ Génération avec Pollinations (fallback)
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
