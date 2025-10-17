/**
 * Commande /image - Génération d'images IA
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Description de l'image à générer
 * @param {object} ctx - Contexte partagé du bot
 */
const axios = require("axios");

// Configuration
const AI_HORDE_API_URL = "https://stablehorde.net/api/v2";
const AI_HORDE_API_KEY = process.env.AI_HORDE_API_KEY || "MyCjl90bq7fwEaxobqSPHg";

// Protection anti-spam
const userGenerationLocks = new Map();
const COOLDOWN_MS = 5000;

module.exports = async function cmdImage(senderId, args, ctx) {
    const { addToMemory, getRandomInt, log } = ctx;
    
    const senderIdStr = String(senderId);
    const now = Date.now();
    
    if (userGenerationLocks.has(senderIdStr)) {
        const lockInfo = userGenerationLocks.get(senderIdStr);
        
        if (lockInfo.generating) {
            log.warning(`⚠️ ${senderId} génération en cours`);
            return `⏳ J'ai déjà une création en cours pour toi ! Attends quelques instants... 💕`;
        }
        
        const timeSinceLastGen = now - lockInfo.lastGenTime;
        if (timeSinceLastGen < COOLDOWN_MS) {
            const remainingSeconds = Math.ceil((COOLDOWN_MS - timeSinceLastGen) / 1000);
            log.warning(`⚠️ ${senderId} cooldown (${remainingSeconds}s)`);
            return `⏰ Attends encore ${remainingSeconds} seconde${remainingSeconds > 1 ? 's' : ''} avant une nouvelle création ! 💕`;
        }
    }
    
    userGenerationLocks.set(senderIdStr, {
        generating: true,
        lastGenTime: now
    });
    
    if (!args.trim()) {
        userGenerationLocks.set(senderIdStr, {
            generating: false,
            lastGenTime: now
        });
        
        return `🎨 Je crée des images à partir de tes descriptions ! ✨
🖼️ /image [ta description] - Ex: chat mignon dans un jardin
🌸 /image paysage féerique au coucher du soleil
⚡ /image random - Une surprise !
💡 Plus tu donnes de détails, meilleur sera le résultat !`;
    }
    
    let prompt = args.trim();
    
    if (prompt.length < 3) {
        userGenerationLocks.set(senderIdStr, {
            generating: false,
            lastGenTime: now
        });
        return "❌ Ta description est trop courte ! Donne-moi au moins 3 lettres ! 💕";
    }
    
    if (prompt.length > 500) {
        userGenerationLocks.set(senderIdStr, {
            generating: false,
            lastGenTime: now
        });
        return "❌ Ta description est trop longue ! Maximum 500 caractères ! 🌸";
    }
    
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
    
    const optimizedPrompt = optimizePromptForImageGeneration(prompt);
    
    try {
        log.info(`🎨 Génération image pour ${senderId}: ${prompt}`);
        
        const pollinationsResult = await generateWithPollinations(optimizedPrompt, getRandomInt);
        
        if (pollinationsResult && pollinationsResult.success) {
            addToMemory(senderIdStr, 'user', `Image demandée: ${prompt}`);
            addToMemory(senderIdStr, 'assistant', `Image créée: ${prompt}`);
            
            userGenerationLocks.set(senderIdStr, {
                generating: false,
                lastGenTime: Date.now()
            });
            
            log.info(`✅ Image générée avec succès pour ${senderId}`);
            
            return {
                type: "image",
                url: pollinationsResult.imageUrl,
                caption: `🎨 Voici ton image ! ✨

📝 "${prompt}"

💕 Tape /image pour créer une nouvelle œuvre !`
            };
        }
        
        throw new Error('Génération impossible');
        
    } catch (primaryError) {
        log.warning(`⚠️ Tentative alternative pour ${senderId}`);
        
        try {
            const hordeResult = await generateWithAIHorde(optimizedPrompt, log);
            
            if (hordeResult && hordeResult.success) {
                addToMemory(senderIdStr, 'user', `Image demandée: ${prompt}`);
                addToMemory(senderIdStr, 'assistant', `Image créée: ${prompt}`);
                
                userGenerationLocks.set(senderIdStr, {
                    generating: false,
                    lastGenTime: Date.now()
                });
                
                log.info(`✅ Image alternative générée pour ${senderId}`);
                
                return {
                    type: "image",
                    url: hordeResult.imageUrl,
                    caption: `🎨 Voici ton image ! ✨

📝 "${prompt}"

💕 Tape /image pour créer une nouvelle œuvre !`
                };
            }
            
            throw new Error('Toutes les méthodes ont échoué');
            
        } catch (fallbackError) {
            log.error(`❌ Erreur totale génération ${senderId}`);
            
            userGenerationLocks.set(senderIdStr, {
                generating: false,
                lastGenTime: Date.now()
            });
            
            return `😢 Mes outils de création sont temporairement indisponibles !
⏰ Réessaie dans quelques secondes !
🎲 Ou essaie /image random pour une surprise ! 💕`;
        }
    }
};

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function generateWithPollinations(prompt, getRandomInt) {
    try {
        const encodedPrompt = encodeURIComponent(prompt);
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

async function generateWithAIHorde(prompt, log) {
    try {
        const startTime = Date.now();
        
        const generatePayload = {
            prompt: prompt,
            params: {
                n: 1,
                width: 512,
                height: 512,
                steps: 30,
                cfg_scale: 7.5,
                sampler_name: "k_euler_a",
                seed: Math.floor(Math.random() * 4294967295).toString(),
                karras: true,
                denoising_strength: 0.75,
                post_processing: ["RealESRGAN_x4plus"]
            },
            nsfw: false,
            trusted_workers: false,
            slow_workers: true,
            censor_nsfw: true,
            models: ["Deliberate", "Dreamshaper", "stable_diffusion"]
        };
        
        const generateResponse = await axios.post(
            `${AI_HORDE_API_URL}/generate/async`,
            generatePayload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': AI_HORDE_API_KEY
                },
                timeout: 10000
            }
        );
        
        const requestId = generateResponse.data.id;
        
        let attempts = 0;
        const maxAttempts = 60;
        
        while (attempts < maxAttempts) {
            await sleep(2000);
            
            const checkResponse = await axios.get(
                `${AI_HORDE_API_URL}/generate/check/${requestId}`,
                {
                    headers: { 'apikey': AI_HORDE_API_KEY },
                    timeout: 5000
                }
            );
            
            const status = checkResponse.data;
            
            if (status.done) {
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
                    
                    return {
                        success: true,
                        imageUrl: generation.img,
                        model: generation.model || 'Stable Diffusion',
                        workerName: generation.worker_name || 'Anonymous',
                        waitTime: waitTime
                    };
                }
            }
            
            attempts++;
        }
        
        throw new Error('Timeout: Image generation took too long');
        
    } catch (error) {
        return { success: false, error: error.message };
    }
}

function optimizePromptForImageGeneration(prompt) {
    let optimized = prompt.trim();
    
    const qualityKeywords = ['high quality', 'detailed', 'beautiful', 'artistic', 'masterpiece'];
    const hasQualityKeyword = qualityKeywords.some(keyword => 
        optimized.toLowerCase().includes(keyword)
    );
    
    if (!hasQualityKeyword && optimized.length < 150) {
        optimized += ', high quality, detailed, masterpiece';
    }
    
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
