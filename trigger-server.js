require('dotenv').config();
const express = require('express');
const app = express();
const availabilityRoutes = require('./routes/availability');

app.use(express.json());
app.use('/', availabilityRoutes);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Trigger server running on port ${PORT}`));