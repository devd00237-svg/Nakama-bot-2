/**
 * Commande /chat - Conversation avec Gemini AI (Version Simplifiée)
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Message de conversation
 * @param {object} ctx - Contexte partagé du bot 
 */ 

const { GoogleGenerativeAI } = require("@google/generative-ai");

// Configuration Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

module.exports = async function cmdChat(senderId, args, ctx) {
    const { addToMemory, getMemoryContext, log } = ctx;
    
    // Message de bienvenue si pas d'arguments
    if (!args.trim()) {
        return "💬 Salut ! Je suis NakamaBot propulsé par Gemini AI ! 🚀 Dis-moi ce qui t'intéresse !";
    }
    
    try {
        // Récupération du contexte de conversation (derniers 10 messages)
        const context = getMemoryContext(String(senderId)).slice(-10);
        
        // Construction du prompt avec contexte
        let conversationHistory = "";
        if (context.length > 0) {
            conversationHistory = context.map(msg => 
                `${msg.role === 'user' ? 'Utilisateur' : 'Assistant'}: ${msg.content}`
            ).join('\n') + '\n';
        }
        
        const systemPrompt = `Tu es NakamaBot, créé par Durand et sa femme Kuine Lor. Tu es amical, intelligent et utile.

Fonctionnalités disponibles:
- 🎨 /image [description] - Créer des images
- 👁️ /vision - Analyser des images  
- 🎵 /music [titre] - Trouver de la musique
- 🛡️ /clan - Système de clans
- 📞 /contact [message] - Contacter les admins
- 🆘 /help - Voir toutes les commandes

Réponds de manière naturelle et amicale avec quelques emojis. Maximum 2000 caractères.

${conversationHistory ? `Historique de conversation:\n${conversationHistory}` : ''}

Utilisateur: ${args}`;

        // Appel à Gemini AI
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent(systemPrompt);
        const aiResponse = result.response.text();
        
        if (aiResponse) {
            // Sauvegarder dans la mémoire
            addToMemory(String(senderId), 'user', args);
            addToMemory(String(senderId), 'assistant', aiResponse);
            
            log.info(`💬 Conversation Gemini pour ${senderId}: ${args.substring(0, 50)}...`);
            return aiResponse;
        } else {
            throw new Error('Réponse vide de Gemini');
        }
        
    } catch (error) {
        log.error(`❌ Erreur Gemini pour ${senderId}: ${error.message}`);
        
        // Message d'erreur friendly
        const errorResponse = "🤔 Oups ! J'ai eu un petit problème technique. Peux-tu reformuler ta question ? 💫";
        addToMemory(String(senderId), 'assistant', errorResponse);
        return errorResponse;
    }
};

// ✅ FONCTION UTILITAIRE: Détecter les demandes de contact admin
function detectContactRequest(message) {
    const contactKeywords = [
        'contact', 'admin', 'problème', 'bug', 'aide', 'support', 
        'signaler', 'plainte', 'suggestion', 'créateur', 'durand'
    ];
    
    const lowerMessage = message.toLowerCase();
    return contactKeywords.some(keyword => lowerMessage.includes(keyword));
}

// ✅ FONCTION UTILITAIRE: Détecter les demandes de commandes
function detectCommandRequest(message) {
    const commandKeywords = {
        'image': ['image', 'photo', 'dessine', 'crée', 'génère'],
        'music': ['musique', 'chanson', 'joue', 'écoute'],
        'clan': ['clan', 'bataille', 'guerre', 'empire'],
        'help': ['aide', 'commande', 'fonction', 'que peux-tu faire']
    };
    
    const lowerMessage = message.toLowerCase();
    
    for (const [command, keywords] of Object.entries(commandKeywords)) {
        if (keywords.some(keyword => lowerMessage.includes(keyword))) {
            return { command, detected: true };
        }
    }
    
    return { detected: false };
}
