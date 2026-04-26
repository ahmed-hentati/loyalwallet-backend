// ─── routes/cards.js ──────────────────────────────────────
const express = require('express');
const router = express.Router();
const { pool } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

// GET /api/cards — toutes les cartes du restaurant
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT * FROM loyalty_cards WHERE restaurant_id = $1 ORDER BY created_at DESC',
      [req.restaurant.id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// POST /api/cards — créer une nouvelle carte
router.post('/', authMiddleware, async (req, res, next) => {
  try {
    const {
      card_name, background_color, foreground_color, label_color,
      loyalty_type,
      points_per_visit, points_for_reward,
      stamp_total, stamp_per_visit,
      reward_description,
      background_gradient, card_pattern, logo_emoji,
    } = req.body;

    if (!card_name || !reward_description) {
      return res.status(400).json({ error: 'card_name et reward_description requis' });
    }
    if (!['points', 'stamp'].includes(loyalty_type)) {
      return res.status(400).json({ error: "loyalty_type doit être 'points' ou 'stamp'" });
    }

    const result = await pool.query(
      `INSERT INTO loyalty_cards
         (restaurant_id, card_name, background_color, foreground_color, label_color,
          loyalty_type, points_per_visit, points_for_reward,
          stamp_total, stamp_per_visit, reward_description,
          background_gradient, card_pattern, logo_emoji)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        req.restaurant.id, card_name,
        background_color || '#1a1a1a', foreground_color || '#ffffff', label_color || '#cccccc',
        loyalty_type || 'stamp',
        points_per_visit || 1, points_for_reward || 50,
        stamp_total || 10, stamp_per_visit || 1,
        reward_description,
        background_gradient || null, card_pattern || 'none', logo_emoji || '🎯',
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// PUT /api/cards/:id — modifier une carte
router.put('/:id', authMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { card_name, background_color, foreground_color, label_color,
            points_per_visit, points_for_reward, reward_description,
            stamp_total, stamp_per_visit,
            background_gradient, card_pattern, logo_emoji } = req.body;

    const result = await pool.query(
      `UPDATE loyalty_cards
       SET card_name=$1, background_color=$2, foreground_color=$3, label_color=$4,
           points_per_visit=$5, points_for_reward=$6, reward_description=$7,
           stamp_total=$8, stamp_per_visit=$9,
           background_gradient=$10, card_pattern=$11, logo_emoji=$12
       WHERE id=$13 AND restaurant_id=$14
       RETURNING *`,
      [card_name, background_color, foreground_color, label_color,
       points_per_visit, points_for_reward, reward_description,
       stamp_total, stamp_per_visit,
       background_gradient || null, card_pattern || 'none', logo_emoji || '🎯',
       id, req.restaurant.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Carte introuvable' });
    }
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
