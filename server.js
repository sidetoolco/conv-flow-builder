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
  console.warn('WARNING: Missing required environment variables:', missingEnvVars.join(', '));
  console.warn('Please set these environment variables in Vercel dashboard or .env file');
  // Don't exit in production to allow Vercel to deploy
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

  const prompt = `Analyze this conversation transcript and create a structured voice AI agent flow following industry best practices.

${!hasSpeakerSeparation ? 'NOTE: This transcript does not have speaker separation. Please analyze the content to identify conversation turns between agent and customer based on context clues like greetings, questions, confirmations, etc.' : ''}

Transcript:
${transcriptText}

Create a PROFESSIONAL voice AI agent flow with these REQUIRED components:

1. GREETING & IDENTITY VERIFICATION
   - Professional greeting with company/agent name
   - Identity confirmation (name, account, reference number, etc.)
   - Branch: If not confirmed → transfer or end call

2. MAIN PURPOSE/TOPIC
   - State the reason for the call clearly
   - Present key information (payment amount, appointment, service, etc.)
   - Listen for customer acknowledgment

3. CUSTOMER RESPONSE BRANCHES
   Based on the conversation, create decision branches for common responses:
   - Acceptance/Agreement → Confirm details and next steps
   - Rejection/Decline → Handle objection or schedule callback
   - Request for information → Provide details
   - Already completed → Verify and thank
   - Partial/Alternative → Negotiate or offer options
   - Unclear/No response → Retry or clarify

4. CLOSURE
   - Summarize agreed actions
   - Thank the customer
   - Professional sign-off

Return a JSON structure with:

"nodes": [
  {
    "id": "start",
    "type": "greeting",
    "speaker": "agent",
    "content": "Greeting & Verify Identity",
    "fullPrompt": "Hello, this is [Agent Name] from [Company]. May I speak with [Customer Name]? I'm calling regarding [Purpose].",
    "examples": ["Hello, this is Sarah from ABC Company", "Good morning, am I speaking with John Smith?"],
    "listenFor": ["yes", "speaking", "that's me", "no", "wrong number"],
    "nextActions": {
      "confirmed": "main_purpose",
      "denied": "end_not_verified",
      "unclear": "retry_identity"
    },
    "timeout": 5,
    "retryPrompt": "I'm sorry, could you confirm if I'm speaking with [Customer Name]?"
  }
],
"edges": [
  {"from": "start", "to": "main_purpose", "condition": "Identity Confirmed"},
  {"from": "start", "to": "end_not_verified", "condition": "Not Customer"}
],
"globalInstructions": "Maintain professional tone. Speak clearly at moderate pace. Allow pauses for customer responses.",
"errorHandling": "If customer becomes upset or requests supervisor, offer to transfer or schedule callback."

CRITICAL REQUIREMENTS:
- ALWAYS start with greeting and identity verification
- Create clear decision branches based on customer responses
- Each node must have specific prompts and listening keywords
- Include proper error handling and fallback options
- End gracefully regardless of outcome
- Extract actual patterns and phrases from the transcript`;

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
      return 'flowchart LR\n    Start([No Flow Available])';
    }

    // If no nodes, return simple diagram
    if (flowData.nodes.length === 0) {
      return 'flowchart LR\n    Start([Empty Flow])';
    }

    // Start with frontmatter config for theme
    let diagram = `%%{init: {'theme':'base', 'themeVariables': {'primaryColor':'#ffffff','primaryTextColor':'#1e293b','primaryBorderColor':'#2563eb','lineColor':'#6b7280','secondaryColor':'#dbeafe','tertiaryColor':'#fef3c7','background':'#ffffff','darkMode':false,'fontFamily':'Inter, sans-serif'}}}%%\n`;
    diagram += 'flowchart LR\n';
    const nodeMap = new Map();
    const validNodes = [];
    const nodeClasses = []; // Track which nodes get which class

    // Professional voice AI flow style definitions with proper Mermaid syntax
    diagram += '    %% Define styles for different node types\n';
    diagram += '    classDef default fill:#ffffff,stroke:#2563eb,stroke-width:2px,color:#1e293b\n';
    diagram += '    classDef greeting fill:#dbeafe,stroke:#2563eb,stroke-width:3px,color:#1e40af,font-weight:bold\n';
    diagram += '    classDef verification fill:#fef3c7,stroke:#f59e0b,stroke-width:2px,color:#92400e\n';
    diagram += '    classDef main fill:#ffffff,stroke:#2563eb,stroke-width:2px,color:#1e293b\n';
    diagram += '    classDef decision fill:#f3e8ff,stroke:#9333ea,stroke-width:3px,color:#581c87,font-weight:bold\n';
    diagram += '    classDef success fill:#d1fae5,stroke:#10b981,stroke-width:3px,color:#14532d,font-weight:bold\n';
    diagram += '    classDef failure fill:#fee2e2,stroke:#ef4444,stroke-width:3px,color:#7f1d1d,font-weight:bold\n';
    diagram += '    classDef farewell fill:#e0e7ff,stroke:#6366f1,stroke-width:2px,color:#312e81\n';
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

    // Group nodes by stage for better organization
    // Second pass: add nodes to diagram with embedded prompts
    validNodes.forEach(node => {
      // Create clear, readable label
      let mainLabel = (node.content || 'Node')
        .toString()
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/['"]/g, '')
        .replace(/[`~!@#$%^&*()+={}[\]|\\:;<>?,./]/g, '')
        .trim();

      // Truncate main label if needed but keep it readable
      if (mainLabel.length > 40) {
        mainLabel = mainLabel.substring(0, 37) + '...';
      }

      // Add icon or prefix based on node type
      const typeIcons = {
        greeting: '👋 ',
        verification: '✓ ',
        decision: '❓ ',
        success: '✅ ',
        failure: '❌ ',
        farewell: '👋 '
      };

      const nodeIcon = typeIcons[node.type] || '';
      mainLabel = nodeIcon + mainLabel;

      // Determine node shape and style based on type and content
      let nodeShape = 'rectangle';
      let classType = 'default';

      // Map node types to appropriate styles
      if (node.type === 'greeting' || node.id === 'start' || node.id?.toLowerCase().includes('greet') || node.content?.toLowerCase().includes('greeting')) {
        nodeShape = 'stadium';
        classType = 'greeting';
      } else if (node.type === 'verification' || node.content?.toLowerCase().includes('verify') || node.content?.toLowerCase().includes('confirm') || node.content?.toLowerCase().includes('identity')) {
        nodeShape = 'trapezoid';
        classType = 'verification';
      } else if (node.type === 'decision' || (node.nextActions && Object.keys(node.nextActions).length > 1)) {
        nodeShape = 'rhombus';
        classType = 'decision';
      } else if (node.type === 'farewell' || node.id?.includes('end') || node.id?.includes('close') || node.content?.toLowerCase().includes('farewell') || node.content?.toLowerCase().includes('goodbye')) {
        nodeShape = 'stadium';
        classType = 'farewell';
      } else if (node.content?.toLowerCase().includes('success') || node.content?.toLowerCase().includes('completed') || node.content?.toLowerCase().includes('processed') || node.content?.toLowerCase().includes('thank')) {
        nodeShape = 'circle';
        classType = 'success';
      } else if (node.content?.toLowerCase().includes('fail') || node.content?.toLowerCase().includes('error') || node.content?.toLowerCase().includes('not verified') || node.content?.toLowerCase().includes('declined') || node.content?.toLowerCase().includes('unable')) {
        nodeShape = 'circle';
        classType = 'failure';
      } else if (node.content?.toLowerCase().includes('payment') || node.content?.toLowerCase().includes('amount') || node.content?.toLowerCase().includes('confirm')) {
        classType = 'main';
      } else {
        classType = 'default';
      }

      // Store class assignment for later
      nodeClasses.push({ nodeId: node.safeId, className: classType });

      // Build the node with better shape semantics
      if (nodeShape === 'stadium') {
        diagram += `    ${node.safeId}([${mainLabel}])\n`;
      } else if (nodeShape === 'rhombus') {
        diagram += `    ${node.safeId}{${mainLabel}}\n`;
      } else if (nodeShape === 'trapezoid') {
        diagram += `    ${node.safeId}[/${mainLabel}/]\n`;
      } else if (nodeShape === 'circle') {
        diagram += `    ${node.safeId}((${mainLabel}))\n`;
      } else {
        // Rectangle - default
        diagram += `    ${node.safeId}[${mainLabel}]\n`;
      }
    });

    // Apply classes to nodes
    diagram += '\n    %% Apply styles to nodes\n';
    nodeClasses.forEach(({ nodeId, className }) => {
      if (className !== 'default') {
        diagram += `    class ${nodeId} ${className}\n`;
      }
    });

    // Third pass: add edges with better condition labels
    if (flowData.edges && Array.isArray(flowData.edges)) {
      diagram += '\n    %% Edge connections with labels\n';
      flowData.edges.forEach(edge => {
        if (!edge || !edge.from || !edge.to) {
          return;
        }

        const fromId = nodeMap.get(edge.from);
        const toId = nodeMap.get(edge.to);

        if (fromId && toId) {
          // Add edge with improved condition label
          if (edge.condition) {
            let condition = edge.condition
              .replace(/[\r\n\t]+/g, ' ')
              .replace(/['"]/g, '')
              .trim();

            // Simplify common conditions
            if (condition.toLowerCase().includes('yes') || condition.toLowerCase().includes('confirmed') || condition.toLowerCase().includes('agree')) {
              condition = 'Yes';
            } else if (condition.toLowerCase().includes('no') || condition.toLowerCase().includes('denied') || condition.toLowerCase().includes('reject')) {
              condition = 'No';
            } else if (condition.toLowerCase().includes('unclear') || condition.toLowerCase().includes('retry')) {
              condition = 'Unclear';
            }

            // Keep condition short
            if (condition.length > 15) {
              condition = condition.substring(0, 12) + '...';
            }

            diagram += `    ${fromId} -->|${condition}| ${toId}\n`;
          } else {
            diagram += `    ${fromId} --> ${toId}\n`;
          }
        }
      });
    }

    // If no valid nodes were added, add a default
    if (validNodes.length === 0) {
      diagram = 'flowchart LR\n    Start([Start])\n    class Start greeting';
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