const fetch = require('node-fetch');
const { logToneUsage, logSummarizationRequest } = require('./analytics');

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

// NEW: Intelligent content analysis function
function analyzeContent(text) {
  const analysis = {
    contentType: 'general',
    keyTopics: [],
    technicalTerms: [],
    names: [],
    numbers: [],
    mainPoints: [],
    complexity: 'medium',
    language: 'english'
  };
  
  // Detect content type
  if (detectTwitterContent(text)) {
    analysis.contentType = 'social_media';
  } else if (text.match(/\b(research|study|analysis|findings|methodology|conclusion)\b/gi)) {
    analysis.contentType = 'academic';
  } else if (text.match(/\b(revenue|profit|market|business|company|CEO|startup)\b/gi)) {
    analysis.contentType = 'business';
  } else if (text.match(/\b(code|programming|software|API|database|algorithm)\b/gi)) {
    analysis.contentType = 'technical';
  } else if (text.match(/\b(breaking|news|report|according to|sources)\b/gi)) {
    analysis.contentType = 'news';
  }
  
  // Extract key elements
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
  
  // Extract names (capitalized words that aren't common words)
  const commonWords = new Set(['The', 'This', 'That', 'These', 'Those', 'And', 'But', 'Or', 'So', 'For', 'If', 'When', 'Where', 'Why', 'How', 'What', 'Who', 'Which']);
  const nameMatches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
  analysis.names = [...new Set(nameMatches.filter(name => !commonWords.has(name)))].slice(0, 10);
  
  // Extract numbers and percentages
  analysis.numbers = [...new Set(text.match(/\b\d+(?:[.,]\d+)*%?(?:\s*(?:million|billion|thousand|k|M|B))?\b/g) || [])].slice(0, 10);
  
  // Extract technical terms (words with specific patterns)
  const techTerms = text.match(/\b[A-Z]{2,}(?:[A-Z][a-z]*)*\b|\b\w+(?:API|SDK|AI|ML|UI|UX|SaaS|IoT)\b|\b\w*(?:tech|soft|ware|system|platform|framework)\w*\b/gi) || [];
  analysis.technicalTerms = [...new Set(techTerms)].slice(0, 10);
  
  // Determine complexity
  const avgWordsPerSentence = sentences.reduce((sum, s) => sum + s.split(' ').length, 0) / sentences.length;
  const complexWords = text.match(/\b\w{8,}\b/g) || [];
  
  if (avgWordsPerSentence > 25 || complexWords.length > text.split(' ').length * 0.3) {
    analysis.complexity = 'high';
  } else if (avgWordsPerSentence < 15 && complexWords.length < text.split(' ').length * 0.1) {
    analysis.complexity = 'low';
  }
  
  // Extract main points (sentences with key indicators)
  analysis.mainPoints = sentences
    .filter(s => s.match(/\b(key|important|main|significant|crucial|essential|primary|major)\b/gi) || 
                 s.match(/\b(because|therefore|however|moreover|furthermore|additionally)\b/gi) ||
                 s.length > 50)
    .slice(0, 5);
  
  return analysis;
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
    
    // Log the summarization request attempt
    const contentType = threadUrl ? 'twitter_url' : (isTwitterContent ? 'twitter_text' : 'general_text');
    
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

    // NEW: Analyze the content before summarization
    const contentAnalysis = analyzeContent(threadText);
    console.log('Content analysis:', contentAnalysis);

    const prompt = getPromptForTone(tone, length, threadText, isTwitterContent, contentAnalysis);
    
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
              max_tokens: 300, // Increased slightly for better quality
              temperature: 0.6 // Slightly lower for more consistent output
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
    
    let summary = llmData.choices[0].message.content.trim();
    
    if (!summary) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Empty summary received from AI service' })
      };
    }

    // NEW: Post-process the summary to ensure clarity and remove any bogus content
    summary = postProcessSummary(summary, tone, contentAnalysis);
    
    // Log successful tone usage and summarization
    await Promise.all([
      logToneUsage(tone),
      logSummarizationRequest(tone, length, contentType, true)
    ]);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ summary })
    };
  } catch (err) {
    console.error('Error in summarize function:', err);
    
    // Log failed summarization attempt
    try {
      const { tone, length } = JSON.parse(event.body);
      const contentType = 'unknown';
      await logSummarizationRequest(tone || 'unknown', length || 'unknown', contentType, false);
    } catch (logError) {
      console.error('Error logging failed request:', logError);
    }
    
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

// NEW: Post-processing function to clean up and improve summary quality
function postProcessSummary(summary, tone, contentAnalysis) {
  // Remove common AI artifacts and filler phrases
  const artifactsToRemove = [
    /^(Here's|Here is|This is|The following is|In summary|To summarize|Based on|According to)\s+/i,
    /\b(I think|I believe|It seems|It appears|Perhaps|Maybe|Possibly)\b/gi,
    /\b(very very|really really|quite quite)\b/gi, // Remove redundant intensifiers
    /\b(um|uh|er|ah)\b/gi, // Remove filler words
    /\.\.\.\s*$/, // Remove trailing ellipsis
    /^[^\w]*/, // Remove leading non-word characters
    /[^\w\s.,!?;:'"()-]*$/ // Remove trailing non-standard characters
  ];
  
  let cleaned = summary;
  artifactsToRemove.forEach(pattern => {
    cleaned = cleaned.replace(pattern, '');
  });
  
  // Fix common formatting issues
  cleaned = cleaned
    .replace(/\s+/g, ' ') // Multiple spaces to single space
    .replace(/([.!?])\s*([a-z])/g, '$1 $2') // Ensure space after punctuation
    .replace(/([a-z])([A-Z])/g, '$1 $2') // Add space between camelCase words
    .trim();
  
  // Ensure proper capitalization
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  
  // Tone-specific post-processing
  switch (tone) {
    case 'simple':
      // Replace complex words with simpler alternatives
      const simplifications = {
        'utilize': 'use',
        'demonstrate': 'show',
        'facilitate': 'help',
        'implement': 'do',
        'subsequently': 'then',
        'approximately': 'about',
        'numerous': 'many',
        'substantial': 'large'
      };
      Object.entries(simplifications).forEach(([complex, simple]) => {
        cleaned = cleaned.replace(new RegExp(`\\b${complex}\\b`, 'gi'), simple);
      });
      break;
      
    case 'professional':
      // Ensure professional language consistency
      cleaned = cleaned
        .replace(/\bcan't\b/g, 'cannot')
        .replace(/\bwon't\b/g, 'will not')
        .replace(/\bdon't\b/g, 'do not');
      break;
      
    case 'shitpost':
      // Ensure it doesn't go too far into nonsense
      if (cleaned.length < 20 || !cleaned.match(/[a-zA-Z]/)) {
        cleaned = "This content is basically saying: " + cleaned;
      }
      break;
  }
  
  // Final validation - ensure the summary makes sense
  if (cleaned.length < 10 || !cleaned.match(/[a-zA-Z]/)) {
    cleaned = "Unable to generate a clear summary. The content may be too complex or unclear.";
  }
  
  return cleaned;
}

// UPDATED: Enhanced prompt generation with content analysis
function getPromptForTone(tone, length, content, isTwitterContent = false, contentAnalysis = null) {
  const analysisContext = contentAnalysis ? `
CONTENT ANALYSIS:
- Type: ${contentAnalysis.contentType}
- Complexity: ${contentAnalysis.complexity}
- Key names: ${contentAnalysis.names.join(', ')}
- Important numbers: ${contentAnalysis.numbers.join(', ')}
- Technical terms: ${contentAnalysis.technicalTerms.join(', ')}

CRITICAL INSTRUCTIONS:
` : '';
  
  const baseInstruction = `${analysisContext}You are an expert content summarizer. Read and understand the content first, then provide ONLY the summary response without any introductory phrases, questions, or commentary. 

MANDATORY REQUIREMENTS:
1. Preserve ALL important names, numbers, technical terms, and key concepts from the original
2. Write in clear, understandable language with NO confusing or bogus words
3. Ensure the summary is factually accurate and makes complete sense
4. Use proper grammar and sentence structure
5. Never ask questions or request clarification
6. Provide only the summary content, nothing else`;
  
  const twitterContext = isTwitterContent ? 
    "This is Twitter/X content. Extract the main points and make them digestible while keeping all important details. " : 
    "";
  
  switch (tone) {
    case 'shitpost':
      return `${twitterContext}Transform this into a ${length} shitpost that's genuinely funny and entertaining while capturing all the main points. Use internet slang and memes naturally, but ensure it's still informative and makes complete sense. Keep ALL important names, numbers, and technical details but present them in a humorous way. ${baseInstruction}\n\nCONTENT TO SUMMARIZE:\n${content}`;
    
    case 'infographics':
      return `${twitterContext}Convert this into ${length} infographic-style content with clear structure, bullet points, and key statistics. Use emojis appropriately and organize information for easy scanning. Include ALL important numbers, names, and technical details in a visually structured format. ${baseInstruction}\n\nCONTENT TO SUMMARIZE:\n${content}`;
    
    case 'simple':
      return `${twitterContext}Explain this in ${length} using simple, everyday language that anyone can understand. Break down complex concepts into easy-to-grasp explanations. Keep ALL important names, numbers, and technical terms but explain what they mean in plain English. ${baseInstruction}\n\nCONTENT TO SUMMARIZE:\n${content}`;
    
    case 'professional':
      return `${twitterContext}Summarize this in ${length} using professional, business-appropriate language that's polished but not stuffy. Maintain all technical terminology, names, numbers, and key details while ensuring clarity and professionalism. ${baseInstruction}\n\nCONTENT TO SUMMARIZE:\n${content}`;
    
    case 'conversational':
      return `${twitterContext}Explain this in ${length} like you're having a friendly conversation with someone. Use natural language, contractions, and a warm tone while keeping all important names, numbers, and technical details. Make it feel genuine and relatable. ${baseInstruction}\n\nCONTENT TO SUMMARIZE:\n${content}`;
    
    default:
      return `${twitterContext}Summarize this content in ${length} using a ${tone} tone that's clear, accurate, and engaging. Preserve ALL important keywords, names, technical terms, numbers, and key concepts from the original while ensuring the summary is easy to understand. ${baseInstruction}\n\nCONTENT TO SUMMARIZE:\n${content}`;
  }
}