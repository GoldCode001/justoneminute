const { logSiteVisit } = require('./analytics');

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const userAgent = event.headers['user-agent'] || '';
    const ip = event.headers['x-forwarded-for'] || event.headers['x-real-ip'] || '';

    await logSiteVisit(userAgent, ip);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true })
    };
  } catch (error) {
    console.error('Error tracking visit:', error);
    return {
      statusCode: 200, // Return 200 to not break the frontend
      headers,
      body: JSON.stringify({ success: false })
    };
  }
};