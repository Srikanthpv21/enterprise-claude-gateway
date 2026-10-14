const test = require('node:test');
const assert = require('node:assert/strict');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

test('API Integration Endpoints', async (t) => {
  let authToken = null;
  let testChatId = null;

  await t.test('GET /api/health should return 200 OK and valid status', async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'ok');
    assert.ok(data.defaultModel);
  });

  await t.test('POST /api/auth/login should authenticate and return JWT token', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@company.com',
        password: 'password123',
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.token);
    assert.equal(data.user.email, 'admin@company.com');
    authToken = data.token;
  });

  await t.test('GET /api/auth/me should return authenticated profile and quota', async () => {
    assert.ok(authToken, 'Auth token must be present');
    const res = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.user.email, 'admin@company.com');
    assert.ok(data.usage);
    assert.ok(data.usage.dailyLimit > 0);
  });

  await t.test('GET /api/models should list available Claude models', async () => {
    const res = await fetch(`${BASE_URL}/api/models`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.models));
    assert.ok(data.models.length >= 2);
  });

  await t.test('POST /api/chats and DELETE /api/chats/:id should manage conversation lifecycle', async () => {
    // Create
    const createRes = await fetch(`${BASE_URL}/api/chats`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        title: 'Automated Test Chat',
        model: 'claude-3-5-sonnet-20241022',
      }),
    });

    assert.equal(createRes.status, 200);
    const createData = await createRes.json();
    assert.ok(createData.chat.id);
    testChatId = createData.chat.id;

    // Fetch
    const fetchRes = await fetch(`${BASE_URL}/api/chats/${testChatId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(fetchRes.status, 200);

    // Delete
    const deleteRes = await fetch(`${BASE_URL}/api/chats/${testChatId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(deleteRes.status, 200);
  });
});
