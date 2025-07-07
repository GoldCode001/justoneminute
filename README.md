# just one minute

A beautiful web application that summarizes Twitter threads using AI. Built with Node.js, Express, TypeScript, and OpenRouter AI.

## Features

- 🧵 **Thread Extraction**: Fetches complete Twitter threads from any tweet URL
- 🤖 **AI Summarization**: Uses OpenRouter's GPT-3.5 Turbo for intelligent summaries
- 🎨 **Beautiful UI**: Dark brown theme with smooth interactions
- ⚡ **Fast & Responsive**: Built with modern web technologies
- 🔒 **Secure**: API keys stored in environment variables

## Quick Start

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Set up environment variables**:
   - Copy `.env` file and add your API keys:
   ```bash
   cp .env .env.local
   ```
   - Get your OpenRouter API key from https://openrouter.ai/keys
   - Get your Twitter Bearer Token from https://developer.twitter.com/en/portal/dashboard

3. **Build and run**:
   ```bash
   npm run build
   npm start
   ```

4. **For development**:
   ```bash
   npm run dev
   ```

## API Endpoints

- `GET /` - Main web interface
- `POST /summarize` - Summarize a thread
  ```json
  {
    "threadUrl": "https://twitter.com/username/status/1234567890",
    "length": "3 sentences",
    "tone": "professional"
  }
  ```

## Technologies Used

- **Backend**: Node.js, Express, TypeScript
- **AI**: OpenRouter (GPT-3.5 Turbo)
- **Twitter API**: twitter-api-v2
- **Frontend**: Vanilla HTML/CSS/JavaScript

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `OPENROUTER_API_KEY` | Your OpenRouter API key | Yes |
| `TWITTER_BEARER_TOKEN` | Your Twitter Bearer Token | Yes |
| `PORT` | Server port (default: 3000) | No |

## License

MIT License