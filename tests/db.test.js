const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../services/dbService');

test('Database & Storage Engine Tests', async (t) => {
  const testEmail = `test_${Date.now()}@company.com`;
  let createdUser = null;

  await t.test('createUser should hash password and assign role', async () => {
    createdUser = await db.createUser({
      email: testEmail,
      name: 'Test Colleague',
      password: 'mypassword123',
    });

    assert.ok(createdUser.id);
    assert.equal(createdUser.email, testEmail);
    assert.equal(createdUser.name, 'Test Colleague');
    assert.ok(createdUser.role);
  });

  await t.test('getUserByEmail should retrieve existing user', () => {
    const user = db.getUserByEmail(testEmail);
    assert.ok(user);
    assert.equal(user.id, createdUser.id);
    assert.ok(user.passwordHash.startsWith('$2b$'));
  });

  await t.test('verifyPassword should validate correct password and reject wrong one', async () => {
    const user = db.getUserByEmail(testEmail);
    const valid = await db.verifyPassword('mypassword123', user.passwordHash);
    const invalid = await db.verifyPassword('wrongpassword', user.passwordHash);

    assert.equal(valid, true);
    assert.equal(invalid, false);
  });

  await t.test('createChat and getChat should manage conversations', () => {
    const chat = db.createChat(createdUser.id, {
      title: 'Unit Test Conversation',
      model: 'claude-3-5-sonnet-20241022',
    });

    assert.ok(chat.id);
    assert.equal(chat.userId, createdUser.id);
    assert.equal(chat.title, 'Unit Test Conversation');

    const fetched = db.getChat(chat.id, createdUser.id);
    assert.ok(fetched);
    assert.equal(fetched.id, chat.id);

    // Enforce ownership: other user cannot fetch this chat
    const unauthorized = db.getChat(chat.id, 'other_random_user_id');
    assert.equal(unauthorized, undefined);

    // Clean up
    db.deleteChat(chat.id, createdUser.id);
    assert.equal(db.getChat(chat.id, createdUser.id), undefined);
  });

  await t.test('trackUsage should accumulate daily tokens', () => {
    const before = db.getUserDailyUsage(createdUser.id);
    db.trackUsage(createdUser.id, 150, 350);
    const after = db.getUserDailyUsage(createdUser.id);

    assert.equal(after.promptTokens, before.promptTokens + 150);
    assert.equal(after.completionTokens, before.completionTokens + 350);
    assert.equal(after.totalTokens, before.totalTokens + 500);
    assert.equal(after.requestCount, before.requestCount + 1);
  });
});
