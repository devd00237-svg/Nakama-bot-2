// Cmds/contact.js
// Commande pour contacter les admins (2 messages max/jour) et répondre aux utilisateurs

// Structure pour stocker les données de contact
let contactData = {
    userMessages: new Map(), // userId -> { count: number, lastReset: date, messages: [] }
    adminReplies: new Map(), // messageId -> { adminId, reply, timestamp }
    messageCounter: 0
};

module.exports = async function(senderId, args, context) {
    const {
        isAdmin,
        userList,
        sendMessage,
        addToMemory,
        saveDataImmediate,
        log,
        ADMIN_IDS
    } = context;

    const senderIdStr = String(senderId);
    const today = new Date().toDateString();

    try {
        // Si c'est un admin, traiter les commandes admin
        if (isAdmin(senderId)) {
            return await handleAdminCommands(senderId, args, context);
        }

        // === GESTION UTILISATEUR NORMAL ===

        // Vérifier si l'utilisateur a fourni un message
        if (!args || args.trim().length === 0) {
            const userData = contactData.userMessages.get(senderIdStr) || { count: 0, lastReset: today, messages: [] };
            const remainingMessages = 2 - (userData.lastReset === today ? userData.count : 0);
            
            const response = `📞 **Contacter les Admins**\n\n💌 **Usage:** \`/contact [votre message]\`\n\n📝 **Exemple:**\n\`/contact J'ai un problème avec la commande /rank\`\n\n📊 **Limite:** 2 messages par jour\n📈 **Restants aujourd'hui:** ${remainingMessages}\n\n💡 **Conseil:** Soyez précis pour une meilleure aide !`;
            
            addToMemory(senderId, 'user', '/contact');
            addToMemory(senderId, 'assistant', response);
            return response;
        }

        // Vérifier la limite quotidienne
        const userData = contactData.userMessages.get(senderIdStr) || { count: 0, lastReset: today, messages: [] };
        
        // Réinitialiser le compteur si c'est un nouveau jour
        if (userData.lastReset !== today) {
            userData.count = 0;
            userData.lastReset = today;
            userData.messages = [];
        }

        if (userData.count >= 2) {
            const response = `⏰ **Limite atteinte !**\n\n📊 Tu as déjà envoyé 2 messages aux admins aujourd'hui.\n🕐 **Réinitialisation:** Minuit\n\n💡 **En attendant:** Tape /help pour les questions courantes !`;
            
            addToMemory(senderId, 'user', `/contact ${args}`);
            addToMemory(senderId, 'assistant', response);
            return response;
        }

        const userMessage = args.trim();
        
        // Vérifier la longueur du message
        if (userMessage.length > 500) {
            const response = `📝 **Message trop long !**\n\n📏 **Longueur actuelle:** ${userMessage.length} caractères\n📏 **Maximum autorisé:** 500 caractères\n📏 **À supprimer:** ${userMessage.length - 500} caractères\n\n💡 Soyez plus concis s'il vous plaît !`;
            
            addToMemory(senderId, 'user', `/contact ${args}`);
            addToMemory(senderId, 'assistant', response);
            return response;
        }

        // Créer un ID unique pour ce message
        contactData.messageCounter++;
        const messageId = `msg_${contactData.messageCounter}_${Date.now()}`;

        // Enregistrer le message de l'utilisateur
        const newMessage = {
            id: messageId,
            userId: senderId,
            message: userMessage,
            timestamp: new Date().toISOString(),
            replied: false
        };

        userData.count++;
        userData.messages.push(newMessage);
        contactData.userMessages.set(senderIdStr, userData);

        // Préparer le message pour les admins
        const adminMessage = `📞 **Nouveau message utilisateur**\n\n👤 **De:** ${senderId}\n🆔 **Message ID:** ${messageId}\n📅 **Date:** ${new Date().toLocaleString('fr-FR')}\n\n💬 **Message:**\n"${userMessage}"\n\n📝 **Pour répondre:** \`/reply ${messageId} [votre réponse]\`\n📊 **Messages aujourd'hui:** ${userData.count}/2`;

        // Envoyer aux tous les admins
        let adminNotified = 0;
        for (const adminId of ADMIN_IDS) {
            try {
                const result = await sendMessage(adminId, adminMessage);
                if (result.success) {
                    adminNotified++;
                    log.info(`📞 Message contact envoyé à l'admin ${adminId}`);
                }
            } catch (error) {
                log.warning(`❌ Impossible de notifier l'admin ${adminId}: ${error.message}`);
            }
        }

        // Enregistrer en mémoire
        addToMemory(senderId, 'user', `/contact ${userMessage}`);

        // Réponse à l'utilisateur
        const remainingMessages = 2 - userData.count;
        const response = `✅ **Message envoyé aux admins !**\n\n🆔 **ID de votre message:** ${messageId}\n👨‍💼 **Admins notifiés:** ${adminNotified}\n📊 **Messages restants aujourd'hui:** ${remainingMessages}\n\n⏰ Vous recevrez une réponse dès que possible !\n💕 Merci de votre patience !`;
        
        addToMemory(senderId, 'assistant', response);
        
        // Sauvegarder les données
        await saveDataImmediate();
        
        return response;

    } catch (error) {
        log.error(`❌ Erreur commande contact: ${error.message}`);
        
        const errorResponse = `❌ **Erreur !**\n\n🔧 Une erreur s'est produite lors de l'envoi de votre message.\n📋 **Détails:** ${error.message}\n\n💡 Réessayez dans quelques instants.`;
        
        addToMemory(senderId, 'assistant', errorResponse);
        return errorResponse;
    }
};

// === GESTION DES COMMANDES ADMIN ===
async function handleAdminCommands(senderId, args, context) {
    const { sendMessage, addToMemory, saveDataImmediate, log } = context;
    
    if (!args || args.trim().length === 0) {
        const totalMessages = Array.from(contactData.userMessages.values())
            .reduce((sum, userData) => sum + userData.messages.length, 0);
        const todayMessages = Array.from(contactData.userMessages.values())
            .reduce((sum, userData) => {
                const today = new Date().toDateString();
                return sum + (userData.lastReset === today ? userData.count : 0);
            }, 0);
        
        const response = `🔧 **Commandes Admin - Contact**\n\n📞 **Commandes disponibles:**\n\`/contact list\` - Voir tous les messages\n\`/contact pending\` - Messages non répondus\n\`/contact today\` - Messages d'aujourd'hui\n\`/reply [messageId] [réponse]\` - Répondre à un utilisateur\n\n📊 **Statistiques:**\n📨 **Total messages:** ${totalMessages}\n📅 **Aujourd'hui:** ${todayMessages}\n💬 **En attente:** ${countPendingMessages()}`;
        
        addToMemory(senderId, 'user', '/contact');
        addToMemory(senderId, 'assistant', response);
        return response;
    }

    const command = args.trim().toLowerCase();

    switch (command) {
        case 'list':
            return await listAllMessages(senderId, context);
        case 'pending':
            return await listPendingMessages(senderId, context);
        case 'today':
            return await listTodayMessages(senderId, context);
        default:
            const response = `❓ **Commande inconnue:** \`${command}\`\n\n📞 Tapez \`/contact\` pour voir les commandes disponibles.`;
            addToMemory(senderId, 'user', `/contact ${args}`);
            addToMemory(senderId, 'assistant', response);
            return response;
    }
}

// === COMMANDE REPLY (SÉPARÉE) ===
module.exports.reply = async function(senderId, args, context) {
    const { isAdmin, sendMessage, addToMemory, saveDataImmediate, log } = context;

    if (!isAdmin(senderId)) {
        const response = "🚫 **Accès refusé !** Cette commande est réservée aux administrateurs.";
        addToMemory(senderId, 'user', '/reply');
        addToMemory(senderId, 'assistant', response);
        return response;
    }

    if (!args || args.trim().length === 0) {
        const response = `📝 **Commande Reply**\n\n💌 **Usage:** \`/reply [messageId] [votre réponse]\`\n\n📝 **Exemple:**\n\`/reply msg_123_456 Merci pour votre message ! Le problème est résolu.\`\n\n💡 Utilisez \`/contact pending\` pour voir les messages en attente.`;
        
        addToMemory(senderId, 'user', '/reply');
        addToMemory(senderId, 'assistant', response);
        return response;
    }

    const parts = args.trim().split(' ');
    if (parts.length < 2) {
        const response = `❓ **Format incorrect !**\n\n💌 **Usage:** \`/reply [messageId] [votre réponse]\`\n\n📝 L'ID du message et la réponse sont requis.`;
        
        addToMemory(senderId, 'user', `/reply ${args}`);
        addToMemory(senderId, 'assistant', response);
        return response;
    }

    const messageId = parts[0];
    const replyText = parts.slice(1).join(' ');

    // Chercher le message original
    let originalMessage = null;
    let originalUserId = null;

    for (const [userId, userData] of contactData.userMessages.entries()) {
        const message = userData.messages.find(msg => msg.id === messageId);
        if (message) {
            originalMessage = message;
            originalUserId = userId;
            break;
        }
    }

    if (!originalMessage) {
        const response = `❓ **Message introuvable !**\n\n🔍 **ID recherché:** ${messageId}\n\n💡 Vérifiez l'ID ou utilisez \`/contact list\` pour voir tous les messages.`;
        
        addToMemory(senderId, 'user', `/reply ${args}`);
        addToMemory(senderId, 'assistant', response);
        return response;
    }

    if (originalMessage.replied) {
        const response = `⚠️ **Déjà répondu !**\n\n📨 Ce message a déjà reçu une réponse.\n📅 **Message original:** "${originalMessage.message.substring(0, 50)}..."\n\n💡 Vous pouvez quand même envoyer une nouvelle réponse.`;
    }

    try {
        // Préparer la réponse pour l'utilisateur
        const userReply = `💌 **Réponse de l'équipe NakamaBot**\n\n📩 **Votre message:**\n"${originalMessage.message}"\n\n💬 **Réponse de l'admin:**\n"${replyText}"\n\n📅 **Date:** ${new Date().toLocaleString('fr-FR')}\n\n💕 Merci d'avoir contacté notre équipe !`;

        // Envoyer la réponse à l'utilisateur
        const result = await sendMessage(originalUserId, userReply);
        
        if (result.success) {
            // Marquer comme répondu
            originalMessage.replied = true;
            originalMessage.replyText = replyText;
            originalMessage.replyAdminId = senderId;
            originalMessage.replyTimestamp = new Date().toISOString();

            // Enregistrer la réponse admin
            contactData.adminReplies.set(messageId, {
                adminId: senderId,
                reply: replyText,
                timestamp: new Date().toISOString(),
                originalUserId: originalUserId
            });

            // Enregistrer en mémoire
            addToMemory(senderId, 'user', `/reply ${messageId} ${replyText}`);
            
            const confirmResponse = `✅ **Réponse envoyée !**\n\n👤 **À l'utilisateur:** ${originalUserId}\n🆔 **Message ID:** ${messageId}\n📝 **Votre réponse:** "${replyText.substring(0, 100)}${replyText.length > 100 ? '...' : ''}"\n📅 **Envoyé:** ${new Date().toLocaleString('fr-FR')}\n\n💕 L'utilisateur a été notifié !`;
            
            addToMemory(senderId, 'assistant', confirmResponse);
            
            // Sauvegarder
            await saveDataImmediate();
            
            log.info(`✅ Admin ${senderId} a répondu au message ${messageId} de l'utilisateur ${originalUserId}`);
            
            return confirmResponse;
            
        } else {
            const errorResponse = `❌ **Erreur d'envoi !**\n\n🔧 Impossible d'envoyer la réponse à l'utilisateur ${originalUserId}.\n📋 **Erreur:** ${result.error}\n\n💡 L'utilisateur a peut-être bloqué le bot.`;
            
            addToMemory(senderId, 'user', `/reply ${args}`);
            addToMemory(senderId, 'assistant', errorResponse);
            return errorResponse;
        }

    } catch (error) {
        log.error(`❌ Erreur reply: ${error.message}`);
        
        const errorResponse = `❌ **Erreur !**\n\n🔧 Une erreur s'est produite lors de l'envoi de la réponse.\n📋 **Détails:** ${error.message}`;
        
        addToMemory(senderId, 'assistant', errorResponse);
        return errorResponse;
    }
};

// === FONCTIONS UTILITAIRES ===

async function listAllMessages(senderId, context) {
    const { addToMemory } = context;
    
    let allMessages = [];
    for (const [userId, userData] of contactData.userMessages.entries()) {
        allMessages.push(...userData.messages.map(msg => ({ ...msg, userId })));
    }
    
    allMessages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    if (allMessages.length === 0) {
        const response = "📭 **Aucun message !**\n\nAucun utilisateur n'a encore contacté les admins.";
        addToMemory(senderId, 'user', '/contact list');
        addToMemory(senderId, 'assistant', response);
        return response;
    }
    
    let response = `📨 **Tous les messages (${allMessages.length})**\n\n`;
    
    const displayCount = Math.min(allMessages.length, 5);
    for (let i = 0; i < displayCount; i++) {
        const msg = allMessages[i];
        const preview = msg.message.length > 50 ? msg.message.substring(0, 50) + "..." : msg.message;
        const status = msg.replied ? "✅" : "⏳";
        const date = new Date(msg.timestamp).toLocaleString('fr-FR');
        
        response += `${status} **${msg.id}**\n👤 ${msg.userId} | 📅 ${date}\n💬 "${preview}"\n\n`;
    }
    
    if (allMessages.length > 5) {
        response += `📄 ... et ${allMessages.length - 5} autres messages\n\n`;
    }
    
    response += `💡 **Commandes:**\n\`/reply [id] [réponse]\` - Répondre\n\`/contact pending\` - Non répondus seulement`;
    
    addToMemory(senderId, 'user', '/contact list');
    addToMemory(senderId, 'assistant', response);
    return response;
}

async function listPendingMessages(senderId, context) {
    const { addToMemory } = context;
    
    let pendingMessages = [];
    for (const [userId, userData] of contactData.userMessages.entries()) {
        pendingMessages.push(...userData.messages.filter(msg => !msg.replied).map(msg => ({ ...msg, userId })));
    }
    
    pendingMessages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    if (pendingMessages.length === 0) {
        const response = "✅ **Aucun message en attente !**\n\nTous les messages ont été traités. Excellent travail ! 💪";
        addToMemory(senderId, 'user', '/contact pending');
        addToMemory(senderId, 'assistant', response);
        return response;
    }
    
    let response = `⏳ **Messages en attente (${pendingMessages.length})**\n\n`;
    
    const displayCount = Math.min(pendingMessages.length, 5);
    for (let i = 0; i < displayCount; i++) {
        const msg = pendingMessages[i];
        const preview = msg.message.length > 50 ? msg.message.substring(0, 50) + "..." : msg.message;
        const date = new Date(msg.timestamp).toLocaleString('fr-FR');
        
        response += `🆔 **${msg.id}**\n👤 ${msg.userId} | 📅 ${date}\n💬 "${preview}"\n📝 \`/reply ${msg.id} [votre réponse]\`\n\n`;
    }
    
    if (pendingMessages.length > 5) {
        response += `📄 ... et ${pendingMessages.length - 5} autres messages en attente`;
    }
    
    addToMemory(senderId, 'user', '/contact pending');
    addToMemory(senderId, 'assistant', response);
    return response;
}

async function listTodayMessages(senderId, context) {
    const { addToMemory } = context;
    
    const today = new Date().toDateString();
    let todayMessages = [];
    
    for (const [userId, userData] of contactData.userMessages.entries()) {
        if (userData.lastReset === today) {
            todayMessages.push(...userData.messages.map(msg => ({ ...msg, userId })));
        }
    }
    
    todayMessages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    if (todayMessages.length === 0) {
        const response = "📅 **Aucun message aujourd'hui !**\n\nAucun utilisateur n'a contacté les admins aujourd'hui.";
        addToMemory(senderId, 'user', '/contact today');
        addToMemory(senderId, 'assistant', response);
        return response;
    }
    
    let response = `📅 **Messages d'aujourd'hui (${todayMessages.length})**\n\n`;
    
    const displayCount = Math.min(todayMessages.length, 5);
    for (let i = 0; i < displayCount; i++) {
        const msg = todayMessages[i];
        const preview = msg.message.length > 50 ? msg.message.substring(0, 50) + "..." : msg.message;
        const status = msg.replied ? "✅" : "⏳";
        const time = new Date(msg.timestamp).toLocaleTimeString('fr-FR');
        
        response += `${status} **${msg.id}**\n👤 ${msg.userId} | ⏰ ${time}\n💬 "${preview}"\n\n`;
    }
    
    if (todayMessages.length > 5) {
        response += `📄 ... et ${todayMessages.length - 5} autres messages aujourd'hui`;
    }
    
    addToMemory(senderId, 'user', '/contact today');
    addToMemory(senderId, 'assistant', response);
    return response;
}

function countPendingMessages() {
    let count = 0;
    for (const userData of contactData.userMessages.values()) {
        count += userData.messages.filter(msg => !msg.replied).length;
    }
    return count;
}

// === EXPORTS POUR LA COMMANDE REPLY ===
module.exports.getContactData = () => contactData;
module.exports.setContactData = (data) => { contactData = data; };

// Export de la fonction reply pour qu'elle soit accessible comme commande séparée
module.exports.reply = module.exports.reply;
