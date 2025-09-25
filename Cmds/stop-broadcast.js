// Cmds/stop-broadcast.js
// Commande pour arrêter une diffusion en cours (admin seulement)

const path = require('path');

module.exports = async function(senderId, args, context) {
    const {
        isAdmin,
        addToMemory,
        log
    } = context;

    const senderIdStr = String(senderId);

    // ✅ Vérifier les permissions admin OBLIGATOIRES
    if (!isAdmin(senderId)) {
        const response = "🚫 Désolée ! La commande d'arrêt de diffusion est réservée aux administrateurs ! 💕\n\n✨ Tu peux utiliser /help pour voir ce que je peux faire pour toi !";
        addToMemory(senderId, 'user', '/stop-broadcast');
        addToMemory(senderId, 'assistant', response);
        return response;
    }

    // ✅ Enregistrer la commande en mémoire
    addToMemory(senderId, 'user', '/stop-broadcast');

    try {
        // ✅ Accéder à l'état du broadcast depuis le module broadcast
        const broadcastModule = require('./broadcast.js');
        
        // ✅ Vérifier si la fonction existe
        if (typeof broadcastModule.getBroadcastState !== 'function') {
            const response = "❌ **Erreur technique !**\n\nImpossible d'accéder à l'état du broadcast. Le module broadcast.js pourrait ne pas être chargé correctement.\n\n💡 Réessaie dans quelques secondes.";
            addToMemory(senderId, 'assistant', response);
            return response;
        }

        const broadcastState = broadcastModule.getBroadcastState();

        // ✅ Vérifier s'il y a un broadcast en cours
        if (!broadcastState.isRunning) {
            const response = "📢 **Aucune diffusion en cours !**\n\n✅ Il n'y a actuellement aucun broadcast à arrêter.\n\n💡 Utilise **/broadcast [message]** pour lancer une diffusion.";
            addToMemory(senderId, 'assistant', response);
            return response;
        }

        // ✅ Informations sur le broadcast en cours
        const elapsed = Math.round((Date.now() - broadcastState.startTime) / 1000);
        const progress = broadcastState.successCount + broadcastState.errorCount;
        const progressPercent = Math.round((progress / broadcastState.totalUsers) * 100);

        // ✅ Arrêter le broadcast
        broadcastModule.setBroadcastCancelled();
        
        log.info(`🛑 BROADCAST ARRÊTÉ par admin ${senderId} (${progress}/${broadcastState.totalUsers} traités)`);

        // ✅ Message de confirmation
        const response = `🛑 **Diffusion ARRÊTÉE !**\n\n📊 **État au moment de l'arrêt:**\n✅ **Envoyés:** ${broadcastState.successCount}\n❌ **Erreurs:** ${broadcastState.errorCount}\n📈 **Progression:** ${progress}/${broadcastState.totalUsers} (${progressPercent}%)\n⏱️ **Temps écoulé:** ${elapsed}s\n\n💡 **La diffusion s'arrêtera après l'utilisateur en cours de traitement.**\n\n📋 **Tu recevras un rapport final dans quelques secondes.**`;

        addToMemory(senderId, 'assistant', response);
        return response;

    } catch (error) {
        log.error(`❌ Erreur stop-broadcast: ${error.message}`);
        
        const response = `❌ **Erreur lors de l'arrêt !**\n\n🔍 **Détails:** ${error.message}\n\n💡 **Solutions possibles:**\n• Réessaie dans quelques secondes\n• Redémarre le bot si le problème persiste\n• La diffusion pourrait s'arrêter automatiquement\n\n🤖 L'erreur a été enregistrée dans les logs.`;
        
        addToMemory(senderId, 'assistant', response);
        return response;
    }
};
