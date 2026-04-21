const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const { pool } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');
const { generatePass } = require('../services/passService');
const { generateAddToWalletLink, createOrUpdateClass } = require('../services/googleWalletService');

// ─── POST /api/passes/create ──────────────────────────────
router.post('/create', authMiddleware, async (req, res, next) => {
  try {
    const { card_id, name, phone, email } = req.body;
    const restaurantId = req.restaurant.id;

    if (!card_id) {
      return res.status(400).json({ error: 'card_id requis' });
    }

    const cardResult = await pool.query(
      'SELECT * FROM loyalty_cards WHERE id = $1 AND restaurant_id = $2 AND is_active = TRUE',
      [card_id, restaurantId]
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
        return res.status(403).json({
          error: 'Limite de 50 clients atteinte sur le plan gratuit',
          upgrade_url: '/pricing'
        });
      }
    }

    // Générer serial number unique
    const serialNumber = `${card.serial_number_prefix}-${uuidv4().split('-')[0].toUpperCase()}`;

    // Créer le client en BDD
    const holderResult = await pool.query(
      `INSERT INTO card_holders (card_id, restaurant_id, name, phone, email, serial_number)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [card_id, restaurantId, name || null, phone || null, email || null, serialNumber]
    );

    const holder = holderResult.rows[0];

    // ── Générer QR code image ──────────────────────────────
    const qrDataUrl = await QRCode.toDataURL(serialNumber);

    // ── Lien "Ajouter à Google Wallet" ────────────────────
    let googleWalletUrl = null;
    if (process.env.GOOGLE_ISSUER_ID && process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      try {
        await createOrUpdateClass(card);
        googleWalletUrl = await generateAddToWalletLink(card, holder);
      } catch (gErr) {
        console.error('Google Wallet error (non-blocking):', gErr.message);
      }
    }

    // ── Essayer de générer un .pkpass Apple ───────────────
    try {
      const passBuffer = await generatePass(card, holder);
      res.set({
        'Content-Type': 'application/vnd.apple.pkpass',
        'Content-Disposition': `attachment; filename="loyalwallet-${serialNumber}.pkpass"`,
        'X-Google-Wallet-Url': googleWalletUrl || '',
      });
      return res.send(passBuffer);
    } catch (certError) {
      // Mode dev sans certificats Apple
      return res.status(201).json({
        dev_mode: true,
        message: 'Carte créée avec succès',
        holder: {
          id: holder.id,
          serial_number: holder.serial_number,
          points: holder.points,
          stamps: holder.stamps,
        },
        card: {
          name: card.card_name,
          loyalty_type: card.loyalty_type,
          reward: card.reward_description,
          stamp_total: card.stamp_total,
          points_for_reward: card.points_for_reward,
        },
        qr_code: qrDataUrl,
        google_wallet_url: googleWalletUrl,
      });
    }

  } catch (err) {
    next(err);
  }
});

// ─── GET /api/passes/:serialNumber ───────────────────────
// Télécharger le pass d'un client (lien envoyé par SMS)
router.get('/:serialNumber', async (req, res, next) => {
  try {
    const { serialNumber } = req.params;

    const result = await pool.query(
      `SELECT ch.*, lc.card_name, lc.background_color, lc.foreground_color,
              lc.label_color, lc.reward_description, lc.points_for_reward,
              lc.loyalty_type, lc.stamp_total
       FROM card_holders ch
       JOIN loyalty_cards lc ON ch.card_id = lc.id
       WHERE ch.serial_number = $1`,
      [serialNumber]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pass introuvable' });
    }

    const row = result.rows[0];
    const card = {
      card_name: row.card_name, background_color: row.background_color,
      foreground_color: row.foreground_color, label_color: row.label_color,
      reward_description: row.reward_description, points_for_reward: row.points_for_reward,
      loyalty_type: row.loyalty_type, stamp_total: row.stamp_total,
    };
    const holder = {
      id: row.id, serial_number: row.serial_number,
      points: row.points, stamps: row.stamps, total_visits: row.total_visits,
      name: row.name,
    };

    // Essayer Apple Wallet
    try {
      const passBuffer = await generatePass(card, holder);
      res.set({
        'Content-Type': 'application/vnd.apple.pkpass',
        'Content-Disposition': 'attachment; filename="loyalwallet.pkpass"',
      });
      return res.send(passBuffer);
    } catch {
      // Fallback : page HTML avec QR + bouton Google Wallet
      const qrDataUrl = await QRCode.toDataURL(serialNumber);
      let googleWalletUrl = null;
      if (process.env.GOOGLE_ISSUER_ID && process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
        try { googleWalletUrl = await generateAddToWalletLink(card, holder); } catch {}
      }

      return res.json({
        serial_number: serialNumber,
        qr_code: qrDataUrl,
        google_wallet_url: googleWalletUrl,
        holder: { name: holder.name, points: holder.points, stamps: holder.stamps },
        card: { name: card.card_name, reward: card.reward_description },
      });
    }

  } catch (err) {
    next(err);
  }
});

module.exports = router;
