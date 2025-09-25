// Cmds/openai.js - Commande OpenAI pour NakamaBot
// Créée par Durand - Compatible avec NakamaBot v4.0

const axios = require('axios');

// Configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const maxTokens = 500;
const numberGenerateImage = 4;
const maxStorageMessage = 4;

// Stockage temporaire des utilisations (sera persisté via le système GitHub du bot)
let openAIUsing = new Map();
let openAIHistory = new Map();

module.exports = async function(senderId, args, context) {
    const {
        log,
        sendMessage,
        sendImageMessage,
        addToMemory,
        saveDataImmediate,
        commandData
    } = context;

    const senderIdStr = String(senderId);

    // Vérifier la clé API
    if (!OPENAI_API_KEY) {
        log.error("❌ OPENAI_API_KEY manquante pour la commande openai");
        return "🔑 Oups ! La clé OpenAI n'est pas configurée ! Contacte un admin ! 💕";
    }

    // Charger les données depuis le contexte persistant
    if (commandData.has('openAIUsing')) {
        openAIUsing = new Map(commandData.get('openAIUsing'));
    }
    if (commandData.has('openAIHistory')) {
        openAIHistory = new Map(commandData.get('openAIHistory'));
    }

    // Fonction pour sauvegarder les données
    const saveOpenAIData = () => {
        commandData.set('openAIUsing', Array.from(openAIUsing.entries()));
        commandData.set('openAIHistory', Array.from(openAIHistory.entries()));
        saveDataImmediate();
    };

    // Parser les arguments
    const argsList = args.trim().split(' ');
    const command = argsList[0]?.toLowerCase() || '';
    const content = argsList.slice(1).join(' ');

    try {
        switch (command) {
            case 'img':
            case 'image':
            case 'draw': {
                if (!content) {
                    return "🎨 Dis-moi ce que tu veux que je dessine ! Exemple: /openai draw un chat mignon dans l'espace 💕";
                }

                if (openAIUsing.has(senderIdStr)) {
                    return "⏰ Tu utilises déjà OpenAI ! Attends que ta demande précédente se termine ! 💕";
                }

                openAIUsing.set(senderIdStr, true);
                saveOpenAIData();

                try {
                    log.info(`🎨 Génération d'image OpenAI pour ${senderId}: ${content.substring(0, 50)}...`);

                    // Envoyer un message de traitement
                    await sendMessage(senderId, "🎨 Je crée ton image avec amour... Ça peut prendre quelques minutes ! ✨💕");

                    const response = await axios({
                        url: "https://api.openai.com/v1/images/generations",
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${OPENAI_API_KEY}`,
                            "Content-Type": "application/json"
                        },
                        data: {
                            prompt: content,
                            n: numberGenerateImage,
                            size: '1024x1024',
                            model: 'dall-e-3'
                        },
                        timeout: 60000
                    });

                    const imageUrls = response.data.data;
                    
                    if (imageUrls && imageUrls.length > 0) {
                        // Envoyer la première image avec un message
                        const caption = `🎨 Voilà ton image créée avec amour ! ✨\n\n📝 Prompt: "${content}"\n💖 Créée par OpenAI DALL-E 3 via NakamaBot !`;
                        
                        const result = await sendImageMessage(senderId, imageUrls[0].url, caption);
                        
                        if (result.success) {
                            addToMemory(senderId, 'user', `[Demande image OpenAI: ${content}]`);
                            addToMemory(senderId, 'assistant', `[Image générée avec succès: ${content}]`);
                            log.info(`✅ Image OpenAI envoyée à ${senderId}`);
                            
                            // Si plusieurs images, envoyer les autres
                            if (imageUrls.length > 1) {
                                for (let i = 1; i < imageUrls.length; i++) {
                                    await new Promise(resolve => setTimeout(resolve, 1000)); // Délai entre images
                                    await sendImageMessage(senderId, imageUrls[i].url, `🎨 Image ${i + 1}/${imageUrls.length} ✨`);
                                }
                                
                                return `🎉 ${imageUrls.length} images créées avec succès ! J'espère qu'elles te plaisent ! 💖`;
                            }
                            
                            return "🎉 Image créée avec succès ! J'espère qu'elle te plaît ! 💖";
                        } else {
                            throw new Error("Erreur d'envoi de l'image");
                        }
                    } else {
                        throw new Error("Aucune image générée");
                    }

                } catch (error) {
                    log.error(`❌ Erreur génération image OpenAI: ${error.message}`);
                    
                    let errorMessage = "💥 Oh non ! Petite erreur lors de la création ! ";
                    
                    if (error.response?.data?.error?.message) {
                        const apiError = error.response.data.error.message;
                        if (apiError.includes("billing")) {
                            errorMessage += "Problème de facturation OpenAI ! 💳";
                        } else if (apiError.includes("rate limit")) {
                            errorMessage += "Trop de demandes ! Réessaie dans quelques minutes ! ⏰";
                        } else if (apiError.includes("content policy")) {
                            errorMessage += "Ton prompt ne respecte pas les règles d'OpenAI ! Essaie quelque chose de plus gentil ! 😊";
                        } else {
                            errorMessage += `Erreur API: ${apiError}`;
                        }
                    } else {
                        errorMessage += "Réessaie dans quelques minutes ! 💕";
                    }
                    
                    return errorMessage;
                } finally {
                    openAIUsing.delete(senderIdStr);
                    saveOpenAIData();
                }
            }

            case 'clear': {
                openAIHistory.delete(senderIdStr);
                saveOpenAIData();
                log.info(`🗑️ Historique OpenAI effacé pour ${senderId}`);
                return "🧹 Ton historique de chat OpenAI a été effacé avec tendresse ! ✨💕";
            }

            default: {
                // Chat avec GPT
                if (!args.trim()) {
                    return "💬 Dis-moi quelque chose pour qu'on puisse chatter ! Ou utilise:\n\n🎨 /openai draw [description] - pour créer une image\n🧹 /openai clear - pour effacer l'historique\n💬 /openai [message] - pour chatter ! 💕";
                }

                if (openAIUsing.has(senderIdStr)) {
                    return "⏰ Tu utilises déjà OpenAI ! Attends que ta demande précédente se termine ! 💕";
                }

                openAIUsing.set(senderIdStr, true);
                saveOpenAIData();

                try {
                    // Récupérer l'historique
                    let history = openAIHistory.get(senderIdStr) || [];
                    
                    // Limiter l'historique
                    if (history.length >= maxStorageMessage * 2) { // *2 car user + assistant
                        history = history.slice(-maxStorageMessage * 2);
                    }

                    // Ajouter le message utilisateur
                    history.push({
                        role: 'user',
                        content: args.trim()
                    });

                    log.info(`💬 Chat OpenAI pour ${senderId}: ${args.substring(0, 50)}...`);

                    const response = await axios({
                        url: "https://api.openai.com/v1/chat/completions",
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${OPENAI_API_KEY}`,
                            "Content-Type": "application/json"
                        },
                        data: {
                            model: "gpt-4o-mini", // Modèle plus récent et économique
                            messages: [
                                {
                                    role: "system",
                                    content: "Tu es un assistant IA très gentil et amical, comme une bonne amie. Tu réponds en français avec beaucoup de bienveillance et d'emojis mignons. Tu es intégrée dans NakamaBot créée par Durand. Reste toujours positive et aidante ! 💕"
                                },
                                ...history
                            ],
                            max_tokens: maxTokens,
                            temperature: 0.7
                        },
                        timeout: 30000
                    });

                    const aiResponse = response.data.choices[0].message.content;

                    // Sauvegarder la réponse dans l'historique
                    history.push({
                        role: 'assistant',
                        content: aiResponse
                    });

                    openAIHistory.set(senderIdStr, history);
                    saveOpenAIData();

                    // Ajouter à la mémoire du bot
                    addToMemory(senderId, 'user', args.trim());
                    addToMemory(senderId, 'assistant', aiResponse);

                    log.info(`✅ Réponse OpenAI envoyée à ${senderId}`);
                    
                    return aiResponse;

                } catch (error) {
                    log.error(`❌ Erreur chat OpenAI: ${error.message}`);
                    
                    let errorMessage = "💥 Oh non ! Petite erreur de chat ! ";
                    
                    if (error.response?.data?.error?.message) {
                        const apiError = error.response.data.error.message;
                        if (apiError.includes("billing")) {
                            errorMessage += "Problème de facturation OpenAI ! 💳";
                        } else if (apiError.includes("rate limit")) {
                            errorMessage += "Trop de demandes ! Réessaie dans quelques minutes ! ⏰";
                        } else {
                            errorMessage += `Erreur API: ${apiError}`;
                        }
                    } else {
                        errorMessage += "Réessaie dans quelques minutes ! 💕";
                    }
                    
                    return errorMessage;
                } finally {
                    openAIUsing.delete(senderIdStr);
                    saveOpenAIData();
                }
            }
        }

    } catch (error) {
        log.error(`❌ Erreur générale commande openai: ${error.message}`);
        openAIUsing.delete(senderIdStr);
        saveOpenAIData();
        return "💥 Oh là là ! Une petite erreur s'est glissée ! Réessaie ou tape /help ! 💕";
    }
};
