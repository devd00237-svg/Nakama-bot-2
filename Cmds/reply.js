// Cmds/reply.js
// Commande séparée pour permettre aux admins de répondre aux messages utilisateurs

// Import des données de contact depuis la commande contact
const contactCommand = require('./contact.js');

module.exports = async function(senderId, args, context) {
    const { isAdmin, sendMessage, addToMemory, saveDataImmediate, log } = context;

    if (!isAdmin(senderId)) {
        const response = "🚫 **Accès refusé !** Cette commande est réservée aux administrateurs.";
        addToMemory(senderId, 'user', '/reply');
        addToMemory(senderId, 'assistant', response);
        return response;
    }

    if (!args || args.trim().length === 0) {
        const response = `📝 **Commande Reply**\n\n💌 **Usage:** \`/reply [messageId] [votre réponse]\`\n\n📝 **Exemple:**\n\`/reply msg_123_456 Merci pour votre message ! Le problème est résolu.\`\n\n💡 **Aide:**\n\`/contact pending\` - Messages en attente\n\`/contact list\` - Tous les messages\n\`/contact today\` - Messages d'aujourd'hui`;
        
        addToMemory(senderId, 'user', '/reply');
        addToMemory(senderId, 'assistant', response);
        return response;
    }

    const parts = args.trim().split(' ');
    if (parts.length < 2) {
        const response = `❓ **Format incorrect !**\n\n💌 **Usage:** \`/reply [messageId] [votre réponse]\`\n\n📝 **Requis:**\n• ID du message\n• Votre réponse\n\n💡 Utilisez \`/contact pending\` pour voir les messages en attente.`;
        
        addToMemory(senderId, 'user', `/reply ${args}`);
        addToMemory(senderId, 'assistant', response);
        return response;
    }

    const messageId = parts[0];
    const replyText = parts.slice(1).join(' ');

    // Vérifier la longueur de la réponse
    if (replyText.length > 1000) {
        const response = `📝 **Réponse trop longue !**\n\n📏 **Longueur actuelle:** ${replyText.length} caractères\n📏 **Maximum autorisé:** 1000 caractères\n📏 **À supprimer:** ${replyText.length - 1000} caractères\n\n💡 Raccourcissez votre réponse s'il vous plaît.`;
        
        addToMemory(senderId, 'user', `/reply ${args}`);
        addToMemory(senderId, 'assistant', response);
        return response;
    }

    try {
        // Récupérer les données de contact
        const contactData = contactCommand.getContactData();
        
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
            const response = `❓ **Message introuvable !**\n\n🔍 **ID recherché:** \`${messageId}\`\n\n💡 **Vérifications:**\n• L'ID est-il correct ?\n• Utilisez \`/contact list\` pour voir tous les messages\n• Utilisez \`/contact pending\` pour les messages non répondus`;
            
            addToMemory(senderId, 'user', `/reply ${args}`);
            addToMemory(senderId, 'assistant', response);
            return response;
        }

        // Avertir si déjà répondu
        if (originalMessage.replied) {
            const previousReply = originalMessage.replyText ? originalMessage.replyText.substring(0, 50) + "..." : "Réponse précédente";
            const previousAdmin = originalMessage.replyAdminId || "Admin inconnu";
            const previousDate = originalMessage.replyTimestamp ? new Date(originalMessage.replyTimestamp).toLocaleString('fr-FR') : "Date inconnue";
            
            // Permettre quand même de répondre mais avertir
            log.info(`⚠️ Admin ${senderId} répond à un message déjà traité ${messageId}`);
            
            const warningMsg = `⚠️ **Attention !** Ce message a déjà une réponse :\n\n📅 **Répondu le:** ${previousDate}\n👤 **Par admin:** ${previousAdmin}\n💬 **Réponse:** "${previousReply}"\n\n🔄 **Votre nouvelle réponse sera quand même envoyée.**`;
            
            // Envoyer l'avertissement d'abord
            await sendMessage(senderId, warningMsg);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Petite pause
        }

        // Préparer la réponse pour l'utilisateur
        const messagePreview = originalMessage.message.length > 100 
            ? originalMessage.message.substring(0, 100) + "..." 
            : originalMessage.message;
            
        const userReply = `💌 **Réponse de l'équipe NakamaBot**\n\n📩 **Votre message du ${new Date(originalMessage.timestamp).toLocaleString('fr-FR')} :**\n"${messagePreview}"\n\n💬 **Réponse de notre équipe :**\n"${replyText}"\n\n📅 **Répondu le :** ${new Date().toLocaleString('fr-FR')}\n\n💕 Merci d'avoir contacté notre équipe !\n✨ N'hésitez pas à nous recontacter si besoin !`;

        // Envoyer la réponse à l'utilisateur
        const result = await sendMessage(originalUserId, userReply);
        
        if (result.success) {
            // Marquer comme répondu et enregistrer les détails
            originalMessage.replied = true;
            originalMessage.replyText = replyText;
            originalMessage.replyAdminId = senderId;
            originalMessage.replyTimestamp = new Date().toISOString();

            // Enregistrer la réponse admin dans les données
            contactData.adminReplies.set(messageId, {
                adminId: senderId,
                reply: replyText,
                timestamp: new Date().toISOString(),
                originalUserId: originalUserId,
                originalMessage: originalMessage.message
            });

            // Enregistrer en mémoire
            addToMemory(senderId, 'user', `/reply ${messageId} ${replyText}`);
            
            // Préparer la confirmation pour l'admin
            const replyPreview = replyText.length > 80 ? replyText.substring(0, 80) + "..." : replyText;
            const originalPreview = originalMessage.message.length > 60 ? originalMessage.message.substring(0, 60) + "..." : originalMessage.message;
            
            const confirmResponse = `✅ **Réponse envoyée avec succès !**\n\n👤 **À l'utilisateur :** ${originalUserId}\n🆔 **Message ID :** \`${messageId}\`\n📅 **Envoyé le :** ${new Date().toLocaleString('fr-FR')}\n\n📨 **Message original :**\n"${originalPreview}"\n\n💬 **Votre réponse :**\n"${replyPreview}"\n\n💕 L'utilisateur a été notifié et peut vous recontacter si besoin !`;
            
            addToMemory(senderId, 'assistant', confirmResponse);
            
            // Sauvegarder les données mises à jour
            await saveDataImmediate();
            
            log.info(`✅ Admin ${senderId} a répondu au message ${messageId} de l'utilisateur ${originalUserId}`);
            
            return confirmResponse;
            
        } else {
            // Erreur d'envoi
            const errorMsg = result.error || "Erreur inconnue";
            let errorAdvice = "💡 L'utilisateur a peut-être bloqué le bot ou supprimé son compte.";
            
            if (errorMsg.toLowerCase().includes('user not found')) {
                errorAdvice = "💡 L'utilisateur semble avoir supprimé son compte Facebook.";
            } else if (errorMsg.toLowerCase().includes('block')) {
                errorAdvice = "💡 L'utilisateur a probablement bloqué le bot.";
            } else if (errorMsg.toLowerCase().includes('limit')) {
                errorAdvice = "💡 Limite de débit atteinte, réessayez dans quelques minutes.";
            }
            
            const errorResponse = `❌ **Erreur d'envoi !**\n\n🔧 **Impossible d'envoyer la réponse à l'utilisateur** ${originalUserId}\n📋 **Erreur :** ${errorMsg}\n\n${errorAdvice}\n\n💾 **Le message est marqué comme traité** pour éviter les doublons.`;
            
            // Marquer quand même comme traité pour éviter les tentatives répétées
            originalMessage.replied = true;
            originalMessage.replyText = replyText;
            originalMessage.replyAdminId = senderId;
            originalMessage.replyTimestamp = new Date().toISOString();
            originalMessage.deliveryFailed = true;
            originalMessage.deliveryError = errorMsg;
            
            addToMemory(senderId, 'user', `/reply ${args}`);
            addToMemory(senderId, 'assistant', errorResponse);
            
            await saveDataImmediate();
            
            log.warning(`❌ Erreur envoi réponse ${messageId} à ${originalUserId}: ${errorMsg}`);
            
            return errorResponse;
        }

    } catch (error) {
        log.error(`❌ Erreur commande reply: ${error.message}`);
        
        const errorResponse = `❌ **Erreur système !**\n\n🔧 Une erreur interne s'est produite lors du traitement de votre réponse.\n📋 **Détails :** ${error.message}\n\n💡 **Solutions :**\n• Vérifiez l'ID du message\n• Réessayez dans quelques instants\n• Contactez le support technique si le problème persiste`;
        
        addToMemory(senderId, 'user', `/reply ${args}`);
        addToMemory(senderId, 'assistant', errorResponse);
        return errorResponse;
    }
};
