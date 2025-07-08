const { getAnalyticsSummary } = require('./analytics');

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const summary = getAnalyticsSummary();
    
    // Create a simple HTML dashboard
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Just One Minute - Analytics Dashboard</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%);
          color: #f5f5f5;
          min-height: 100vh;
          padding: 20px;
        }
        .container {
          max-width: 1200px;
          margin: 0 auto;
        }
        h1 {
          text-align: center;
          color: #ffd700;
          margin-bottom: 40px;
          font-size: 2.5em;
        }
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 20px;
          margin-bottom: 40px;
        }
        .stat-card {
          background: linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%);
          border: 2px solid #ffd700;
          border-radius: 16px;
          padding: 24px;
          box-shadow: 0 8px 32px rgba(255, 215, 0, 0.2);
        }
        .stat-title {
          color: #ffd700;
          font-size: 1.2em;
          font-weight: 600;
          margin-bottom: 16px;
        }
        .stat-value {
          font-size: 2em;
          font-weight: 700;
          color: #fff;
          margin-bottom: 8px;
        }
        .tone-list {
          list-style: none;
        }
        .tone-item {
          display: flex;
          justify-content: space-between;
          padding: 8px 0;
          border-bottom: 1px solid #333;
        }
        .tone-item:last-child {
          border-bottom: none;
        }
        .refresh-btn {
          background: linear-gradient(135deg, #ffd700 0%, #ffed4e 100%);
          color: #0a0a0a;
          border: none;
          padding: 12px 24px;
          border-radius: 12px;
          font-weight: 600;
          cursor: pointer;
          margin: 20px auto;
          display: block;
        }
        .refresh-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 20px rgba(255, 215, 0, 0.4);
        }
        .last-updated {
          text-align: center;
          color: #888;
          margin-top: 20px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>📊 Just One Minute Analytics</h1>
        
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-title">Total Site Visits</div>
            <div class="stat-value">${summary.totalVisits}</div>
          </div>
          
          <div class="stat-card">
            <div class="stat-title">Total Summarizations</div>
            <div class="stat-value">${summary.totalSummarizations}</div>
          </div>
          
          <div class="stat-card">
            <div class="stat-title">Success Rate</div>
            <div class="stat-value">${summary.totalSummarizations > 0 ? Math.round((summary.successfulSummarizations / summary.totalSummarizations) * 100) : 0}%</div>
          </div>
          
          <div class="stat-card">
            <div class="stat-title">Tone Usage</div>
            <ul class="tone-list">
              ${Object.entries(summary.toneUsage).map(([date, tones]) => 
                Object.entries(tones).map(([tone, count]) => 
                  `<li class="tone-item"><span>${tone}</span><span>${count}</span></li>`
                ).join('')
              ).join('')}
            </ul>
          </div>
        </div>
        
        <button class="refresh-btn" onclick="location.reload()">🔄 Refresh Data</button>
        
        <div class="last-updated">
          Last updated: ${new Date(summary.lastUpdated).toLocaleString()}
        </div>
      </div>
    </body>
    </html>
    `;

    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': 'text/html'
      },
      body: html
    };
  } catch (error) {
    console.error('Error generating analytics dashboard:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};