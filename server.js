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
    const allowedMimes = [
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/x-wav',  // Some systems report WAV files as x-wav
      'audio/wave',    // Alternative WAV mime type
      'audio/webm',
      'audio/mp4',
      'audio/m4a',
      'audio/ogg',
      'audio/flac'
    ];

    console.log(`File upload attempted: ${file.originalname}, MIME: ${file.mimetype}`);

    // Also check file extension as fallback
    const allowedExtensions = ['.mp3', '.wav', '.m4a', '.mp4', '.webm', '.ogg', '.flac'];
    const fileExtension = path.extname(file.originalname).toLowerCase();

    if (allowedMimes.includes(file.mimetype) || allowedExtensions.includes(fileExtension)) {
      console.log('File accepted for upload');
      cb(null, true);
    } else {
      console.log(`File rejected: Invalid type - ${file.mimetype}, extension: ${fileExtension}`);
      cb(new Error(`Invalid file type. Only audio files are allowed. Received: ${file.mimetype}`));
    }
  },
  limits: {
    fileSize: 100 * 1024 * 1024  // 100MB limit
  }
});

app.post('/api/upload', upload.array('audioFiles', 10), async (req, res) => {
  try {
    console.log('Upload request received');
    console.log('Files received:', req.files?.length || 0);

    if (!req.files || req.files.length === 0) {
      throw new Error('No files received in upload request');
    }

    const transcriptions = [];

    for (const file of req.files) {
      console.log(`Processing file: ${file.filename}`);
      console.log(`File details:`, {
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        path: file.path
      });

      // Upload and transcribe the audio file
      console.log(`Starting transcription for ${file.filename}...`);

      try {
        // First, upload the file to AssemblyAI
        console.log('Uploading to AssemblyAI...');
        const uploadedFile = await assemblyAI.files.upload(file.path);
        console.log('File uploaded successfully:', uploadedFile.upload_url);
      } catch (uploadError) {
        console.error('AssemblyAI upload error:', uploadError);
        throw new Error(`Failed to upload file to AssemblyAI: ${uploadError.message}`);
      }

      const transcript = await assemblyAI.transcripts.transcribe({
        audio_url: uploadedFile.upload_url,  // Use the uploaded URL
        speaker_labels: true,
        speakers_expected: 2,
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
    console.error('Detailed error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.toString()
    });
  }
});

async function analyzeConversationFlow(transcriptions) {
  // Check if we have utterances with speaker labels
  const allUtterances = transcriptions.flatMap(t => t.utterances || []);

  let transcriptText = '';
  let hasSpeakerSeparation = false;

  if (allUtterances.length > 0) {
    // Check if we have actual speaker separation (not all same speaker)
    const uniqueSpeakers = new Set(allUtterances.map(u => u.speaker));
    hasSpeakerSeparation = uniqueSpeakers.size > 1;

    if (hasSpeakerSeparation) {
      transcriptText = allUtterances.map(u => `Speaker ${u.speaker}: ${u.text}`).join('\n');
      console.log('Using speaker-separated utterances:', allUtterances.length, 'speakers:', uniqueSpeakers.size);
    } else {
      // All same speaker - need to infer conversation structure
      transcriptText = transcriptions.map(t => t.text).join('\n\n');
      console.log('Single speaker detected, will infer conversation structure from content');
    }
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

  // If no speaker separation, try to split the conversation manually
  if (!hasSpeakerSeparation && transcriptText) {
    const sentences = transcriptText
      .split(/[.?!]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (sentences.length > 0) {
      // Reconstruct with inferred speakers based on patterns
      const inferredConversation = sentences.map((sentence, index) => {
        // Common agent patterns (Spanish and English)
        const agentPatterns = [
          /hablo de parte de/i,
          /me comunico con/i,
          /le llamo por/i,
          /dejar[é|e] registro/i,
          /necesita ayuda/i,
          /puede realizar/i,
          /calling from/i,
          /this is.*from/i,
          /can help you/i
        ];

        // Common customer patterns
        const customerPatterns = [
          /s[í|i] se[ñ|n]orita/i,
          /s[í|i] se[ñ|n]or/i,
          /un gusto/i,
          /okay/i,
          /yes/i,
          /no problem/i
        ];

        const isAgent = agentPatterns.some(pattern => pattern.test(sentence));
        const isCustomer = customerPatterns.some(pattern => pattern.test(sentence));

        // Default to alternating if unclear
        const speaker = isAgent ? 'Agent' : isCustomer ? 'Customer' : (index % 2 === 0 ? 'Agent' : 'Customer');

        return `${speaker}: ${sentence}`;
      }).join('\n');

      transcriptText = inferredConversation;
      console.log('Inferred conversation structure from content patterns');
    }
  }

  const prompt = `Analyze this conversation transcript and create a structured conversation flow for a voice AI agent.

${!hasSpeakerSeparation ? 'NOTE: This transcript does not have speaker separation. Please analyze the content to identify conversation turns between agent and customer based on context clues like greetings, questions, confirmations, etc.' : ''}

Transcript:
${transcriptText}

Based on this transcript, identify the conversation flow. Look for:
- Greetings ("Buen día", "Hello")
- Agent identification ("hablo de parte de...")
- Customer responses ("Sí señorita")
- Payment discussions ("pago de su crédito")
- Confirmations and closings

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
      model: 'gpt-4-turbo-preview',  // Using GPT-4 Turbo - latest available model
      messages: [
        { role: 'system', content: 'You are an expert at analyzing conversations and creating voice agent flows. You excel at understanding context, identifying speakers, and creating structured conversation flows for voice AI agents.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3  // Lower temperature for more consistent output
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