# Deployment Instructions for Vercel

## Environment Variables Required

You MUST add these environment variables in your Vercel project settings:

1. Go to your Vercel Dashboard
2. Select your `conv-flow-builder` project
3. Go to Settings → Environment Variables
4. Add these variables:

```
ASSEMBLYAI_API_KEY=d2f57d7b5405450d8c6cd3dd8763253a
OPENAI_API_KEY=[Your OpenAI API Key starting with sk-proj-...]
```

## Important Notes

- The OpenAI API key must be valid and have access to GPT-4 or GPT-3.5
- If you're getting "Token R" errors, it means the OpenAI API key is invalid or not set in Vercel
- Maximum file sizes: 25MB per file, 40MB total

## Testing Your API Keys

You can test if your API keys work by running locally:
```bash
npm start
```

Then try uploading a small audio file (under 5MB) to test.

## Common Issues

1. **413 Request Entity Too Large**: Files are too big. Keep under 25MB each.
2. **Token R error**: OpenAI API key is missing or invalid in Vercel environment variables.
3. **No deployment triggered**: Push a new commit to trigger deployment.