const express = require('express');
const router = express.Router();
const { pool } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');
const { sendCampaignMessage } = require('../services/googleWalletService');
const { pushPassUpdate } = require('../services/apnService');
const { sendCardLink } = require('../services/smsService');

// ── POST /api/campaigns/send ───────────────────────────────
// Le restaurateur envoie un message à un segment de clients
// Body: { message, audience: 'all' | 'inactive' | 'near_reward', card_id? }
router.post('/send', authMiddleware, async (req, res, next) => {
  try {
    const { message, audience, card_id } = req.body;
    const restaurantId = req.restaurant.id;

    if (!message || !audience) {
      return res.status(400).json({ error: 'message et audience requis' });
    }

    if (message.length > 160) {
      return res.status(400).json({ error: 'Message trop long (max 160 caractères)' });
    }

    // ── Construire la requête selon l'audience ─────────────
    let query;
    let params = [restaurantId];

    if (audience === 'all') {
      query = `
        SELECT ch.*, lc.card_name, lc.loyalty_type, lc.stamp_total, lc.points_for_reward
        FROM card_holders ch
        JOIN loyalty_cards lc ON ch.card_id = lc.id
        WHERE ch.restaurant_id = $1
      `;
    } else if (audience === 'inactive') {
      // Clients qui n'ont pas scanné depuis 30 jours
      query = `
        SELECT ch.*, lc.card_name, lc.loyalty_type, lc.stamp_total, lc.points_for_reward
        FROM card_holders ch
        JOIN loyalty_cards lc ON ch.card_id = lc.id
        WHERE ch.restaurant_id = $1
        AND ch.id NOT IN (
          SELECT DISTINCT card_holder_id FROM scans
          WHERE restaurant_id = $1
          AND created_at > NOW() - INTERVAL '30 days'
        )
      `;
    } else if (audience === 'near_reward') {
      // Clients à 1 ou 2 tampons/points de la récompense
      query = `
        SELECT ch.*, lc.card_name, lc.loyalty_type, lc.stamp_total, lc.points_for_reward
        FROM card_holders ch
        JOIN loyalty_cards lc ON ch.card_id = lc.id
        WHERE ch.restaurant_id = $1
        AND (
          (lc.loyalty_type = 'stamp'  AND (lc.stamp_total - ch.stamps) <= 2 AND ch.stamps > 0)
          OR
          (lc.loyalty_type = 'points' AND (lc.points_for_reward - ch.points) <= 10 AND ch.points > 0)
        )
      `;
    } else {
      return res.status(400).json({ error: 'audience invalide' });
    }

    // Filtrer par carte si précisé
    if (card_id) {
      params.push(card_id);
      query += ` AND ch.card_id = $${params.length}`;
    }

    const holders = await pool.query(query, params);

    if (holders.rows.length === 0) {
      return res.json({ success: true, sent: 0, message: 'Aucun client dans ce segment' });
    }

    // ── Envoyer à chaque client ────────────────────────────
    let sent = 0;
    let errors = 0;
    let smsSent = 0;

    const sendPromises = holders.rows.map(async (holder) => {
      try {
        // 1. Google Wallet — message sur la carte
        if (process.env.GOOGLE_ISSUER_ID && process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
          await sendCampaignMessage(holder, message);
        }

        // 2. Apple Wallet — push silencieux
        if (holder.apn_push_token) {
          await pushPassUpdate(holder.apn_push_token);
        }

        // 3. SMS Twilio si numéro disponible
        if (holder.phone && process.env.TWILIO_ACCOUNT_SID) {
          try {
            const twilio = require('twilio')(
              process.env.TWILIO_ACCOUNT_SID,
              process.env.TWILIO_AUTH_TOKEN
            );
            const cardUrl = `${process.env.BASE_URL_FRONTEND}/card/${holder.serial_number}`;
            const smsBody = `${holder.card_name} : ${message}\n\nVotre carte : ${cardUrl}`;
            await twilio.messages.create({
              from: process.env.TWILIO_PHONE_NUMBER,
              to:   holder.phone,
              body: smsBody,
            });
            smsSent++;
          } catch (smsErr) {
            console.error(`SMS campaign error for ${holder.phone}:`, smsErr.message);
          }
        }

        sent++;
      } catch (err) {
        console.error(`Campaign send error for holder ${holder.id}:`, err.message);
        errors++;
      }
    });

    // Envoyer en parallèle par batch de 10
    const batchSize = 10;
    for (let i = 0; i < sendPromises.length; i += batchSize) {
      await Promise.allSettled(sendPromises.slice(i, i + batchSize));
    }

    res.json({
      success: true,
      sent,
      errors,
      sms_sent: smsSent,
      total: holders.rows.length,
      message: `Message envoyé à ${sent} client${sent > 1 ? 's' : ''} (dont ${smsSent} par SMS)`,
    });

  } catch (err) {
    next(err);
  }
});

// ── GET /api/campaigns/preview ────────────────────────────
// Prévisualiser combien de clients sont dans chaque segment
router.get('/preview', authMiddleware, async (req, res, next) => {
  try {
    const id = req.restaurant.id;

    const [all, inactive, near] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM card_holders WHERE restaurant_id = $1', [id]),
      pool.query(`
        SELECT COUNT(*) FROM card_holders ch
        WHERE ch.restaurant_id = $1
        AND ch.id NOT IN (
          SELECT DISTINCT card_holder_id FROM scans
          WHERE restaurant_id = $1 AND created_at > NOW() - INTERVAL '30 days'
        )
      `, [id]),
      pool.query(`
        SELECT COUNT(*) FROM card_holders ch
        JOIN loyalty_cards lc ON ch.card_id = lc.id
        WHERE ch.restaurant_id = $1
        AND (
          (lc.loyalty_type = 'stamp'  AND (lc.stamp_total - ch.stamps) <= 2 AND ch.stamps > 0)
          OR
          (lc.loyalty_type = 'points' AND (lc.points_for_reward - ch.points) <= 10 AND ch.points > 0)
        )
      `, [id]),
    ]);

    res.json({
      all:         parseInt(all.rows[0].count),
      inactive:    parseInt(inactive.rows[0].count),
      near_reward: parseInt(near.rows[0].count),
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
