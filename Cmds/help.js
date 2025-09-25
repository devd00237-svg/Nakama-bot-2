/**
 * Commande /help - Affichage de l'aide avec boutons persistants
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande
 * @param {object} ctx - Contexte partagé du bot
 */
module.exports = async function cmdHelp(senderId, args, ctx) {
    const { isAdmin } = ctx;
    
    try {
        const imageUrl = 'https://raw.githubusercontent.com/Durand756/N-B-js/refs/heads/main/Cmds/imgs/HELP-NAKAMA.png';
        await ctx.sendImageMessage(senderId, imageUrl);
    } catch (err) {
        ctx.log.error(`❌ Erreur image: ${err.message}`);
    }

    // Fonction pour envoyer des Quick Replies
    async function sendQuickReplies(recipientId, text, quickReplies) {
        if (!ctx.PAGE_ACCESS_TOKEN) {
            ctx.log.error("❌ PAGE_ACCESS_TOKEN manquant");
            return { success: false };
        }

        const data = {
            recipient: { id: String(recipientId) },
            message: {
                text: text,
                quick_replies: quickReplies
            }
        };

        try {
            const axios = require('axios');
            const response = await axios.post(
                "https://graph.facebook.com/v18.0/me/messages",
                data,
                {
                    params: { access_token: ctx.PAGE_ACCESS_TOKEN },
                    timeout: 15000
                }
            );

            return response.status === 200 ? { success: true } : { success: false };
        } catch (error) {
            ctx.log.error(`❌ Erreur envoi quick replies: ${error.message}`);
            return { success: false };
        }
    }

    await ctx.sleep(300);

    // Envoyer un seul message avec TOUS les boutons principaux
    let helpText = `╔═══════════╗
║ 🤖 NAKAMABOT v5.2║
║ ----------HELP 🤖----------║
╚═══════════╝

✨ COMMANDES PRINCIPALES:
🏠 BASE:
┣━━ "/start" - Ma présentation mignonne
_____________________
┣━━ "/help" - Cette aide pleine d'amour
_____________________
┗━━ "/chat" [msg] - Papote avec gentillesse

🎵 MÉDIA:
┣━━ "/music" - Trouve ta musique YouTube
_____________________
┣━━ "/image" [desc] - Crée des images IA
_____________________
┣━━ "/anime" - Transforme en style anime
_____________________
┗━━ "/vision" - Décris tes images

🐱‍🏍 ADMINS:
┗━━ "/contact" - Envoie un message a un admin
_____________________
⚔️ CLANS:
┗━━ "/clan help" - Univers de guerre virtuelle`;

    if (isAdmin(senderId)) {
        helpText += `
🔐 ADMIN SPÉCIAL:
┣━━ "/stats" - Mes statistiques
_____________________
┣━━ "/admin" - Panneau admin
_____________________
┣━━ "/broadcast" [msg] - Diffusion
_____________________
┣━━ "/stop-broadcast" - Arrête la diffusion
_____________________
┗━━ "/restart" - Redémarrage`;
    }

    helpText += `
════════════════════════
🎨 Images: Envoie ta description !
🎭 Anime: Image + "/anime" !
👁️ Vision: Image + "/vision" !
╰─▸ Créé avec 💕 par Durand
💖 Toujours là pour t'aider ! ✨`;

    // Boutons Quick Reply qui restent visibles
    // IMPORTANT: Le title est ce qui est envoyé comme message !
    const quickReplies = [
        {
            content_type: "text",
            title: "/start",
            payload: "START_CMD"
        },
        {
            content_type: "text",
            title: "/image chat mignon",
            payload: "IMAGE_CMD"
        },
        {
            content_type: "text",
            title: "/anime",
            payload: "ANIME_CMD"
        },
        {
            content_type: "text",
            title: "/vision", 
            payload: "VISION_CMD"
        },
        {
            content_type: "text",
            title: "/rank",
            payload: "RANK_CMD"
        },
        {
            content_type: "text",
            title: "/contact",
            payload: "CONTACT_CMD"
        },
        {
            content_type: "text",
            title: "/clan help",
            payload: "CLAN_CMD"
        }
    ];

    // Ajouter des boutons admin si nécessaire
    if (isAdmin(senderId)) {
        quickReplies.push(
            {
                content_type: "text",
                title: "/stats",
                payload: "STATS_CMD"
            },
            {
                content_type: "text", 
                title: "/admin",
                payload: "ADMIN_CMD"
            },
            {
                content_type: "text", 
                title: "/reply",
                payload: "ADMIN_CMD"
            },
            {
                content_type: "text",
                title: "/broadcast",
                payload: "BROADCAST_CMD"
            }
        );
    }

    // Limiter à 11 boutons maximum (limite Facebook)
    const finalQuickReplies = quickReplies.slice(0, 11);

    // Envoyer LE SEUL ET UNIQUE MESSAGE avec boutons
    const result = await sendQuickReplies(senderId, helpText, finalQuickReplies);

    if (!result.success) {
        // Fallback si les boutons échouent
        return `${helpText}

⚠️ Boutons indisponibles - Tape directement les commandes !`;
    }

    // ✅ IMPORTANT: Ne pas renvoyer de texte pour éviter d'effacer les boutons
    return null;
};
