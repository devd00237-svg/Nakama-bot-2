const axios = require('axios');

/**
 * Système de recherche en temps réel pour NakamaBot
 * Utilise des APIs gratuites pour obtenir des informations actuelles
 * Sans clés d'accès, sans modification du serveur principal
 */
 
// ✅ CONFIGURATION DES APIs GRATUITES
const APIs = {
    // API pour l'heure mondiale (gratuite, sans clé)
    worldTime: 'http://worldtimeapi.org/api/timezone',
    
    // API de recherche alternative (gratuite, sans clé)
    search: {
        duckduckgo: 'https://api.duckduckgo.com/',
        wikipedia: 'https://fr.wikipedia.org/api/rest_v1/page/summary',
        news: 'https://newsapi.org/v2/everything' // Nécessite clé mais optionnelle
    },
    
    // APIs d'informations générales
    weather: 'http://api.openweathermap.org/data/2.5/weather', // Optionnelle avec clé
    facts: 'https://uselessfacts.jsph.pl/random.json?language=en',
    quotes: 'https://api.quotable.io/random',
    
    // API géolocalisation (gratuite)
    ip: 'http://ip-api.com/json',
    
    // API de conversion (gratuite)
    exchange: 'https://api.exchangerate-api.com/v4/latest/USD'
};

// ✅ FONCTION PRINCIPALE: Recherche intelligente en temps réel
async function performRealTimeSearch(query, ctx) {
    const { log } = ctx;
    
    try {
        log.info(`🔍 Recherche temps réel: "${query}"`);
        
        // Analyser le type de requête
        const searchType = analyzeSearchType(query);
        
        switch (searchType.type) {
            case 'datetime':
                return await getCurrentDateTime(searchType.timezone);
                
            case 'weather':
                return await getWeatherInfo(searchType.location);
                
            case 'news':
                return await getLatestNews(searchType.topic);
                
            case 'wikipedia':
                return await searchWikipedia(searchType.topic);
                
            case 'facts':
                return await getRandomFact();
                
            case 'quotes':
                return await getRandomQuote();
                
            case 'currency':
                return await getCurrencyExchange(searchType.from, searchType.to);
                
            case 'general':
            default:
                return await performGeneralSearch(query);
        }
        
    } catch (error) {
        log.error(`❌ Erreur recherche temps réel: ${error.message}`);
        return `Oups ! Une petite erreur dans ma recherche temps réel... 🔍💕 Mais je peux quand même t'aider avec mes connaissances !`;
    }
}

// ✅ ANALYSER LE TYPE DE RECHERCHE
function analyzeSearchType(query) {
    const lowerQuery = query.toLowerCase();
    
    // Détection de date/heure
    if (/(?:heure|date|aujourd|maintenant|current|time|now|quelle heure)/i.test(query)) {
        const timezoneMatch = query.match(/(?:à|en|in)\s+([a-zA-ZÀ-ÿ\s]+)/i);
        return {
            type: 'datetime',
            timezone: timezoneMatch ? timezoneMatch[1].trim() : 'Europe/Paris'
        };
    }
    
    // Détection météo
    if (/(?:météo|weather|température|temp|climat|pluie|soleil)/i.test(query)) {
        const locationMatch = query.match(/(?:à|en|in|de|du|des)\s+([a-zA-ZÀ-ÿ\s]+)/i);
        return {
            type: 'weather',
            location: locationMatch ? locationMatch[1].trim() : 'Paris'
        };
    }
    
    // Détection actualités
    if (/(?:actualité|news|nouvelle|info|dernière|récent)/i.test(query)) {
        const topicMatch = query.match(/(?:sur|about|concernant)\s+([a-zA-ZÀ-ÿ\s]+)/i);
        return {
            type: 'news',
            topic: topicMatch ? topicMatch[1].trim() : 'général'
        };
    }
    
    // Détection Wikipedia
    if (/(?:qu'est-ce que|qui est|what is|définition|define|wikipedia)/i.test(query)) {
        const topicMatch = query.match(/(?:qu'est-ce que|qui est|what is|définition|define)\s+([a-zA-ZÀ-ÿ\s]+)/i);
        return {
            type: 'wikipedia',
            topic: topicMatch ? topicMatch[1].trim() : query
        };
    }
    
    // Détection faits amusants
    if (/(?:fait|fact|anecdote|saviez-vous|did you know)/i.test(query)) {
        return { type: 'facts' };
    }
    
    // Détection citations
    if (/(?:citation|quote|phrase|inspiration)/i.test(query)) {
        return { type: 'quotes' };
    }
    
    // Détection devise
    if (/(?:euro|dollar|devise|currency|change|conversion)/i.test(query)) {
        const currencyMatch = query.match(/(\w{3})\s+(?:en|to|vers)\s+(\w{3})/i);
        return {
            type: 'currency',
            from: currencyMatch ? currencyMatch[1].toUpperCase() : 'USD',
            to: currencyMatch ? currencyMatch[2].toUpperCase() : 'EUR'
        };
    }
    
    return { type: 'general', query: query };
}

// ✅ OBTENIR DATE ET HEURE ACTUELLES
async function getCurrentDateTime(timezone = 'Europe/Paris') {
    try {
        // Normaliser les noms de timezone
        const timezoneMap = {
            'paris': 'Europe/Paris',
            'londres': 'Europe/London',
            'new york': 'America/New_York',
            'tokyo': 'Asia/Tokyo',
            'sydney': 'Australia/Sydney',
            'montreal': 'America/Montreal',
            'cameroun': 'Africa/Douala',
            'douala': 'Africa/Douala'
        };
        
        const normalizedTimezone = timezoneMap[timezone.toLowerCase()] || timezone;
        
        const response = await axios.get(`${APIs.worldTime}/${normalizedTimezone}`, {
            timeout: 5000
        });
        
        if (response.status === 200) {
            const data = response.data;
            const date = new Date(data.datetime);
            
            const options = {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                timeZoneName: 'short'
            };
            
            const formattedDate = date.toLocaleDateString('fr-FR', options);
            
            return `🕐 **Date et heure actuelles** (${data.timezone}) :\n\n📅 ${formattedDate}\n\n⏰ Il est exactement **${date.getHours()}h${date.getMinutes().toString().padStart(2, '0')}** !\n\n🌍 Fuseau horaire : ${data.abbreviation}`;
        }
    } catch (error) {
        // Fallback avec date locale
        const now = new Date();
        const options = {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        };
        
        const fallbackDate = now.toLocaleDateString('fr-FR', options);
        return `🕐 **Date et heure** (heure locale) :\n\n📅 ${fallbackDate}\n\n💕 (API temporairement indisponible, mais voici l'heure locale !)`;
    }
}

// ✅ RECHERCHE SUR WIKIPEDIA
async function searchWikipedia(topic) {
    try {
        const encodedTopic = encodeURIComponent(topic);
        const response = await axios.get(`${APIs.search.wikipedia}/${encodedTopic}`, {
            timeout: 8000
        });
        
        if (response.status === 200) {
            const data = response.data;
            let result = `📚 **${data.title}** (Wikipedia)\n\n`;
            
            if (data.extract) {
                result += `${data.extract.substring(0, 400)}${data.extract.length > 400 ? '...' : ''}\n\n`;
            }
            
            if (data.pageprops && data.pageprops.wikibase_item) {
                result += `🔗 Plus d'infos : ${data.content_urls.desktop.page}\n\n`;
            }
            
            result += `✨ Source : Wikipedia (mise à jour en temps réel)`;
            
            return result;
        }
    } catch (error) {
        return `📚 Désolée, je n'ai pas trouvé d'informations récentes sur "${topic}" sur Wikipedia... Mais je peux quand même t'aider avec mes connaissances ! 💕`;
    }
}

// ✅ OBTENIR UN FAIT AMUSANT
async function getRandomFact() {
    try {
        const response = await axios.get(APIs.facts, {
            timeout: 5000
        });
        
        if (response.status === 200) {
            const fact = response.data.text;
            return `🤔 **Fait amusant du jour** :\n\n"${fact}"\n\n✨ Source : API temps réel des faits amusants !`;
        }
    } catch (error) {
        return `🤔 Oups ! Impossible d'obtenir un fait amusant en temps réel... Mais tu sais quoi ? Tu es une personne formidable ! 💕`;
    }
}

// ✅ OBTENIR UNE CITATION
async function getRandomQuote() {
    try {
        const response = await axios.get(APIs.quotes, {
            timeout: 5000
        });
        
        if (response.status === 200) {
            const quote = response.data;
            return `💭 **Citation inspirante** :\n\n"${quote.content}"\n\n✍️ — ${quote.author}\n\n✨ Source : API temps réel de citations`;
        }
    } catch (error) {
        return `💭 Impossible d'obtenir une citation en temps réel... Mais voici ma citation du cœur : "Tu es incroyable tel(le) que tu es !" — NakamaBot 💕`;
    }
}

// ✅ TAUX DE CHANGE
async function getCurrencyExchange(from = 'USD', to = 'EUR') {
    try {
        const response = await axios.get(`${APIs.exchange}`, {
            timeout: 5000
        });
        
        if (response.status === 200) {
            const data = response.data;
            const rate = data.rates[to];
            
            if (rate) {
                return `💰 **Taux de change actuel** :\n\n1 ${from} = ${rate.toFixed(4)} ${to}\n\n📅 Mis à jour : ${data.date}\n\n✨ Source : API temps réel des devises`;
            }
        }
    } catch (error) {
        return `💰 Impossible d'obtenir les taux de change en temps réel... Les devises changent tellement vite ! 💕`;
    }
}

// ✅ RECHERCHE GÉNÉRALE (avec DuckDuckGo Instant Answer)
async function performGeneralSearch(query) {
    try {
        // Utiliser DuckDuckGo Instant Answer API (gratuite, sans clé)
        const response = await axios.get(APIs.search.duckduckgo, {
            params: {
                q: query,
                format: 'json',
                no_html: '1',
                skip_disambig: '1'
            },
            timeout: 8000
        });
        
        if (response.status === 200) {
            const data = response.data;
            
            // Réponse instantanée
            if (data.Answer) {
                return `🔍 **Recherche en temps réel** :\n\n${data.Answer}\n\n✨ Source : DuckDuckGo (mis à jour en temps réel)`;
            }
            
            // Définition
            if (data.Definition) {
                return `📖 **Définition** :\n\n${data.Definition}\n\n🔗 Source : ${data.DefinitionSource}\n\n✨ Informations en temps réel`;
            }
            
            // Résumé
            if (data.Abstract) {
                const abstract = data.Abstract.substring(0, 300) + (data.Abstract.length > 300 ? '...' : '');
                return `📋 **Résumé** :\n\n${abstract}\n\n🔗 Source : ${data.AbstractSource}\n\n✨ Recherche temps réel`;
            }
            
            // Topics connexes
            if (data.RelatedTopics && data.RelatedTopics.length > 0) {
                const topics = data.RelatedTopics.slice(0, 3).map(topic => `• ${topic.Text}`).join('\n');
                return `🔗 **Sujets connexes trouvés** :\n\n${topics}\n\n✨ Recherche en temps réel`;
            }
        }
        
        // Fallback si pas de résultats
        return `🔍 J'ai fait une recherche en temps réel pour "${query}" mais je n'ai pas trouvé de résultats spécifiques... Peux-tu reformuler ta question ? 💕`;
        
    } catch (error) {
        return `🔍 Petite difficulté avec ma recherche en temps réel... Mais je peux quand même t'aider avec mes connaissances de 2025 ! 💕`;
    }
}

// ✅ RECHERCHE D'ACTUALITÉS (optionnelle, avec clé API)
async function getLatestNews(topic = 'général') {
    try {
        // Cette fonction nécessiterait une clé News API, mais on peut simuler
        // ou utiliser des flux RSS gratuits
        
        return `📰 **Actualités récentes** sur "${topic}" :\n\nDésolée, la recherche d'actualités en temps réel nécessite une configuration supplémentaire. Mais je peux t'aider à comprendre des sujets d'actualité avec mes connaissances ! 💕\n\n💡 Astuce : Demande-moi "qu'est-ce que [sujet]" pour avoir des explications !`;
        
    } catch (error) {
        return `📰 Impossible d'obtenir les actualités en temps réel pour le moment... Mais pose-moi des questions sur l'actualité, je peux t'aider ! 💕`;
    }
}

// ✅ MÉTÉO (optionnelle, avec clé API)
async function getWeatherInfo(location = 'Paris') {
    try {
        // Cette fonction nécessiterait une clé OpenWeather API
        return `🌤️ **Météo à ${location}** :\n\nLa recherche météo en temps réel nécessite une configuration supplémentaire. Mais je peux te donner des conseils météo généraux ! ☀️💕\n\n💡 Astuce : Regarde par ta fenêtre ou consulte ton app météo préférée !`;
        
    } catch (error) {
        return `🌤️ Impossible d'obtenir la météo en temps réel... Mais j'espère qu'il fait beau chez toi ! ☀️💕`;
    }
}

// ✅ FONCTION UTILITAIRE : Détecter si une recherche temps réel est nécessaire
function needsRealTimeSearch(query) {
    const realTimeKeywords = [
        // Temps
        'heure', 'date', 'aujourd', 'maintenant', 'current', 'time', 'now',
        
        // Actualités
        'actualité', 'news', 'récent', 'dernière', 'nouvelle', 'info',
        
        // Recherche générale
        'recherche', 'trouve', 'cherche', 'lookup', 'search',
        
        // Faits et citations
        'fait', 'citation', 'quote', 'anecdote',
        
        // Météo
        'météo', 'weather', 'température',
        
        // Devises
        'euro', 'dollar', 'devise', 'currency',
        
        // Wikipedia
        'qu\'est-ce que', 'qui est', 'définition', 'wikipedia',
        
        // Indicateurs temporels
        '2024', '2025', 'cette année', 'ce mois', 'cette semaine'
    ];
    
    const lowerQuery = query.toLowerCase();
    return realTimeKeywords.some(keyword => lowerQuery.includes(keyword));
}

// ✅ FONCTION UTILITAIRE : Améliorer la recherche existante
async function enhanceExistingSearch(query, existingResult, ctx) {
    const { log } = ctx;
    
    try {
        // Si la recherche existante semble limitée, ajouter des infos temps réel
        if (existingResult && existingResult.length < 100) {
            const realTimeInfo = await performRealTimeSearch(query, ctx);
            
            if (realTimeInfo && realTimeInfo.length > existingResult.length) {
                return `${realTimeInfo}\n\n---\n\n🤖 **Complément de mes connaissances** :\n${existingResult}`;
            }
        }
        
        return existingResult;
        
    } catch (error) {
        log.debug(`Amélioration recherche échouée: ${error.message}`);
        return existingResult;
    }
}

// ✅ EXPORT DES FONCTIONS
module.exports = {
    performRealTimeSearch,
    needsRealTimeSearch,
    enhanceExistingSearch,
    getCurrentDateTime,
    searchWikipedia,
    getRandomFact,
    getRandomQuote,
    getCurrencyExchange,
    performGeneralSearch
};
