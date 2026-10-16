const cron = require('node-cron');

cron.schedule('0 * * * *', () => {
  console.log('sending report to', process.env.REPORT_EMAIL);
});
