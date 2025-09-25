/**
 * Commande /clan - Système de gestion de clans optimisé et compact
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande  
 * @param {object} ctx - Contexte partagé du bot 
 */
module.exports = async function cmdClan(senderId, args, ctx) {
    const { addToMemory, saveDataImmediate, sendMessage } = ctx;
    
    // Initialisation des données
    if (!ctx.clanData) {
        ctx.clanData = {
            clans: {}, userClans: {}, battles: {}, invites: {}, deletedClans: {}, counter: 0,
            lastWeeklyReward: 0, lastDailyCheck: 0, weeklyTop3: []
        };
        await saveDataImmediate();
        ctx.log.info("🏰 Structure des clans initialisée");
    }
    let data = ctx.clanData;
    
    const userId = String(senderId);
    const args_parts = args.trim().split(' ');
    const action = args_parts[0]?.toLowerCase();
    
    // === UTILITAIRES COMPACTS ===
    const generateId = (type) => {
        data.counter = (data.counter || 0) + 1;
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let id = '', num = data.counter + Date.now() % 10000;
        for (let i = 0; i < (type === 'clan' ? 4 : 3); i++) {
            id = chars[num % chars.length] + id;
            num = Math.floor(num / chars.length);
        }
        return id;
    };
    
    const getUserClan = () => data.userClans[userId] ? data.clans[data.userClans[userId]] : null;
    const findClan = (nameOrId) => data.clans[nameOrId.toUpperCase()] || Object.values(data.clans).find(c => c.name.toLowerCase() === nameOrId.toLowerCase());
    const isLeader = () => getUserClan()?.leader === userId;
    const canCreateClan = () => !data.deletedClans[userId] || (Date.now() - data.deletedClans[userId]) > (3 * 24 * 60 * 60 * 1000);
    
    const formatTime = (ms) => {
        const days = Math.floor(ms / (24 * 60 * 60 * 1000));
        const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
        const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
        return days > 0 ? `${days}j ${hours}h` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    };
    
    const calculatePower = (clan) => clan.level * 100 + clan.members.length * 50 + clan.units.w * 10 + clan.units.a * 8 + clan.units.m * 15 + Math.floor(clan.xp / 50) * 10;
    const isProtected = (clan) => (clan.lastDefeat && (Date.now() - clan.lastDefeat) < 600000) || (clan.lastVictory && (Date.now() - clan.lastVictory) < 600000);
    const canAttack = (attacker, defender) => !data.battles[`${attacker.id}-${defender.id}`] || (Date.now() - data.battles[`${attacker.id}-${defender.id}`]) >= 600000;
    
    const addXP = (clan, amount) => {
        clan.xp += amount;
        const newLevel = Math.floor(clan.xp / 1000) + 1;
        if (newLevel > clan.level) { clan.level = newLevel; return true; }
        return false;
    };
    
    const save = async () => { ctx.clanData = data; await saveDataImmediate(); };
    
    // Vérifications quotidiennes/hebdomadaires
    const checkRewards = async () => {
        const now = Date.now();
        // Aide quotidienne pour clans pauvres
        if (!data.lastDailyCheck || (now - data.lastDailyCheck) >= 86400000) {
            let rewarded = 0;
            for (const clan of Object.values(data.clans)) {
                if (clan.treasury === 0) {
                    clan.treasury = Math.floor(Math.random() * 41) + 60;
                    rewarded++;
                }
            }
            data.lastDailyCheck = now;
            if (rewarded > 0) await save();
        }
        
        // Récompenses hebdomadaires TOP 3
        if (!data.lastWeeklyReward || (now - data.lastWeeklyReward) >= 604800000) {
            const topClans = Object.values(data.clans).sort((a, b) => calculatePower(b) - calculatePower(a)).slice(0, 3);
            if (topClans.length >= 3) {
                const rewards = [{gold: 500, xp: 200, medal: '🥇'}, {gold: 300, xp: 150, medal: '🥈'}, {gold: 200, xp: 100, medal: '🥉'}];
                data.weeklyTop3 = [];
                for (let i = 0; i < 3; i++) {
                    topClans[i].treasury += rewards[i].gold;
                    addXP(topClans[i], rewards[i].xp);
                    data.weeklyTop3.push({name: topClans[i].name, medal: rewards[i].medal});
                }
                data.lastWeeklyReward = now;
                await save();
            }
        }
    };
    
    const notifyAttack = async (defenderId, attackerName, defenderName, result, xpGained, goldChange, losses) => {
        const resultText = result === 'victory' ? '🏆 VICTOIRE attaquant' : result === 'defeat' ? '💀 DÉFAITE attaquant' : '🤝 MATCH NUL';
        const goldText = goldChange > 0 ? `💰 +${goldChange} or volé` : goldChange < 0 ? `💰 ${goldChange} or perdu` : '💰 Pas de pillage';
        const notification = `⚔️ TON CLAN ATTAQUÉ !\n\n🔥 ${attackerName} VS ${defenderName}\n\n${resultText}\n✨ +${xpGained} XP gagné\n${goldText}\n\n💀 PERTES SUBIES:\n┣━━ 🗡️ -${losses.w} guerriers\n┣━━ 🏹 -${losses.a} archers\n┗━━ 🔮 -${losses.m} mages\n\n🛡️ Protection active 10min`;
        try { await sendMessage(defenderId, notification); } catch {}
    };
    
    await checkRewards();
    
    switch (action) {
        case 'create':
            const clanName = args_parts.slice(1).join(' ');
            if (!clanName) return "⚔️ CRÉER UN CLAN\n\n📝 Utilise: /clan create [nom du clan]\n💡 Deviens le chef de ton propre clan et recrute des guerriers !\n\n🏰 Exemple: /clan create Les Dragons Noirs\n\n🎯 Une fois créé, tu pourras:\n┣━━ Inviter des membres avec /clan invite\n┣━━ Acheter des unités pour ton armée\n┣━━ Attaquer d'autres clans pour gagner XP et or\n┗━━ Gravir le classement pour des récompenses hebdomadaires";
            if (getUserClan()) return "❌ Tu es déjà dans un clan ! Quitte-le d'abord avec /clan leave";
            if (!canCreateClan()) {
                const timeLeft = formatTime(3 * 24 * 60 * 60 * 1000 - (Date.now() - data.deletedClans[userId]));
                return `❌ Tu dois attendre encore ${timeLeft} avant de pouvoir recréer un clan (cooldown de 3 jours après dissolution)`;
            }
            if (findClan(clanName)) return "❌ Ce nom de clan est déjà pris ! Choisis-en un autre";
            
            const clanId = generateId('clan');
            data.clans[clanId] = { 
                id: clanId, name: clanName, leader: userId, members: [userId], 
                level: 1, xp: 0, treasury: 100, 
                units: { w: 10, a: 5, m: 2 }, 
                lastDefeat: null, lastVictory: null 
            };
            data.userClans[userId] = clanId;
            await save();
            
            return `╔═══════════╗\n║ 🔥 CLAN CRÉÉ 🔥 \n╚═══════════╝\n\n🏰 ${clanName}\n🆔 ${clanId} | 👑 Chef | 💰 100 pièces\n\n⚔️ ARMÉE DE DÉPART:\n┣━━ 🗡️ 10 guerriers (+100 pts puissance)\n┣━━ 🏹 5 archers (+40 pts puissance)\n┗━━ 🔮 2 mages (+30 pts puissance)\n\n🎯 Puissance totale: ${calculatePower(data.clans[clanId])} points\n\n💡 PROCHAINES ÉTAPES:\n┣━━ /clan invite @ami - Recruter des membres\n┣━━ /clan units - Acheter plus d'unités\n┣━━ /clan list - Voir les cibles à attaquer\n┗━━ /clan help - Guide complet\n\n╰─▸ Ton empire commence maintenant !`;

        case 'info':
            const clan = getUserClan();
            if (!clan) return "❌ PAS DE CLAN\n\n📝 Tu n'appartiens à aucun clan actuellement\n\n🏰 CRÉER TON CLAN:\n┣━━ /clan create [nom] - Deviens chef\n┣━━ Tu commences avec 100 pièces d'or\n┗━━ Armée de base: 10 guerriers, 5 archers, 2 mages\n\n📜 REJOINDRE UN CLAN EXISTANT:\n┣━━ /clan list - Voir tous les clans disponibles\n┣━━ Demande une invitation à un chef de clan\n┗━━ /clan join [id] - Rejoindre avec invitation\n\n💡 Les clans permettent de faire des batailles épiques et de gagner des récompenses !";
            
            const nextXP = (clan.level * 1000) - clan.xp;
            const protection = isProtected(clan) ? '🛡️ PROTÉGÉ' : '';
            const totalPower = calculatePower(clan);
            const isOwner = clan.leader === userId;
            try {
                    const imageUrl = 'https://raw.githubusercontent.com/Durand756/N-B-js/refs/heads/main/Cmds/imgs/CLAN-INFOS-NAKAMA.png';
                    await ctx.sendImageMessage(senderId, imageUrl);
                } catch (err) {
                    ctx.log.error(`❌ Erreur image: ${err.message}`);
                }
            let response = `╔═══════════╗\n║ 🏰 INFO CLAN 🏰 \n╚═══════════╝\n\n🏰 ${clan.name} ${protection}\n🆔 ${clan.id} | ⭐ Niveau ${clan.level} | 👥 ${clan.members.length}/20 membres\n⚡ Puissance totale: ${totalPower} points`;
            
            if (isOwner) response += `\n💰 Trésor: ${clan.treasury} pièces d'or`;
            
            response += `\n\n⚔️ COMPOSITION DE L'ARMÉE:\n┣━━ 🗡️ ${clan.units.w} guerriers (${clan.units.w * 10} pts)\n┣━━ 🏹 ${clan.units.a} archers (${clan.units.a * 8} pts)\n┗━━ 🔮 ${clan.units.m} mages (${clan.units.m * 15} pts)\n\n📊 CALCUL DE PUISSANCE:\n┣━━ Niveau ${clan.level} × 100 = ${clan.level * 100} pts\n┣━━ ${clan.members.length} membres × 50 = ${clan.members.length * 50} pts\n┣━━ Unités militaires = ${clan.units.w * 10 + clan.units.a * 8 + clan.units.m * 15} pts\n┗━━ Bonus XP = ${Math.floor(clan.xp / 50) * 10} pts`;
            
            if (isOwner) {
                response += `\n\n✨ PROGRESSION:\n┣━━ ${clan.xp} XP accumulée\n┗━━ ${nextXP} XP pour atteindre niveau ${clan.level + 1}\n\n💡 CONSEILS DE CHEF:\n┣━━ Les mages sont les plus puissants (15 pts chacun)\n┣━━ Plus de membres = plus de puissance\n┣━━ Attaque des clans plus faibles pour commencer\n┗━━ Monte de niveau pour débloquer plus de puissance`;
            }
            
            return response + `\n\n╰─▸ /clan help pour voir toutes les commandes`;

        case 'invite':
            if (!isLeader()) return "❌ RÉSERVÉ AU CHEF\n\n👑 Seul le chef du clan peut inviter de nouveaux membres\n💬 Demande au chef de t'inviter quelqu'un ou quitte le clan pour créer le tien\n\n📋 Pour voir qui est le chef: /clan info";
            const targetUser = args_parts[1]?.replace(/[<@!>]/g, '');
            if (!targetUser) return "⚔️ INVITER UN MEMBRE\n\n📝 Utilise: /clan invite @utilisateur\n💡 Invite quelqu'un à rejoindre ton clan\n\n👥 EXEMPLES:\n┣━━ /clan invite @ami123\n┣━━ /clan invite 1234567890 (ID utilisateur)\n┗━━ /clan invite @pseudo_discord\n\n📋 ASTUCES:\n┣━━ Plus de membres = plus de puissance au combat\n┣━━ Maximum 20 membres par clan\n┗━━ L'invité recevra une notification et pourra accepter avec /clan join";
            
            const inviterClan = getUserClan();
            if (inviterClan.members.length >= 20) return "❌ Clan complet ! Maximum 20 membres autorisés";
            if (data.userClans[targetUser]) return "❌ Cette personne appartient déjà à un clan !";
            
            if (!data.invites[targetUser]) data.invites[targetUser] = [];
            if (data.invites[targetUser].includes(inviterClan.id)) return "❌ Cette personne a déjà une invitation en attente de ton clan !";
            
            data.invites[targetUser].push(inviterClan.id);
            await save();
            return `╔═══════════╗\n║ 📨 INVITATION 📨 \n╚═══════════╝\n\n🏰 Invitation envoyée avec succès !\n👤 ${args_parts[1]} peut maintenant rejoindre ${inviterClan.name}\n🆔 Code clan: ${inviterClan.id}\n\n💡 IL/ELLE PEUT MAINTENANT:\n┣━━ /clan join ${inviterClan.id} - Rejoindre directement\n┣━━ /clan join - Voir toutes ses invitations\n┗━━ /clan list - Comparer avec d'autres clans\n\n📊 AVANTAGES DE RECRUTER:\n┣━━ +50 points de puissance par membre\n┣━━ Plus de chances de victoire en bataille\n┗━━ Construction d'un empire plus fort\n\n╰─▸ Attends sa réponse !`;

        case 'join':
            const joinArg = args_parts[1];
            if (!joinArg) {
                const myInvites = data.invites[userId] || [];
                if (myInvites.length === 0) return "❌ AUCUNE INVITATION\n\n📭 Tu n'as pas d'invitations en attente\n\n📜 COMMENT REJOINDRE UN CLAN:\n┣━━ /clan list - Voir tous les clans disponibles\n┣━━ Contacte un chef pour demander une invitation\n┣━━ Utilise /clan userid pour partager ton ID\n┗━━ Ou crée ton propre clan avec /clan create\n\n💡 Les chefs peuvent t'inviter avec /clan invite suivi de ton ID";
                
                let inviteList = "╔═══════════╗\n║ 📬 TES INVITATIONS 📬 \n╚═══════════╝\n\n";
                myInvites.forEach((clanId) => {
                    const c = data.clans[clanId];
                    if (c) {
                        const power = calculatePower(c);
                        inviteList += `🏰 ${c.name}\n┣━━ 🆔 ${clanId}\n┣━━ ⭐ Niveau ${c.level} | 👥 ${c.members.length}/20 membres\n┣━━ ⚡ ${power} points de puissance\n┣━━ 💰 Chef possède un trésor\n┗━━ 🗡️${c.units.w} 🏹${c.units.a} 🔮${c.units.m} (armée)\n\n`;
                    }
                });
                return inviteList + "💡 POUR REJOINDRE:\n┣━━ /clan join [id du clan]\n┗━━ /clan join [nom du clan]\n\n🎯 Choisis le clan qui te plaît le plus !";
            }
            
            if (getUserClan()) return "❌ Tu appartiens déjà à un clan ! Utilise /clan leave pour le quitter d'abord";
            const joinClan = findClan(joinArg);
            if (!joinClan) return "❌ CLAN INTROUVABLE\n\n🔍 Ce clan n'existe pas ou a été dissous\n📜 Vérifie la liste avec /clan list\n🆔 Assure-toi d'avoir le bon ID ou nom de clan\n\n💡 Format correct:\n┣━━ /clan join ABC123 (ID)\n┗━━ /clan join Les Dragons (nom exact)";
            if (!data.invites[userId]?.includes(joinClan.id)) return "❌ PAS D'INVITATION\n\n📭 Tu n'es pas invité dans ce clan\n💬 Demande une invitation au chef du clan\n📋 Son ID utilisateur est nécessaire pour l'invitation\n\n📜 Alternatives:\n┣━━ /clan list - Voir d'autres clans\n┗━━ /clan create - Créer ton propre clan";
            if (joinClan.members.length >= 20) return "❌ Ce clan est complet ! (20/20 membres maximum)";
            
            joinClan.members.push(userId);
            data.userClans[userId] = joinClan.id;
            data.invites[userId] = data.invites[userId].filter(id => id !== joinClan.id);
            await save();
            
            return `╔═══════════╗\n║ 🔥 BIENVENUE 🔥 \n╚═══════════╝\n\n🏰 Tu rejoins ${joinClan.name} !\n👥 ${joinClan.members.length}/20 guerriers dans le clan\n⭐ Niveau ${joinClan.level} | ⚡ ${calculatePower(joinClan)} points de puissance\n\n🎖️ TON NOUVEAU RÔLE:\n┣━━ Tu es maintenant un membre actif\n┣━━ Tu peux participer aux batailles\n┣━━ Tu contribues +50 pts de puissance au clan\n┗━━ Tu bénéficies des victoires collectives\n\n💡 TES NOUVELLES COMMANDES:\n┣━━ /clan info - Détails de ton clan\n┣━━ /clan battle [id] - Attaquer d'autres clans\n┣━━ /clan list - Voir les ennemis potentiels\n┗━━ /clan leave - Quitter si nécessaire\n\n╰─▸ Prêt pour la conquête !`;

        case 'leave':
            const leaveClan = getUserClan();
            if (!leaveClan) return "❌ PAS DE CLAN\n\n🏠 Tu n'appartiens à aucun clan actuellement\n🏰 Utilise /clan create [nom] pour créer ton propre clan\n📜 Ou /clan list pour voir les clans existants";
            
            if (isLeader() && leaveClan.members.length > 1) return "❌ CHEF AVEC MEMBRES\n\n👑 Tu es le chef et tu as encore des membres dans ton clan !\n\n🔄 SOLUTIONS:\n┣━━ /clan promote @membre - Nommer un nouveau chef\n┣━━ Attendre que tous les membres partent\n┗━━ Discuter avec ton clan pour organiser la succession\n\n💡 Un clan ne peut pas rester sans chef";
            
            if (isLeader()) {
                const clanName = leaveClan.name;
                leaveClan.members.forEach(memberId => delete data.userClans[memberId]);
                delete data.clans[leaveClan.id];
                data.deletedClans[userId] = Date.now();
                await save();
                
                return `╔═══════════╗\n║ 💥 CLAN DISSOUS 💥 \n╚═══════════╝\n\n🏰 ${clanName} n'existe plus\n⏰ Cooldown: 3 jours avant de pouvoir recréer un clan\n\n📊 STATISTIQUES FINALES:\n┣━━ Niveau atteint: ${leaveClan.level}\n┣━━ XP accumulée: ${leaveClan.xp}\n┣━━ Trésor final: ${leaveClan.treasury} pièces\n┗━━ Puissance maximale: ${calculatePower(leaveClan)} points\n\n💡 MAINTENANT TU PEUX:\n┣━━ /clan list - Explorer d'autres clans\n┣━━ Demander des invitations\n┗━━ Attendre 3 jours pour recréer un clan\n\n╰─▸ La fin d'un empire...`;
            } else {
                leaveClan.members = leaveClan.members.filter(id => id !== userId);
                delete data.userClans[userId];
                await save();
                return `╔═══════════╗\n║ 👋 DÉPART 👋 \n╚═══════════╝\n\n🏰 Tu quittes ${leaveClan.name}\n📉 Le clan perd 50 points de puissance (ton départ)\n\n💡 MAINTENANT TU PEUX:\n┣━━ /clan create [nom] - Créer ton propre clan\n┣━━ /clan list - Voir d'autres clans à rejoindre\n┣━━ /clan userid - Partager ton ID pour des invitations\n┗━━ Chercher un clan plus adapté à tes ambitions\n\n🎯 Chaque départ est un nouveau départ !\n\n╰─▸ Bonne chance dans tes futures conquêtes !`;
            }

        case 'battle':
            const attackerClan = getUserClan();
            if (!attackerClan) return "❌ PAS DE CLAN\n\n⚔️ Tu dois appartenir à un clan pour participer aux batailles !\n🏰 Crée ton clan avec /clan create [nom]\n📜 Ou rejoins-en un avec /clan list puis /clan join";
            
            const enemyArg = args_parts[1];
            if (!enemyArg) return "⚔️ SYSTÈME DE BATAILLE\n\n📝 Utilise: /clan battle [id ou nom du clan]\n💡 Attaque un autre clan pour gagner XP, or et monter au classement\n\n🎯 EXEMPLES:\n┣━━ /clan battle ABC123\n┣━━ /clan battle Les Vikings\n┗━━ /clan battle ENNEMI (nom exact)\n\n📊 MÉCANIQUES DE COMBAT:\n┣━━ Plus tu es puissant, plus tu as de chances de gagner\n┣━━ Victoire = +200 XP et vol d'or (max 25% du trésor ennemi)\n┣━━ Défaite = +50 XP et perte d'or (max 15% de ton trésor)\n┣━━ Match nul = +100 XP pour les deux clans\n\n⏰ RÈGLES:\n┣━━ 10 minutes de cooldown entre attaques du même clan\n┣━━ Protection de 10 minutes après chaque bataille\n┗━━ Pertes d'unités à chaque combat (reconstituables)\n\n🎯 Astuce: /clan list pour voir les cibles disponibles";
            
            const enemyClan = findClan(enemyArg);
            if (!enemyClan) return "❌ ENNEMI INTROUVABLE\n\n🔍 Ce clan n'existe pas ou a été dissous\n📜 Vérife la liste avec /clan list\n🆔 Assure-toi d'avoir le bon ID ou nom exact\n\n💡 Format correct:\n┣━━ /clan battle ABC123 (ID)\n┗━━ /clan battle Les Dragons (nom exact avec majuscules)";
            if (enemyClan.id === attackerClan.id) return "❌ Tu ne peux pas attaquer ton propre clan !";
            if (isProtected(enemyClan)) return `🛡️ CLAN PROTÉGÉ\n\n⏰ ${enemyClan.name} est actuellement protégé\n🕙 Protection de 10 minutes après chaque bataille\n⏳ Réessaie dans quelques minutes\n\n🎯 En attendant:\n┣━━ /clan list - Chercher d'autres cibles\n┣━━ /clan units - Renforcer ton armée\n┗━━ /clan info - Vérifier ta puissance`;
            if (!canAttack(attackerClan, enemyClan)) return `⏳ COOLDOWN ACTIF\n\n🕙 Tu as déjà attaqué ce clan récemment\n⏰ Attends 10 minutes entre chaque attaque du même clan\n🎯 Ou attaque un autre clan en attendant\n\n💡 Utilise /clan list pour voir d'autres cibles disponibles`;
            
            const attackerPower = calculatePower(attackerClan);
            const defenderPower = calculatePower(enemyClan);
            const powerDiff = attackerPower - defenderPower;
            
            let result, xpGain, goldChange, enemyXP, enemyGold;
            if (powerDiff === 0) {
                result = 'draw'; xpGain = 100; goldChange = 0; enemyXP = 100; enemyGold = 0;
            } else if (powerDiff > 0) {
                result = 'victory';
                xpGain = 200 + Math.floor(powerDiff / 10);
                goldChange = Math.min(150, Math.floor(enemyClan.treasury * 0.25));
                enemyXP = 50; enemyGold = -goldChange;
            } else {
                result = 'defeat';
                xpGain = 50;
                goldChange = -Math.min(100, Math.floor(attackerClan.treasury * 0.15));
                enemyXP = 150 + Math.floor(Math.abs(powerDiff) / 10);
                enemyGold = -goldChange;
            }
            
            const attackerLevelUp = addXP(attackerClan, xpGain);
            addXP(enemyClan, enemyXP);
            
            attackerClan.treasury = Math.max(0, attackerClan.treasury + goldChange);
            enemyClan.treasury = Math.max(0, enemyClan.treasury + enemyGold);
            
            // Calcul des pertes d'unités
            const calculateLosses = (clan, isAttacker, result, powerDiff) => {
                let lossRate = result === 'victory' ? (isAttacker ? 0.05 : 0.25) : 
                              result === 'defeat' ? (isAttacker ? 0.25 : 0.05) : 0.15;
                const diffModifier = Math.abs(powerDiff) / 1000;
                lossRate += diffModifier * (isAttacker ? 1 : -1) * 0.1;
                lossRate = Math.max(0.02, Math.min(0.4, lossRate));
                return {
                    w: Math.floor(clan.units.w * lossRate),
                    a: Math.floor(clan.units.a * lossRate),
                    m: Math.floor(clan.units.m * lossRate)
                };
            };
            
            const attackerLosses = calculateLosses(attackerClan, true, result, powerDiff);
            const defenderLosses = calculateLosses(enemyClan, false, result, powerDiff);
            
            attackerClan.units.w = Math.max(0, attackerClan.units.w - attackerLosses.w);
            attackerClan.units.a = Math.max(0, attackerClan.units.a - attackerLosses.a);
            attackerClan.units.m = Math.max(0, attackerClan.units.m - attackerLosses.m);
            
            enemyClan.units.w = Math.max(0, enemyClan.units.w - defenderLosses.w);
            enemyClan.units.a = Math.max(0, enemyClan.units.a - defenderLosses.a);
            enemyClan.units.m = Math.max(0, enemyClan.units.m - defenderLosses.m);
            
            if (result === 'victory') enemyClan.lastDefeat = Date.now();
            else if (result === 'defeat') enemyClan.lastVictory = Date.now();
            
            data.battles[`${attackerClan.id}-${enemyClan.id}`] = Date.now();
            await save();
            
            if (enemyClan.members[0] !== userId) {
                await notifyAttack(enemyClan.members[0], attackerClan.name, enemyClan.name, result, enemyXP, enemyGold, defenderLosses);
            }
            
            const isAttackerLeader = attackerClan.leader === userId;
            let battleResult = `╔═══════════╗\n║ ⚔️ RÉSULTAT BATAILLE ⚔️ \n╚═══════════╝\n\n🔥 ${attackerClan.name} VS ${enemyClan.name}\n\n`;
            
            if (isAttackerLeader) {
                battleResult += `📊 ANALYSE DES FORCES:\n┣━━ 🏰 Ton clan: ${Math.round(attackerPower)} pts\n┣━━ 🏰 Clan ennemi: ${Math.round(defenderPower)} pts\n┗━━ 📈 Différence: ${powerDiff > 0 ? '+' : ''}${powerDiff} pts\n\n`;
            }
            
            if (result === 'victory') {
                battleResult += `🏆 VICTOIRE ÉCRASANTE !\n✨ +${xpGain} XP gagné pour ton clan\n💰 +${goldChange} or pillé dans leur trésor${attackerLevelUp ? '\n🆙 NIVEAU UP ! Votre clan devient plus puissant !' : ''}\n\n💀 PERTES AU COMBAT:\n┣━━ 🗡️ -${attackerLosses.w} guerriers tombés\n┣━━ 🏹 -${attackerLosses.a} archers perdus\n┗━━ 🔮 -${attackerLosses.m} mages sacrifiés\n\n🎯 Leur clan a subi de lourdes pertes et est maintenant protégé 10 minutes`;
            } else if (result === 'defeat') {
                battleResult += `💀 DÉFAITE CUISANTE !\n✨ +${xpGain} XP d'expérience malgré la défaite\n💰 ${goldChange} or perdu (pillé par l'ennemi)\n\n💀 LOURDES PERTES SUBIES:\n┣━━ 🗡️ -${attackerLosses.w} guerriers tombés au combat\n┣━━ 🏹 -${attackerLosses.a} archers décimés\n┗━━ 🔮 -${attackerLosses.m} mages anéantis\n\n🔄 Ils sont maintenant protégés, prépare ta revanche !`;
            } else {
                battleResult += `🤝 MATCH NUL ÉPIQUE !\n✨ +${xpGain} XP d'expérience pour les deux clans\n💰 Aucun pillage - forces équilibrées\n\n💀 PERTES MODÉRÉES:\n┣━━ 🗡️ -${attackerLosses.w} guerriers blessés\n┣━━ 🏹 -${attackerLosses.a} archers touchés\n┗━━ 🔮 -${attackerLosses.m} mages épuisés\n\n⚖️ Combat équilibré - les deux clans se respectent`;
            }
            
            battleResult += `\n\n💡 CONSEILS POST-BATAILLE:\n┣━━ /clan units - Reconstituer ton armée\n┣━━ /clan info - Vérifier ta nouvelle puissance\n┣━━ /clan list - Chercher de nouvelles cibles\n┗━━ Recrute des mages (unités les plus puissantes)\n\n╰─▸ La guerre continue, prépare le prochain assaut !`;
            return battleResult;

        case 'list':
            const topClans = Object.values(data.clans).sort((a, b) => calculatePower(b) - calculatePower(a)).slice(0, 10);
            if (topClans.length === 0) return "❌ AUCUN CLAN EXISTANT\n\n🏜️ Aucun clan n'a encore été créé !\n🏰 Sois le premier à fonder un empire avec /clan create [nom]\n👑 Deviens une légende et domine le classement !";
            try {
                    const imageUrl = 'https://raw.githubusercontent.com/Durand756/N-B-js/refs/heads/main/Cmds/imgs/CLAN-TOP-NAKAMA.png';
                    await ctx.sendImageMessage(senderId, imageUrl);
                } catch (err) {
                    ctx.log.error(`❌ Erreur image: ${err.message}`);
                }
            let list = `╔═══════════╗\n║ 🏆 CLASSEMENT 🏆 \n╚═══════════╝\n\n`;
            
            if (data.weeklyTop3 && data.weeklyTop3.length > 0) {
                list += `🎉 DERNIERS GAGNANTS HEBDOMADAIRES:\n`;
                data.weeklyTop3.forEach(winner => list += `${winner.medal} ${winner.name}\n`);
                list += `\n`;
            }
            
            topClans.forEach((clan, i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
                const protection = isProtected(clan) ? '🛡️' : '⚔️';
                const power = calculatePower(clan);
                
                list += `${medal} ${clan.name} ${protection}\n┣━━ 🆔 ${clan.id}\n┣━━ ⭐ Niv.${clan.level} | 👥 ${clan.members.length}/20\n┣━━ 🗡️${clan.units.w} 🏹${clan.units.a} 🔮${clan.units.m}\n┗━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
            });
            
            list += `📊 TOTAL: ${Object.keys(data.clans).length} clans actifs\n\n💡 COMMANDES UTILES:\n┣━━ /clan battle [id] - Attaquer un clan\n┣━━ /clan info - Voir ton clan\n┣━━ /clan create [nom] - Créer le tien\n┗━━ /clan join [id] - Rejoindre un clan\n\n🏆 TOP 3 chaque semaine reçoivent des récompenses !`;
            return list;

        case 'units':
            const unitsClan = getUserClan();
            if (!unitsClan) return "❌ PAS DE CLAN\n\n⚔️ Tu dois appartenir à un clan pour gérer une armée !\n🏰 Crée ton clan avec /clan create [nom]";
            
            const unitType = args_parts[1]?.toLowerCase();
            const quantity = parseInt(args_parts[2]) || 1;
            try {
                    const imageUrl = 'https://raw.githubusercontent.com/Durand756/N-B-js/refs/heads/main/Cmds/imgs/CLAN-UNITS-NAKAMA.png';
                    await ctx.sendImageMessage(senderId, imageUrl);
                } catch (err) {
                    ctx.log.error(`❌ Erreur image: ${err.message}`);
                }
            if (!unitType) {
                return `╔═══════════╗\n║ ⚔️ GESTION ARMÉE ⚔️ \n╚═══════════╝\n\n🏰 ${unitsClan.name}\n💰 Trésor: ${unitsClan.treasury} pièces d'or\n\n📊 COMPOSITION ACTUELLE:\n┣━━ 🗡️ ${unitsClan.units.w} guerriers (${unitsClan.units.w * 10} pts)\n┣━━ 🏹 ${unitsClan.units.a} archers (${unitsClan.units.a * 8} pts)\n┗━━ 🔮 ${unitsClan.units.m} mages (${unitsClan.units.m * 15} pts)\n\n🛒 COÛTS ET EFFICACITÉ:\n┣━━ 🗡️ Guerrier: 40💰 = +10 pts (rapport 1:4)\n┣━━ 🏹 Archer: 60💰 = +8 pts (rapport 1:7.5)\n┗━━ 🔮 Mage: 80💰 = +15 pts (rapport 1:5.3) ⭐ OPTIMAL\n\n💡 COMMANDES D'ACHAT:\n┣━━ /clan units guerrier [nombre]\n┣━━ /clan units archer [nombre]\n┗━━ /clan units mage [nombre]\n\n🎯 STRATÉGIE RECOMMANDÉE:\n┣━━ Privilégie les mages (meilleur rapport qualité/prix)\n┣━━ Équilibre ton armée selon tes moyens\n┗━━ Après chaque bataille, reconstitue tes forces\n\n📈 Exemple: /clan units mage 5 (coût: 400💰, gain: +75 pts)`;
            }
            
            if (!isLeader()) return "❌ RÉSERVÉ AU CHEF\n\n👑 Seul le chef du clan peut acheter des unités militaires\n💬 Demande au chef de renforcer l'armée\n💡 Ou deviens chef en créant ton propre clan\n\n📋 Pour voir qui est le chef: /clan info";
            
            let cost = 0, unitKey = '', unitName = '', powerPerUnit = 0;
            if (['guerrier', 'g', 'warrior', 'w'].includes(unitType)) { 
                cost = 40 * quantity; unitKey = 'w'; unitName = 'guerriers'; powerPerUnit = 10; 
            } else if (['archer', 'a'].includes(unitType)) { 
                cost = 60 * quantity; unitKey = 'a'; unitName = 'archers'; powerPerUnit = 8; 
            } else if (['mage', 'm'].includes(unitType)) { 
                cost = 80 * quantity; unitKey = 'm'; unitName = 'mages'; powerPerUnit = 15; 
            } else return "❌ TYPE D'UNITÉ INVALIDE\n\n📝 Types disponibles:\n┣━━ guerrier (ou g) - 40💰 chacun\n┣━━ archer (ou a) - 60💰 chacun\n┗━━ mage (ou m) - 80💰 chacun\n\n💡 Exemple correct: /clan units mage 5";
            
            if (quantity < 1 || quantity > 50) return "❌ QUANTITÉ INVALIDE\n\n📊 Tu peux acheter entre 1 et 50 unités à la fois\n💡 Exemple: /clan units mage 10";
            
            if (unitsClan.treasury < cost) {
                const missing = cost - unitsClan.treasury;
                return `❌ FONDS INSUFFISANTS\n\n💰 Coût total: ${cost} pièces\n💰 Ton trésor: ${unitsClan.treasury} pièces\n💰 Il manque: ${missing} pièces\n\n💡 COMMENT GAGNER DE L'OR:\n┣━━ Attaque des clans plus faibles (victoire = vol d'or)\n┣━━ Monte de niveau (bonus de trésor)\n┣━━ Attends l'aide quotidienne si ton trésor = 0\n┗━━ Vise le TOP 3 hebdomadaire (récompenses massives)`;
            }
            
            unitsClan.treasury -= cost;
            unitsClan.units[unitKey] += quantity;
            await save();
            
            return `╔═══════════╗\n║ 🛒 RECRUTEMENT 🛒 \n╚═══════════╝\n\n⚔️ ${quantity} ${unitName} recrutés avec succès !\n💰 Trésor restant: ${unitsClan.treasury} pièces\n⚡ Gain de puissance: +${quantity * powerPerUnit} points\n📊 Total ${unitName}: ${unitsClan.units[unitKey]}\n\n📈 NOUVELLE PUISSANCE TOTALE:\n┗━━ ${calculatePower(unitsClan)} points (+${quantity * powerPerUnit})\n\n💡 MAINTENANT TU PEUX:\n┣━━ /clan battle [id] - Tester ta nouvelle force\n┣━━ /clan info - Admirer tes statistiques\n┣━━ /clan list - Chercher des cibles plus fortes\n┗━━ /clan units - Continuer le recrutement\n\n╰─▸ Ton armée grandit, tes ennemis tremblent !`;

        case 'promote':
            if (!isLeader()) return "❌ RÉSERVÉ AU CHEF\n\n👑 Seul le chef du clan peut nommer un successeur\n💡 Cette commande transfère définitivement le leadership\n🔄 Tu ne seras plus chef après l'opération";
            const newLeader = args_parts[1]?.replace(/[<@!>]/g, '');
            if (!newLeader) return "⚔️ NOMINATION D'UN NOUVEAU CHEF\n\n📝 Utilise: /clan promote @utilisateur\n💡 Transfère le leadership à un membre de ton clan\n\n👑 EXEMPLES:\n┣━━ /clan promote @membre123\n┣━━ /clan promote 1234567890 (ID utilisateur)\n┗━━ /clan promote @pseudo_discord\n\n⚠️ ATTENTION IMPORTANTE:\n┣━━ Tu ne seras plus le chef après cette action\n┣━━ Le nouveau chef aura tous les pouvoirs\n┣━━ Il pourra te re-promouvoir s'il le souhaite\n┗━━ Action irréversible une fois confirmée";
            
            const promoteClan = getUserClan();
            if (!promoteClan.members.includes(newLeader)) return "❌ MEMBRE INTROUVABLE\n\n👥 Cette personne n'est pas membre de ton clan\n📋 Vérife la liste des membres avec /clan info\n💡 Tu dois d'abord l'inviter avec /clan invite\n\n🔍 Assure-toi d'utiliser le bon ID utilisateur";
            
            promoteClan.leader = newLeader;
            await save();
            
            return `╔═══════════╗\n║ 👑 SUCCESSION 👑 \n╚═══════════╝\n\n🏰 ${promoteClan.name}\n👑 ${args_parts[1]} est maintenant le nouveau chef !\n🔄 Tu n'es plus le leader du clan\n\n💡 NOUVEAUX POUVOIRS DU CHEF:\n┣━━ Inviter et gérer les membres\n┣━━ Acheter des unités militaires\n┣━━ Accès complet au trésor du clan\n┣━━ Pouvoir de nommer un autre successeur\n┗━━ Responsabilité des décisions stratégiques\n\n🤝 Le clan continue sous une nouvelle direction !\n\n╰─▸ Longue vie au nouveau dirigeant !`;

        case 'userid':
            return `╔═══════════╗\n║ 🔍 TON IDENTIFIANT 🔍 \n╚═══════════╝\n\n👤 Ton ID utilisateur unique:\n🆔 ${userId}\n\n💡 UTILITÉS DE CET ID:\n┣━━ Les chefs peuvent t'inviter avec cet ID\n┣━━ Plus fiable que les pseudos (qui changent)\n┣━━ Nécessaire pour recevoir des invitations\n┗━━ Facilite la communication entre clans\n\n📋 COMMENT L'UTILISER:\n┣━━ Partage cet ID aux chefs de clan\n┣━━ Ils feront: /clan invite ${userId}\n┗━━ Tu recevras alors une invitation\n\n🎯 Copie-colle cet ID pour rejoindre des clans facilement !`;

        case 'help':
            // Envoi d'image comme dans le fichier original
               try {
                    const imageUrl = 'https://raw.githubusercontent.com/Durand756/N-B-js/refs/heads/main/Cmds/imgs/CLAN-HELP-NAKAMA.png';
                    await ctx.sendImageMessage(senderId, imageUrl);
                } catch (err) {
                    ctx.log.error(`❌ Erreur image: ${err.message}`);
                }

            
            return `╔═══════════╗\n║ ⚔️ GUIDE COMPLET ⚔️ \n╚═══════════╝\n\n🏰 GESTION DE BASE:\n┣━━ /clan create [nom] - Fonder ton empire\n┣━━ /clan info - Statistiques détaillées de ton clan\n┣━━ /clan list - Classement et cibles disponibles\n┗━━ /clan userid - Ton ID pour les invitations\n\n👥 GESTION D'ÉQUIPE:\n┣━━ /clan invite @user - Recruter un membre (chef)\n┣━━ /clan join [id] - Rejoindre un clan invité\n┣━━ /clan leave - Quitter ton clan actuel\n┗━━ /clan promote @user - Nommer un successeur (chef)\n\n⚔️ GUERRE ET STRATÉGIE:\n┣━━ /clan battle [id] - Attaquer pour XP/or\n┗━━ /clan units [type] [nb] - Recruter des soldats (chef)\n\n📊 SYSTÈME DE PUISSANCE:\n┣━━ Niveau × 100 + Membres × 50 + Unités + Bonus XP\n┣━━ 🗡️ Guerrier: 40💰 = +10 pts\n┣━━ 🏹 Archer: 60💰 = +8 pts  \n┗━━ 🔮 Mage: 80💰 = +15 pts (OPTIMAL)\n\n🎁 RÉCOMPENSES AUTOMATIQUES:\n┣━━ TOP 3 hebdomadaire = or/XP massifs\n┣━━ Aide quotidienne pour clans à 0💰\n┣━━ XP à chaque bataille (même en défaite)\n┗━━ Protection 10min après combat\n\n💡 STRATÉGIES GAGNANTES:\n┣━━ Recrute des mages (meilleur rapport)\n┣━━ Plus de membres = plus de puissance\n┣━━ Attaque des clans légèrement plus faibles\n┗━━ Monte de niveau pour débloquer la puissance\n\n🚀 COMMENT BIEN COMMENCER:\n┣━━ 1. Crée ton clan avec un nom épique\n┣━━ 2. Invite des amis pour grossir rapidement\n┣━━ 3. Achète des mages avec ton or de départ\n┣━━ 4. Attaque des clans plus faibles pour l'XP\n┗━━ 5. Vise le TOP 3 pour les récompenses\n\n╰─▸ Forge ton empire et deviens une légende ! 🔥`;

        default:
            const userClan = getUserClan();
            if (userClan) {
                const protection = isProtected(userClan) ? '🛡️ PROTÉGÉ' : '';
                const isOwner = userClan.leader === userId;
                const totalPower = calculatePower(userClan);
                let response = `╔═══════════╗\n║ ⚔️ APERÇU CLAN ⚔️ \n╚═══════════╝\n\n🏰 ${userClan.name} ${protection}\n🆔 ${userClan.id} | ⭐ Niveau ${userClan.level}\n👥 ${userClan.members.length}/20 membres | ⚡ ${totalPower} pts`;
                
                if (isOwner) response += `\n💰 Trésor: ${userClan.treasury} pièces`;
                
                response += `\n\n💡 COMMANDES PRINCIPALES:\n┣━━ /clan info - Statistiques complètes\n┣━━ /clan battle [id] - Partir en guerre\n┣━━ /clan list - Voir les ennemis potentiels`;
                
                if (isOwner) {
                    response += `\n┣━━ /clan units - Gérer ton armée\n┗━━ /clan invite @user - Recruter des guerriers`;
                } else {
                    response += `\n┗━━ /clan help - Guide stratégique complet`;
                }
                
                response += `\n\n🎯 Ton clan est ${Object.values(data.clans).sort((a,b) => calculatePower(b) - calculatePower(a)).findIndex(c => c.id === userClan.id) + 1}ème au classement !`;
                return response + `\n\n╰─▸ La domination t'attend !`;
            } else {
                return `╔═══════════╗\n║ ⚔️ SYSTÈME CLANS ⚔️ \n╚═══════════╝\n\n🚫 TU N'AS PAS DE CLAN\n\n🏰 CRÉER TON EMPIRE:\n┣━━ /clan create [nom] - Deviens chef !\n┣━━ Tu commences avec 100💰 et une armée de base\n┣━━ Recrute des membres pour grossir rapidement\n┗━━ Achète des unités pour dominer les batailles\n\n📜 REJOINDRE UN CLAN EXISTANT:\n┣━━ /clan list - Explorer tous les clans disponibles\n┣━━ /clan userid - Obtenir ton ID pour les invitations\n┣━━ Contacte un chef pour demander une invitation\n┗━━ /clan join [id] - Rejoindre avec invitation\n\n❓ GUIDE DÉTAILLÉ:\n┗━━ /clan help - Stratégies et mécaniques complètes\n\n💡 POURQUOI REJOINDRE UN CLAN:\n┣━━ Batailles épiques contre d'autres joueurs\n┣━━ Système de progression avec niveaux et XP\n┣━━ Récompenses hebdomadaires pour le TOP 3\n┣━━ Construction collaborative d'un empire\n┗━━ Stratégie, alliances et conquêtes\n\n🎯 Plus de ${Object.keys(data.clans).length} clans actifs t'attendent !\n\n╰─▸ Ton destin de conquérant commence ici !`;
            }
    }
};
