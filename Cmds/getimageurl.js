// Cmds/getimageurl.js
// Commande pour récupérer l'URL d'une image envoyée

module.exports = async function(senderId, args, context) {
    const { addToMemory, log, getLastMessage } = context;

    try {
        // Récupérer le dernier message de l'utilisateur
        const lastMessage = getLastMessage ? getLastMessage(senderId) : null;
        
        if (!lastMessage || !lastMessage.attachments || lastMessage.attachments.length === 0) {
            const response = `📸 **Récupération d'URL d'image**\n\n📌 **Usage :** Envoie une image puis tape \`/getimageurl\`\n💡 **Astuce :** Tu peux aussi répondre à un message contenant une image avec cette commande\n\n🔍 Je vais extraire l'URL de l'image que tu as envoyée.`;
            addToMemory(senderId, 'user', '/getimageurl');
            addToMemory(senderId, 'assistant', response);
            return response;
        }

        // Chercher les images dans les attachments
        const imageAttachments = lastMessage.attachments.filter(att => 
            att.type === 'image' || att.mimeType?.startsWith('image/')
        );

        if (imageAttachments.length === 0) {
            const response = `❌ **Aucune image trouvée !**\n\n📌 Envoie d'abord une image, puis utilise \`/getimageurl\`\n💡 Ou réponds à un message contenant une image.`;
            addToMemory(senderId, 'user', '/getimageurl');
            addToMemory(senderId, 'assistant', response);
            return response;
        }

        // Construire la réponse avec les URLs
        let response = `📸 **URL(s) d'image(s) récupérée(s) :**\n\n`;
        
        imageAttachments.forEach((attachment, index) => {
            const imageUrl = attachment.url || attachment.payload?.url;
            if (imageUrl) {
                response += `**Image ${index + 1} :**\n`;
                response += `🔗 **URL :** ${imageUrl}\n`;
                
                if (attachment.mimeType) {
                    response += `📄 **Type :** ${attachment.mimeType}\n`;
                }
                
                if (attachment.name) {
                    response += `📛 **Nom :** ${attachment.name}\n`;
                }
                
                response += `📏 **Taille :** ${attachment.size ? formatFileSize(attachment.size) : 'Inconnue'}\n\n`;
            }
        });

        response += `💡 **Utilisation :**\n`;
        response += `• Copie cette URL pour la réutiliser\n`;
        response += `• Utilise \`/broadcast image [url] [message]\` pour diffuser\n`;
        response += `• Partage l'URL avec d'autres commandes\n`;

        addToMemory(senderId, 'user', '/getimageurl');
        addToMemory(senderId, 'assistant', `URL image récupérée: ${imageAttachments.length} image(s)`);

        return response;

    } catch (error) {
        log.error(`Erreur getimageurl: ${error.message}`);
        const errorResponse = `❌ **Erreur lors de la récupération !**\n\n${error.message}\n\n📌 Assure-toi d'avoir envoyé une image récemment.`;
        addToMemory(senderId, 'assistant', errorResponse);
        return errorResponse;
    }
};

// Fonction pour formater la taille du fichier
function formatFileSize(bytes) {
    if (!bytes) return 'Inconnue';
    
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    
    const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}
