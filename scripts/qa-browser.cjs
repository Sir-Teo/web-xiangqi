const playwright = require('playwright');
const browserName = process.env.XIANGQI_QA_BROWSER || 'chromium';
if (!['chromium', 'webkit', 'firefox'].includes(browserName)) {
  throw new Error(`Unknown XIANGQI_QA_BROWSER: ${browserName}. Use chromium, webkit, or firefox.`);
}
module.exports = { browserType: playwright[browserName] };
