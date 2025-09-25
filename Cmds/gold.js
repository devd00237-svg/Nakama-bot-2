/**
 * Commande /gold - Administration des pièces d'or des clans (ADMIN ONLY)
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande
 * @param {object} ctx - Contexte partagé du bot
 */
module.exports = async function cmdGold(senderId, args, ctx) {
    const { isAdmin, saveDataImmediate } = ctx;
    
    // Vérification admin
    if (!isAdmin(senderId)) {
        return "❌ ACCÈS REFUSÉ\n\n🚫 Cette commande est réservée aux administrateurs du bot\n💡 Tape /help pour voir les commandes disponibles";
    }
    
    // Initialisation des données clans
    if (!ctx.clanData) {
        return "❌ SYSTÈME DE CLANS NON INITIALISÉ\n\n🏰 Aucun clan n'existe encore\n💡 Quelqu'un doit d'abord créer un clan avec /clan create";
    }
    
    const data = ctx.clanData;
    const args_parts = args.trim().split(' ');
    const action = args_parts[0]?.toLowerCase();
    const clanIdentifier = args_parts[1];
    const amount = parseInt(args_parts[2]) || 0;
    
    // Fonction utilitaire pour trouver un clan
    const findClan = (nameOrId) => {
        if (!nameOrId) return null;
        return data.clans[nameOrId.toUpperCase()] || 
               Object.values(data.clans).find(c => c.name.toLowerCase() === nameOrId.toLowerCase());
    };
    
    // Affichage de l'aide
    if (!action || action === 'help') {
        return `╔═══════════╗\n║ 👑 ADMIN GOLD 👑 \n╚═══════════╝\n\n💰 GESTION DES PIÈCES D'OR DES CLANS\n\n📝 COMMANDES:\n┣━━ /gold add [clan] [montant] - Ajouter des pièces\n┣━━ /gold remove [clan] [montant] - Retirer des pièces\n┣━━ /gold set [clan] [montant] - Définir le montant exact\n┗━━ /gold list - Voir tous les trésors\n\n💡 EXEMPLES:\n┣━━ /gold add ABC123 500\n┣━━ /gold remove "Les Dragons" 100\n┣━━ /gold set ENNX 1000\n┗━━ /gold list\n\n⚠️ RÉSERVÉ AUX ADMINISTRATEURS\n🎯 ${Object.keys(data.clans).length} clans actifs`;
    }
    
    // Liste des trésors
    if (action === 'list') {
        if (Object.keys(data.clans).length === 0) {
            return "❌ AUCUN CLAN EXISTANT\n\n🏜️ Aucun clan n'a encore été créé";
        }
        
        const clansSort = Object.values(data.clans).sort((a, b) => b.treasury - a.treasury);
        let list = `╔═══════════╗\n║ 💰 TRÉSORS CLANS 💰 \n╚═══════════╝\n\n`;
        
        clansSort.forEach((clan, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
            list += `${medal} ${clan.name}\n┣━━ 🆔 ${clan.id}\n┣━━ 💰 ${clan.treasury} pièces d'or\n┣━━ ⭐ Niveau ${clan.level}\n┗━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        });
        
        const totalGold = clansSort.reduce((sum, clan) => sum + clan.treasury, 0);
        list += `📊 TOTAL ÉCONOMIE: ${totalGold} pièces d'or`;
        return list;
    }
    
    // Vérifications communes pour add/remove/set
    if (['add', 'remove', 'set'].includes(action)) {
        if (!clanIdentifier) {
            return `❌ CLAN MANQUANT\n\n📝 Utilise: /gold ${action} [clan] [montant]\n💡 Exemple: /gold ${action} ABC123 500\n🔍 Tape /gold list pour voir tous les clans`;
        }
        
        const clan = findClan(clanIdentifier);
        if (!clan) {
            return `❌ CLAN INTROUVABLE\n\n🔍 Le clan "${clanIdentifier}" n'existe pas\n📜 Tape /gold list pour voir tous les clans disponibles`;
        }
        
        if (amount <= 0 || amount > 999999) {
            return `❌ MONTANT INVALIDE\n\n📊 Le montant doit être entre 1 et 999999\n💡 Montant reçu: ${amount}\n🔢 Utilise des nombres entiers uniquement`;
        }
        
        const oldAmount = clan.treasury;
        
        // Actions
        switch (action) {
            case 'add':
                clan.treasury = Math.min(999999, clan.treasury + amount);
                break;
            case 'remove':
                clan.treasury = Math.max(0, clan.treasury - amount);
                break;
            case 'set':
                clan.treasury = amount;
                break;
        }
        
        const newAmount = clan.treasury;
        const change = newAmount - oldAmount;
        
        await saveDataImmediate();
        
        const actionText = action === 'add' ? 'AJOUT' : action === 'remove' ? 'RETRAIT' : 'DÉFINITION';
        const changeText = change > 0 ? `+${change}` : change < 0 ? `${change}` : '0';
        
        return `╔═══════════╗\n║ ✅ ${actionText} EFFECTUÉ ✅ \n╚═══════════╝\n\n🏰 ${clan.name} (${clan.id})\n\n💰 MODIFICATION TRÉSOR:\n┣━━ Avant: ${oldAmount} pièces\n┣━━ Changement: ${changeText} pièces\n┗━━ Après: ${newAmount} pièces\n\n👑 Modifié par l'admin\n⏰ ${new Date().toLocaleString('fr-FR')}\n\n💡 Le clan sera notifié de ce changement lors de sa prochaine consultation`;
    }
    
    return `❌ ACTION INCONNUE\n\n📝 Actions disponibles: add, remove, set, list\n💡 Tape /gold help pour voir le guide complet`;
};
