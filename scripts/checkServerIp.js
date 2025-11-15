// scripts/checkServerIp.js
// Script to check what IP address BillDesk will see from your server
const fetch = require('node-fetch');
const logger = require('../utils/logger');

async function checkServerIp() {
  try {
    console.log('\n========================================');
    console.log('CHECKING SERVER PUBLIC IP ADDRESS');
    console.log('========================================\n');
    
    // Check public IP using multiple services
    const services = [
      { name: 'ipify', url: 'https://api.ipify.org?format=json' },
      { name: 'ip-api', url: 'http://ip-api.com/json/' },
      { name: 'ipinfo', url: 'https://ipinfo.io/json' }
    ];
    
    for (const service of services) {
      try {
        console.log(`Checking IP via ${service.name}...`);
        const response = await fetch(service.url);
        const data = await response.json();
        console.log(`${service.name} response:`, JSON.stringify(data, null, 2));
        
        // Extract IP from different response formats
        const ip = data.ip || data.query || 'Unknown';
        console.log(`\n✅ Your server's public IP: ${ip}`);
        
        if (data.city || data.region || data.country) {
          console.log(`Location: ${data.city || ''} ${data.region || ''} ${data.country || ''}`);
        }
        
        if (data.isp || data.org) {
          console.log(`ISP/Org: ${data.isp || data.org || ''}`);
        }
        
        console.log('\n----------------------------------------\n');
        
      } catch (error) {
        console.error(`❌ Error checking ${service.name}:`, error.message);
      }
    }
    
    console.log('\n========================================');
    console.log('IMPORTANT FOR BILLDESK SUPPORT:');
    console.log('========================================');
    console.log('Please provide the IP address above to BillDesk');
    console.log('for whitelisting in their UAT environment.');
    console.log('\nThis is the IP address that BillDesk will see');
    console.log('when your server makes API requests to them.');
    console.log('========================================\n');
    
  } catch (error) {
    console.error('Error:', error);
  }
}

checkServerIp();
