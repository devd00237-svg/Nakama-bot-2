/**
 * Commande /echecs - Jeu d'échecs contre le bot dans Messenger
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande
 * @param {object} ctx - Contexte partagé du bot
 */

const { Chess } = require('chess.js');

// ✅ État des parties d'échecs par utilisateur
const chessGames = new Map();

// ✅ États possibles d'une partie
const GameState = {
    AWAITING_STARTER: 'awaiting_starter',
    PLAYING: 'playing',
    FINISHED: 'finished'
};

// ✅ Protection anti-spam
const userActionLocks = new Map();
const COOLDOWN_MS = 2000; // 2 secondes entre chaque action

module.exports = async function cmdEchecs(senderId, args, ctx) {
    const { log, addToMemory, sleep } = ctx;
    const senderIdStr = String(senderId);
    
    // ✅ PROTECTION ANTI-SPAM
    const now = Date.now();
    if (userActionLocks.has(senderIdStr)) {
        const lastAction = userActionLocks.get(senderIdStr);
        const timeSinceLastAction = now - lastAction;
        if (timeSinceLastAction < COOLDOWN_MS) {
            const remainingSeconds = Math.ceil((COOLDOWN_MS - timeSinceLastAction) / 1000);
            return `⏰ Patience ! Attends ${remainingSeconds}s ! ♟️`;
        }
    }
    userActionLocks.set(senderIdStr, now);
    
    // ✅ Récupérer la partie en cours si elle existe
    let gameData = chessGames.get(senderIdStr);
    
    // ✅ Gestion des commandes
    const command = args.toLowerCase().trim();
    
    // Commande /echecs (nouvelle partie ou aide)
    if (!command || command === 'aide' || command === 'help') {
        if (gameData && gameData.state !== GameState.FINISHED) {
            return `♟️ Tu as une partie en cours !
            
📊 /echecs etat - Voir la position
🎯 Envoie ton coup (ex: e2e4, Nf3)
🏳️ /echecs abandon - Abandonner
🔄 /echecs nouvelle - Nouvelle partie
            
💡 Ta partie est active ! Joue ton coup !`;
        }
        
        return `♟️ Jouer aux Échecs avec moi ! ✨

🆕 /echecs - Démarrer une partie
🎯 Format des coups: e2e4, Nf3, O-O
📊 /echecs etat - Voir la position
🔄 /echecs nouvelle - Nouvelle partie
🏳️ /echecs abandon - Abandonner

💖 Prêt(e) pour une partie ? /echecs !`;
    }
    
    // ✅ Commande /echecs nouvelle
    if (command === 'nouvelle' || command === 'new') {
        if (gameData && gameData.state === GameState.PLAYING) {
            return `⚠️ Tu as une partie en cours !
            
Options:
🏳️ /echecs abandon - Abandonner l'ancienne
📊 /echecs etat - Voir la position actuelle

Abandonne d'abord pour en créer une nouvelle ! ♟️`;
        }
        
        // Créer une nouvelle partie
        return await createNewGame(senderIdStr, log, addToMemory);
    }
    
    // ✅ Commande /echecs etat
    if (command === 'etat' || command === 'status' || command === 'position') {
        if (!gameData || gameData.state === GameState.FINISHED) {
            return `❌ Aucune partie en cours !
            
🆕 Tape /echecs pour démarrer ! ♟️`;
        }
        
        return getGameStatus(gameData);
    }
    
    // ✅ Commande /echecs abandon
    if (command === 'abandon' || command === 'quit' || command === 'stop') {
        if (!gameData || gameData.state === GameState.FINISHED) {
            return `❌ Aucune partie à abandonner !
            
🆕 Tape /echecs pour démarrer ! ♟️`;
        }
        
        gameData.state = GameState.FINISHED;
        gameData.result = gameData.userColor === 'w' ? '0-1 (abandon)' : '1-0 (abandon)';
        chessGames.set(senderIdStr, gameData);
        
        addToMemory(senderIdStr, 'user', 'Abandon de la partie d\'échecs');
        addToMemory(senderIdStr, 'assistant', 'Partie abandonnée');
        
        log.info(`🏳️ ${senderId} a abandonné la partie d'échecs`);
        
        return `🏳️ Partie abandonnée !
        
Résultat: ${gameData.result}
Coups joués: ${gameData.history.length}

🆕 Tape /echecs pour une nouvelle partie ! ♟️💕`;
    }
    
    // ✅ Si pas de commande spéciale, traiter comme un coup ou réponse
    if (!gameData) {
        // Pas de partie → créer une nouvelle
        return await createNewGame(senderIdStr, log, addToMemory);
    }
    
    // ✅ Gérer selon l'état de la partie
    switch (gameData.state) {
        case GameState.AWAITING_STARTER:
            return await handleStarterResponse(senderIdStr, args, gameData, log, addToMemory, sleep, ctx);
        
        case GameState.PLAYING:
            return await handleUserMove(senderIdStr, args, gameData, log, addToMemory, sleep, ctx);
        
        case GameState.FINISHED:
            return `✅ Cette partie est terminée !
            
Résultat: ${gameData.result}
            
🆕 Tape /echecs nouvelle pour rejouer ! ♟️`;
        
        default:
            return "❌ Erreur d'état de partie ! Tape /echecs nouvelle pour recommencer ! 💕";
    }
};

// ✅ FONCTION: Créer une nouvelle partie
async function createNewGame(senderId, log, addToMemory) {
    const game = new Chess();
    
    const gameData = {
        chess: game,
        state: GameState.AWAITING_STARTER,
        userColor: null,
        botColor: null,
        history: [],
        startTime: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
    };
    
    chessGames.set(senderId, gameData);
    
    addToMemory(senderId, 'user', 'Nouvelle partie d\'échecs');
    addToMemory(senderId, 'assistant', 'Partie créée - choix du joueur');
    
    log.info(`♟️ Nouvelle partie d'échecs créée pour ${senderId}`);
    
    return `♟️ Nouvelle partie d'échecs ! ✨

🎯 Qui commence ?

👤 Réponds "moi" - Tu joues Blancs
🤖 Réponds "toi" - Je joue Blancs

Fais ton choix ! 💕`;
}

// ✅ FONCTION: Gérer la réponse de qui commence
async function handleStarterResponse(senderId, response, gameData, log, addToMemory, sleep, ctx) {
    const normalized = response.toLowerCase().trim();
    
    if (normalized === 'moi' || normalized === 'me' || normalized === 'blanc' || normalized === 'blancs') {
        // L'utilisateur joue Blancs
        gameData.userColor = 'w';
        gameData.botColor = 'b';
        gameData.state = GameState.PLAYING;
        chessGames.set(senderId, gameData);
        
        addToMemory(senderId, 'user', 'Je commence (Blancs)');
        addToMemory(senderId, 'assistant', 'L\'utilisateur joue Blancs');
        
        log.info(`♟️ ${senderId} joue Blancs`);
        
        return `✅ Tu joues les Blancs ! ♟️

${getBoardRepresentation(gameData.chess)}

🎯 À toi de jouer !
💡 Envoie ton coup (ex: e2e4, Nf3, d2d4)`;
    }
    
    if (normalized === 'toi' || normalized === 'bot' || normalized === 'noir' || normalized === 'noirs') {
        // Le bot joue Blancs
        gameData.userColor = 'b';
        gameData.botColor = 'w';
        gameData.state = GameState.PLAYING;
        
        addToMemory(senderId, 'user', 'Tu commences (Blancs)');
        addToMemory(senderId, 'assistant', 'Le bot joue Blancs');
        
        log.info(`♟️ ${senderId} joue Noirs - Bot commence`);
        
        // Le bot fait son premier coup
        const botMoveResult = await makeBotMove(gameData, log);
        
        chessGames.set(senderId, gameData);
        
        return `✅ Je joue les Blancs ! ♟️

${getBoardRepresentation(gameData.chess)}

🤖 Mon coup: ${botMoveResult.move}
${botMoveResult.annotation}

🎯 À toi de jouer !
💡 Envoie ton coup (ex: e7e5, Nf6)`;
    }
    
    // Réponse invalide
    if (!gameData.invalidResponses) {
        gameData.invalidResponses = 0;
    }
    gameData.invalidResponses++;
    
    if (gameData.invalidResponses >= 3) {
        // Après 3 tentatives, annuler
        chessGames.delete(senderId);
        return `❌ Trop de réponses invalides !

Partie annulée. Tape /echecs pour recommencer ! 💕`;
    }
    
    return `❌ Réponse non comprise ! Réponds:

👤 "moi" - Tu joues Blancs
🤖 "toi" - Je joue Blancs

Tentative ${gameData.invalidResponses}/3`;
}

// ✅ FONCTION: Gérer le coup de l'utilisateur
async function handleUserMove(senderId, moveText, gameData, log, addToMemory, sleep, ctx) {
    const chess = gameData.chess;
    
    // Vérifier que c'est au tour de l'utilisateur
    if (chess.turn() !== gameData.userColor) {
        return `⏰ Ce n'est pas ton tour !

${getBoardRepresentation(chess)}

Attends mon coup ! ♟️`;
    }
    
    // Nettoyer et normaliser le coup
    const cleanMove = moveText.trim().replace(/\s+/g, '');
    
    try {
        // Tenter d'appliquer le coup (sloppy mode pour accepter différents formats)
        const move = chess.move(cleanMove, { sloppy: true });
        
        if (!move) {
            throw new Error('Coup invalide');
        }
        
        // Coup valide !
        gameData.history.push({
            player: 'user',
            move: move.san,
            fen: chess.fen(),
            timestamp: new Date().toISOString()
        });
        gameData.lastUpdated = new Date().toISOString();
        
        addToMemory(senderId, 'user', `Coup d'échecs: ${move.san}`);
        
        log.info(`♟️ ${senderId} a joué: ${move.san}`);
        
        // Vérifier si la partie est terminée après le coup de l'utilisateur
        if (chess.isGameOver()) {
            return await handleGameOver(senderId, gameData, log, addToMemory);
        }
        
        // Le bot joue maintenant
        const botMoveResult = await makeBotMove(gameData, log);
        
        chessGames.set(senderId, gameData);
        
        addToMemory(senderId, 'assistant', `Mon coup: ${botMoveResult.move}`);
        
        // Vérifier si la partie est terminée après le coup du bot
        if (chess.isGameOver()) {
            return await handleGameOver(senderId, gameData, log, addToMemory);
        }
        
        return `✅ Tu as joué: ${move.san}

${getBoardRepresentation(chess)}

🤖 Mon coup: ${botMoveResult.move}
${botMoveResult.annotation}

🎯 À toi de jouer !`;
        
    } catch (error) {
        log.warning(`⚠️ ${senderId} coup invalide: ${moveText}`);
        
        return `❌ Coup invalide: "${moveText}"

Format attendu:
• e2e4 (déplacement simple)
• Nf3 (notation algébrique)
• O-O (roque court)
• O-O-O (roque long)

${getBoardRepresentation(chess)}

Coups possibles: ${chess.moves().slice(0, 10).join(', ')}${chess.moves().length > 10 ? '...' : ''}

💡 Réessaie ! ♟️`;
    }
}

// ✅ FONCTION: Le bot fait son coup
async function makeBotMove(gameData, log) {
    const chess = gameData.chess;
    const possibleMoves = chess.moves();
    
    if (possibleMoves.length === 0) {
        return { move: 'Aucun coup possible', annotation: '' };
    }
    
    // ✅ Stratégie du bot: Mélange de coups intelligents et aléatoires
    let selectedMove;
    let annotation = '';
    
    // 30% de chance de faire un coup complètement aléatoire (pour varier)
    if (Math.random() < 0.3) {
        selectedMove = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
        annotation = '🎲 (coup créatif)';
    } else {
        // 70% de chance de faire un coup "intelligent"
        selectedMove = selectBestMove(chess, possibleMoves);
        annotation = '🧠 (coup réfléchi)';
    }
    
    // Appliquer le coup
    const move = chess.move(selectedMove);
    
    gameData.history.push({
        player: 'bot',
        move: move.san,
        fen: chess.fen(),
        timestamp: new Date().toISOString()
    });
    gameData.lastUpdated = new Date().toISOString();
    
    log.info(`🤖 Bot a joué: ${move.san}`);
    
    return {
        move: move.san,
        annotation: annotation
    };
}

// ✅ FONCTION: Sélectionner le "meilleur" coup (heuristique simple)
function selectBestMove(chess, moves) {
    // Heuristique simple sans moteur Stockfish
    // Priorités: 1. Échec et mat 2. Captures 3. Contrôle du centre 4. Développement
    
    let scoredMoves = moves.map(move => {
        const moveObj = chess.move(move);
        let score = 0;
        
        // Échec et mat = priorité absolue
        if (chess.isCheckmate()) {
            score += 10000;
        }
        
        // Échec
        if (chess.inCheck()) {
            score += 50;
        }
        
        // Capture
        if (moveObj.captured) {
            const pieceValues = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
            score += pieceValues[moveObj.captured] * 10;
        }
        
        // Contrôle du centre (e4, e5, d4, d5)
        const centerSquares = ['e4', 'e5', 'd4', 'd5'];
        if (centerSquares.includes(moveObj.to)) {
            score += 5;
        }
        
        // Développement des pièces (sortir les cavaliers et fous)
        if (['n', 'b'].includes(moveObj.piece) && ['1', '8'].includes(moveObj.from[1])) {
            score += 3;
        }
        
        chess.undo();
        return { move, score };
    });
    
    // Trier par score décroissant
    scoredMoves.sort((a, b) => b.score - a.score);
    
    // Prendre l'un des 3 meilleurs coups pour ajouter de la variété
    const topMoves = scoredMoves.slice(0, Math.min(3, scoredMoves.length));
    const selectedMove = topMoves[Math.floor(Math.random() * topMoves.length)];
    
    return selectedMove.move;
}

// ✅ FONCTION: Gérer la fin de partie
async function handleGameOver(senderId, gameData, log, addToMemory) {
    const chess = gameData.chess;
    gameData.state = GameState.FINISHED;
    
    let result = '';
    let message = '';
    
    if (chess.isCheckmate()) {
        const winner = chess.turn() === 'w' ? 'Noirs' : 'Blancs';
        const userWon = (winner === 'Blancs' && gameData.userColor === 'w') || 
                        (winner === 'Noirs' && gameData.userColor === 'b');
        
        result = chess.turn() === 'w' ? '0-1' : '1-0';
        
        if (userWon) {
            message = `🎉 ÉCHEC ET MAT ! Tu as gagné ! 👑

${getBoardRepresentation(chess)}

Résultat: ${result}
Coups joués: ${gameData.history.length}

Bravo champion ! 🏆💕`;
        } else {
            message = `🤖 ÉCHEC ET MAT ! J'ai gagné ! ♟️

${getBoardRepresentation(chess)}

Résultat: ${result}
Coups joués: ${gameData.history.length}

Bien joué ! Revanche ? 💕`;
        }
    } else if (chess.isDraw()) {
        result = '1/2-1/2';
        let drawReason = '';
        
        if (chess.isStalemate()) {
            drawReason = 'Pat (aucun coup légal)';
        } else if (chess.isThreefoldRepetition()) {
            drawReason = 'Triple répétition';
        } else if (chess.isInsufficientMaterial()) {
            drawReason = 'Matériel insuffisant';
        } else {
            drawReason = 'Règle des 50 coups';
        }
        
        message = `🤝 MATCH NUL ! ${drawReason}

${getBoardRepresentation(chess)}

Résultat: ${result}
Coups joués: ${gameData.history.length}

Belle partie ! Revanche ? ♟️💕`;
    }
    
    gameData.result = result;
    chessGames.set(senderId, gameData);
    
    addToMemory(senderId, 'assistant', `Partie terminée: ${result}`);
    log.info(`♟️ Partie terminée pour ${senderId}: ${result}`);
    
    return message + '\n\n🆕 Tape /echecs nouvelle pour rejouer !';
}

// ✅ FONCTION: Obtenir le statut de la partie
function getGameStatus(gameData) {
    const chess = gameData.chess;
    const moveCount = gameData.history.length;
    const userColorName = gameData.userColor === 'w' ? 'Blancs' : 'Noirs';
    const currentTurn = chess.turn() === 'w' ? 'Blancs' : 'Noirs';
    const isUserTurn = chess.turn() === gameData.userColor;
    
    let status = `📊 État de la partie ♟️

${getBoardRepresentation(chess)}

👤 Tu joues: ${userColorName}
🎯 Tour: ${currentTurn} ${isUserTurn ? '(À toi !)' : '(À moi !)'}
📈 Coups: ${moveCount}

`;
    
    // Afficher les derniers coups
    if (gameData.history.length > 0) {
        status += '📜 Derniers coups:\n';
        const recentMoves = gameData.history.slice(-6);
        recentMoves.forEach((entry, idx) => {
            const icon = entry.player === 'user' ? '👤' : '🤖';
            status += `${icon} ${entry.move}\n`;
        });
    }
    
    if (chess.inCheck()) {
        status += '\n⚠️ ÉCHEC !';
    }
    
    status += `\n\n💡 ${isUserTurn ? 'Envoie ton coup !' : 'J\'y réfléchis...'}`;
    
    return status;
}

// ✅ FONCTION: Représentation textuelle de l'échiquier
function getBoardRepresentation(chess) {
    const board = chess.board();
    const pieces = {
        'p': '♟', 'n': '♞', 'b': '♝', 'r': '♜', 'q': '♛', 'k': '♚',
        'P': '♙', 'N': '♘', 'B': '♗', 'R': '♖', 'Q': '♕', 'K': '♔'
    };
    
    let output = '  a b c d e f g h\n';
    for (let i = 0; i < 8; i++) {
        output += (8 - i) + ' ';
        for (let j = 0; j < 8; j++) {
            const square = board[i][j];
            if (square) {
                output += pieces[square.type.toUpperCase()] + (square.color === 'w' ? '' : '');
                // Réutiliser les symboles car Messenger n'a qu'un jeu limité
                if (square.color === 'b') {
                    output = output.slice(0, -1) + pieces[square.type];
                }
            } else {
                output += ((i + j) % 2 === 0 ? '□' : '■');
            }
            output += ' ';
        }
        output += (8 - i) + '\n';
    }
    output += '  a b c d e f g h';
    
    return output;
}

// ✅ Nettoyage automatique des parties anciennes (plus de 7 jours)
setInterval(() => {
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    let cleanedCount = 0;
    
    for (const [userId, gameData] of chessGames.entries()) {
        const lastUpdate = new Date(gameData.lastUpdated).getTime();
        if (now - lastUpdate > sevenDays) {
            chessGames.delete(userId);
            cleanedCount++;
        }
    }
    
    if (cleanedCount > 0) {
        console.log(`🧹 ${cleanedCount} parties d'échecs anciennes nettoyées`);
    }
}, 24 * 60 * 60 * 1000); // Vérifier tous les jours
