# Deployment Guide

## Local Development
The app is currently running locally. To deploy to production, you have several options:

## Deployment Options

### 1. Deploy to Vercel (Recommended for Node.js apps)

1. Install Vercel CLI:
   ```bash
   npm i -g vercel
   ```

2. Deploy:
   ```bash
   vercel
   ```

3. Add environment variables in Vercel dashboard:
   - `ASSEMBLYAI_API_KEY`
   - `OPENAI_API_KEY`

### 2. Deploy to Render

1. Connect your GitHub repository to Render
2. Set build command: `npm install`
3. Set start command: `npm start`
4. Add environment variables in Render dashboard

### 3. Deploy to Heroku

1. Create `Procfile`:
   ```
   web: node server.js
   ```

2. Deploy:
   ```bash
   heroku create conv-flow-builder
   git push heroku main
   heroku config:set ASSEMBLYAI_API_KEY=your_key
   heroku config:set OPENAI_API_KEY=your_key
   ```

### 4. Deploy to Railway

1. Connect GitHub repository to Railway
2. Railway will auto-detect Node.js app
3. Add environment variables in Railway dashboard

## Security Notes

⚠️ **IMPORTANT**: Never commit `.env` file with real API keys to GitHub
- The `.env` file is already in `.gitignore`
- Use environment variables in your deployment platform
- Rotate API keys if accidentally exposed

## GitHub Repository

Your code is now available at: https://github.com/sidetoolco/conv-flow-builder

To clone and run locally:
```bash
git clone https://github.com/sidetoolco/conv-flow-builder.git
cd conv-flow-builder
npm install
# Create .env file with your API keys
npm start
```