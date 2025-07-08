const fetch = require('node-fetch');

// Helper function to detect and extract Twitter URLs from text
function extractTwitterUrls(text) {
  const twitterUrlRegex = /https?:\/\/(?:twitter|x)\.com\/[^\/\s]+\/status\/\d+/g;
  return text.match(twitterUrlRegex) || [];
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
      threadText = rawText || threadUrl;
      isTwitterContent = true;
    } else if (rawText && rawText.length > 0) {
      // Check if the raw text contains Twitter URLs
      const twitterUrls = extractTwitterUrls(rawText);
      if (twitterUrls.length > 0) {
        isTwitterContent = true;
      } else {
        // Check if the text looks like Twitter content
        isTwitterContent = detectTwitterContent(rawText);
      }
      threadText = rawText;
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
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Request timeout')), 8000); // 8 second timeout
    });

    // Make the API call with timeout
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
      timeout: 7000
    });

    const llmRes = await Promise.race([apiCallPromise, timeoutPromise]);
    
    if (!llmRes.ok) {
      const errText = await llmRes.text();
      console.error('OpenRouter API error:', errText);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: `AI service error: ${errText}` })
      };
    }

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
        statusCode: 408,
        headers,
        body: JSON.stringify({ error: 'Request timed out. Please try again with shorter text.' })
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
  const baseInstruction = "Provide only the response without any introductory phrases, questions, or additional commentary. Do not ask questions or request clarification. Keep it concise and direct.";
  
  const twitterContext = isTwitterContent ? 
    "This appears to be Twitter/X content (thread, posts, or tweets). Extract and summarize the key points from the social media content. " : 
    "";
  
  switch (tone) {
    case 'shitpost':
      return `${twitterContext}Transform this content into a ${length} shitpost format. Use internet slang, memes, and humorous takes. Make it funny and irreverent while capturing the main points. ${baseInstruction}\n\n${content}`;
    
    case 'infographics':
      return `${twitterContext}Convert this content into ${length} infographic-style text. Use clear headings, bullet points, key statistics, and structured information that would work well in a visual format. Include emojis and formatting for visual appeal. ${baseInstruction}\n\n${content}`;
    
    case 'simple':
      return `${twitterContext}Summarize this content in ${length} using simple, easy-to-understand language. ${baseInstruction}\n\n${content}`;
    
    case 'professional':
      return `${twitterContext}Summarize this content in ${length} using a professional, business-appropriate tone. ${baseInstruction}\n\n${content}`;
    
    case 'conversational':
      return `${twitterContext}Summarize this content in ${length} using a friendly, conversational tone as if explaining to a friend. ${baseInstruction}\n\n${content}`;
    
    default:
      return `${twitterContext}Summarize this content in ${length} using a ${tone} tone. ${baseInstruction}\n\n${content}`;
  }
}