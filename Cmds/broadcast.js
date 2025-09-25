// Cmds/broadcast.js - Version avec support images existantes
// Commande de diffusion avec gestion d'images et délai de 2s

let broadcastState = {
    isRunning: false,
    sessionId: null,
    message: null,
    messageType: 'text', // 'text', 'image', 'image-only'
    imageUrl: null,
    caption: null,
    processed: new Set(),
    stats: { success: 0, failed: 0, total: 0 },
    adminId: null,
    cancelled: false
};

module.exports = async function(senderId, args, context) {
    const { isAdmin, userList, sendMessage, sendImage, addToMemory, log, sleep } = context;

    try {
        // Vérification admin
        if (!isAdmin(senderId)) {
            const response = "🚫 **Accès refusé !** Cette commande est réservée aux administrateurs.";
            addToMemory(senderId, 'user', '/broadcast');
            addToMemory(senderId, 'assistant', response);
            return response;
        }

        // Vérification si broadcast en cours
        if (broadcastState.isRunning) {
            const progress = `${broadcastState.stats.success + broadcastState.stats.failed}/${broadcastState.stats.total}`;
            const typeInfo = broadcastState.messageType === 'image' ? '🖼️ Diffusion IMAGE' : 
                           broadcastState.messageType === 'image-only' ? '📸 Diffusion PHOTO' : '📢 Diffusion TEXTE';
            const response = `🔄 **Diffusion en cours !**\n${typeInfo}\n📊 Progression: ${progress}\n✅ Réussis: ${broadcastState.stats.success}\n❌ Échecs: ${broadcastState.stats.failed}\n\n🛑 Utilise \`/stop-broadcast\` pour arrêter.`;
            addToMemory(senderId, 'user', '/broadcast');
            addToMemory(senderId, 'assistant', response);
            return response;
        }

        // Vérification du message
        if (!args || args.trim().length === 0) {
            const totalUsers = userList.size;
            const targetUsers = Math.max(0, totalUsers - 1);
            const response = `📢 **Commande Broadcast**\n\n🎯 **Usage texte:** \`/broadcast [message]\`\n🖼️ **Usage image:** \`/broadcast image [url] [caption]\`\n📸 **Photo seule:** \`/broadcast photo [url]\`\n👥 **Destinataires:** ${targetUsers} utilisateurs\n\n⚠️ Le message sera envoyé à TOUS les utilisateurs !`;
            addToMemory(senderId, 'user', '/broadcast');
            addToMemory(senderId, 'assistant', response);
            return response;
        }

        const userMessage = args.trim();
        const targetUsersArray = Array.from(userList).filter(userId => String(userId) !== String(senderId));
        
        if (targetUsersArray.length === 0) {
            const response = `👥 **Aucun destinataire !** Il n'y a aucun utilisateur à contacter.`;
            addToMemory(senderId, 'user', '/broadcast');
            addToMemory(senderId, 'assistant', response);
            return response;
        }

        // Détection du type de broadcast
        if (userMessage.toLowerCase().startsWith('image ')) {
            return handleImageBroadcast(senderId, userMessage.substring(6).trim(), targetUsersArray, context);
        } else if (userMessage.toLowerCase().startsWith('photo ')) {
            return handlePhotoBroadcast(senderId, userMessage.substring(6).trim(), targetUsersArray, context);
        } else {
            return handleTextBroadcast(senderId, userMessage, targetUsersArray, context);
        }

    } catch (error) {
        log.error(`Erreur broadcast command: ${error.message}`);
        resetBroadcastState();
        const errorResponse = `❌ **Erreur !** ${error.message}`;
        addToMemory(senderId, 'assistant', errorResponse);
        return errorResponse;
    }
};

// Gestion broadcast texte
function handleTextBroadcast(senderId, message, targetUsers, context) {
    const { addToMemory, log } = context;

    const finalMessage = `📢 **Message de l'équipe NakamaBot :**\n\n${message}\n\n✨ _Diffusion automatique_`;

    // Vérification longueur
    if (finalMessage.length > 1800) {
        const response = `📝 **Message trop long !** (${finalMessage.length}/1800 caractères)`;
        addToMemory(senderId, 'user', '/broadcast');
        addToMemory(senderId, 'assistant', response);
        return response;
    }

    // Initialisation du broadcast texte
    broadcastState = {
        isRunning: true,
        sessionId: `${Date.now()}`,
        message: finalMessage,
        messageType: 'text',
        imageUrl: null,
        caption: null,
        processed: new Set(),
        stats: { success: 0, failed: 0, total: targetUsers.length },
        adminId: senderId,
        cancelled: false
    };

    // Enregistrement en mémoire
    addToMemory(senderId, 'user', `/broadcast ${message}`);

    // Message de confirmation
    const preview = message.length > 60 ? message.substring(0, 60) + "..." : message;
    const confirmResponse = `🚀 **Diffusion TEXTE lancée !**\n\n👥 **Destinataires :** ${targetUsers.length}\n📝 **Message :** "${preview}"\n\n⏳ Diffusion en cours... Je t'enverrai un rapport à la fin !`;
    addToMemory(senderId, 'assistant', confirmResponse);

    // Lancement asynchrone
    processBroadcast(targetUsers, context).catch(error => {
        log.error(`Erreur broadcast: ${error.message}`);
        resetBroadcastState();
    });

    return confirmResponse;
}

// Gestion broadcast image avec caption
function handleImageBroadcast(senderId, args, targetUsers, context) {
    const { addToMemory, log } = context;

    // Séparer l'URL du caption
    const parts = args.split(' ').filter(p => p.trim());
    if (parts.length < 1) {
        const response = `🖼️ **Broadcast Image**\n\n🎯 Usage: \`/broadcast image [url_image] [caption_optional]\`\n💡 Exemple: \`/broadcast image https://example.com/photo.jpg Message important\``;
        addToMemory(senderId, 'user', '/broadcast image');
        addToMemory(senderId, 'assistant', response);
        return response;
    }

    const imageUrl = parts[0];
    const caption = parts.length > 1 ? parts.slice(1).join(' ') : '📢 **Message de l\'équipe NakamaBot**\n\n✨ _Diffusion automatique_';

    // Validation URL basique
    if (!imageUrl.startsWith('http')) {
        const response = `❌ **URL invalide !**\n\nL'URL doit commencer par http:// ou https://\n💡 Exemple: \`/broadcast image https://example.com/photo.jpg Mon message\``;
        addToMemory(senderId, 'user', '/broadcast image');
        addToMemory(senderId, 'assistant', response);
        return response;
    }

    // Vérification longueur caption
    if (caption.length > 1800) {
        const response = `📝 **Caption trop long !** (${caption.length}/1800 caractères)`;
        addToMemory(senderId, 'user', '/broadcast image');
        addToMemory(senderId, 'assistant', response);
        return response;
    }

    // Initialisation du broadcast image
    broadcastState = {
        isRunning: true,
        sessionId: `${Date.now()}`,
        message: caption,
        messageType: 'image',
        imageUrl: imageUrl,
        caption: caption,
        processed: new Set(),
        stats: { success: 0, failed: 0, total: targetUsers.length },
        adminId: senderId,
        cancelled: false
    };

    // Enregistrement en mémoire
    addToMemory(senderId, 'user', `/broadcast image ${args}`);

    // Message de confirmation
    const captionPreview = caption.length > 40 ? caption.substring(0, 40) + "..." : caption;
    const confirmResponse = `🚀 **Diffusion IMAGE lancée !**\n\n👥 **Destinataires :** ${targetUsers.length}\n🖼️ **URL Image :** ${imageUrl.substring(0, 50)}...\n📝 **Caption :** "${captionPreview}"\n\n⏳ Diffusion en cours... Je t'enverrai un rapport à la fin !`;
    addToMemory(senderId, 'assistant', confirmResponse);

    // Lancement asynchrone
    processBroadcast(targetUsers, context).catch(error => {
        log.error(`Erreur broadcast image: ${error.message}`);
        resetBroadcastState();
    });

    return confirmResponse;
}

// Gestion broadcast photo seule (sans caption)
function handlePhotoBroadcast(senderId, imageUrl, targetUsers, context) {
    const { addToMemory, log } = context;

    // Validation URL basique
    if (!imageUrl.startsWith('http')) {
        const response = `❌ **URL invalide !**\n\nL'URL doit commencer par http:// ou https://\n💡 Exemple: \`/broadcast photo https://example.com/photo.jpg\``;
        addToMemory(senderId, 'user', '/broadcast photo');
        addToMemory(senderId, 'assistant', response);
        return response;
    }

    // Initialisation du broadcast photo seule
    broadcastState = {
        isRunning: true,
        sessionId: `${Date.now()}`,
        message: '📸 **Photo de l\'équipe NakamaBot**\n\n✨ _Diffusion automatique_',
        messageType: 'image-only',
        imageUrl: imageUrl,
        caption: null,
        processed: new Set(),
        stats: { success: 0, failed: 0, total: targetUsers.length },
        adminId: senderId,
        cancelled: false
    };

    // Enregistrement en mémoire
    addToMemory(senderId, 'user', `/broadcast photo ${imageUrl}`);

    // Message de confirmation
    const confirmResponse = `🚀 **Diffusion PHOTO lancée !**\n\n👥 **Destinataires :** ${targetUsers.length}\n📸 **URL Photo :** ${imageUrl.substring(0, 50)}...\n\n⏳ Diffusion en cours... Je t'enverrai un rapport à la fin !`;
    addToMemory(senderId, 'assistant', confirmResponse);

    // Lancement asynchrone
    processBroadcast(targetUsers, context).catch(error => {
        log.error(`Erreur broadcast photo: ${error.message}`);
        resetBroadcastState();
    });

    return confirmResponse;
}

// Fonction principale de traitement
async function processBroadcast(targetUsers, context) {
    const { sendMessage, sendImage, addToMemory, log, sleep } = context;
    const { adminId, message, messageType, imageUrl, caption } = broadcastState;
    
    log.info(`📢 Début broadcast ${messageType} vers ${targetUsers.length} utilisateurs`);

    for (let i = 0; i < targetUsers.length && !broadcastState.cancelled; i++) {
        const userId = targetUsers[i];
        const userIdStr = String(userId);

        // Protection anti-doublons
        if (broadcastState.processed.has(userIdStr)) {
            continue;
        }

        broadcastState.processed.add(userIdStr);

        try {
            let result;
            
            if (messageType === 'image') {
                // Envoi d'image avec caption
                result = await Promise.race([
                    sendImage(userId, imageUrl, caption || message),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Timeout image')), 15000)
                    )
                ]);
            } else if (messageType === 'image-only') {
                // Envoi de photo seule
                result = await Promise.race([
                    sendImage(userId, imageUrl, message),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Timeout photo')), 15000)
                    )
                ]);
            } else {
                // Envoi de texte simple
                result = await Promise.race([
                    sendMessage(userId, message),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Timeout texte')), 10000)
                    )
                ]);
            }

            if (result && result.success) {
                broadcastState.stats.success++;
                log.debug(`✅ ${messageType.toUpperCase()} envoyé à ${userId}`);
            } else {
                broadcastState.stats.failed++;
                log.debug(`❌ Échec envoi ${messageType} à ${userId}: ${result?.error || 'Erreur inconnue'}`);
            }

        } catch (error) {
            broadcastState.stats.failed++;
            log.debug(`❌ Exception envoi ${messageType} à ${userId}: ${error.message}`);
        }

        // Délai de 2 secondes entre chaque envoi
        if (i < targetUsers.length - 1 && !broadcastState.cancelled) {
            await sleep(2000);
        }

        // Rapport de progression
        const processed = i + 1;
        if (processed % 10 === 0 || processed === targetUsers.length) {
            const percent = Math.round((processed / targetUsers.length) * 100);
            const typeEmoji = messageType.includes('image') ? '🖼️' : '📢';
            log.info(`${typeEmoji} Broadcast ${percent}%: ${broadcastState.stats.success}✅ ${broadcastState.stats.failed}❌`);
            
            // Rapport intermédiaire
            if (processed % 20 === 0 && processed < targetUsers.length) {
                const typeText = messageType.toUpperCase();
                const report = `📊 **Progression ${typeText}: ${percent}%**\n✅ Réussis: ${broadcastState.stats.success}\n❌ Échecs: ${broadcastState.stats.failed}\n📈 Traités: ${processed}/${targetUsers.length}`;
                try {
                    await sendMessage(adminId, report);
                } catch (e) {
                    log.warning(`Impossible d'envoyer rapport intermédiaire: ${e.message}`);
                }
            }
        }
    }

    // Rapport final
    await generateFinalReport(context);
}

// Génération du rapport final
async function generateFinalReport(context) {
    const { sendMessage, addToMemory, log } = context;
    const { adminId, cancelled, stats, messageType } = broadcastState;

    const successRate = stats.total > 0 ? Math.round((stats.success / stats.total) * 100) : 0;
    const typeText = messageType.toUpperCase();
    
    let finalReport;
    if (cancelled) {
        finalReport = `🛑 **Diffusion ${typeText} INTERROMPUE**\n\n📊 **Résultats partiels:**\n✅ Envoyés: ${stats.success}\n❌ Erreurs: ${stats.failed}\n📈 Traités: ${stats.success + stats.failed}/${stats.total}`;
    } else {
        finalReport = `🎉 **Diffusion ${typeText} TERMINÉE !**\n\n📊 **Rapport final:**\n✅ Envoyés: ${stats.success}\n❌ Erreurs: ${stats.failed}\n📈 Total: ${stats.total}\n📊 Taux de réussite: ${successRate}%\n\n💕 Message diffusé avec succès !`;
    }

    try {
        const result = await sendMessage(adminId, finalReport);
        if (result?.success) {
            addToMemory(adminId, 'assistant', finalReport);
        }
        log.info(`📋 Rapport final ${typeText} envoyé à l'admin ${adminId}`);
    } catch (error) {
        log.error(`Erreur envoi rapport final: ${error.message}`);
    }

    resetBroadcastState();
}

// Réinitialisation de l'état
function resetBroadcastState() {
    broadcastState = {
        isRunning: false,
        sessionId: null,
        message: null,
        messageType: 'text',
        imageUrl: null,
        caption: null,
        processed: new Set(),
        stats: { success: 0, failed: 0, total: 0 },
        adminId: null,
        cancelled: false
    };
}

// Exports pour stop-broadcast
module.exports.getBroadcastState = () => ({ ...broadcastState });
module.exports.setBroadcastCancelled = () => {
    if (broadcastState.isRunning) {
        broadcastState.cancelled = true;
        console.log(`🛑 Broadcast ${broadcastState.messageType} marqué pour annulation`);
    }
};
module.exports.resetBroadcastState = resetBroadcastState;
