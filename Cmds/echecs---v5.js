/**
 * Commande /echecs - Jeu d'échecs intelligent avec niveaux de difficulté
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande
 * @param {object} ctx - Contexte partagé du bot
 */

const { Chess } = require('chess.js');
const axios = require('axios');

// ✅ État des parties d'échecs par utilisateur
const chessGames = new Map();

// ✅ États possibles d'une partie
const GameState = {
    AWAITING_LEVEL: 'awaiting_level',
    AWAITING_STARTER: 'awaiting_starter',
    PLAYING: 'playing',
    FINISHED: 'finished'
};

// ✅ Niveaux de difficulté
const DifficultyLevels = {
    FACILE: { name: 'Facile', depth: 1, randomness: 0.4, emoji: '😊' },
    MOYEN: { name: 'Moyen', depth: 2, randomness: 0.25, emoji: '🤔' },
    DIFFICILE: { name: 'Difficile', depth: 3, randomness: 0.15, emoji: '😤' },
    EXPERT: { name: 'Expert', depth: 4, randomness: 0.05, emoji: '🧠' },
    MAITRE: { name: 'Maître', depth: 5, randomness: 0, emoji: '👑' }
};

// ✅ Protection anti-spam
const userActionLocks = new Map();
const COOLDOWN_MS = 2000;

module.exports = async function cmdEchecs(senderId, args, ctx) {
    const { log, addToMemory, sleep, sendImageMessage } = ctx;
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
            const boardImage = await generateBoardImage(gameData.chess, gameData.userColor);
            const levelInfo = gameData.difficulty ? `${gameData.difficulty.emoji} Niveau: ${gameData.difficulty.name}` : '';
            
            return {
                type: "image",
                url: boardImage,
                caption: `♟️ Tu as une partie en cours !
${levelInfo}
            
📊 /echecs etat - Voir la position
🎯 Envoie ton coup (ex: e2e4, Nf3)
🏳️ /echecs abandon - Abandonner
🔄 /echecs nouvelle - Nouvelle partie
            
💡 Ta partie est active ! Joue ton coup !`
            };
        }
        
        return `♟️ Jouer aux Échecs avec moi ! ✨

🆕 /echecs - Démarrer une partie
🎯 Format des coups: e2e4, Nf3, O-O
📊 /echecs etat - Voir la position
🔄 /echecs nouvelle - Nouvelle partie
🏳️ /echecs abandon - Abandonner

🎚️ Niveaux disponibles:
${DifficultyLevels.FACILE.emoji} Facile - Débutant
${DifficultyLevels.MOYEN.emoji} Moyen - Intermédiaire
${DifficultyLevels.DIFFICILE.emoji} Difficile - Avancé
${DifficultyLevels.EXPERT.emoji} Expert - Très fort
${DifficultyLevels.MAITRE.emoji} Maître - Imbattable

💖 Prêt(e) pour une partie ? Tape /echecs !`;
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
        
        return await createNewGame(senderIdStr, log, addToMemory);
    }
    
    // ✅ Commande /echecs etat
    if (command === 'etat' || command === 'status' || command === 'position') {
        if (!gameData || gameData.state === GameState.FINISHED) {
            return `❌ Aucune partie en cours !
            
🆕 Tape /echecs pour démarrer ! ♟️`;
        }
        
        return await getGameStatus(gameData);
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
        
        const boardImage = await generateBoardImage(gameData.chess, gameData.userColor);
        
        return {
            type: "image",
            url: boardImage,
            caption: `🏳️ Partie abandonnée !
        
Résultat: ${gameData.result}
Coups joués: ${gameData.history.length}

🆕 Tape /echecs pour une nouvelle partie ! ♟️💕`
        };
    }
    
    // ✅ Si pas de commande spéciale, traiter comme un coup ou réponse
    if (!gameData) {
        return await createNewGame(senderIdStr, log, addToMemory);
    }
    
    // ✅ Gérer selon l'état de la partie
    switch (gameData.state) {
        case GameState.AWAITING_LEVEL:
            return await handleLevelSelection(senderIdStr, args, gameData, log, addToMemory);
        
        case GameState.AWAITING_STARTER:
            return await handleStarterResponse(senderIdStr, args, gameData, log, addToMemory, sleep, ctx);
        
        case GameState.PLAYING:
            await handleUserMove(senderIdStr, args, gameData, log, addToMemory, sleep, ctx);
            return;
        
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
        state: GameState.AWAITING_LEVEL,
        difficulty: null,
        userColor: null,
        botColor: null,
        history: [],
        startTime: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
    };
    
    chessGames.set(senderId, gameData);
    
    addToMemory(senderId, 'user', 'Nouvelle partie d\'échecs');
    addToMemory(senderId, 'assistant', 'Choix du niveau');
    
    log.info(`♟️ Nouvelle partie d'échecs créée pour ${senderId}`);
    
    return `♟️ Nouvelle partie d'échecs ! ✨

🎚️ Choisis ton niveau :

1️⃣ ${DifficultyLevels.FACILE.emoji} Facile - Pour débuter
2️⃣ ${DifficultyLevels.MOYEN.emoji} Moyen - Bon niveau
3️⃣ ${DifficultyLevels.DIFFICILE.emoji} Difficile - Challengeant
4️⃣ ${DifficultyLevels.EXPERT.emoji} Expert - Très fort
5️⃣ ${DifficultyLevels.MAITRE.emoji} Maître - Imbattable

💡 Réponds avec le numéro (1 à 5) !`;
}

// ✅ FONCTION: Gérer la sélection du niveau
async function handleLevelSelection(senderId, response, gameData, log, addToMemory) {
    const normalized = response.trim();
    
    let selectedLevel = null;
    
    // Accepter numéros ou noms
    if (normalized === '1' || normalized.toLowerCase().includes('facile')) {
        selectedLevel = DifficultyLevels.FACILE;
    } else if (normalized === '2' || normalized.toLowerCase().includes('moyen')) {
        selectedLevel = DifficultyLevels.MOYEN;
    } else if (normalized === '3' || normalized.toLowerCase().includes('difficile')) {
        selectedLevel = DifficultyLevels.DIFFICILE;
    } else if (normalized === '4' || normalized.toLowerCase().includes('expert')) {
        selectedLevel = DifficultyLevels.EXPERT;
    } else if (normalized === '5' || normalized.toLowerCase().includes('maitre') || normalized.toLowerCase().includes('maître')) {
        selectedLevel = DifficultyLevels.MAITRE;
    }
    
    if (!selectedLevel) {
        if (!gameData.invalidResponses) gameData.invalidResponses = 0;
        gameData.invalidResponses++;
        
        if (gameData.invalidResponses >= 3) {
            chessGames.delete(senderId);
            return `❌ Trop de réponses invalides ! Partie annulée.

🆕 Tape /echecs pour recommencer ! 💕`;
        }
        
        return `❌ Niveau non reconnu !

Réponds avec un numéro de 1 à 5
Tentative ${gameData.invalidResponses}/3 ♟️`;
    }
    
    gameData.difficulty = selectedLevel;
    gameData.state = GameState.AWAITING_STARTER;
    chessGames.set(senderId, gameData);
    
    addToMemory(senderId, 'user', `Niveau choisi: ${selectedLevel.name}`);
    
    log.info(`♟️ ${senderId} a choisi le niveau ${selectedLevel.name}`);
    
    return `✅ Niveau ${selectedLevel.emoji} ${selectedLevel.name} !

🎯 Qui commence ?

👤 Réponds "moi" - Tu joues Blancs
🤖 Réponds "toi" - Je joue Blancs

Fais ton choix ! 💕`;
}

// ✅ FONCTION: Gérer la réponse de qui commence
async function handleStarterResponse(senderId, response, gameData, log, addToMemory, sleep, ctx) {
    const normalized = response.toLowerCase().trim();
    
    if (normalized === 'moi' || normalized === 'me' || normalized === 'blanc' || normalized === 'blancs') {
        gameData.userColor = 'w';
        gameData.botColor = 'b';
        gameData.state = GameState.PLAYING;
        chessGames.set(senderId, gameData);
        
        addToMemory(senderId, 'user', 'Je commence (Blancs)');
        addToMemory(senderId, 'assistant', 'L\'utilisateur joue Blancs');
        
        log.info(`♟️ ${senderId} joue Blancs`);
        
        const boardImage = await generateBoardImage(gameData.chess, gameData.userColor);
        
        return {
            type: "image",
            url: boardImage,
            caption: `✅ Tu joues les Blancs ! ♟️
${gameData.difficulty.emoji} Niveau: ${gameData.difficulty.name}

🎯 À toi de jouer !
💡 Envoie ton coup (ex: e2e4, Nf3, d2d4)`
        };
    }
    
    if (normalized === 'toi' || normalized === 'bot' || normalized === 'noir' || normalized === 'noirs') {
        gameData.userColor = 'b';
        gameData.botColor = 'w';
        gameData.state = GameState.PLAYING;
        
        addToMemory(senderId, 'user', 'Tu commences (Blancs)');
        addToMemory(senderId, 'assistant', 'Le bot joue Blancs');
        
        log.info(`♟️ ${senderId} joue Noirs - Bot commence`);
        
        const botMoveResult = await makeBotMove(gameData, log);
        
        chessGames.set(senderId, gameData);
        
        const boardImage = await generateBoardImage(gameData.chess, gameData.userColor);
        
        return {
            type: "image",
            url: boardImage,
            caption: `✅ Je joue les Blancs ! ♟️
${gameData.difficulty.emoji} Niveau: ${gameData.difficulty.name}

🤖 Mon coup: ${botMoveResult.move}
${botMoveResult.annotation}

🎯 À toi de jouer !
💡 Envoie ton coup (ex: e7e5, Nf6)`
        };
    }
    
    if (!gameData.invalidResponses) gameData.invalidResponses = 0;
    gameData.invalidResponses++;
    
    if (gameData.invalidResponses >= 3) {
        chessGames.delete(senderId);
        return `❌ Trop de réponses invalides ! Partie annulée.

🆕 Tape /echecs pour recommencer ! 💕`;
    }
    
    return `❌ Réponse non comprise ! Réponds:

👤 "moi" - Tu joues Blancs
🤖 "toi" - Je joue Blancs

Tentative ${gameData.invalidResponses}/3`;
}

// ✅ FONCTION: Gérer le coup de l'utilisateur
async function handleUserMove(senderId, moveText, gameData, log, addToMemory, sleep, ctx) {
    const chess = gameData.chess;
    
    if (chess.turn() !== gameData.userColor) {
        await ctx.sendImageMessage(senderId, null, `⏰ Ce n'est pas ton tour ! Attends mon coup ! ♟️`);
        return;
    }
    
    const cleanMove = moveText.trim().replace(/\s+/g, '');
    
    try {
        const move = chess.move(cleanMove, { sloppy: true });
        
        if (!move) throw new Error('Coup invalide');
        
        gameData.history.push({
            player: 'user',
            move: move.san,
            fen: chess.fen(),
            timestamp: new Date().toISOString()
        });
        gameData.lastUpdated = new Date().toISOString();
        
        addToMemory(senderId, 'user', `Coup d'échecs: ${move.san}`);
        log.info(`♟️ ${senderId} a joué: ${move.san}`);
        
        const userBoardImage = await generateBoardImage(chess, gameData.userColor);
        await ctx.sendImageMessage(senderId, userBoardImage, `✅ Tu as joué: ${move.san}

🎯 Position après ton coup.
${gameData.difficulty.emoji} J'analyse la position...`);
        
        if (chess.isGameOver()) {
            await handleGameOver(senderId, gameData, log, addToMemory, ctx);
            return;
        }
        
        // Temps de réflexion basé sur le niveau
        const thinkingTime = 1000 + (gameData.difficulty.depth * 500);
        await sleep(thinkingTime);
        
        const botMoveResult = await makeBotMove(gameData, log);
        
        chessGames.set(senderId, gameData);
        addToMemory(senderId, 'assistant', `Mon coup: ${botMoveResult.move}`);
        
        const botBoardImage = await generateBoardImage(chess, gameData.userColor);
        await ctx.sendImageMessage(senderId, botBoardImage, `🤖 Mon coup: ${botMoveResult.move}
${botMoveResult.annotation}

🎯 À toi de jouer !`);
        
        if (chess.isGameOver()) {
            await handleGameOver(senderId, gameData, log, addToMemory, ctx);
            return;
        }
        
    } catch (error) {
        log.warning(`⚠️ ${senderId} coup invalide: ${moveText}`);
        
        const possibleMoves = chess.moves().slice(0, 10).join(', ');
        
        await ctx.sendImageMessage(senderId, null, `❌ Coup invalide: "${moveText}"

Format attendu:
• e2e4 (déplacement simple)
• Nf3 (notation algébrique)
• O-O (roque court)

Coups possibles: ${possibleMoves}${chess.moves().length > 10 ? '...' : ''}

💡 Réessaie ! ♟️`);
    }
}

// ✅ FONCTION: Le bot fait son coup (IA AMÉLIORÉE)
async function makeBotMove(gameData, log) {
    const chess = gameData.chess;
    const possibleMoves = chess.moves();
    
    if (possibleMoves.length === 0) {
        return { move: 'Aucun coup possible', annotation: '' };
    }
    
    const difficulty = gameData.difficulty;
    let selectedMove;
    let annotation = '';
    
    // Ajouter de l'aléatoire selon le niveau
    if (Math.random() < difficulty.randomness) {
        selectedMove = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
        annotation = '🎲 (coup créatif)';
    } else {
        // Utiliser Minimax avec élagage Alpha-Beta
        const result = minimax(chess, difficulty.depth, -Infinity, Infinity, true);
        selectedMove = result.move;
        annotation = `🧠 (évaluation: ${result.score > 0 ? '+' : ''}${(result.score / 100).toFixed(1)})`;
    }
    
    const move = chess.move(selectedMove);
    
    gameData.history.push({
        player: 'bot',
        move: move.san,
        fen: chess.fen(),
        timestamp: new Date().toISOString()
    });
    gameData.lastUpdated = new Date().toISOString();
    
    log.info(`🤖 Bot a joué: ${move.san}`);
    
    return { move: move.san, annotation: annotation };
}

// ✅ FONCTION: Algorithme Minimax avec élagage Alpha-Beta
function minimax(chess, depth, alpha, beta, isMaximizing) {
    if (depth === 0 || chess.isGameOver()) {
        return { score: evaluatePosition(chess), move: null };
    }
    
    const moves = chess.moves();
    let bestMove = moves[0];
    
    if (isMaximizing) {
        let maxScore = -Infinity;
        
        for (const move of moves) {
            chess.move(move);
            const score = minimax(chess, depth - 1, alpha, beta, false).score;
            chess.undo();
            
            if (score > maxScore) {
                maxScore = score;
                bestMove = move;
            }
            
            alpha = Math.max(alpha, score);
            if (beta <= alpha) break; // Élagage Beta
        }
        
        return { score: maxScore, move: bestMove };
    } else {
        let minScore = Infinity;
        
        for (const move of moves) {
            chess.move(move);
            const score = minimax(chess, depth - 1, alpha, beta, true).score;
            chess.undo();
            
            if (score < minScore) {
                minScore = score;
                bestMove = move;
            }
            
            beta = Math.min(beta, score);
            if (beta <= alpha) break; // Élagage Alpha
        }
        
        return { score: minScore, move: bestMove };
    }
}

// ✅ FONCTION: Évaluer une position (heuristique avancée)
function evaluatePosition(chess) {
    if (chess.isCheckmate()) {
        return chess.turn() === 'w' ? -10000 : 10000;
    }
    
    if (chess.isDraw()) return 0;
    
    let score = 0;
    
    // Valeurs des pièces
    const pieceValues = {
        p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000
    };
    
    // Tables de position pour encourager le bon placement
    const pawnTable = [
        0,  0,  0,  0,  0,  0,  0,  0,
        50, 50, 50, 50, 50, 50, 50, 50,
        10, 10, 20, 30, 30, 20, 10, 10,
        5,  5, 10, 25, 25, 10,  5,  5,
        0,  0,  0, 20, 20,  0,  0,  0,
        5, -5,-10,  0,  0,-10, -5,  5,
        5, 10, 10,-20,-20, 10, 10,  5,
        0,  0,  0,  0,  0,  0,  0,  0
    ];
    
    const knightTable = [
        -50,-40,-30,-30,-30,-30,-40,-50,
        -40,-20,  0,  0,  0,  0,-20,-40,
        -30,  0, 10, 15, 15, 10,  0,-30,
        -30,  5, 15, 20, 20, 15,  5,-30,
        -30,  0, 15, 20, 20, 15,  0,-30,
        -30,  5, 10, 15, 15, 10,  5,-30,
        -40,-20,  0,  5,  5,  0,-20,-40,
        -50,-40,-30,-30,-30,-30,-40,-50
    ];
    
    const board = chess.board();
    
    for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
            const piece = board[i][j];
            if (piece) {
                const value = pieceValues[piece.type];
                const position = i * 8 + j;
                const positionBonus = piece.type === 'p' ? pawnTable[position] : 
                                     piece.type === 'n' ? knightTable[position] : 0;
                
                if (piece.color === 'w') {
                    score += value + positionBonus;
                } else {
                    score -= value + positionBonus;
                }
            }
        }
    }
    
    // Bonus mobilité
    const whiteMoves = chess.turn() === 'w' ? chess.moves().length : 0;
    chess.load(chess.fen().replace('w', 'b').replace('b', 'w', 1));
    const blackMoves = chess.moves().length;
    score += (whiteMoves - blackMoves) * 10;
    
    return score;
}

// ✅ FONCTION: Gérer la fin de partie
async function handleGameOver(senderId, gameData, log, addToMemory, ctx) {
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

Résultat: ${result}
Niveau: ${gameData.difficulty.emoji} ${gameData.difficulty.name}
Coups joués: ${gameData.history.length}

Bravo champion ! 🏆💕`;
        } else {
            message = `🤖 ÉCHEC ET MAT ! J'ai gagné ! ♟️

Résultat: ${result}
Niveau: ${gameData.difficulty.emoji} ${gameData.difficulty.name}
Coups joués: ${gameData.history.length}

Bien joué ! Revanche ? 💕`;
        }
    } else if (chess.isDraw()) {
        result = '1/2-1/2';
        let drawReason = '';
        
        if (chess.isStalemate()) drawReason = 'Pat (aucun coup légal)';
        else if (chess.isThreefoldRepetition()) drawReason = 'Triple répétition';
        else if (chess.isInsufficientMaterial()) drawReason = 'Matériel insuffisant';
        else drawReason = 'Règle des 50 coups';
        
        message = `🤝 MATCH NUL ! ${drawReason}

Résultat: ${result}
Niveau: ${gameData.difficulty.emoji} ${gameData.difficulty.name}
Coups joués: ${gameData.history.length}

Belle partie ! Revanche ? ♟️💕`;
    }
    
    gameData.result = result;
    chessGames.set(senderId, gameData);
    
    addToMemory(senderId, 'assistant', `Partie terminée: ${result}`);
    log.info(`♟️ Partie terminée pour ${senderId}: ${result}`);
    
    const boardImage = await generateBoardImage(chess, gameData.userColor);
    
    await ctx.sendImageMessage(senderId, boardImage, message + '\n\n🆕 Tape /echecs nouvelle pour rejouer !');
}

// ✅ FONCTION: Obtenir le statut de la partie
async function getGameStatus(gameData) {
    const chess = gameData.chess;
    const moveCount = gameData.history.length;
    const userColorName = gameData.userColor === 'w' ? 'Blancs' : 'Noirs';
    const currentTurn = chess.turn() === 'w' ? 'Blancs' : 'Noirs';
    const isUserTurn = chess.turn() === gameData.userColor;
    
    let caption = `📊 État de la partie ♟️

${gameData.difficulty.emoji} Niveau: ${gameData.difficulty.name}
👤 Tu joues: ${userColorName}
🎯 Tour: ${currentTurn} ${isUserTurn ? '(À toi !)' : '(À moi !)'}
📈 Coups: ${moveCount}

`;
    
    if (gameData.history.length > 0) {
        caption += '📜 Derniers coups:\n';
        const recentMoves = gameData.history.slice(-6);
        recentMoves.forEach((entry, idx) => {
            const icon = entry.player === 'user' ? '👤' : '🤖';
            caption += `${icon} ${entry.move}\n`;
        });
    }
    
    if (chess.inCheck()) caption += '\n⚠️ ÉCHEC !';
    
    caption += `\n\n💡 ${isUserTurn ? 'Envoie ton coup !' : 'J\'analyse...'}`;
    
    const boardImage = await generateBoardImage(chess, gameData.userColor);
    
    return { type: "image", url: boardImage, caption: caption };
}

// ✅ FONCTION: Générer une image du plateau
async function generateBoardImage(chess, userColor) {
    const fen = chess.fen();
    const orientation = userColor === 'w' ? 'white' : 'black';
    const encodedFen = encodeURIComponent(fen);
    
    const theme = 'brown';
    const pieceSet = 'cburnett';
    const imageUrl = `https://lichess1.org/export/fen.gif?fen=${encodedFen}&theme=${theme}&piece=${pieceSet}&orientation=${orientation}&size=1024`;
    
    return imageUrl;
}

// ✅ Nettoyage automatique des parties anciennes
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
