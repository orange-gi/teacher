export type SessionListItem = {
  session_id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type SessionCreateOut = {
  session_id: string;
  created_at: string;
};

export type LearningNode = {
  node_id: string;
  order: number;
  title: string;
  knowledge_goal: string;
  practice_task: string;
  hint_code: string;
  grading_rubric: string[];
  pass_score: number;
};

export type LearningPlan = {
  outline: string;
  nodes: LearningNode[];
};

export type AskOut = {
  session_id: string;
  question_id: string;
  created_at: string;
  plan: LearningPlan;
  unlocked_order: number;
};

export type GradeOut = {
  score: number;
  passed: boolean;
  feedback: string;
  strengths: string[];
  improvements: string[];
};

export type SubmitAnswerOut = {
  node_id: string;
  order: number;
  grade: GradeOut;
  unlocked_order: number;
  finished: boolean;
};

export type LLMConfigOut = {
  base_url: string;
  model: string;
  temperature: number;
  api_key_masked: string;
};

export type GraphNode = {
  id: string;
  name: string;
  level?: number | null;
  brightness: number; // 0..1
  last_practice_at?: string | null;
  mastery_score?: number | null;
};

export type GraphEdge = {
  source: string;
  target: string;
  type: 'PREREQ' | 'REL';
};

export type GraphOut = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

