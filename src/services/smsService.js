const twilio = require('twilio');

function getClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error('Twilio credentials manquantes');
  }

  return twilio(accountSid, authToken);
}

// ── Envoyer le lien de la carte au client ─────────────────
async function sendCardLink({ phone, name, cardName, serialNumber }) {
  const client  = getClient();
  const cardUrl = `${process.env.BASE_URL_FRONTEND}/card/${serialNumber}`;
  const prenom  = name ? ` ${name}` : '';

  const message = `Bonjour${prenom} ! 🎉\nVotre carte fidélité "${cardName}" est prête.\n\nAjoutez-la à votre Wallet :\n${cardUrl}\n\nGardez ce lien pour suivre vos points !`;

  try {
    const result = await client.messages.create({
      from: process.env.TWILIO_PHONE_NUMBER,
      to:   phone,
      body: message,
    });

    console.log(`✅ SMS envoyé à ${phone} — SID: ${result.sid}`);
    return { success: true, sid: result.sid };
  } catch (err) {
    console.error(`❌ SMS error for ${phone}:`, err.message);
    throw err;
  }
}

// ── Envoyer une notification de scan ─────────────────────
async function sendScanNotification({ phone, name, cardName, current, total, rewardDescription }) {
  const client = getClient();
  const prenom = name ? ` ${name}` : '';
  let message;

  if (current >= total) {
    message = `🎉 Félicitations${prenom} ! Vous avez atteint ${total}/${total} — votre récompense "${rewardDescription}" est disponible chez ${cardName} !`;
  } else {
    const remaining = total - current;
    message = `✅ Tampon crédité${prenom} ! Vous avez ${current}/${total} chez ${cardName}. Plus que ${remaining} pour votre récompense "${rewardDescription}" !`;
  }

  try {
    await client.messages.create({
      from: process.env.TWILIO_PHONE_NUMBER,
      to:   phone,
      body: message,
    });
    console.log(`✅ Scan SMS envoyé à ${phone}`);
  } catch (err) {
    console.error(`❌ Scan SMS error:`, err.message);
    // Non bloquant
  }
}

module.exports = { sendCardLink, sendScanNotification };
