'use strict';
const axios = require('axios');
const config = require('../config');

const api = axios.create({
  baseURL: `http://127.0.0.1:${config.server.port}/api`,
  headers: { 'x-api-key': config.server.apiSecret },
  timeout: 30000,
});

// Unwrap axios errors into plain Error objects
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const msg = err.response?.data?.error || err.message;
    return Promise.reject(new Error(msg));
  }
);

module.exports = api;
