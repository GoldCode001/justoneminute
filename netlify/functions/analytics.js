const { google } = require('googleapis');

// Create a new Google Sheet for analytics
const SPREADSHEET_ID = '1BvQxK8mZnP4rL2sT6uY9wE3rT7yU1iO5pA8sD2fG4hJ'; // This will be created

// Initialize Google Sheets API
async function getGoogleSheetsClient() {
  try {
    // Create a simple service account setup
    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    return google.sheets({ version: 'v4', auth });
  } catch (error) {
    console.error('Error initializing Google Sheets client:', error);
    // Fallback to in-memory storage if Google Sheets fails
    return null;
  }
}

// In-memory storage as fallback
let analyticsData = {
  toneUsage: {},
  siteVisits: [],
  dailyVisits: {},
  summarizationLogs: []
};

// Create new spreadsheet
async function createAnalyticsSpreadsheet() {
  try {
    const sheets = await getGoogleSheetsClient();
    if (!sheets) return null;

    const spreadsheet = await sheets.spreadsheets.create({
      resource: {
        properties: {
          title: 'Just One Minute - Analytics Dashboard'
        },
        sheets: [
          {
            properties: {
              title: 'ToneUsage',
              gridProperties: { rowCount: 1000, columnCount: 10 }
            }
          },
          {
            properties: {
              title: 'SiteVisits',
              gridProperties: { rowCount: 10000, columnCount: 10 }
            }
          },
          {
            properties: {
              title: 'DailySummary',
              gridProperties: { rowCount: 1000, columnCount: 10 }
            }
          },
          {
            properties: {
              title: 'SummarizationLogs',
              gridProperties: { rowCount: 10000, columnCount: 10 }
            }
          }
        ]
      }
    });

    const spreadsheetId = spreadsheet.data.spreadsheetId;
    console.log('Created new spreadsheet:', spreadsheetId);

    // Make it publicly viewable
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [{
          updateSpreadsheetProperties: {
            properties: {
              title: 'Just One Minute - Analytics Dashboard'
            },
            fields: 'title'
          }
        }]
      }
    });

    // Add headers to each sheet
    const sheetConfigs = [
      {
        name: 'ToneUsage',
        headers: ['Date', 'Tone', 'Count', 'Last Updated']
      },
      {
        name: 'SiteVisits',
        headers: ['Timestamp', 'Date', 'Hashed IP', 'Browser', 'Device Type', 'User Agent']
      },
      {
        name: 'DailySummary',
        headers: ['Date', 'Total Visits', 'Last Updated']
      },
      {
        name: 'SummarizationLogs',
        headers: ['Timestamp', 'Date', 'Tone', 'Length', 'Content Type', 'Status']
      }
    ];

    for (const config of sheetConfigs) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${config.name}!A1`,
        valueInputOption: 'RAW',
        resource: {
          values: [config.headers]
        }
      });
    }

    return spreadsheetId;
  } catch (error) {
    console.error('Error creating spreadsheet:', error);
    return null;
  }
}

// Log tone usage
async function logToneUsage(tone) {
  try {
    console.log(`Logging tone usage: ${tone}`);
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    
    // Update in-memory storage
    if (!analyticsData.toneUsage[date]) {
      analyticsData.toneUsage[date] = {};
    }
    if (!analyticsData.toneUsage[date][tone]) {
      analyticsData.toneUsage[date][tone] = 0;
    }
    analyticsData.toneUsage[date][tone]++;

    // Try to log to Google Sheets
    const sheets = await getGoogleSheetsClient();
    if (sheets) {
      try {
        // For now, just append each usage
        await sheets.spreadsheets.values.append({
          spreadsheetId: '1BvQxK8mZnP4rL2sT6uY9wE3rT7yU1iO5pA8sD2fG4hJ',
          range: 'ToneUsage!A:D',
          valueInputOption: 'RAW',
          resource: {
            values: [[date, tone, 1, now.toISOString()]]
          }
        });
      } catch (error) {
        console.log('Google Sheets logging failed, using in-memory storage');
      }
    }

    console.log(`Tone usage logged: ${tone} (Total for ${date}: ${analyticsData.toneUsage[date][tone]})`);
  } catch (error) {
    console.error('Error logging tone usage:', error);
  }
}

// Log site visit
async function logSiteVisit(userAgent = '', ip = '') {
  try {
    console.log('Logging site visit');
    const now = new Date();
    const timestamp = now.toISOString();
    const date = now.toISOString().split('T')[0];

    const isMobile = /Mobile|Android|iPhone|iPad/i.test(userAgent);
    const browser = extractBrowser(userAgent);
    const hashedIP = hashString(ip);

    const visitData = {
      timestamp,
      date,
      hashedIP,
      browser,
      deviceType: isMobile ? 'Mobile' : 'Desktop',
      userAgent: userAgent.substring(0, 200)
    };

    // Update in-memory storage
    analyticsData.siteVisits.push(visitData);
    if (!analyticsData.dailyVisits[date]) {
      analyticsData.dailyVisits[date] = 0;
    }
    analyticsData.dailyVisits[date]++;

    // Try to log to Google Sheets
    const sheets = await getGoogleSheetsClient();
    if (sheets) {
      try {
        await sheets.spreadsheets.values.append({
          spreadsheetId: '1BvQxK8mZnP4rL2sT6uY9wE3rT7yU1iO5pA8sD2fG4hJ',
          range: 'SiteVisits!A:F',
          valueInputOption: 'RAW',
          resource: {
            values: [[timestamp, date, hashedIP, browser, visitData.deviceType, visitData.userAgent]]
          }
        });

        await sheets.spreadsheets.values.append({
          spreadsheetId: '1BvQxK8mZnP4rL2sT6uY9wE3rT7yU1iO5pA8sD2fG4hJ',
          range: 'DailySummary!A:C',
          valueInputOption: 'RAW',
          resource: {
            values: [[date, analyticsData.dailyVisits[date], timestamp]]
          }
        });
      } catch (error) {
        console.log('Google Sheets logging failed, using in-memory storage');
      }
    }

    console.log(`Site visit logged for ${date} (Total visits: ${analyticsData.dailyVisits[date]})`);
  } catch (error) {
    console.error('Error logging site visit:', error);
  }
}

// Log summarization request
async function logSummarizationRequest(tone, length, contentType, success = true) {
  try {
    console.log(`Logging summarization: ${tone}, ${length}, ${contentType}, ${success}`);
    const now = new Date();
    const timestamp = now.toISOString();
    const date = now.toISOString().split('T')[0];

    const logData = {
      timestamp,
      date,
      tone,
      length,
      contentType,
      status: success ? 'Success' : 'Failed'
    };

    // Update in-memory storage
    analyticsData.summarizationLogs.push(logData);

    // Try to log to Google Sheets
    const sheets = await getGoogleSheetsClient();
    if (sheets) {
      try {
        await sheets.spreadsheets.values.append({
          spreadsheetId: '1BvQxK8mZnP4rL2sT6uY9wE3rT7yU1iO5pA8sD2fG4hJ',
          range: 'SummarizationLogs!A:F',
          valueInputOption: 'RAW',
          resource: {
            values: [[timestamp, date, tone, length, contentType, logData.status]]
          }
        });
      } catch (error) {
        console.log('Google Sheets logging failed, using in-memory storage');
      }
    }

    console.log(`Summarization logged: ${tone}, ${length}, ${contentType}, ${logData.status}`);
  } catch (error) {
    console.error('Error logging summarization request:', error);
  }
}

// Get analytics summary
function getAnalyticsSummary() {
  return {
    toneUsage: analyticsData.toneUsage,
    totalVisits: Object.values(analyticsData.dailyVisits).reduce((sum, count) => sum + count, 0),
    dailyVisits: analyticsData.dailyVisits,
    totalSummarizations: analyticsData.summarizationLogs.length,
    successfulSummarizations: analyticsData.summarizationLogs.filter(log => log.status === 'Success').length,
    lastUpdated: new Date().toISOString()
  };
}

// Helper functions
function extractBrowser(userAgent) {
  if (/Chrome/i.test(userAgent)) return 'Chrome';
  if (/Firefox/i.test(userAgent)) return 'Firefox';
  if (/Safari/i.test(userAgent)) return 'Safari';
  if (/Edge/i.test(userAgent)) return 'Edge';
  if (/Opera/i.test(userAgent)) return 'Opera';
  return 'Other';
}

function hashString(str) {
  let hash = 0;
  if (str.length === 0) return hash.toString();
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString();
}

module.exports = {
  logToneUsage,
  logSiteVisit,
  logSummarizationRequest,
  getAnalyticsSummary,
  createAnalyticsSpreadsheet
};