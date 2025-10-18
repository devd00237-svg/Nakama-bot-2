/**
 * Commande /damier - Jeu de Dames contre le bot dans Messenger avec images
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande
 * @param {object} ctx - Contexte partagé du bot
 */

const axios = require('axios');

// ✅ État des parties de dames par utilisateur
const checkersGames = new Map();

// ✅ États possibles d'une partie
const GameState = {
    AWAITING_STARTER: 'awaiting_starter',
    PLAYING: 'playing',
    FINISHED: 'finished'
};

// ✅ Protection anti-spam
const userActionLocks = new Map();
const COOLDOWN_MS = 2000; // 2 secondes entre chaque action

// ✅ Classe pour gérer le jeu de Dames
class CheckersGame {
    constructor() {
        this.board = this.initBoard();
        this.currentPlayer = 'w'; // 'w' pour blancs, 'b' pour noirs
        this.mustCapture = null; // Pion qui doit continuer à capturer
    }

    initBoard() {
        // Plateau 8x8, les pions sont sur les cases noires
        // 'w' = pion blanc, 'W' = dame blanche
        // 'b' = pion noir, 'B' = dame noire
        // null = case vide
        const board = Array(8).fill(null).map(() => Array(8).fill(null));
        
        // Placement initial des pions noirs (en haut)
        for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 8; col++) {
                if ((row + col) % 2 === 1) {
                    board[row][col] = 'b';
                }
            }
        }
        
        // Placement initial des pions blancs (en bas)
        for (let row = 5; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                if ((row + col) % 2 === 1) {
                    board[row][col] = 'w';
                }
            }
        }
        
        return board;
    }

    getPiece(row, col) {
        if (row < 0 || row > 7 || col < 0 || col > 7) return undefined;
        return this.board[row][col];
    }

    setPiece(row, col, piece) {
        if (row >= 0 && row <= 7 && col >= 0 && col <= 7) {
            this.board[row][col] = piece;
        }
    }

    isValidSquare(row, col) {
        return row >= 0 && row <= 7 && col >= 0 && col <= 7 && (row + col) % 2 === 1;
    }

    getLegalMoves(row, col, capturesOnly = false) {
        const piece = this.getPiece(row, col);
        if (!piece) return [];

        const player = piece.toLowerCase();
        if (player !== this.currentPlayer) return [];

        const isKing = piece === piece.toUpperCase();
        const moves = [];
        const captures = [];

        // Directions pour les pions normaux
        const directions = isKing ? 
            [[-1, -1], [-1, 1], [1, -1], [1, 1]] : // Dame: toutes directions
            player === 'w' ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]]; // Pion: vers l'avant

        // Vérifier les mouvements simples et les captures
        for (const [dr, dc] of directions) {
            // Mouvement simple (pas de capture)
            const newRow = row + dr;
            const newCol = col + dc;
            
            if (this.isValidSquare(newRow, newCol) && !this.getPiece(newRow, newCol)) {
                if (!capturesOnly) {
                    moves.push({ from: [row, col], to: [newRow, newCol], capture: null });
                }
            }

            // Capture
            const jumpRow = row + 2 * dr;
            const jumpCol = col + 2 * dc;
            const capturedPiece = this.getPiece(newRow, newCol);
            
            if (capturedPiece && capturedPiece.toLowerCase() !== player &&
                this.isValidSquare(jumpRow, jumpCol) && !this.getPiece(jumpRow, jumpCol)) {
                captures.push({ 
                    from: [row, col], 
                    to: [jumpRow, jumpCol], 
                    capture: [newRow, newCol] 
                });
            }
        }

        // Les captures sont obligatoires
        return captures.length > 0 ? captures : moves;
    }

    getAllLegalMoves(player) {
        const allMoves = [];
        const allCaptures = [];

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = this.getPiece(row, col);
                if (piece && piece.toLowerCase() === player) {
                    const moves = this.getLegalMoves(row, col);
                    moves.forEach(move => {
                        if (move.capture) {
                            allCaptures.push(move);
                        } else {
                            allMoves.push(move);
                        }
                    });
                }
            }
        }

        // Les captures sont prioritaires
        return allCaptures.length > 0 ? allCaptures : allMoves;
    }

    makeMove(fromRow, fromCol, toRow, toCol) {
        const piece = this.getPiece(fromRow, fromCol);
        if (!piece) return { success: false, error: 'Aucun pion à cette position' };

        const moves = this.getLegalMoves(fromRow, fromCol);
        const move = moves.find(m => m.to[0] === toRow && m.to[1] === toCol);

        if (!move) {
            return { success: false, error: 'Mouvement illégal' };
        }

        // Si une capture multiple est en cours, vérifier la cohérence
        if (this.mustCapture && (fromRow !== this.mustCapture[0] || fromCol !== this.mustCapture[1])) {
            return { success: false, error: 'Vous devez continuer la capture avec le même pion' };
        }

        // Effectuer le mouvement
        this.setPiece(toRow, toCol, piece);
        this.setPiece(fromRow, fromCol, null);

        let captureNotation = '';
        let continueCapture = false;

        // Gérer la capture
        if (move.capture) {
            this.setPiece(move.capture[0], move.capture[1], null);
            captureNotation = 'x';
            
            // Vérifier si d'autres captures sont possibles avec ce pion
            const furtherCaptures = this.getLegalMoves(toRow, toCol, true);
            if (furtherCaptures.length > 0) {
                continueCapture = true;
                this.mustCapture = [toRow, toCol];
            } else {
                this.mustCapture = null;
            }
        } else {
            this.mustCapture = null;
        }

        // Promotion en dame
        let promotion = '';
        if (piece === 'w' && toRow === 0) {
            this.setPiece(toRow, toCol, 'W');
            promotion = '👑';
        } else if (piece === 'b' && toRow === 7) {
            this.setPiece(toRow, toCol, 'B');
            promotion = '👑';
        }

        // Si pas de capture multiple, changer de joueur
        if (!continueCapture) {
            this.currentPlayer = this.currentPlayer === 'w' ? 'b' : 'w';
        }

        const notation = `${this.posToNotation(fromRow, fromCol)}${captureNotation}${this.posToNotation(toRow, toCol)}${promotion}`;

        return { 
            success: true, 
            notation, 
            continueCapture,
            promotion: promotion !== ''
        };
    }

    posToNotation(row, col) {
        // Convertir position en notation (ex: a1, h8)
        return String.fromCharCode(97 + col) + (8 - row);
    }

    notationToPos(notation) {
        // Convertir notation en position
        if (notation.length < 2) return null;
        const col = notation.charCodeAt(0) - 97;
        const row = 8 - parseInt(notation[1]);
        return this.isValidSquare(row, col) ? [row, col] : null;
    }

    isGameOver() {
        const whitePieces = this.countPieces('w');
        const blackPieces = this.countPieces('b');
        
        if (whitePieces === 0) return { over: true, winner: 'b', reason: 'Plus de pions blancs' };
        if (blackPieces === 0) return { over: true, winner: 'w', reason: 'Plus de pions noirs' };

        const moves = this.getAllLegalMoves(this.currentPlayer);
        if (moves.length === 0) {
            const winner = this.currentPlayer === 'w' ? 'b' : 'w';
            return { over: true, winner, reason: 'Aucun coup légal' };
        }

        return { over: false };
    }

    countPieces(player) {
        let count = 0;
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = this.getPiece(row, col);
                if (piece && piece.toLowerCase() === player) {
                    count++;
                }
            }
        }
        return count;
    }

    getFEN() {
        // Format FEN simplifié pour les dames
        let fen = '';
        for (let row = 0; row < 8; row++) {
            let emptyCount = 0;
            for (let col = 0; col < 8; col++) {
                const piece = this.getPiece(row, col);
                if (piece) {
                    if (emptyCount > 0) {
                        fen += emptyCount;
                        emptyCount = 0;
                    }
                    fen += piece;
                } else {
                    emptyCount++;
                }
            }
            if (emptyCount > 0) fen += emptyCount;
            if (row < 7) fen += '/';
        }
        fen += ` ${this.currentPlayer}`;
        return fen;
    }
}

module.exports = async function cmdDamier(senderId, args, ctx) {
    const { log, addToMemory, sleep } = ctx;
    const senderIdStr = String(senderId);
    
    // ✅ PROTECTION ANTI-SPAM
    const now = Date.now();
    if (userActionLocks.has(senderIdStr)) {
        const lastAction = userActionLocks.get(senderIdStr);
        const timeSinceLastAction = now - lastAction;
        if (timeSinceLastAction < COOLDOWN_MS) {
            const remainingSeconds = Math.ceil((COOLDOWN_MS - timeSinceLastAction) / 1000);
            return `⏰ Patience ! Attends ${remainingSeconds}s ! 🎯`;
        }
    }
    userActionLocks.set(senderIdStr, now);
    
    // ✅ Récupérer la partie en cours si elle existe
    let gameData = checkersGames.get(senderIdStr);
    
    // ✅ Gestion des commandes
    const command = args.toLowerCase().trim();
    
    // Commande /damier (nouvelle partie ou aide)
    if (!command || command === 'aide' || command === 'help') {
        if (gameData && gameData.state !== GameState.FINISHED) {
            const boardImage = await generateBoardImage(gameData.game, gameData.userColor);
            
            return {
                type: "image",
                url: boardImage,
                caption: `🎯 Tu as une partie en cours !
            
📊 /damier etat - Voir la position
🎮 Envoie ton coup (ex: c3-d4, e6xc4)
🏳️ /damier abandon - Abandonner
🔄 /damier nouvelle - Nouvelle partie
            
💡 Ta partie est active ! Joue ton coup !`
            };
        }
        
        return `🎯 Jouer aux Dames avec moi ! ✨

🆕 /damier - Démarrer une partie
🎮 Format: a3-b4 ou c5xd6 (capture)
📊 /damier etat - Voir la position
🔄 /damier nouvelle - Nouvelle partie
🏳️ /damier abandon - Abandonner

💖 Prêt(e) pour une partie ? Tape /damier !`;
    }
    
    // ✅ Commande /damier nouvelle
    if (command === 'nouvelle' || command === 'new') {
        if (gameData && gameData.state === GameState.PLAYING) {
            return `⚠️ Tu as une partie en cours !
            
Options:
🏳️ /damier abandon - Abandonner l'ancienne
📊 /damier etat - Voir la position actuelle

Abandonne d'abord pour en créer une nouvelle ! 🎯`;
        }
        
        return await createNewGame(senderIdStr, log, addToMemory);
    }
    
    // ✅ Commande /damier etat
    if (command === 'etat' || command === 'status' || command === 'position') {
        if (!gameData || gameData.state === GameState.FINISHED) {
            return `❌ Aucune partie en cours !
            
🆕 Tape /damier pour démarrer ! 🎯`;
        }
        
        return await getGameStatus(gameData);
    }
    
    // ✅ Commande /damier abandon
    if (command === 'abandon' || command === 'quit' || command === 'stop') {
        if (!gameData || gameData.state === GameState.FINISHED) {
            return `❌ Aucune partie à abandonner !
            
🆕 Tape /damier pour démarrer ! 🎯`;
        }
        
        gameData.state = GameState.FINISHED;
        gameData.result = gameData.userColor === 'w' ? '0-1 (abandon)' : '1-0 (abandon)';
        checkersGames.set(senderIdStr, gameData);
        
        addToMemory(senderIdStr, 'user', 'Abandon de la partie de dames');
        addToMemory(senderIdStr, 'assistant', 'Partie abandonnée');
        
        log.info(`🏳️ ${senderId} a abandonné la partie de dames`);
        
        const boardImage = await generateBoardImage(gameData.game, gameData.userColor);
        
        return {
            type: "image",
            url: boardImage,
            caption: `🏳️ Partie abandonnée !
        
Résultat: ${gameData.result}
Coups joués: ${gameData.history.length}

🆕 Tape /damier pour une nouvelle partie ! 🎯💕`
        };
    }
    
    // ✅ Si pas de commande spéciale, traiter comme un coup ou réponse
    if (!gameData) {
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
            
🆕 Tape /damier nouvelle pour rejouer ! 🎯`;
        
        default:
            return "❌ Erreur d'état de partie ! Tape /damier nouvelle pour recommencer ! 💕";
    }
};

// ✅ FONCTION: Créer une nouvelle partie
async function createNewGame(senderId, log, addToMemory) {
    const game = new CheckersGame();
    
    const gameData = {
        game: game,
        state: GameState.AWAITING_STARTER,
        userColor: null,
        botColor: null,
        history: [],
        startTime: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
    };
    
    checkersGames.set(senderId, gameData);
    
    addToMemory(senderId, 'user', 'Nouvelle partie de dames');
    addToMemory(senderId, 'assistant', 'Partie créée - choix du joueur');
    
    log.info(`🎯 Nouvelle partie de dames créée pour ${senderId}`);
    
    return `🎯 Nouvelle partie de Dames ! ✨

🎮 Qui commence ?

👤 Réponds "moi" - Tu joues Blancs (en bas)
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
        checkersGames.set(senderId, gameData);
        
        addToMemory(senderId, 'user', 'Je commence (Blancs)');
        addToMemory(senderId, 'assistant', 'L\'utilisateur joue Blancs');
        
        log.info(`🎯 ${senderId} joue Blancs`);
        
        const boardImage = await generateBoardImage(gameData.game, gameData.userColor);
        
        return {
            type: "image",
            url: boardImage,
            caption: `✅ Tu joues les Blancs ! 🎯

🎮 À toi de jouer !
💡 Format: a3-b4 (mouvement)
💡 Format: c5xd6 (capture)

Les pions blancs sont en bas ! ⚪`
        };
    }
    
    if (normalized === 'toi' || normalized === 'bot' || normalized === 'noir' || normalized === 'noirs') {
        gameData.userColor = 'b';
        gameData.botColor = 'w';
        gameData.state = GameState.PLAYING;
        
        addToMemory(senderId, 'user', 'Tu commences (Blancs)');
        addToMemory(senderId, 'assistant', 'Le bot joue Blancs');
        
        log.info(`🎯 ${senderId} joue Noirs - Bot commence`);
        
        const botMoveResult = await makeBotMove(gameData, log);
        
        checkersGames.set(senderId, gameData);
        
        const boardImage = await generateBoardImage(gameData.game, gameData.userColor);
        
        return {
            type: "image",
            url: boardImage,
            caption: `✅ Je joue les Blancs ! 🎯

🤖 Mon coup: ${botMoveResult.move}
${botMoveResult.annotation}

🎮 À toi de jouer !
Les pions noirs sont en bas ! ⚫`
        };
    }
    
    if (!gameData.invalidResponses) {
        gameData.invalidResponses = 0;
    }
    gameData.invalidResponses++;
    
    if (gameData.invalidResponses >= 3) {
        checkersGames.delete(senderId);
        return `❌ Trop de réponses invalides !

Partie annulée. Tape /damier pour recommencer ! 💕`;
    }
    
    return `❌ Réponse non comprise ! Réponds:

👤 "moi" - Tu joues Blancs
🤖 "toi" - Je joue Blancs

Tentative ${gameData.invalidResponses}/3`;
}

// ✅ FONCTION: Gérer le coup de l'utilisateur
async function handleUserMove(senderId, moveText, gameData, log, addToMemory, sleep, ctx) {
    const game = gameData.game;
    
    if (game.currentPlayer !== gameData.userColor) {
        return `⏰ Ce n'est pas ton tour !

Attends mon coup ! 🎯`;
    }
    
    const cleanMove = moveText.trim().replace(/\s+/g, '');
    const moveResult = parseAndExecuteMove(game, cleanMove);
    
    if (!moveResult.success) {
        log.warning(`⚠️ ${senderId} coup invalide: ${moveText}`);
        
        const possibleMoves = game.getAllLegalMoves(gameData.userColor);
        const examples = possibleMoves.slice(0, 5).map(m => {
            const from = game.posToNotation(m.from[0], m.from[1]);
            const to = game.posToNotation(m.to[0], m.to[1]);
            return m.capture ? `${from}x${to}` : `${from}-${to}`;
        }).join(', ');
        
        return `❌ ${moveResult.error}

Format:
• a3-b4 (mouvement simple)
• c5xd6 (capture)

Exemples de coups: ${examples}

💡 Réessaie ! 🎯`;
    }
    
    gameData.history.push({
        player: 'user',
        move: moveResult.notation,
        fen: game.getFEN(),
        timestamp: new Date().toISOString()
    });
    gameData.lastUpdated = new Date().toISOString();
    
    addToMemory(senderId, 'user', `Coup de dames: ${moveResult.notation}`);
    log.info(`🎯 ${senderId} a joué: ${moveResult.notation}`);
    
    // Si capture multiple en cours
    if (moveResult.continueCapture) {
        checkersGames.set(senderId, gameData);
        const boardImage = await generateBoardImage(game, gameData.userColor);
        
        return {
            type: "image",
            url: boardImage,
            caption: `✅ Coup: ${moveResult.notation}

⚡ CAPTURE MULTIPLE !
Tu dois continuer à capturer avec le même pion !

🎮 Joue la suite de ta capture !`
        };
    }
    
    const gameOver = game.isGameOver();
    if (gameOver.over) {
        return await handleGameOver(senderId, gameData, log, addToMemory);
    }
    
    const botMoveResult = await makeBotMove(gameData, log);
    checkersGames.set(senderId, gameData);
    
    addToMemory(senderId, 'assistant', `Mon coup: ${botMoveResult.move}`);
    
    const gameOverAfterBot = game.isGameOver();
    if (gameOverAfterBot.over) {
        return await handleGameOver(senderId, gameData, log, addToMemory);
    }
    
    const boardImage = await generateBoardImage(game, gameData.userColor);
    
    return {
        type: "image",
        url: boardImage,
        caption: `✅ Tu as joué: ${moveResult.notation}

🤖 Mon coup: ${botMoveResult.move}
${botMoveResult.annotation}

🎮 À toi de jouer !`
    };
}

// ✅ FONCTION: Parser et exécuter un coup
function parseAndExecuteMove(game, moveText) {
    const captureMatch = moveText.match(/^([a-h][1-8])x([a-h][1-8])$/i);
    const simpleMatch = moveText.match(/^([a-h][1-8])-([a-h][1-8])$/i);
    
    let from, to;
    
    if (captureMatch) {
        from = game.notationToPos(captureMatch[1]);
        to = game.notationToPos(captureMatch[2]);
    } else if (simpleMatch) {
        from = game.notationToPos(simpleMatch[1]);
        to = game.notationToPos(simpleMatch[2]);
    } else {
        return { success: false, error: 'Format invalide' };
    }
    
    if (!from || !to) {
        return { success: false, error: 'Position invalide' };
    }
    
    return game.makeMove(from[0], from[1], to[0], to[1]);
}

// ✅ FONCTION: Le bot fait son coup
async function makeBotMove(gameData, log) {
    const game = gameData.game;
    const possibleMoves = game.getAllLegalMoves(gameData.botColor);
    
    if (possibleMoves.length === 0) {
        return { move: 'Aucun coup possible', annotation: '' };
    }
    
    let selectedMove;
    let annotation = '';
    
    if (Math.random() < 0.3) {
        selectedMove = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
        annotation = '🎲 (coup créatif)';
    } else {
        selectedMove = selectBestMove(game, possibleMoves);
        annotation = '🧠 (coup réfléchi)';
    }
    
    const result = game.makeMove(
        selectedMove.from[0], selectedMove.from[1],
        selectedMove.to[0], selectedMove.to[1]
    );
    
    if (result.success) {
        gameData.history.push({
            player: 'bot',
            move: result.notation,
            fen: game.getFEN(),
            timestamp: new Date().toISOString()
        });
        gameData.lastUpdated = new Date().toISOString();
        
        log.info(`🤖 Bot a joué: ${result.notation}`);
        
        return {
            move: result.notation,
            annotation: annotation
        };
    }
    
    return { move: 'Erreur', annotation: '' };
}

// ✅ FONCTION: Sélectionner le meilleur coup
function selectBestMove(game, moves) {
    let scoredMoves = moves.map(move => {
        let score = 0;
        
        // Priorité aux captures
        if (move.capture) {
            score += 50;
        }
        
        // Avancer vers la promotion
        const toRow = move.to[0];
        if (game.currentPlayer === 'w' && toRow < 2) {
            score += 10;
        } else if (game.currentPlayer === 'b' && toRow > 5) {
            score += 10;
        }
        
        // Contrôle du centre
        const toCenterDist = Math.abs(3.5 - move.to[0]) + Math.abs(3.5 - move.to[1]);
        score += (7 - toCenterDist);
        
        return { move, score };
    });
    
    scoredMoves.sort((a, b) => b.score - a.score);
    
    const topMoves = scoredMoves.slice(0, Math.min(3, scoredMoves.length));
    return topMoves[Math.floor(Math.random() * topMoves.length)].move;
}

// ✅ FONCTION: Gérer la fin de partie
async function handleGameOver(senderId, gameData, log, addToMemory) {
    const game = gameData.game;
    gameData.state = GameState.FINISHED;
    
    const gameOverInfo = game.isGameOver();
    const winner = gameOverInfo.winner;
    const userWon = winner === gameData.userColor;
    
    let result = winner === 'w' ? '1-0' : '0-1';
    let message = '';
    
    if (userWon) {
        message = `🎉 VICTOIRE ! Tu as gagné ! 👑

Résultat: ${result}
Raison: ${gameOverInfo.reason}
Coups joués: ${gameData.history.length}

Bravo champion ! 🏆💕`;
    } else {
        message = `🤖 J'ai gagné ! 🎯

Résultat: ${result}
Raison: ${gameOverInfo.reason}
Coups joués: ${gameData.history.length}

Bien joué ! Revanche ? 💕`;
    }
    
    gameData.result = result;
    checkersGames.set(senderId, gameData);
    
    addToMemory(senderId, 'assistant', `Partie terminée: ${result}`);
    log.info(`🎯 Partie de dames terminée pour ${senderId}: ${result}`);
    
    const boardImage = await generateBoardImage(game, gameData.userColor);
    
    return {
        type: "image",
        url: boardImage,
        caption: message + '\n\n🆕 Tape /damier nouvelle pour rejouer !'
    };
}

// ✅ FONCTION: Obtenir le statut de la partie
async function getGameStatus(gameData) {
    const game = gameData.game;
    const moveCount = gameData.history.length;
    const userColorName = gameData.userColor === 'w' ? 'Blancs' : 'Noirs';
    const currentTurn = game.currentPlayer === 'w' ? 'Blancs' : 'Noirs';
    const isUserTurn = game.currentPlayer === gameData.userColor;
    
    const whitePieces = game.countPieces('w');
    const blackPieces = game.countPieces('b');
    
    let caption = `📊 État de la partie 🎯

👤 Tu joues: ${userColorName}
🎮 Tour: ${currentTurn} ${isUserTurn ? '(À toi !)' : '(À moi !)'}
📈 Coups: ${moveCount}

⚪ Pions blancs: ${whitePieces}
⚫ Pions noirs: ${blackPieces}

`;
    
    if (gameData.history.length > 0) {
        caption += '📜 Derniers coups:\n';
        const recentMoves = gameData.history.slice(-6);
        recentMoves.forEach((entry) => {
            const icon = entry.player === 'user' ? '👤' : '🤖';
            caption += `${icon} ${entry.move}\n`;
        });
    }
    
    if (game.mustCapture) {
        caption += '\n⚡ CAPTURE MULTIPLE EN COURS !';
    }
    
    caption += `\n\n💡 ${isUserTurn ? 'Envoie ton coup !' : 'J\'y réfléchis...'}`;
    
    const boardImage = await generateBoardImage(game, gameData.userColor);
    
    return {
        type: "image",
        url: boardImage,
        caption: caption
    };
}

// ✅ FONCTION: Générer une image du plateau de dames
async function generateBoardImage(game, userColor) {
    const fen = game.getFEN();
    
    // Convertir le FEN des dames en format compatible pour l'image
    // On utilise un service de génération d'image de damier
    
    // Option 1: Générer via un service d'image de damier personnalisé
    // Pour l'instant, on utilise une URL avec les données du plateau
    
    const orientation = userColor === 'w' ? 'white' : 'black';
    
    // Créer une représentation visuelle simple du plateau
    const boardData = encodeURIComponent(fen);
    
    // URL vers un générateur d'image de damier (à adapter selon le service disponible)
    // Ici on utilise une approche similaire aux échecs avec un service générique
    
    // Option: Utiliser lichess avec adaptation ou un service dédié aux dames
    // Pour les dames, nous pouvons utiliser un service comme draughts.org ou créer notre propre rendu
    
    // Service de génération d'image de damier (exemple avec boardgame.io)
    const imageUrl = `https://draughts.org/board.png?fen=${boardData}&orientation=${orientation}&size=800`;
    
    // Alternative: Si pas de service disponible, utiliser une représentation ASCII stylisée
    // ou générer l'image côté serveur avec Canvas
    
    // Pour ce code, on suppose qu'un service existe ou qu'il faut l'implémenter
    // En attendant, on peut utiliser une URL placeholder ou générer l'image localement
    
    // Solution de secours: générer une URL avec les données encodées
    return `https://via.placeholder.com/800/8B4513/FFFFFF?text=${encodeURIComponent('Plateau de Dames')}`;
    
    // NOTE: Pour une vraie implémentation, il faudrait soit:
    // 1. Utiliser un vrai service de génération d'images de damier
    // 2. Créer un endpoint personnalisé qui génère l'image avec Canvas/Sharp
    // 3. Utiliser une librairie comme node-canvas pour générer l'image
}

// Alternative: Fonction pour générer l'image localement avec Canvas (si disponible)
async function generateBoardImageCanvas(game, userColor) {
    // Cette fonction nécessite 'canvas' installé: npm install canvas
    // const { createCanvas } = require('canvas');
    
    const size = 800;
    const squareSize = size / 8;
    
    // const canvas = createCanvas(size, size);
    // const ctx = canvas.getContext('2d');
    
    // Dessiner le plateau...
    // Cette implémentation nécessiterait plus de code
    // Pour l'instant, on utilise la solution externe
    
    return generateBoardImage(game, userColor);
}

// ✅ Nettoyage automatique des parties anciennes (plus de 7 jours)
setInterval(() => {
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    let cleanedCount = 0;
    
    for (const [userId, gameData] of checkersGames.entries()) {
        const lastUpdate = new Date(gameData.lastUpdated).getTime();
        if (now - lastUpdate > sevenDays) {
            checkersGames.delete(userId);
            cleanedCount++;
        }
    }
    
    if (cleanedCount > 0) {
        console.log(`🧹 ${cleanedCount} parties de dames anciennes nettoyées`);
    }
}, 24 * 60 * 60 * 1000); // Vérifier tous les jours

// ✅ Export de la classe CheckersGame pour utilisation externe si besoin
module.exports.CheckersGame = CheckersGame;
