const { GoogleAuth } = require('google-auth-library');
const jwt = require('jsonwebtoken');

// ── Config ────────────────────────────────────────────────
const ISSUER_ID   = process.env.GOOGLE_ISSUER_ID;  // BCR2DN5T434IVU3U
const CLASS_SUFFIX = 'loyalwallet_loyalty';

// Credentials depuis variable d'env (JSON stringifié)
function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/wallet_object.issuer'],
  });
}

// ── Créer la classe de carte (une seule fois par restaurant) ──
async function createOrUpdateClass(card) {
  const auth    = getAuth();
  const client  = await auth.getClient();
  const classId = `${ISSUER_ID}.${CLASS_SUFFIX}_${card.id}`;

  const loyaltyClass = {
    id: classId,
    issuerName: card.card_name,
    programName: card.card_name,
    programLogo: {
      sourceUri: { uri: 'https://storage.googleapis.com/wallet-lab-tools-codelab-artifacts-public/pass_google_logo.jpg' },
      contentDescription: { defaultValue: { language: 'fr', value: card.card_name } },
    },
    rewardsTier: card.loyalty_type === 'stamp' ? 'GOLD' : 'SILVER',
    rewardsTierLabel: card.loyalty_type === 'stamp' ? 'Tampon' : 'Points',
    reviewStatus: 'UNDER_REVIEW',
    hexBackgroundColor: card.background_color || '#1a1a1a',
    countryCode: 'FR',
    // Texte sur la carte
    secondaryRewardsBarcode: {
      type: 'QR_CODE',
      renderEncoding: 'UTF_8',
    },
  };

  try {
    // Essayer de créer la classe
    await client.request({
      url: `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass`,
      method: 'POST',
      data: loyaltyClass,
    });
    console.log(`✅ Google Wallet class created: ${classId}`);
  } catch (err) {
    if (err.response?.status === 409) {
      // La classe existe déjà → mettre à jour
      await client.request({
        url: `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass/${classId}`,
        method: 'PUT',
        data: loyaltyClass,
      });
      console.log(`✅ Google Wallet class updated: ${classId}`);
    } else {
      throw err;
    }
  }

  return classId;
}

// ── Créer un objet (carte d'un client) ────────────────────
async function createOrUpdateObject(card, holder) {
  const auth     = getAuth();
  const client   = await auth.getClient();
  const classId  = `${ISSUER_ID}.${CLASS_SUFFIX}_${card.id}`;
  const objectId = `${ISSUER_ID}.${holder.serial_number}`;

  const progressLabel = card.loyalty_type === 'stamp'
    ? `${holder.stamps} / ${card.stamp_total} tampons`
    : `${holder.points} / ${card.points_for_reward} pts`;

  const loyaltyObject = {
    id: objectId,
    classId,
    state: 'ACTIVE',
    // Infos client
    accountId: holder.serial_number,
    accountName: holder.name || 'Client fidèle',
    // Points / tampons
    loyaltyPoints: {
      balance: {
        string: progressLabel,
      },
      label: card.loyalty_type === 'stamp' ? 'Tampons' : 'Points',
    },
    // Récompense
    secondaryLoyaltyPoints: {
      balance: { string: card.reward_description },
      label: 'Récompense',
    },
    // QR code pour le scan en caisse
    barcode: {
      type: 'QR_CODE',
      value: holder.serial_number,
      alternateText: holder.serial_number,
    },
    // Infos texte sur la carte
    textModulesData: [
      {
        header: 'Récompense',
        body: card.reward_description,
        id: 'reward',
      },
    ],
    hexBackgroundColor: card.background_color || '#1a1a1a',
  };

  try {
    await client.request({
      url: `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject`,
      method: 'POST',
      data: loyaltyObject,
    });
    console.log(`✅ Google Wallet object created: ${objectId}`);
  } catch (err) {
    if (err.response?.status === 409) {
      // Existe déjà → mettre à jour
      await client.request({
        url: `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${objectId}`,
        method: 'PUT',
        data: loyaltyObject,
      });
      console.log(`✅ Google Wallet object updated: ${objectId}`);
    } else {
      throw err;
    }
  }

  return objectId;
}

// ── Générer le lien "Ajouter à Google Wallet" ─────────────
// Retourne un lien JWT que le client ouvre pour ajouter sa carte
async function generateAddToWalletLink(card, holder) {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const classId     = `${ISSUER_ID}.${CLASS_SUFFIX}_${card.id}`;
  const objectId    = `${ISSUER_ID}.${holder.serial_number}`;

  const progressLabel = card.loyalty_type === 'stamp'
    ? `${holder.stamps} / ${card.stamp_total} tampons`
    : `${holder.points} / ${card.points_for_reward} pts`;

  const claims = {
    iss: credentials.client_email,
    aud: 'google',
    origins: ['https://loyalwallet-dashboard.vercel.app', 'http://localhost:4200'],
    typ: 'savetowallet',
    payload: {
      loyaltyObjects: [
        {
          id: objectId,
          classId,
          state: 'ACTIVE',
          accountId: holder.serial_number,
          accountName: holder.name || 'Client fidèle',
          loyaltyPoints: {
            balance: { string: progressLabel },
            label: card.loyalty_type === 'stamp' ? 'Tampons' : 'Points',
          },
          secondaryLoyaltyPoints: {
            balance: { string: card.reward_description },
            label: 'Récompense',
          },
          barcode: {
            type: 'QR_CODE',
            value: holder.serial_number,
            alternateText: holder.serial_number,
          },
          textModulesData: [
            { header: 'Récompense', body: card.reward_description, id: 'reward' },
          ],
          hexBackgroundColor: card.background_color || '#1a1a1a',
        },
      ],
    },
  };

  const token = jwt.sign(claims, credentials.private_key, {
    algorithm: 'RS256',
  });

  return `https://pay.google.com/gp/v/save/${token}`;
}

// ── Mettre à jour les points après un scan ────────────────
async function updateWalletObject(card, holder) {
  try {
    const auth     = getAuth();
    const client   = await auth.getClient();
    const objectId = `${ISSUER_ID}.${holder.serial_number}`;

    const progressLabel = card.loyalty_type === 'stamp'
      ? `${holder.stamps} / ${card.stamp_total} tampons`
      : `${holder.points} / ${card.points_for_reward} pts`;

    await client.request({
      url: `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${objectId}`,
      method: 'PATCH',
      data: {
        loyaltyPoints: {
          balance: { string: progressLabel },
          label: card.loyalty_type === 'stamp' ? 'Tampons' : 'Points',
        },
      },
    });
    console.log(`✅ Google Wallet object updated after scan: ${objectId}`);
  } catch (err) {
    // Ne pas faire planter l'app si Google Wallet échoue
    console.error('Google Wallet update error:', err.message);
  }
}

module.exports = {
  createOrUpdateClass,
  createOrUpdateObject,
  generateAddToWalletLink,
  updateWalletObject,
};
