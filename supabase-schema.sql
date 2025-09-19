-- Create conversation_flows table
CREATE TABLE IF NOT EXISTS conversation_flows (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  audio_files JSONB,
  transcriptions JSONB,
  flow_data JSONB,
  mermaid_diagram TEXT,
  metadata JSONB
);

-- Create audio_files table for storing file references
CREATE TABLE IF NOT EXISTS audio_files (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  flow_id UUID REFERENCES conversation_flows(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_size INTEGER,
  duration FLOAT,
  metadata JSONB
);

-- Create prompts table for storing individual prompts
CREATE TABLE IF NOT EXISTS prompts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  flow_id UUID REFERENCES conversation_flows(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  node_type TEXT,
  prompt_text TEXT,
  examples JSONB,
  listen_for JSONB,
  next_actions JSONB,
  metadata JSONB
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_conversation_flows_created_at ON conversation_flows(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audio_files_flow_id ON audio_files(flow_id);
CREATE INDEX IF NOT EXISTS idx_prompts_flow_id ON prompts(flow_id);

-- Enable Row Level Security
ALTER TABLE conversation_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE audio_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompts ENABLE ROW LEVEL SECURITY;

-- Create policies for public access (you can modify these based on your auth needs)
CREATE POLICY "Enable read access for all users" ON conversation_flows FOR SELECT USING (true);
CREATE POLICY "Enable insert for all users" ON conversation_flows FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update for all users" ON conversation_flows FOR UPDATE USING (true);

CREATE POLICY "Enable read access for all users" ON audio_files FOR SELECT USING (true);
CREATE POLICY "Enable insert for all users" ON audio_files FOR INSERT WITH CHECK (true);

CREATE POLICY "Enable read access for all users" ON prompts FOR SELECT USING (true);
CREATE POLICY "Enable insert for all users" ON prompts FOR INSERT WITH CHECK (true);