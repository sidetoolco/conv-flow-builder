# Conversation Flow Builder

A tool to convert conversation recordings into structured flow diagrams for voice AI agents. Upload audio conversations, get them transcribed via AssemblyAI, and automatically generate Mermaid flow diagrams with prompts for each conversation node. Now with Supabase integration for persistent storage of flows and audio files!

## Features

- Upload multiple audio files (MP3, WAV, M4A, etc.)
- Automatic transcription with speaker diarization using AssemblyAI
- AI-powered conversation flow analysis using OpenAI GPT-4
- Interactive Mermaid flow diagrams
- Export voice agent prompts in JSON format
- Export flow diagrams in Mermaid format

## Setup

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file based on `.env.example`:
   ```
   ASSEMBLYAI_API_KEY=your_assemblyai_api_key
   OPENAI_API_KEY=your_openai_api_key
   PORT=3000
   ```

4. Get your API keys:
   - AssemblyAI: https://www.assemblyai.com/
   - OpenAI: https://platform.openai.com/

## Usage

1. Start the server:
   ```bash
   npm start
   ```
   Or for development with auto-reload:
   ```bash
   npm run dev
   ```

2. Open http://localhost:3000 in your browser

3. Upload one or more conversation audio files

4. View the generated:
   - Flow diagram showing conversation structure
   - Voice agent prompts for each node
   - Full transcript with speaker labels

5. Export the flow diagram and prompts for use in your voice AI agent

## How It Works

1. **Audio Upload**: Upload conversation recordings through the web interface
2. **Transcription**: AssemblyAI transcribes audio with speaker diarization
3. **Flow Analysis**: OpenAI GPT-4 analyzes the conversation to identify:
   - Conversation nodes (greetings, questions, responses, etc.)
   - Flow connections between nodes
   - Appropriate prompts for voice agents at each node
4. **Visualization**: Mermaid renders the flow as an interactive diagram
5. **Export**: Download prompts and flow structure for implementation

## Output Format

The tool generates:
- **Mermaid Diagram**: Visual flow representation
- **JSON Prompts**: Structured data with:
  - Node IDs and types
  - Content for each conversation step
  - AI prompts for voice agent responses
  - Flow connections (edges)

## Requirements

- Node.js 14+
- AssemblyAI API key
- OpenAI API key (GPT-4 access)