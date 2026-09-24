const dotenv = require('dotenv');
dotenv.config();

const { startServer } = require('../server');
const seedData = require('./seed');
const { disconnectDB } = require('../config/db');

const PORT = process.env.PORT || 5001;
const BASE_URL = `http://localhost:${PORT}`;

let serverInstance = null;
let passedCount = 0;
let failedCount = 0;

const logPass = (testName, detail = '') => {
  passedCount++;
  console.log(`  \x1b[32m✔ PASS\x1b[0m: ${testName} ${detail ? `\x1b[90m(${detail})\x1b[0m` : ''}`);
};

const logFail = (testName, err) => {
  failedCount++;
  console.log(`  \x1b[31m✖ FAIL\x1b[0m: ${testName}`);
  console.log(`    \x1b[31mError: ${err}\x1b[0m`);
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
};

const runTests = async () => {
  console.log('\n================================================================');
  console.log('🧪 PHARMACY MANAGEMENT API COMPREHENSIVE SMOKE TEST SUITE');
  console.log('================================================================\n');

  try {
    // 1. Seed Clean Data (keep connection alive)
    console.log('--- Step 0: Seeding Database ---');
    await seedData(false);

    // 2. Start HTTP Server
    console.log('--- Step 1: Starting Express Test Server ---');
    serverInstance = await startServer();
    console.log(`Server running and listening on ${BASE_URL}\n`);

    // Helper fetch wrapper
    const req = async (path, options = {}) => {
      const res = await fetch(`${BASE_URL}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      });
      const data = await res.json().catch(() => ({}));
      return { status: res.status, ok: res.ok, data };
    };

    // -------------------------------------------------------------
    // SECTION 1: Health & Root Endpoints
    // -------------------------------------------------------------
    console.log('--- Section 1: Health & API Discovery ---');
    {
      const res = await req('/health');
      assert(res.status === 200 && res.data.status === 'ok', 'Expected 200 OK from /health');
      logPass('GET /health returns 200 with status ok');
    }
    {
      const res = await req('/');
      assert(res.status === 200 && res.data.endpoints, 'Expected 200 with endpoints list from /');
      logPass('GET / returns 200 with API metadata');
    }

    // -------------------------------------------------------------
    // SECTION 2: Auth & Role Registration Barrier Tests
    // -------------------------------------------------------------
    console.log('\n--- Section 2: Auth & Registration RBAC Barriers ---');
    
    // Test public customer register forces role=customer even if role=admin is passed
    const testCustEmail = `cust_${Date.now()}@test.com`;
    let customerToken = null;
    let customerUser = null;
    {
      const res = await req('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Public Registered Customer',
          email: testCustEmail,
          password: 'Password123!',
          role: 'admin' // Should be ignored/forced to customer
        })
      });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
      assert(res.data.user.role === 'customer', `Expected role customer, got ${res.data.user.role}`);
      assert(res.data.token, 'Expected JWT token');
      customerToken = res.data.token;
      customerUser = res.data.user;
      logPass('POST /api/auth/register creates customer and ignores role escalation');
    }

    // Test register with short password
    {
      const res = await req('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Short Pass',
          email: 'shortpass@test.com',
          password: '123'
        })
      });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      logPass('POST /api/auth/register rejects password < 6 characters (400)');
    }

    // Test register duplicate email
    {
      const res = await req('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Duplicate',
          email: testCustEmail,
          password: 'Password123!'
        })
      });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      logPass('POST /api/auth/register rejects duplicate email (400)');
    }

    // Test register-staff without x-admin-key header
    {
      const res = await req('/api/auth/register-staff', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Hacker',
          email: 'hacker@test.com',
          password: 'Password123!',
          role: 'admin'
        })
      });
      assert(res.status === 403, `Expected 403 Forbidden without x-admin-key, got ${res.status}`);
      logPass('POST /api/auth/register-staff blocks request without x-admin-key (403)');
    }

    // Test register-staff with invalid x-admin-key header
    {
      const res = await req('/api/auth/register-staff', {
        method: 'POST',
        headers: { 'x-admin-key': 'wrongkey123' },
        body: JSON.stringify({
          name: 'Hacker',
          email: 'hacker@test.com',
          password: 'Password123!',
          role: 'admin'
        })
      });
      assert(res.status === 403, `Expected 403 Forbidden with invalid x-admin-key, got ${res.status}`);
      logPass('POST /api/auth/register-staff blocks request with invalid x-admin-key (403)');
    }

    // Test register-staff with valid admin key creating Pharmacist
    const testPharmaEmail = `pharma_${Date.now()}@test.com`;
    let pharmacistToken = null;
    {
      const res = await req('/api/auth/register-staff', {
        method: 'POST',
        headers: { 'x-admin-key': process.env.ADMIN_KEY || 'supersecretadminkey2026' },
        body: JSON.stringify({
          name: 'Certified Pharmacist',
          email: testPharmaEmail,
          password: 'Password123!',
          role: 'pharmacist'
        })
      });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
      assert(res.data.user.role === 'pharmacist', `Expected role pharmacist, got ${res.data.user.role}`);
      pharmacistToken = res.data.token;
      logPass('POST /api/auth/register-staff registers pharmacist with valid x-admin-key (201)');
    }

    // Test register-staff with valid admin key creating Admin
    const testAdminEmail = `admin_${Date.now()}@test.com`;
    let adminToken = null;
    {
      const res = await req('/api/auth/register-staff', {
        method: 'POST',
        headers: { 'x-admin-key': process.env.ADMIN_KEY || 'supersecretadminkey2026' },
        body: JSON.stringify({
          name: 'Master Admin',
          email: testAdminEmail,
          password: 'Password123!',
          role: 'admin'
        })
      });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
      assert(res.data.user.role === 'admin', `Expected role admin, got ${res.data.user.role}`);
      adminToken = res.data.token;
      logPass('POST /api/auth/register-staff registers admin with valid x-admin-key (201)');
    }

    // Test login with valid credentials
    {
      const res = await req('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'admin@pharmacy.com',
          password: 'Admin@123'
        })
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.data.token, 'Expected JWT token');
      assert(!res.data.user.password, 'Password must never be exposed');
      logPass('POST /api/auth/login returns JWT token and strips password (200)');
    }

    // Test login with invalid password (generic message)
    {
      const res = await req('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'admin@pharmacy.com',
          password: 'WrongPassword'
        })
      });
      assert(res.status === 401, `Expected 401, got ${res.status}`);
      assert(res.data.message === 'Invalid email or password', 'Must return generic invalid message');
      logPass('POST /api/auth/login with wrong credentials returns generic 401');
    }

    // Test profile route with valid JWT
    {
      const res = await req('/api/auth/profile', {
        headers: { Authorization: `Bearer ${customerToken}` }
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.data.user.email === testCustEmail, 'Expected profile for customer');
      logPass('GET /api/auth/profile returns user details with valid token (200)');
    }

    // Test profile route without token / garbage token
    {
      const res1 = await req('/api/auth/profile');
      assert(res1.status === 401, `Expected 401 without token, got ${res1.status}`);

      const res2 = await req('/api/auth/profile', {
        headers: { Authorization: 'Bearer garbage.invalid.token' }
      });
      assert(res2.status === 401, `Expected 401 with invalid token, got ${res2.status}`);
      logPass('GET /api/auth/profile rejects missing and garbage tokens (401)');
    }

    // -------------------------------------------------------------
    // SECTION 3: Medicine Catalog & RBAC Permissions
    // -------------------------------------------------------------
    console.log('\n--- Section 3: Medicine Catalog & Inventory RBAC ---');

    // Test Public GET /api/medicines
    let publicMedList = [];
    {
      const res = await req('/api/medicines');
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(Array.isArray(res.data.medicines), 'Expected medicines array');
      assert(res.data.medicines.every((m) => new Date(m.expiryDate) > new Date()), 'Expired medicines must be excluded by default');
      publicMedList = res.data.medicines;
      logPass(`GET /api/medicines returns active catalog (${res.data.count} items, expired excluded)`);
    }

    // Test Search & Filters
    {
      const res = await req('/api/medicines?search=amox&category=Antibiotic');
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.data.medicines.every((m) => m.category.toLowerCase() === 'antibiotic'), 'Expected category filter match');
      logPass('GET /api/medicines supports search and category filters');
    }

    // Test Sorting & Pagination
    {
      const res = await req('/api/medicines?sort=price_asc&limit=2&page=1');
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.data.medicines.length <= 2, 'Limit 2 enforced');
      if (res.data.medicines.length === 2) {
        assert(res.data.medicines[0].price <= res.data.medicines[1].price, 'Expected price ascending sort');
      }
      logPass('GET /api/medicines pagination and price_asc sorting works');
    }

    // Customer attempts to add a medicine -> 403 Forbidden
    {
      const res = await req('/api/medicines', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerToken}` },
        body: JSON.stringify({
          name: 'Illegal Medicine',
          brand: 'BrandX',
          category: 'Analgesic',
          dosageForm: 'Tablet',
          price: 10,
          stockQuantity: 10,
          expiryDate: new Date(Date.now() + 10000000)
        })
      });
      assert(res.status === 403, `Expected 403 Forbidden for customer, got ${res.status}`);
      logPass('POST /api/medicines blocks customer role (403 Forbidden)');
    }

    // Pharmacist adds medicine validation failure (negative price)
    {
      const res = await req('/api/medicines', {
        method: 'POST',
        headers: { Authorization: `Bearer ${pharmacistToken}` },
        body: JSON.stringify({
          name: 'Bad Price Med',
          brand: 'BrandX',
          category: 'Analgesic',
          dosageForm: 'Tablet',
          price: -5,
          stockQuantity: 10,
          expiryDate: new Date(Date.now() + 10000000)
        })
      });
      assert(res.status === 400, `Expected 400 for negative price, got ${res.status}`);
      logPass('POST /api/medicines rejects negative price (400)');
    }

    // Pharmacist adds medicine validation failure (past expiry date)
    {
      const res = await req('/api/medicines', {
        method: 'POST',
        headers: { Authorization: `Bearer ${pharmacistToken}` },
        body: JSON.stringify({
          name: 'Past Expiry Med',
          brand: 'BrandX',
          category: 'Analgesic',
          dosageForm: 'Tablet',
          price: 10,
          stockQuantity: 10,
          expiryDate: new Date(Date.now() - 10000000)
        })
      });
      assert(res.status === 400, `Expected 400 for past expiry date, got ${res.status}`);
      logPass('POST /api/medicines rejects past expiry date (400)');
    }

    // Pharmacist successfully adds medicine -> 201
    let newlyCreatedMed = null;
    {
      const res = await req('/api/medicines', {
        method: 'POST',
        headers: { Authorization: `Bearer ${pharmacistToken}` },
        body: JSON.stringify({
          name: 'Clarithromycin 500mg',
          brand: 'Biaxin',
          category: 'Antibiotic',
          dosageForm: 'Tablet',
          price: 28.5,
          stockQuantity: 20,
          requiresPrescription: true,
          expiryDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
        })
      });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
      assert(res.data.medicine.name === 'Clarithromycin 500mg', 'Expected medicine name');
      newlyCreatedMed = res.data.medicine;
      logPass('POST /api/medicines allows pharmacist to create medicine (201)');
    }

    // Pharmacist updates medicine -> 200
    {
      const res = await req(`/api/medicines/${newlyCreatedMed._id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${pharmacistToken}` },
        body: JSON.stringify({
          price: 32.0,
          stockQuantity: 25
        })
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.data.medicine.price === 32.0, 'Expected updated price');
      assert(res.data.medicine.stockQuantity === 25, 'Expected updated stock');
      logPass('PUT /api/medicines/:id allows pharmacist to update stock and price (200)');
    }

    // Customer attempts to delete medicine -> 403
    {
      const res = await req(`/api/medicines/${newlyCreatedMed._id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${customerToken}` }
      });
      assert(res.status === 403, `Expected 403 Forbidden for customer, got ${res.status}`);
      logPass('DELETE /api/medicines/:id blocks customer (403)');
    }

    // Pharmacist attempts to delete medicine -> 403 Forbidden (Admin only!)
    {
      const res = await req(`/api/medicines/${newlyCreatedMed._id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${pharmacistToken}` }
      });
      assert(res.status === 403, `Expected 403 Forbidden for pharmacist, got ${res.status}`);
      logPass('DELETE /api/medicines/:id blocks pharmacist (403 Forbidden, Admin only)');
    }

    // Admin deletes medicine -> 200
    {
      const res = await req(`/api/medicines/${newlyCreatedMed._id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      logPass('DELETE /api/medicines/:id allows admin to delete medicine (200)');
    }

    // -------------------------------------------------------------
    // SECTION 4: Aggregation Reports (Expiring & Low Stock)
    // -------------------------------------------------------------
    console.log('\n--- Section 4: Inventory Reports & MongoDB Aggregation ---');

    // Customer attempts to view expiring report -> 403
    {
      const res = await req('/api/medicines/expiring', {
        headers: { Authorization: `Bearer ${customerToken}` }
      });
      assert(res.status === 403, `Expected 403 Forbidden for customer, got ${res.status}`);
      logPass('GET /api/medicines/expiring blocks customer (403)');
    }

    // Staff views expiring report -> 200 with daysUntilExpiry computed
    {
      const res = await req('/api/medicines/expiring?days=30', {
        headers: { Authorization: `Bearer ${pharmacistToken}` }
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(Array.isArray(res.data.medicines), 'Expected medicines array');
      assert(res.data.medicines.every((m) => m.daysUntilExpiry !== undefined), 'daysUntilExpiry must be projected');
      logPass(`GET /api/medicines/expiring returns ${res.data.count} drugs expiring in 30 days with daysUntilExpiry`);
    }

    // Staff views /api/reports/expiring-soon alias -> 200
    {
      const res = await req('/api/reports/expiring-soon?days=30', {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      logPass('GET /api/reports/expiring-soon alias returns 200 for staff');
    }

    // Staff views /api/medicines/low-stock with $facet -> 200
    {
      const res = await req('/api/medicines/low-stock?threshold=10', {
        headers: { Authorization: `Bearer ${pharmacistToken}` }
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.data.summary && Array.isArray(res.data.summary.categories), 'Expected $facet category summary');
      assert(res.data.medicines.every((m) => m.stockQuantity <= 10), 'All items must have stock <= threshold');
      logPass(`GET /api/medicines/low-stock aggregation returns ${res.data.count} low-stock drugs with category summary`);
    }

    // -------------------------------------------------------------
    // SECTION 5: Orders, Prescription Flow & Atomic Stock Deduction
    // -------------------------------------------------------------
    console.log('\n--- Section 5: Order Lifecycle, Prescription Flow & Atomic Deductions ---');

    // Find non-prescription and prescription medicines
    const nonRxMed = publicMedList.find((m) => !m.requiresPrescription && m.stockQuantity >= 10);
    const rxMed = publicMedList.find((m) => m.requiresPrescription && m.stockQuantity >= 5);

    // Pharmacist/Admin trying to place order -> 403 Forbidden
    {
      const res = await req('/api/orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${pharmacistToken}` },
        body: JSON.stringify({
          items: [{ medicineId: nonRxMed._id, quantity: 1 }]
        })
      });
      assert(res.status === 403, `Expected 403 Forbidden for staff placing order, got ${res.status}`);
      logPass('POST /api/orders blocks pharmacist/admin from placing orders (403 Customer only)');
    }

    // Order prescription medicine without prescriptionNotes -> 400
    {
      const res = await req('/api/orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerToken}` },
        body: JSON.stringify({
          items: [{ medicineId: rxMed._id, quantity: 1 }]
          // missing prescriptionNotes
        })
      });
      assert(res.status === 400, `Expected 400 for missing prescription notes, got ${res.status}`);
      logPass('POST /api/orders rejects prescription medicine order without prescriptionNotes (400)');
    }

    // Order more than available stock -> 400 Insufficient stock
    {
      const res = await req('/api/orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerToken}` },
        body: JSON.stringify({
          items: [{ medicineId: nonRxMed._id, quantity: 99999 }]
        })
      });
      assert(res.status === 400, `Expected 400 Insufficient stock, got ${res.status}`);
      logPass('POST /api/orders rejects quantities exceeding available stock (400)');
    }

    // Customer places valid order for non-prescription medicine
    let order1 = null;
    const initialStockNonRx = nonRxMed.stockQuantity;
    {
      const res = await req('/api/orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerToken}` },
        body: JSON.stringify({
          items: [{ medicineId: nonRxMed._id, quantity: 2 }]
        })
      });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
      assert(res.data.order.status === 'pending', 'Order must start as pending');
      assert(res.data.order.totalAmount === Math.round(nonRxMed.price * 2 * 100) / 100, 'Server must compute totalAmount');
      order1 = res.data.order;
      logPass(`POST /api/orders creates pending order with server-calculated price ($${order1.totalAmount})`);
    }

    // Customer places valid order for prescription medicine
    let rxOrder = null;
    {
      const res = await req('/api/orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerToken}` },
        body: JSON.stringify({
          items: [{ medicineId: rxMed._id, quantity: 1 }],
          prescriptionNotes: 'Dr. Smith Rx#8841 valid for 30 days'
        })
      });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
      assert(res.data.order.requiresPrescription === true, 'Expected requiresPrescription true');
      rxOrder = res.data.order;
      logPass('POST /api/orders creates pending prescription order with notes');
    }

    // Customer views own order history
    {
      const res = await req('/api/orders/my-orders', {
        headers: { Authorization: `Bearer ${customerToken}` }
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.data.orders.length >= 2, 'Expected customer orders');
      logPass('GET /api/orders/my-orders returns customer order history (200)');
    }

    // Staff lists all orders
    {
      const res = await req('/api/orders?status=pending', {
        headers: { Authorization: `Bearer ${pharmacistToken}` }
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.data.orders.every((o) => o.status === 'pending'), 'Filter pending enforced');
      logPass('GET /api/orders lists all orders with ?status= filter for staff');
    }

    // Customer attempts to approve own order -> 403 Forbidden
    {
      const res = await req(`/api/orders/${order1._id}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${customerToken}` },
        body: JSON.stringify({ status: 'approved' })
      });
      assert(res.status === 403, `Expected 403 Forbidden for customer approving order, got ${res.status}`);
      logPass('PATCH /api/orders/:id/status blocks customer from approving orders (403)');
    }

    // Pharmacist tries to approve prescription order without prescriptionVerified -> 400
    {
      const res = await req(`/api/orders/${rxOrder._id}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${pharmacistToken}` },
        body: JSON.stringify({ status: 'approved' })
      });
      assert(res.status === 400, `Expected 400 when prescription not verified, got ${res.status}`);
      logPass('PATCH /api/orders/:id/status rejects Rx approval without prescriptionVerified: true (400)');
    }

    // Pharmacist approves prescription order with prescriptionVerified: true -> 200
    {
      const res = await req(`/api/orders/${rxOrder._id}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${pharmacistToken}` },
        body: JSON.stringify({
          status: 'approved',
          prescriptionVerified: true
        })
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.data.order.status === 'approved', 'Expected approved status');
      logPass('PATCH /api/orders/:id/status approves Rx order with prescriptionVerified: true (200)');
    }

    // Pharmacist approves order1 -> verify atomic stock decrement
    {
      const res = await req(`/api/orders/${order1._id}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${pharmacistToken}` },
        body: JSON.stringify({ status: 'approved' })
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);

      // Check medicine stock in catalog
      const medRes = await req('/api/medicines');
      const updatedMed = medRes.data.medicines.find((m) => m._id === nonRxMed._id);
      const expectedStock = initialStockNonRx - 2;
      assert(updatedMed.stockQuantity === expectedStock, `Expected stock ${expectedStock}, got ${updatedMed.stockQuantity}`);
      logPass(
        'PATCH /api/orders/:id/status atomically decrements stock on approval',
        `Stock: ${initialStockNonRx} -> ${updatedMed.stockQuantity}`
      );
    }

    // Duplicate approval check: attempting to approve order1 again -> Conflict (409) or Invalid transition (400)
    {
      const res = await req(`/api/orders/${order1._id}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${pharmacistToken}` },
        body: JSON.stringify({ status: 'approved' })
      });
      assert(res.status === 400 || res.status === 409, `Expected 400/409 on duplicate approval, got ${res.status}`);
      logPass('Duplicate/concurrent approval rejected without double deduction');
    }

    // Transition approved -> dispensed (no additional stock change)
    {
      const res = await req(`/api/orders/${order1._id}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${pharmacistToken}` },
        body: JSON.stringify({ status: 'dispensed' })
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.data.order.status === 'dispensed', 'Expected status dispensed');
      logPass('PATCH /api/orders/:id/status allows approved -> dispensed transition (200)');
    }

    // Terminal state check: dispensed -> approved or cancelled -> 400
    {
      const res = await req(`/api/orders/${order1._id}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${pharmacistToken}` },
        body: JSON.stringify({ status: 'cancelled' })
      });
      assert(res.status === 400, `Expected 400 for terminal state modification, got ${res.status}`);
      logPass('Terminal order states (dispensed/cancelled) cannot be altered (400)');
    }

    // Test approved -> cancelled restock flow
    let orderToCancel = null;
    let preCancelStock = 0;
    {
      // 1. Create new order
      const resOrder = await req('/api/orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerToken}` },
        body: JSON.stringify({
          items: [{ medicineId: nonRxMed._id, quantity: 3 }]
        })
      });
      orderToCancel = resOrder.data.order;

      // 2. Approve it (stock decremented by 3)
      await req(`/api/orders/${orderToCancel._id}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${pharmacistToken}` },
        body: JSON.stringify({ status: 'approved' })
      });

      const medResBefore = await req('/api/medicines');
      preCancelStock = medResBefore.data.medicines.find((m) => m._id === nonRxMed._id).stockQuantity;

      // 3. Cancel approved order (restores stock by 3)
      const resCancel = await req(`/api/orders/${orderToCancel._id}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${pharmacistToken}` },
        body: JSON.stringify({
          status: 'cancelled',
          rejectionReason: 'Customer requested cancellation prior to shipment'
        })
      });
      assert(resCancel.status === 200, `Expected 200, got ${resCancel.status}`);

      const medResAfter = await req('/api/medicines');
      const postCancelStock = medResAfter.data.medicines.find((m) => m._id === nonRxMed._id).stockQuantity;
      assert(postCancelStock === preCancelStock + 3, `Expected restored stock ${preCancelStock + 3}, got ${postCancelStock}`);
      logPass(
        'PATCH /api/orders/:id/status approved -> cancelled restores deducted inventory',
        `Stock: ${preCancelStock} -> ${postCancelStock}`
      );
    }

    // -------------------------------------------------------------
    // Final Summary & Reset Data
    // -------------------------------------------------------------
    console.log('\n--- Step 6: Restoring Clean Seed State ---');
    await seedData(false);
    console.log('Database returned to clean seeded state.\n');

    console.log('================================================================');
    console.log(`🎉 TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
    console.log('================================================================\n');

    if (failedCount > 0) {
      process.exit(1);
    }
  } catch (error) {
    logFail('Test Suite Execution Failed', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    if (serverInstance) {
      serverInstance.close();
    }
    await disconnectDB(true);
  }
};

if (require.main === module) {
  runTests();
}

module.exports = runTests;
