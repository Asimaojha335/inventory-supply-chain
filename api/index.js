// Deployed as api/index.js: one serverless function serves every route (Vercel's free plan allows 12 functions per project).
const app = require("./_lib/app");

module.exports = (req, res) => app.handler(req, res);
