'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Small, dependency-free .env loader for local development. Real environment
// variables always win, and nothing here is logged.
function loadEnvFile(directory) {
  var file = path.join(directory || process.cwd(), '.env');
  var values = {};
  if (!fs.existsSync(file)) return values;

  var lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach(function (line) {
    var trimmed = line.trim();
    if (!trimmed || trimmed.charAt(0) === '#') return;
    var equals = trimmed.indexOf('=');
    if (equals === -1) return;
    var key = trimmed.slice(0, equals).trim();
    var value = trimmed.slice(equals + 1).trim();
    if ((value.charAt(0) === '"' && value.slice(-1) === '"') ||
        (value.charAt(0) === "'" && value.slice(-1) === "'")) {
      value = value.slice(1, -1);
    }
    values[key] = value;
    if (process.env[key] === undefined) process.env[key] = value;
  });
  return values;
}

module.exports = { loadEnvFile };
