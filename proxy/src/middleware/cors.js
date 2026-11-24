'use strict';

const { applyCors } = require('../utils/headers');

function corsMiddleware(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

module.exports = { corsMiddleware };
