const Anthropic = require('@anthropic-ai/sdk');

// Supported model definitions and capabilities
const AVAILABLE_MODELS = [
  {
    id: 'claude-3-5-sonnet-20241022',
    name: 'Claude 3.5 Sonnet',
    description: 'Most intelligent & balanced model. Ideal for complex tasks, coding & analysis.',
    contextWindow: '200k',
    isDefault: true,
  },
  {
    id: 'claude-3-5-haiku-20241022',
    name: 'Claude 3.5 Haiku',
    description: 'Ultra-fast and cost-effective. Perfect for quick questions and summaries.',
    contextWindow: '200k',
    isDefault: false,
  },
  {
    id: 'claude-3-opus-20240229',
    name: 'Claude 3 Opus',
    description: 'Deep reasoning and nuanced creative writing.',
    contextWindow: '200k',
    isDefault: false,
  },
];

// Instantiate Anthropic SDK client with server-side API key
function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'your_anthropic_api_key_here') {
    throw new Error(
      'Anthropic API Key is missing or not configured. Please add your valid ANTHROPIC_API_KEY to the .env file.'
    );
  }
  return new Anthropic({ apiKey });
}

// Format message history to satisfy alternating user/assistant structure
function formatMessagesForAnthropic(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('Messages list cannot be empty.');
  }

  const formatted = [];
  let lastRole = null;

  for (const msg of messages) {
    if (!msg.content || typeof msg.content !== 'string' || !msg.content.trim()) {
      continue;
    }

    const role = msg.role === 'assistant' ? 'assistant' : 'user';

    // Merge consecutive messages from same role to satisfy API requirements
    if (role === lastRole) {
      formatted[formatted.length - 1].content += `\n\n${msg.content.trim()}`;
    } else {
      formatted.push({
        role,
        content: msg.content.trim(),
      });
      lastRole = role;
    }
  }

  // Ensure first message in conversation history originates from user
  if (formatted.length > 0 && formatted[0].role !== 'user') {
    formatted.shift();
  }

  if (formatted.length === 0) {
    throw new Error('No valid user messages found to send.');
  }

  return formatted;
}

// Stream message tokens from Claude with cancellation and token tracking
async function streamCompletion({
  messages,
  model,
  systemPrompt,
  maxTokens,
  signal,
  onToken,
  onError,
  onComplete,
}) {
  const client = getClient();
  const formattedMessages = formatMessagesForAnthropic(messages);

  const selectedModel = model || process.env.DEFAULT_MODEL || 'claude-3-5-sonnet-20241022';
  const tokensLimit = parseInt(maxTokens, 10) || parseInt(process.env.MAX_TOKENS_PER_REQUEST, 10) || 4096;

  // Default system behavior when custom instructions are omitted
  const defaultSystemPrompt =
    'You are Claude, a helpful, thoughtful, candid, and honest AI assistant. ' +
    'Provide structured, clear, and comprehensive answers. Format code cleanly with language tags. ' +
    'Adhere to workplace safety and privacy policies.';

  const finalSystemPrompt = (systemPrompt && systemPrompt.trim()) || defaultSystemPrompt;

  try {
    const stream = client.messages.stream(
      {
        model: selectedModel,
        max_tokens: tokensLimit,
        system: finalSystemPrompt,
        messages: formattedMessages,
      },
      { signal }
    );

    let accumulatedText = '';

    // Handle incoming text delta events from API stream
    stream.on('text', (delta) => {
      accumulatedText += delta;
      if (onToken) onToken(delta);
    });

    stream.on('error', (err) => {
      console.error('Stream error:', err);
      if (onError) onError(err);
    });

    const finalMessage = await stream.finalMessage();

    // Extract exact token counts from final message summary
    const inputTokens = finalMessage.usage?.input_tokens || 0;
    const outputTokens = finalMessage.usage?.output_tokens || 0;

    if (onComplete) {
      onComplete({
        fullText: accumulatedText,
        inputTokens,
        outputTokens,
        model: selectedModel,
      });
    }

    return {
      text: accumulatedText,
      inputTokens,
      outputTokens,
      model: selectedModel,
    };
  } catch (error) {
    if (signal && signal.aborted) {
      return;
    }
    throw error;
  }
}

module.exports = {
  AVAILABLE_MODELS,
  streamCompletion,
  formatMessagesForAnthropic,
};
