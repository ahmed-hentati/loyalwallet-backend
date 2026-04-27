const express = require('express');
const router = express.Router();
const { pool } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

// GET /api/restaurants/me
router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, phone, logo_url, plan, slug, created_at FROM restaurants WHERE id = $1',
      [req.restaurant.id]
    );
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// PUT /api/restaurants/me
router.put('/me', authMiddleware, async (req, res, next) => {
  try {
    const { name, phone, address, city, postal_code, website } = req.body;

    const slug = name
      ? name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').substring(0, 60)
      : null;

    const result = await pool.query(
      `UPDATE restaurants
       SET name        = COALESCE($1, name),
           phone       = COALESCE($2, phone),
           slug        = COALESCE($3, slug),
           address     = COALESCE($4, address),
           city        = COALESCE($5, city),
           postal_code = COALESCE($6, postal_code),
           website     = COALESCE($7, website)
       WHERE id = $8
       RETURNING id, name, email, phone, logo_url, plan, slug, address, city, postal_code, website`,
      [name || null, phone || null, slug, address || null, city || null, postal_code || null, website || null, req.restaurant.id]
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
