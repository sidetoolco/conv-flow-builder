require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const { AssemblyAI } = require('assemblyai');
const OpenAI = require('openai');
const {
  storeConversationFlow,
  uploadAudioFile,
  getConversationFlows,
  getConversationFlow,
  ensureStorageBucket
} = require('./lib/supabase');
// Updated with Supabase integration for persistent storage

const app = express();
const port = process.env.PORT || 3000;

// Validate required environment variables
const requiredEnvVars = ['ASSEMBLYAI_API_KEY', 'OPENAI_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error('ERROR: Missing required environment variables:', missingEnvVars.join(', '));
  console.error('Please copy .env.example to .env and fill in your API keys');
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

const assemblyAI = new AssemblyAI({
  apiKey: process.env.ASSEMBLYAI_API_KEY || 'dummy_key_for_development'
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'dummy_key_for_development'
});

// Configure middleware with proper order
app.use(cors());

// Increase payload limits for large audio files
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use(express.static('public'));

// Test endpoint to check environment variables
app.get('/api/test', (req, res) => {
  res.json({
    assemblyAI: process.env.ASSEMBLYAI_API_KEY ? 'Set' : 'Missing',
    openAI: process.env.OPENAI_API_KEY ? 'Set' : 'Missing',
    openAIKeyStart: process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.substring(0, 10) : 'Not set',
    supabase: process.env.SUPABASE_URL ? 'Set' : 'Missing',
    environment: process.env.NODE_ENV || 'development',
    serverTime: new Date().toISOString()
  });
});

// API endpoint to get all saved conversation flows
app.get('/api/flows', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const result = await getConversationFlows(limit);

    if (result.success) {
      res.json({
        success: true,
        flows: result.flows
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('Error fetching flows:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API endpoint to get a single conversation flow with details
app.get('/api/flows/:id', async (req, res) => {
  try {
    const flowId = req.params.id;
    const result = await getConversationFlow(flowId);

    if (result.success) {
      res.json({
        success: true,
        flow: result.flow
      });
    } else {
      res.status(404).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('Error fetching flow:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

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
    fileSize: 50 * 1024 * 1024,  // 50MB per file
    fieldSize: 50 * 1024 * 1024,  // 50MB field size
    files: 10  // Max 10 files
  }
});

app.post('/api/upload', upload.array('audioFiles', 10), async (req, res) => {
  try {
    // Validate API keys before processing
    if (!process.env.ASSEMBLYAI_API_KEY || process.env.ASSEMBLYAI_API_KEY === 'your_assemblyai_api_key_here') {
      throw new Error('AssemblyAI API key is not configured. Please set ASSEMBLYAI_API_KEY in your .env file');
    }
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_openai_api_key_here') {
      throw new Error('OpenAI API key is not configured. Please set OPENAI_API_KEY in your .env file');
    }

    console.log('Upload request received');
    console.log('Files received:', req.files?.length || 0);

    if (!req.files || req.files.length === 0) {
      throw new Error('No files received in upload request');
    }

    // Ensure storage bucket exists
    await ensureStorageBucket();

    const transcriptions = [];
    const audioFileData = [];

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

      let uploadUrl;
      try {
        // First, upload the file to AssemblyAI
        console.log('Uploading to AssemblyAI...');
        const uploadResponse = await assemblyAI.files.upload(file.path);
        console.log('Upload response:', uploadResponse);

        // The upload response should have an upload_url property
        uploadUrl = uploadResponse.upload_url || uploadResponse;

        if (!uploadUrl) {
          throw new Error('No upload URL received from AssemblyAI');
        }

        console.log('File uploaded successfully, URL:', uploadUrl);
      } catch (uploadError) {
        console.error('AssemblyAI upload error:', uploadError);
        throw new Error(`Failed to upload file to AssemblyAI: ${uploadError.message}`);
      }

      const transcriptData = {
        audio_url: uploadUrl,  // Use the uploaded URL
        speaker_labels: true,
        speakers_expected: 2,
        language_detection: true
      };

      console.log('Creating transcript with data:', transcriptData);
      const transcript = await assemblyAI.transcripts.transcribe(transcriptData);

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

      // Keep file data for Supabase upload
      audioFileData.push({
        path: file.path,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size
      });

      transcriptions.push({
        filename: file.originalname,
        text: finalTranscript.text,
        utterances: finalTranscript.utterances || [],
        language: finalTranscript.language_code || 'en'
      });
    }

    const flowData = await analyzeConversationFlow(transcriptions);

    // Store the conversation flow in Supabase
    const storeResult = await storeConversationFlow(
      flowData,
      transcriptions,
      flowData.mermaidDiagram
    );

    // Upload audio files to Supabase Storage
    if (storeResult.success && storeResult.flowId) {
      for (const audioFile of audioFileData) {
        await uploadAudioFile(audioFile, storeResult.flowId);
        // Clean up temp file after upload
        await fs.unlink(audioFile.path);
      }
    } else {
      // Clean up temp files even if storage failed
      for (const audioFile of audioFileData) {
        await fs.unlink(audioFile.path);
      }
    }

    res.json({
      success: true,
      transcriptions,
      flowData,
      flowId: storeResult.flowId || null,
      storageResult: storeResult
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
  let transcriptText = '';
  let hasSpeakerSeparation = false;

  try {
    console.log('Analyzing conversation flow for', transcriptions.length, 'transcription(s)');

    // Check if we have utterances with speaker labels
    const allUtterances = transcriptions.flatMap(t => t.utterances || []);

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

    console.log('Transcript text length:', transcriptText.length, 'characters');
  } catch (prepError) {
    console.error('Error preparing transcript text:', prepError);
    return {
      nodes: [],
      edges: [],
      prompts: {},
      mermaidDiagram: 'graph TD\n    Error[Error preparing transcript]'
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

  const prompt = `Analyze this conversation transcript and create a comprehensive voice AI agent blueprint with detailed conversation flow.

${!hasSpeakerSeparation ? 'NOTE: This transcript does not have speaker separation. Please analyze the content to identify conversation turns between agent and customer based on context clues like greetings, questions, confirmations, etc.' : ''}

Transcript:
${transcriptText}

Create a DETAILED voice AI agent blueprint. For each conversation node:

1. Extract the EXACT agent behavior and speaking patterns
2. Include decision logic and branching based on customer responses
3. Capture tone, pauses, and conversation tactics
4. Include error handling and fallback responses

Provide a JSON structure with:

"nodes": [
  {
    "id": "node1",
    "type": "greeting"/"question"/"confirmation"/"decision"/"farewell",
    "speaker": "agent"/"customer",
    "content": "Brief description (max 30 chars)",
    "fullPrompt": "Complete voice agent instruction including: What to say, how to say it, what to listen for, and next actions",
    "examples": ["Example phrases the agent should use"],
    "listenFor": ["Keywords or patterns to detect in customer response"],
    "nextActions": {
      "positive": "nodeX",
      "negative": "nodeY",
      "unclear": "nodeZ"
    },
    "timeout": seconds to wait for response,
    "retryPrompt": "What to say if no response"
  }
],
"edges": [
  {"from": "node1", "to": "node2", "condition": "when customer says yes/agrees"}
],
"globalInstructions": "Overall agent personality and behavior guidelines",
"errorHandling": "What to do when conversation goes off-script"

IMPORTANT:
- Create comprehensive nodes that capture the FULL conversation logic
- Include at least 5-10 nodes to represent the complete flow
- Each node's fullPrompt should be self-contained instructions for the voice AI
- Include decision branches and error handling
- Extract actual phrases and patterns from the transcript`;

  try {
    console.log('Sending request to OpenAI...');
    console.log('Prompt length:', prompt.length, 'characters');

    let response;
    try {
      // Try GPT-4 first (without json_object format which might cause issues)
      response = await openai.chat.completions.create({
        model: 'gpt-4-0125-preview',  // Using GPT-4 Turbo latest stable version
        messages: [
          { role: 'system', content: 'You are an expert voice AI agent designer. You must respond ONLY with valid JSON, no other text.' },
          { role: 'user', content: prompt + '\n\nRemember: Respond ONLY with valid JSON.' }
        ],
        temperature: 0.3,  // Lower temperature for more consistent output
        max_tokens: 4000  // Ensure we have enough tokens for response
      });
      console.log('GPT-4 response received successfully');
    } catch (gpt4Error) {
      console.error('GPT-4 failed, trying GPT-3.5:', gpt4Error.message);

      // Fallback to GPT-3.5
      try {
        response = await openai.chat.completions.create({
          model: 'gpt-3.5-turbo',  // Use standard GPT-3.5
          messages: [
            { role: 'system', content: 'You are an expert at analyzing conversations. Respond ONLY with valid JSON.' },
            { role: 'user', content: prompt.substring(0, 3000) + '\n\nRespond ONLY with valid JSON.' }  // Shorter prompt for GPT-3.5
          ],
          temperature: 0.3,
          max_tokens: 2000
        });
        console.log('GPT-3.5 fallback successful');
      } catch (gpt35Error) {
        console.error('Both GPT-4 and GPT-3.5 failed');
        console.error('GPT-3.5 error:', gpt35Error.message);
        console.error('Error response:', gpt35Error.response?.data);
        console.error('Error status:', gpt35Error.response?.status);

        // Log the API key status for debugging (safely)
        const apiKeySet = !!process.env.OPENAI_API_KEY;
        const keyPrefix = process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.substring(0, 10) : 'Not set';
        console.error('OpenAI API Key configured:', apiKeySet, 'Prefix:', keyPrefix);

        throw gpt35Error;
      }
    }

    // Check if we got a valid response
    if (!response || !response.choices || !response.choices[0] || !response.choices[0].message) {
      console.error('Invalid OpenAI response structure:', response);
      throw new Error('Invalid response from OpenAI API');
    }

    const messageContent = response.choices[0].message.content;
    console.log('OpenAI response received, length:', messageContent?.length || 0);

    // Try to parse the JSON response
    let flowData;
    try {
      flowData = JSON.parse(messageContent);
    } catch (parseError) {
      console.error('Failed to parse OpenAI response as JSON.');
      console.error('First 500 chars of response:', messageContent?.substring(0, 500));
      console.error('Parse error:', parseError.message);

      // Try to extract JSON from the response if it's wrapped in text
      const jsonMatch = messageContent?.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          flowData = JSON.parse(jsonMatch[0]);
          console.log('Successfully extracted JSON from response');
        } catch (secondParseError) {
          console.error('Failed to extract JSON from response:', secondParseError.message);
        }
      }

      // If still no valid data, return a fallback flow
      if (!flowData) {
        // Return a fallback flow if parsing fails
        return {
        nodes: [
          {
            id: 'node1',
            type: 'greeting',
            speaker: 'agent',
            content: 'Greeting',
            fullPrompt: 'Start the conversation with a greeting',
            examples: ['Hello', 'Good day'],
            listenFor: ['Hello', 'Hi'],
            nextActions: { positive: 'node2' }
          },
          {
            id: 'node2',
            type: 'question',
            speaker: 'agent',
            content: 'Main Topic',
            fullPrompt: 'Discuss the main topic',
            examples: [],
            listenFor: [],
            nextActions: { positive: 'node3' }
          },
          {
            id: 'node3',
            type: 'farewell',
            speaker: 'agent',
            content: 'Closing',
            fullPrompt: 'End the conversation',
            examples: ['Goodbye', 'Thank you'],
            listenFor: [],
            nextActions: {}
          }
        ],
        edges: [
          { from: 'node1', to: 'node2' },
          { from: 'node2', to: 'node3' }
        ],
        prompts: {
          node1: 'Start with a greeting',
          node2: 'Discuss main topic',
          node3: 'Close conversation'
        },
        globalInstructions: 'Be helpful and professional',
        errorHandling: 'Ask for clarification if needed'
      };
      }
    }

    console.log('Generated flow data:', JSON.stringify(flowData, null, 2));

    const mermaidDiagram = generateMermaidDiagram(flowData);

    console.log('Generated Mermaid diagram:', mermaidDiagram);

    return {
      ...flowData,
      mermaidDiagram
    };
  } catch (error) {
    console.error('Error analyzing conversation:', error);

    // Check if it's an OpenAI API error
    if (error.response) {
      console.error('OpenAI API error response:', error.response.data || error.response);
      console.error('OpenAI API status:', error.response.status);
    } else if (error.message) {
      console.error('Error message:', error.message);
    }

    // Return a basic flow structure to prevent frontend errors
    return {
      nodes: [
        {
          id: 'error',
          type: 'greeting',
          speaker: 'agent',
          content: 'Error Processing',
          fullPrompt: 'An error occurred processing the conversation. Please try again.',
          examples: [],
          listenFor: [],
          nextActions: {}
        }
      ],
      edges: [],
      prompts: {
        error: 'An error occurred processing the conversation. Please check the logs and try again.'
      },
      globalInstructions: 'Error occurred during processing',
      errorHandling: 'Please check server logs for details',
      mermaidDiagram: 'graph TD\n    Error[Error Processing Conversation]'
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

    // Minimalist black and white style definitions
    diagram += '    classDef default fill:#ffffff,stroke:#000000,stroke-width:2px,color:#000000\n';
    diagram += '    classDef greeting fill:#f8f8f8,stroke:#000000,stroke-width:3px,color:#000000\n';
    diagram += '    classDef question fill:#ffffff,stroke:#000000,stroke-width:2px,stroke-dasharray: 5 5,color:#000000\n';
    diagram += '    classDef decision fill:#f0f0f0,stroke:#000000,stroke-width:2px,color:#000000\n';
    diagram += '    classDef confirmation fill:#ffffff,stroke:#000000,stroke-width:3px,color:#000000\n';
    diagram += '    classDef farewell fill:#e8e8e8,stroke:#000000,stroke-width:2px,color:#000000\n';
    diagram += '\n';

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

    // Second pass: add nodes to diagram with embedded prompts
    validNodes.forEach(node => {
      // Create multi-line label with content and key prompt info
      let mainLabel = (node.content || 'Node')
        .toString()
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/['"]/g, '')
        .replace(/[`~!@#$%^&*()+={}[\]|\\:;<>?,./]/g, '')
        .trim();

      // Truncate main label if needed
      if (mainLabel.length > 30) {
        mainLabel = mainLabel.substring(0, 27) + '...';
      }

      // Extract key prompt elements
      let promptSummary = '';
      if (node.fullPrompt) {
        // Extract first key instruction from prompt
        const promptText = node.fullPrompt.substring(0, 60)
          .replace(/[\r\n\t]+/g, ' ')
          .replace(/['"]/g, '')
          .replace(/[`~!@#$%^&*()+={}[\]|\\:;<>?,./]/g, '')
          .trim();
        promptSummary = promptText.length > 50 ? promptText.substring(0, 47) + '...' : promptText;
      }

      // Determine node shape based on type
      let nodeShape = 'rectangle';
      let classType = '';

      if (node.type === 'greeting') {
        nodeShape = 'stadium';
        classType = 'greeting';
      } else if (node.type === 'question') {
        nodeShape = 'rectangle';
        classType = 'question';
      } else if (node.type === 'decision') {
        nodeShape = 'rhombus';
        classType = 'decision';
      } else if (node.type === 'confirmation') {
        nodeShape = 'rectangle';
        classType = 'confirmation';
      } else if (node.type === 'farewell') {
        nodeShape = 'stadium';
        classType = 'farewell';
      }

      // Build the node with embedded info
      if (nodeShape === 'stadium') {
        diagram += `    ${node.safeId}(["${mainLabel}"])`;
      } else if (nodeShape === 'rhombus') {
        diagram += `    ${node.safeId}{"${mainLabel}"}`;
      } else {
        // Rectangle with multi-line content
        if (promptSummary) {
          diagram += `    ${node.safeId}["${mainLabel}<br/><small>${promptSummary}</small>"]`;
        } else {
          diagram += `    ${node.safeId}["${mainLabel}"]`;
        }
      }

      if (classType) {
        diagram += `:::${classType}`;
      }
      diagram += '\n';
    });

    // Third pass: add edges with conditions
    if (flowData.edges && Array.isArray(flowData.edges)) {
      flowData.edges.forEach(edge => {
        if (!edge || !edge.from || !edge.to) {
          return;
        }

        const fromId = nodeMap.get(edge.from);
        const toId = nodeMap.get(edge.to);

        if (fromId && toId) {
          // Add edge with condition label if available
          if (edge.condition) {
            const condition = edge.condition
              .substring(0, 20)
              .replace(/[\r\n\t]+/g, ' ')
              .replace(/['"]/g, '')
              .replace(/[`~!@#$%^&*()+={}[\]|\\:;<>?,./]/g, '')
              .trim();
            diagram += `    ${fromId} -->|${condition}| ${toId}\n`;
          } else {
            diagram += `    ${fromId} --> ${toId}\n`;
          }
        }
      });
    }

    // If no valid nodes were added, add a default
    if (validNodes.length === 0) {
      diagram = 'graph TD\n    Start[Start]';
    }

    console.log('Generated enhanced Mermaid diagram:', diagram);
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