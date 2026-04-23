const express = require('express');
const router = express.Router();
const { pool } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');
const { pushPassUpdate } = require('../services/apnService');
const { updateWalletObject } = require('../services/googleWalletService');

// ══════════════════════════════════════════════════════════
//  POST /api/scans
//  Le caissier scanne le QR du client → crédite points ou tampon
//  Gère les deux systèmes : 'points' et 'stamp'
// ══════════════════════════════════════════════════════════
router.post('/', authMiddleware, async (req, res, next) => {
  const client = await pool.connect();

  try {
    const { serial_number } = req.body;
    const restaurantId = req.restaurant.id;

    if (!serial_number) {
      return res.status(400).json({ error: 'serial_number requis' });
    }

    await client.query('BEGIN');

    // ── 1. Récupérer le client + sa carte ─────────────────
    const holderResult = await client.query(
      `SELECT ch.*,
              lc.loyalty_type,
              lc.points_per_visit, lc.points_for_reward,
              lc.stamp_total,      lc.stamp_per_visit,
              lc.reward_description, lc.card_name,
              lc.background_color, lc.foreground_color, lc.label_color
       FROM card_holders ch
       JOIN loyalty_cards lc ON ch.card_id = lc.id
       WHERE ch.serial_number = $1 AND ch.restaurant_id = $2`,
      [serial_number, restaurantId]
    );

    if (holderResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Carte introuvable pour ce restaurant' });
    }

    const holder = holderResult.rows[0];
    const loyaltyType = holder.loyalty_type; // 'points' ou 'stamp'

    // ── 2. Calculer selon le type ──────────────────────────
    let updateQuery, scanInsert, responsePayload;

    if (loyaltyType === 'points') {
      // ─── Système POINTS ───────────────────────────────
      const pointsBefore  = holder.points;
      const pointsEarned  = holder.points_per_visit;
      const pointsAfter   = pointsBefore + pointsEarned;
      const rewardTriggered = pointsAfter >= holder.points_for_reward;
      const finalPoints   = rewardTriggered ? 0 : pointsAfter;

      updateQuery = {
        text:   `UPDATE card_holders SET points=$1, total_visits=total_visits+1, total_rewards=total_rewards+$2 WHERE id=$3`,
        values: [finalPoints, rewardTriggered ? 1 : 0, holder.id],
      };
      scanInsert = {
        text:   `INSERT INTO scans (card_holder_id,restaurant_id,points_earned,points_before,points_after,reward_triggered) VALUES ($1,$2,$3,$4,$5,$6)`,
        values: [holder.id, restaurantId, pointsEarned, pointsBefore, finalPoints, rewardTriggered],
      };
      responsePayload = {
        loyalty_type: 'points',
        client: {
          name: holder.name || 'Client',
          points_before: pointsBefore,
          points_earned: pointsEarned,
          points_after:  finalPoints,
          points_goal:   holder.points_for_reward,
          total_visits:  holder.total_visits + 1,
        },
        reward: rewardTriggered
          ? { triggered: true,  description: holder.reward_description, message: `🎉 Récompense : ${holder.reward_description} !` }
          : { triggered: false, points_remaining: holder.points_for_reward - pointsAfter, message: `+${pointsEarned} pt — encore ${holder.points_for_reward - pointsAfter} pour la récompense` },
      };

    } else {
      // ─── Système TAMPON (stamp) ────────────────────────
      const stampsBefore  = holder.stamps;
      const stampsEarned  = holder.stamp_per_visit;
      const stampsAfter   = stampsBefore + stampsEarned;
      const rewardTriggered = stampsAfter >= holder.stamp_total;
      const finalStamps   = rewardTriggered ? 0 : stampsAfter;

      // Visuel carte tampon : ✓ ✓ ✓ ○ ○ ○ ○ ○ ○ ○
      const stampVisual = Array.from({ length: holder.stamp_total }, (_, i) =>
        i < finalStamps ? '✓' : '○'
      ).join(' ');

      updateQuery = {
        text:   `UPDATE card_holders SET stamps=$1, total_visits=total_visits+1, total_rewards=total_rewards+$2 WHERE id=$3`,
        values: [finalStamps, rewardTriggered ? 1 : 0, holder.id],
      };
      scanInsert = {
        text:   `INSERT INTO scans (card_holder_id,restaurant_id,stamps_earned,stamps_before,stamps_after,reward_triggered) VALUES ($1,$2,$3,$4,$5,$6)`,
        values: [holder.id, restaurantId, stampsEarned, stampsBefore, finalStamps, rewardTriggered],
      };
      responsePayload = {
        loyalty_type: 'stamp',
        client: {
          name: holder.name || 'Client',
          stamps_before: stampsBefore,
          stamps_earned: stampsEarned,
          stamps_after:  finalStamps,
          stamps_total:  holder.stamp_total,
          stamp_visual:  stampVisual,
          total_visits:  holder.total_visits + 1,
        },
        reward: rewardTriggered
          ? { triggered: true,  description: holder.reward_description, message: `🎉 Carte complète ! ${holder.reward_description} !` }
          : { triggered: false, stamps_remaining: holder.stamp_total - stampsAfter, message: `Tampon ${stampsAfter}/${holder.stamp_total} — encore ${holder.stamp_total - stampsAfter}` },
      };
    }

    // ── 3. Appliquer en BDD ────────────────────────────────
    await client.query(updateQuery.text, updateQuery.values);
    await client.query(scanInsert.text,  scanInsert.values);
    await client.query('COMMIT');

    // ── 4. Push APNs → Wallet mis à jour sur l'iPhone ─────
    if (holder.apn_push_token) {
      pushPassUpdate(holder.apn_push_token).catch(console.error);
    }

    // ── 5. Mettre à jour Google Wallet ────────────────────
    if (process.env.GOOGLE_ISSUER_ID && process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      const updatedPoints = responsePayload.client?.points_after ?? holder.points;
      const updatedStamps = responsePayload.client?.stamps_after ?? holder.stamps;
      updateWalletObject(holder, { ...holder, points: updatedPoints, stamps: updatedStamps }).catch(console.error);
    }

    res.json({ success: true, ...responsePayload });

  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// GET /api/scans — historique
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const result = await pool.query(
      `SELECT s.*, ch.name AS client_name, ch.serial_number, lc.loyalty_type, lc.card_name
       FROM scans s
       JOIN card_holders ch ON s.card_holder_id = ch.id
       JOIN loyalty_cards lc ON ch.card_id = lc.id
       WHERE s.restaurant_id = $1
       ORDER BY s.created_at DESC LIMIT $2 OFFSET $3`,
      [req.restaurant.id, limit, offset]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

module.exports = router;