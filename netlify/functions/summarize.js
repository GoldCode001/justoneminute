const fetch = require('node-fetch');

// Helper function to detect and extract Twitter URLs from text
function extractTwitterUrls(text) {
  const twitterUrlRegex = /https?:\/\/(?:twitter|x)\.com\/[^\/\s]+\/status\/\d+/g;
  return text.match(twitterUrlRegex) || [];
}

// Helper function to extract thread id from tweet URL
function extractThreadId(url) {
  const match = url.match(/https?:\/\/(?:twitter|x)\.com\/[^\/]+\/status\/(\d+)/);
  if (!match) throw new Error('Invalid Twitter URL format');
  return match[1];
}

// Helper function to fetch Twitter content using a simple approach
async function fetchTwitterContent(url) {
  try {
    const threadId = extractThreadId(url);
    
    if (!process.env.TWITTER_BEARER_TOKEN) {
      throw new Error('Twitter API access not configured');
    }
    
    // First try to get the original tweet
    const originalResponse = await fetch(`https://api.twitter.com/2/tweets/${threadId}?tweet.fields=text,created_at,conversation_id,author_id&user.fields=username,name`, {
      headers: {
        'Authorization': `Bearer ${process.env.TWITTER_BEARER_TOKEN}`
      }
    });
    
    if (originalResponse.ok) {
      const originalData = await originalResponse.json();
      const originalTweet = originalData.data;
      
      if (!originalTweet) {
        throw new Error('Unable to fetch original tweet');
      }
      
      // Try to get the full thread/conversation
      const conversationResponse = await fetch(`https://api.twitter.com/2/tweets/search/recent?query=conversation_id:${threadId}&tweet.fields=text,created_at,author_id&user.fields=username,name&max_results=100&sort_order=recency`, {
        headers: {
          'Authorization': `Bearer ${process.env.TWITTER_BEARER_TOKEN}`
        }
      });
      
      if (conversationResponse.ok) {
        const conversationData = await conversationResponse.json();
        const tweets = conversationData.data || [];
        
        if (tweets.length === 0) {
          // Just return the original tweet if no thread found
          return originalTweet.text;
        }
        
        // Sort tweets chronologically and combine
        const sorted = tweets.sort((a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        
        return sorted.map((t, index) => `${index + 1}. ${t.text}`).join('\n\n');
      } else {
        // Fallback to just the original tweet
        return originalTweet.text;
      }
    } else {
      const errorData = await originalResponse.json().catch(() => ({}));
      if (originalResponse.status === 401) {
        throw new Error('Twitter API authentication failed');
      } else if (originalResponse.status === 403) {
        throw new Error('Tweet is private or protected');
      } else if (originalResponse.status === 404) {
        throw new Error('Tweet not found or has been deleted');
      } else {
        throw new Error(`Twitter API error: ${originalResponse.status} - ${errorData.detail || 'Unknown error'}`);
      }
    }
  } catch (error) {
    console.error('Error fetching Twitter content:', error);
    throw new Error(`Unable to fetch content from ${url}: ${error.message}`);
  }
}

// Helper function to fetch content from multiple Twitter URLs
async function fetchContentFromTwitterUrls(urls) {
  const contents = [];
  const errors = [];
  
  for (const url of urls.slice(0, 3)) { // Limit to 3 URLs to prevent timeouts
    try {
      const content = await fetchTwitterContent(url);
      contents.push(`--- Content from ${url} ---\n${content}`);
    } catch (error) {
      console.error(`Failed to fetch content from ${url}:`, error);
      errors.push(`${url}: ${error.message}`);
    }
  }
  
  if (contents.length === 0) {
    throw new Error(`Could not fetch any Twitter content. Errors: ${errors.join('; ')}`);
  }
  
  // If we have some content but also some errors, include both
  if (errors.length > 0) {
    contents.push(`--- Errors fetching some URLs ---\n${errors.join('\n')}`);
  }
  
  return contents.join('\n\n');
}

// Helper function to detect if text contains Twitter-like content
function detectTwitterContent(text) {
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

exports.handler = async (event, context) => {
  // Set CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { threadUrl, rawText, length, tone } = JSON.parse(event.body);
    
    let threadText;
    let isTwitterContent = false;
    
    if (threadUrl && /https?:\/\/(?:twitter|x)\.com\/[^\/]+\/status\/\d+/.test(threadUrl)) {
      try {
        threadText = await fetchTwitterContent(threadUrl);
        isTwitterContent = true;
      } catch (error) {
        // If Twitter fetching fails, check if we have rawText as fallback
        if (rawText && rawText.trim()) {
          threadText = rawText;
          isTwitterContent = true;
        } else {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
              error: `${error.message} Please copy and paste the tweet content directly into the text area instead.` 
            })
          };
        }
      }
    } else if (rawText && rawText.length > 0) {
      // Check if the raw text contains Twitter URLs
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
        // Check if the text looks like Twitter content
        isTwitterContent = detectTwitterContent(rawText);
        threadText = rawText;
      }
    } else {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'No thread link or text provided.' })
      };
    }

    // Truncate very long text to prevent timeouts
    if (threadText.length > 2000) {
      threadText = threadText.substring(0, 2000) + '...';
    }

    const prompt = getPromptForTone(tone, length, threadText, isTwitterContent);
    
    // Create a timeout promise
    const makeApiCallWithRetry = async (retries = 3) => {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          console.log(`API call attempt ${attempt}/${retries}`);
          
          // Create a timeout promise - increased to 15 seconds
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Request timeout')), 15000);
          });

          // Make the API call with increased timeout - 12 seconds
          const apiCallPromise = fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { 
              'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`, 
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://just-one-minute-goldman.netlify.app',
              'X-Title': 'Just One Minute'
            },
            body: JSON.stringify({
              model: 'deepseek/deepseek-chat-v3-0324',
              messages: [{ 
                role: 'user', 
                content: prompt
              }],
              max_tokens: 300,
              temperature: 0.7
            }),
            timeout: 12000
          });

          const llmRes = await Promise.race([apiCallPromise, timeoutPromise]);
          
          if (!llmRes.ok) {
            const errText = await llmRes.text();
            console.error(`OpenRouter API error (attempt ${attempt}):`, errText);
            
            // If it's a 5xx error or timeout, retry. If it's 4xx, don't retry
            if (llmRes.status >= 500 && attempt < retries) {
              console.log(`Retrying due to server error (${llmRes.status})...`);
              await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
              continue;
            }
            
            throw new Error(`AI service error: ${errText}`);
          }
          
          return llmRes;
          
        } catch (error) {
          console.error(`Attempt ${attempt} failed:`, error.message);
          
          // If it's a timeout or network error and we have retries left, try again
          if ((error.message === 'Request timeout' || error.message.includes('fetch')) && attempt < retries) {
            console.log(`Retrying due to ${error.message}...`);
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
            continue;
          }
          
          // If it's the last attempt or a non-retryable error, throw it
          throw error;
        }
      }
    };

    const llmRes = await makeApiCallWithRetry();
    
    const responseText = await llmRes.text();
    let llmData;
    try {
      llmData = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Failed to parse OpenRouter response:', responseText);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Invalid response from AI service' })
      };
    }
    
    if (!llmData.choices || !llmData.choices[0] || !llmData.choices[0].message) {
      console.error('Invalid response structure from OpenRouter:', llmData);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Invalid response structure from AI service' })
      };
    }
    
    const summary = llmData.choices[0].message.content.trim();
    
    if (!summary) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Empty summary received from AI service' })
      };
    }
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ summary })
    };
  } catch (err) {
    console.error('Error in summarize function:', err);
    
    // Handle timeout specifically
    if (err.message === 'Request timeout') {
      return {
        statusCode: 504,
        headers,
        body: JSON.stringify({ error: 'The AI service is taking longer than usual. We tried multiple times but it\'s still timing out. Try again in a moment or use shorter text.' })
      };
    }
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || 'Internal server error' })
    };
  }
};

function getPromptForTone(tone, length, content, isTwitterContent = false) {
  const baseInstruction = "Write like a real human who actually understands this stuff. No corporate speak, no robotic responses. Be conversational, relatable, and authentic. Use natural language, contractions, and explain things like you're talking to a friend. CRITICAL: Keep all important keywords, names, technical terms, numbers, and key details from the original - but explain them in human terms when needed. Never ask questions or request clarification.";
  
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