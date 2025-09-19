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
   - id: unique identifier (use simple alphanumeric IDs like "node1", "node2", etc.)
   - type: "greeting", "question", "response", "confirmation", "farewell", etc.
   - speaker: who speaks at this node
   - content: what is said (keep it concise, under 50 characters)
   - prompt: the AI prompt to use at this node for a voice agent
   - nextSteps: array of possible next node ids

3. For edges, use format: {"from": "node1", "to": "node2"}

Format the response as JSON with structure:
{
  "nodes": [...],
  "edges": [...],
  "prompts": {
    "node1": "prompt text",
    "node2": "prompt text"
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
  try {
    // Validate input data
    if (!flowData || !flowData.nodes || !Array.isArray(flowData.nodes)) {
      console.error('Invalid flow data structure');
      return 'graph TD\n    Start[No data available]';
    }

    let diagram = 'graph TD\n';
    const processedNodes = new Set();

    // Process nodes
    flowData.nodes.forEach((node, index) => {
      if (!node || !node.id) {
        console.warn('Skipping invalid node:', node);
        return;
      }

      // Create safe node ID - must start with letter, use index as fallback
      const nodeId = node.id.toString()
        .replace(/[^a-zA-Z0-9]/g, '_')
        .replace(/^[^a-zA-Z]/, 'N');

      // Fallback to index-based ID if needed
      const safeNodeId = nodeId || `node_${index}`;

      // Skip duplicate nodes
      if (processedNodes.has(safeNodeId)) {
        return;
      }
      processedNodes.add(safeNodeId);

      // Escape and clean label text
      const content = (node.content || 'Empty')
        .replace(/[\r\n]+/g, ' ')
        .replace(/"/g, "'")
        .replace(/`/g, "'")
        .replace(/\[/g, '(')
        .replace(/\]/g, ')')
        .replace(/[{}]/g, '')
        .replace(/[<>]/g, '')
        .trim();

      const truncatedLabel = content.length > 45
        ? content.substring(0, 42) + '...'
        : content;

      // Use simple shapes to avoid syntax issues
      let shape;
      if (node.type === 'greeting' || node.type === 'farewell') {
        shape = `${safeNodeId}("${truncatedLabel}")`;
      } else if (node.type === 'question') {
        shape = `${safeNodeId}{"${truncatedLabel}"}`;
      } else {
        shape = `${safeNodeId}["${truncatedLabel}"]`;
      }

      diagram += `    ${shape}\n`;
    });

    // Process edges
    if (flowData.edges && Array.isArray(flowData.edges)) {
      flowData.edges.forEach(edge => {
        if (!edge || !edge.from || !edge.to) {
          console.warn('Skipping invalid edge:', edge);
          return;
        }

        const fromId = edge.from.toString()
          .replace(/[^a-zA-Z0-9]/g, '_')
          .replace(/^[^a-zA-Z]/, 'N');
        const toId = edge.to.toString()
          .replace(/[^a-zA-Z0-9]/g, '_')
          .replace(/^[^a-zA-Z]/, 'N');

        // Only add edge if both nodes exist
        if (processedNodes.has(fromId) && processedNodes.has(toId)) {
          diagram += `    ${fromId} --> ${toId}\n`;
        }
      });
    }

    // Add a default node if diagram is empty
    if (processedNodes.size === 0) {
      diagram += '    Start[Start Conversation]\n';
    }

    return diagram;
  } catch (error) {
    console.error('Error generating Mermaid diagram:', error);
    return 'graph TD\n    Error[Error generating diagram]';
  }
}

if (process.env.VERCEL) {
  module.exports = app;
} else {
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}