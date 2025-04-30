// slot-manager.js
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const CALENDLY_API_BASE = 'https://api.calendly.com';
const CALENDLY_USER_ID = process.env.CALENDLY_USER_ID; // should be just the UUID, not full URI
const CALENDLY_AUTH_HEADER = {
  Authorization: `Bearer ${process.env.CALENDLY_API_KEY}`,
  'Content-Type': 'application/json',
};

function toISO(date) {
  return new Date(date).toISOString();
}

async function isSlotAvailable(startTime, endTime) {
  const response = await axios.get(`${CALENDLY_API_BASE}/scheduled_events`, {
    headers: CALENDLY_AUTH_HEADER,
    params: {
      user: CALENDLY_USER_ID,
      min_start_time: toISO(startTime),
      max_start_time: toISO(endTime),
    },
  });

  const events = response.data.collection || [];
  return events.length === 0;
}

async function createEvent({ name, email, phone, startTime, endTime }) {
  const payload = {
    invitee: {
      email,
      name,
      phone_number: phone,
    },
    event_type: `${CALENDLY_API_BASE}/event_types/${process.env.CALENDLY_EVENT_TYPE_ID}`,
    start_time: toISO(startTime),
    end_time: toISO(endTime),
    name,
  };

  const response = await axios.post(`${CALENDLY_API_BASE}/scheduled_events`, payload, {
    headers: CALENDLY_AUTH_HEADER,
  });

  return response.data.resource;
}

async function scheduleCall({ name, email, phone, startTime, endTime }) {
  const available = await isSlotAvailable(startTime, endTime);

  if (!available) {
    throw new Error('Time slot is not available');
  }

  const event = await createEvent({ name, email, phone, startTime, endTime });
  return event;
}

module.exports = {
  isSlotAvailable,
  createEvent,
  scheduleCall,
};
