// server.ts
// Thread Summarizer built with Node.js, Express & TypeScript
// dark-brown theme, rusty-brown accents, rounded buttons

import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import AbortController from 'abort-controller';
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

// Helper function to detect and extract Twitter URLs from text
function extractTwitterUrls(text: string): string[] {
  const twitterUrlRegex = /https?:\/\/(?:twitter|x)\.com\/[^\/\s]+\/status\/\d+/g;
  return text.match(twitterUrlRegex) || [];
}

// Helper function to fetch content from multiple Twitter URLs with retry logic
async function fetchContentFromTwitterUrls(urls: string[]): Promise<string> {
  const contents: string[] = [];
  const errors: string[] = [];
  
  // Limit to 3 URLs to prevent timeouts
  for (const url of urls.slice(0, 3)) {
    try {
      const content = await fetchThreadTextFromTwitter(url);
      contents.push(`--- Content from ${url} ---\n${content}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Failed to fetch content from ${url}:`, error);
      errors.push(`${url}: ${errorMessage}`);
    }
  }
  
  if (contents.length === 0) {
    throw new Error(`Could not fetch content from any of the provided Twitter URLs. Errors: ${errors.join('; ')}`);
  }
  
  // If we have some content but also some errors, include both
  if (errors.length > 0) {
    contents.push(`--- Errors fetching some URLs ---\n${errors.join('\n')}`);
  }
  
  return contents.join('\n\n');
}

// Helper function to detect if text contains Twitter-like content
function detectTwitterContent(text: string): boolean {
  const twitterIndicators = [
    /\d+\/\d+/g, // Tweet numbering like "1/5"
    /@\w+/g, // Mentions
    /#\w+/g, // Hashtags
    /🧵/g, // Thread emoji
    /Thread:/i, // Thread indicator
    /THREAD/i, // Thread indicator caps
  ];
  
  let score = 0;
  twitterIndicators.forEach(regex => {
    const matches = text.match(regex);
    if (matches) score += matches.length;
  });
  
  return score > 2; // If we find multiple indicators, likely Twitter content
}

const app = express();
// default port
const PORT = process.env.PORT || 3000;

// Increase payload limits to handle larger text inputs
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// API routes first, before static files
// summarization endpoint
app.post('/summarize', async (req: Request, res: Response): Promise<void> => {
  const { threadUrl, rawText, length, tone } = req.body as { 
    threadUrl?: string; 
    rawText?: string; 
    length: string; 
    tone: string; 
  };
  
  try {
    // Set proper headers for JSON response
    res.setHeader('Content-Type', 'application/json');
    
    let threadText: string;
    let isTwitterContent = false;
    
    // Input validation
    if (!threadUrl && !rawText) {
      res.status(400).json({ error: 'No thread link or text provided.' });
      return;
    }
    
    if (threadUrl && /https?:\/\/(?:twitter|x)\.com\/[^\/]+\/status\/\d+/.test(threadUrl)) {
      try {
        threadText = await fetchThreadTextFromTwitter(threadUrl);
        isTwitterContent = true;
      } catch (error) {
        // If Twitter fetching fails, check if we have rawText as fallback
        if (rawText && rawText.trim()) {
          threadText = rawText;
          isTwitterContent = true;
        } else {
          const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred.';
          res.status(400).json({ 
            error: `${errorMessage} You can copy and paste the tweet content directly into the text area instead.` 
          });
          return;
        }
      }
    } else if (rawText && rawText.length > 0) {
      // Check if the raw text contains Twitter URLs or looks like Twitter content
      const twitterUrls = extractTwitterUrls(rawText);
      if (twitterUrls.length > 0) {
        // Try to fetch actual content from Twitter URLs, but don't fail if it doesn't work
        try {
          const fetchedContent = await fetchContentFromTwitterUrls(twitterUrls);
          threadText = `${rawText}\n\n--- FETCHED TWITTER CONTENT ---\n${fetchedContent}`;
        } catch (error) {
          console.log('Failed to fetch Twitter URLs from text, using raw text:', error);
          threadText = rawText; // Use the raw text as fallback
        }
        isTwitterContent = true;
      } else {
        isTwitterContent = detectTwitterContent(rawText);
        threadText = rawText;
      }
    } else {
      res.status(400).json({ error: 'No thread link or text provided.' });
      return;
    }
    
    // Truncate very long text to prevent timeouts and token limits
    if (threadText.length > 8000) {
      threadText = threadText.substring(0, 8000) + '...';
    }
    
    console.log('Processing text:', threadText.substring(0, 100) + '...');
    
    // Retry logic for API calls
    const makeApiCallWithRetry = async (retries = 3): Promise<any> => {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          console.log(`API call attempt ${attempt}/${retries}`);
          
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 20000); // 20 second timeout
          
          const llmRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { 
              'Authorization': `Bearer ${requiredEnvVars.OPENROUTER_API_KEY}`, 
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://just-one-minute-goldman.netlify.app',
              'X-Title': 'Just One Minute'
            },
            body: JSON.stringify({
              model: 'openrouter/cypher-alpha:free',
              messages: [{ 
                role: 'user', 
                content: getPromptForTone(tone, length, threadText, isTwitterContent)
              }],
              max_tokens: 400,
              temperature: 0.7
            }),
            signal: controller.signal as any
          });
          
          clearTimeout(timeoutId);
          
          if (!llmRes.ok) {
            const errText = await llmRes.text();
            console.error(`OpenRouter API error (attempt ${attempt}):`, errText);
            
            // If it's a 5xx error or rate limit, retry. If it's 4xx (except 429), don't retry
            if ((llmRes.status >= 500 || llmRes.status === 429) && attempt < retries) {
              console.log(`Retrying due to server error (${llmRes.status})...`);
              await new Promise(resolve => setTimeout(resolve, 1000 * attempt * attempt)); // Exponential backoff
              continue;
            }
            
            throw new Error(`OpenRouter API error (${llmRes.status}): ${errText || 'LLM summarization failed'}`);
          }
          
          return llmRes;
          
        } catch (error: any) {
          console.error(`Attempt ${attempt} failed:`, error);
          
          // If it's a timeout or network error and we have retries left, try again
          if ((error.name === 'AbortError' || error.message?.includes('fetch') || error.code === 'ECONNRESET') && attempt < retries) {
            console.log(`Retrying due to ${error.name === 'AbortError' ? 'timeout' : 'network error'}...`);
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt * attempt)); // Exponential backoff
            continue;
          }
          
          // If it's the last attempt or a non-retryable error, throw it
          throw error;
        }
      }
      
      throw new Error('All retry attempts failed');
    };

    const llmRes = await makeApiCallWithRetry();
    
    console.log('OpenRouter response status:', llmRes.status);
    const responseText = await llmRes.text();
    
    if (!responseText) {
      res.status(500).json({ error: 'Empty response from AI service' });
      return;
    }
    
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
    
    const summary = llmData.choices[0].message.content?.trim();
    console.log('LLM summary:', summary);
    
    if (!summary) {
      res.status(500).json({ error: 'Empty summary received from AI service' });
      return;
    }
    
    // Ensure the summary ends with a complete sentence
    const completeSummary = ensureCompleteSentence(summary);
    
    res.json({ summary: completeSummary });
  } catch (err: any) {
    console.error('Error in /summarize:', err);
    
    if (!res.headersSent) {
      if (err.name === 'AbortError') {
        res.status(504).json({ 
          error: 'The AI service is taking longer than usual. We tried multiple times but it\'s still timing out. Try again in a moment or use shorter text.' 
        });
      } else {
        res.status(500).json({ 
          error: err.message || 'Internal server error' 
        });
      }
    }
  }
});

// crypto explanation endpoint
app.post('/.netlify/functions/crypto-explain', async (req: Request, res: Response): Promise<void> => {
  const { term } = req.body as { term: string };
  
  try {
    // Set proper headers for JSON response
    res.setHeader('Content-Type', 'application/json');
    
    // Input validation
    if (!term || typeof term !== 'string' || term.trim().length === 0) {
      res.status(400).json({ error: 'No term provided or invalid term format.' });
      return;
    }
    
    const cleanTerm = term.trim();
    console.log('Explaining crypto term:', cleanTerm);
    
    // Generate prompt for crypto explanation
    const prompt = `You are an ultra-passionate crypto expert who explains things like you're talking to your best friend. You're genuinely excited about crypto and want to share that enthusiasm while being incredibly helpful and human.

Explain "${cleanTerm}" in a way that's:
- Conversational and enthusiastic (like you're genuinely excited to explain this)
- Easy to understand but not dumbed down
- Includes practical examples and real-world context
- Shows why this matters in crypto
- Uses analogies when helpful
- Mentions risks/benefits honestly
- Feels like a human wrote it, not an AI

Be authentic, use contractions, and let your personality shine through. Don't sound corporate or robotic. If it's a complex topic, break it down step by step but keep it engaging.

Keep it comprehensive but digestible - aim for 2-4 paragraphs that really help someone understand both what it is and why they should care.`;

    // Retry logic for API calls
    const makeApiCallWithRetry = async (retries = 3): Promise<any> => {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          console.log(`Crypto explain API call attempt ${attempt}/${retries}`);
          
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 20000); // 20 second timeout
          
          const llmRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { 
              'Authorization': `Bearer ${requiredEnvVars.OPENROUTER_API_KEY}`, 
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://just-one-minute-goldman.netlify.app',
              'X-Title': 'Goldman Crypto Dictionary'
            },
            body: JSON.stringify({
              model: 'openai/gpt-4o-2024-11-20',
              messages: [{ 
                role: 'user', 
                content: prompt
              }],
              max_tokens: 800,
              temperature: 0.8
            }),
            signal: controller.signal as any
          });
          
          clearTimeout(timeoutId);
          
          if (!llmRes.ok) {
            const errText = await llmRes.text();
            console.error(`OpenRouter API error (attempt ${attempt}):`, errText);
            
            // If it's a 5xx error or rate limit, retry. If it's 4xx (except 429), don't retry
            if ((llmRes.status >= 500 || llmRes.status === 429) && attempt < retries) {
              console.log(`Retrying due to server error (${llmRes.status})...`);
              await new Promise(resolve => setTimeout(resolve, 1000 * attempt * attempt)); // Exponential backoff
              continue;
            }
            
            throw new Error(`OpenRouter API error (${llmRes.status}): ${errText || 'Crypto explanation failed'}`);
          }
          
          return llmRes;
          
        } catch (error: any) {
          console.error(`Attempt ${attempt} failed:`, error);
          
          // If it's a timeout or network error and we have retries left, try again
          if ((error.name === 'AbortError' || error.message?.includes('fetch') || error.code === 'ECONNRESET') && attempt < retries) {
            console.log(`Retrying due to ${error.name === 'AbortError' ? 'timeout' : 'network error'}...`);
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt * attempt)); // Exponential backoff
            continue;
          }
          
          // If it's the last attempt or a non-retryable error, throw it
          throw error;
        }
      }
      
      throw new Error('All retry attempts failed');
    };

    const llmRes = await makeApiCallWithRetry();
    
    console.log('OpenRouter response status:', llmRes.status);
    const responseText = await llmRes.text();
    
    if (!responseText) {
      res.status(500).json({ error: 'Empty response from AI service' });
      return;
    }
    
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
    
    let explanation = llmData.choices[0].message.content?.trim();
    console.log('LLM explanation:', explanation);
    
    if (!explanation) {
      res.status(500).json({ error: 'Empty explanation received from AI service' });
      return;
    }
    
    // Post-process the explanation to make it more human and ensure complete sentences
    explanation = postProcessExplanation(explanation);
    explanation = ensureCompleteSentence(explanation);
    
    res.json({ explanation });
  } catch (err: any) {
    console.error('Error in crypto-explain:', err);
    
    if (!res.headersSent) {
      if (err.name === 'AbortError') {
        res.status(504).json({ 
          error: 'The AI service is taking longer than usual. We tried multiple times but it\'s still timing out. Try again in a moment or try a simpler term.' 
        });
      } else {
        res.status(500).json({ 
          error: err.message || 'Internal server error' 
        });
      }
    }
  }
});

// Helper function to post-process explanations
function postProcessExplanation(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>')
    .replace(/<p><\/p>/g, '')
    .trim();
}

// Helper function to ensure text ends with a complete sentence
function ensureCompleteSentence(text: string): string {
  if (!text || text.trim().length === 0) {
    return text;
  }
  
  let cleanText = text.trim();
  
  // Remove any HTML tags for sentence detection
  const textWithoutHtml = cleanText.replace(/<[^>]*>/g, '');
  
  // Check if it ends with proper sentence punctuation
  const endsWithPunctuation = /[.!?]$/.test(textWithoutHtml.trim());
  
  if (endsWithPunctuation) {
    return cleanText; // Already complete
  }
  
  // Find the last complete sentence
  const sentences = textWithoutHtml.split(/([.!?]+)/);
  let completeText = '';
  let htmlText = cleanText;
  
  // Work backwards to find the last complete sentence
  for (let i = 0; i < sentences.length - 1; i += 2) {
    const sentence = sentences[i];
    const punctuation = sentences[i + 1];
    
    if (sentence && sentence.trim().length > 0 && punctuation && /[.!?]/.test(punctuation)) {
      completeText += sentence + punctuation;
    }
  }
  
  if (completeText.trim().length === 0) {
    // If no complete sentences found, add a period to the original text
    // but remove any trailing incomplete words first
    const words = textWithoutHtml.trim().split(/\s+/);
    if (words.length > 3) {
      // Remove the last word if it might be incomplete
      const truncatedText = words.slice(0, -1).join(' ');
      
      // Find this truncated text in the original HTML and cut there
      const truncatedIndex = cleanText.toLowerCase().lastIndexOf(truncatedText.toLowerCase());
      if (truncatedIndex !== -1) {
        htmlText = cleanText.substring(0, truncatedIndex + truncatedText.length);
      }
    }
    
    // Add period if it doesn't end with punctuation
    if (!/[.!?]$/.test(htmlText.replace(/<[^>]*>/g, '').trim())) {
      htmlText += '.';
    }
    
    return htmlText;
  }
  
  // Find where the complete text ends in the original HTML text
  const completeTextIndex = cleanText.toLowerCase().lastIndexOf(completeText.toLowerCase());
  if (completeTextIndex !== -1) {
    return cleanText.substring(0, completeTextIndex + completeText.length);
  }
  
  return completeText;
}

// Static files after API routes
app.use(express.static('public'));

// helper: extract thread id from tweet URL (supports twitter.com & x.com)
function extractThreadId(url: string): string {
  const match = url.match(/https?:\/\/(?:twitter|x)\.com\/[^\/]+\/status\/(\d+)/);
  if (!match) throw new Error('Invalid Twitter URL format');
  return match[1];
}

// fetch full thread text by conversation_id with improved error handling
async function fetchThreadTextFromTwitter(url: string): Promise<string> {
  const threadId = extractThreadId(url);
  
  try {
    let content = '';
    
    try {
      // First try to get the original tweet
      const originalTweet = await twitterClient.v2.singleTweet(threadId, {
        'tweet.fields': ['text', 'created_at', 'conversation_id', 'author_id'],
        'user.fields': ['username', 'name'],
        expansions: ['author_id']
      });
      
      if (originalTweet.data) {
        content = originalTweet.data.text;
        
        // Try to get the full conversation/thread
        try {
          const response = await twitterClient.v2.search(`conversation_id:${threadId}`, {
            'tweet.fields': ['text', 'created_at', 'author_id'],
            'user.fields': ['username', 'name'],
            max_results: 100,
            sort_order: 'recency'
          });
          
          const tweets = response.data?.data || [];
          
          if (tweets.length > 0) {
            // Sort tweets chronologically and combine
            const sorted = tweets.sort((a, b) => {
              const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
              const dateB = b.created_at ? new Date(b.created_at!).getTime() : 0;
              return dateA - dateB;
            });
            
            content = sorted.map((t, index) => `${index + 1}. ${t.text}`).join('\n\n');
          }
        } catch (searchError) {
          console.log('Thread search failed, using original tweet only:', searchError);
          // Keep the original tweet content
        }
        
        return content;
      }
    } catch (apiError) {
      console.error('Twitter API error:', apiError);
      
      // Provide more specific error messages based on the error type
      if (apiError && typeof apiError === 'object' && 'code' in apiError) {
        switch ((apiError as any).code) {
          case 401:
            throw new Error('Twitter API authentication failed. Please check your API credentials.');
          case 403:
            throw new Error('Tweet is private, protected, or access is forbidden.');
          case 404:
            throw new Error('Tweet not found or has been deleted.');
          case 429:
            throw new Error('Twitter API rate limit exceeded. Please try again later.');
          default:
            throw new Error(`Twitter API error (${(apiError as any).code}). The link may be private, deleted, or require authentication.`);
        }
      }
      
      throw new Error(`Unable to fetch Twitter content from ${url}. The link may be private, deleted, or require authentication.`);
    }
    
    throw new Error('No content could be retrieved from the Twitter URL');
  } catch (error) {
    console.error('Error fetching Twitter thread:', error);
    throw error;
  }
}

// generate appropriate prompt based on tone with improved instructions
function getPromptForTone(tone: string, length: string, content: string, isTwitterContent: boolean = false): string {
  const baseInstruction = "Write like a real human who actually understands this stuff. No corporate speak, no robotic responses. Be conversational, relatable, and authentic. Use natural language, contractions, and explain things like you're talking to a friend. CRITICAL: Keep all important keywords, names, technical terms, numbers, and key details from the original - but explain them in human terms when needed. Never ask questions or request clarification. Provide only the summary without any introductory phrases.";
  
  const twitterContext = isTwitterContent ? 
    "This is Twitter/X content. Pull out the main points and make them digestible. Keep all the important stuff - names, numbers, technical terms - but make it actually readable. " : 
    "";
  
  switch (tone) {
    case 'shitpost':
      return `${twitterContext}Turn this into a ${length} shitpost that actually slaps. Use internet slang, memes, and make it funny as hell while still hitting the main points. Don't be cringe about it - make it genuinely entertaining. Keep all the important names, numbers, and technical stuff but make it memeable. ${baseInstruction}\n\n${content}`;
    
    case 'infographics':
      return `${twitterContext}Make this into ${length} that would work perfectly in an infographic. Think clean sections, bullet points, key stats, and visual structure. Use emojis naturally (not overdoing it). Keep all the important numbers, names, and technical details but organize them so they're easy to scan and understand. ${baseInstruction}\n\n${content}`;
    
    case 'simple':
      return `${twitterContext}Break this down into ${length} that anyone can understand. Think "explain it like I'm 5" but not condescending. Use analogies, simple examples, and everyday language. Keep all the important names, numbers, and technical stuff but explain what they actually mean in real terms. ${baseInstruction}\n\n${content}`;
    
    case 'professional':
      return `${twitterContext}Write this as ${length} in a professional tone that doesn't sound like corporate BS. Be polished but still human - like how you'd explain it in a good meeting or email to colleagues. Keep all the technical terms, names, numbers, and key details but make it business-appropriate without being stuffy. ${baseInstruction}\n\n${content}`;
    
    case 'conversational':
      return `${twitterContext}Explain this in ${length} like you're talking to a friend over coffee. Be natural, use contractions, throw in some personality. Make it feel like a real conversation - not a presentation. Keep all the important names, numbers, and technical details but explain them in a way that feels genuine and relatable. ${baseInstruction}\n\n${content}`;
    
    default:
      return `${twitterContext}Write this as ${length} with a ${tone} tone that feels authentic and human. Don't sound like a robot or use corporate speak. Keep all the important keywords, names, technical terms, numbers, and key details from the original but make it actually engaging to read. ${baseInstruction}\n\n${content}`;
  }
}

// serve UI at root
app.get('/', (_req: Request, res: Response): void => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Health check endpoint
app.get('/health', (_req: Request, res: Response): void => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err: any, req: Request, res: Response, next: any) => {
  console.error('Unhandled error:', err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, (): void => console.log(`thread summarizer running on port ${PORT}`));
