const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const { pool } = require('../db/pool');
const { generateAddToWalletLink, createOrUpdateClass } = require('../services/googleWalletService');
const { sendCardLink } = require('../services/smsService');

// ── GET /api/public/card/:restaurantId/:cardId
// Retourne les infos publiques d'une carte (pour afficher le QR d'inscription)
router.get('/card/:restaurantId/:cardId', async (req, res, next) => {
  try {
    const { restaurantId, cardId } = req.params;

    const result = await pool.query(
      `SELECT lc.*, r.name AS restaurant_name
       FROM loyalty_cards lc
       JOIN restaurants r ON lc.restaurant_id = r.id
       WHERE lc.id = $1 AND lc.restaurant_id = $2 AND lc.is_active = TRUE`,
      [cardId, restaurantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Carte introuvable' });
    }

    const card = result.rows[0];

    // QR code d'inscription (lien vers la page d'inscription)
    const registerUrl = `${process.env.BASE_URL_FRONTEND}/register/${restaurantId}/${cardId}`;
    const qrCode = await QRCode.toDataURL(registerUrl);

    res.json({
      card: {
        id: card.id,
        name: card.card_name,
        restaurant_name: card.restaurant_name,
        loyalty_type: card.loyalty_type,
        stamp_total: card.stamp_total,
        points_for_reward: card.points_for_reward,
        reward_description: card.reward_description,
        background_color: card.background_color,
        foreground_color: card.foreground_color,
        label_color: card.label_color,
      },
      register_url: registerUrl,
      qr_code: qrCode,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/public/register/:restaurantId/:cardId
// Inscription automatique d'un nouveau client (appelé depuis la page d'inscription)
router.post('/register/:restaurantId/:cardId', async (req, res, next) => {
  try {
    const { restaurantId, cardId } = req.params;
    const { name, phone } = req.body;

    // Vérifier que la carte existe
    const cardResult = await pool.query(
      `SELECT lc.*, r.name AS restaurant_name
       FROM loyalty_cards lc
       JOIN restaurants r ON lc.restaurant_id = r.id
       WHERE lc.id = $1 AND lc.restaurant_id = $2 AND lc.is_active = TRUE`,
      [cardId, restaurantId]
    );

    if (cardResult.rows.length === 0) {
      return res.status(404).json({ error: 'Carte introuvable' });
    }

    const card = cardResult.rows[0];

    // Vérifier limite plan gratuit
    const restaurant = await pool.query(
      'SELECT plan FROM restaurants WHERE id = $1', [restaurantId]
    );
    if (restaurant.rows[0].plan === 'free') {
      const count = await pool.query(
        'SELECT COUNT(*) FROM card_holders WHERE restaurant_id = $1', [restaurantId]
      );
      if (parseInt(count.rows[0].count) >= 50) {
        return res.status(403).json({ error: 'Ce restaurant a atteint sa limite de clients' });
      }
    }

    // Générer serial number unique
    const serialNumber = `${card.serial_number_prefix}-${uuidv4().split('-')[0].toUpperCase()}`;

    // Créer le client
    const holderResult = await pool.query(
      `INSERT INTO card_holders (card_id, restaurant_id, name, phone, serial_number)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [cardId, restaurantId, name || null, phone || null, serialNumber]
    );

    const holder = holderResult.rows[0];

    // Générer QR code de la carte (pour le scan en caisse)
    const cardUrl = `${process.env.BASE_URL_FRONTEND}/card/${serialNumber}`;
    const qrCode = await QRCode.toDataURL(serialNumber);

    // Lien Google Wallet
    let googleWalletUrl = null;
    if (process.env.GOOGLE_ISSUER_ID && process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      try {
        await createOrUpdateClass(card);
        googleWalletUrl = await generateAddToWalletLink(card, holder);
      } catch (gErr) {
        console.error('Google Wallet error:', gErr.message);
      }
    }

    // Lien Apple Wallet
    const appleWalletUrl = `${process.env.BASE_URL}/api/passes/${serialNumber}`;

    // ── Envoyer SMS si numéro disponible ─────────────────
    let smsSent = false;
    if (phone && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      try {
        await sendCardLink({
          phone,
          name,
          cardName: card.card_name,
          serialNumber,
        });
        smsSent = true;
      } catch (smsErr) {
        console.error('SMS error (non-blocking):', smsErr.message);
      }
    }

    res.status(201).json({
      success: true,
      sms_sent: smsSent,
      holder: {
        serial_number: serialNumber,
        name: holder.name,
        points: 0,
        stamps: 0,
      },
      card: {
        name: card.card_name,
        restaurant_name: card.restaurant_name,
        loyalty_type: card.loyalty_type,
        stamp_total: card.stamp_total,
        points_for_reward: card.points_for_reward,
        reward_description: card.reward_description,
        background_color: card.background_color,
        foreground_color: card.foreground_color,
        label_color: card.label_color,
      },
      qr_code: qrCode,
      card_url: cardUrl,
      google_wallet_url: googleWalletUrl,
      apple_wallet_url: appleWalletUrl,
    });

  } catch (err) {
    next(err);
  }
});

// ── GET /api/public/holder/:serialNumber
// Récupère les infos d'un client (pour la page carte)
router.get('/holder/:serialNumber', async (req, res, next) => {
  try {
    const { serialNumber } = req.params;

    const result = await pool.query(
      `SELECT ch.*, lc.card_name, lc.loyalty_type, lc.stamp_total, lc.points_for_reward,
              lc.reward_description, lc.background_color, lc.foreground_color, lc.label_color,
              r.name AS restaurant_name
       FROM card_holders ch
       JOIN loyalty_cards lc ON ch.card_id = lc.id
       JOIN restaurants r ON ch.restaurant_id = r.id
       WHERE ch.serial_number = $1`,
      [serialNumber]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Carte introuvable' });
    }

    const row = result.rows[0];

    // QR code du serial number (pour scan en caisse)
    const qrCode = await QRCode.toDataURL(serialNumber);

    // Lien Google Wallet
    let googleWalletUrl = null;
    if (process.env.GOOGLE_ISSUER_ID && process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      try {
        const card   = { id: row.card_id, card_name: row.card_name, loyalty_type: row.loyalty_type, stamp_total: row.stamp_total, points_for_reward: row.points_for_reward, reward_description: row.reward_description, background_color: row.background_color, foreground_color: row.foreground_color, label_color: row.label_color, serial_number_prefix: 'LW' };
        const holder = { serial_number: row.serial_number, name: row.name, stamps: row.stamps, points: row.points };
        const { generateAddToWalletLink } = require('../services/googleWalletService');
        googleWalletUrl = await generateAddToWalletLink(card, holder);
      } catch {}
    }

    res.json({
      holder: {
        serial_number: row.serial_number,
        name: row.name,
        points: row.points,
        stamps: row.stamps,
        total_visits: row.total_visits,
        total_rewards: row.total_rewards,
      },
      card: {
        name: row.card_name,
        restaurant_name: row.restaurant_name,
        loyalty_type: row.loyalty_type,
        stamp_total: row.stamp_total,
        points_for_reward: row.points_for_reward,
        reward_description: row.reward_description,
        background_color: row.background_color,
        foreground_color: row.foreground_color,
        label_color: row.label_color,
      },
      qr_code: qrCode,
      google_wallet_url: googleWalletUrl,
      apple_wallet_url: `${process.env.BASE_URL}/api/passes/${serialNumber}`,
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;

// ── GET /api/public/restaurant/:slug ─────────────────────
// Page publique d'un restaurant
router.get('/restaurant/:slug', async (req, res, next) => {
  try {
    const { slug } = req.params;

    const result = await pool.query(
      `SELECT r.id, r.name, r.logo_url, r.plan,
              json_agg(
                json_build_object(
                  'id', lc.id,
                  'card_name', lc.card_name,
                  'loyalty_type', lc.loyalty_type,
                  'stamp_total', lc.stamp_total,
                  'points_for_reward', lc.points_for_reward,
                  'reward_description', lc.reward_description,
                  'background_color', lc.background_color,
                  'foreground_color', lc.foreground_color,
                  'label_color', lc.label_color,
                  'background_gradient', lc.background_gradient,
                  'card_pattern', lc.card_pattern,
                  'logo_emoji', lc.logo_emoji,
                  'logo_url', lc.logo_url
                ) ORDER BY lc.created_at ASC
              ) FILTER (WHERE lc.id IS NOT NULL AND lc.is_active = TRUE) as cards
       FROM restaurants r
       LEFT JOIN loyalty_cards lc ON lc.restaurant_id = r.id
       WHERE r.slug = $1
       GROUP BY r.id`,
      [slug]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Restaurant introuvable' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});
