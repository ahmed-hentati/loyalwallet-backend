const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const { pool } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');
const { generatePass } = require('../services/passService');

// ─── POST /api/passes/create ──────────────────────────────
// Créer un nouveau client + générer son .pkpass
// Appelé quand le restaurateur enregistre un nouveau client
router.post('/create', authMiddleware, async (req, res, next) => {
  try {
    const { card_id, name, phone, email } = req.body;
    const restaurantId = req.restaurant.id;

    if (!card_id) {
      return res.status(400).json({ error: 'card_id requis' });
    }

    // Vérifier que la carte appartient bien à ce restaurant
    const cardResult = await pool.query(
      'SELECT * FROM loyalty_cards WHERE id = $1 AND restaurant_id = $2 AND is_active = TRUE',
      [card_id, restaurantId]
    );

    if (cardResult.rows.length === 0) {
      return res.status(404).json({ error: 'Carte introuvable' });
    }

    const card = cardResult.rows[0];

    // Vérifier la limite du plan gratuit (50 clients max)
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

    // Générer un serial_number unique
    const serialNumber = `${card.serial_number_prefix}-${uuidv4().split('-')[0].toUpperCase()}`;

    // Créer le client dans la BDD
    const holderResult = await pool.query(
      `INSERT INTO card_holders (card_id, restaurant_id, name, phone, email, serial_number)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [card_id, restaurantId, name || null, phone || null, email || null, serialNumber]
    );

    const holder = holderResult.rows[0];

    // Générer le .pkpass (nécessite les certificats Apple)
    try {
      const passBuffer = await generatePass(card, holder);

      // Retourner le fichier .pkpass directement
      res.set({
        'Content-Type': 'application/vnd.apple.pkpass',
        'Content-Disposition': `attachment; filename="loyalwallet-${serialNumber}.pkpass"`,
      });
      return res.send(passBuffer);

    } catch (certError) {
      // En dev sans certificats : retourner les infos du client + QR code
      console.warn('⚠️  Certificats manquants, mode dev activé:', certError.message);

      const qrDataUrl = await QRCode.toDataURL(serialNumber);

      return res.status(201).json({
        dev_mode: true,
        message: 'Certificats Apple manquants — voici les données du pass pour test',
        holder: {
          id: holder.id,
          serial_number: holder.serial_number,
          points: holder.points,
        },
        card: {
          name: card.card_name,
          reward: card.reward_description,
          points_for_reward: card.points_for_reward,
        },
        qr_code: qrDataUrl, // Image QR en base64 pour tester le scan
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
      `SELECT ch.*, lc.*
       FROM card_holders ch
       JOIN loyalty_cards lc ON ch.card_id = lc.id
       WHERE ch.serial_number = $1`,
      [serialNumber]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pass introuvable' });
    }

    const row = result.rows[0];
    const card   = { card_name: row.card_name, background_color: row.background_color, foreground_color: row.foreground_color, label_color: row.label_color, reward_description: row.reward_description, points_for_reward: row.points_for_reward };
    const holder = { id: row.id, serial_number: row.serial_number, points: row.points, total_visits: row.total_visits };

    const passBuffer = await generatePass(card, holder);

    res.set({
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': `attachment; filename="loyalwallet.pkpass"`,
    });
    res.send(passBuffer);

  } catch (err) {
    next(err);
  }
});

module.exports = router;
