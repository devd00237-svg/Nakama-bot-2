/**
 * NakamaBot - Commande /replycomments
 * Répond automatiquement aux commentaires non répondus sur les posts récents de la page via IA.
 * Limité aux 5 derniers posts et commentaires sans réponse de la page.
 * Réservé aux admins.
 * @param {string} senderId - ID de l'utilisateur (doit être admin)
 * @param {string} args - Arguments (non utilisés pour simplicité)
 * @param {object} ctx - Contexte partagé du bot
 */

const axios = require('axios');

const GRAPH_API_VERSION = 'v19.0'; // Version actuelle de l'API Graph
const PAGE_ID = process.env.PAGE_ID; // Ajoutez PAGE_ID dans votre .env (ID de la page Facebook)

module.exports = async function cmdReplyComments(senderId, args, ctx) {
    const { log, callGeminiWithRotation } = ctx;
    const ADMIN_IDS = new Set((process.env.ADMIN_IDS || "").split(",").map(id => id.trim()).filter(id => id));

    // Vérifier si l'utilisateur est admin
    if (!ADMIN_IDS.has(senderId)) {
        log.warning(`⚠️ Accès refusé pour /replycomments par ${senderId}`);
        return "Désolé, cette commande est réservée aux administrateurs ! 💂‍♂️";
    }

    if (!PAGE_ID || !PAGE_ACCESS_TOKEN) {
        log.error('❌ PAGE_ID ou PAGE_ACCESS_TOKEN manquant');
        return "Erreur de configuration : PAGE_ID ou PAGE_ACCESS_TOKEN manquant. 😔";
    }

    try {
        log.info(`🔍 Début de /replycomments par ${senderId}`);

        // Étape 1: Récupérer les 5 derniers posts de la page
        const postsResponse = await axios.get(
            `https://graph.facebook.com/${GRAPH_API_VERSION}/${PAGE_ID}/posts`,
            {
                params: {
                    access_token: PAGE_ACCESS_TOKEN,
                    limit: 5,
                    fields: 'id,message,created_time'
                },
                timeout: 10000
            }
        );

        const posts = postsResponse.data.data || [];
        if (posts.length === 0) {
            return "Aucun post récent trouvé sur la page. 📭";
        }

        let repliesSent = 0;
        let errors = 0;

        // Étape 2: Pour chaque post, récupérer les commentaires
        for (const post of posts) {
            const commentsResponse = await axios.get(
                `https://graph.facebook.com/${GRAPH_API_VERSION}/${post.id}/comments`,
                {
                    params: {
                        access_token: PAGE_ACCESS_TOKEN,
                        limit: 10, // Limite par post pour simplicité
                        fields: 'id,message,from,created_time'
                    },
                    timeout: 10000
                }
            );

            const comments = commentsResponse.data.data || [];

            // Étape 3: Pour chaque commentaire, vérifier s'il a été répondu par la page
            for (const comment of comments) {
                // Ignorer les commentaires de la page elle-même
                if (comment.from && comment.from.id === PAGE_ID) continue;

                // Récupérer les replies au commentaire
                const repliesResponse = await axios.get(
                    `https://graph.facebook.com/${GRAPH_API_VERSION}/${comment.id}/comments`,
                    {
                        params: {
                            access_token: PAGE_ACCESS_TOKEN,
                            fields: 'from'
                        },
                        timeout: 5000
                    }
                );

                const replies = repliesResponse.data.data || [];
                const hasPageReply = replies.some(reply => reply.from && reply.from.id === PAGE_ID);

                if (!hasPageReply && comment.message) {
                    // Étape 4: Générer une réponse via IA (Gemini)
                    const prompt = `Tu es NakamaBot, une IA super gentille et amicale creer par Durand. Génère une réponse courte, positive et engageante à ce commentaire sur notre page Facebook : "${comment.message}". Maximum 100 caractères. Ajoute un emoji si pertinent.`;

                    const aiResponse = await callGeminiWithRotation(prompt);

                    if (aiResponse && aiResponse.trim()) {
                        // Étape 5: Poster la réponse
                        try {
                            await axios.post(
                                `https://graph.facebook.com/${GRAPH_API_VERSION}/${comment.id}/comments`,
                                {
                                    message: aiResponse.trim()
                                },
                                {
                                    params: { access_token: PAGE_ACCESS_TOKEN },
                                    timeout: 5000
                                }
                            );

                            log.info(`✅ Réponse envoyée à commentaire ${comment.id}: ${aiResponse.substring(0, 50)}...`);
                            repliesSent++;
                        } catch (postError) {
                            log.error(`❌ Erreur envoi réponse à ${comment.id}: ${postError.message}`);
                            errors++;
                        }
                    } else {
                        log.warning(`⚠️ Réponse IA vide pour commentaire ${comment.id}`);
                        errors++;
                    }
                }
            }
        }

        const summary = `✅ Opération terminée : ${repliesSent} réponses envoyées, ${errors} erreurs. 📬`;
        log.info(summary);
        return summary;

    } catch (error) {
        log.error(`❌ Erreur /replycomments: ${error.message}`);
        return `Oh non ! Une erreur est survenue : ${error.message}. Réessaie plus tard ? 😔`;
    }
};
