const apn = require('apn');
const path = require('path');

let apnProvider = null;

// Initialiser APNs (une seule fois au démarrage)
function getProvider() {
  if (!apnProvider) {
    apnProvider = new apn.Provider({
      token: {
        key:   path.join(__dirname, '../../certs/apn_key.p8'),
        keyId: process.env.APN_KEY_ID,
        teamId: process.env.APN_TEAM_ID,
      },
      production: process.env.NODE_ENV === 'production',
    });
  }
  return apnProvider;
}

// ─── Envoyer une push notification au Wallet ─────────────
// Quand un client gagne des points, son iPhone re-télécharge
// automatiquement le pass mis à jour depuis le WebService
async function pushPassUpdate(pushToken) {
  if (!pushToken) return;

  try {
    const provider = getProvider();

    // La notification Wallet est silencieuse — juste un signal
    // pour que l'iPhone sache qu'il doit re-télécharger le pass
    const notification = new apn.Notification();
    notification.topic = `${process.env.PASS_TYPE_IDENTIFIER}`;

    const result = await provider.send(notification, pushToken);

    if (result.failed.length > 0) {
      console.error('APNs push failed:', result.failed[0].error);
    } else {
      console.log(`✅ Push Wallet envoyé (token: ${pushToken.slice(0, 12)}...)`);
    }
  } catch (err) {
    // Ne pas faire planter l'app si le push échoue
    console.error('APNs error:', err.message);
  }
}

module.exports = { pushPassUpdate };
