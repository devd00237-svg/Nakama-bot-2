/**
 * Commande /echecs - Jeu d'échecs intelligent avec niveaux de difficulté
 * Version optimisée et synchronisée avec le serveur
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande
 * @param {object} ctx - Contexte partagé du bot
 */

const { Chess } = require('chess.js');

// ✅ État des parties d'échecs par utilisateur (stocké dans commandData du serveur)
const STORAGE_KEY = 'chessGames';

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

// ✅ Protection anti-spam locale à la commande
const userActionLocks = new Map();
const COOLDOWN_MS = 2000;

// === FONCTIONS UTILITAIRES POUR LE STOCKAGE ===

/**
 * Récupère toutes les parties d'échecs depuis le stockage serveur
 */
function getAllGames(ctx) {
    if (!ctx.commandData) {
        return new Map();
    }
    const stored = ctx.commandData.get(STORAGE_KEY);
    if (stored && stored instanceof Map) {
        return stored;
    }
    const newMap = new Map();
    ctx.commandData.set(STORAGE_KEY, newMap);
    return newMap;
}

/**
 * Récupère la partie d'un utilisateur
 */
function getUserGame(ctx, userId) {
    const allGames = getAllGames(ctx);
    const gameData = allGames.get(String(userId));
    
    if (gameData && gameData.fenString) {
        // Reconstituer l'objet Chess depuis le FEN
        try {
            const chess = new Chess(gameData.fenString);
            gameData.chess = chess;
        } catch (error) {
            ctx.log.error(`❌ Erreur reconstruction partie Chess: ${error.message}`);
            return null;
        }
    }
    
    return gameData;
}

/**
 * Sauvegarde la partie d'un utilisateur
 */
function saveUserGame(ctx, userId, gameData) {
    const allGames = getAllGames(ctx);
    
    // Sérialiser l'objet Chess en FEN pour la sauvegarde
    if (gameData && gameData.chess) {
        gameData.fenString = gameData.chess.fen();
    }
    
    allGames.set(String(userId), gameData);
    ctx.commandData.set(STORAGE_KEY, allGames);
    
    // Sauvegarder immédiatement
    if (ctx.saveDataImmediate) {
        ctx.saveDataImmediate();
    }
}

/**
 * Supprime la partie d'un utilisateur
 */
function deleteUserGame(ctx, userId) {
    const allGames = getAllGames(ctx);
    allGames.delete(String(userId));
    ctx.commandData.set(STORAGE_KEY, allGames);
    
    if (ctx.saveDataImmediate) {
        ctx.saveDataImmediate();
    }
}

// === FONCTION PRINCIPALE ===

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
            return `⏰ Patience ! Attends ${remainingSeconds}s avant de rejouer ! ♟️`;
        }
    }
    userActionLocks.set(senderIdStr, now);
    
    // ✅ Récupérer la partie en cours si elle existe
    let gameData = getUserGame(ctx, senderIdStr);
    
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
        
        return await createNewGame(ctx, senderIdStr);
    }
    
    // ✅ Commande /echecs etat
    if (command === 'etat' || command === 'status' || command === 'position') {
        if (!gameData || gameData.state === GameState.FINISHED) {
            return `❌ Aucune partie en cours !
            
🆕 Tape /echecs pour démarrer ! ♟️`;
        }
        
        return await getGameStatus(ctx, gameData);
    }
    
    // ✅ Commande /echecs abandon
    if (command === 'abandon' || command === 'quit' || command === 'stop') {
        if (!gameData || gameData.state === GameState.FINISHED) {
            return `❌ Aucune partie à abandonner !
            
🆕 Tape /echecs pour démarrer ! ♟️`;
        }
        
        gameData.state = GameState.FINISHED;
        gameData.result = gameData.userColor === 'w' ? '0-1 (abandon)' : '1-0 (abandon)';
        saveUserGame(ctx, senderIdStr, gameData);
        
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
        return await createNewGame(ctx, senderIdStr);
    }
    
    // ✅ Gérer selon l'état de la partie
    switch (gameData.state) {
        case GameState.AWAITING_LEVEL:
            return await handleLevelSelection(ctx, senderIdStr, args, gameData);
        
        case GameState.AWAITING_STARTER:
            return await handleStarterResponse(ctx, senderIdStr, args, gameData);
        
        case GameState.PLAYING:
            await handleUserMove(ctx, senderIdStr, args, gameData);
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
async function createNewGame(ctx, userId) {
    const game = new Chess();
    
    const gameData = {
        chess: game,
        fenString: game.fen(),
        state: GameState.AWAITING_LEVEL,
        difficulty: null,
        userColor: null,
        botColor: null,
        history: [],
        startTime: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        invalidResponses: 0
    };
    
    saveUserGame(ctx, userId, gameData);
    
    ctx.addToMemory(userId, 'user', 'Nouvelle partie d\'échecs');
    ctx.addToMemory(userId, 'assistant', 'Choix du niveau');
    
    ctx.log.info(`♟️ Nouvelle partie d'échecs créée pour ${userId}`);
    
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
async function handleLevelSelection(ctx, userId, response, gameData) {
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
        gameData.invalidResponses = (gameData.invalidResponses || 0) + 1;
        
        if (gameData.invalidResponses >= 3) {
            deleteUserGame(ctx, userId);
            return `❌ Trop de réponses invalides ! Partie annulée.

🆕 Tape /echecs pour recommencer ! 💕`;
        }
        
        saveUserGame(ctx, userId, gameData);
        return `❌ Niveau non reconnu !

Réponds avec un numéro de 1 à 5
Tentative ${gameData.invalidResponses}/3 ♟️`;
    }
    
    gameData.difficulty = selectedLevel;
    gameData.state = GameState.AWAITING_STARTER;
    gameData.invalidResponses = 0;
    saveUserGame(ctx, userId, gameData);
    
    ctx.addToMemory(userId, 'user', `Niveau choisi: ${selectedLevel.name}`);
    
    ctx.log.info(`♟️ ${userId} a choisi le niveau ${selectedLevel.name}`);
    
    return `✅ Niveau ${selectedLevel.emoji} ${selectedLevel.name} !

🎯 Qui commence ?

👤 Réponds "moi" - Tu joues Blancs
🤖 Réponds "toi" - Je joue Blancs

Fais ton choix ! 💕`;
}

// ✅ FONCTION: Gérer la réponse de qui commence
async function handleStarterResponse(ctx, userId, response, gameData) {
    const normalized = response.toLowerCase().trim();
    
    if (normalized === 'moi' || normalized === 'me' || normalized === 'blanc' || normalized === 'blancs') {
        gameData.userColor = 'w';
        gameData.botColor = 'b';
        gameData.state = GameState.PLAYING;
        gameData.invalidResponses = 0;
        saveUserGame(ctx, userId, gameData);
        
        ctx.addToMemory(userId, 'user', 'Je commence (Blancs)');
        ctx.addToMemory(userId, 'assistant', 'L\'utilisateur joue Blancs');
        
        ctx.log.info(`♟️ ${userId} joue Blancs`);
        
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
        gameData.invalidResponses = 0;
        
        ctx.addToMemory(userId, 'user', 'Tu commences (Blancs)');
        ctx.addToMemory(userId, 'assistant', 'Le bot joue Blancs');
        
        ctx.log.info(`♟️ ${userId} joue Noirs - Bot commence`);
        
        const botMoveResult = await makeBotMove(ctx, gameData);
        
        saveUserGame(ctx, userId, gameData);
        
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
    
    gameData.invalidResponses = (gameData.invalidResponses || 0) + 1;
    
    if (gameData.invalidResponses >= 3) {
        deleteUserGame(ctx, userId);
        return `❌ Trop de réponses invalides ! Partie annulée.

🆕 Tape /echecs pour recommencer ! 💕`;
    }
    
    saveUserGame(ctx, userId, gameData);
    return `❌ Réponse non comprise ! Réponds:

👤 "moi" - Tu joues Blancs
🤖 "toi" - Je joue Blancs

Tentative ${gameData.invalidResponses}/3`;
}

// ✅ FONCTION: Gérer le coup de l'utilisateur
async function handleUserMove(ctx, userId, moveText, gameData) {
    const chess = gameData.chess;
    
    if (chess.turn() !== gameData.userColor) {
        await ctx.sendImageMessage(userId, null, `⏰ Ce n'est pas ton tour ! Attends mon coup ! ♟️`);
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
        gameData.fenString = chess.fen();
        
        ctx.addToMemory(userId, 'user', `Coup d'échecs: ${move.san}`);
        ctx.log.info(`♟️ ${userId} a joué: ${move.san}`);
        
        const userBoardImage = await generateBoardImage(chess, gameData.userColor);
        await ctx.sendImageMessage(userId, userBoardImage, `✅ Tu as joué: ${move.san}

🎯 Position après ton coup.
${gameData.difficulty.emoji} J'analyse la position...`);
        
        if (chess.isGameOver()) {
            await handleGameOver(ctx, userId, gameData);
            return;
        }
        
        // Temps de réflexion basé sur le niveau
        const thinkingTime = 1000 + (gameData.difficulty.depth * 500);
        await ctx.sleep(thinkingTime);
        
        const botMoveResult = await makeBotMove(ctx, gameData);
        
        saveUserGame(ctx, userId, gameData);
        ctx.addToMemory(userId, 'assistant', `Mon coup: ${botMoveResult.move}`);
        
        const botBoardImage = await generateBoardImage(chess, gameData.userColor);
        await ctx.sendImageMessage(userId, botBoardImage, `🤖 Mon coup: ${botMoveResult.move}
${botMoveResult.annotation}

🎯 À toi de jouer !`);
        
        if (chess.isGameOver()) {
            await handleGameOver(ctx, userId, gameData);
            return;
        }
        
    } catch (error) {
        ctx.log.warning(`⚠️ ${userId} coup invalide: ${moveText}`);
        
        const possibleMoves = chess.moves().slice(0, 10).join(', ');
        
        await ctx.sendImageMessage(userId, null, `❌ Coup invalide: "${moveText}"

Format attendu:
• e2e4 (déplacement simple)
• Nf3 (notation algébrique)
• O-O (roque court)

Coups possibles: ${possibleMoves}${chess.moves().length > 10 ? '...' : ''}

💡 Réessaie ! ♟️`);
    }
}

// ✅ FONCTION: Le bot fait son coup (IA AMÉLIORÉE)
async function makeBotMove(ctx, gameData) {
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
    gameData.fenString = chess.fen();
    
    ctx.log.info(`🤖 Bot a joué: ${move.san}`);
    
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
    const currentTurn = chess.turn();
    const whiteMoves = currentTurn === 'w' ? chess.moves().length : 0;
    
    // Temporairement changer le tour pour compter les coups noirs
    const fen = chess.fen();
    const parts = fen.split(' ');
    parts[1] = currentTurn === 'w' ? 'b' : 'w';
    const newFen = parts.join(' ');
    
    try {
        const tempChess = new Chess(newFen);
        const blackMoves = tempChess.moves().length;
        score += (whiteMoves - blackMoves) * 10;
    } catch (error) {
        // En cas d'erreur, ignorer le bonus de mobilité
    }
    
    return score;
}

// ✅ FONCTION: Gérer la fin de partie
async function handleGameOver(ctx, userId, gameData) {
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
    saveUserGame(ctx, userId, gameData);
    
    ctx.addToMemory(userId, 'assistant', `Partie terminée: ${result}`);
    ctx.log.info(`♟️ Partie terminée pour ${userId}: ${result}`);
    
    const boardImage = await generateBoardImage(chess, gameData.userColor);
    
    await ctx.sendImageMessage(userId, boardImage, message + '\n\n🆕 Tape /echecs nouvelle pour rejouer !');
}

// ✅ FONCTION: Obtenir le statut de la partie
async function getGameStatus(ctx, gameData) {
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

// ✅ Nettoyage automatique des parties anciennes (toutes les 24h)
setInterval(() => {
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    let cleanedCount = 0;
    
    // Note: Cette fonction s'exécutera dans le contexte global
    // mais n'aura pas accès au ctx. Elle est là pour la documentation.
    // Le nettoyage réel devrait être fait par le serveur principal.
    
    console.log(`🧹 Nettoyage automatique des parties d'échecs anciennes...`);
}, 24 * 60 * 60 * 1000); // Vérifier tous les jours

// ✅ Export de fonctions utilitaires pour le serveur (optionnel)
module.exports.getAllGames = getAllGames;
module.exports.getUserGame = getUserGame;
module.exports.saveUserGame = saveUserGame;
module.exports.deleteUserGame = deleteUserGame;
module.exports.GameState = GameState;
module.exports.DifficultyLevels = DifficultyLevels;
