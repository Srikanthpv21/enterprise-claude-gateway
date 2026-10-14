require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const db = require('./services/dbService');
const anthropic = require('./services/anthropicService');
const { authMiddleware, requireAdmin, generateToken } = require('./middleware/auth');
const { authLimiter, chatLimiter, checkDailyTokenQuota } = require('./middleware/rateLimiter');

const app = express();
const PORT = process.env.PORT || 3000;

// Configure security headers and Content Security Policy
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://cdn.jsdelivr.net',
          'https://cdnjs.cloudflare.com',
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://fonts.googleapis.com',
          'https://cdnjs.cloudflare.com',
          'https://cdn.jsdelivr.net',
        ],
        fontSrc: [
          "'self'",
          'https://fonts.gstatic.com',
          'https://cdnjs.cloudflare.com',
        ],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// Enable CORS, parse JSON payloads, and parse session cookies
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Verify email domain against allowed workplace domains in configuration
function isDomainAllowed(email) {
  const allowed = process.env.ALLOWED_EMAIL_DOMAINS || '*';
  if (allowed === '*' || allowed.trim() === '') return true;

  const domain = email.split('@')[1];
  if (!domain) return false;

  const allowedList = allowed
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''));
  return allowedList.includes(domain.toLowerCase());
}

// User registration with domain restriction and optional team code validation
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { email, password, name, accessCode } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    if (!isDomainAllowed(email)) {
      return res.status(403).json({
        error: `Registration is restricted to authorized company email domains: ${process.env.ALLOWED_EMAIL_DOMAINS}`,
      });
    }

    // Verify team invite code if configured
    const requiredCode = process.env.TEAM_ACCESS_CODE;
    if (requiredCode && requiredCode.trim()) {
      if (!accessCode || accessCode.trim() !== requiredCode.trim()) {
        return res.status(403).json({
          error: 'Invalid Team Access Code. Please ask your workplace administrator for the invite code.',
        });
      }
    }

    const user = await db.createUser({ email, name, password });
    const token = generateToken(user);

    // Set secure HTTP-only cookie for session persistence
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Authenticate user credentials and return session token
app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = db.getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const isValid = await db.verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    db.updateLastLogin(user.id);
    const token = generateToken(user);

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'An unexpected login error occurred.' });
  }
});

// Clear authentication cookie on logout
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true, message: 'Logged out successfully.' });
});

// Return logged-in user profile and current token consumption
app.get('/api/auth/me', authMiddleware, (req, res) => {
  const usage = db.getUserDailyUsage(req.user.id);
  const dailyLimit = parseInt(process.env.DAILY_USER_TOKEN_LIMIT, 10) || 150000;

  res.json({
    user: req.user,
    usage: {
      ...usage,
      dailyLimit,
      remainingTokens: Math.max(0, dailyLimit - usage.totalTokens),
    },
  });
});

// List available AI model configurations
app.get('/api/models', authMiddleware, (req, res) => {
  res.json({
    models: anthropic.AVAILABLE_MODELS,
    defaultModel: process.env.DEFAULT_MODEL || 'claude-3-5-sonnet-20241022',
  });
});

// Fetch conversation list for the active user
app.get('/api/chats', authMiddleware, (req, res) => {
  const chats = db.listChats(req.user.id);
  res.json({ chats });
});

// Create a new conversation thread
app.post('/api/chats', authMiddleware, (req, res) => {
  const { title, model, systemPrompt } = req.body;
  const newChat = db.createChat(req.user.id, { title, model, systemPrompt });
  res.json({ chat: newChat });
});

// Retrieve single conversation thread and message history
app.get('/api/chats/:id', authMiddleware, (req, res) => {
  const chat = db.getChat(req.params.id, req.user.id);
  if (!chat) {
    return res.status(404).json({ error: 'Chat conversation not found.' });
  }
  const messages = db.getMessages(chat.id);
  res.json({ chat, messages });
});

// Update conversation title or custom prompt instructions
app.put('/api/chats/:id', authMiddleware, (req, res) => {
  const { title, systemPrompt } = req.body;
  const updated = db.updateChat(req.params.id, req.user.id, {
    ...(title && { title: title.trim() }),
    ...(systemPrompt !== undefined && { systemPrompt }),
  });
  if (!updated) {
    return res.status(404).json({ error: 'Chat conversation not found.' });
  }
  res.json({ chat: updated });
});

// Delete a conversation thread
app.delete('/api/chats/:id', authMiddleware, (req, res) => {
  const success = db.deleteChat(req.params.id, req.user.id);
  res.json({ success });
});

// Stream token responses in real time using Server-Sent Events (SSE)
app.post('/api/chat/stream', authMiddleware, chatLimiter, checkDailyTokenQuota, async (req, res) => {
  const { chatId, message, model, systemPrompt } = req.body;

  if (!chatId || !message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'A valid chatId and message are required.' });
  }

  // Enforce safety payload ceiling to prevent budget exhaustion
  if (message.length > 50000) {
    return res.status(400).json({
      error: 'Message length exceeds the maximum safety limit of 50,000 characters.',
    });
  }

  const chat = db.getChat(chatId, req.user.id);
  if (!chat) {
    return res.status(404).json({ error: 'Conversation session not found.' });
  }

  // Save user prompt
  db.addMessage(chatId, { role: 'user', content: message.trim() });

  // Automatically generate chat title from first user prompt
  const existingMessages = db.getMessages(chatId);
  if (existingMessages.length <= 2 && chat.title === 'New Conversation') {
    const autoTitle = message.trim().slice(0, 36) + (message.length > 36 ? '...' : '');
    db.updateChat(chatId, req.user.id, { title: autoTitle });
  }

  // Initialize Server-Sent Events response headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const abortController = new AbortController();

  // Cancel generation if user closes tab or aborts stream
  req.on('close', () => {
    abortController.abort();
  });

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Send recent conversation history for multi-turn context
    const contextMessages = existingMessages.slice(-20).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const selectedModel = model || chat.model || process.env.DEFAULT_MODEL;
    const finalSystemPrompt = systemPrompt !== undefined ? systemPrompt : chat.systemPrompt;

    let fullResponseText = '';

    await anthropic.streamCompletion({
      messages: contextMessages,
      model: selectedModel,
      systemPrompt: finalSystemPrompt,
      signal: abortController.signal,
      onToken: (delta) => {
        fullResponseText += delta;
        sendEvent('token', { delta });
      },
      onComplete: ({ inputTokens, outputTokens }) => {
        // Persist completed response and log token usage
        const savedMsg = db.addMessage(chatId, {
          role: 'assistant',
          content: fullResponseText,
          tokens: outputTokens,
        });

        const usage = db.trackUsage(req.user.id, inputTokens, outputTokens);

        sendEvent('done', {
          messageId: savedMsg.id,
          inputTokens,
          outputTokens,
          totalDailyTokens: usage.totalTokens,
        });
        res.end();
      },
      onError: (err) => {
        sendEvent('error', { error: err.message || 'Stream processing error.' });
        res.end();
      },
    });
  } catch (err) {
    console.error('API Stream exception:', err.message);
    sendEvent('error', {
      error:
        err.message ||
        'Failed to connect to Claude. Please verify your Anthropic API Key in the server .env file.',
    });
    res.end();
  }
});

// Admin endpoint for colleague usage metrics and account stats
app.get('/api/admin/stats', authMiddleware, requireAdmin, (req, res) => {
  const stats = db.getAllUsageStats();
  res.json({ stats });
});

// Service health check endpoint
app.get('/api/health', (req, res) => {
  const keyConfigured =
    Boolean(process.env.ANTHROPIC_API_KEY) &&
    process.env.ANTHROPIC_API_KEY !== 'your_anthropic_api_key_here';

  res.json({
    status: 'ok',
    apiKeyConfigured: keyConfigured,
    defaultModel: process.env.DEFAULT_MODEL || 'claude-3-5-sonnet-20241022',
    allowedDomains: process.env.ALLOWED_EMAIL_DOMAINS || '*',
    hasTeamCode: Boolean(process.env.TEAM_ACCESS_CODE),
  });
});

// Serve single-page frontend application
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start web server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
