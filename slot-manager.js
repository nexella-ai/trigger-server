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
    const eventTypeUri = process.env.DEFAULT_EVENT_TYPE_URI;
    if (!eventTypeUri) {
      throw new Error("Missing DEFAULT_EVENT_TYPE_URI in environment variables");
    }
    const eventTypeUuid = eventTypeUri.split('/').pop();

    const startDate = new Date(startTime);
    const endDate = new Date(endTime);
    const dayStart = new Date(startDate);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const response = await axios.get(`https://api.calendly.com/event_type_available_times`, {
      params: {
        event_type: eventTypeUuid,
        start_time: dayStart.toISOString(),
        end_time: dayEnd.toISOString()
      },
      headers: {
        Authorization: `Bearer ${process.env.CALENDLY_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const availableTimes = response.data.collection;
    return availableTimes.some(slot => {
      const slotStart = new Date(slot.start_time).getTime();
      const slotEnd = new Date(slot.end_time).getTime();
      return slotStart === new Date(startTime).getTime() &&
             slotEnd === new Date(endTime).getTime();
    });
  } catch (error) {
    console.error('Error checking slot availability:', error.response?.data || error.message);
    throw error;
  }
}

async function getAvailableSlots(date) {
  try {
    const eventTypeUri = process.env.DEFAULT_EVENT_TYPE_URI;
    if (!eventTypeUri) {
      throw new Error("Missing DEFAULT_EVENT_TYPE_URI in environment variables");
    }
    const eventTypeUuid = eventTypeUri.split('/').pop();

    let formattedDate = date;
    if (date instanceof Date) {
      formattedDate = date.toISOString().split('T')[0];
    }

    const startOfDay = new Date(formattedDate);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);

    const response = await axios.get(`https://api.calendly.com/event_type_available_times`, {
      params: {
        event_type: eventTypeUuid,
        start_time: startOfDay.toISOString(),
        end_time: endOfDay.toISOString()
      },
      headers: {
        Authorization: `Bearer ${process.env.CALENDLY_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const availableTimes = response.data.collection;
    return availableTimes
      .filter(slot => {
        return !lockedSlots.has(slot.start_time) || 
               lockedSlots.get(slot.start_time).expiresAt < Date.now();
      })
      .map(slot => ({
        startTime: slot.start_time,
        endTime: slot.end_time
      }));
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
