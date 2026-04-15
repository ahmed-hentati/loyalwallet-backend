const express = require('express');
const router = express.Router();
const { pool } = require('../db/pool');
const { generatePass } = require('../services/passService');

// ══════════════════════════════════════════════════════════
// Apple Wallet WebService — Protocole obligatoire Apple
// Doc : https://developer.apple.com/documentation/walletpasses
//
// Ces routes permettent à l'iPhone de :
//   1. Enregistrer son push token (pour recevoir les mises à jour)
//   2. Vérifier si son pass a changé
//   3. Télécharger le pass mis à jour
// ══════════════════════════════════════════════════════════

// ─── POST /wallet/v1/devices/:deviceId/registrations/:passTypeId/:serialNumber
// L'iPhone s'enregistre et envoie son push token
router.post(
  '/v1/devices/:deviceId/registrations/:passTypeId/:serialNumber',
  async (req, res) => {
    try {
      const { serialNumber } = req.params;
      const { pushToken } = req.body;
      const authToken = req.headers.authorization?.replace('ApplePass ', '');

      // Vérifier l'authenticationToken
      if (authToken !== serialNumber) {
        return res.status(401).send();
      }

      // Sauvegarder le push token Apple
      const result = await pool.query(
        'UPDATE card_holders SET apn_push_token = $1 WHERE serial_number = $2 RETURNING id',
        [pushToken, serialNumber]
      );

      if (result.rows.length === 0) {
        return res.status(404).send();
      }

      // 201 = nouvellement enregistré, 200 = déjà enregistré
      res.status(201).send();

    } catch (err) {
      console.error('Wallet registration error:', err);
      res.status(500).send();
    }
  }
);

// ─── DELETE /wallet/v1/devices/:deviceId/registrations/:passTypeId/:serialNumber
// L'iPhone se désenregistre (pass supprimé du Wallet)
router.delete(
  '/v1/devices/:deviceId/registrations/:passTypeId/:serialNumber',
  async (req, res) => {
    try {
      const { serialNumber } = req.params;

      await pool.query(
        'UPDATE card_holders SET apn_push_token = NULL WHERE serial_number = $1',
        [serialNumber]
      );

      res.status(200).send();
    } catch (err) {
      res.status(500).send();
    }
  }
);

// ─── GET /wallet/v1/passes/:passTypeId/:serialNumber
// L'iPhone télécharge le pass mis à jour
router.get(
  '/v1/passes/:passTypeId/:serialNumber',
  async (req, res) => {
    try {
      const { serialNumber } = req.params;
      const authToken = req.headers.authorization?.replace('ApplePass ', '');

      if (authToken !== serialNumber) {
        return res.status(401).send();
      }

      const result = await pool.query(
        `SELECT ch.*, lc.card_name, lc.background_color, lc.foreground_color,
                lc.label_color, lc.reward_description, lc.points_for_reward
         FROM card_holders ch
         JOIN loyalty_cards lc ON ch.card_id = lc.id
         WHERE ch.serial_number = $1`,
        [serialNumber]
      );

      if (result.rows.length === 0) {
        return res.status(404).send();
      }

      const row = result.rows[0];
      const card   = { card_name: row.card_name, background_color: row.background_color, foreground_color: row.foreground_color, label_color: row.label_color, reward_description: row.reward_description, points_for_reward: row.points_for_reward };
      const holder = { id: row.id, serial_number: row.serial_number, points: row.points, total_visits: row.total_visits };

      const passBuffer = await generatePass(card, holder);

      res.set({
        'Content-Type': 'application/vnd.apple.pkpass',
        'Last-Modified': new Date(row.updated_at).toUTCString(),
      });
      res.send(passBuffer);

    } catch (err) {
      console.error('Wallet pass fetch error:', err);
      res.status(500).send();
    }
  }
);

// ─── GET /wallet/v1/log ───────────────────────────────────
// Apple envoie des logs d'erreur ici
router.post('/v1/log', (req, res) => {
  console.log('📱 Apple Wallet log:', req.body);
  res.status(200).send();
});

module.exports = router;
