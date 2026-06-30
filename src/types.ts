export interface UserProfile {
  uid: string;
  email: string;
  gamma: number;
  archetype: 'deadline_dancer' | 'overwhelmed_perfectionist' | 'context_switcher' | 'paralyzed_planner';
  completionCount: number;
  cryoSavesRemaining?: number;
  cryoSavesUsed?: number;
}

export interface TaskStep {
  id: string;
  time: string; // e.g. "10:00 AM" or ISO
  action: string; // If-then format: "If it is [TIME], then I will [SPECIFIC ACTION]"
  durationMinutes: number;
  completed: boolean;
  calendarEventId?: string;
  display_text?: string;
  display_time?: string;
  trigger_time?: string;
  trigger_time_unix_ms?: number;
  trigger_time_display?: string | null;
  end_time_unix_ms?: number;
}

export interface ReactLogEntry {
  step: number;
  thought: string;
  tool: string;
  result: string;
  timestamp: string;
}

export interface MScoreEntry {
  timestamp: string;
  score: number;
}

export interface DebriefData {
  hardestPart: string;
  actualStartTime: string;
  rating: number;
  submitted: boolean;
  blockerType?: string;
  insight?: string;
  newGamma?: number;
}

export type ImportanceLevel =
  'personal_only' | 'low_external' | 'someone_waiting' |
  'high_consequence' | 'critical';

export interface Task {
  id: string;
  userId: string;
  taskText: string;
  task_name?: string;
  recipient: string;
  deadline: string; // ISO string
  stakeLevel: 'low' | 'medium' | 'high';
  status: 'analyzing' | 'decomposing' | 'scheduling' | 'active' | 'completed' | 'crisis_sent' | 'failed';
  mScore: number;
  expectancy: number; // 1-10
  value: number; // 1-10
  archetype?: string;
  watchdogTime: string; // ISO string
  watchdogTriggered: boolean;
  crisisAttemptCount?: number;
  originalDeadline?: string;
  steps: TaskStep[];
  reactLogs: ReactLogEntry[];
  debrief?: DebriefData;
  createdAt: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  importance?: ImportanceLevel;
  deadline_flexible?: boolean;
  firstStepCompletedAt?: string;
  taskCompletedAt?: string;
  submissionFormat?: 'PDF' | 'DOCX' | 'PPT' | 'TXT';
  assignmentInstructions?: string;
  autoSubmitted?: boolean;
}

export interface ContextFile {
  id: string;
  fileName: string;
  fileType: string;
  uploadedAt: string;
  charCount: number;
  originalFileSize?: number; // original file size in bytes (before truncation)
  wasTruncated?: boolean;    // true if content was capped at 15k chars
}

export interface ContextChunk {
  id: string;
  fileId: string;
  fileName: string;
  text: string;
  embedding: number[];
  index: number;
}

