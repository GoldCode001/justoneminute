// server.ts
// Thread Summarizer built with Node.js, Express & TypeScript
// dark-brown theme, rusty-brown accents, rounded buttons

import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { TwitterApi } from 'twitter-api-v2';

dotenv.config();

// Validate required environment variables
const requiredEnvVars = {
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  TWITTER_BEARER_TOKEN: process.env.TWITTER_BEARER_TOKEN
};

const missingVars = Object.entries(requiredEnvVars)
  .filter(([_, value]) => !value)
  .map(([key, _]) => key);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingVars.forEach(varName => {
    console.error(`   - ${varName}`);
  });
  console.error('\n📝 Please check your .env file and ensure all required variables are set.');
  console.error('💡 See .env/.env.example for reference.');
  process.exit(1);
}

// initialize Twitter client with bearer token
const twitterClient = new TwitterApi(requiredEnvVars.TWITTER_BEARER_TOKEN!);

const app = express();
// default port
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// helper: extract thread id from tweet URL (supports twitter.com & x.com)
function extractThreadId(url: string): string {
  const match = url.match(/https?:\/\/(?:twitter|x)\.com\/[^\/]+\/status\/(\d+)/);
  if (!match) throw new Error('Invalid Twitter URL format');
  return match[1];
}

// fetch full thread text by conversation_id
async function fetchThreadTextFromTwitter(url: string): Promise<string> {
  const threadId = extractThreadId(url);
  const response = await twitterClient.v2.search(`conversation_id:${threadId}`, {
    'tweet.fields': ['text', 'created_at'],
    max_results: 100,
    sort_order: 'recency'
  });
  const tweets = response.data?.data;
  if (!tweets || tweets.length === 0) throw new Error('Unable to fetch thread content');
  const sorted = tweets.sort((a, b) =>
    new Date(a.created_at!).getTime() - new Date(b.created_at!).getTime()
  );
  return sorted.map(t => t.text).join('\n\n');
}

// serve UI at root
app.get('/', (_req: Request, res: Response): void => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>just one minute</title>
  <style>
    body { margin: 0; padding: 0; background: #1e120f; color: #ddd; font-family: Segoe UI, Tahoma, Verdana, sans-serif; display: flex; justify-content: center; align-items: flex-start; min-height: 100vh; }
    .container { width: 90%; max-width: 600px; margin-top: 40px; }
    h1 { text-transform: capitalize; margin-bottom: 20px; }
    input, select { width: 100%; padding: 12px; margin: 8px 0; background: #000; color: #ddd; border: none; border-radius: 12px; font-size: 1em; }
    button { width: 100%; padding: 12px; margin-top: 12px; background: #8a4b2a; color: #fff; font-size: 1em; border: none; border-radius: 24px; cursor: pointer; }
    button:hover { opacity: 0.9; }
    .summary { background: #000; padding: 16px; border-radius: 12px; margin-top: 24px; white-space: pre-wrap; line-height: 1.4; }
    .error { background: #5a1f1f; padding: 12px; border-radius: 12px; margin-top: 16px; color: #fcc; }
  </style>
</head>
<body>
  <div class="container">
  <h1>thread summarizer</h1>
  <input id="threadUrl" type="text" placeholder="Paste Twitter thread link (optional)">
  <textarea id="rawText" placeholder="Paste any text to summarize" rows="4" style="width:100%;padding:12px;background:#000;color:#ddd;border:none;border-radius:12px;margin-top:8px;margin-bottom:8px;font-size:1em;"></textarea>
  <select id="length">
    <option value="1 line">1 line</option>
    <option value="3 sentences" selected>3 sentences</option>
    <option value="bullet list">bullet list</option>
  </select>
  <select id="tone">
    <option value="simple">simple</option>
    <option value="professional">professional</option>
    <option value="conversational">conversational</option>
  </select>
  <button type="button" id="summarizeBtn">summarize</button>
  <div id="error"></div>
  <div id="summary"></div>
</div>
<script>
  console.log('script loaded');
  const btn = document.getElementById('summarizeBtn');
  const errorEl = document.getElementById('error');
  const summaryEl = document.getElementById('summary');
  const threadInput = document.getElementById('threadUrl');
  const rawTextInput = document.getElementById('rawText');
  const lengthSelect = document.getElementById('length');
  const toneSelect = document.getElementById('tone');

  btn?.addEventListener('click', async () => {
    if (!errorEl || !summaryEl) return;
    errorEl.textContent = '';
    summaryEl.textContent = 'loading...';

    const threadUrl = threadInput instanceof HTMLInputElement ? threadInput.value.trim() : '';
    const rawText = rawTextInput instanceof HTMLTextAreaElement ? rawTextInput.value.trim() : '';
    const length = lengthSelect instanceof HTMLSelectElement ? lengthSelect.value : '';
    const tone = toneSelect instanceof HTMLSelectElement ? toneSelect.value : '';

    if (!threadUrl && !rawText) {
      errorEl.textContent = 'Enter a Twitter link or paste some text.';
      summaryEl.textContent = '';
      return;
    }

    try {
      const res = await fetch('/summarize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadUrl, rawText, length, tone })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      summaryEl.textContent = data.summary;
    } catch (err) {
      errorEl.textContent = err.message || 'Error occurred';
      summaryEl.textContent = '';
    }
  });
</script>
</body>
</html>`);
});

// summarization endpoint
app.post('/summarize', async (req: Request, res: Response): Promise<void> => {
  const { threadUrl, rawText, length, tone } = req.body as { threadUrl?: string; rawText?: string; length: string; tone: string };
  
  try {
    let threadText: string;
    if (threadUrl && /https?:\/\/(?:twitter|x)\.com\/[^\/]+\/status\/\d+/.test(threadUrl)) {
      threadText = await fetchThreadTextFromTwitter(threadUrl);
    } else if (rawText && rawText.length > 0) {
      threadText = rawText;
    } else {
      res.status(400).json({ error: 'No thread link or text provided.' });
      return;
    }
    const llmRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${requiredEnvVars.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen/qwq-32b:free',
        
        messages: [{ role: 'user', content: `Summarize the following content in ${length}, using a ${tone} tone:\n\n${threadText}` }],
        max_tokens: 300,
        temperature: 1.0
      })
    });
    if (!llmRes.ok) {
      const errText = await llmRes.text();
      console.error('OpenRouter API error:', errText);
      throw new Error(errText || 'LLM summarization failed');
    }



    const llmData = await llmRes.json();
    const summary = llmData.choices[0].message.content.trim();
    console.log('LLM summary:', summary);
    res.json({ summary });
  } catch (err: any) {
    console.error('Error in /summarize:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, (): void => console.log(`thread summarizer running on port ${PORT}`));
