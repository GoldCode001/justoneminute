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
    
    let threadText;
    let isTwitterContent = false;
    
    // Log the summarization request attempt
    let contentType = 'general_text';
    
    if (threadUrl && /https?:\/\/(?:twitter|x)\.com\/[^\/]+\/status\/\d+/.test(threadUrl)) {
      contentType = 'twitter_url';
      try {
        threadText = await fetchTwitterContent(threadUrl);
        isTwitterContent = true;
      } catch (error) {
        // If Twitter fetching fails, check if we have rawText as fallback
        if (rawText && rawText.trim()) {
          threadText = rawText;
          isTwitterContent = true;
          contentType = 'twitter_text';
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
        contentType = 'twitter_text';
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
        contentType = isTwitterContent ? 'twitter_text' : 'general_text';
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
    if (threadText.length > 2000) {
      threadText = threadText.substring(0, 2000) + '...';
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
              model: 'openai/gpt-4.1-mini',
              messages: [{ 
                role: 'user', 
                content: prompt
              }],
              max_tokens: 30, // Reduced to work within credit limits
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
    
    // Ensure the summary ends with a complete sentence
    summary = ensureCompleteSentence(summary);
    
    // Log successful tone usage and summarization
    await Promise.all([
      logToneUsage(tone),
      logSummarizationRequest(tone, length, contentType, true)
    ]).catch(err => console.log('Analytics logging failed:', err));
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ summary })
    };
  } catch (err) {
    console.error('Error in summarize function:', err);
    
    // Log failed summarization attempt
    try {
      const { tone, length } = JSON.parse(event.body || '{}');
      const contentType = 'unknown';
      await logSummarizationRequest(tone || 'unknown', length || 'unknown', contentType, false);
    } catch (logError) {
      console.error('Error logging failed request:', logError);
    }
    
    // Handle timeout specifically
    if (err.message === 'Request timeout') {
      return {
        statusCode: 408,
        headers,
        body: JSON.stringify({ 
          error: 'Request timeout - the AI service is taking too long to respond. This usually happens with very long text. Try using shorter content or try again in a moment.' 
        })
      };
    }
    
    // Handle different error types more gracefully
    let statusCode = 500;
    let errorMessage = err.message || 'Internal server error';
    
    if (err.message && err.message.includes('rate limit')) {
      statusCode = 429;
      errorMessage = 'Too many requests - please wait a moment and try again.';
    } else if (err.message && err.message.includes('network')) {
      statusCode = 503;
      errorMessage = 'Network error - unable to connect to AI service. Please try again.';
    } else if (err.message && err.message.includes('Invalid response')) {
      statusCode = 502;
      errorMessage = 'AI service returned an invalid response. Please try again.';
    }
    
    return {
      statusCode,
      headers,
      body: JSON.stringify({ error: errorMessage })
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

// Helper function to ensure text ends with a complete sentence
function ensureCompleteSentence(text) {
  if (!text || text.trim().length === 0) {
    return text;
  }
  
  let cleanText = text.trim();
  
  // Check if it ends with proper sentence punctuation
  const endsWithPunctuation = /[.!?]$/.test(cleanText);
  
  if (endsWithPunctuation) {
    // Even if it ends with punctuation, verify the last sentence is complete
    const sentences = cleanText.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const lastSentence = sentences[sentences.length - 1];
    
    // Check if the last sentence has sufficient structure
    if (lastSentence && lastSentence.trim().split(/\s+/).length >= 3) {
      return cleanText; // Sentence appears complete
    }
  }
  
  // If we get here, we need to fix the sentence ending
  // Split by sentence punctuation and rebuild complete sentences
  const sentenceParts = cleanText.split(/([.!?]+)/);
  let completeText = '';
  
  for (let i = 0; i < sentenceParts.length - 1; i += 2) {
    const sentence = sentenceParts[i];
    const punctuation = sentenceParts[i + 1];
    
    if (sentence && sentence.trim().length > 0 && punctuation && /[.!?]/.test(punctuation)) {
      const words = sentence.trim().split(/\s+/);
      
      // Ensure sentence has meaningful length and structure
      if (words.length >= 4) {
        // Look for basic sentence components
        const hasSubject = words.some(word => 
          /^[A-Z]/.test(word) || 
          /\b(it|this|that|these|those|they|we|you|I|he|she|the|a|an)\b/i.test(word)
        );
        const hasVerb = words.some(word => 
          /\b(is|are|was|were|has|have|had|will|would|can|could|should|might|must|do|does|did|get|got|make|made|take|took|go|went|come|came|see|saw|know|knew|think|thought|say|said|tell|told|give|gave|find|found|use|used|work|worked|help|helped|show|showed|mean|means|allow|allows|enable|enables|provide|provides|include|includes|contain|contains|involve|involves|require|requires|offer|offers|support|supports)\b/i.test(word)
        );

        // Include sentence if it has basic structure or is reasonably substantial
        if ((hasSubject && hasVerb) || words.length >= 6) {
          completeText += sentence.trim() + punctuation;
        }
      }
    }
  }
  
  // If we found complete sentences, return them
  if (completeText.trim().length > 15) {
    return completeText.trim();
  }
  
  // If no complete sentences, try to create one from the available text
  const words = cleanText.replace(/[.!?]*$/, '').split(/\s+/);
  
  if (words.length <= 3) {
    // Very short text, just add period
    return cleanText.replace(/[.!?]*$/, '') + '.';
  }
  
  // Look for natural breaking points to avoid cutting mid-thought
  const breakWords = ['and', 'but', 'or', 'so', 'because', 'since', 'while', 'when', 'where', 'which', 'that', 'with', 'for', 'in', 'on', 'at', 'by', 'from', 'to'];
  
  // Work backwards from the end to find a good stopping point
  for (let i = words.length - 1; i >= Math.max(3, words.length - 6); i--) {
    if (breakWords.includes(words[i].toLowerCase())) {
      const truncated = words.slice(0, i).join(' ');
      if (truncated.split(/\s+/).length >= 3) {
        return truncated + '.';
      }
    }
  }
  
  // If no good break point, remove last few words to avoid incomplete thoughts
  const safeTruncated = words.slice(0, Math.max(3, words.length - 3)).join(' ');
  if (safeTruncated.split(/\s+/).length >= 3) {
    return safeTruncated + '.';
  }
  
  // Last resort: return original with proper punctuation
  return cleanText.replace(/[.!?]*$/, '') + '.';
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
  
  const baseInstruction = `${analysisContext}You are a brilliant human content summarizer who writes with natural flow and authentic voice. Read and understand the content first, then provide ONLY the summary response without any introductory phrases, questions, or commentary. 

MANDATORY REQUIREMENTS:
1. Write naturally and conversationally, but stay calm and measured
2. Preserve ALL important names, numbers, technical terms, and key concepts from the original
3. Keep it concise and clear - get to the point smoothly
4. Ensure the summary is factually accurate and makes complete sense
5. Use proper grammar and keep it conversational and brief
6. Never ask questions or request clarification
7. Make it informative and engaging without being overly excited
8. Avoid using em dashes (—) in your response
9. Focus on accuracy and clarity over enthusiasm`;
  
  const twitterContext = isTwitterContent ? 
    "This is Twitter/X content. Pull out the main points quickly and make them digestible. " : 
    "";
  
  const bulletInstruction = length === 'bullet list' ? 
    "Format as clean, SHORT bullet points. Use • or - for bullets. Make each bullet punchy and complete. " : 
    "";
  
  switch (tone) {
    case 'shitpost':
      return `${twitterContext}${bulletInstruction}Turn this into a ${length} that's funny and engaging while hitting the main points. Use casual internet language but keep it informative. Keep ALL important names/numbers but make it entertaining. Be witty but not over the top. ${baseInstruction}\n\nCONTENT TO SUMMARIZE:\n${content}`;
    
    case 'infographics':
      return `${twitterContext}${bulletInstruction}Make this into ${length} perfect for an infographic. Clean sections, key stats, visual structure. Use emojis naturally and organize for easy scanning. Keep ALL important numbers/names but structure them clearly. ${baseInstruction}\n\nCONTENT TO SUMMARIZE:\n${content}`;
    
    case 'simple':
      return `${twitterContext}${bulletInstruction}Break this down into ${length} anyone can understand. Use everyday language and simple examples. Keep ALL important names/numbers but explain what they mean clearly. Like explaining to a friend who wants to understand. ${baseInstruction}\n\nCONTENT TO SUMMARIZE:\n${content}`;
    
    case 'professional':
      return `${twitterContext}${bulletInstruction}Write this as ${length} in professional tone that's polished but human. Like a good meeting summary. Keep all technical terms/names/numbers but make it business-appropriate and clear. ${baseInstruction}\n\nCONTENT TO SUMMARIZE:\n${content}`;
    
    case 'conversational':
      return `${twitterContext}${bulletInstruction}Explain this in ${length} like talking to a friend. Natural, relaxed, with some personality. Real conversation feel. Keep all important names/numbers but explain them naturally. ${baseInstruction}\n\nCONTENT TO SUMMARIZE:\n${content}`;
    
    default:
      return `${twitterContext}${bulletInstruction}Write this as ${length} with ${tone} tone that's authentic and human. Keep all important keywords/names/numbers but make it clear and engaging. ${baseInstruction}\n\nCONTENT TO SUMMARIZE:\n${content}`;
  }
}