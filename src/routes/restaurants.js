const express = require('express');
const router = express.Router();
const { pool } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

// GET /api/restaurants/me
router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, phone, logo_url, plan, created_at FROM restaurants WHERE id = $1',
      [req.restaurant.id]
    );
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// PUT /api/restaurants/me
router.put('/me', authMiddleware, async (req, res, next) => {
  try {
    const { name, phone, address } = req.body;
    const result = await pool.query(
      'UPDATE restaurants SET name=$1, phone=$2, address=$3 WHERE id=$4 RETURNING id, name, email, phone, plan',
      [name, phone, address, req.restaurant.id]
    );
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;

// ── PATCH /api/restaurants/automations ───────────────────
router.patch('/automations', authMiddleware, async (req, res, next) => {
  try {
    const { automation_inactive_enabled, automation_near_reward_enabled } = req.body;
    const restaurantId = req.restaurant.id;

    const result = await pool.query(
      `UPDATE restaurants
       SET automation_inactive_enabled    = COALESCE($1, automation_inactive_enabled),
           automation_near_reward_enabled = COALESCE($2, automation_near_reward_enabled)
       WHERE id = $3
       RETURNING automation_inactive_enabled, automation_near_reward_enabled`,
      [automation_inactive_enabled ?? null, automation_near_reward_enabled ?? null, restaurantId]
    );

    res.json({ success: true, automations: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/restaurants/automations ─────────────────────
router.get('/automations', authMiddleware, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT automation_inactive_enabled, automation_near_reward_enabled
       FROM restaurants WHERE id = $1`,
      [req.restaurant.id]
    );
    res.json(result.rows[0] || { automation_inactive_enabled: false, automation_near_reward_enabled: false });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/restaurants/automations/test ───────────────
// Déclencher manuellement les automations pour tester
router.post('/automations/test', authMiddleware, async (req, res, next) => {
  try {
    const { runInactiveJob, runNearRewardJob } = require('../services/automationService');
    await Promise.all([runInactiveJob(), runNearRewardJob()]);
    res.json({ success: true, message: 'Automations déclenchées' });
  } catch (err) {
    next(err);
  }
});
