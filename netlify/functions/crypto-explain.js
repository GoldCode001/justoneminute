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
    const { term } = JSON.parse(event.body || '{}');
    
    if (!term || !term.trim()) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'No crypto term provided.' })
      };
    }

    const cleanTerm = term.trim();
    console.log('Explaining crypto term:', cleanTerm);

    // Create the most human, conversational prompt possible
    const prompt = `You're the coolest crypto expert who explains things like you're talking to a friend over coffee. Someone just asked you about "${cleanTerm}" and you want to give them the most helpful, human explanation ever.

CRITICAL: ALWAYS prioritize the crypto/blockchain/web3/DeFi meaning of any term FIRST. Even if the term has other meanings outside of crypto, focus on its crypto interpretation. If it's not a crypto term at all, then explain what it might relate to in the crypto space or how it could be relevant to crypto/blockchain.

CRITICAL INSTRUCTIONS:
- Write like you're genuinely excited to share knowledge with a friend
- Use natural language, contractions, and be conversational as hell
- Explain it so clearly that anyone can understand, but don't be condescending
- Include why it matters, how it works, and any cool real-world examples
- Keep it concise but comprehensive - like the perfect explanation you'd give in person
- Use analogies and examples that actually make sense
- Be enthusiastic but not over the top
- If it's a complex topic, break it down into digestible pieces
- Include any important context or background they should know
- Make it feel like you're genuinely helping them understand something awesome

Don't start with "Here's" or "This is" - just dive right into explaining it naturally. Make it feel like a real conversation where you're sharing something you're passionate about.

Remember: CRYPTO MEANING FIRST - always interpret the term through a crypto/blockchain lens before anything else.

Explain: ${cleanTerm}`;

    // Aggressive retry logic with very short timeouts
    const makeApiCallWithRetry = async (retries = 2) => {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          console.log(`API call attempt ${attempt}/${retries}`);
          
          const timeoutMs = 8000; // 8 seconds for all attempts
          
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Request timeout')), timeoutMs);
          });

          const apiCallPromise = fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { 
              'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`, 
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://just-one-minute-goldman.netlify.app',
              'X-Title': 'Just One Minute - Crypto Dictionary'
            },
            body: JSON.stringify({
              model: 'openai/gpt-4.1-mini',
              messages: [{ 
                role: 'user', 
                content: prompt
              }],
              max_tokens: 30, // Reduced to work within credit limits
              temperature: 0.8 // Higher temperature for more natural, conversational responses
            })
          });

          const llmRes = await Promise.race([apiCallPromise, timeoutPromise]);
          
          if (!llmRes.ok) {
            const errText = await llmRes.text().catch(() => 'Unknown error');
            console.error(`OpenRouter API error (attempt ${attempt}):`, errText);
            
            if (llmRes.status >= 500 && attempt < retries) {
              console.log(`Retrying due to server error (${llmRes.status})...`);
              await new Promise(resolve => setTimeout(resolve, 500)); // Retry delay
              continue;
            }
            
            // Handle specific error cases with friendly messages
            if (llmRes.status === 429 || errText.includes('rate limit') || errText.includes('quota') || errText.includes('usage')) {
              throw new Error('Site under maintenance, bear with us and try again later');
            } else if (llmRes.status === 402 || errText.includes('insufficient') || errText.includes('credits') || errText.includes('requires more credits') || errText.includes('can only afford')) {
              throw new Error('Site under maintenance, bear with us and try again later');
            } else {
              throw new Error(`AI service error: ${errText}`);
            }
          }
          
          return llmRes;
          
        } catch (error) {
          console.error(`Attempt ${attempt} failed:`, error.message);
          
          if ((error.message === 'Request timeout' || error.message.includes('fetch') || error.code === 'ECONNRESET') && attempt < retries) {
            console.log(`Retrying due to ${error.message}...`);
            await new Promise(resolve => setTimeout(resolve, 300)); // Retry delay
            continue;
          }
          
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
    
    let explanation = llmData.choices[0].message.content.trim();
    
    if (!explanation) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Empty explanation received from AI service' })
      };
    }

    // Post-process to ensure it's conversational and natural
    explanation = postProcessExplanation(explanation);
    
    // Ensure the explanation ends with a complete sentence
    explanation = ensureCompleteSentence(explanation);
    
    console.log('Generated crypto explanation for:', cleanTerm);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ explanation })
    };
  } catch (err) {
    console.error('Error in crypto-explain function:', err);
    
    if (err.message === 'Request timeout') {
      return {
        statusCode: 408,
        headers,
        body: JSON.stringify({ 
          error: 'Request timeout - the AI service is taking too long to respond. Try again in a moment.' 
        })
      };
    }
    
    let statusCode = 500;
    let errorMessage = err.message || 'Internal server error';
    
    if (err.message && (err.message.includes('rate limit') || err.message.includes('Site under maintenance'))) {
      statusCode = 503;
      errorMessage = 'Site under maintenance, bear with us and try again later';
    } else if (err.message && (err.message.includes('quota') || err.message.includes('usage') || err.message.includes('credits') || err.message.includes('requires more credits') || err.message.includes('can only afford'))) {
      statusCode = 503;
      errorMessage = 'Site under maintenance, bear with us and try again later';
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

// Post-processing function to ensure natural, conversational tone
function postProcessExplanation(explanation) {
  // Remove common AI artifacts and make it more conversational
  const artifactsToRemove = [
    /^(Here's|Here is|This is|The following is|Let me explain|I'll explain|So,|Well,)\s+/i,
    /\b(I think|I believe|It seems|It appears|Perhaps|Maybe|Possibly)\b/gi,
    /\b(very very|really really|quite quite)\b/gi,
    /\b(um|uh|er|ah)\b/gi,
    /\.\.\.\s*$/,
    /^[^\w]*/,
    /[^\w\s.,!?;:'"()-]*$/
  ];
  
  let cleaned = explanation;
  artifactsToRemove.forEach(pattern => {
    cleaned = cleaned.replace(pattern, '');
  });
  
  // Fix formatting and ensure conversational flow
  cleaned = cleaned
    .replace(/\s+/g, ' ')
    .replace(/([.!?])\s*([a-z])/g, '$1 $2')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
  
  // Ensure proper capitalization
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  
  // Add conversational elements if missing
  if (!cleaned.match(/\b(basically|essentially|think of it|imagine|it's like|you know)\b/i)) {
    // The explanation might be too formal, but we'll keep it as is since the prompt should handle this
  }
  
  // Final validation
  if (cleaned.length < 20 || !cleaned.match(/[a-zA-Z]/)) {
    cleaned = "I couldn't generate a clear explanation for that term. Could you try asking about it in a different way?";
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
    return cleanText; // Already complete
  }
  
  // More aggressive approach to ensure meaningful completion
  // First, try to find the last complete sentence
  const sentenceMatch = cleanText.match(/(.*[.!?])/);
  if (sentenceMatch) {
    return sentenceMatch[1];
  }
  
  // If no complete sentences, look for natural breaking points
  const words = cleanText.split(/\s+/);
  
  // If it's very short, just add a period
  if (words.length <= 5) {
    return cleanText + '.';
  }
  
  // Look for natural stopping points (conjunctions, prepositions, etc.)
  const stopWords = ['and', 'but', 'or', 'so', 'because', 'since', 'while', 'when', 'where', 'which', 'that', 'with', 'for', 'in', 'on', 'at', 'by', 'from', 'to'];
  
  // Work backwards to find a good stopping point
  for (let i = Math.max(0, words.length - 5); i < words.length; i++) {
    if (stopWords.includes(words[i].toLowerCase())) {
      // Stop before the conjunction/preposition for a more natural ending
      const truncated = words.slice(0, i).join(' ');
      if (truncated.length > 20) { // Make sure we have enough content
        return truncated + '.';
      }
    }
  }
  
  // If no good stopping point found, remove the last few words and add period
  const truncated = words.slice(0, -2).join(' ');
  return truncated.length > 20 ? truncated + '.' : cleanText + '.';
}