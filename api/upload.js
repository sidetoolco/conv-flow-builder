// Vercel serverless function for handling uploads
module.exports = require('../server.js');

// Configure Vercel to allow larger payloads
module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};