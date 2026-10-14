const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const USAGE_FILE = path.join(DATA_DIR, 'usage.json');

// Ensure local storage folder exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Atomically write JSON using a temporary file to prevent corruption
function writeJsonAtomic(filePath, data) {
  const tempPath = `${filePath}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tempPath, filePath);
}

// Safely read JSON from disk or initialize with fallback
function readJson(filePath, defaultValue) {
  try {
    if (!fs.existsSync(filePath)) {
      writeJsonAtomic(filePath, defaultValue);
      return defaultValue;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    return defaultValue;
  }
}

// Initialize database files on startup
readJson(USERS_FILE, []);
readJson(CHATS_FILE, []);
readJson(MESSAGES_FILE, {});
readJson(USAGE_FILE, {});

// Look up user by email address (case-insensitive)
function getUserByEmail(email) {
  const users = readJson(USERS_FILE, []);
  return users.find((u) => u.email.toLowerCase() === email.toLowerCase().trim());
}

// Find user by primary identifier
function getUserById(id) {
  const users = readJson(USERS_FILE, []);
  return users.find((u) => u.id === id);
}

// Create new user with bcrypt-hashed password; first user becomes admin
async function createUser({ email, name, password, role = 'colleague' }) {
  const users = readJson(USERS_FILE, []);
  const existing = users.find((u) => u.email.toLowerCase() === email.toLowerCase().trim());
  if (existing) {
    throw new Error('An account with this email already exists.');
  }

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  const newUser = {
    id: uuidv4(),
    email: email.toLowerCase().trim(),
    name: name ? name.trim() : email.split('@')[0],
    passwordHash,
    role: users.length === 0 ? 'admin' : role,
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
  };

  users.push(newUser);
  writeJsonAtomic(USERS_FILE, users);
  return { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role };
}

// Compare plain text password against stored bcrypt hash
async function verifyPassword(inputPassword, storedHash) {
  return bcrypt.compare(inputPassword, storedHash);
}

// Update login timestamp for colleague activity tracking
function updateLastLogin(userId) {
  const users = readJson(USERS_FILE, []);
  const idx = users.findIndex((u) => u.id === userId);
  if (idx !== -1) {
    users[idx].lastLoginAt = new Date().toISOString();
    writeJsonAtomic(USERS_FILE, users);
  }
}

// Fetch all conversations belonging to user sorted by last update
function listChats(userId) {
  const chats = readJson(CHATS_FILE, []);
  return chats
    .filter((c) => c.userId === userId)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

// Fetch a conversation while strictly enforcing user ownership
function getChat(chatId, userId) {
  const chats = readJson(CHATS_FILE, []);
  return chats.find((c) => c.id === chatId && c.userId === userId);
}

// Create a new conversation session and empty message thread
function createChat(userId, { title = 'New Conversation', model, systemPrompt }) {
  const chats = readJson(CHATS_FILE, []);
  const newChat = {
    id: uuidv4(),
    userId,
    title: title.trim(),
    model: model || process.env.DEFAULT_MODEL || 'claude-3-5-sonnet-20241022',
    systemPrompt: systemPrompt || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  chats.unshift(newChat);
  writeJsonAtomic(CHATS_FILE, chats);

  const messagesMap = readJson(MESSAGES_FILE, {});
  messagesMap[newChat.id] = [];
  writeJsonAtomic(MESSAGES_FILE, messagesMap);

  return newChat;
}

// Update title or system prompt of an existing conversation
function updateChat(chatId, userId, updates) {
  const chats = readJson(CHATS_FILE, []);
  const idx = chats.findIndex((c) => c.id === chatId && c.userId === userId);
  if (idx === -1) return null;

  chats[idx] = {
    ...chats[idx],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  writeJsonAtomic(CHATS_FILE, chats);
  return chats[idx];
}

// Remove conversation and delete associated messages
function deleteChat(chatId, userId) {
  const chats = readJson(CHATS_FILE, []);
  const filtered = chats.filter((c) => !(c.id === chatId && c.userId === userId));
  writeJsonAtomic(CHATS_FILE, filtered);

  const messagesMap = readJson(MESSAGES_FILE, {});
  delete messagesMap[chatId];
  writeJsonAtomic(MESSAGES_FILE, messagesMap);
  return true;
}

// Get message history for a conversation
function getMessages(chatId) {
  const messagesMap = readJson(MESSAGES_FILE, {});
  return messagesMap[chatId] || [];
}

// Append new user or assistant message to conversation thread
function addMessage(chatId, { role, content, tokens = 0 }) {
  const messagesMap = readJson(MESSAGES_FILE, {});
  if (!messagesMap[chatId]) {
    messagesMap[chatId] = [];
  }

  const msg = {
    id: uuidv4(),
    role,
    content,
    tokens,
    createdAt: new Date().toISOString(),
  };

  messagesMap[chatId].push(msg);
  writeJsonAtomic(MESSAGES_FILE, messagesMap);
  return msg;
}

// Format current calendar day as YYYY-MM-DD
function getTodayString() {
  return new Date().toISOString().split('T')[0];
}

// Accumulate prompt and output token metrics for the current day
function trackUsage(userId, promptTokens = 0, completionTokens = 0) {
  const usage = readJson(USAGE_FILE, {});
  const today = getTodayString();

  if (!usage[today]) usage[today] = {};
  if (!usage[today][userId]) {
    usage[today][userId] = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      requestCount: 0,
    };
  }

  const userUsage = usage[today][userId];
  userUsage.promptTokens += promptTokens;
  userUsage.completionTokens += completionTokens;
  userUsage.totalTokens += promptTokens + completionTokens;
  userUsage.requestCount += 1;

  writeJsonAtomic(USAGE_FILE, usage);
  return userUsage;
}

// Get total tokens consumed by user today
function getUserDailyUsage(userId) {
  const usage = readJson(USAGE_FILE, {});
  const today = getTodayString();
  if (usage[today] && usage[today][userId]) {
    return usage[today][userId];
  }
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, requestCount: 0 };
}

// Aggregate workspace usage metrics for the administrator dashboard
function getAllUsageStats() {
  const usage = readJson(USAGE_FILE, {});
  const users = readJson(USERS_FILE, []);
  const chats = readJson(CHATS_FILE, []);

  return {
    totalUsers: users.length,
    totalChats: chats.length,
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      lastLoginAt: u.lastLoginAt,
      todayUsage: getUserDailyUsage(u.id),
    })),
    rawUsage: usage,
  };
}

module.exports = {
  getUserByEmail,
  getUserById,
  createUser,
  verifyPassword,
  updateLastLogin,
  listChats,
  getChat,
  createChat,
  updateChat,
  deleteChat,
  getMessages,
  addMessage,
  trackUsage,
  getUserDailyUsage,
  getAllUsageStats,
};
