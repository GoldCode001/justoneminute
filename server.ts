// server.ts
// Thread Summarizer built with Node.js, Express & TypeScript
// dark-brown theme, rusty-brown accents, rounded buttons

import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { TwitterApi } from 'twitter-api-v2';
import path from 'path';

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
app.use(express.static('public'));

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
  res.sendFile(path.join(__dirname, '../public/index.html'));
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
    
    console.log('Processing text:', threadText.substring(0, 100) + '...');
    
    const llmRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${requiredEnvVars.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek/deepseek-chat-v3-0324:free',
        messages: [{ role: 'user', content: `Summarize the following content in ${length}, using a ${tone} tone:\n\n${threadText}` }],
        max_tokens: 300,
        temperature: 0.7
      })
    });
    
    if (!llmRes.ok) {
      const errText = await llmRes.text();
      console.error('OpenRouter API error:', errText);
      throw new Error(`OpenRouter API error (${llmRes.status}): ${errText || 'LLM summarization failed'}`);
    }


    console.log('OpenRouter response status:', llmRes.status);
    const llmData = await llmRes.json();
    console.log('OpenRouter response data:', JSON.stringify(llmData, null, 2));
    
    if (!llmData.choices || !llmData.choices[0] || !llmData.choices[0].message) {
      console.error('Invalid response structure from OpenRouter:', llmData);
      throw new Error('Invalid response from AI service');
    }
    
    const summary = llmData.choices[0].message.content.trim();
    console.log('LLM summary:', summary);
    
    if (!summary) {
      throw new Error('Empty summary received from AI service');
    }
    
    res.json({ summary });
  } catch (err: any) {
    console.error('Error in /summarize:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, (): void => console.log(`thread summarizer running on port ${PORT}`));
