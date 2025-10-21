/**
 * Commande /2048 - Jeu 2048 dans Messenger avec images
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande
 * @param {object} ctx - Contexte partagé du bot
 */

const axios = require('axios');

// ✅ État des parties de 2048 par utilisateur
const games2048 = new Map();

// ✅ États possibles d'une partie
const GameState = {
    PLAYING: 'playing',
    FINISHED: 'finished'
};

// ✅ Modes de difficulté
const DifficultyModes = {
    CLASSIQUE: { name: 'Classique', target: 2048, gridSize: 4, emoji: '😊' },
    DIFFICILE: { name: 'Difficile', target: 4096, gridSize: 4, emoji: '😤' },
    EXPERT: { name: 'Expert', target: 8192, gridSize: 4, emoji: '🧠' },
    GRAND: { name: 'Grand 5x5', target: 2048, gridSize: 5, emoji: '🎯' },
    GEANT: { name: 'Géant 6x6', target: 2048, gridSize: 6, emoji: '👑' }
};

// ✅ Protection anti-spam
const userActionLocks = new Map();
const COOLDOWN_MS = 1000; // 1 seconde entre chaque action

module.exports = async function cmd2048(senderId, args, ctx) {
    const { log, addToMemory, sleep, sendImageMessage } = ctx;
    const senderIdStr = String(senderId);
    
    // ✅ PROTECTION ANTI-SPAM
    const now = Date.now();
    if (userActionLocks.has(senderIdStr)) {
        const lastAction = userActionLocks.get(senderIdStr);
        const timeSinceLastAction = now - lastAction;
        if (timeSinceLastAction < COOLDOWN_MS) {
            const remainingSeconds = Math.ceil((COOLDOWN_MS - timeSinceLastAction) / 1000);
            return `⏰ Patience ! Attends ${remainingSeconds}s ! 🔢`;
        }
    }
    userActionLocks.set(senderIdStr, now);
    
    // ✅ Récupérer la partie en cours si elle existe
    let gameData = games2048.get(senderIdStr);
    
    // ✅ Gestion des commandes
    const command = args.toLowerCase().trim();
    
    // Commande /2048 (nouvelle partie ou aide)
    if (!command || command === 'aide' || command === 'help') {
        if (gameData && gameData.state === GameState.PLAYING) {
            const boardImage = await generateBoardImage(gameData);
            
            return {
                type: "image",
                url: boardImage,
                caption: `🔢 Tu as une partie en cours !
${gameData.mode.emoji} Mode: ${gameData.mode.name}

🎯 Score: ${gameData.score}
🏆 Objectif: ${gameData.mode.target}
🎮 Meilleure tuile: ${gameData.bestTile}

Commandes de déplacement:
⬆️ haut ou h
⬇️ bas ou b
⬅️ gauche ou g
➡️ droite ou d

📊 /2048 stats - Statistiques
🔄 /2048 nouvelle - Nouvelle partie
🏳️ /2048 abandon - Abandonner

💡 Continue à jouer ! 🎮`
            };
        }
        
        return `🔢 JOUER À 2048 ! 🎮

📖 COMMENT JOUER:
Combine les tuiles avec le même nombre !
2 + 2 = 4
4 + 4 = 8
8 + 8 = 16... jusqu'à 2048 ! 🏆

🎮 COMMANDES:
⬆️ haut (ou h) - Déplacer vers le haut
⬇️ bas (ou b) - Déplacer vers le bas
⬅️ gauche (ou g) - Déplacer vers la gauche
➡️ droite (ou d) - Déplacer vers la droite

🎚️ MODES DE JEU:
${DifficultyModes.CLASSIQUE.emoji} Classique - Atteins 2048 (4x4)
${DifficultyModes.DIFFICILE.emoji} Difficile - Atteins 4096 (4x4)
${DifficultyModes.EXPERT.emoji} Expert - Atteins 8192 (4x4)
${DifficultyModes.GRAND.emoji} Grand - Grille 5x5
${DifficultyModes.GEANT.emoji} Géant - Grille 6x6

🆕 /2048 nouvelle - Commencer à jouer
📊 /2048 stats - Voir tes statistiques

💡 Prêt(e) à relever le défi ? 🚀`;
    }
    
    // ✅ Commande /2048 nouvelle
    if (command === 'nouvelle' || command === 'new' || command === 'start') {
        if (gameData && gameData.state === GameState.PLAYING) {
            return `⚠️ Tu as une partie en cours !
            
Score actuel: ${gameData.score}
Meilleure tuile: ${gameData.bestTile}

Options:
🏳️ /2048 abandon - Abandonner l'ancienne
📊 /2048 stats - Voir la position actuelle

Abandonne d'abord pour en créer une nouvelle ! 🔢`;
        }
        
        return await createNewGame(senderIdStr, log, addToMemory);
    }
    
    // ✅ Commande /2048 stats
    if (command === 'stats' || command === 'statistiques' || command === 'status') {
        if (!gameData || gameData.state === GameState.FINISHED) {
            return await getPlayerStats(senderIdStr);
        }
        
        return await getCurrentGameStats(gameData);
    }
    
    // ✅ Commande /2048 abandon
    if (command === 'abandon' || command === 'quit' || command === 'stop') {
        if (!gameData || gameData.state === GameState.FINISHED) {
            return `❌ Aucune partie à abandonner !
            
🆕 Tape /2048 nouvelle pour démarrer ! 🔢`;
        }
        
        gameData.state = GameState.FINISHED;
        games2048.set(senderIdStr, gameData);
        
        // Sauvegarder les stats
        await saveGameStats(senderIdStr, gameData, false);
        
        addToMemory(senderIdStr, 'user', 'Abandon de la partie de 2048');
        addToMemory(senderIdStr, 'assistant', 'Partie abandonnée');
        
        log.info(`🏳️ ${senderId} a abandonné la partie de 2048`);
        
        const boardImage = await generateBoardImage(gameData);
        
        return {
            type: "image",
            url: boardImage,
            caption: `🏳️ Partie abandonnée !
        
Score final: ${gameData.score}
Meilleure tuile: ${gameData.bestTile}
Coups joués: ${gameData.moves}

🆕 Tape /2048 nouvelle pour rejouer ! 🔢💕`
        };
    }
    
    // ✅ Si c'est un choix de mode (1-5)
    if (gameData && gameData.awaitingMode) {
        return await handleModeSelection(senderIdStr, args, gameData, log, addToMemory);
    }
    
    // ✅ Si pas de commande spéciale, traiter comme un mouvement
    if (!gameData || gameData.state === GameState.FINISHED) {
        return await createNewGame(senderIdStr, log, addToMemory);
    }
    
    // ✅ Traiter le mouvement
    return await handleMove(senderIdStr, args, gameData, log, addToMemory, ctx);
};

// ✅ FONCTION: Créer une nouvelle partie
async function createNewGame(senderId, log, addToMemory) {
    const gameData = {
        awaitingMode: true,
        state: GameState.PLAYING,
        mode: null,
        grid: null,
        score: 0,
        moves: 0,
        bestTile: 0,
        startTime: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
    };
    
    games2048.set(senderId, gameData);
    
    addToMemory(senderId, 'user', 'Nouvelle partie de 2048');
    addToMemory(senderId, 'assistant', 'Choix du mode');
    
    log.info(`🔢 Nouvelle partie de 2048 créée pour ${senderId}`);
    
    return `🔢 Nouvelle partie de 2048 ! 🎮

🎚️ Choisis ton mode :

1️⃣ ${DifficultyModes.CLASSIQUE.emoji} Classique - Atteins 2048 (4x4)
2️⃣ ${DifficultyModes.DIFFICILE.emoji} Difficile - Atteins 4096 (4x4)
3️⃣ ${DifficultyModes.EXPERT.emoji} Expert - Atteins 8192 (4x4)
4️⃣ ${DifficultyModes.GRAND.emoji} Grand - Grille 5x5
5️⃣ ${DifficultyModes.GEANT.emoji} Géant - Grille 6x6

💡 Réponds avec le numéro (1 à 5) !`;
}

// ✅ FONCTION: Gérer la sélection du mode
async function handleModeSelection(senderId, response, gameData, log, addToMemory) {
    const normalized = response.trim();
    
    let selectedMode = null;
    
    if (normalized === '1' || normalized.toLowerCase().includes('classique')) {
        selectedMode = DifficultyModes.CLASSIQUE;
    } else if (normalized === '2' || normalized.toLowerCase().includes('difficile')) {
        selectedMode = DifficultyModes.DIFFICILE;
    } else if (normalized === '3' || normalized.toLowerCase().includes('expert')) {
        selectedMode = DifficultyModes.EXPERT;
    } else if (normalized === '4' || normalized.toLowerCase().includes('grand')) {
        selectedMode = DifficultyModes.GRAND;
    } else if (normalized === '5' || normalized.toLowerCase().includes('geant') || normalized.toLowerCase().includes('géant')) {
        selectedMode = DifficultyModes.GEANT;
    }
    
    if (!selectedMode) {
        if (!gameData.invalidResponses) gameData.invalidResponses = 0;
        gameData.invalidResponses++;
        
        if (gameData.invalidResponses >= 3) {
            games2048.delete(senderId);
            return `❌ Trop de réponses invalides ! Partie annulée.

🆕 Tape /2048 nouvelle pour recommencer ! 💕`;
        }
        
        return `❌ Mode non reconnu !

Réponds avec un numéro de 1 à 5
Tentative ${gameData.invalidResponses}/3 🔢`;
    }
    
    gameData.mode = selectedMode;
    gameData.awaitingMode = false;
    gameData.grid = initializeGrid(selectedMode.gridSize);
    addRandomTile(gameData.grid);
    addRandomTile(gameData.grid);
    
    games2048.set(senderId, gameData);
    
    addToMemory(senderId, 'user', `Mode choisi: ${selectedMode.name}`);
    
    log.info(`🔢 ${senderId} a choisi le mode ${selectedMode.name}`);
    
    const boardImage = await generateBoardImage(gameData);
    
    return {
        type: "image",
        url: boardImage,
        caption: `✅ Mode ${selectedMode.emoji} ${selectedMode.name} !

🎯 Objectif: Atteindre ${selectedMode.target}
🎮 Grille: ${selectedMode.gridSize}x${selectedMode.gridSize}

Commandes de déplacement:
⬆️ haut ou h
⬇️ bas ou b
⬅️ gauche ou g
➡️ droite ou d

💡 Combine les tuiles identiques ! 🚀`
    };
}

// ✅ FONCTION: Initialiser une grille vide
function initializeGrid(size) {
    const grid = [];
    for (let i = 0; i < size; i++) {
        grid[i] = [];
        for (let j = 0; j < size; j++) {
            grid[i][j] = 0;
        }
    }
    return grid;
}

// ✅ FONCTION: Ajouter une tuile aléatoire (2 ou 4)
function addRandomTile(grid) {
    const emptyCells = [];
    for (let i = 0; i < grid.length; i++) {
        for (let j = 0; j < grid[i].length; j++) {
            if (grid[i][j] === 0) {
                emptyCells.push({ row: i, col: j });
            }
        }
    }
    
    if (emptyCells.length === 0) return false;
    
    const randomCell = emptyCells[Math.floor(Math.random() * emptyCells.length)];
    // 90% de chance d'avoir un 2, 10% de chance d'avoir un 4
    grid[randomCell.row][randomCell.col] = Math.random() < 0.9 ? 2 : 4;
    return true;
}

// ✅ FONCTION: Gérer un mouvement
async function handleMove(senderId, moveText, gameData, log, addToMemory, ctx) {
    const normalized = moveText.toLowerCase().trim();
    
    let direction = null;
    
    // Déterminer la direction
    if (normalized === 'haut' || normalized === 'h' || normalized === 'up' || normalized === '⬆️') {
        direction = 'up';
    } else if (normalized === 'bas' || normalized === 'b' || normalized === 'down' || normalized === '⬇️') {
        direction = 'down';
    } else if (normalized === 'gauche' || normalized === 'g' || normalized === 'left' || normalized === '⬅️') {
        direction = 'left';
    } else if (normalized === 'droite' || normalized === 'd' || normalized === 'right' || normalized === '➡️') {
        direction = 'right';
    } else {
        return `❌ Direction non reconnue !

Commandes valides:
⬆️ haut ou h
⬇️ bas ou b
⬅️ gauche ou g
➡️ droite ou d

💡 Réessaie ! 🔢`;
    }
    
    // Sauvegarder l'ancienne grille pour vérifier si le mouvement est valide
    const oldGrid = JSON.parse(JSON.stringify(gameData.grid));
    const oldScore = gameData.score;
    
    // Effectuer le mouvement
    const moveResult = performMove(gameData, direction);
    
    if (!moveResult.moved) {
        return `❌ Mouvement impossible dans cette direction !

Essaie une autre direction ! 🔢`;
    }
    
    gameData.moves++;
    gameData.score += moveResult.scoreGained;
    gameData.lastUpdated = new Date().toISOString();
    
    // Ajouter une nouvelle tuile
    addRandomTile(gameData.grid);
    
    // Mettre à jour la meilleure tuile
    const maxTile = getMaxTile(gameData.grid);
    if (maxTile > gameData.bestTile) {
        gameData.bestTile = maxTile;
    }
    
    games2048.set(senderId, gameData);
    
    addToMemory(senderId, 'user', `Déplacement: ${direction}`);
    
    log.info(`🔢 ${senderId} a joué: ${direction} (+${moveResult.scoreGained} points)`);
    
    const boardImage = await generateBoardImage(gameData);
    
    // Vérifier si le joueur a gagné
    if (maxTile >= gameData.mode.target && !gameData.won) {
        gameData.won = true;
        await saveGameStats(senderId, gameData, true);
        
        await ctx.sendImageMessage(senderId, boardImage, `🎉 VICTOIRE ! Tu as atteint ${gameData.mode.target} ! 👑

Score: ${gameData.score}
Coups: ${gameData.moves}

Tu peux continuer à jouer pour améliorer ton score !
Ou tape /2048 nouvelle pour une nouvelle partie ! 🏆💕`);
        return;
    }
    
    // Vérifier si le jeu est terminé (plus de mouvements possibles)
    if (isGameOver(gameData.grid)) {
        gameData.state = GameState.FINISHED;
        await saveGameStats(senderId, gameData, false);
        
        await ctx.sendImageMessage(senderId, boardImage, `😢 GAME OVER ! Plus de mouvements possibles !

Score final: ${gameData.score}
Meilleure tuile: ${gameData.bestTile}
Coups joués: ${gameData.moves}

🆕 Tape /2048 nouvelle pour rejouer ! 💕`);
        return;
    }
    
    // Message normal après le mouvement
    let caption = `✅ Déplacement: ${getDirectionEmoji(direction)}

🎯 Score: ${gameData.score}`;
    
    if (moveResult.scoreGained > 0) {
        caption += ` (+${moveResult.scoreGained})`;
    }
    
    caption += `
🎮 Meilleure tuile: ${gameData.bestTile}
📊 Coups: ${gameData.moves}

Continue ! 🚀`;
    
    await ctx.sendImageMessage(senderId, boardImage, caption);
}

// ✅ FONCTION: Effectuer un mouvement
function performMove(gameData, direction) {
    const grid = gameData.grid;
    const size = grid.length;
    let moved = false;
    let scoreGained = 0;
    
    // Fonction pour déplacer et fusionner une ligne
    function processLine(line) {
        // Retirer les zéros
        let newLine = line.filter(cell => cell !== 0);
        
        // Fusionner les tuiles identiques adjacentes
        for (let i = 0; i < newLine.length - 1; i++) {
            if (newLine[i] === newLine[i + 1]) {
                newLine[i] *= 2;
                scoreGained += newLine[i];
                newLine.splice(i + 1, 1);
            }
        }
        
        // Remplir avec des zéros
        while (newLine.length < size) {
            newLine.push(0);
        }
        
        return newLine;
    }
    
    const oldGrid = JSON.stringify(grid);
    
    if (direction === 'left') {
        for (let i = 0; i < size; i++) {
            grid[i] = processLine(grid[i]);
        }
    } else if (direction === 'right') {
        for (let i = 0; i < size; i++) {
            grid[i] = processLine(grid[i].reverse()).reverse();
        }
    } else if (direction === 'up') {
        for (let j = 0; j < size; j++) {
            let column = [];
            for (let i = 0; i < size; i++) {
                column.push(grid[i][j]);
            }
            column = processLine(column);
            for (let i = 0; i < size; i++) {
                grid[i][j] = column[i];
            }
        }
    } else if (direction === 'down') {
        for (let j = 0; j < size; j++) {
            let column = [];
            for (let i = 0; i < size; i++) {
                column.push(grid[i][j]);
            }
            column = processLine(column.reverse()).reverse();
            for (let i = 0; i < size; i++) {
                grid[i][j] = column[i];
            }
        }
    }
    
    moved = oldGrid !== JSON.stringify(grid);
    
    return { moved, scoreGained };
}

// ✅ FONCTION: Obtenir la tuile maximale
function getMaxTile(grid) {
    let max = 0;
    for (let i = 0; i < grid.length; i++) {
        for (let j = 0; j < grid[i].length; j++) {
            if (grid[i][j] > max) {
                max = grid[i][j];
            }
        }
    }
    return max;
}

// ✅ FONCTION: Vérifier si le jeu est terminé
function isGameOver(grid) {
    const size = grid.length;
    
    // Vérifier s'il reste des cases vides
    for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
            if (grid[i][j] === 0) return false;
        }
    }
    
    // Vérifier s'il y a des mouvements possibles (tuiles adjacentes identiques)
    for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
            const current = grid[i][j];
            
            // Vérifier à droite
            if (j < size - 1 && grid[i][j + 1] === current) return false;
            
            // Vérifier en bas
            if (i < size - 1 && grid[i + 1][j] === current) return false;
        }
    }
    
    return true;
}

// ✅ FONCTION: Obtenir l'emoji de direction
function getDirectionEmoji(direction) {
    const emojis = {
        'up': '⬆️ Haut',
        'down': '⬇️ Bas',
        'left': '⬅️ Gauche',
        'right': '➡️ Droite'
    };
    return emojis[direction] || direction;
}

// ✅ FONCTION: Obtenir les statistiques de la partie en cours
async function getCurrentGameStats(gameData) {
    const boardImage = await generateBoardImage(gameData);
    
    const movesPerMinute = gameData.moves / ((Date.now() - new Date(gameData.startTime).getTime()) / 60000);
    
    return {
        type: "image",
        url: boardImage,
        caption: `📊 Statistiques de la partie 🔢

${gameData.mode.emoji} Mode: ${gameData.mode.name}
🎯 Score: ${gameData.score}
🎮 Meilleure tuile: ${gameData.bestTile}
📈 Coups: ${gameData.moves}
⚡ Coups/min: ${movesPerMinute.toFixed(1)}

Continue ! Tu peux le faire ! 💪`
    };
}

// ✅ FONCTION: Obtenir les statistiques globales du joueur
async function getPlayerStats(senderId) {
    // Cette fonction nécessiterait une base de données
    // Pour l'instant, retour simple
    return `📊 Statistiques globales 🔢

🎮 Parties jouées: 0
🏆 Parties gagnées: 0
🎯 Score total: 0
⭐ Meilleur score: 0

🆕 Tape /2048 nouvelle pour commencer ! 🚀`;
}

// ✅ FONCTION: Sauvegarder les statistiques
async function saveGameStats(senderId, gameData, won) {
    // Cette fonction sauvegarderait dans une DB
    // Pour l'instant, juste un log
    console.log(`📊 Stats pour ${senderId}: Score ${gameData.score}, Gagné: ${won}`);
}

// ✅ FONCTION: Générer une image de la grille
async function generateBoardImage(gameData) {
    // Créer une représentation HTML/CSS de la grille
    const grid = gameData.grid;
    const size = grid.length;
    
    // Couleurs des tuiles basées sur leur valeur
    const tileColors = {
        0: '#cdc1b4',
        2: '#eee4da',
        4: '#ede0c8',
        8: '#f2b179',
        16: '#f59563',
        32: '#f67c5f',
        64: '#f65e3b',
        128: '#edcf72',
        256: '#edcc61',
        512: '#edc850',
        1024: '#edc53f',
        2048: '#edc22e',
        4096: '#3c3a32',
        8192: '#3c3a32'
    };
    
    const textColors = {
        0: '#776e65',
        2: '#776e65',
        4: '#776e65',
        8: '#f9f6f2',
        16: '#f9f6f2',
        32: '#f9f6f2',
        64: '#f9f6f2',
        128: '#f9f6f2',
        256: '#f9f6f2',
        512: '#f9f6f2',
        1024: '#f9f6f2',
        2048: '#f9f6f2',
        4096: '#f9f6f2',
        8192: '#f9f6f2'
    };
    
    // Construire le HTML
    let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body {
            margin: 0;
            padding: 20px;
            background: #faf8ef;
            font-family: 'Arial', sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
        }
        .container {
            text-align: center;
        }
        .header {
            margin-bottom: 20px;
        }
        .title {
            font-size: 48px;
            font-weight: bold;
            color: #776e65;
            margin: 0;
        }
        .score-container {
            display: flex;
            justify-content: center;
            gap: 20px;
            margin: 20px 0;
        }
        .score-box {
            background: #bbada0;
            padding: 15px 25px;
            border-radius: 8px;
            color: white;
        }
        .score-label {
            font-size: 14px;
            text-transform: uppercase;
            margin-bottom: 5px;
        }
        .score-value {
            font-size: 24px;
            font-weight: bold;
        }
        .grid-container {
            background: #bbada0;
            border-radius: 10px;
            padding: 15px;
            display: inline-block;
        }
        .grid {
            display: grid;
            grid-template-columns: repeat(${size}, 1fr);
            gap: 15px;
        }
        .tile {
            width: ${size <= 4 ? 100 : size === 5 ? 80 : 60}px;
            height: ${size <= 4 ? 100 : size === 5 ? 80 : 60}px;
            border-radius: 5px;
            display: flex;
            justify-content: center;
            align-items: center;
            font-size: ${size <= 4 ? 40 : size === 5 ? 32 : 24}px;
            font-weight: bold;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1 class="title">2048</h1>
        </div>
        <div class="score-container">
            <div class="score-box">
                <div class="score-label">Score</div>
                <div class="score-value">${gameData.score}</div>
            </div>
            <div class="score-box">
                <div class="score-label">Meilleur</div>
                <div class="score-value">${gameData.bestTile}</div>
            </div>
        </div>
        <div class="grid-container">
            <div class="grid">`;
    
    for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
            const value = grid[i][j];
            const bgColor = tileColors[value] || tileColors[8192];
            const textColor = textColors[value] || textColors[8192];
            const displayValue = value === 0 ? '' : value;
            
            html += `<div class="tile" style="background-color: ${bgColor}; color: ${textColor};">${displayValue}</div>`;
        }
    }
    
    html += `
            </div>
        </div>
    </div>
</body>
</html>`;
    
    // Utiliser un service de screenshot HTML to Image
    // Option 1: htmlcsstoimage.com (nécessite API key)
    // Option 2: quickchart.io (gratuit)
    
    const encodedHtml = encodeURIComponent(html);
    const imageUrl = `https://quickchart.io/chart?c=${encodedHtml}`;
    
    // Alternative: Créer une image avec Canvas via un service
    // Pour l'instant, retourner une URL placeholder qui affiche la grille en texte
    return `https://via.placeholder.com/600x600/faf8ef/776e65?text=2048+Game+Board`;
}

// ✅ Nettoyage automatique des parties anciennes
setInterval(() => {
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    let cleanedCount = 0;
    
    for (const [userId, gameData] of games2048.entries()) {
        const lastUpdate = new Date(gameData.lastUpdated).getTime();
        if (now - lastUpdate > sevenDays) {
            games2048.delete(userId);
            cleanedCount++;
        }
    }
    
    if (cleanedCount > 0) {
        console.log(`🧹 ${cleanedCount} parties de 2048 anciennes nettoyées`);
    }
}, 24 * 60 * 60 * 1000); // Vérifier tous les jours
