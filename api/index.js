// Entry point Serverless Function Vercel.
// Cukup re-export server.js supaya route Express tetap SATU sumber kebenaran
// (tidak ada duplikasi kode route antara lokal dan Vercel).
module.exports = require("../server");
