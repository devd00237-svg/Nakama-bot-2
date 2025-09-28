// Cmds/chatanywhere.js - Commande ChatAnywhere pour NakamaBot
// Créée par Durand - Compatible avec NakamaBot v4.0

const axios = require('axios');

// Configuration
const CHATANYWHERE_API_KEY ="sk-inwU3k9uYuOsxdjrz6QDFSJZ8H9wykCZUuRqWOUOiDXYUMlA";
const maxTokens = 1000;
const maxStorageMessage = 6;
const defaultModel = "gpt-4o-ca"; // Modèle par défaut depuis la liste fournie

// Stockage temporaire des utilisations (sera persisté via le système GitHub du bot)
let chatAnywhereUsing = new Map();
let chatAnywhereHistory = new Map();

module.exports = async function(senderId, args, context) {
    const {
        log,
        sendMessage,
        addToMemory,
        saveDataImmediate,
        commandData
    } = context;

    const senderIdStr = String(senderId);

    // Vérifier la clé API
    if (!CHATANYWHERE_API_KEY) {
        log.error("❌ CHATANYWHERE_API_KEY manquante pour la commande chatanywhere");
        return "🔑 Oups ! La clé ChatAnywhere n'est pas configurée ! Contacte un admin ! 💕";
    }

    // Charger les données depuis le contexte persistant
    if (commandData.has('chatAnywhereUsing')) {
        chatAnywhereUsing = new Map(commandData.get('chatAnywhereUsing'));
    }
    if (commandData.has('chatAnywhereHistory')) {
        chatAnywhereHistory = new Map(commandData.get('chatAnywhereHistory'));
    }

    // Fonction pour sauvegarder les données
    const saveChatAnywhereData = () => {
        commandData.set('chatAnywhereUsing', Array.from(chatAnywhereUsing.entries()));
        commandData.set('chatAnywhereHistory', Array.from(chatAnywhereHistory.entries()));
        saveDataImmediate();
    };

    // Parser les arguments
    const argsList = args.trim().split(' ');
    const command = argsList[0]?.toLowerCase() || '';
    const content = argsList.slice(1).join(' ');

    try {
        switch (command) {
            case 'models':
            case 'modeles': {
                if (chatAnywhereUsing.has(senderIdStr)) {
                    return "⏰ Tu utilises déjà ChatAnywhere ! Attends que ta demande précédente se termine ! 💕";
                }

                chatAnywhereUsing.set(senderIdStr, true);
                saveChatAnywhereData();

                try {
                    log.info(`📋 Liste des modèles ChatAnywhere pour ${senderId}`);

                    const response = await axios({
                        url: "https://api.chatanywhere.tech/v1/models",
                        method: "GET",
                        headers: {
                            "Authorization": `Bearer ${CHATANYWHERE_API_KEY}`
                        },
                        timeout: 15000
                    });

                    const models = response.data.data;
                    
                    if (models && models.length > 0) {
                        let modelsList = "🤖 **Modèles disponibles sur ChatAnywhere :**\n\n";
                        
                        models.forEach((model, index) => {
                            const modelName = model.id;
                            const owner = model.owned_by;
                            modelsList += `${index + 1}. **${modelName}** (${owner})\n`;
                        });
                        
                        modelsList += `\n💡 Utilise: \`/chatanywhere model [nom_modele] [message]\` pour chatter avec un modèle spécifique !\n`;
                        modelsList += `🎯 Modèle par défaut: **${defaultModel}**`;
                        
                        log.info(`✅ Liste des modèles ChatAnywhere envoyée à ${senderId}`);
                        return modelsList;
                    } else {
                        return "😅 Aucun modèle trouvé ! Contacte un admin ! 💕";
                    }

                } catch (error) {
                    log.error(`❌ Erreur liste modèles ChatAnywhere: ${error.message}`);
                    
                    let errorMessage = "💥 Oh non ! Erreur lors de la récupération des modèles ! ";
                    
                    if (error.response?.data?.error?.message) {
                        errorMessage += `Erreur API: ${error.response.data.error.message}`;
                    } else {
                        errorMessage += "Réessaie dans quelques minutes ! 💕";
                    }
                    
                    return errorMessage;
                } finally {
                    chatAnywhereUsing.delete(senderIdStr);
                    saveChatAnywhereData();
                }
            }

            case 'model':
            case 'modele': {
                // Chat avec un modèle spécifique: /chatanywhere model gpt-5-ca Bonjour !
                const modelArgs = content.split(' ');
                const selectedModel = modelArgs[0];
                const message = modelArgs.slice(1).join(' ');

                if (!selectedModel || !message) {
                    return "🤖 Spécifie un modèle et ton message ! Exemple: `/chatanywhere model gpt-5-ca Bonjour !` 💕\n\n📋 Tape `/chatanywhere models` pour voir la liste !";
                }

                if (chatAnywhereUsing.has(senderIdStr)) {
                    return "⏰ Tu utilises déjà ChatAnywhere ! Attends que ta demande précédente se termine ! 💕";
                }

                chatAnywhereUsing.set(senderIdStr, true);
                saveChatAnywhereData();

                try {
                    log.info(`💬 Chat ChatAnywhere avec ${selectedModel} pour ${senderId}: ${message.substring(0, 50)}...`);

                    // Récupérer l'historique spécifique au modèle
                    const historyKey = `${senderIdStr}_${selectedModel}`;
                    let history = chatAnywhereHistory.get(historyKey) || [];
                    
                    // Limiter l'historique
                    if (history.length >= maxStorageMessage * 2) {
                        history = history.slice(-maxStorageMessage * 2);
                    }

                    // Ajouter le message utilisateur
                    history.push({
                        role: 'user',
                        content: message
                    });

                    const response = await axios({
                        url: "https://api.chatanywhere.tech/v1/chat/completions",
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${CHATANYWHERE_API_KEY}`,
                            "Content-Type": "application/json"
                        },
                        data: {
                            model: selectedModel,
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
                        timeout: 45000
                    });

                    const aiResponse = response.data.choices[0].message.content;

                    // Sauvegarder la réponse dans l'historique du modèle
                    history.push({
                        role: 'assistant',
                        content: aiResponse
                    });

                    chatAnywhereHistory.set(historyKey, history);
                    saveChatAnywhereData();

                    // Ajouter à la mémoire du bot
                    addToMemory(senderId, 'user', `[${selectedModel}] ${message}`);
                    addToMemory(senderId, 'assistant', `[${selectedModel}] ${aiResponse}`);

                    log.info(`✅ Réponse ChatAnywhere (${selectedModel}) envoyée à ${senderId}`);
                    
                    return `🤖 **${selectedModel}** répond :\n\n${aiResponse}`;

                } catch (error) {
                    log.error(`❌ Erreur chat ChatAnywhere avec ${selectedModel}: ${error.message}`);
                    
                    let errorMessage = `💥 Oh non ! Erreur avec le modèle **${selectedModel}** ! `;
                    
                    if (error.response?.data?.error?.message) {
                        const apiError = error.response.data.error.message;
                        if (apiError.includes("model")) {
                            errorMessage += "Modèle non trouvé ! Vérifie le nom ! 🔍";
                        } else if (apiError.includes("billing")) {
                            errorMessage += "Problème de facturation ! 💳";
                        } else if (apiError.includes("rate limit")) {
                            errorMessage += "Trop de demandes ! Réessaie dans quelques minutes ! ⏰";
                        } else {
                            errorMessage += `Erreur API: ${apiError}`;
                        }
                    } else {
                        errorMessage += "Réessaie avec un autre modèle ! 💕";
                    }
                    
                    return errorMessage;
                } finally {
                    chatAnywhereUsing.delete(senderIdStr);
                    saveChatAnywhereData();
                }
            }

            case 'clear': {
                // Effacer l'historique de tous les modèles pour cet utilisateur
                const keysToDelete = [];
                for (let key of chatAnywhereHistory.keys()) {
                    if (key.startsWith(senderIdStr + '_')) {
                        keysToDelete.push(key);
                    }
                }
                
                keysToDelete.forEach(key => {
                    chatAnywhereHistory.delete(key);
                });
                
                saveChatAnywhereData();
                log.info(`🗑️ Historique ChatAnywhere effacé pour ${senderId}`);
                return "🧹 Ton historique de chat ChatAnywhere a été effacé pour tous les modèles avec tendresse ! ✨💕";
            }

            default: {
                // Chat avec le modèle par défaut
                if (!args.trim()) {
                    return `💬 Dis-moi quelque chose pour qu'on puisse chatter ! Ou utilise:\n\n🤖 \`/chatanywhere model [nom] [message]\` - pour chatter avec un modèle spécifique\n📋 \`/chatanywhere models\` - pour voir tous les modèles\n🧹 \`/chatanywhere clear\` - pour effacer l'historique\n💬 \`/chatanywhere [message]\` - pour chatter avec **${defaultModel}** ! 💕`;
                }

                if (chatAnywhereUsing.has(senderIdStr)) {
                    return "⏰ Tu utilises déjà ChatAnywhere ! Attends que ta demande précédente se termine ! 💕";
                }

                chatAnywhereUsing.set(senderIdStr, true);
                saveChatAnywhereData();

                try {
                    // Récupérer l'historique du modèle par défaut
                    const historyKey = `${senderIdStr}_${defaultModel}`;
                    let history = chatAnywhereHistory.get(historyKey) || [];
                    
                    // Limiter l'historique
                    if (history.length >= maxStorageMessage * 2) {
                        history = history.slice(-maxStorageMessage * 2);
                    }

                    // Ajouter le message utilisateur
                    history.push({
                        role: 'user',
                        content: args.trim()
                    });

                    log.info(`💬 Chat ChatAnywhere (défaut: ${defaultModel}) pour ${senderId}: ${args.substring(0, 50)}...`);

                    const response = await axios({
                        url: "https://api.chatanywhere.tech/v1/chat/completions",
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${CHATANYWHERE_API_KEY}`,
                            "Content-Type": "application/json"
                        },
                        data: {
                            model: defaultModel,
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
                        timeout: 45000
                    });

                    const aiResponse = response.data.choices[0].message.content;

                    // Sauvegarder la réponse dans l'historique
                    history.push({
                        role: 'assistant',
                        content: aiResponse
                    });

                    chatAnywhereHistory.set(historyKey, history);
                    saveChatAnywhereData();

                    // Ajouter à la mémoire du bot
                    addToMemory(senderId, 'user', args.trim());
                    addToMemory(senderId, 'assistant', aiResponse);

                    log.info(`✅ Réponse ChatAnywhere (défaut) envoyée à ${senderId}`);
                    
                    return aiResponse;

                } catch (error) {
                    log.error(`❌ Erreur chat ChatAnywhere: ${error.message}`);
                    
                    let errorMessage = "💥 Oh non ! Petite erreur de chat ! ";
                    
                    if (error.response?.data?.error?.message) {
                        const apiError = error.response.data.error.message;
                        if (apiError.includes("billing")) {
                            errorMessage += "Problème de facturation ! 💳";
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
                    chatAnywhereUsing.delete(senderIdStr);
                    saveChatAnywhereData();
                }
            }
        }

    } catch (error) {
        log.error(`❌ Erreur générale commande chatanywhere: ${error.message}`);
        chatAnywhereUsing.delete(senderIdStr);
        saveChatAnywhereData();
        return "💥 Oh là là ! Une petite erreur s'est glissée ! Réessaie ou tape /help ! 💕";
    }
};
