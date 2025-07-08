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

// API routes first, before static files
// summarization endpoint
app.post('/summarize', async (req: Request, res: Response): Promise<void> => {
  const { threadUrl, rawText, length, tone } = req.body as { threadUrl?: string; rawText?: string; length: string; tone: string };
  
  try {
    // Set proper headers for JSON response
    res.setHeader('Content-Type', 'application/json');
    
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
        messages: [{ 
          role: 'user', 
          content: getPromptForTone(tone, length, threadText)
        }],
        max_tokens: 300,
        temperature: 0.7
      })
    });
    
    if (!llmRes.ok) {
      const errText = await llmRes.text();
      console.error('OpenRouter API error:', errText);
      res.status(500).json({ error: `OpenRouter API error (${llmRes.status}): ${errText || 'LLM summarization failed'}` });
      return;
    }


    console.log('OpenRouter response status:', llmRes.status);
    const responseText = await llmRes.text();
    let llmData;
    try {
      llmData = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Failed to parse OpenRouter response:', responseText);
      res.status(500).json({ error: 'Invalid response from AI service' });
      return;
    }
    console.log('OpenRouter response data:', JSON.stringify(llmData, null, 2));
    
    if (!llmData.choices || !llmData.choices[0] || !llmData.choices[0].message) {
      console.error('Invalid response structure from OpenRouter:', llmData);
      res.status(500).json({ error: 'Invalid response structure from AI service' });
      return;
    }
    
    const summary = llmData.choices[0].message.content.trim();
    console.log('LLM summary:', summary);
    
    if (!summary) {
      res.status(500).json({ error: 'Empty summary received from AI service' });
      return;
    }
    
    res.json({ summary });
  } catch (err: any) {
    console.error('Error in /summarize:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  }
});

// Static files after API routes
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

// generate appropriate prompt based on tone
function getPromptForTone(tone: string, length: string, content: string): string {
  const baseInstruction = "Provide only the response without any introductory phrases, questions, or additional commentary.";
  
  switch (tone) {
    case 'shitpost':
      return `Transform this content into a ${length} shitpost format. Use internet slang, memes, and humorous takes. Make it funny and irreverent while capturing the main points. ${baseInstruction}\n\n${content}`;
    
    case 'infographics':
      return `Convert this content into ${length} infographic-style text. Use clear headings, bullet points, key statistics, and structured information that would work well in a visual format. Include emojis and formatting for visual appeal. ${baseInstruction}\n\n${content}`;
    
    case 'simple':
      return `Summarize this content in ${length} using simple, easy-to-understand language. ${baseInstruction}\n\n${content}`;
    
    case 'professional':
      return `Summarize this content in ${length} using a professional, business-appropriate tone. ${baseInstruction}\n\n${content}`;
    
    case 'conversational':
      return `Summarize this content in ${length} using a friendly, conversational tone as if explaining to a friend. ${baseInstruction}\n\n${content}`;
    
    default:
      return `Summarize this content in ${length} using a ${tone} tone. ${baseInstruction}\n\n${content}`;
  }
}
// serve UI at root
app.get('/', (_req: Request, res: Response): void => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, (): void => console.log(`thread summarizer running on port ${PORT}`));
