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

      // Upload and transcribe the audio file
      console.log(`Starting transcription for ${file.filename}...`);

      const transcript = await assemblyAI.transcripts.transcribe({
        audio: file.path,
        speaker_labels: true,
        language_detection: true
      });

      // Poll for completion
      let completedTranscript = transcript;
      while (completedTranscript.status !== 'completed' && completedTranscript.status !== 'error') {
        console.log('Transcript status:', completedTranscript.status);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
        completedTranscript = await assemblyAI.transcripts.get(transcript.id);
      }

      if (completedTranscript.status === 'error') {
        console.error('Transcription error:', completedTranscript.error);
        throw new Error(`Transcription failed: ${completedTranscript.error}`);
      }

      console.log('Transcript completed');
      console.log('Utterances count:', completedTranscript.utterances?.length || 0);

      const finalTranscript = completedTranscript;

      await fs.unlink(file.path);

      transcriptions.push({
        filename: file.originalname,
        text: finalTranscript.text,
        utterances: finalTranscript.utterances || [],
        language: finalTranscript.language_code || 'en'
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
  // Check if we have utterances with speaker labels
  const allUtterances = transcriptions.flatMap(t => t.utterances || []);

  let transcriptText = '';

  if (allUtterances.length > 0) {
    // We have speaker-separated utterances
    transcriptText = allUtterances.map(u => `Speaker ${u.speaker}: ${u.text}`).join('\n');
    console.log('Using speaker-separated utterances:', allUtterances.length);
  } else {
    // Fallback to full text if no utterances
    transcriptText = transcriptions.map(t => t.text).join('\n\n');
    console.log('No utterances found, using full text');
  }

  if (!transcriptText) {
    console.error('No transcript text available');
    return {
      nodes: [],
      edges: [],
      prompts: {},
      mermaidDiagram: 'graph TD\n    Start[No transcript available]'
    };
  }

  const prompt = `Analyze this conversation transcript and create a structured conversation flow for a voice AI agent.

Transcript:
${transcriptText}

Important: If the transcript appears to be a single block of text without clear speaker separation, try to identify the conversation flow based on the content (questions, responses, greetings, etc.).

Please provide:
1. A conversation flow in JSON format with nodes and edges
2. For each node, include:
   - id: unique identifier (use simple IDs like "node1", "node2", etc.)
   - type: "greeting", "question", "response", "confirmation", "farewell", etc.
   - speaker: "agent" or "customer" (infer from context if not labeled)
   - content: what is said (keep it concise, under 40 characters)
   - prompt: the AI prompt to use at this node for a voice agent

3. For edges, use format: {"from": "node1", "to": "node2"}

IMPORTANT: Create at least 3-5 nodes based on the conversation structure, even if it's a continuous text.

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

    console.log('Generated flow data:', JSON.stringify(flowData, null, 2));

    const mermaidDiagram = generateMermaidDiagram(flowData);

    console.log('Generated Mermaid diagram:', mermaidDiagram);

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
      return 'graph TD\n    Start[Start]';
    }

    // If no nodes, return simple diagram
    if (flowData.nodes.length === 0) {
      return 'graph TD\n    Start[Start]';
    }

    let diagram = 'graph TD\n';
    const nodeMap = new Map();
    const validNodes = [];

    // First pass: create valid node IDs and filter valid nodes
    flowData.nodes.forEach((node, index) => {
      if (!node || !node.id) {
        return;
      }

      // Create simple, safe node ID
      const safeId = `N${index}`;
      nodeMap.set(node.id, safeId);
      validNodes.push({ ...node, safeId });
    });

    // Second pass: add nodes to diagram
    validNodes.forEach(node => {
      // Clean and escape label text - be very conservative
      let label = (node.content || 'Node')
        .toString()
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/['"]/g, '')
        .replace(/[`~!@#$%^&*()+={}[\]|\\:;<>?,./]/g, '')
        .trim();

      // Truncate if too long
      if (label.length > 40) {
        label = label.substring(0, 37) + '...';
      }

      // Ensure label is not empty
      if (!label) {
        label = 'Node';
      }

      // Use only square brackets for all nodes (safest option)
      diagram += `    ${node.safeId}[${label}]\n`;
    });

    // Third pass: add edges
    if (flowData.edges && Array.isArray(flowData.edges)) {
      flowData.edges.forEach(edge => {
        if (!edge || !edge.from || !edge.to) {
          return;
        }

        const fromId = nodeMap.get(edge.from);
        const toId = nodeMap.get(edge.to);

        if (fromId && toId) {
          diagram += `    ${fromId} --> ${toId}\n`;
        }
      });
    }

    // If no valid nodes were added, add a default
    if (validNodes.length === 0) {
      diagram = 'graph TD\n    Start[Start]';
    }

    console.log('Generated Mermaid diagram:', diagram);
    return diagram;
  } catch (error) {
    console.error('Error generating Mermaid diagram:', error);
    return 'graph TD\n    Error[Error]';
  }
}

if (process.env.VERCEL) {
  module.exports = app;
} else {
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}