/**
 * Commande /image - Génération d'images IA avec Gemini (Pollinations en fallback)
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Description de l'image à générer
 * @param {object} ctx - Contexte partagé du bot
 */
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Configuration Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

module.exports = async function cmdImage(senderId, args, ctx) {
    const { addToMemory, getRandomInt, log } = ctx;
    
    if (!args.trim()) {
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
    const senderIdStr = String(senderId);
    
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
    
    // Valider le prompt
    if (prompt.length < 3) {
        return "❌ Oh là là ! Ta description est un peu courte ! Donne-moi au moins 3 lettres pour que je puisse créer quelque chose de beau ! 💕";
    }
    
    if (prompt.length > 200) {
        return "❌ Oups ! Ta description est trop longue ! Maximum 200 caractères s'il te plaît ! 🌸";
    }
    
    // Optimiser le prompt pour de meilleurs résultats
    const optimizedPrompt = optimizePromptForImageGeneration(prompt);
    
    try {
        // ✅ PRIORITÉ: Essayer d'abord avec Gemini 2.0 Flash Image Generation
        log.info(`🎨 Tentative génération Gemini pour ${senderId}: ${prompt}`);
        
        const imageResult = await generateWithGemini(optimizedPrompt, log);
        
        if (imageResult && imageResult.success) {
            // Sauvegarder dans la mémoire
            addToMemory(senderIdStr, 'user', `Image demandée: ${prompt}`);
            addToMemory(senderIdStr, 'assistant', `Image générée par Gemini: ${prompt}`);
            
            log.info(`💎 Image Gemini générée avec succès pour ${senderId}`);
            
            return {
                type: "image",
                url: imageResult.imageUrl,
                caption: `🎨 Tadaaa ! Image créée par Gemini AI ! ✨

📝 "${prompt}"
🤖 Générée par..
🎯 Style: ${imageResult.style || 'Auto-détecté'}

💕 J'espère qu'elle te plaît ! Tape /image pour une nouvelle création ! 🌟`
            };
        }
        
        throw new Error('Gemini image generation failed');
        
    } catch (geminiError) {
        log.warning(`⚠️ Gemini image échec pour ${senderId}: ${geminiError.message}`);
        
        try {
            // ✅ FALLBACK: Utiliser Pollinations si Gemini échoue
            log.info(`🔄 Fallback Pollinations pour ${senderId}`);
            
            const pollinationsResult = await generateWithPollinations(optimizedPrompt, getRandomInt);
            
            if (pollinationsResult && pollinationsResult.success) {
                // Sauvegarder dans la mémoire
                addToMemory(senderIdStr, 'user', `Image demandée: ${prompt}`);
                addToMemory(senderIdStr, 'assistant', `Image générée par Pollinations: ${prompt}`);
                
                log.info(`🌸 Image Pollinations générée avec succès pour ${senderId}`);
                
                return {
                    type: "image",
                    url: pollinationsResult.imageUrl,
                    caption: `🎨 Tadaaa ! Voici ton image créée avec amour ! ✨

📝 "${prompt}"
🔢 Seed magique: ${pollinationsResult.seed}
🤖 Générée.

💕 J'espère qu'elle te plaît ! Tape /image pour une nouvelle création ! 🌟`
                };
            }
            
            throw new Error('Pollinations generation also failed');
            
        } catch (pollinationsError) {
            log.error(`❌ Erreur totale génération image ${senderId}: Gemini(${geminiError.message}) + Pollinations(${pollinationsError.message})`);
            
            return `🎨 Oh non ! Mes ateliers artistiques rencontrent une petite difficulté ! 😅
🔧 Ni mon pinceau Gemini ni mon crayon Pollinations ne fonctionnent pour le moment
⏰ Réessaie dans quelques secondes, mes outils magiques vont revenir !
🎲 Ou essaie /image random pour une surprise différente !
❓ Tape /help si tu as besoin d'aide ! 💖`;
        }
    }
};

// ✅ Génération avec Gemini 2.0 Flash Image Generation
async function generateWithGemini(prompt, log) {
    try {
        // Configuration spéciale pour la génération d'images
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash-preview-image-generation"
        });
        
        // Prompt optimisé pour la génération d'images
        const imagePrompt = `Generate an image: ${prompt}`;
        
        // Utiliser la méthode spécifique pour les images
        const result = await model.generateContent({
            contents: [
                {
                    role: "user",
                    parts: [
                        {
                            text: imagePrompt
                        }
                    ]
                }
            ],
            generationConfig: {
                maxOutputTokens: 1024,
                temperature: 0.7,
                topP: 0.8,
                topK: 40
            }
        });
        
        // Traitement de la réponse image
        const response = await result.response;
        
        // Méthode 1: Vérifier les candidates
        if (response.candidates && response.candidates.length > 0) {
            const candidate = response.candidates[0];
            
            if (candidate.content && candidate.content.parts) {
                for (const part of candidate.content.parts) {
                    // Chercher les données inline
                    if (part.inlineData && part.inlineData.data) {
                        const mimeType = part.inlineData.mimeType || 'image/png';
                        const base64Data = part.inlineData.data;
                        const imageUrl = `data:${mimeType};base64,${base64Data}`;
                        
                        log.info(`✅ Image Gemini générée avec succès (inline data)`);
                        return {
                            success: true,
                            imageUrl: imageUrl,
                            style: 'Gemini AI Generated'
                        };
                    }
                    
                    // Chercher les blobs de données
                    if (part.fileData && part.fileData.fileUri) {
                        log.info(`✅ Image Gemini générée avec succès (file URI)`);
                        return {
                            success: true,
                            imageUrl: part.fileData.fileUri,
                            style: 'Gemini AI Generated'
                        };
                    }
                }
            }
        }
        
        // Méthode 2: Vérifier directement dans la réponse
        if (response.data) {
            const imageUrl = `data:image/png;base64,${response.data}`;
            log.info(`✅ Image Gemini générée avec succès (response data)`);
            return {
                success: true,
                imageUrl: imageUrl,
                style: 'Gemini AI Generated'
            };
        }
        
        // Si aucune image n'est trouvée
        log.warning(`⚠️ Aucune donnée image trouvée dans la réponse Gemini`);
        throw new Error('No image data found in Gemini response');
        
    } catch (error) {
        // Log détaillé pour debugging
        if (error.message.includes('response modalities')) {
            log.error(`❌ Erreur modalité Gemini: Le modèle ne supporte pas cette configuration`);
        } else if (error.message.includes('400')) {
            log.error(`❌ Erreur requête Gemini (400): ${error.message}`);
        } else {
            log.error(`❌ Erreur générale Gemini image: ${error.message}`);
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
    const qualityKeywords = ['high quality', 'detailed', 'beautiful', 'artistic'];
    const hasQualityKeyword = qualityKeywords.some(keyword => 
        optimized.toLowerCase().includes(keyword)
    );
    
    if (!hasQualityKeyword && optimized.length < 150) {
        optimized += ', high quality, detailed, beautiful';
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
        'arbre': 'tree'
    };
    
    for (const [french, english] of Object.entries(translations)) {
        const regex = new RegExp(`\\b${french}\\b`, 'gi');
        optimized = optimized.replace(regex, english);
    }
    
    return optimized;
}
