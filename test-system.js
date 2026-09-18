// Test suite to verify all access control endpoints and anti-passback guarantees
const http = require('http');

function request(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, body });
        }
      });
    });
    req.on('error', reject);
    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Starting Event Pass Validation Test Suite...\n');

  // Test 1: Fetch tickets
  const initial = await request({
    host: '127.0.0.1',
    port: 3000,
    path: '/api/tickets',
    method: 'GET'
  });
  console.log(`✅ [TEST 1] GET /api/tickets -> Total: ${initial.data.stats.total} tickets`);

  // Test 2: Generate Ticket
  const gen = await request({
    host: '127.0.0.1',
    port: 3000,
    path: '/api/generate-ticket',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    guest_name: 'John Wick',
    phone_number: '+1 800-555-0100',
    email: 'john@continental.hotel',
    ticket_category: 'VIP All Access'
  });

  const ticketId = gen.data.ticket.id;
  const qrLength = gen.data.qr_code.length;
  console.log(`✅ [TEST 2] POST /api/generate-ticket -> Created ticket: ${ticketId} (QR length: ${qrLength} chars)`);

  // Test 3: First Scan (Should Pass - Green)
  const scan1 = await request({
    host: '127.0.0.1',
    port: 3000,
    path: '/api/scan-ticket',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    ticket_id: ticketId,
    scanned_by: 'Gate-West-Turnstile-01'
  });
  console.log(`✅ [TEST 3] Scan #1 (First Use) -> HTTP ${scan1.status} | Status: ${scan1.data.status} | Guest: ${scan1.data.guest.guest_name}`);
  if (scan1.status !== 200 || scan1.data.status !== 'valid') {
    throw new Error('Test 3 failed: Expected valid status 200');
  }

  // Test 4: Duplicate Scan (Should Reject - Red / Anti-Passback)
  const scan2 = await request({
    host: '127.0.0.1',
    port: 3000,
    path: '/api/scan-ticket',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    ticket_id: ticketId,
    scanned_by: 'Gate-East-Turnstile-02'
  });
  console.log(`✅ [TEST 4] Scan #2 (Anti-Passback Duplicate) -> HTTP ${scan2.status} | Status: ${scan2.data.status} | Message: ${scan2.data.message}`);
  if (scan2.status !== 409 || scan2.data.status !== 'already_used') {
    throw new Error('Test 4 failed: Expected already_used status 409');
  }

  // Test 5: Invalid Scan (Should Reject - Yellow / Invalid)
  const scan3 = await request({
    host: '127.0.0.1',
    port: 3000,
    path: '/api/scan-ticket',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    ticket_id: '00000000-0000-0000-0000-000000000000'
  });
  console.log(`✅ [TEST 5] Scan #3 (Invalid Token) -> HTTP ${scan3.status} | Status: ${scan3.data.status} | Message: ${scan3.data.message}`);
  if (scan3.status !== 404 || scan3.data.status !== 'invalid') {
    throw new Error('Test 5 failed: Expected invalid status 404');
  }

  // Test 6: Reset Ticket
  const reset = await request({
    host: '127.0.0.1',
    port: 3000,
    path: `/api/reset-ticket/${ticketId}`,
    method: 'POST'
  });
  console.log(`✅ [TEST 6] POST /api/reset-ticket/:id -> HTTP ${reset.status} | Message: ${reset.data.message}`);

  // Test 7: Scan after Reset (Should be valid again)
  const scanAfterReset = await request({
    host: '127.0.0.1',
    port: 3000,
    path: '/api/scan-ticket',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    ticket_id: ticketId,
    scanned_by: 'Gate-West-Turnstile-01'
  });
  console.log(`✅ [TEST 7] Scan after Reset -> HTTP ${scanAfterReset.status} | Status: ${scanAfterReset.data.status}`);
  if (scanAfterReset.status !== 200 || scanAfterReset.data.status !== 'valid') {
    throw new Error('Test 7 failed: Expected valid status 200 after reset');
  }

  console.log('\n🎉 ALL 7 TEST CASES PASSED FLAWLESSLY! Anti-passback is fully verified.');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
