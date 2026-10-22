/**
 * commands/ai.js — AI commands powered by Ollama Cloud.
 *
 * Commands: ai, ask, summarize, translate, explain, clearai, aistatus, aihelp
 */

import { chat, translate, summarize, explain, clearHistory, getStatus } from '../services/ollama.js';
import { reply } from '../utils/message.js';

/* ── Helpers ──────────────────────────────────────────────────────────── */

function extractText(ctx, args) {
  const argText = args.join(' ').trim();
  if (argText) return argText;
  // Fall back to quoted message text
  const quoted = ctx.raw?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (quoted) {
    return (
      quoted.conversation ||
      quoted.extendedTextMessage?.text ||
      quoted.imageMessage?.caption ||
      quoted.videoMessage?.caption ||
      ''
    ).trim();
  }
  return '';
}

/* ── Command definitions ──────────────────────────────────────────────── */

const commands = [

  /* ── ai / ask ── */
  {
    name:        'ai',
    aliases:     ['ask', 'chat', 'gemini'],
    description: 'Chat with Gemma via Ollama Cloud. Multi-turn conversation is preserved.',
    category:    'AI',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   false,
    cooldown:    5,
    async execute({ sock, ctx, args, prefix }) {
      const text = extractText(ctx, args);
      if (!text) {
        await reply(
          sock,
          ctx,
          `💡 *Usage:* \`${prefix}ai <your question or prompt>\`\n\n` +
          `You can also reply to any message with \`${prefix}ai\` to ask about it.\n` +
          `To reset conversation history, use \`${prefix}clearai\`.`
        );
        return;
      }

      await reply(sock, ctx, '🤖 _Thinking..._');

      const groupJid = ctx.isGroup ? ctx.chat : null;
      const res = await chat(ctx.sender, groupJid, text);

      if (!res.success) {
        await reply(sock, ctx, `⚠️ ${res.error}`);
        return;
      }

      await reply(sock, ctx, `🤖 *Gemma:*\n\n${res.text}`);
    },
  },

  /* ── summarize ── */
  {
    name:        'summarize',
    aliases:     ['summary', 'sum'],
    description: 'Summarise text or a quoted message concisely.',
    category:    'AI',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   false,
    cooldown:    5,
    async execute({ sock, ctx, args, prefix }) {
      const text = extractText(ctx, args);
      if (!text) {
        await reply(
          sock,
          ctx,
          `💡 *Usage:* \`${prefix}summarize <long text>\` or reply to a message with \`${prefix}summarize\`.`
        );
        return;
      }

      await reply(sock, ctx, '📝 _Summarising..._');
      const res = await summarize(ctx.sender, text);

      if (!res.success) {
        await reply(sock, ctx, `⚠️ ${res.error}`);
        return;
      }

      await reply(sock, ctx, `📝 *Summary:*\n\n${res.text}`);
    },
  },

  /* ── translate ── */
  {
    name:        'translate',
    aliases:     ['tr'],
    description: 'Translate text or a quoted message to another language.',
    category:    'AI',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   false,
    cooldown:    5,
    async execute({ sock, ctx, args, prefix }) {
      if (args.length === 0) {
        await reply(
          sock,
          ctx,
          `💡 *Usage:* \`${prefix}translate <language> <text>\`\n` +
          `Or reply to a message with: \`${prefix}translate <language>\`\n` +
          `Example: \`${prefix}translate Spanish Hello, how are you?\``
        );
        return;
      }

      const targetLang = args[0];
      let text = args.slice(1).join(' ').trim();

      if (!text) {
        // Try quoted message
        const quoted = ctx.raw?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        text = (
          quoted?.conversation ||
          quoted?.extendedTextMessage?.text ||
          quoted?.imageMessage?.caption ||
          quoted?.videoMessage?.caption ||
          ''
        ).trim();
      }

      if (!text) {
        await reply(sock, ctx, `⚠️ Please provide text to translate or reply to a message.`);
        return;
      }

      await reply(sock, ctx, `🌐 _Translating to ${targetLang}..._`);
      const res = await translate(ctx.sender, text, targetLang);

      if (!res.success) {
        await reply(sock, ctx, `⚠️ ${res.error}`);
        return;
      }

      await reply(sock, ctx, `🌐 *Translation (${targetLang}):*\n\n${res.text}`);
    },
  },

  /* ── explain ── */
  {
    name:        'explain',
    aliases:     ['eli5'],
    description: 'Explain a topic or concept in simple terms.',
    category:    'AI',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   false,
    cooldown:    5,
    async execute({ sock, ctx, args, prefix }) {
      const topic = extractText(ctx, args);
      if (!topic) {
        await reply(sock, ctx, `💡 *Usage:* \`${prefix}explain <topic or question>\`\nExample: \`${prefix}explain quantum computing\``);
        return;
      }

      await reply(sock, ctx, '💡 _Explaining..._');
      const res = await explain(ctx.sender, topic);

      if (!res.success) {
        await reply(sock, ctx, `⚠️ ${res.error}`);
        return;
      }

      await reply(sock, ctx, `💡 *Explanation:*\n\n${res.text}`);
    },
  },

  /* ── clearai ── */
  {
    name:        'clearai',
    aliases:     ['resetai', 'forget'],
    description: 'Clear your AI conversation history.',
    category:    'AI',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   false,
    cooldown:    3,
    async execute({ sock, ctx }) {
      const groupJid = ctx.isGroup ? ctx.chat : null;
      clearHistory(ctx.sender, groupJid);
      await reply(sock, ctx, '🧹 Conversation history cleared. New messages will start a fresh context.');
    },
  },

  /* ── aistatus ── */
  {
    name:        'aistatus',
    aliases:     ['ollamastatus', 'geministatus'],
    description: 'Check Ollama Cloud AI service status and configuration.',
    category:    'AI',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   false,
    cooldown:    5,
    async execute({ sock, ctx }) {
      const status = getStatus();
      const lines = [
        '🤖 *Ollama Cloud AI Status*',
        `• Status: ${status.enabled ? '🟢 Enabled' : '🔴 Disabled'}`,
        `• API Key: ${status.configured ? '✅ Configured' : '❌ Missing'}`,
        `• Model: \`${status.model}\``,
        `• Active conversations: ${status.activeConversations}`,
      ];

      if (status.error) {
        lines.push(`• Error: ⚠️ ${status.error}`);
      }

      lines.push('\n_API requests are subject to the provider\'s terms and safety filters._');
      await reply(sock, ctx, lines.join('\n'));
    },
  },

  /* ── aihelp ── */
  {
    name:        'aihelp',
    aliases:     [],
    description: 'Show help and usage guide for AI commands.',
    category:    'AI',
    groupOnly:   false,
    adminOnly:   false,
    ownerOnly:   false,
    cooldown:    5,
    async execute({ sock, ctx, prefix }) {
      const lines = [
        '🤖 *Ollama Cloud AI Help & Guide*',
        '',
        `\`${prefix}ai <query>\` — Chat with Gemma (keeps conversation context)`,
        `\`${prefix}summarize <text>\` — Summarise text or quoted message`,
        `\`${prefix}translate <lang> <text>\` — Translate to any language`,
        `\`${prefix}explain <topic>\` — Simple explanations of concepts`,
        `\`${prefix}clearai\` — Reset your chat history`,
        `\`${prefix}aistatus\` — View AI service status`,
        '',
        '*Tips:*',
        '• Reply to any message with `.ai`, `.summarize`, or `.translate`',
        '• Conversations are kept private per-user',
        '• Rate limit: 10 requests / minute',
      ];
      await reply(sock, ctx, lines.join('\n'));
    },
  },

];

export default commands;
