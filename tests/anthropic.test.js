const test = require('node:test');
const assert = require('node:assert/strict');
const { formatMessagesForAnthropic, AVAILABLE_MODELS } = require('../services/anthropicService');

test('Anthropic Service Tests', async (t) => {
  await t.test('AVAILABLE_MODELS should contain Claude 3.5 Sonnet as default', () => {
    assert.ok(Array.isArray(AVAILABLE_MODELS));
    const sonnet = AVAILABLE_MODELS.find((m) => m.id === 'claude-3-5-sonnet-20241022');
    assert.ok(sonnet, 'Claude 3.5 Sonnet should be present');
    assert.equal(sonnet.isDefault, true);
  });

  await t.test('formatMessagesForAnthropic should reject empty messages array', () => {
    assert.throws(
      () => formatMessagesForAnthropic([]),
      /Messages list cannot be empty/
    );
  });

  await t.test('formatMessagesForAnthropic should merge consecutive same-role messages', () => {
    const raw = [
      { role: 'user', content: 'First part.' },
      { role: 'user', content: 'Second part.' },
      { role: 'assistant', content: 'Response.' },
    ];
    const formatted = formatMessagesForAnthropic(raw);
    assert.equal(formatted.length, 2);
    assert.equal(formatted[0].role, 'user');
    assert.equal(formatted[0].content, 'First part.\n\nSecond part.');
    assert.equal(formatted[1].role, 'assistant');
    assert.equal(formatted[1].content, 'Response.');
  });

  await t.test('formatMessagesForAnthropic should ensure conversation begins with user', () => {
    const raw = [
      { role: 'assistant', content: 'Greeting' },
      { role: 'user', content: 'Actual query' },
    ];
    const formatted = formatMessagesForAnthropic(raw);
    assert.equal(formatted.length, 1);
    assert.equal(formatted[0].role, 'user');
    assert.equal(formatted[0].content, 'Actual query');
  });
});
