require('dotenv').config();
const axios = require('axios');

// In-memory store for slot reservations (would use Redis in production)
const lockedSlots = new Map();

function lockSlot(startTime, userId, expirationSeconds = 300) {
  const key = startTime;
  if (lockedSlots.has(key) && lockedSlots.get(key).userId !== userId) {
    return false;
  }
  lockedSlots.set(key, {
    userId,
    expiresAt: Date.now() + (expirationSeconds * 1000)
  });
  setTimeout(() => {
    const lock = lockedSlots.get(key);
    if (lock && lock.userId === userId) {
      lockedSlots.delete(key);
      console.log(`Lock for slot ${key} expired and was released`);
    }
  }, expirationSeconds * 1000);
  return true;
}

function confirmSlot(startTime, userId) {
  const key = startTime;
  if (lockedSlots.has(key)) {
    const lock = lockedSlots.get(key);
    if (lock.userId === userId && lock.expiresAt > Date.now()) {
      lockedSlots.delete(key);
      return true;
    }
  }
  return false;
}

function releaseSlot(startTime, userId) {
  const key = startTime;
  if (lockedSlots.has(key) && lockedSlots.get(key).userId === userId) {
    lockedSlots.delete(key);
    return true;
  }
  return false;
}

async function isSlotAvailable(startTime, endTime) {
  try {
    const userUri = process.env.CALENDLY_USER_URI;
    if (!userUri) throw new Error("Missing CALENDLY_USER_URI in environment variables");

    const response = await axios.get('https://api.calendly.com/scheduled_events', {
      params: {
        user_uri: userUri,
        min_start_time: startTime,
        max_start_time: endTime
      },
      headers: {
        Authorization: `Bearer ${process.env.CALENDLY_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const events = response.data.collection || [];
    return events.length === 0; // slot is available if no events overlap
  } catch (error) {
    console.error('Calendly availability error:', error.response?.data || error.message);
    throw error;
  }
}

async function getAvailableSlots(date) {
  try {
    const userUri = process.env.CALENDLY_USER_URI;
    if (!userUri) throw new Error("Missing CALENDLY_USER_URI in environment variables");

    const startOfDay = new Date(date);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);

    const response = await axios.get('https://api.calendly.com/scheduled_events', {
      params: {
        user_uri: userUri,
        min_start_time: startOfDay.toISOString(),
        max_start_time: endOfDay.toISOString()
      },
      headers: {
        Authorization: `Bearer ${process.env.CALENDLY_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const scheduledEvents = response.data.collection || [];
    const eventTimes = scheduledEvents.map(event => new Date(event.start_time).toISOString());

    const potentialSlots = [];
    for (let hour = 8; hour < 17; hour++) {
      for (let min of [0, 30]) {
        const slot = new Date(startOfDay);
        slot.setUTCHours(hour, min, 0, 0);
        const slotIso = slot.toISOString();
        if (!eventTimes.includes(slotIso) &&
            (!lockedSlots.has(slotIso) || lockedSlots.get(slotIso).expiresAt < Date.now())) {
          potentialSlots.push({
            startTime: slotIso,
            endTime: new Date(slot.getTime() + 30 * 60000).toISOString()
          });
        }
      }
    }

    return potentialSlots;
  } catch (error) {
    console.error('Error getting available slots:', error.response?.data || error.message);
    return [];
  }
}

module.exports = {
  lockSlot,
  confirmSlot,
  releaseSlot,
  isSlotAvailable,
  getAvailableSlots
};
