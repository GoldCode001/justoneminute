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
    
    // First try to get the original tweet with shorter timeout
    const originalResponse = await Promise.race([
      fetch(`https://api.twitter.com/2/tweets/${threadId}?tweet.fields=text,created_at,conversation_id,author_id&user.fields=username,name`, {
        headers: {
          'Authorization': `Bearer ${process.env.TWITTER_BEARER_TOKEN}`
        }
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Twitter API timeout')), 3000))
    ]);
    
    if (originalResponse.ok) {
      const originalData = await originalResponse.json();
      const originalTweet = originalData.data;
      
      if (!originalTweet) {
        throw new Error('Unable to fetch original tweet');
      }
      
      // Try to get the full thread/conversation with shorter timeout
      try {
        const conversationResponse = await Promise.race([
          fetch(`https://api.twitter.com/2/tweets/search/recent?query=conversation_id:${threadId}&tweet.fields=text,created_at,author_id&user.fields=username,name&max_results=100&sort_order=recency`, {
            headers: {
              'Authorization': `Bearer ${process.env.TWITTER_BEARER_TOKEN}`
            }
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Twitter search timeout')), 2000))
        ]);
        
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
      } catch (searchError) {
        console.log('Thread search failed, using original tweet only:', searchError);
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
  
  for (const url of urls.slice(0, 2)) { // Limit to 2 URLs to prevent timeouts
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
  // Set context timeout to maximum available
  context.callbackWaitsForEmptyEventLoop = false;
  
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

    // Truncate very long text to prevent timeouts - more aggressive truncation
    if (threadText.length > 1500) {
      threadText = threadText.substring(0, 1500) + '...';
    }

    const prompt = getPromptForTone(tone, length, threadText, isTwitterContent);
    
    // Aggressive retry logic with very short timeouts to stay within 10 second limit
    const makeApiCallWithRetry = async (retries = 2) => {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          console.log(`API call attempt ${attempt}/${retries}`);
          
          // Very aggressive timeout - 4 seconds for first attempt, 3 for retry
          const timeoutMs = attempt === 1 ? 4000 : 3000;
          
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Request timeout')), timeoutMs);
          });

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
              max_tokens: 250, // Reduced to get faster responses
              temperature: 0.7
            })
          });

          const llmRes = await Promise.race([apiCallPromise, timeoutPromise]);
          
          if (!llmRes.ok) {
            const errText = await llmRes.text().catch(() => 'Unknown error');
            console.error(`OpenRouter API error (attempt ${attempt}):`, errText);
            
            // Only retry on 5xx errors and if we have attempts left
            if (llmRes.status >= 500 && attempt < retries) {
              console.log(`Retrying due to server error (${llmRes.status})...`);
              await new Promise(resolve => setTimeout(resolve, 500)); // Very short backoff
              continue;
            }
            
            throw new Error(`AI service error: ${errText}`);
          }
          
          return llmRes;
          
        } catch (error) {
          console.error(`Attempt ${attempt} failed:`, error.message);
          
          // Only retry timeouts and network errors if we have attempts left
          if ((error.message === 'Request timeout' || error.message.includes('fetch') || error.code === 'ECONNRESET') && attempt < retries) {
            console.log(`Retrying due to ${error.message}...`);
            await new Promise(resolve => setTimeout(resolve, 300)); // Very short backoff
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
        body: JSON.stringify({ 
          error: 'The AI service is taking too long to respond. This usually happens with very long text. Try using shorter text or try again in a moment.' 
        })
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
  const baseInstruction = "Provide only the response without any introductory phrases, questions, or additional commentary. Do not ask questions or request clarification. Keep it concise and direct. IMPORTANT: Preserve all key terms, technical concepts, names, numbers, and important keywords from the original content. Do not omit crucial details or terminology.";
  
  const twitterContext = isTwitterContent ? 
    "This appears to be Twitter/X content (thread, posts, or tweets). Extract and summarize the key points from the social media content. Maintain all important keywords, names, technical terms, and specific details mentioned. " : 
    "";
  
  switch (tone) {
    case 'shitpost':
      return `${twitterContext}Transform this content into a ${length} shitpost format. Use internet slang, memes, and humorous takes. Make it funny and irreverent while capturing the main points. CRITICAL: Keep all important keywords, names, technical terms, and key concepts from the original. ${baseInstruction}\n\n${content}`;
    
    case 'infographics':
      return `${twitterContext}Convert this content into ${length} infographic-style text. Use clear headings, bullet points, key statistics, and structured information that would work well in a visual format. Include emojis and formatting for visual appeal. CRITICAL: Include all important keywords, numbers, names, and technical terms from the original content. ${baseInstruction}\n\n${content}`;
    
    case 'simple':
      return `${twitterContext}Summarize this content in ${length} using simple, easy-to-understand language. CRITICAL: Even when simplifying, preserve all important keywords, names, technical terms, numbers, and key concepts from the original. ${baseInstruction}\n\n${content}`;
    
    case 'professional':
      return `${twitterContext}Summarize this content in ${length} using a professional, business-appropriate tone. CRITICAL: Maintain all important keywords, technical terminology, names, numbers, and key concepts from the original content. ${baseInstruction}\n\n${content}`;
    
    case 'conversational':
      return `${twitterContext}Summarize this content in ${length} using a friendly, conversational tone as if explaining to a friend. CRITICAL: Keep all important keywords, names, technical terms, and key details from the original content. ${baseInstruction}\n\n${content}`;
    
    default:
      return `${twitterContext}Summarize this content in ${length} using a ${tone} tone. CRITICAL: Preserve all important keywords, names, technical terms, numbers, and key concepts from the original content. ${baseInstruction}\n\n${content}`;
  }
}