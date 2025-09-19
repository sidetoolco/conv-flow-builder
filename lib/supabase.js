const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Using service role for server-side operations
);

// Store conversation flow in database
async function storeConversationFlow(flowData, transcriptions, mermaidDiagram) {
  try {
    const { data, error } = await supabase
      .from('conversation_flows')
      .insert({
        name: `Flow ${new Date().toISOString()}`,
        description: `Conversation flow with ${transcriptions.length} audio file(s)`,
        transcriptions,
        flow_data: flowData,
        mermaid_diagram: mermaidDiagram,
        metadata: {
          node_count: flowData.nodes?.length || 0,
          edge_count: flowData.edges?.length || 0,
          languages: [...new Set(transcriptions.map(t => t.language))],
          created_at: new Date().toISOString()
        }
      })
      .select()
      .single();

    if (error) throw error;

    // Store individual prompts
    if (data && flowData.nodes) {
      const prompts = flowData.nodes.map(node => ({
        flow_id: data.id,
        node_id: node.id,
        node_type: node.type,
        prompt_text: node.fullPrompt || flowData.prompts?.[node.id],
        examples: node.examples,
        listen_for: node.listenFor,
        next_actions: node.nextActions,
        metadata: {
          speaker: node.speaker,
          content: node.content
        }
      }));

      await supabase.from('prompts').insert(prompts);
    }

    return { success: true, flowId: data?.id };
  } catch (error) {
    console.error('Error storing conversation flow:', error);
    return { success: false, error: error.message };
  }
}

// Upload audio file to Supabase Storage
async function uploadAudioFile(file, flowId) {
  try {
    const fileName = `${flowId}/${Date.now()}-${file.originalname}`;

    // Read file from local path
    const fs = require('fs').promises;
    const fileBuffer = await fs.readFile(file.path);

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from('audio-files')
      .upload(fileName, fileBuffer, {
        contentType: file.mimetype,
        upsert: false
      });

    if (error) throw error;

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('audio-files')
      .getPublicUrl(fileName);

    // Store reference in database
    await supabase.from('audio_files').insert({
      flow_id: flowId,
      file_name: file.originalname,
      file_url: publicUrl,
      file_size: file.size,
      metadata: {
        mimetype: file.mimetype,
        upload_path: data.path
      }
    });

    return { success: true, url: publicUrl };
  } catch (error) {
    console.error('Error uploading audio file:', error);
    return { success: false, error: error.message };
  }
}

// Get all conversation flows
async function getConversationFlows(limit = 10) {
  try {
    const { data, error } = await supabase
      .from('conversation_flows')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return { success: true, flows: data };
  } catch (error) {
    console.error('Error fetching conversation flows:', error);
    return { success: false, error: error.message };
  }
}

// Get single conversation flow with details
async function getConversationFlow(flowId) {
  try {
    const { data: flowData, error: flowError } = await supabase
      .from('conversation_flows')
      .select('*')
      .eq('id', flowId)
      .single();

    if (flowError) throw flowError;

    const { data: prompts, error: promptsError } = await supabase
      .from('prompts')
      .select('*')
      .eq('flow_id', flowId);

    if (promptsError) throw promptsError;

    const { data: audioFiles, error: audioError } = await supabase
      .from('audio_files')
      .select('*')
      .eq('flow_id', flowId);

    if (audioError) throw audioError;

    return {
      success: true,
      flow: {
        ...flowData,
        prompts,
        audioFiles
      }
    };
  } catch (error) {
    console.error('Error fetching conversation flow:', error);
    return { success: false, error: error.message };
  }
}

// Create storage bucket if it doesn't exist
async function ensureStorageBucket() {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();

    if (!buckets?.find(b => b.name === 'audio-files')) {
      const { error } = await supabase.storage.createBucket('audio-files', {
        public: true,
        fileSizeLimit: 52428800 // 50MB
      });

      if (error && !error.message.includes('already exists')) {
        throw error;
      }
    }
    return true;
  } catch (error) {
    console.error('Error ensuring storage bucket:', error);
    return false;
  }
}

module.exports = {
  supabase,
  storeConversationFlow,
  uploadAudioFile,
  getConversationFlows,
  getConversationFlow,
  ensureStorageBucket
};