const { google } = require('googleapis');

// Google Sheets configuration
const SPREADSHEET_ID = '1YGkvO9kyzUY24H4rZnySfIXKkVVjQM7hWmxEwhSQx3I';

// Initialize Google Sheets API
async function getGoogleSheetsClient() {
  try {
    // Use service account credentials from environment variables
    const credentials = {
      type: 'service_account',
      project_id: process.env.GOOGLE_PROJECT_ID,
      private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      client_id: process.env.GOOGLE_CLIENT_ID,
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token',
      auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
      client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${process.env.GOOGLE_CLIENT_EMAIL}`
    };

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    return google.sheets({ version: 'v4', auth });
  } catch (error) {
    console.error('Error initializing Google Sheets client:', error);
    throw error;
  }
}

// Log tone usage
async function logToneUsage(tone) {
  try {
    console.log(`Attempting to log tone usage: ${tone}`);
    const sheets = await getGoogleSheetsClient();
    const now = new Date();
    const timestamp = now.toISOString();
    const date = now.toISOString().split('T')[0]; // YYYY-MM-DD format

    // First, try to find if there's already an entry for today and this tone
    let response;
    try {
      response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'ToneUsage!A:D'
      });
    } catch (error) {
      console.error('Error reading ToneUsage sheet:', error);
      // Try to initialize the sheet first
      await initializeSheets();
      response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'ToneUsage!A:D'
      });
    }

    const rows = response.data.values || [];
    let existingRowIndex = -1;

    // Look for existing entry for today and this tone
    for (let i = 1; i < rows.length; i++) { // Skip header row
      if (rows[i][0] === date && rows[i][1] === tone) {
        existingRowIndex = i + 1; // +1 because sheets are 1-indexed
        break;
      }
    }

    if (existingRowIndex > 0) {
      // Update existing entry
      const currentCount = parseInt(rows[existingRowIndex - 1][2]) || 0;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `ToneUsage!C${existingRowIndex}:D${existingRowIndex}`,
        valueInputOption: 'RAW',
        resource: {
          values: [[currentCount + 1, timestamp]]
        }
      });
    } else {
      // Add new entry
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'ToneUsage!A:D',
        valueInputOption: 'RAW',
        resource: {
          values: [[date, tone, 1, timestamp]]
        }
      });
    }

    console.log(`Successfully logged tone usage: ${tone} on ${date}`);
  } catch (error) {
    console.error('Error logging tone usage:', error.message, error.stack);
    // Don't throw error to avoid breaking the main functionality
  }
}

// Log site visit
async function logSiteVisit(userAgent = '', ip = '') {
  try {
    console.log('Attempting to log site visit');
    const sheets = await getGoogleSheetsClient();
    const now = new Date();
    const timestamp = now.toISOString();
    const date = now.toISOString().split('T')[0];

    // Extract basic info from user agent
    const isMobile = /Mobile|Android|iPhone|iPad/i.test(userAgent);
    const browser = extractBrowser(userAgent);
    
    // Hash IP for privacy (simple hash)
    const hashedIP = hashString(ip);

    // Log individual visit
    try {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'SiteVisits!A:F',
        valueInputOption: 'RAW',
        resource: {
          values: [[timestamp, date, hashedIP, browser, isMobile ? 'Mobile' : 'Desktop', userAgent.substring(0, 200)]]
        }
      });
    } catch (error) {
      console.error('Error writing to SiteVisits sheet:', error);
      // Try to initialize sheets first
      await initializeSheets();
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'SiteVisits!A:F',
        valueInputOption: 'RAW',
        resource: {
          values: [[timestamp, date, hashedIP, browser, isMobile ? 'Mobile' : 'Desktop', userAgent.substring(0, 200)]]
        }
      });
    }

    // Update daily summary
    let response;
    try {
      response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'DailySummary!A:C'
      });
    } catch (error) {
      console.error('Error reading DailySummary sheet:', error);
      await initializeSheets();
      response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'DailySummary!A:C'
      });
    }

    const rows = response.data.values || [];
    let existingRowIndex = -1;

    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === date) {
        existingRowIndex = i + 1;
        break;
      }
    }

    if (existingRowIndex > 0) {
      const currentCount = parseInt(rows[existingRowIndex - 1][1]) || 0;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `DailySummary!B${existingRowIndex}:C${existingRowIndex}`,
        valueInputOption: 'RAW',
        resource: {
          values: [[currentCount + 1, timestamp]]
        }
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'DailySummary!A:C',
        valueInputOption: 'RAW',
        resource: {
          values: [[date, 1, timestamp]]
        }
      });
    }

    console.log(`Successfully logged site visit on ${date}`);
  } catch (error) {
    console.error('Error logging site visit:', error.message, error.stack);
  }
}

// Log summarization request
async function logSummarizationRequest(tone, length, contentType, success = true) {
  try {
    console.log(`Attempting to log summarization: ${tone}, ${length}, ${contentType}, ${success}`);
    const sheets = await getGoogleSheetsClient();
    const now = new Date();
    const timestamp = now.toISOString();
    const date = now.toISOString().split('T')[0];

    try {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'SummarizationLogs!A:F',
        valueInputOption: 'RAW',
        resource: {
          values: [[timestamp, date, tone, length, contentType, success ? 'Success' : 'Failed']]
        }
      });
    } catch (error) {
      console.error('Error writing to SummarizationLogs sheet:', error);
      await initializeSheets();
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'SummarizationLogs!A:F',
        valueInputOption: 'RAW',
        resource: {
          values: [[timestamp, date, tone, length, contentType, success ? 'Success' : 'Failed']]
        }
      });
    }

    console.log(`Successfully logged summarization request: ${tone}, ${length}, ${contentType}, ${success ? 'Success' : 'Failed'}`);
  } catch (error) {
    console.error('Error logging summarization request:', error.message, error.stack);
  }
}

// Helper function to extract browser from user agent
function extractBrowser(userAgent) {
  if (/Chrome/i.test(userAgent)) return 'Chrome';
  if (/Firefox/i.test(userAgent)) return 'Firefox';
  if (/Safari/i.test(userAgent)) return 'Safari';
  if (/Edge/i.test(userAgent)) return 'Edge';
  if (/Opera/i.test(userAgent)) return 'Opera';
  return 'Other';
}

// Simple hash function for privacy
function hashString(str) {
  let hash = 0;
  if (str.length === 0) return hash.toString();
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString();
}

// Initialize sheets with headers if they don't exist
async function initializeSheets() {
  try {
    const sheets = await getGoogleSheetsClient();
    
    // Check if sheets exist and create headers if needed
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
      try {
        // Try to get the first row to see if headers exist
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: `${config.name}!A1:Z1`
        });

        if (!response.data.values || response.data.values.length === 0) {
          // Add headers
          await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${config.name}!A1`,
            valueInputOption: 'RAW',
            resource: {
              values: [config.headers]
            }
          });
          console.log(`Initialized ${config.name} sheet with headers`);
        }
      } catch (error) {
        console.log(`Sheet ${config.name} might not exist, skipping initialization`);
      }
    }
  } catch (error) {
    console.error('Error initializing sheets:', error);
  }
}

module.exports = {
  logToneUsage,
  logSiteVisit,
  logSummarizationRequest,
  initializeSheets
};