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
            return `⏳ Patience ! Je suis déjà en train de créer ton image précédente ! 
✨ Attends qu'elle soit prête avant d'en demander une nouvelle !
🎨 Ça prend quelques secondes, je fais de mon mieux ! 💕`;
        }
        
        // Si cooldown pas encore écoulé
        const timeSinceLastGen = now - lockInfo.lastGenTime;
        if (timeSinceLastGen < COOLDOWN_MS) {
            const remainingSeconds = Math.ceil((COOLDOWN_MS - timeSinceLastGen) / 1000);
            log.warning(`⚠️ ${senderId} en cooldown (${remainingSeconds}s restant)`);
            return `⏰ Doucement ! Attends encore ${remainingSeconds} seconde${remainingSeconds > 1 ? 's' : ''} avant de générer une nouvelle image !
💕 Je dois recharger mes pinceaux magiques ! ✨`;
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
        
        return `🎨 OH OUI ! Je peux générer des images magnifiques ! ✨
🖼️ /image [ta description] - Je crée ton image de rêve !
🎨 /image chat robot mignon - Exemple adorable
🌸 /image paysage féerique coucher soleil - Exemple poétique
⚡ /image random - Une surprise image !
💕 Je suis super douée pour créer des images ! Décris-moi ton rêve et je le dessine pour toi !
🎭 Tous les styles : réaliste, cartoon, anime, artistique...
💡 Plus tu me donnes de détails, plus ton image sera parfaite !
❓ Besoin d'aide ? Tape /help pour voir toutes mes capacités ! 🌟`;
    }
    
    let prompt = args.trim();
    
    // Valider le prompt
    if (prompt.length < 3) {
        // Libérer le lock en cas d'erreur de validation
        userGenerationLocks.set(senderIdStr, {
            generating: false,
            lastGenTime: now
        });
        return "❌ Oh là là ! Ta description est un peu courte ! Donne-moi au moins 3 lettres pour que je puisse créer quelque chose de beau ! 💕";
    }
    
    if (prompt.length > 500) {
        // Libérer le lock en cas d'erreur de validation
        userGenerationLocks.set(senderIdStr, {
            generating: false,
            lastGenTime: now
        });
        return "❌ Oups ! Ta description est trop longue ! Maximum 500 caractères s'il te plaît ! 🌸";
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
            addToMemory(senderIdStr, 'assistant', `Image générée par AI Horde: ${prompt}`);
            
            // ✅ PROTECTION 3: Libérer le lock après succès
            userGenerationLocks.set(senderIdStr, {
                generating: false,
                lastGenTime: Date.now()
            });
            
            log.info(`💎 Image AI Horde générée avec succès pour ${senderId}`);
            
            return {
                type: "image",
                url: hordeResult.imageUrl,
                caption: `🎨 Tadaaa ! Image créée par AI Horde ! ✨

📝 "${prompt}"
🤖 Modèle: ${hordeResult.model || 'Stable Diffusion'}
⚡ Généré en ${hordeResult.waitTime || 'quelques'} secondes
🎯 Worker: ${hordeResult.workerName || 'Anonymous'}

💕 J'espère qu'elle te plaît ! Tape /image pour une nouvelle création ! 🌟`
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
                addToMemory(senderIdStr, 'assistant', `Image générée par Pollinations: ${prompt}`);
                
                // ✅ PROTECTION 4: Libérer le lock après succès fallback
                userGenerationLocks.set(senderIdStr, {
                    generating: false,
                    lastGenTime: Date.now()
                });
                
                log.info(`🌸 Image Pollinations générée avec succès pour ${senderId}`);
                
                return {
                    type: "image",
                    url: pollinationsResult.imageUrl,
                    caption: `🎨 Tadaaa ! Voici ton image créée avec amour ! ✨

📝 "${prompt}"
🔢 Seed magique: ${pollinationsResult.seed}
🤖 Générée par Pollinations AI

💕 J'espère qu'elle te plaît ! Tape /image pour une nouvelle création ! 🌟`
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
            
            return `🎨 Oh non ! Mes ateliers artistiques rencontrent une petite difficulté ! 😅
🔧 Mes outils de création sont temporairement indisponibles
⏰ Réessaie dans quelques secondes, la file d'attente est peut-être pleine !
🎲 Ou essaie /image random pour une surprise différente !
❓ Tape /help si tu as besoin d'aide ! 💖`;
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
            trusted_workers: false,
            slow_workers: true, // Accepter les workers plus lents
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
                        imageUrl: generation.img,
                        model: generation.model || 'Stable Diffusion',
                        workerName: generation.worker_name || 'Anonymous',
                        waitTime: waitTime
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
            imageUrl: imageUrl,
            seed: seed
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
    
    // Remplacer certains mots français par leurs équivalents anglais pour de meilleurs résultats
    const translations = {
        'chat': 'cat',
        'chien': 'dog',
        'paysage': 'landscape',
        'portrait': 'portrait',
        'maison': 'house',
        'voiture': 'car',
        'fleur': 'flower',
        'arbre': 'tree',
        'montagne': 'mountain',
        'mer': 'sea',
        'ciel': 'sky',
        'nuit': 'night',
        'jour': 'day',
        'soleil': 'sun',
        'lune': 'moon',
        'étoile': 'star',
        'forêt': 'forest',
        'ville': 'city',
        'personne': 'person',
        'femme': 'woman',
        'homme': 'man',
        'enfant': 'child',
        'bébé': 'baby'
    };
    
    for (const [french, english] of Object.entries(translations)) {
        const regex = new RegExp(`\\b${french}\\b`, 'gi');
        optimized = optimized.replace(regex, english);
    }
    
    return optimized;
}
