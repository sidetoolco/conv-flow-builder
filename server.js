require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const { AssemblyAI } = require('assemblyai');
const OpenAI = require('openai');

const app = express();
const port = process.env.PORT || 3000;

const assemblyAI = new AssemblyAI({
  apiKey: process.env.ASSEMBLYAI_API_KEY
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const uploadsDir = path.join('/tmp', 'uploads');
fs.mkdir(uploadsDir, { recursive: true }).catch(console.error);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, '/tmp/uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/webm', 'audio/mp4', 'audio/m4a'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only audio files are allowed.'));
    }
  }
});

app.post('/api/upload', upload.array('audioFiles', 10), async (req, res) => {
  try {
    const transcriptions = [];

    for (const file of req.files) {
      console.log(`Transcribing ${file.filename}...`);

      const transcript = await assemblyAI.transcripts.transcribe({
        audio: file.path,
        speaker_labels: true,
        auto_highlights: true,
        language_detection: true
      });

      await fs.unlink(file.path);

      transcriptions.push({
        filename: file.originalname,
        text: transcript.text,
        utterances: transcript.utterances || [],
        language: transcript.language_code || 'en'
      });
    }

    const flowData = await analyzeConversationFlow(transcriptions);

    res.json({
      success: true,
      transcriptions,
      flowData
    });

  } catch (error) {
    console.error('Error processing files:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

async function analyzeConversationFlow(transcriptions) {
  const allUtterances = transcriptions.flatMap(t => t.utterances);

  const prompt = `Analyze this conversation transcript and create a structured conversation flow for a voice AI agent.

Transcript:
${allUtterances.map(u => `Speaker ${u.speaker}: ${u.text}`).join('\n')}

Please provide:
1. A conversation flow in JSON format with nodes and edges
2. For each node, include:
   - id: unique identifier
   - type: "greeting", "question", "response", "confirmation", "farewell", etc.
   - speaker: who speaks at this node
   - content: what is said
   - prompt: the AI prompt to use at this node for a voice agent
   - nextSteps: array of possible next node ids

Format the response as JSON with structure:
{
  "nodes": [...],
  "edges": [...],
  "prompts": {
    "nodeId": "prompt text"
  }
}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are an expert at analyzing conversations and creating voice agent flows.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' }
    });

    const flowData = JSON.parse(response.choices[0].message.content);

    const mermaidDiagram = generateMermaidDiagram(flowData);

    return {
      ...flowData,
      mermaidDiagram
    };
  } catch (error) {
    console.error('Error analyzing conversation:', error);
    return {
      nodes: [],
      edges: [],
      prompts: {},
      mermaidDiagram: ''
    };
  }
}

function generateMermaidDiagram(flowData) {
  let diagram = 'graph TD\n';

  flowData.nodes.forEach(node => {
    // Escape special characters for Mermaid
    const label = (node.content || '')
      .replace(/"/g, "'")
      .replace(/\n/g, ' ')
      .replace(/[{}]/g, '')
      .trim();

    const truncatedLabel = label.length > 50
      ? label.substring(0, 47) + '...'
      : label;

    // Use safe node ID
    const nodeId = node.id.replace(/[^a-zA-Z0-9_]/g, '_');

    const shape = node.type === 'question' ?
                  `${nodeId}[?${truncatedLabel}?]` :
                  node.type === 'greeting' || node.type === 'farewell' ?
                  `${nodeId}((${truncatedLabel}))` :
                  `${nodeId}[${truncatedLabel}]`;

    diagram += `    ${shape}\n`;
  });

  flowData.edges.forEach(edge => {
    const fromId = edge.from.replace(/[^a-zA-Z0-9_]/g, '_');
    const toId = edge.to.replace(/[^a-zA-Z0-9_]/g, '_');
    diagram += `    ${fromId} --> ${toId}\n`;
  });

  return diagram;
}

if (process.env.VERCEL) {
  module.exports = app;
} else {
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}