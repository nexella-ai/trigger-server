const express = require('express');
const router = express.Router();
const { getAvailableSlots } = require('../services/slotManager');

router.post('/available-slots', async (req, res) => {
  try {
    const { email, phone, name } = req.body;
    const slots = await getAvailableSlots(email, phone, name);
    res.json({ success: true, slots });
  } catch (err) {
    console.error('Slot error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;