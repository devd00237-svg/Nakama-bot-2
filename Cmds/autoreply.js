/**
 * NakamaBot - Commande Admin /autoreply
 * Répond automatiquement aux commentaires non répondus sur la page Facebook
 * avec l'IA (Gemini + Mistral) en respectant les restrictions Facebook
 * 
 * Usage: /autoreply [start|stop|status|config]
 * @param {string} senderId - ID de l'administrateur
 * @param {string} args - Arguments de la commande
 * @param {object} ctx - Contexte partagé du bot
 */

const axios = require('axios');

// ========================================
// 🔧 CONFIGURATION
// ========================================

const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const PAGE_ID = process.env.PAGE_ID;

// Configuration Auto-Reply
const AUTO_REPLY_CONFIG = {
    enabled: false,
    intervalMinutes: 10, // Vérifier toutes les 10 minutes
    maxCommentsPerRun: 5, // Maximum 5 commentaires par run
    responseDelay: 3000, // 3 secondes entre chaque réponse
    maxCommentAge: 24, // Répondre aux commentaires de max 24h
    skipIfReplied: true, // Skip si déjà une réponse
    personality: 'friendly', // friendly, professional, enthusiastic
};

// État global
let autoReplyInterval = null;
const processedComments = new Set();
const PROCESSED_CACHE_TTL = 86400000; // 24 heures

// Restrictions Facebook à respecter
const FACEBOOK_RESTRICTIONS = {
    maxMessageLength: 8000, // Facebook limite à 8000 chars
    rateLimit: {
        commentsPerHour: 100, // Limite safe
        repliesPerMinute: 10
    },
    bannedContent: [
        'spam', 'porn', 'hate', 'violence', 'illegal',
        'scam', 'phishing', 'malware'
    ],
    requiredCompliance: true
};

// ========================================
// 🔐 VÉRIFICATION ADMIN
// ========================================

function isAdmin(senderId) {
    return ADMIN_IDS.includes(String(senderId));
}

// ========================================
// 📊 RÉCUPÉRATION COMMENTAIRES NON RÉPONDUS
// ========================================

async function getUnrepliedComments(log) {
    try {
        if (!PAGE_ACCESS_TOKEN || !PAGE_ID) {
            throw new Error('PAGE_ACCESS_TOKEN ou PAGE_ID non configuré');
        }

        // Récupérer les posts récents de la page
        const postsResponse = await axios.get(
            `https://graph.facebook.com/v21.0/${PAGE_ID}/posts`,
            {
                params: {
                    access_token: PAGE_ACCESS_TOKEN,
                    fields: 'id,message,created_time',
                    limit: 10 // 10 posts les plus récents
                }
            }
        );

        if (!postsResponse.data.data || postsResponse.data.data.length === 0) {
            log.info('📭 Aucun post récent trouvé');
            return [];
        }

        const unrepliedComments = [];
        const now = Date.now();
        const maxAge = AUTO_REPLY_CONFIG.maxCommentAge * 3600000; // Heures en ms

        // Pour chaque post, récupérer les commentaires
        for (const post of postsResponse.data.data) {
            try {
                const commentsResponse = await axios.get(
                    `https://graph.facebook.com/v21.0/${post.id}/comments`,
                    {
                        params: {
                            access_token: PAGE_ACCESS_TOKEN,
                            fields: 'id,from,message,created_time,comment_count',
                            limit: 50,
                            filter: 'stream' // Tous les commentaires
                        }
                    }
                );

                if (commentsResponse.data.data) {
                    for (const comment of commentsResponse.data.data) {
                        const commentAge = now - new Date(comment.created_time).getTime();
                        
                        // Filtres
                        if (commentAge > maxAge) continue; // Trop vieux
                        if (processedComments.has(comment.id)) continue; // Déjà traité
                        if (comment.from.id === PAGE_ID) continue; // C'est la page elle-même
                        
                        // Vérifier si déjà une réponse
                        if (AUTO_REPLY_CONFIG.skipIfReplied && comment.comment_count > 0) {
                            continue;
                        }

                        unrepliedComments.push({
                            id: comment.id,
                            postId: post.id,
                            postMessage: post.message || '',
                            from: comment.from,
                            message: comment.message,
                            createdTime: comment.created_time,
                            age: commentAge
                        });
                    }
                }

                // Petit délai entre chaque post pour éviter rate limit
                await new Promise(resolve => setTimeout(resolve, 500));

            } catch (error) {
                log.warning(`⚠️ Erreur récupération commentaires post ${post.id}: ${error.message}`);
            }
        }

        log.info(`📊 ${unrepliedComments.length} commentaires non répondus trouvés`);
        return unrepliedComments.slice(0, AUTO_REPLY_CONFIG.maxCommentsPerRun);

    } catch (error) {
        log.error(`❌ Erreur getUnrepliedComments: ${error.message}`);
        return [];
    }
}

// ========================================
// 🤖 GÉNÉRATION RÉPONSE IA
// ========================================

async function generateAIReply(comment, ctx) {
    const { log, callMistralAPI } = ctx;
    const { callGeminiWithRotation, checkIfAllGeminiKeysDead } = require('./chat');

    try {
        const personalityPrompts = {
            friendly: "Tu es une IA sympathique et chaleureuse qui représente NakamaBot. Ton ton est amical et positif.",
            professional: "Tu es une IA professionnelle qui représente NakamaBot. Ton ton est courtois et informatif.",
            enthusiastic: "Tu es une IA enthousiaste qui représente NakamaBot. Ton ton est dynamique et encourageant."
        };

        const personality = personalityPrompts[AUTO_REPLY_CONFIG.personality] || personalityPrompts.friendly;

        const prompt = `${personality}

CONTEXTE POST:
"${comment.postMessage.substring(0, 300)}"

COMMENTAIRE DE ${comment.from.name}:
"${comment.message}"

INSTRUCTIONS CRITIQUES:
✅ Réponds au commentaire de manière naturelle et pertinente
✅ Sois concis (max 500 caractères)
✅ Utilise quelques emojis avec parcimonie
✅ Adapte-toi au ton du commentaire
✅ Si c'est une question, réponds directement
✅ Si c'est un compliment, remercie chaleureusement
✅ Si c'est une critique constructive, montre de l'empathy
✅ NE mentionne JAMAIS que tu es une IA ou un bot
✅ NE parle PAS de recherches ou sources

❌ RESTRICTIONS FACEBOOK (TRÈS IMPORTANT):
- AUCUN contenu spam, haineux, violent, sexuel, illégal
- AUCUN lien suspect ou non autorisé
- AUCUNE demande d'informations personnelles
- AUCUN contenu commercial agressif
- AUCUNE désinformation

Si le commentaire est inapproprié, réponds: "Merci pour ton commentaire ! 💫"

RÉPONSE NATURELLE (max 500 chars):`;

        let response;

        // Essayer Gemini d'abord
        if (!checkIfAllGeminiKeysDead()) {
            try {
                response = await callGeminiWithRotation(prompt);
                log.info(`💎 Réponse générée via Gemini`);
            } catch (geminiError) {
                log.warning(`⚠️ Gemini échec: ${geminiError.message}`);
            }
        }

        // Fallback Mistral
        if (!response) {
            const messages = [
                { role: "system", content: personality },
                { role: "user", content: prompt }
            ];
            response = await callMistralAPI(messages, 500, 0.7);
            log.info(`🔄 Réponse générée via Mistral`);
        }

        if (!response) {
            throw new Error('Aucune IA disponible');
        }

        // Nettoyage et validation
        let cleanResponse = response.trim();
        
        // Limiter à 500 caractères pour sécurité
        if (cleanResponse.length > 500) {
            cleanResponse = cleanResponse.substring(0, 497) + '...';
        }

        // Vérifier contenu banni
        const lowerResponse = cleanResponse.toLowerCase();
        for (const banned of FACEBOOK_RESTRICTIONS.bannedContent) {
            if (lowerResponse.includes(banned)) {
                log.warning(`⚠️ Contenu banni détecté: ${banned}`);
                return "Merci pour ton commentaire ! 💫";
            }
        }

        return cleanResponse;

    } catch (error) {
        log.error(`❌ Erreur generateAIReply: ${error.message}`);
        return "Merci pour ton commentaire ! 💫";
    }
}

// ========================================
// 📤 ENVOI RÉPONSE FACEBOOK
// ========================================

async function postReplyToComment(commentId, replyMessage, log) {
    try {
        if (!PAGE_ACCESS_TOKEN) {
            throw new Error('PAGE_ACCESS_TOKEN non configuré');
        }

        // Vérifier longueur
        if (replyMessage.length > FACEBOOK_RESTRICTIONS.maxMessageLength) {
            replyMessage = replyMessage.substring(0, FACEBOOK_RESTRICTIONS.maxMessageLength - 3) + '...';
        }

        const response = await axios.post(
            `https://graph.facebook.com/v21.0/${commentId}/comments`,
            {
                message: replyMessage
            },
            {
                params: {
                    access_token: PAGE_ACCESS_TOKEN
                }
            }
        );

        if (response.data && response.data.id) {
            log.info(`✅ Réponse postée avec succès: ${response.data.id}`);
            processedComments.add(commentId);
            return { success: true, replyId: response.data.id };
        }

        throw new Error('Réponse invalide de Facebook');

    } catch (error) {
        if (error.response) {
            log.error(`❌ Erreur Facebook API: ${error.response.data.error?.message || error.message}`);
        } else {
            log.error(`❌ Erreur postReply: ${error.message}`);
        }
        return { success: false, error: error.message };
    }
}

// ========================================
// 🔄 PROCESSUS AUTO-REPLY
// ========================================

async function runAutoReplyProcess(ctx) {
    const { log } = ctx;

    try {
        log.info(`🤖 Démarrage processus auto-reply...`);

        const unrepliedComments = await getUnrepliedComments(log);

        if (unrepliedComments.length === 0) {
            log.info(`✅ Aucun commentaire à traiter`);
            return { processed: 0, success: 0, errors: 0 };
        }

        let successCount = 0;
        let errorCount = 0;

        for (const comment of unrepliedComments) {
            try {
                log.info(`💬 Traitement commentaire de ${comment.from.name}: "${comment.message.substring(0, 50)}..."`);

                // Générer réponse IA
                const aiReply = await generateAIReply(comment, ctx);
                
                log.info(`🤖 Réponse générée: "${aiReply.substring(0, 50)}..."`);

                // Poster la réponse
                const result = await postReplyToComment(comment.id, aiReply, log);

                if (result.success) {
                    successCount++;
                    log.info(`✅ Réponse postée avec succès`);
                } else {
                    errorCount++;
                    log.error(`❌ Échec post réponse`);
                }

                // Délai entre chaque réponse pour respecter rate limit
                await new Promise(resolve => setTimeout(resolve, AUTO_REPLY_CONFIG.responseDelay));

            } catch (error) {
                errorCount++;
                log.error(`❌ Erreur traitement commentaire ${comment.id}: ${error.message}`);
            }
        }

        log.info(`📊 Processus terminé: ${successCount} succès, ${errorCount} erreurs`);

        return {
            processed: unrepliedComments.length,
            success: successCount,
            errors: errorCount
        };

    } catch (error) {
        log.error(`❌ Erreur critique runAutoReplyProcess: ${error.message}`);
        return { processed: 0, success: 0, errors: 1 };
    }
}

// ========================================
// 🎛️ GESTION AUTO-REPLY
// ========================================

function startAutoReply(ctx) {
    const { log } = ctx;

    if (autoReplyInterval) {
        return { success: false, message: "Auto-reply déjà actif" };
    }

    AUTO_REPLY_CONFIG.enabled = true;

    // Exécution immédiate
    runAutoReplyProcess(ctx);

    // Puis toutes les X minutes
    autoReplyInterval = setInterval(() => {
        runAutoReplyProcess(ctx);
    }, AUTO_REPLY_CONFIG.intervalMinutes * 60000);

    log.info(`✅ Auto-reply démarré (intervalle: ${AUTO_REPLY_CONFIG.intervalMinutes} min)`);

    return {
        success: true,
        message: `🤖 Auto-reply activé !\n\n⏱️ Intervalle: ${AUTO_REPLY_CONFIG.intervalMinutes} minutes\n📊 Max commentaires/run: ${AUTO_REPLY_CONFIG.maxCommentsPerRun}\n🎭 Personnalité: ${AUTO_REPLY_CONFIG.personality}`
    };
}

function stopAutoReply(log) {
    if (!autoReplyInterval) {
        return { success: false, message: "Auto-reply déjà inactif" };
    }

    clearInterval(autoReplyInterval);
    autoReplyInterval = null;
    AUTO_REPLY_CONFIG.enabled = false;

    log.info(`🛑 Auto-reply arrêté`);

    return {
        success: true,
        message: "🛑 Auto-reply désactivé avec succès"
    };
}

function getAutoReplyStatus() {
    return {
        enabled: AUTO_REPLY_CONFIG.enabled,
        intervalMinutes: AUTO_REPLY_CONFIG.intervalMinutes,
        maxCommentsPerRun: AUTO_REPLY_CONFIG.maxCommentsPerRun,
        personality: AUTO_REPLY_CONFIG.personality,
        processedCount: processedComments.size
    };
}

// ========================================
// 🛡️ COMMANDE PRINCIPALE
// ========================================

module.exports = async function cmdAutoReply(senderId, args, ctx) {
    const { log, sendMessage } = ctx;

    // Vérification admin
    if (!isAdmin(senderId)) {
        log.warning(`🚫 Accès refusé pour ${senderId} (non admin)`);
        return "🚫 Cette commande est réservée aux administrateurs.";
    }

    const command = args.trim().toLowerCase().split(' ')[0] || 'status';

    try {
        switch (command) {
            case 'start': {
                const result = startAutoReply(ctx);
                return result.message;
            }

            case 'stop': {
                const result = stopAutoReply(log);
                return result.message;
            }

            case 'status': {
                const status = getAutoReplyStatus();
                return `📊 𝗦𝘁𝗮𝘁𝘂𝘁 𝗔𝘂𝘁𝗼-𝗥𝗲𝗽𝗹𝘆

${status.enabled ? '✅ 𝗔𝗖𝗧𝗜𝗙' : '🛑 𝗜𝗡𝗔𝗖𝗧𝗜𝗙'}

⚙️ 𝗖𝗼𝗻𝗳𝗶𝗴𝘂𝗿𝗮𝘁𝗶𝗼𝗻:
• Intervalle: ${status.intervalMinutes} minutes
• Max commentaires/run: ${status.maxCommentsPerRun}
• Personnalité: ${status.personality}
• Commentaires traités: ${status.processedCount}

🎮 𝗖𝗼𝗺𝗺𝗮𝗻𝗱𝗲𝘀:
• /autoreply start - Démarrer
• /autoreply stop - Arrêter
• /autoreply config - Configuration
• /autoreply test - Test manuel

📋 𝗥𝗲𝘀𝘁𝗿𝗶𝗰𝘁𝗶𝗼𝗻𝘀 𝗙𝗮𝗰𝗲𝗯𝗼𝗼𝗸:
✅ Conforme API Facebook
✅ Rate limiting respecté
✅ Contenu filtré`;
            }

            case 'config': {
                return `⚙️ 𝗖𝗼𝗻𝗳𝗶𝗴𝘂𝗿𝗮𝘁𝗶𝗼𝗻 𝗔𝘂𝘁𝗼-𝗥𝗲𝗽𝗹𝘆

📊 𝗣𝗮𝗿𝗮𝗺è𝘁𝗿𝗲𝘀:
• intervalMinutes: ${AUTO_REPLY_CONFIG.intervalMinutes}
• maxCommentsPerRun: ${AUTO_REPLY_CONFIG.maxCommentsPerRun}
• responseDelay: ${AUTO_REPLY_CONFIG.responseDelay}ms
• maxCommentAge: ${AUTO_REPLY_CONFIG.maxCommentAge}h
• personality: ${AUTO_REPLY_CONFIG.personality}

🎭 𝗣𝗲𝗿𝘀𝗼𝗻𝗻𝗮𝗹𝗶𝘁é𝘀 𝗱𝗶𝘀𝗽𝗼𝗻𝗶𝗯𝗹𝗲𝘀:
• friendly (par défaut)
• professional
• enthusiastic

🔧 Pour modifier: éditer AUTO_REPLY_CONFIG dans le code`;
            }

            case 'test': {
                log.info(`🧪 Test manuel auto-reply par ${senderId}`);
                await sendMessage(senderId, "🧪 Test en cours...");
                
                const result = await runAutoReplyProcess(ctx);
                
                return `🧪 𝗧𝗲𝘀𝘁 𝗧𝗲𝗿𝗺𝗶𝗻é

📊 𝗥é𝘀𝘂𝗹𝘁𝗮𝘁𝘀:
• Commentaires traités: ${result.processed}
• Succès: ${result.success}
• Erreurs: ${result.errors}

${result.success > 0 ? '✅ Auto-reply fonctionne !' : '⚠️ Aucun commentaire traité'}`;
            }

            default: {
                return `🤖 𝗔𝘂𝘁𝗼-𝗥𝗲𝗽𝗹𝘆 - 𝗔𝗱𝗺𝗶𝗻

Répond automatiquement aux commentaires non répondus sur la page Facebook.

🎮 𝗖𝗼𝗺𝗺𝗮𝗻𝗱𝗲𝘀:
• /autoreply start - Activer auto-reply
• /autoreply stop - Désactiver auto-reply
• /autoreply status - Voir le statut
• /autoreply config - Voir la config
• /autoreply test - Test manuel

✨ 𝗙𝗼𝗻𝗰𝘁𝗶𝗼𝗻𝗻𝗮𝗹𝗶𝘁é𝘀:
✅ Réponses IA intelligentes (Gemini + Mistral)
✅ Filtrage contenu inapproprié
✅ Respect rate limits Facebook
✅ Personnalités adaptables
✅ Historique des commentaires traités

⚠️ Nécessite: PAGE_ACCESS_TOKEN et PAGE_ID configurés`;
            }
        }

    } catch (error) {
        log.error(`❌ Erreur cmdAutoReply: ${error.message}`);
        return `❌ Erreur: ${error.message}`;
    }
};

// ========================================
// 🧹 NETTOYAGE PÉRIODIQUE
// ========================================

// Nettoyer le cache toutes les 24h
setInterval(() => {
    const now = Date.now();
    processedComments.forEach(commentId => {
        // Supprimer les commentaires traités il y a plus de 24h
        // Note: Idéalement, stocker avec timestamp pour nettoyage précis
        if (processedComments.size > 1000) {
            processedComments.clear();
        }
    });
}, 86400000); // 24 heures

// ========================================
// 📤 EXPORTS
// ========================================

module.exports.startAutoReply = startAutoReply;
module.exports.stopAutoReply = stopAutoReply;
module.exports.getAutoReplyStatus = getAutoReplyStatus;
module.exports.runAutoReplyProcess = runAutoReplyProcess;
module.exports.AUTO_REPLY_CONFIG = AUTO_REPLY_CONFIG;
