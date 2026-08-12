// pm2 process definitions for both services.
//
// Usage:
//   npm install -g pm2          (one-time, on the server)
//   npm install                 (inside order-service/ and inventory-service/ - one-time)
//   pm2 start ecosystem.config.js
//   pm2 status
//   pm2 logs                    (both services, live)
//   pm2 logs order-service      (just one)
//   pm2 restart order-service
//   pm2 stop all
//
// To have pm2 restart both services automatically if the EC2 instance
// reboots:
//   pm2 save
//   pm2 startup                 (then run the command it prints, with sudo)

module.exports = {
  apps: [
    {
      name: 'order-service',
      cwd: './order-service',
      script: 'server.js',
      env: {
        PORT: 3000,
        INVENTORY_SERVICE_URL: 'http://localhost:3001',
      },
    },
    {
      name: 'inventory-service',
      cwd: './inventory-service',
      script: 'server.js',
      env: {
        PORT: 3001,
      },
    },
  ],
};
