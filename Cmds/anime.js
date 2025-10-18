/**
 * Commande /anime - Transforme une image en style anime
 * Utilise l'API GRATUITE de Hugging Face (aucune clé requise)
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande
 * @param {object} ctx - Contexte partagé du bot
 */

const axios = require("axios");
const FormData = require("form-data");

// ✅ APIs publiques Hugging Face (Aucune clé requise)
const ANIME_API_URLS = [
  "https://api-inference.huggingface.co/models/akhaliq/AnimeGANv2",
  "https://api-inference.huggingface.co/models/Linaqruf/anything-v3.0",
  "https://api-inference.huggingface.co/models/hakurei/waifu-diffusion"
];

// ✅ Anti-spam
const userAnimeRequests = new Map();
const ANIME_COOLDOWN_MS = 10000; // 10s

module.exports = async function cmdAnime(senderId, args, ctx) {
  const { log, addToMemory, sleep, userLastImage } = ctx;
  const senderIdStr = String(senderId);

  const now = Date.now();
  if (userAnimeRequests.has(senderIdStr)) {
    const last = userAnimeRequests.get(senderIdStr);
    const diff = now - last;
    if (diff < ANIME_COOLDOWN_MS) {
      const remain = Math.ceil((ANIME_COOLDOWN_MS - diff) / 1000);
      return `⏰ Attends encore ${remain}s avant une nouvelle transformation ! 🎨`;
    }
  }

  const command = args.toLowerCase().trim();

  if (command === "help" || command === "aide") {
    return `🎨 *Transformation Anime Gratuite !*  

📸 Étapes :
1️⃣ Envoie une photo
2️⃣ Tape /anime
3️⃣ Reçois ta version *anime magique* !

💡 Astuces :
• Portraits bien éclairés  
• Visage de face = meilleur résultat  
⏰ 10s entre chaque demande  
🆓 100% gratuit !`;
  }

  // ✅ Trouver l'image à utiliser
  let imageUrl = null;
  if (command.startsWith("http")) imageUrl = command;
  else if (userLastImage.has(senderIdStr))
    imageUrl = userLastImage.get(senderIdStr);
  else return `📸 Envoie-moi d'abord une image avant d'utiliser /anime 💕`;

  userAnimeRequests.set(senderIdStr, now);
  addToMemory(senderId, "user", "/anime");

  try {
    log.info(`🎨 Début transformation pour ${senderId}`);

    // ✅ Télécharger l'image source
    const imageResponse = await axios.get(imageUrl, {
      responseType: "arraybuffer",
      timeout: 15000,
      maxContentLength: 5 * 1024 * 1024
    });
    const imageBuffer = Buffer.from(imageResponse.data);

    // ✅ Boucle sur les APIs Hugging Face
    let resultImageUrl = null;
    let apiUsed = null;

    for (let i = 0; i < ANIME_API_URLS.length; i++) {
      const apiUrl = ANIME_API_URLS[i];
      try {
        log.debug(`🔄 Appel API ${i + 1}/${ANIME_API_URLS.length}`);

        const response = await axios.post(apiUrl, imageBuffer, {
          headers: { "Content-Type": "application/octet-stream" },
          timeout: 60000
        });

        // Hugging Face renvoie parfois du JSON base64, parfois une image brute
        let base64Image;

        if (response.headers["content-type"].includes("application/json")) {
          const data = response.data;
          if (data.error?.includes("loading")) {
            log.info("⏳ Modèle en chargement, on attend 8s...");
            await sleep(8000);
            continue;
          }
          if (data[0]?.image) {
            base64Image = data[0].image;
          } else {
            throw new Error("Réponse JSON invalide");
          }
        } else {
          const buffer = Buffer.from(response.data);
          base64Image = buffer.toString("base64");
        }

        resultImageUrl = `data:image/jpeg;base64,${base64Image}`;
        apiUsed = i + 1;
        break;
      } catch (err) {
        log.warning(`⚠️ API ${i + 1} échouée: ${err.message}`);
        if (i < ANIME_API_URLS.length - 1) await sleep(2000);
      }
    }

    if (!resultImageUrl) throw new Error("Toutes les APIs ont échoué");

    // ✅ Héberger l'image pour Messenger
    const hostedUrl = await uploadToImgBB(resultImageUrl, log);
    addToMemory(senderId, "assistant", "Transformation anime réussie");

    return {
      type: "image",
      url: hostedUrl,
      caption: `✨ Voici ta version *anime* ! 🎭  
🤖 API ${apiUsed} utilisée  
🆓 Gratuit et sans clé !`
    };
  } catch (err) {
    log.error(`❌ Erreur /anime: ${err.message}`);
    userAnimeRequests.delete(senderIdStr);

    let msg = "💔 Oups... ";
    if (err.message.includes("Image")) msg += "Image inaccessible ! 🔒";
    else if (err.message.includes("échoué")) msg += "Toutes les APIs sont surchargées ! ⏰";
    else msg += "Erreur technique. 🤖";

    msg += "\n\n💡 Réessaie dans quelques instants ! 💕";
    return msg;
  }
};

// ✅ Hébergement sur ImgBB (gratuit)
async function uploadToImgBB(base64Image, log) {
  try {
    const IMGBB_API_KEY =
      process.env.IMGBB_API_KEY || "d139aa9922a0b30a3e21c9f726049f87";
    const base64Data = base64Image.split(",")[1] || base64Image;

    const formData = new FormData();
    formData.append("image", base64Data);

    const response = await axios.post(
      `https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`,
      formData,
      { headers: formData.getHeaders(), timeout: 30000 }
    );

    if (response.data?.data?.url) {
      log.info(`✅ Hébergé sur ImgBB: ${response.data.data.url}`);
      return response.data.data.url;
    } else throw new Error("Réponse ImgBB invalide");
  } catch (error) {
    log.error(`❌ ImgBB: ${error.message}`);
    return await uploadToImgur(base64Image, log);
  }
}

// ✅ Backup : hébergement sur Imgur
async function uploadToImgur(base64Image, log) {
  const IMGUR_CLIENT_ID =
    process.env.IMGUR_CLIENT_ID || "546c25a59c58ad7";
  const base64Data = base64Image.split(",")[1] || base64Image;

  const response = await axios.post(
    "https://api.imgur.com/3/image",
    { image: base64Data },
    {
      headers: {
        Authorization: `Client-ID ${IMGUR_CLIENT_ID}`,
        "Content-Type": "application/json"
      },
      timeout: 30000
    }
  );

  if (response.data?.data?.link) {
    log.info(`✅ Hébergé sur Imgur: ${response.data.data.link}`);
    return response.data.data.link;
  } else throw new Error("Réponse Imgur invalide");
}

// ✅ Nettoyage auto anti-spam
setInterval(() => {
  const now = Date.now();
  for (const [id, t] of userAnimeRequests.entries()) {
    if (now - t > 3600000) userAnimeRequests.delete(id);
  }
}, 3600000);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
