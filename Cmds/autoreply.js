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
    maxCommentAge: 72, // Répondre aux commentaires de max 72h (augmenté)
    skipIfReplied: true, // Skip si déjà une réponse
    personality: 'friendly', // friendly, professional, enthusiastic
    maxPostsToCheck: 20, // Vérifier les 20 derniers posts (augmenté)
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
// 🔍 DÉTECTION PAGE ID RÉEL
// ========================================

async function getRealPageId(log) {
    try {
        if (!PAGE_ACCESS_TOKEN) {
            throw new Error('PAGE_ACCESS_TOKEN non configuré');
        }

        // Méthode 1: Utiliser /me pour obtenir les infos de la page
        try {
            const meResponse = await axios.get(
                'https://graph.facebook.com/v21.0/me',
                {
                    params: {
                        access_token: PAGE_ACCESS_TOKEN,
                        fields: 'id,name,username'
                    }
                }
            );

            if (meResponse.data && meResponse.data.id) {
                log.info(`✅ Page détectée: ${meResponse.data.name} (ID: ${meResponse.data.id})`);
                return meResponse.data.id;
            }
        } catch (error) {
            log.warning(`⚠️ Méthode /me échouée: ${error.message}`);
        }

        // Méthode 2: Utiliser le PAGE_ID configuré si fourni
        if (PAGE_ID) {
            log.info(`📌 Utilisation PAGE_ID configuré: ${PAGE_ID}`);
            return PAGE_ID;
        }

        throw new Error('Impossible de déterminer le PAGE_ID');

    } catch (error) {
        log.error(`❌ Erreur getRealPageId: ${error.message}`);
        throw error;
    }
}

// ========================================
// 📊 RÉCUPÉRATION COMMENTAIRES NON RÉPONDUS
// ========================================

async function getUnrepliedComments(log) {
    try {
        if (!PAGE_ACCESS_TOKEN) {
            throw new Error('PAGE_ACCESS_TOKEN non configuré');
        }

        // Déterminer le vrai PAGE_ID
        const realPageId = await getRealPageId(log);

        // Récupérer les posts récents de la page avec le bon ID
        const postsResponse = await axios.get(
            `https://graph.facebook.com/v21.0/${realPageId}/posts`,
            {
                params: {
                    access_token: PAGE_ACCESS_TOKEN,
                    fields: 'id,message,created_time,type',
                    limit: AUTO_REPLY_CONFIG.maxPostsToCheck
                },
                timeout: 10000
            }
        );

        if (!postsResponse.data.data || postsResponse.data.data.length === 0) {
            log.info('📭 Aucun post récent trouvé');
            return [];
        }

        log.info(`📝 ${postsResponse.data.data.length} posts trouvés`);

        const unrepliedComments = [];
        const now = Date.now();
        const maxAge = AUTO_REPLY_CONFIG.maxCommentAge * 3600000; // Heures en ms

        let accessiblePosts = 0;
        let postsWithComments = 0;
        let totalCommentsFound = 0;

        // Pour chaque post, récupérer les commentaires
        for (const post of postsResponse.data.data) {
            try {
                const postAge = now - new Date(post.created_time).getTime();
                const postAgeHours = Math.round(postAge / 3600000);
                
                log.debug(`🔍 Post: ${post.id.split('_')[1]} | Type: ${post.type || 'unknown'} | Âge: ${postAgeHours}h`);
                
                const commentsResponse = await axios.get(
                    `https://graph.facebook.com/v21.0/${post.id}/comments`,
                    {
                        params: {
                            access_token: PAGE_ACCESS_TOKEN,
                            fields: 'id,from,message,created_time,comment_count',
                            limit: 100, // Augmenté à 100
                            filter: 'stream'
                        },
                        timeout: 10000
                    }
                );

                accessiblePosts++;

                if (commentsResponse.data.data && commentsResponse.data.data.length > 0) {
                    postsWithComments++;
                    totalCommentsFound += commentsResponse.data.data.length;
                    
                    log.info(`💬 ${commentsResponse.data.data.length} commentaire(s) sur post ${post.id.split('_')[1]}`);
                    
                    for (const comment of commentsResponse.data.data) {
                        const commentAge = now - new Date(comment.created_time).getTime();
                        const commentAgeHours = Math.round(commentAge / 3600000);
                        
                        log.debug(`  📝 Commentaire ${comment.id}: "${comment.message.substring(0, 30)}..." | De: ${comment.from.name} | Âge: ${commentAgeHours}h | Réponses: ${comment.comment_count}`);
                        
                        // Filtres
                        if (commentAge > maxAge) {
                            log.debug(`  ⏰ Trop vieux (${commentAgeHours}h > ${AUTO_REPLY_CONFIG.maxCommentAge}h)`);
                            continue;
                        }
                        if (processedComments.has(comment.id)) {
                            log.debug(`  ✅ Déjà traité`);
                            continue;
                        }
                        if (comment.from.id === realPageId) {
                            log.debug(`  🏠 Commentaire de la page`);
                            continue;
                        }
                        
                        // Vérifier si déjà une réponse
                        if (AUTO_REPLY_CONFIG.skipIfReplied && comment.comment_count > 0) {
                            log.debug(`  💬 Déjà répondu (${comment.comment_count} réponse(s))`);
                            continue;
                        }

                        log.info(`  ✨ Commentaire éligible: "${comment.message.substring(0, 50)}..." de ${comment.from.name}`);

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
                } else {
                    log.debug(`📭 Aucun commentaire sur ce post`);
                }

                // Délai entre chaque post
                await new Promise(resolve => setTimeout(resolve, 1000));

            } catch (error) {
                if (error.response && error.response.status === 403) {
                    log.debug(`🔒 Post ${post.id.split('_')[1]} inaccessible (403) - Type: ${post.type || 'unknown'}`);
                } else {
                    log.warning(`⚠️ Erreur post ${post.id}: ${error.message}`);
                }
            }
        }

        log.info(`📊 Résumé: ${accessiblePosts}/${postsResponse.data.data.length} posts accessibles | ${postsWithComments} avec commentaires | ${totalCommentsFound} commentaires totaux | ${unrepliedComments.length} éligibles`);
        
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
                
                // Vérifier la page
                let pageInfo = "Non détecté";
                try {
                    const pageId = await getRealPageId(log);
                    const pageResponse = await axios.get(
                        `https://graph.facebook.com/v21.0/${pageId}`,
                        {
                            params: {
                                access_token: PAGE_ACCESS_TOKEN,
                                fields: 'id,name,username'
                            }
                        }
                    );
                    if (pageResponse.data) {
                        pageInfo = `${pageResponse.data.name} (${pageResponse.data.id})`;
                    }
                } catch (error) {
                    pageInfo = `Erreur: ${error.message}`;
                }

                return `📊 𝗦𝘁𝗮𝘁𝘂𝘁 𝗔𝘂𝘁𝗼-𝗥𝗲𝗽𝗹𝘆

${status.enabled ? '✅ 𝗔𝗖𝗧𝗜𝗙' : '🛑 𝗜𝗡𝗔𝗖𝗧𝗜𝗙'}

📄 𝗣𝗮𝗴𝗲: ${pageInfo}

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

            case 'debug': {
                log.info(`🔍 Diagnostic auto-reply par ${senderId}`);
                await sendMessage(senderId, "🔍 Diagnostic en cours...");
                
                let diagnostic = "🔍 𝗗𝗶𝗮𝗴𝗻𝗼𝘀𝘁𝗶𝗰 𝗔𝘂𝘁𝗼-𝗥𝗲𝗽𝗹𝘆\n\n";
                
                // 1. Vérifier PAGE_ACCESS_TOKEN
                if (!PAGE_ACCESS_TOKEN) {
                    diagnostic += "❌ PAGE_ACCESS_TOKEN: Non configuré\n";
                } else {
                    diagnostic += `✅ PAGE_ACCESS_TOKEN: Configuré (${PAGE_ACCESS_TOKEN.substring(0, 20)}...)\n`;
                }
                
                // 2. Vérifier PAGE_ID
                if (PAGE_ID) {
                    diagnostic += `📋 PAGE_ID env: ${PAGE_ID}\n`;
                } else {
                    diagnostic += "⚠️ PAGE_ID env: Non configuré (sera auto-détecté)\n";
                }
                
                // 3. Détecter le vrai PAGE_ID
                try {
                    const realPageId = await getRealPageId(log);
                    diagnostic += `✅ PAGE_ID détecté: ${realPageId}\n`;
                    
                    // 4. Tester accès à la page
                    try {
                        const pageResponse = await axios.get(
                            `https://graph.facebook.com/v21.0/${realPageId}`,
                            {
                                params: {
                                    access_token: PAGE_ACCESS_TOKEN,
                                    fields: 'id,name,username,access_token'
                                },
                                timeout: 10000
                            }
                        );
                        
                        diagnostic += `✅ Accès page: OK\n`;
                        diagnostic += `📄 Nom page: ${pageResponse.data.name}\n`;
                        if (pageResponse.data.username) {
                            diagnostic += `🔗 Username: @${pageResponse.data.username}\n`;
                        }
                    } catch (error) {
                        diagnostic += `❌ Accès page: ${error.message}\n`;
                    }
                    
                    // 5. Tester accès aux posts
                    try {
                        const postsResponse = await axios.get(
                            `https://graph.facebook.com/v21.0/${realPageId}/posts`,
                            {
                                params: {
                                    access_token: PAGE_ACCESS_TOKEN,
                                    fields: 'id,message,created_time',
                                    limit: 5
                                },
                                timeout: 10000
                            }
                        );
                        
                        const postsCount = postsResponse.data.data ? postsResponse.data.data.length : 0;
                        diagnostic += `✅ Accès posts: OK (${postsCount} posts récents)\n`;
                        
                        if (postsCount > 0) {
                            // 6. Tester accès aux commentaires du premier post
                            const firstPost = postsResponse.data.data[0];
                            try {
                                const commentsResponse = await axios.get(
                                    `https://graph.facebook.com/v21.0/${firstPost.id}/comments`,
                                    {
                                        params: {
                                            access_token: PAGE_ACCESS_TOKEN,
                                            fields: 'id,from,message',
                                            limit: 5
                                        },
                                        timeout: 10000
                                    }
                                );
                                
                                const commentsCount = commentsResponse.data.data ? commentsResponse.data.data.length : 0;
                                diagnostic += `✅ Accès commentaires: OK (${commentsCount} commentaires sur 1er post)\n`;
                                
                                if (commentsCount > 0) {
                                    diagnostic += `\n💬 𝗘𝘅𝗲𝗺𝗽𝗹𝗲 𝗰𝗼𝗺𝗺𝗲𝗻𝘁𝗮𝗶𝗿𝗲:\n`;
                                    const firstComment = commentsResponse.data.data[0];
                                    diagnostic += `• De: ${firstComment.from.name}\n`;
                                    diagnostic += `• Message: ${firstComment.message.substring(0, 50)}...\n`;
                                }
                            } catch (error) {
                                if (error.response && error.response.status === 403) {
                                    diagnostic += `⚠️ Accès commentaires: Refusé (403) - Permissions insuffisantes\n`;
                                    diagnostic += `💡 Vérifiez les permissions du token:\n`;
                                    diagnostic += `   • pages_read_engagement\n`;
                                    diagnostic += `   • pages_manage_posts\n`;
                                    diagnostic += `   • pages_read_user_content\n`;
                                } else {
                                    diagnostic += `❌ Accès commentaires: ${error.message}\n`;
                                }
                            }
                        } else {
                            diagnostic += `📭 Aucun post récent sur la page\n`;
                        }
                    } catch (error) {
                        diagnostic += `❌ Accès posts: ${error.message}\n`;
                    }
                    
                } catch (error) {
                    diagnostic += `❌ Détection PAGE_ID: ${error.message}\n`;
                }
                
                // 7. Vérifier les permissions du token
                diagnostic += `\n🔐 𝗣𝗲𝗿𝗺𝗶𝘀𝘀𝗶𝗼𝗻𝘀 𝗿𝗲𝗾𝘂𝗶𝘀𝗲𝘀:\n`;
                diagnostic += `• pages_read_engagement ✓\n`;
                diagnostic += `• pages_manage_posts ✓\n`;
                diagnostic += `• pages_read_user_content ✓\n`;
                diagnostic += `\n💡 Si erreur 403: Regénérez le token avec ces permissions sur developers.facebook.com`;
                
                return diagnostic;
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
• /autoreply debug - Diagnostic complet

✨ 𝗙𝗼𝗻𝗰𝘁𝗶𝗼𝗻𝗻𝗮𝗹𝗶𝘁é𝘀:
✅ Réponses IA intelligentes (Gemini + Mistral)
✅ Détection automatique de la page
✅ Filtrage contenu inapproprié
✅ Respect rate limits Facebook
✅ Personnalités adaptables
✅ Historique des commentaires traités

⚠️ Nécessite: PAGE_ACCESS_TOKEN configuré
📝 PAGE_ID optionnel (auto-détecté)`;
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
module.exports.getRealPageId = getRealPageId;
module.exports.AUTO_REPLY_CONFIG = AUTO_REPLY_CONFIG;
