const { PKPass } = require('passkit-generator');
const path = require('path');
const fs = require('fs');

// ─── Génère un .pkpass pour un client ────────────────────
// Appelé lors de l'inscription d'un nouveau client
async function generatePass(card, holder) {
  const certsPath = path.join(__dirname, '../../certs');

  // Vérifier que les certificats existent
  // (si pas encore dispo en dev, on lève une erreur claire)
  const certFile = path.join(certsPath, 'signerCert.pem');
  const keyFile  = path.join(certsPath, 'signerKey.pem');
  const wwdrFile = path.join(certsPath, 'wwdr.pem');

  if (!fs.existsSync(certFile) || !fs.existsSync(keyFile) || !fs.existsSync(wwdrFile)) {
    throw new Error(
      'Certificats Apple manquants dans /certs. ' +
      'Consulte le README pour les obtenir sur developer.apple.com'
    );
  }

  const pass = await PKPass.from(
    {
      // Certificats Apple
      signerCert: fs.readFileSync(certFile),
      signerKey:  fs.readFileSync(keyFile),
      wwdr:       fs.readFileSync(wwdrFile),
      signerKeyPassphrase: process.env.APPLE_KEY_PASSPHRASE,
    },
    {
      // ─── pass.json ──────────────────────────────────────
      passTypeIdentifier: process.env.PASS_TYPE_IDENTIFIER,
      teamIdentifier:     process.env.TEAM_IDENTIFIER,

      // Identifiant unique du pass (1 par client)
      serialNumber: holder.serial_number,

      // URL de ton backend pour les mises à jour en temps réel
      webServiceURL: `${process.env.BASE_URL}/wallet`,
      authenticationToken: holder.serial_number, // token simple pour ce MVP

      // ─── Apparence du pass ──────────────────────────────
      organizationName: card.card_name,
      description: `Carte fidélité ${card.card_name}`,

      backgroundColor: card.background_color,
      foregroundColor: card.foreground_color,
      labelColor: card.label_color,

      // Type "storeCard" = idéal pour les cartes de fidélité
      storeCard: {
        // Ligne principale : points actuels
        primaryFields: [
          {
            key: 'points',
            label: 'Points',
            value: holder.points,
            changeMessage: '+%@ points !',
          },
        ],
        // Ligne secondaire : seuil de récompense
        secondaryFields: [
          {
            key: 'reward',
            label: 'Récompense',
            value: card.reward_description,
          },
          {
            key: 'visits',
            label: 'Visites',
            value: holder.total_visits,
          },
        ],
        // Pied de page
        backFields: [
          {
            key: 'info',
            label: 'Comment ça marche',
            value: `Présentez cette carte à chaque visite. 
À ${card.points_for_reward} points : ${card.reward_description}`,
          },
          {
            key: 'restaurant',
            label: 'Restaurant',
            value: card.card_name,
          },
        ],
      },

      // ─── QR code ───────────────────────────────────────
      // Le caissier scanne ce QR pour créditer les points
      barcodes: [
        {
          message: holder.serial_number,
          format: 'PKBarcodeFormatQR',
          messageEncoding: 'iso-8859-1',
        },
      ],
    }
  );

  // Retourner le buffer .pkpass
  return pass.getAsBuffer();
}

// ─── Met à jour un pass existant (après un scan) ──────────
// Apple re-télécharge le pass via le WebService
// On retourne juste le nouveau pass.json avec les points mis à jour
function buildPassJSON(card, holder) {
  return {
    passTypeIdentifier: process.env.PASS_TYPE_IDENTIFIER,
    teamIdentifier:     process.env.TEAM_IDENTIFIER,
    serialNumber:       holder.serial_number,
    webServiceURL:      `${process.env.BASE_URL}/wallet`,
    authenticationToken: holder.serial_number,

    organizationName: card.card_name,
    description:      `Carte fidélité ${card.card_name}`,
    backgroundColor:  card.background_color,
    foregroundColor:  card.foreground_color,
    labelColor:       card.label_color,

    storeCard: {
      primaryFields: [
        { key: 'points', label: 'Points', value: holder.points, changeMessage: '+%@ points !' }
      ],
      secondaryFields: [
        { key: 'reward', label: 'Récompense', value: card.reward_description },
        { key: 'visits', label: 'Visites', value: holder.total_visits }
      ],
    },
    barcodes: [
      { message: holder.serial_number, format: 'PKBarcodeFormatQR', messageEncoding: 'iso-8859-1' }
    ],
  };
}

module.exports = { generatePass, buildPassJSON };
