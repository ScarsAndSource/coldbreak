import { useState, useEffect, useRef, FormEvent } from 'react';
import {
  Shield,
  Sparkles,
  Calendar,
  Mail,
  Clock,
  Sliders,
  Terminal,
  CheckCircle,
  AlertTriangle,
  ShieldAlert,
  User as UserIcon,
  LogOut,
  Play,
  X,
  CheckSquare,
  Square,
  HelpCircle,
  Loader2,
  Radar,
  Flame,
  Snowflake,
  Activity,
  Lock,
  Brain,
  Cpu,
  Settings,
  Radio,
  Gem,
  Link,
  Star,
  Award
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  googleSignIn,
  logout,
  initAuth,
  db,
  getUserProfile,
  updateUserProfile,
  getMissionHistory,
  saveMissionToHistory,
  retrieveAllContextChunks,
  handleFirestoreError,
  OperationType
} from './firebase-client';
import {
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  updateDoc,
  deleteDoc,
  collection
} from 'firebase/firestore';
import type { Task, TaskStep, ReactLogEntry, UserProfile, ImportanceLevel } from './types';

// Import our custom modular visual elements
import { SentinelDrone } from './components/SentinelDrone';
import { ContainmentIntegrityCore } from './components/ContainmentIntegrityCore';
import { CLASSES_LIST, ClassCard, ArchetypeType } from './components/OperativeClasses';
import { HudPanel } from './components/HudPanel';

const getTomorrow5PM = () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(17, 0, 0, 0);
  const year = tomorrow.getFullYear();
  const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const day = String(tomorrow.getDate()).padStart(2, '0');
  const hours = String(tomorrow.getHours()).padStart(2, '0');
  const minutes = String(tomorrow.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

type TempPhase = 'cold' | 'warm' | 'hot';

const XP_DEBRIEF_BONUS = 15;
const XP_STREAK_BONUS = 10;

const getLevelFromXP = (xp: number) => {
  const level = Math.floor(xp / 100);
  let title = "Acolyte";
  if (level >= 5) {
    title = "Master Operator";
  } else if (level >= 2) {
    title = "Keeper of the Cold";
  }
  return { level, title };
};

export function CalibrationCrystal({ value }: { value: number }) {
  // value goes from 0.1 to 1.5
  const maxLines = 12;
  const numLines = Math.floor((value / 1.5) * maxLines);
  
  const fractureLines = [
    "M50,10 L50,90",
    "M20,25 L80,75",
    "M80,25 L20,75",
    "M50,10 L80,25",
    "M80,25 L80,75",
    "M80,75 L50,90",
    "M50,90 L20,75",
    "M20,75 L20,25",
    "M20,25 L50,10",
    "M50,50 L20,25",
    "M50,50 L80,75",
    "M50,50 L50,10"
  ];

  return (
    <div className="w-16 h-16 flex items-center justify-center relative bg-live-accent/5 border border-live-accent/10 rounded-lg shrink-0">
      <svg className="w-12 h-12 text-live-accent transition-all duration-300" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="1.5">
        {/* Base Hexagon Frame */}
        <polygon points="50,10 85,30 85,70 50,90 15,70 15,30" className="opacity-40" stroke="currentColor" strokeWidth="1.5" />
        
        {/* Dynamic fracture internal lines */}
        {fractureLines.slice(0, Math.max(1, numLines)).map((d, i) => (
          <path
            key={i}
            d={d}
            stroke="currentColor"
            strokeWidth={1 + (value / 1.5)}
            className="opacity-90"
          />
        ))}
      </svg>
    </div>
  );
}

const XP_PER_STEP = 25;
const XP_CRISIS_AVOIDED = 50;
const XP_MISSION_COMPLETE = 100;

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [token, setToken] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Profile configuration states
  const [gamma, setGamma] = useState<number>(0.5);
  const [archetype, setArchetype] = useState<ArchetypeType>('deadline_dancer');
  const [completionCount, setCompletionCount] = useState<number>(0);
  const [coldStreak, setColdStreak] = useState<number>(3);
  const [frostShards, setFrostShards] = useState<number>(150);
  const [totalBreaches, setTotalBreaches] = useState<number>(1);

  // Task Input States
  const [taskText, setTaskText] = useState('');
  const [recipient, setRecipient] = useState('');
  const [deadline, setDeadline] = useState(getTomorrow5PM());
  const [stakeLevel, setStakeLevel] = useState<'low' | 'medium' | 'high'>('medium');
  const [expectancy, setExpectancy] = useState<number>(8);
  const [value, setValue] = useState<number>(8);

  // Conversational Intake States
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [selfDifficulty, setSelfDifficulty] = useState<'easy' | 'tough' | 'dreading'>('tough');
  const [userTimeEstimate, setUserTimeEstimate] = useState<string>('2 hours');
  const [hintText, setHintText] = useState<string | null>(null);
  const [isFetchingHint, setIsFetchingHint] = useState<boolean>(false);
  const [importance, setImportance] = useState<ImportanceLevel>('someone_waiting');
  const [stuckSuggestion, setStuckSuggestion] = useState<string | null>(null);
  const [isLoadingStuck, setIsLoadingStuck] = useState(false);
  const [deadlineFlexible, setDeadlineFlexible] = useState<boolean>(true);
  const [showStuckHelper, setShowStuckHelper] = useState(false);

  // Active task state
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [reactLogs, setReactLogs] = useState<ReactLogEntry[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // Local helper for real-time M-Score (Containment Integrity) calculation
  const [currentMScore, setCurrentMScore] = useState<number>(100);
  const [hoursToDeadline, setHoursToDeadline] = useState<number>(0);

  // Active step unlock state (for Paralyzed Planner)
  const [unlockedStepCount, setUnlockedStepCount] = useState<number>(1);

  // Crisis Protocol modal state variables
  const [isCrisisModalOpen, setIsCrisisModalOpen] = useState(false);
  const [crisisMessageText, setCrisisMessageText] = useState("");
  const [isCrisisSending, setIsCrisisSending] = useState(false);

  // Mode 4: Behavioral Debrief state
  const [isDebriefOpen, setIsDebriefOpen] = useState(false);
  const [gracePeriodMinutes, setGracePeriodMinutes] = useState<number | null>(null);
  const [crisisSuccessBanner, setCrisisSuccessBanner] = useState<string | null>(null);
  const [hasManualDeadline, setHasManualDeadline] = useState<boolean>(false);
  const [showCustomGrace, setShowCustomGrace] = useState<boolean>(false);
  const [customGraceInput, setCustomGraceInput] = useState<string>('');
  const [debriefStep, setDebriefStep] = useState(1); // 1, 2, or 3 (insight)
  const [debriefHardestPart, setDebriefHardestPart] = useState("");
  const [debriefRating, setDebriefRating] = useState(0);
  const [debriefInsight, setDebriefInsight] = useState("");
  const [isDebriefProcessing, setIsDebriefProcessing] = useState(false);

  // Cosmetic typewriter reveal for the crisis message inside the modal
  const [revealedCrisisText, setRevealedCrisisText] = useState("");

  const [appPhase, setAppPhase] = useState<'welcome' | 'personalization' | 'processing' | 'plan' | 'active' | 'crisis' | 'debrief'>('welcome');
  const [sessionXP, setSessionXP] = useState(0);

  // Navigation flow screens: 'enlistment' | 'mission_control' | 'active_operation' | 'after_action_report'
  const [uiScreen, setUiScreen] = useState<'enlistment' | 'mission_control' | 'active_operation' | 'after_action_report'>('enlistment');
  const [crisisCountdown, setCrisisCountdown] = useState(120);

  // Operational custom states for Screen 2/3/4 demonstration
  const [operationTempOverride, setOperationTempOverride] = useState<'cold' | 'warm' | 'hot' | null>(null);
  const [afterActionDemoMayday, setAfterActionDemoMayday] = useState<boolean>(false);
  const [simulatedMaydayOverlay, setSimulatedMaydayOverlay] = useState<boolean>(false);

  // Is Enlistment confirmed by a check signature
  const [enlistmentSigned, setEnlistmentSigned] = useState(false);

  // RAG Pipeline State variables
  const [contextFiles, setContextFiles] = useState<any[]>([]);
  const [deletingFileIds, setDeletingFileIds] = useState<Set<string>>(new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null); // inline confirm instead of window.confirm
  const [isPurgingAll, setIsPurgingAll] = useState(false);
  const contextFilesUnsubRef = useRef<(() => void) | null>(null);
  const [isUploadingContext, setIsUploadingContext] = useState(false);
  const [contextProgress, setContextProgress] = useState("");
  const [dragActive, setDragActive] = useState(false);

  // Cryo-Save system states (Part 1, 3, 4)
  const [submissionFormat, setSubmissionFormat] = useState<'PDF' | 'DOCX' | 'PPT' | 'TXT'>('PDF');
  const [assignmentInstructions, setAssignmentInstructions] = useState('');
  const [cryoSavesRemaining, setCryoSavesRemaining] = useState<number>(5);
  const [cryoSavesUsed, setCryoSavesUsed] = useState<number>(0);
  const [isCryoSaveModalOpen, setIsCryoSaveModalOpen] = useState(false);
  const [isAutoSubmitting, setIsAutoSubmitting] = useState(false);

  // New Cryo-Save draft review states
  const [isCryoSaveReviewOpen, setIsCryoSaveReviewOpen] = useState(false);
  const [cryoDraftLoading, setCryoDraftLoading] = useState(false);
  const [cryoDraftTitle, setCryoDraftTitle] = useState("");
  const [cryoDraftContent, setCryoDraftContent] = useState("");
  const [cryoTimerRemaining, setCryoTimerRemaining] = useState<number>(210); // 3.5 minutes (between 3 and 4 mins)
  const [isTimerPaused, setIsTimerPaused] = useState(false);

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Cryo-Save Auto-Submit Timer
  useEffect(() => {
    if (!isCryoSaveReviewOpen || cryoDraftLoading || isTimerPaused || cryoTimerRemaining <= 0) {
      if (isCryoSaveReviewOpen && !cryoDraftLoading && cryoTimerRemaining === 0) {
        // Countdown reached 0 -> AUTO SUBMIT!
        handleConfirmCryoSave();
      }
      return;
    }

    const timer = setInterval(() => {
      setCryoTimerRemaining(prev => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [isCryoSaveReviewOpen, cryoDraftLoading, isTimerPaused, cryoTimerRemaining]);

  // Auto-fill recipient and deadline from taskText behind the scenes for convenience
  // Dismiss armed inline-confirm when user presses Escape
  useEffect(() => {
    if (!confirmDeleteId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirmDeleteId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmDeleteId]);

  useEffect(() => {
    const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
    const emailMatch = taskText.match(emailRegex);
    if (emailMatch) {
      setRecipient(emailMatch[1]);
    } else {
      const forMatch = taskText.match(/for\s+([a-zA-Z0-9]+)/i);
      if (forMatch) {
        setRecipient(`${forMatch[1].toLowerCase()}@company.com`);
      } else {
        setRecipient('aditya@company.com');
      }
    }

    const timeMatch = taskText.match(/by\s+(\d+)\s*(pm|am)?/i);
    if (timeMatch) {
      const hours = parseInt(timeMatch[1]);
      const ampm = timeMatch[2]?.toLowerCase();
      let targetHours = hours;
      if (ampm === 'pm' && hours !== 12) targetHours += 12;
      if (ampm === 'am' && hours === 12) targetHours = 0;
      
      const targetDate = new Date();
      if (targetDate.getHours() >= targetHours) {
        targetDate.setDate(targetDate.getDate() + 1);
      }
      targetDate.setHours(targetHours, 0, 0, 0);
      
      const year = targetDate.getFullYear();
      const month = String(targetDate.getMonth() + 1).padStart(2, '0');
      const day = String(targetDate.getDate()).padStart(2, '0');
      const hStr = String(targetDate.getHours()).padStart(2, '0');
      const mStr = String(targetDate.getMinutes()).padStart(2, '0');
      setDeadline(`${year}-${month}-${day}T${hStr}:${mStr}`);
    }
  }, [taskText]);

  // Synchronize App Phase with Active Database State
  useEffect(() => {
    if (isDebriefOpen) {
      setUiScreen('after_action_report');
      return;
    }
    
    if (activeTask && activeTask.taskText && activeTask.status !== 'completed') {
      setUiScreen('active_operation');
      return;
    }

    // Default to enlistment or mission_control based on archetype setting
    if (!activeTask || activeTask.status === 'completed') {
      if (archetype) {
        setUiScreen('mission_control');
      } else {
        setUiScreen('enlistment');
      }
    }
  }, [activeTask, isDebriefOpen, archetype]);

  // Crisis phase countdown timer
  // NOTE: checks appPhase (not uiScreen) to match the JSX crisis block condition
  useEffect(() => {
    if (appPhase !== 'crisis' || !activeTask?.watchdogTriggered || activeTask?.status === 'crisis_sent') {
      setCrisisCountdown(120);
      return;
    }
    
    const attempt = activeTask?.crisisAttemptCount || 0;
    if (attempt >= 2) {
      // Third attempt: 5-second countdown then auto-send (final breach)
      setCrisisCountdown(5);
      const timer = setInterval(() => {
        setCrisisCountdown(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            handleSendCrisisAction(0);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    } else {
      // Use gracePeriodMinutes if set, default to 30 minutes
      // FIX: removed null guard that was causing immediate return without starting timer
      const graceMins = gracePeriodMinutes ?? 30;
      const timer = setInterval(() => {
        setCrisisCountdown(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            handleSendCrisisAction(graceMins);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [appPhase, activeTask?.status, activeTask?.watchdogTriggered, activeTask?.crisisAttemptCount, gracePeriodMinutes]);

  // Debrief complete insight automatic reset & transition back to Mission Control after 5 seconds
  useEffect(() => {
    if (uiScreen === 'after_action_report' && debriefStep === 3) {
      const timer = setTimeout(async () => {
        const activeUid = user?.uid || "demo-user-001";
        try {
          const taskRef = doc(db, 'tasks', activeUid);
          await deleteDoc(taskRef); // deleteDoc not setDoc({}) — avoids ghost documents
          setActiveTask(null);
          setTaskText('');
          setRecipient('');
          setDeadline(getTomorrow5PM());
        } catch (err) {
          console.error("Failed to auto-reset task:", err);
        }
        setIsDebriefOpen(false);
        setDebriefStep(1); 
        setUiScreen('mission_control');
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [uiScreen, debriefStep]);

  // Helper to extract first 3 words of action after "then I will"
  const getStuckText = (action: string) => {
    const parts = action.split(/then I will/i);
    const mainAction = parts[1] ? parts[1].trim() : action;
    return mainAction.split(/\s+/).slice(0, 3).join(" ");
  };

  const [selectedChip, setSelectedChip] = useState<string | null>(null);
  const [showXpFlash, setShowXpFlash] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [displayedXP, setDisplayedXP] = useState(0);
  const [debriefShowQuestions, setDebriefShowQuestions] = useState(false);
  const [isReasoningOpen, setIsReasoningOpen] = useState(false);

  // RAG state — tracks whether the last plan was personalized by context docs
  const [ragUsed, setRagUsed] = useState<boolean>(false);

  // SECTION 2 state variables
  const [totalXP, setTotalXP] = useState<number>(150);
  const [currentStreak, setCurrentStreak] = useState<number>(3);
  const [missionsCompleted, setMissionsCompleted] = useState<number>(2);
  const [missionHistory, setMissionHistory] = useState<any[]>([]);
  const [profileLoaded, setProfileLoaded] = useState<boolean>(false);

  // SECTION 3 state variables
  const [recipientName, setRecipientName] = useState<string>("");
  const [stepDepth, setStepDepth] = useState<'quick' | 'balanced' | 'thorough'>('balanced');
  const [reminderMode, setReminderMode] = useState<'every-step' | 'when-stuck'>('when-stuck');
  const [showExpandedIntake, setShowExpandedIntake] = useState<boolean>(false);

  // SECTION 4 state variables
  const [nudgeVisible, setNudgeVisible] = useState<boolean>(false);
  const [xpFlashVisible, setXpFlashVisible] = useState<boolean>(false);
  const [xpFlashText, setXpFlashText] = useState<string>("");

  // SECTION 5 state variables
  const [showHistory, setShowHistory] = useState<boolean>(false);

  // SECTION 6 state variables
  const [hintVisible, setHintVisible] = useState<boolean>(false);
  const [microSteps, setMicroSteps] = useState<string[]>([]);
  const [microCompleted, setMicroCompleted] = useState<boolean[]>([]);
  const [isMicroLoading, setIsMicroLoading] = useState<boolean>(false);
  const [microLoadingMsgIndex, setMicroLoadingMsgIndex] = useState<number>(0);

  // Synchronize appPhase with existing states to ensure correct initialization and transitions
  useEffect(() => {
    if (isDebriefOpen) {
      setAppPhase('debrief');
      return;
    }
    if (activeTask?.watchdogTriggered) {
      setAppPhase('crisis');
      return;
    }
    // FIX: When crisis resolves (watchdogTriggered cleared or false) but task is still active
    // — transition back from crisis to active, not stuck on crisis screen forever
    if (appPhase === 'crisis' && !activeTask?.watchdogTriggered && activeTask?.steps && activeTask.steps.length > 0 && activeTask.status !== 'completed') {
      setAppPhase('active');
      return;
    }
    if (isProcessing) {
      setAppPhase('processing');
      return;
    }
    if (activeTask && activeTask.steps && activeTask.steps.length > 0) {
      if (activeTask.status === 'completed') {
        setAppPhase('debrief');
        return;
      }
      // When steps arrive after processing completes → go to plan (not active)
      // This fixes the race condition where onSnapshot delivers after setIsProcessing(false)
      if (appPhase === 'processing' || appPhase === 'welcome' || appPhase === 'personalization') {
        setAppPhase('plan');
        return;
      }
      // Otherwise stay in whatever phase we're in (active, plan, etc.)
    }
    // Do NOT auto-reset to 'welcome' here — task resets are handled explicitly via handleResetTask
  }, [activeTask, isDebriefOpen, isProcessing, appPhase]);

  // Synchronize debrief XP rolling counter and question reveal
  useEffect(() => {
    if (appPhase === 'debrief') {
      setDisplayedXP(0);
      setDebriefShowQuestions(false);
      
      const startTime = Date.now();
      const duration = 1200;
      const interval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        setDisplayedXP(Math.floor(progress * sessionXP));
        if (progress >= 1) {
          clearInterval(interval);
        }
      }, 30);

      const timeout = setTimeout(() => {
        if (activeTask?.autoSubmitted) {
          setDebriefStep(3);
        } else {
          setDebriefShowQuestions(true);
        }
      }, 2000);

      return () => {
        clearInterval(interval);
        clearTimeout(timeout);
      };
    }
  }, [appPhase, sessionXP]);

  // Handle transition back to welcome screen after debrief completes
  useEffect(() => {
    if (appPhase === 'debrief' && debriefStep === 3) {
      const timer = setTimeout(async () => {
        const activeUid = user?.uid || "demo-user-001";
        try {
          const taskRef = doc(db, 'tasks', activeUid);
          await deleteDoc(taskRef);
          await fetch("/api/watchdog/cancel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ taskId: activeUid })
          });
        } catch (err) {
          console.error("Failed to clean up task after debrief:", err);
        }
        setActiveTask(null);
        setAppPhase('welcome');
        setSessionXP(0);
        setSelectedChip(null);
        setTaskText('');
        setRecipient('');
        setDeadline(getTomorrow5PM());

        setHintText(null);
        setMicroSteps([]);
        setMicroCompleted([]);
        setIsReasoningOpen(false);
        setIsDebriefOpen(false);
        setHasManualDeadline(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [appPhase, debriefStep, user?.uid]);

  const sortedSteps = activeTask?.steps
    ? [...activeTask.steps].sort((a, b) => {
        const timeA = a.trigger_time_unix_ms || 0;
        const timeB = b.trigger_time_unix_ms || 0;
        return timeA - timeB;
      })
    : [];

  const currentStepIndex = sortedSteps.findIndex(s => !s.completed);
  const currentStep = currentStepIndex !== -1 ? sortedSteps[currentStepIndex] : null;
  const totalSteps = sortedSteps.length;
  const nextStep = currentStepIndex !== -1 && currentStepIndex + 1 < totalSteps ? sortedSteps[currentStepIndex + 1] : null;

  useEffect(() => {
    setHintText(null);
  }, [currentStep?.id]);

  const hasCalendarEvents = activeTask?.steps?.some(s => s.calendarEventId) || false;

  const allCompleted = totalSteps > 0 && sortedSteps.every(s => s.completed);

  const getRecipientFirstName = (email: string) => {
    const parts = email.split('@')[0];
    const name = parts.replace(/[._-]/g, ' ');
    return name.charAt(0).toUpperCase() + name.slice(1);
  };

  const getDeadlineGapMinutes = () => {
    if (!deadline) return 300;
    const now = Date.now();
    const dl = new Date(deadline).getTime();
    return Math.max(0, (dl - now) / (60 * 1000));
  };

  const gapMins = getDeadlineGapMinutes();
  let tierName = "TRAINING MISSION";
  let tierColor = "#22C55E";
  let tierBg = "rgba(34, 197, 94, 0.15)";

  if (gapMins < 90) {
    tierName = "CRITICAL MISSION";
    tierColor = "#EF4444";
    tierBg = "rgba(239, 68, 68, 0.15)";
  } else if (gapMins <= 240) {
    tierName = "STANDARD MISSION";
    tierColor = "#F59E0B";
    tierBg = "rgba(245, 158, 11, 0.15)";
  }

  const totalStepsXP = XP_MISSION_COMPLETE + (activeTask?.steps?.length || 0) * XP_PER_STEP;

  const getTimeRemainingMinutes = () => {
    if (!activeTask?.deadline) return 300;
    const now = Date.now();
    const dl = new Date(activeTask.deadline).getTime();
    return Math.max(0, (dl - now) / (60 * 1000));
  };

  const renderUrgencyLine = () => {
    const remMins = getTimeRemainingMinutes();
    if (remMins >= 180) return null;

    if (remMins < 20) {
      return <p className="text-[#EF4444] text-[13px] font-mono font-bold uppercase tracking-wider text-center my-2">ColdBreak is stepping in.</p>;
    } else if (remMins < 45) {
      return <p className="text-[#F59E0B] text-[13px] font-mono font-bold uppercase tracking-wider text-center my-2">Getting tight.</p>;
    } else if (remMins < 90) {
      return <p className="text-[#F59E0B] text-[13px] font-mono uppercase tracking-wider text-center my-2">Time to focus.</p>;
    }
    return null;
  };

  // Build a Honesty Gate-compliant crisis message preview
  // Must NOT assert current task status, must ONLY offer an honest ETA extension
  const graceMinsForDisplay = gracePeriodMinutes ?? 30;
  const newEtaForDisplay = new Date(Date.now() + graceMinsForDisplay * 60 * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const recipientDisplayName = getRecipientFirstName(activeTask?.recipient || 'Partner');
  const crisisMsgText = `Hi ${recipientDisplayName}, I need a bit more time on this. I'll have it to you by ${newEtaForDisplay}. Thanks for your patience.`;

  const handleCompleteStepClick = () => {
    if (!currentStep) return;
    setShowXpFlash(true);
    setTimeout(() => setShowXpFlash(false), 800);

    setSessionXP(prev => prev + XP_PER_STEP);

    const isLastStep = sortedSteps.filter(s => !s.completed).length === 1;
    if (isLastStep) {
      setSessionXP(prev => prev + XP_MISSION_COMPLETE);
      setTimeout(() => {
        setAppPhase('debrief');
      }, 1200);
    }

    toggleStepCompletion(currentStep.id);
  };

  const handleHintClick = () => {
    setShowHint(true);
    setTimeout(() => setShowHint(false), 8000);
  };

  const getHintText = (text: string) => {
    const words = text.trim().split(/\s+/);
    if (words.length <= 3) return text;
    return words.slice(0, 3).join(" ");
  };

  const handleChipSelect = (chip: string) => {
    setSelectedChip(chip);
    const now = Date.now();
    let targetTimeMs = now;
    let diffMins = 0;

    if (chip === '30 min') {
      diffMins = 30;
      targetTimeMs = now + 30 * 60 * 1000;
    } else if (chip === '1 hour') {
      diffMins = 60;
      targetTimeMs = now + 60 * 60 * 1000;
    } else if (chip === '2 hours') {
      diffMins = 120;
      targetTimeMs = now + 120 * 60 * 1000;
    } else if (chip === '3 hours') {
      diffMins = 180;
      targetTimeMs = now + 180 * 60 * 1000;
    } else if (chip === 'Tonight') {
      const today = new Date();
      today.setHours(23, 0, 0, 0);
      targetTimeMs = today.getTime();
      diffMins = Math.max(0, (targetTimeMs - now) / (60 * 1000));
    } else if (chip === 'Tomorrow') {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      targetTimeMs = tomorrow.getTime();
      diffMins = Math.max(0, (targetTimeMs - now) / (60 * 1000));
    }

    const targetDate = new Date(targetTimeMs);
    const year = targetDate.getFullYear();
    const month = String(targetDate.getMonth() + 1).padStart(2, '0');
    const day = String(targetDate.getDate()).padStart(2, '0');
    const hours = String(targetDate.getHours()).padStart(2, '0');
    const minutes = String(targetDate.getMinutes()).padStart(2, '0');
    const localIso = `${year}-${month}-${day}T${hours}:${minutes}`;
    setDeadline(localIso);

    if (diffMins < 90) {
      setDifficulty('hard');
      setImportance('high_consequence');
    } else if (diffMins <= 240) {
      setDifficulty('medium');
      setImportance('someone_waiting');
    } else {
      setDifficulty('easy');
      setImportance('low_external');
    }
    setDeadlineFlexible(false);
  };

  const handleCancelCrisis = async () => {
    if (!activeTask) return;
    const path = `tasks/${activeTask.id}`;
    try {
      const taskRef = doc(db, 'tasks', activeTask.id);
      await updateDoc(taskRef, {
        watchdogTriggered: false
      });
      setGracePeriodMinutes(null);
      setShowCustomGrace(false);
      setCustomGraceInput('');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const loadContextFiles = (uid: string) => {
    if (contextFilesUnsubRef.current) {
      contextFilesUnsubRef.current();
    }
    const path = `users/${uid}/context_files`;
    try {
      const filesColRef = collection(db, 'users', uid, 'context_files');
      const unsub = onSnapshot(filesColRef, (snap) => {
        const filesList: any[] = [];
        snap.forEach(docSnap => {
          filesList.push({ id: docSnap.id, ...docSnap.data() });
        });
        setContextFiles(filesList);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, path);
      });
      contextFilesUnsubRef.current = unsub;
      return unsub;
    } catch (err) {
      console.error("Failed to subscribe to context files:", err);
    }
  };

  const handleUploadContextFile = async (file: File) => {
    const activeUid = user?.uid || "demo-user-001";
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      alert("File is too large. Maximum allowed size is 2MB.");
      return;
    }

    setIsUploadingContext(true);
    setContextProgress("Reading file...");

    try {
      const reader = new FileReader();
      if (file.type === 'application/pdf') {
        reader.onload = async (e) => {
          try {
            const base64Data = (e.target?.result as string).split(',')[1];
            const { saveContextFile } = await import('./rag-client');
            await saveContextFile(activeUid, file.name, file.type, base64Data, (prog) => {
              setContextProgress(prog);
            }, file.size);
          } catch (err: any) {
            console.error("Failed to process context file:", err);
            alert("RAG file processing failed: " + err.message);
          } finally {
            setIsUploadingContext(false);
            setContextProgress("");
          }
        };
        reader.readAsDataURL(file);
      } else if (file.type === 'text/plain' || file.name.endsWith('.md') || file.name.endsWith('.txt')) {
        reader.onload = async (e) => {
          try {
            const rawText = e.target?.result as string;
            const { saveContextFile } = await import('./rag-client');
            await saveContextFile(activeUid, file.name, file.type, rawText, (prog) => {
              setContextProgress(prog);
            }, file.size);
          } catch (err: any) {
            console.error("Failed to process context file:", err);
            alert("RAG file processing failed: " + err.message);
          } finally {
            setIsUploadingContext(false);
            setContextProgress("");
          }
        };
        reader.readAsText(file);
      } else {
        alert("Unsupported file type. Please upload a PDF, .txt, or .md file.");
        setIsUploadingContext(false);
        setContextProgress("");
      }
    } catch (err: any) {
      console.error("File upload error:", err);
      alert("File upload error: " + err.message);
      setIsUploadingContext(false);
      setContextProgress("");
    }
  };

  const handleDeleteContextFile = async (fileId: string) => {
    const activeUid = user?.uid || "demo-user-001";

    // Use inline confirm state instead of window.confirm — window.confirm is
    // suppressed in many iframe/demo environments and silently aborts the delete.
    if (confirmDeleteId !== fileId) {
      setConfirmDeleteId(fileId);
      return;
    }

    // Confirmed. Dismiss the inline prompt and optimistically hide the row.
    setConfirmDeleteId(null);
    setDeletingFileIds(prev => new Set([...prev, fileId]));

    try {
      const { deleteContextFile } = await import('./rag-client');
      await deleteContextFile(activeUid, fileId);
      // onSnapshot fires and removes the file from contextFiles.
      // Clean up deletingFileIds so the set doesn't grow unbounded during the session.
      setDeletingFileIds(prev => {
        const next = new Set(prev);
        next.delete(fileId);
        return next;
      });
    } catch (err: any) {
      console.error("Failed to delete context document:", err);
      alert("Failed to delete context document: " + err.message);
      // Un-hide the row so the user can retry.
      setDeletingFileIds(prev => {
        const next = new Set(prev);
        next.delete(fileId);
        return next;
      });
    }
  };

  const handlePurgeAllContextFiles = async () => {
    const activeUid = user?.uid || "demo-user-001";
    if (contextFiles.length === 0) return;

    // Inline confirm: first click arms it, second click fires.
    if (confirmDeleteId !== 'PURGE_ALL') {
      setConfirmDeleteId('PURGE_ALL');
      return;
    }

    setConfirmDeleteId(null);
    setIsPurgingAll(true);

    try {
      const { purgeAllContextFiles } = await import('./rag-client');
      await purgeAllContextFiles(activeUid);
      // onSnapshot will clear contextFiles automatically.
    } catch (err: any) {
      console.error("Failed to purge all context documents:", err);
      alert("Purge All failed: " + err.message);
    } finally {
      setIsPurgingAll(false);
    }
  };

  // Load auth state - Dynamic check with demo session fallback
  useEffect(() => {
    const unsubscribe = initAuth(
      async (currentUser, activeToken) => {
        setUser(currentUser);
        setToken(activeToken);
        setNeedsAuth(false);
        await loadUserProfile(currentUser.uid);
        loadActiveTask(currentUser.uid);
        loadContextFiles(currentUser.uid);
      },
      () => {
        // Fall back to demo user so the user can try the app instantly
        const demoUser = {
          uid: "demo-user-001",
          email: "operator@coldbreak.app",
          displayName: "Cryo Operator"
        };
        setUser(demoUser);
        setToken("demo-token-12345"); 
        setNeedsAuth(false);

        const rebootDemoTask = async () => {
          try {
            const taskRef = doc(db, 'tasks', "demo-user-001");
            await deleteDoc(taskRef);
          } catch (err) {
            console.warn("Failed to reset demo document:", err);
          }
        };
        rebootDemoTask();

        loadUserProfile("demo-user-001");
        loadActiveTask("demo-user-001");
        loadContextFiles("demo-user-001");
      }
    );

    return () => {
      unsubscribe();
      if (contextFilesUnsubRef.current) {
        contextFilesUnsubRef.current();
      }
    };
  }, []);

  // Fetch or create user profile in Firestore
  const loadUserProfile = async (uid: string) => {
    const activeUid = uid || "demo-user-001";
    try {
      const profile = await getUserProfile();
      if (profile) {
        setTotalXP(profile.totalXP ?? 150);
        setCurrentStreak(profile.currentStreak ?? 3);
        setMissionsCompleted(profile.missionsCompleted ?? 2);
        setColdStreak(profile.currentStreak ?? 3); // Keep coldStreak in sync
        setGamma(profile.gamma ?? 0.5);
        setArchetype((profile.archetype as ArchetypeType) ?? 'deadline_dancer');
        setCompletionCount(profile.missionsCompleted ?? 2);
        setFrostShards(profile.frostShards ?? 150);
        setTotalBreaches(profile.totalBreaches ?? 1);
        setCryoSavesRemaining(profile.cryoSavesRemaining ?? 5);
        setCryoSavesUsed(profile.cryoSavesUsed ?? 0);
      } else {
        const initialProfile = {
          totalXP: 150,
          currentStreak: 3,
          missionsCompleted: 2,
          lastMissionDate: null,
          gamma: 0.5,
          archetype: 'deadline_dancer' as const,
          frostShards: 150,
          totalBreaches: 1,
          cryoSavesRemaining: 5,
          cryoSavesUsed: 0
        };
        await updateUserProfile(initialProfile);
        setTotalXP(150);
        setCurrentStreak(3);
        setMissionsCompleted(2);
        setColdStreak(3);
        setGamma(0.5);
        setArchetype('deadline_dancer');
        setCompletionCount(2);
        setFrostShards(150);
        setTotalBreaches(1);
        setCryoSavesRemaining(5);
        setCryoSavesUsed(0);
      }
      // Load last 5 missions
      const history = await getMissionHistory(5);
      setMissionHistory(history || []);
      setProfileLoaded(true);
    } catch (err) {
      console.error("Error loading user profile:", err);
    }
  };

  // Fetch active task from Firestore and subscribe to real-time updates
  const loadActiveTask = (uid: string) => {
    const taskRef = doc(db, 'tasks', uid);
    return onSnapshot(taskRef, (docSnap: any) => {
      if (docSnap.exists()) {
        const taskData = docSnap.data() as Task;
        if (!taskData || !taskData.taskText) {
          setActiveTask(null);
          setReactLogs([]);
          return;
        }
        setActiveTask(taskData);
        setReactLogs(taskData.reactLogs || []);

        // Calculate unlocked steps count for Paralyzed Planner archetype
        if (taskData.steps) {
          const completedCount = taskData.steps.filter(s => s.completed).length;
          setUnlockedStepCount(completedCount + 1);
        }
      } else {
        setActiveTask(null);
        setReactLogs([]);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `tasks/${uid}`);
    });
  };

  // Real-time calculation of M-Score
  useEffect(() => {
    if (!deadline) {
      setCurrentMScore(100);
      setHoursToDeadline(0);
      return;
    }

    const interval = setInterval(() => {
      const now = new Date();
      const dl = new Date(deadline);
      const diffMs = dl.getTime() - now.getTime();
      let diffHours = Math.max(0, diffMs / (1000 * 60 * 60));
      if (isNaN(diffHours)) {
        diffHours = 0;
      }
      setHoursToDeadline(diffHours);

      // Urgency Formula: U = (E * V) / (1 + Gamma * D)
      const rawExpectancy = Number(expectancy) || 8;
      const rawValue = Number(value) || 8;
      const rawGamma = Number(gamma) || 0.5;

      const E_val = rawExpectancy > 1.0 ? rawExpectancy / 10 : rawExpectancy;
      const V_val = rawValue;
      const raw_U = (E_val * V_val) / (1 + rawGamma * diffHours);

      // Normalize against an 8-hour comfortable baseline so same-day tasks can still read green
      // urgencyRatio: 1.0 at 8h remaining, grows as deadline closes in
      // score: 100 at 8h+, ~80 at 6h, ~50 at 3h, ~30 at 1h (much more intuitive)
      const U_baseline = (E_val * V_val) / (1 + rawGamma * 8);
      const urgencyRatio = U_baseline > 0 ? raw_U / U_baseline : 1;
      const calculatedScore = Math.min(100, Math.max(0, Math.round(100 / urgencyRatio)));
      setCurrentMScore(isNaN(calculatedScore) ? 100 : calculatedScore);
    }, 1000);

    return () => clearInterval(interval);
  }, [deadline, expectancy, value, gamma]);

  // Purely cosmetic typewriter reveal for the crisis message inside mayday mode
  useEffect(() => {
    if (uiScreen !== 'active_operation' || !activeTask?.watchdogTriggered) {
      setRevealedCrisisText("");
      return;
    }
    
    // Build the same Honesty Gate-compliant text for the typewriter reveal
    const graceMinsReveal = gracePeriodMinutes ?? 30;
    const etaReveal = new Date(Date.now() + graceMinsReveal * 60 * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const recipientReveal = getRecipientFirstName(activeTask?.recipient || 'Partner');
    const targetText = `Hi ${recipientReveal}, I need a bit more time on this. I'll have it to you by ${etaReveal}. Thanks for your patience.`;
    setRevealedCrisisText("");
    let i = 0;
    const interval = setInterval(() => {
      i += 3;
      setRevealedCrisisText(targetText.slice(0, i));
      if (i >= targetText.length) clearInterval(interval);
    }, 12);
    return () => clearInterval(interval);
  }, [activeTask?.watchdogTriggered, gracePeriodMinutes, uiScreen]);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setUser(result.user);
        setToken(result.accessToken);
        setNeedsAuth(false);
        await loadUserProfile(result.user.uid);
        loadActiveTask(result.user.uid);
      }
    } catch (err: any) {
      console.error('Login failed:', err);
      const errMsg = err?.message || '';
      const errCode = err?.code || '';
      if (errMsg.includes('popup-closed-by-user') || errCode.includes('popup-closed-by-user')) {
        setLoginError("The sign-in popup was blocked or closed. Since the app is running in a preview iframe, browser cross-origin cookie policies or popup blockers usually block authentication. To sign in easily, open the app in a new tab.");
      } else {
        setLoginError(errMsg || "An error occurred during Google sign-in. Please try again.");
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    if (window.confirm("Would you like to reset your stasis session? This will refresh the page with the default profile.")) {
      try {
        await fetch("/api/watchdog/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId: user?.uid || "demo-user-001" })
        });
      } catch (err) {
        console.warn("Could not cancel watchdog on signout:", err);
      }
      window.location.reload();
    }
  };

  // Save profile settings to the correct Firestore path: users/{uid}/profile/data
  // (Previously wrote to users/{uid} root — wrong path, never read back)
  const saveProfileSettings = async (newGamma: number, newArchetype: ArchetypeType) => {
    try {
      await updateUserProfile({
        gamma: newGamma,
        archetype: newArchetype,
      });
      setGamma(newGamma);
      setArchetype(newArchetype);
    } catch (err) {
      console.error("Error saving profile settings:", err);
    }
  };

  // Submit task to the autonomous ReAct agent loop
  const handleLaunchAgent = async (e: FormEvent) => {
    e.preventDefault();
    const activeUid = user?.uid || "demo-user-001";
    if (!taskText || !deadline || !recipient) return;

    setIsProcessing(true);

    // Calculate E and V silently
    let E = 0.70;
    if (difficulty === 'easy') E = 0.88;
    else if (difficulty === 'medium') E = 0.70;
    else if (difficulty === 'hard') E = 0.52;

    if (selfDifficulty === 'easy') {
      E = Math.min(E + 0.10, 0.90);
    } else if (selfDifficulty === 'tough') {
      E = Math.max(E - 0.10, 0.45);
    } else if (selfDifficulty === 'dreading') {
      E = Math.max(E - 0.18, 0.40);
    }

    let V = 7.0;
    const V_MAP: Record<ImportanceLevel, number> = {
      personal_only: 2.5,
      low_external: 4.5,
      someone_waiting: 7.0,
      high_consequence: 8.5,
      critical: 9.8
    };
    V = V_MAP[importance] ?? 7.0;

    const mappedStake = (importance === 'critical' || importance === 'high_consequence') ? 'high' : ((importance === 'personal_only' || importance === 'low_external') ? 'low' : 'medium');

    try {
      // 1. Initialize empty task in Firestore so the user can watch ReAct boot logs
      const taskRef = doc(db, 'tasks', activeUid);
      const tempTask: Task = {
        id: activeUid,
        userId: activeUid,
        taskText,
        task_name: taskText,
        recipient,
        deadline,
        originalDeadline: deadline,
        stakeLevel: mappedStake,
        status: 'analyzing',
        mScore: currentMScore,
        expectancy: E * 10,
        value: V,
        watchdogTime: '',
        watchdogTriggered: false,
        steps: [],
        reactLogs: [
          {
            step: 1,
            thought: "Sentinel Cryogenic Watchdog active. Initiating stasis deployment protocols...",
            tool: "analyze_task",
            result: "Triggering analytical array...",
            timestamp: new Date().toISOString()
          }
        ],
        createdAt: new Date().toISOString(),
        difficulty,
        importance,
        deadline_flexible: deadlineFlexible,
        submissionFormat,
        assignmentInstructions: assignmentInstructions || ""
      };
      await setDoc(taskRef, tempTask);

      // 1b. Fetch hyperpersonalization contexts from RAG pipeline
      let retrievedContexts: string[] = [];
      try {
        const { retrieveRelevantContexts } = await import('./rag-client');
        const query = assignmentInstructions ? `${taskText}. ${assignmentInstructions}` : taskText;
        retrievedContexts = await retrieveRelevantContexts(activeUid, query);
        console.log(`[RAG] Retrieved ${retrievedContexts.length} personalized context chunks.`);
      } catch (ragErr) {
        console.error("[RAG] Failed to retrieve context chunk vectors:", ragErr);
      }

      // 2. Call backend express ReAct loop
      const response = await fetch("/api/tasks/react-loop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskText,
          deadline,
          recipient,
          stakeLevel: mappedStake,
          expectancy: E * 10,
          value: V,
          gamma,
          archetype,
          accessToken: token,
          difficulty,
          importance,
          deadline_flexible: deadlineFlexible,
          step_depth: stepDepth,
          recipient_name: recipientName || undefined,
          self_difficulty: selfDifficulty,
          user_time_estimate: userTimeEstimate,
          contexts: retrievedContexts
        })
      });

      if (!response.ok) {
        throw new Error("Failed to process autonomous ReAct loop.");
      }

      const result = await response.json();

      // Update Firestore with the completed ReAct execution state
      await updateDoc(taskRef, {
        status: result.status,
        steps: result.steps,
        watchdogTime: result.watchdogTime,
        reactLogs: result.logs,
        difficulty: result.difficulty || difficulty,
        importance: result.importance || importance,
        deadline_flexible: result.deadline_flexible !== undefined ? result.deadline_flexible : deadlineFlexible,
        expectancy: result.expectancy || (E * 10),
        value: result.value || V
      });

      // Track whether this plan was personalized by RAG context docs
      setRagUsed(result.rag_used === true);

      // Register the watchdog on the backend
      const activeUidForWatchdog = user?.uid || "demo-user-001";
      await fetch("/api/watchdog/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: activeUidForWatchdog,
          deadline,
          recipient,
          accessToken: token || "demo-token-12345",
          taskText,
          recipient_name: recipientName || undefined
        })
      });

    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `tasks/${activeUid}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Check off a step in our task
  const toggleStepCompletion = async (stepId: string) => {
    if (!activeTask) return;

    const updatedSteps = activeTask.steps.map(step => {
      if (step.id === stepId) {
        return { ...step, completed: !step.completed };
      }
      return step;
    });

    const allCompleted = updatedSteps.every(s => s.completed);
    const newStatus = allCompleted ? 'completed' : 'active';

    let firstStepCompletedAt = activeTask.firstStepCompletedAt || null;
    const sortedStepsForCompletion = [...activeTask.steps].sort((a, b) => {
      const toMins = (t: string) => {
        const m = t.match(/(\d+):(\d+)\s*(AM|PM)/i);
        if (!m) return 0;
        let h = parseInt(m[1]);
        const min = parseInt(m[2]);
        if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
        if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
        return h * 60 + min;
      };
      return toMins(a.time) - toMins(b.time);
    });

    const isFirstStepId = sortedStepsForCompletion.length > 0 && sortedStepsForCompletion[0].id === stepId;
    const firstStepNowCompleted = updatedSteps.find(s => s.id === stepId)?.completed;
    if (isFirstStepId && firstStepNowCompleted && !firstStepCompletedAt) {
      firstStepCompletedAt = new Date().toISOString();
    }

    let taskCompletedAt = activeTask.taskCompletedAt || null;
    if (allCompleted) {
      taskCompletedAt = new Date().toISOString();
    }

    try {
      const taskRef = doc(db, 'tasks', activeTask.id);
      const updates: any = {
        steps: updatedSteps,
        status: newStatus
      };
      if (firstStepCompletedAt) {
        updates.firstStepCompletedAt = firstStepCompletedAt;
      }
      if (taskCompletedAt) {
        updates.taskCompletedAt = taskCompletedAt;
      }
      await updateDoc(taskRef, updates);

      // Reward step completion XP instantly (Section 2)
      const stepCompleted = updatedSteps.find(s => s.id === stepId)?.completed;
      const xpDiff = stepCompleted ? XP_PER_STEP : -XP_PER_STEP;
      setSessionXP(prev => prev + xpDiff);
      
      const newTotalXP = Math.max(0, totalXP + xpDiff);
      setTotalXP(newTotalXP);
      await updateUserProfile({ totalXP: newTotalXP });

      if (stepCompleted) {
        setXpFlashText(`+${XP_PER_STEP} XP!`);
        setXpFlashVisible(true);
        setTimeout(() => setXpFlashVisible(false), 2000);

        // Nudge / Interrupt engine trigger (Section 4)
        if (archetype === 'context_switcher' || reminderMode === 'every-step') {
          setNudgeVisible(true);
        }
      }

      // Reward currency on completing steps!
      if (firstStepNowCompleted) {
        setFrostShards(prev => prev + 15);
      }

      if (allCompleted) {
        await fetch("/api/watchdog/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId: activeTask.id })
        });
        
        // Trigger After Action Report (Debrief)
        setDebriefStep(1);
        setDebriefHardestPart("");
        setDebriefRating(0);
        setDebriefInsight("");
        setIsDebriefOpen(true);
        setAppPhase('debrief');
        setUiScreen('after_action_report');
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `tasks/${activeTask.id}`);
    }
  };

  // Process debrief submission — calls /api/debrief, updates profile
  const handleDebriefSubmit = async () => {
    if (!activeTask) return;
    setIsDebriefProcessing(true);

    try {
      const res = await fetch("/api/debrief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hardestPart: debriefHardestPart,
          createdAt: activeTask.createdAt,
          deadline: activeTask.deadline,
          rating: debriefRating || 5,
          currentGamma: gamma,
          first_step_completion_timestamp: activeTask.firstStepCompletedAt || null,
          task_completed_timestamp: activeTask.taskCompletedAt || new Date().toISOString()
        }),
      });

      if (!res.ok) throw new Error("Debrief API failed");

      const data = await res.json();

      // Streak calculation (consecutive day checking) (Section 2)
      const todayStr = new Date().toISOString().split('T')[0];
      const profileObj = await getUserProfile();
      let lastMissionDate = profileObj?.lastMissionDate || null;
      let newStreak = currentStreak;

      if (!lastMissionDate) {
        newStreak = 1;
      } else {
        const lastDate = new Date(lastMissionDate);
        const todayDate = new Date(todayStr);
        const diffTime = Math.abs(todayDate.getTime() - lastDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays === 1) {
          newStreak = currentStreak + 1;
        } else if (diffDays === 0) {
          newStreak = currentStreak;
        } else {
          newStreak = 1;
        }
      }

      // Calculate XP rewards (Section 2)
      const debriefXP = XP_DEBRIEF_BONUS;
      const streakXP = Math.min(100, XP_STREAK_BONUS * newStreak);
      const totalDebriefXPEarned = debriefXP + streakXP;

      setSessionXP(prev => prev + totalDebriefXPEarned);
      const finalXP = totalXP + totalDebriefXPEarned;
      setTotalXP(finalXP);
      setCurrentStreak(newStreak);
      setColdStreak(newStreak); // Keep coldStreak in sync

      setXpFlashText(`+${totalDebriefXPEarned} XP! (${debriefXP} Debrief + ${streakXP} Streak Bonus)`);
      setXpFlashVisible(true);
      setTimeout(() => setXpFlashVisible(false), 3000);

      // Save user profile state
      const updatedCompletions = missionsCompleted + 1;
      setMissionsCompleted(updatedCompletions);
      setCompletionCount(updatedCompletions);
      setFrostShards(prev => prev + 50); // bonus on complete operations

      await updateUserProfile({
        totalXP: finalXP,
        currentStreak: newStreak,
        missionsCompleted: updatedCompletions,
        lastMissionDate: todayStr,
        gamma: data.newGamma || gamma,
        archetype: archetype
      });

      // Save the mission to database history (Section 2)
      const stepsCompleted = activeTask.steps.filter(s => s.completed).length;
      const stepsTotal = activeTask.steps.length;
      await saveMissionToHistory({
        taskText: activeTask.taskText,
        xpEarned: totalDebriefXPEarned + (stepsCompleted * XP_PER_STEP),
        stepsCompleted,
        stepsTotal,
        complete: true
      });

      // Persist debrief to task doc safely with merge: true
      const taskRef = doc(db, 'tasks', activeTask.id);
      await setDoc(taskRef, {
        debrief: {
          hardestPart: debriefHardestPart,
          rating: debriefRating || 5,
          submitted: true,
          blockerType: data.blockerType,
          insight: data.insight,
          newGamma: data.newGamma,
        }
      }, { merge: true });

      // Refresh mission history logs list (Section 5)
      const history = await getMissionHistory(5);
      setMissionHistory(history || []);

      setDebriefInsight(data.insight);
      setDebriefStep(3); 
    } catch (err) {
      console.error("Debrief processing error:", err);
      setDebriefInsight("Sub-zero stasis secured. Containment efficiency logged.");
      setDebriefStep(3);
    } finally {
      setIsDebriefProcessing(false);
    }
  };

  const handleResetTask = async () => {
    const activeUid = user?.uid || "demo-user-001";

    setSubmissionFormat('PDF');
    setAssignmentInstructions('');
    setIsAutoSubmitting(false);
    setIsCryoSaveModalOpen(false);

    setActiveTask(null);
    setTaskText('');
    setRecipient('');
    setDeadline(getTomorrow5PM());
    setHintText(null);
    setAppPhase('welcome');
    setSelectedChip(null);
    setSessionXP(0);
    setMicroSteps([]);
    setMicroCompleted([]);
    setIsReasoningOpen(false);
    setIsDebriefOpen(false);
    setHasManualDeadline(false);

    try {
      const taskRef = doc(db, 'tasks', activeUid);
      await deleteDoc(taskRef); // FIX: deleteDoc not setDoc({}) — avoids ghost document that onSnapshot misreads
      await fetch("/api/watchdog/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: activeUid })
      });
    } catch (err) {
      console.error("Failed to reset task in database:", err);
    }
  };

  // Force trigger watchdog immediately for easy testing of Gmail outputs
  const handleForceWatchdog = async () => {
    if (!activeTask) return;
    try {
      const taskRef = doc(db, 'tasks', activeTask.id);
      await updateDoc(taskRef, {
        watchdogTriggered: true
      });
      setGracePeriodMinutes(null);
    } catch (err) {
      console.error("Failed to force trigger watchdog:", err);
    }
  };

  const handleSendCrisisAction = async (graceMins: number) => {
    if (!activeTask) return;

    setIsCrisisSending(true);
    try {
      const activeUid = user?.uid || "demo-user-001";
      const res = await fetch("/api/crisis-trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: activeTask.recipient,
          deadline: activeTask.deadline,
          accessToken: token || "demo-token-12345",
          taskText: activeTask.taskText,
          gracePeriodMinutes: graceMins
        })
      });

      // FIX: Handle 401 token expiry immediately — don't try to parse body
      if (res.status === 401) {
        try { sessionStorage.removeItem('cb_access_token'); } catch (_) {}
        setToken(null);
        setNeedsAuth(true);
        throw new Error("Session expired. Please sign in again to send the holding message.");
      }

      let data: any = {};
      try { data = await res.json(); } catch (_) {}

      if (res.ok) {
        const currentAttemptNum = (activeTask.crisisAttemptCount || 0) + 1;
        const logTurn8: ReactLogEntry = {
          step: 8 + currentAttemptNum * 2,
          thought: `Containment Breach (Mayday #${currentAttemptNum}) intercepted. Operative requested ${graceMins}m grace. Enforcing honest reporting protocols...`,
          tool: "generate_crisis_message",
          result: data.message,
          timestamp: new Date().toISOString()
        };
        const logTurn9: ReactLogEntry = {
          step: 9 + currentAttemptNum * 2,
          thought: "Honest status transmission transmitted via stakeholder channel.",
          tool: "send_gmail",
          result: `Status: 200 OK. Message sent via primary grid. Adjusted ETA: ${data.new_eta_display}. Transmission: ${data.status === 'sent' ? 'LIVE' : 'SIMULATED DEMO'}.`,
          timestamp: new Date().toISOString()
        };

        const updatedLogs = [...reactLogs, logTurn8, logTurn9];
        const taskRef = doc(db, 'tasks', activeTask.id);

        if ((activeTask.crisisAttemptCount || 0) >= 2) {
          // Failure State
          await updateDoc(taskRef, {
            status: 'failed',
            watchdogTriggered: false,
            reactLogs: updatedLogs
          });
          setReactLogs(updatedLogs);
          setTotalBreaches(prev => prev + 1);
        } else {
          // Extension State
          await updateDoc(taskRef, {
            watchdogTriggered: false,
            status: 'active',
            // FIX: null guard — if API 500s and new_eta_ms is undefined, fall back to graceMins from now
            deadline: data.new_eta_ms
              ? new Date(data.new_eta_ms).toISOString()
              : new Date(Date.now() + (graceMins || 30) * 60 * 1000).toISOString(),
            crisisAttemptCount: currentAttemptNum,
            reactLogs: updatedLogs
          });

          // Increment Breaches tracker
          setTotalBreaches(prev => prev + 1);

          setCrisisSuccessBanner(`Holding update dispatched to ${activeTask.recipient}. New commitment: ${data.new_eta_display}.`);
          setTimeout(() => {
            setCrisisSuccessBanner(null);
          }, 6000);

          setGracePeriodMinutes(null);
        }
      } else {
        throw new Error(data.error || "Failed to trigger crisis update");
      }
    } catch (err: any) {
      console.error("Error sending holding status:", err);
      alert("Crisis transmission failure: " + err.message);
    } finally {
      setIsCrisisSending(false);
    }
  };

  const getCryoSaveStatus = () => {
    if (cryoSavesRemaining <= 0) {
      return {
        status: 'Exhausted',
        label: 'CRYO-SAVE CAPABLE: Exhausted',
        color: 'text-rose-500 border-rose-500/20 bg-rose-500/5',
        desc: 'No Cryo-Saves remaining.'
      };
    }
    if (contextFiles.length === 0) {
      return {
        status: 'Offline',
        label: 'CRYO-SAVE CAPABLE: Offline (No Context Documents)',
        color: 'text-amber-500 border-amber-500/20 bg-amber-500/5',
        desc: 'To enable Cryo-Save, you must have uploaded RAG context documents on the welcome screen.'
      };
    }
    return {
      status: 'Ready',
      label: 'CRYO-SAVE CAPABLE: Ready (Uses 1 Save)',
      color: 'text-emerald-400 border-emerald-400/20 bg-emerald-400/5',
      desc: 'Ready for emergency stasis deployment.'
    };
  };

  const cryoSaveStatus = getCryoSaveStatus();

  const handleTriggerCryoSave = async () => {
    if (!activeTask) return;
    setIsCryoSaveReviewOpen(true);
    setCryoDraftLoading(true);
    setCryoTimerRemaining(210); // 3.5 minutes countdown (between 3 and 4 mins)
    setIsTimerPaused(false);

    try {
      // 1. Gather context chunk texts from the RAG pipeline (context_files docs
      // only hold metadata — the actual chunk text lives in context_chunks).
      const fileTexts = await retrieveAllContextChunks(user?.uid || "demo-user-001");

      // 2. Make POST request to /api/cryo-save with generateOnly: true
      const response = await fetch("/api/cryo-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user?.uid || "demo-user-001",
          taskText: activeTask.taskText,
          assignmentInstructions: activeTask.assignmentInstructions || "",
          submissionFormat: activeTask.submissionFormat || "PDF",
          recipient: activeTask.recipient,
          accessToken: token || "demo-token-12345",
          contexts: fileTexts,
          taskId: activeTask.id,
          generateOnly: true // This will return the draft instead of sending
        })
      });

      if (!response.ok) {
        throw new Error("Failed to generate Cryo-Save draft.");
      }

      const resData = await response.json();
      setCryoDraftTitle(resData.title || "Emergency Submission");
      setCryoDraftContent(resData.content || "");
    } catch (err) {
      console.error("Error generating Cryo-Save draft:", err);
      setCryoDraftTitle("Error Generating Draft");
      setCryoDraftContent("We could not automatically compile your context files. You can still proceed with sending the fallback stasis notification.");
    } finally {
      setCryoDraftLoading(false);
    }
  };

  const handleConfirmCryoSave = async () => {
    if (!activeTask) return;
    setIsCryoSaveReviewOpen(false);
    setIsCryoSaveModalOpen(false);
    setIsAutoSubmitting(true);

    try {
      // 1. Gather context file texts
      console.log(`[Cryo-Save] Retrieving chunks for userId: ${user?.uid || "demo-user-001"}`);
      const fileTexts = await retrieveAllContextChunks(user?.uid || "demo-user-001");

      // 2. Fetch the user's access token
      const accessToken = token || "demo-token-12345";

      // 3. Make POST request to /api/cryo-save
      const response = await fetch("/api/cryo-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user?.uid || "demo-user-001",
          taskText: activeTask.taskText,
          assignmentInstructions: activeTask.assignmentInstructions || "",
          submissionFormat: activeTask.submissionFormat || "PDF",
          recipient: activeTask.recipient,
          accessToken,
          contexts: fileTexts,
          taskId: activeTask.id
        })
      });

      if (!response.ok) {
        throw new Error("Cryo-Save Auto-Submission API failed.");
      }

      const resData = await response.json();

      // 4. Update the user profile: decrement cryoSavesRemaining, increment cryoSavesUsed, apply -50 XP penalty
      const newSavesRemaining = Math.max(0, cryoSavesRemaining - 1);
      const newSavesUsed = cryoSavesUsed + 1;
      const penaltyXp = Math.max(0, totalXP - 50);

      setCryoSavesRemaining(newSavesRemaining);
      setCryoSavesUsed(newSavesUsed);
      setTotalXP(penaltyXp);

      await updateUserProfile({
        cryoSavesRemaining: newSavesRemaining,
        cryoSavesUsed: newSavesUsed,
        totalXP: penaltyXp
      });

      // Show XP Flash text
      setXpFlashText("-50 XP (Cryo-Save Penalty)");
      setXpFlashVisible(true);
      setTimeout(() => setXpFlashVisible(false), 3000);

      // 5. Update task document in Firestore safely
      const updatedSteps = activeTask.steps.map(step => ({ ...step, completed: true }));
      const taskRef = doc(db, 'tasks', activeTask.id);
      
      const fullUpdatedTask = {
        ...activeTask,
        status: 'completed' as const,
        steps: updatedSteps,
        watchdogTriggered: false,
        autoSubmitted: true,
        taskCompletedAt: new Date().toISOString()
      };
      
      await setDoc(taskRef, fullUpdatedTask);

      // Clear watchdogs
      await fetch("/api/watchdog/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: activeTask.id })
      });

      // 6. Navigate to debrief screen
      setIsDebriefProcessing(true);
      const debriefRes = await fetch("/api/debrief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hardestPart: "Deadline was imminent; Cryo-Save emergency auto-submission triggered.",
          createdAt: activeTask.createdAt,
          deadline: activeTask.deadline,
          rating: 1, // lowest rating
          currentGamma: gamma,
          autoSubmitted: true,
          first_step_completion_timestamp: activeTask.firstStepCompletedAt || null,
          task_completed_timestamp: new Date().toISOString()
        })
      });

      if (debriefRes.ok) {
        const debriefData = await debriefRes.json();
        setDebriefInsight(debriefData.insight || "");
        setGamma(debriefData.newGamma || gamma);

        await updateUserProfile({
          gamma: debriefData.newGamma || gamma
        });

        // Persist to task doc safely with merge: true
        await setDoc(taskRef, {
          debrief: {
            hardestPart: "Deadline was imminent; Cryo-Save emergency auto-submission triggered.",
            rating: 1,
            submitted: true,
            blockerType: debriefData.blockerType || "none_stated",
            insight: debriefData.insight,
            newGamma: debriefData.newGamma,
          }
        }, { merge: true });
      }

      // Transition app phase to debrief and bypass feedback questionnaire
      setAppPhase('debrief');
      setDebriefStep(3);
      setUiScreen('after_action_report');

    } catch (err) {
      console.error("Error executing Cryo-Save auto-submission:", err);
      alert("Cryo-Save Failed. Please try again or complete the task manually.");
    } finally {
      setIsAutoSubmitting(false);
    }
  };

  const handleImStuck = async (currentStep: TaskStep) => {
    setShowStuckHelper(true);
    setIsLoadingStuck(true);
    setStuckSuggestion(null);

    try {
      const res = await fetch("/api/stuck-suggestion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_step_text: currentStep.display_text || currentStep.action,
          task_name: activeTask?.taskText || "",
          difficulty
        })
      });

      if (!res.ok) {
        throw new Error("Failed to fetch suggestion");
      }

      const data = await res.json();
      if (data.suggestion) {
        setStuckSuggestion(data.suggestion);
      }
    } catch (err) {
      console.error("Error getting stuck suggestion:", err);
    } finally {
      setIsLoadingStuck(false);
    }
  };

  const getLiveActiveTaskMScore = () => {
    if (!activeTask || !activeTask.taskText) return 100;
    const now = new Date();
    const dl = new Date(activeTask.deadline);
    const diffMs = dl.getTime() - now.getTime();
    let diffHours = Math.max(0, diffMs / (1000 * 60 * 60));
    if (isNaN(diffHours)) {
      diffHours = 0;
    }

    const rawExpectancy = Number(activeTask.expectancy) || 8;
    const rawValue = Number(activeTask.value) || 8;
    const rawGamma = Number(gamma) || 0.5;

    const E_val = rawExpectancy > 1.0 ? rawExpectancy / 10 : rawExpectancy;
    const V_val = rawValue;
    const raw_U = (E_val * V_val) / (1 + rawGamma * diffHours);

    // Same recalibrated formula as the interval effect above
    const U_baseline = (E_val * V_val) / (1 + rawGamma * 8);
    const urgencyRatio = U_baseline > 0 ? raw_U / U_baseline : 1;
    const score = Math.min(100, Math.max(0, Math.round(100 / urgencyRatio)));
    return isNaN(score) ? 100 : score;
  };

  // Determine current temperature accent phase
  const liveScore = activeTask ? getLiveActiveTaskMScore() : currentMScore;
  const tempPhase: TempPhase =
    uiScreen === 'active_operation'
      ? (operationTempOverride || 'warm')
      : activeTask?.status === 'crisis_sent' || activeTask?.watchdogTriggered || simulatedMaydayOverlay
      ? 'hot'
      : liveScore >= 70
      ? 'cold'
      : liveScore >= 40
      ? 'warm'
      : 'hot';

  const phaseStatusLabel = tempPhase === 'cold' ? 'STABLE' : tempPhase === 'warm' ? 'ELEVATED' : 'CRITICAL';

  // Auth Screen
  if (needsAuth) {
    return (
      <div className="relative min-h-screen bg-[#02040a] text-[#FAFAFA] flex flex-col items-center justify-center p-6 font-sans overflow-hidden">
        {/* Cinematic Backdrop with slow drifting ice-teal aurora */}
        <div className="aurora-bg">
          <div className="aurora-glow-1" style={{ '--live-accent-glow-strong': 'rgba(0, 245, 212, 0.2)' } as any} />
        </div>
        <div className="film-grain pointer-events-none" />

        {/* Floating Atmospheric Outpost Status Indicator */}
        <div className="absolute top-6 left-6 hidden md:flex items-center gap-2 text-[9px] font-mono text-[#52525B] tracking-widest pointer-events-none select-none z-10">
          <span className="w-1.5 h-1.5 rounded-full bg-live-accent animate-pulse" />
          <span>OUTPOST STATUS: COLD · LAST BREACH: NONE</span>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="cryo-glass max-w-[420px] w-full p-8 relative z-10 text-center rounded-lg shadow-2xl border border-white/5"
        >
          {/* Hexagonal shield emblem with a thin glowing pulsing ring around it */}
          <div className="relative inline-flex items-center justify-center mb-6">
            <motion.div
              animate={{
                scale: [1, 1.15, 1],
                opacity: [0.3, 0.7, 0.3],
                boxShadow: [
                  "0 0 10px rgba(0, 245, 212, 0.15)",
                  "0 0 25px rgba(0, 245, 212, 0.4)",
                  "0 0 10px rgba(0, 245, 212, 0.15)"
                ]
              }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
              className="absolute -inset-2.5 rounded-full border border-live-accent/25 pointer-events-none"
            />
            
            <div className="w-14 h-14 relative flex items-center justify-center text-live-accent">
              <svg className="absolute inset-0 w-full h-full text-live-accent/10" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polygon points="50,5 90,25 90,75 50,95 10,75 10,25" />
              </svg>
              <svg className="absolute inset-0 w-full h-full text-live-accent animate-[pulse_2s_infinite]" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="1">
                <polygon points="50,12 83,29 83,71 50,88 17,71 17,29" />
              </svg>
              <Shield className="w-5 h-5 text-live-accent relative z-10" />
            </div>
          </div>

          {/* Large wordmark "ColdBreak" */}
          <h1 className="text-4xl font-bold tracking-tight text-white mb-1.5 font-sans">
            Cold<span className="text-live-accent font-sans">Break</span>
          </h1>
          
          <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-[#71717a] mb-7">
            OUTPOST CLEARANCE REQUIRED
          </p>
          
          <p className="text-zinc-400 mb-8 text-[13px] leading-relaxed font-sans max-w-[340px] mx-auto">
            It doesn't remind you to start. It starts for you. And every word it says on your behalf is true.
          </p>

          {/* Dossier Preview strip with four small circular slots and padlocks */}
          <div className="mb-8 p-4 rounded-lg bg-[#040814]/40 border border-[#27272a]/20">
            <div className="flex justify-center gap-5 mb-3">
              {[
                { id: 'deadline_dancer', sigil: 'lightning' },
                { id: 'overwhelmed_perfectionist', sigil: 'concentric' },
                { id: 'context_switcher', sigil: 'orbit' },
                { id: 'paralyzed_planner', sigil: 'lock' }
              ].map((cls) => (
                <div key={cls.id} className="relative w-10 h-10 rounded-full border border-zinc-800 bg-zinc-950/80 flex items-center justify-center text-zinc-600 grayscale opacity-45 hover:opacity-75 transition-all duration-300 group">
                  <div className="scale-75">
                    {cls.sigil === 'lightning' && (
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    )}
                    {cls.sigil === 'concentric' && (
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <circle cx="12" cy="12" r="6" />
                        <circle cx="12" cy="12" r="2" />
                      </svg>
                    )}
                    {cls.sigil === 'orbit' && (
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" strokeDasharray="4 4" />
                        <circle cx="12" cy="12" r="4" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v4M12 18v4M2 12h4M18 12h4" />
                      </svg>
                    )}
                    {cls.sigil === 'lock' && (
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <rect x="5" y="11" width="14" height="10" rx="2" strokeLinecap="round" strokeLinejoin="round" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 11V15M8 11V7a4 4 0 018 0v4" />
                      </svg>
                    )}
                  </div>
                  {/* Padlock Overlay */}
                  <div className="absolute -bottom-1 -right-1 bg-black/95 border border-zinc-800 rounded-full p-1 shadow-md">
                    <Lock className="w-2.5 h-2.5 text-zinc-400 group-hover:text-live-accent transition-colors" />
                  </div>
                </div>
              ))}
            </div>
            <span className="text-[9px] font-mono uppercase tracking-[0.18em] text-zinc-500 block">
              OPERATIVE CLASS — UNLOCKS ON ENLISTMENT
            </span>
          </div>

          {/* Holographic style google sign in CTA */}
          <button
            id="sign-in-btn"
            onClick={handleLogin}
            disabled={isLoggingIn}
            className="w-full relative overflow-hidden flex items-center justify-center gap-3 py-3.5 px-6 rounded-full bg-white hover:bg-zinc-50 active:bg-zinc-100 text-black font-semibold border border-transparent hover:border-live-accent hover:shadow-[0_0_15px_rgba(0,245,212,0.4)] transition-all duration-300 shadow-lg cursor-pointer group disabled:opacity-75 text-xs font-sans tracking-wide"
          >
            {/* Holographic swipe effect */}
            <motion.div
              animate={{ x: ['-150%', '150%'] }}
              transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
              className="absolute top-0 bottom-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-live-accent/20 to-transparent pointer-events-none"
            />
            
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335" />
            </svg>
            <span>{isLoggingIn ? 'Verifying Outpost Clearance...' : 'Authenticate Identity'}</span>
          </button>

          <p className="text-[10px] text-zinc-500 font-sans leading-relaxed mt-4 max-w-[320px] mx-auto">
            Your enlistment grants ColdBreak limited Calendar and Gmail clearance — only what's needed to run Containment Operations on your behalf.
          </p>

          {loginError && (
            <div className="mt-6 p-4 rounded bg-[#060a14]/90 text-xs text-left space-y-3 leading-relaxed border border-rose-500/30 text-rose-400 font-mono">
              <div className="flex gap-2 items-center font-bold uppercase tracking-wider">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>BREACH WARNING</span>
              </div>
              <p className="text-[#A1A1AA]">{loginError}</p>
              <button
                onClick={() => window.open(window.location.href, '_blank')}
                className="w-full py-2 bg-live-accent hover:opacity-90 text-black font-semibold rounded transition duration-150 text-center cursor-pointer block font-sans"
              >
                Open in a New Tab
              </button>
            </div>
          )}
        </motion.div>
        
        {/* Ability Badge style footer */}
        <div className="absolute bottom-6 mx-auto text-center w-full px-6 z-10 pointer-events-none select-none">
          <p className="text-[9px] font-mono tracking-widest text-zinc-500 uppercase flex flex-wrap items-center justify-center gap-2">
            <span className="inline-flex items-center gap-1.5 bg-live-accent/10 border border-live-accent/30 px-2 py-0.5 rounded text-[8px] font-mono uppercase text-live-accent font-semibold tracking-wider">
              <span className="w-1 h-1 rounded-full bg-live-accent animate-pulse" />
              INTEGRITY VERIFICATION: ACTIVE
            </span>
            <span>— passive trait, cannot be disabled · TIME INTEGRATION ENGINE ONLINE</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div data-temp={tempPhase} className="relative min-h-screen bg-[#02040a] text-[#FAFAFA] flex flex-col overflow-hidden font-sans select-none">
      {/* 3-State animated plasma backdrop */}
      <div className="aurora-bg">
        <div className="aurora-glow-1" />
        <div className="aurora-glow-2" />
      </div>
      {/* Film grain texture */}
      <div className="film-grain" />

      {/* HEADER (48px tall / h-12) */}
      <header id="app-header" className="h-14 border-b border-white/5 px-6 flex items-center justify-between bg-black/40 backdrop-blur-md z-30 shrink-0">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-live-accent" />
          <span className="font-bold text-base tracking-tight text-white font-sans mr-2">ColdBreak</span>
        </div>

        {/* Global Stats: Just email and Abstain button if not welcome phase */}
        {user?.email && (
          <div className="flex items-center gap-4 text-xs font-mono text-[#A1A1AA]">
            {/* XP Profile Badge */}
            <button
              id="header-profile-badge"
              onClick={() => setShowHistory(true)}
              className="flex items-center gap-1.5 bg-[#0F1535]/80 border border-[#6366F1]/50 rounded-full px-2.5 py-1 hover:border-[#6366F1] hover:bg-[#0F1535] transition text-white text-xs select-none cursor-pointer font-mono"
            >
              <Award className="w-3.5 h-3.5 text-live-accent shrink-0 animate-pulse" />
              <span>Lv. {getLevelFromXP(totalXP).level}</span>
              <span className="text-zinc-400">({totalXP} XP)</span>
            </button>

            <span className="hidden md:inline text-[11px] text-[#52525b] uppercase tracking-wider">{user.email}</span>
            {appPhase !== 'welcome' && (
              <button
                onClick={handleLogout}
                className="text-xs text-[#52525B] hover:text-[#FAFAFA] font-mono transition uppercase tracking-wider cursor-pointer flex items-center gap-1.5 border border-white/5 bg-white/2 px-2.5 py-1 rounded"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Abstain</span>
              </button>
            )}
          </div>
        )}
      </header>

      {/* MAIN VIEW AREA */}
      <main className="flex-1 flex flex-col p-4 md:p-6 relative z-10 max-w-7xl w-full mx-auto justify-center items-center overflow-hidden">
        <AnimatePresence mode="wait">
          {appPhase === 'welcome' && (
            <motion.div
              key="welcome"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="w-full max-w-[560px] flex flex-col items-center text-center space-y-6"
            >
              <div className="w-full space-y-2">
                <textarea
                  id="task-input"
                  rows={3}
                  className="w-full bg-[#111115] border border-[#27272A] focus:border-[#3F3F46] rounded-lg p-4 text-[16px] text-[#FAFAFA] placeholder:text-[#52525B] focus:outline-none resize-none leading-relaxed font-sans"
                  placeholder="What do you need to finish?"
                  value={taskText}
                  onChange={(e) => setTaskText(e.target.value)}
                />
              </div>

              {/* Deadline Chips row */}
              <div className="w-full flex flex-wrap justify-center gap-2">
                {['30 min', '1 hour', '2 hours', '3 hours', 'Tonight', 'Tomorrow'].map((chip) => {
                  const isSelected = selectedChip === chip;
                  return (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => handleChipSelect(chip)}
                      className={`h-11 px-4 rounded-full text-xs font-mono border transition-all duration-200 cursor-pointer flex items-center justify-center ${
                        isSelected
                          ? 'bg-[#3B82F6] text-white border-[#3B82F6]'
                          : 'bg-[#111115] text-[#A1A1AA] border-[#27272A] hover:border-[#3F3F46]'
                      }`}
                    >
                      {chip}
                    </button>
                  );
                })}
              </div>

              <div className="w-full space-y-1.5">
                <label className="text-[10px] font-mono text-[#A1A1AA] uppercase tracking-widest block">
                  — or set exact deadline —
                </label>
                <input
                  type="datetime-local"
                  value={deadline}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    setDeadline(e.target.value);
                    setSelectedChip(null);
                    setHasManualDeadline(true);
                  }}
                  className="w-full bg-[#111115] border border-[#27272A] focus:border-[#3B82F6] rounded-lg px-4 py-2.5 text-sm text-[#FAFAFA] focus:outline-none font-mono cursor-pointer"
                />
              </div>

              {/* Cryo-Save Configuration Section (Part 1) */}
              <div className="w-full bg-[#1e1b4b]/40 border border-[#818cf8]/20 rounded-xl p-4 text-left space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm">❄️</span>
                  <h4 className="text-xs font-mono font-semibold text-[#c7d2fe] uppercase tracking-wider">
                    Cryo-Save System Parameters
                  </h4>
                </div>
                <p className="text-[11px] text-[#a5b4fc] leading-relaxed">
                  Configure the backup payload parameters. In the event of an imminent deadline failure, ColdBreak will compile your uploaded context documents and auto-submit this payload.
                </p>

                <div className="space-y-1">
                  <label className="text-[9px] font-mono text-[#A1A1AA] uppercase tracking-widest block">
                    Submission Format
                  </label>
                  <select
                    value={submissionFormat}
                    onChange={(e) => setSubmissionFormat(e.target.value as any)}
                    className="w-full bg-[#02040a] border border-[#818cf8]/30 focus:border-[#818cf8] rounded px-3 py-2 text-xs text-[#FAFAFA] font-mono focus:outline-none cursor-pointer"
                  >
                    <option value="PDF">PDF (Structured Document)</option>
                    <option value="DOCX">DOCX (Word Document)</option>
                    <option value="PPT">PPT (PowerPoint Presentation)</option>
                    <option value="TXT">TXT (Plain Structured Text)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[9px] font-mono text-[#A1A1AA] uppercase tracking-widest block">
                    Assignment Instructions / Questions (Optional)
                  </label>
                  <textarea
                    maxLength={500}
                    placeholder="Provide specific guidelines, writing rubrics, or explicit assignment questions to direct the auto-submission compiler..."
                    value={assignmentInstructions}
                    onChange={(e) => setAssignmentInstructions(e.target.value)}
                    className="w-full h-20 bg-[#02040a] border border-[#818cf8]/30 focus:border-[#818cf8] rounded px-3 py-2 text-xs text-[#FAFAFA] placeholder-zinc-600 focus:outline-none font-sans resize-none"
                  />
                  <div className="text-right text-[8px] font-mono text-zinc-500">
                    {assignmentInstructions.length}/500 chars
                  </div>
                </div>
              </div>

              {/* Advanced Protocol Toggle (Section 3) */}
              <div className="w-full">
                <button
                  type="button"
                  id="advanced-protocol-toggle"
                  onClick={() => setShowExpandedIntake(prev => !prev)}
                  className="text-xs font-mono text-live-accent hover:underline flex items-center gap-1 mx-auto cursor-pointer"
                >
                  {showExpandedIntake ? "[-]" : "[+]"} Show Advanced Protocol Configuration
                </button>
              </div>

              {showExpandedIntake && (
                <div className="w-full bg-[#0F1535]/80 border border-[#6366F1]/40 rounded-xl p-5 text-left space-y-4 shadow-xl">
                  <div className="space-y-1">
                    <label className="text-[10px] font-mono text-[#A1A1AA] uppercase tracking-widest block">Recipient Name (Override)</label>
                    <input
                      type="text"
                      className="w-full bg-[#02040a] border border-[#6366F1]/30 rounded px-3 py-2 text-sm text-[#FAFAFA] placeholder-zinc-600 focus:outline-none focus:border-[#6366F1] font-sans"
                      placeholder="e.g. Aditya"
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono text-[#A1A1AA] uppercase tracking-widest block">Step Depth</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { key: 'quick', label: 'Quick', desc: '3 steps' },
                        { key: 'balanced', label: 'Balanced', desc: '5 steps' },
                        { key: 'thorough', label: 'Thorough', desc: '7-8 steps' }
                      ].map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => setStepDepth(item.key as any)}
                          className={`p-2 rounded text-center border transition cursor-pointer flex flex-col justify-center items-center ${
                            stepDepth === item.key
                              ? 'bg-[#6366F1]/20 border-[#6366F1] text-white font-medium'
                              : 'bg-[#02040a] border-[#27272A] text-zinc-400 hover:border-zinc-700'
                          }`}
                        >
                          <span className="text-xs font-semibold">{item.label}</span>
                          <span className="text-[9px] font-mono text-zinc-500">{item.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono text-[#A1A1AA] uppercase tracking-widest block">Reminder Mode</label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { key: 'every-step', label: 'Every Step', desc: 'Continuous feedback' },
                        { key: 'when-stuck', label: 'When Stuck', desc: 'Passive tracking' }
                      ].map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => setReminderMode(item.key as any)}
                          className={`p-2 rounded text-center border transition cursor-pointer flex flex-col justify-center items-center ${
                            reminderMode === item.key
                              ? 'bg-[#6366F1]/20 border-[#6366F1] text-white font-medium'
                              : 'bg-[#02040a] border-[#27272A] text-zinc-400 hover:border-zinc-700'
                          }`}
                        >
                          <span className="text-xs font-semibold">{item.label}</span>
                          <span className="text-[9px] font-mono text-zinc-500">{item.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono text-[#A1A1AA] uppercase tracking-widest block">Difficulty Self-Report</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { key: 'easy', label: 'Easy', desc: '+10% Confidence' },
                        { key: 'tough', label: 'Tough', desc: '-10% Confidence' },
                        { key: 'dreading', label: 'Dreading', desc: '-18% & Thorough' }
                      ].map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          id={`self-difficulty-${item.key}`}
                          onClick={() => setSelfDifficulty(item.key as any)}
                          className={`p-2 rounded text-center border transition cursor-pointer flex flex-col justify-center items-center ${
                            selfDifficulty === item.key
                              ? 'bg-[#6366F1]/20 border-[#6366F1] text-white font-medium'
                              : 'bg-[#02040a] border-[#27272A] text-zinc-400 hover:border-zinc-700'
                          }`}
                        >
                          <span className="text-xs font-semibold">{item.label}</span>
                          <span className="text-[9px] font-mono text-zinc-500">{item.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono text-[#A1A1AA] uppercase tracking-widest block">User Time Estimate</label>
                    <input
                      type="text"
                      id="user-time-estimate-input"
                      className="w-full bg-[#02040a] border border-[#6366F1]/30 rounded px-3 py-2 text-sm text-[#FAFAFA] placeholder-zinc-600 focus:outline-none focus:border-[#6366F1] font-sans"
                      placeholder="e.g. 45 mins, 2 hours"
                      value={userTimeEstimate}
                      onChange={(e) => setUserTimeEstimate(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {/* Configure Personalization Context Button */}
              <button
                type="button"
                disabled={taskText.trim().length < 8 || !deadline}
                onClick={() => {
                  setAppPhase('personalization');
                }}
                className={`w-full h-11 rounded-lg text-sm font-semibold uppercase tracking-wider transition-all duration-200 ${
                  taskText.trim().length >= 8 && deadline
                    ? 'bg-[#3B82F6] text-white cursor-pointer hover:bg-[#3B82F6]/90'
                    : 'bg-[#111115] text-[#52525B] border border-[#27272A] cursor-not-allowed opacity-50'
                }`}
              >
                Continue to Personalization →
              </button>

              <p className="text-[#52525B] text-xs font-mono">
                ColdBreak handles the rest. No setup. No configuration.
              </p>
            </motion.div>
          )}

          {appPhase === 'personalization' && (
            <motion.div
              key="personalization"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="w-full max-w-[560px] flex flex-col items-center text-center space-y-6"
            >
              <div className="w-full space-y-2 text-left">
                <span className="text-[#3B82F6] text-[12px] tracking-[0.1em] uppercase font-mono font-bold block">
                  Step 2 of 2: Mission Personalization
                </span>
                <h1 className="text-white text-[24px] font-semibold leading-tight font-sans">
                  Hyperpersonalize Your Plan
                </h1>
                <p className="text-[#A1A1AA] text-sm font-sans">
                  Upload guidelines, rubrics, context documents, or simply lock it in to proceed.
                </p>
              </div>

              {/* RAG pipeline hyperpersonalization context uploader card */}
              <div className="w-full bg-[#111115] border border-[#27272A] rounded-xl p-5 text-left space-y-4">
                <div className="flex items-center justify-between border-b border-[#27272A] pb-2.5">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-live-accent animate-pulse" />
                    <span className="text-xs font-mono text-[#FAFAFA] font-semibold uppercase tracking-wider">
                      RAG Hyperpersonalization Grid
                    </span>
                  </div>
                  <span className="text-[9px] font-mono text-zinc-500 uppercase">Passive Context</span>
                </div>

                <p className="text-xs text-[#A1A1AA] leading-relaxed font-sans">
                  Upload style guides, templates, rubrics, or context guidelines. When decomposing tasks, ColdBreak retrieves relevant context chunks to align your timed implementation steps perfectly.
                </p>
                <p className="text-[11px] font-mono text-amber-500/90 leading-relaxed bg-amber-500/5 border border-amber-500/20 px-2.5 py-1.5 rounded flex items-center gap-1.5">
                  <span>💡</span>
                  <span><strong>Optional:</strong> Skip personalization if not needed. ColdBreak will break down your task using general knowledge.</span>
                </p>

                {/* Active context files list */}
                {contextFiles.length > 0 && (
                  <div className="space-y-2 bg-[#040814]/40 border border-[#27272a]/20 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                        Stasis-Registered Context Documents
                      </span>
                      <button
                        type="button"
                        disabled={isPurgingAll}
                        onClick={handlePurgeAllContextFiles}
                        className={`text-[9px] font-mono uppercase tracking-wider transition shrink-0 ${
                          confirmDeleteId === 'PURGE_ALL'
                            ? 'text-rose-400 animate-pulse'
                            : 'text-zinc-600 hover:text-rose-500'
                        }`}
                      >
                        {isPurgingAll ? '[purging...]' : confirmDeleteId === 'PURGE_ALL' ? '[confirm purge all?]' : '[purge all]'}
                      </button>
                    </div>
                    <div className="divide-y divide-white/5">
                      {contextFiles.filter(f => !deletingFileIds.has(f.id)).map((file) => {
                        const sizeLabel = file.originalFileSize != null
                          ? `${(file.originalFileSize / 1024).toFixed(1)} KB`
                          : `${(file.charCount / 1000).toFixed(1)}k chars`;

                        return (
                          <div key={file.id} className="py-2 space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-2 overflow-hidden mr-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-live-accent shrink-0" />
                                <span className="text-[#FAFAFA] font-medium truncate font-sans">{file.fileName}</span>
                                <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider font-semibold shrink-0">
                                  ({sizeLabel})
                                </span>
                                {file.wasTruncated && (
                                  <span className="text-[9px] font-mono text-amber-500 uppercase tracking-wider shrink-0" title="File was larger than 15k chars; content was capped for latency">
                                    [truncated]
                                  </span>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => handleDeleteContextFile(file.id)}
                                className={`font-mono text-[10px] uppercase tracking-wider shrink-0 cursor-pointer transition ${
                                  confirmDeleteId === file.id
                                    ? 'text-rose-400 animate-pulse'
                                    : 'text-zinc-500 hover:text-rose-400'
                                }`}
                              >
                                {confirmDeleteId === file.id ? '[confirm?]' : '[purge]'}
                              </button>
                            </div>
                            {confirmDeleteId === file.id && (
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="text-[9px] font-mono text-zinc-600 hover:text-zinc-400 uppercase tracking-wider transition"
                                >
                                  [cancel]
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {confirmDeleteId === 'PURGE_ALL' && (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-[9px] font-mono text-zinc-600 hover:text-zinc-400 uppercase tracking-wider transition"
                      >
                        [cancel]
                      </button>
                    )}
                  </div>
                )}

                {/* File Drag-and-drop / selector */}
                <div
                  className={`border border-dashed rounded-lg p-5 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-200 ${
                    dragActive
                      ? 'border-live-accent bg-live-accent/5'
                      : 'border-zinc-800 bg-[#02040a]/50 hover:border-zinc-700'
                  }`}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    setDragActive(true);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    setDragActive(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragActive(false);
                    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                      handleUploadContextFile(e.dataTransfer.files[0]);
                    }
                  }}
                  onClick={() => {
                    const fileInput = document.getElementById('rag-file-input');
                    if (fileInput) fileInput.click();
                  }}
                >
                  <input
                    type="file"
                    id="rag-file-input"
                    className="hidden"
                    accept=".pdf,.txt,.md"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleUploadContextFile(e.target.files[0]);
                      }
                    }}
                  />
                  
                  {isUploadingContext ? (
                    <div className="space-y-2 py-2 flex flex-col items-center">
                      <Loader2 className="w-5 h-5 text-live-accent animate-spin" />
                      <p className="text-xs font-mono text-live-accent uppercase tracking-wider">{contextProgress}</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5 flex flex-col items-center">
                      <Sparkles className="w-5 h-5 text-zinc-600 hover:text-live-accent transition" />
                      <p className="text-xs text-zinc-400">
                        <span className="text-live-accent font-semibold">Drop PDF, TXT, or MD here</span> or click to select
                      </p>
                      <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
                        Max 2MB per file (capped at 15k chars for latency)
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons Row */}
              <div className="w-full flex gap-4">
                <button
                  type="button"
                  onClick={() => setAppPhase('welcome')}
                  className="flex-1 h-11 border border-[#27272A] hover:border-[#3F3F46] text-[#A1A1AA] hover:text-white font-semibold rounded-lg text-sm uppercase tracking-wider transition-all duration-200 cursor-pointer bg-transparent"
                >
                  ← Edit Task
                </button>

                <button
                  type="button"
                  onClick={async (e) => {
                    setAppPhase('processing');
                    await handleLaunchAgent(e);
                  }}
                  className="flex-1 h-11 bg-[#3B82F6] hover:bg-[#3B82F6]/90 text-white font-semibold rounded-lg text-sm uppercase tracking-wider transition-all duration-200 cursor-pointer"
                >
                  Lock it in →
                </button>
              </div>

              <p className="text-[#52525B] text-xs font-mono">
                ColdBreak handles the rest. No setup. No configuration.
              </p>
            </motion.div>
          )}

          {appPhase === 'processing' && (
            <motion.div
              key="processing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="w-full max-w-[480px] flex flex-col items-center text-center space-y-6"
            >
              <div className="w-8 h-8 rounded-full border-2 border-white/10 border-t-[#3B82F6] animate-spin" />

              <p className="text-[14px] text-[#A1A1AA] font-mono leading-relaxed max-w-[360px]">
                {reactLogs.length > 0
                  ? `${(reactLogs[reactLogs.length - 1].thought || "Processing...").slice(0, 72)}...`
                  : "Reading your task..."}
              </p>

              {reactLogs.length >= 2 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-3 flex flex-col items-center"
                >
                  <span
                    style={{ color: tierColor, backgroundColor: tierBg }}
                    className="px-2.5 py-1 rounded text-[11px] font-mono tracking-widest uppercase font-semibold"
                  >
                    {tierName}
                  </span>

                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.5 }}
                    className="text-[#52525B] text-[13px] font-mono"
                  >
                    This mission is worth +{totalStepsXP} XP
                  </motion.p>
                </motion.div>
              )}

              <div className="fixed bottom-6 right-6 z-50">
                <button
                  type="button"
                  onClick={() => setIsReasoningOpen(!isReasoningOpen)}
                  className="text-xs text-[#52525B] hover:text-[#A1A1AA] font-mono transition cursor-pointer"
                >
                  {isReasoningOpen ? '▴ Hide' : '▾ Reasoning'}
                </button>
              </div>

              {isReasoningOpen && (
                <div className="fixed bottom-0 left-0 right-0 h-[280px] bg-[#111115] border-t border-[#27272A] z-40 p-4 overflow-y-auto font-mono text-xs text-left text-[#A1A1AA] shadow-2xl">
                  <div className="flex justify-between items-center border-b border-[#27272A] pb-2 mb-2">
                    <span className="font-bold text-white">REASONING ENGINE</span>
                    <button onClick={() => setIsReasoningOpen(false)} className="text-[#52525B] hover:text-white">✕</button>
                  </div>
                  <div className="space-y-2">
                    {reactLogs.map((log, idx) => (
                      <div key={idx} className="border-b border-white/5 pb-1">
                        <span className="text-[#3B82F6]">[Step {log.step}]</span> {log.thought}
                        {log.tool && (
                          <div className="pl-4 text-xs text-amber-500">
                            → Tool: {log.tool} ({log.result ? 'success' : 'pending'})
                          </div>
                        )}
                      </div>
                    ))}
                    {reactLogs.length === 0 && <p className="text-[#52525B]">Booting ReAct loop...</p>}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {appPhase === 'plan' && (
            <motion.div
              key="plan"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="w-full max-w-[580px] flex flex-col space-y-6 overflow-y-auto max-h-[80vh] pr-1 scrollbar-hide"
            >
              <div className="w-full flex flex-col space-y-3">
                <span className="text-[#52525B] text-[11px] tracking-[0.1em] uppercase font-mono text-left">
                  MISSION BRIEFING
                </span>

                <div className="flex items-center justify-between w-full">
                  <span
                    style={{ color: tierColor, backgroundColor: tierBg }}
                    className="px-2.5 py-1 rounded text-[11px] font-mono tracking-widest uppercase font-semibold"
                  >
                    {tierName}
                  </span>
                  <span className="text-[#3B82F6] text-[13px] font-mono font-bold">
                    + {totalStepsXP} XP AVAILABLE
                  </span>
                </div>

                {/* Archetype protocol tag — shows which class shaped the step decomposition */}
                <div className="flex items-center gap-2 flex-wrap">
                  {archetype && (
                    <span className="text-[10px] font-mono text-zinc-500">
                      Generated under{' '}
                      <span className="text-live-accent font-semibold">
                        {CLASSES_LIST.find(c => c.id === archetype)?.name || archetype.replace(/_/g, ' ')}
                      </span>{' '}
                      protocol
                    </span>
                  )}
                  {/* RAG indicator — shows when plan was shaped by uploaded context docs */}
                  {ragUsed && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono text-live-accent bg-live-accent/10 border border-live-accent/20 px-2 py-0.5 rounded">
                      <Sparkles className="w-3 h-3" />
                      Personalized from your context docs
                    </span>
                  )}
                </div>
              </div>

              <div className="w-full space-y-4">
                {activeTask?.steps && activeTask.steps.map((step, idx) => {
                  const isFirst = idx === 0;
                  return (
                    <div
                      key={step.id}
                      className={`p-4 rounded border text-left flex flex-col gap-1.5 ${
                        isFirst
                          ? 'border-[#3B82F6] bg-[#3B82F6]/5 pl-4 border-l-2'
                          : 'border-[#27272A] bg-[#111115] opacity-80 pl-4'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[11px] font-mono text-[#52525B]">
                        <span>OBJ {String(idx + 1).padStart(2, '0')}</span>
                        <span>{step.display_time || step.time} · {step.durationMinutes} min</span>
                      </div>
                      <p className={`font-sans leading-relaxed ${isFirst ? 'text-white text-[16px] font-medium' : 'text-[#A1A1AA] text-[14px]'}`}>
                        {step.display_text || step.action}
                      </p>
                    </div>
                  );
                })}
              </div>

              <div className="w-full bg-[#111115] border border-[#27272A] rounded-lg p-4 text-left space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] font-mono text-[#A1A1AA] uppercase tracking-wider">
                    STASIS CALENDAR GRID
                  </span>
                  <span className="text-[11px] font-mono text-[#10B981] uppercase tracking-wider flex items-center gap-1">
                    ● SYNC CONFIRMED
                  </span>
                </div>

                <div className="space-y-2">
                  <div className="w-full h-1.5 bg-[#10B981]/20 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: '100%' }}
                      transition={{ duration: 0.8, ease: "easeOut" }}
                      className="h-full bg-[#10B981]"
                    />
                  </div>
                  <p className="text-xs font-mono text-[#A1A1AA] leading-relaxed">
                    All {activeTask?.steps?.length} mission time blocks have been successfully reserved on your primary Google Calendar. Stasis barrier fully established.
                  </p>
                </div>
              </div>

              {renderUrgencyLine()}

              <button
                type="button"
                onClick={() => setAppPhase('active')}
                className="w-full h-11 bg-[#3B82F6] hover:bg-[#3B82F6]/90 text-white font-semibold rounded-lg text-sm uppercase tracking-wider transition-colors cursor-pointer shrink-0"
              >
                Accept Mission →
              </button>

              <div className="fixed bottom-6 right-6 z-50">
                <button
                  type="button"
                  onClick={() => setIsReasoningOpen(!isReasoningOpen)}
                  className="text-xs text-[#52525B] hover:text-[#A1A1AA] font-mono transition cursor-pointer"
                >
                  {isReasoningOpen ? '▴ Hide' : '▾ Reasoning'}
                </button>
              </div>

              {isReasoningOpen && (
                <div className="fixed bottom-0 left-0 right-0 h-[280px] bg-[#111115] border-t border-[#27272A] z-40 p-4 overflow-y-auto font-mono text-xs text-left text-[#A1A1AA] shadow-2xl">
                  <div className="flex justify-between items-center border-b border-[#27272A] pb-2 mb-2">
                    <span className="font-bold text-white">REASONING ENGINE</span>
                    <button onClick={() => setIsReasoningOpen(false)} className="text-[#52525B] hover:text-white">✕</button>
                  </div>
                  <div className="space-y-2">
                    {reactLogs.map((log, idx) => (
                      <div key={idx} className="border-b border-white/5 pb-1">
                        <span className="text-[#3B82F6]">[Step {log.step}]</span> {log.thought}
                        {log.tool && (
                          <div className="pl-4 text-xs text-amber-500">
                            → Tool: {log.tool} ({log.result ? 'success' : 'pending'})
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {appPhase === 'active' && (
            <motion.div
              key="active"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="w-full max-w-[480px] flex flex-col space-y-6 relative"
            >
              {/* HudPanel — shows real XP, rank, streaks. Was imported but never rendered — fixed */}
              <HudPanel
                completionCount={completionCount}
                totalXP={totalXP}
                coldStreak={coldStreak}
                frostShards={frostShards}
                totalBreaches={totalBreaches}
                cryoSavesRemaining={cryoSavesRemaining}
              />
              {import.meta.env.DEV && (
                <button
                  onClick={async () => {
                    const newVal = cryoSavesRemaining + 10;
                    setCryoSavesRemaining(prev => prev + 10);
                    await updateUserProfile({ cryoSavesRemaining: newVal });
                  }}
                  className="text-[10px] bg-white/10 hover:bg-white/20 text-white rounded px-1 mb-2"
                >
                  DEV +10
                </button>
              )}

              <div className="w-full flex justify-end">
                <span className="text-[#3B82F6] text-[13px] font-mono font-bold uppercase tracking-wider">
                  + {sessionXP} XP
                </span>
              </div>

              {currentStep && (
                <div className="w-full bg-[#18181C] border border-[#3F3F46] rounded-lg p-5 flex flex-col text-left relative space-y-4">
                  <div>
                    <span className="text-[#52525B] text-[10px] tracking-[0.1em] uppercase font-mono mb-2 block">
                      CURRENT OBJECTIVE
                    </span>

                    <p className="text-white text-[18px] font-medium leading-relaxed font-sans mb-1.5">
                      {currentStep.display_text || currentStep.action}
                    </p>

                    <span className="text-[#52525B] text-xs font-mono block">
                      {currentStep.display_time || currentStep.time} · {currentStep.durationMinutes} min
                    </span>
                  </div>

                  {/* Micro-Decompose Section (Section 6) */}
                  <div className="border-t border-[#3F3F46]/50 pt-3 space-y-3">
                    {microSteps.length === 0 && !isMicroLoading ? (
                      <button
                        type="button"
                        id="micro-decompose-trigger"
                        onClick={async () => {
                          setIsMicroLoading(true);
                          setMicroLoadingMsgIndex(0);
                          const msgs = ["Consulting agent schema...", "Decomposing action bounds...", "Finalizing sub-actions..."];
                          const timer = setInterval(() => {
                            setMicroLoadingMsgIndex(prev => (prev + 1) % msgs.length);
                          }, 1500);

                          try {
                            let contexts: string[] = [];
                            try {
                              const { retrieveRelevantContexts } = await import('./rag-client');
                              contexts = await retrieveRelevantContexts(user?.uid || "demo-user-001", currentStep.action || currentStep.display_text, 3);
                            } catch (ragErr) {
                              console.error("[RAG] Failed to retrieve context for decomposition:", ragErr);
                            }

                            const res = await fetch("/api/micro-decompose", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                step_text: currentStep.action || currentStep.display_text,
                                duration_minutes: currentStep.durationMinutes,
                                contexts
                              })
                            });
                            if (res.ok) {
                              const data = await res.json();
                              setMicroSteps(data.micro_steps || []);
                              setMicroCompleted(new Array((data.micro_steps || []).length).fill(false));
                            }
                          } catch (err) {
                            console.error("Micro decompose error:", err);
                          } finally {
                            clearInterval(timer);
                            setIsMicroLoading(false);
                          }
                        }}
                        className="h-7 px-3 rounded border border-[#F59E0B] text-[#F59E0B] hover:bg-[#F59E0B]/10 text-xs font-mono font-medium transition cursor-pointer flex items-center gap-1.5"
                      >
                        ⚡ Micro-Decompose Step
                      </button>
                    ) : isMicroLoading ? (
                      <div className="flex items-center gap-2 text-xs font-mono text-[#F59E0B]">
                        <div className="w-3.5 h-3.5 rounded-full border border-t-[#F59E0B] animate-spin shrink-0" />
                        <span>{["Consulting agent schema...", "Decomposing action bounds...", "Finalizing sub-actions..."][microLoadingMsgIndex]}</span>
                      </div>
                    ) : (
                      <div className="space-y-2 bg-[#02040a]/40 p-3 rounded border border-[#6366F1]/20">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">MICRO-ACTIONS</span>
                          <button
                            type="button"
                            onClick={() => {
                              setMicroSteps([]);
                              setMicroCompleted([]);
                            }}
                            className="text-[9px] font-mono text-zinc-500 hover:text-white"
                          >
                            Reset
                          </button>
                        </div>
                        <div className="space-y-1.5">
                          {microSteps.map((mstep, midx) => (
                            <label key={midx} className="flex items-start gap-2.5 text-xs text-zinc-300 select-none cursor-pointer">
                              <input
                                type="checkbox"
                                checked={microCompleted[midx] || false}
                                onChange={async (e) => {
                                  const updated = [...microCompleted];
                                  updated[midx] = e.target.checked;
                                  setMicroCompleted(updated);

                                  if (updated.length > 0 && updated.every(Boolean)) {
                                    // Automatically complete main step
                                    await handleCompleteStepClick();
                                    setMicroSteps([]);
                                    setMicroCompleted([]);
                                  }
                                }}
                                className="mt-0.5 shrink-0 rounded bg-black border-[#3F3F46] text-[#6366F1] focus:ring-0"
                              />
                              <span className={microCompleted[midx] ? "line-through text-zinc-500" : ""}>{mstep}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-center gap-2 pt-2 border-t border-[#3F3F46]/30 w-full">
                    {sortedSteps.map((step, idx) => {
                      const isCompleted = step.completed;
                      const isCurrent = idx === currentStepIndex;
                      return (
                        <span
                          key={step.id}
                          className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
                            isCompleted
                              ? 'bg-[#3B82F6]'
                              : isCurrent
                              ? 'bg-[#3B82F6] animate-pulse border border-[#3B82F6]'
                              : 'border border-[#3F3F46]'
                          }`}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="text-center space-y-2">
                <p className="text-[#52525B] text-[13px] font-mono">
                  Objective {currentStepIndex + 1} of {totalSteps}
                </p>

                <div className="w-full bg-[#111115] border border-[#27272A] rounded-lg p-4 text-left space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] font-mono text-[#A1A1AA] uppercase tracking-wider">
                      OPERATIONAL TACTICAL INTEL
                    </span>
                    <span className="text-[11px] font-mono text-[#6366F1] uppercase tracking-wider">
                      ● ON-DEMAND COACHING
                    </span>
                  </div>

                  {hintText ? (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="p-3 bg-amber-500/5 border border-amber-500/20 rounded font-sans text-[13px] text-amber-400 leading-relaxed italic"
                    >
                      "{hintText}"
                    </motion.div>
                  ) : (
                    <button
                      type="button"
                      id="request-tactical-hint-btn"
                      disabled={isFetchingHint}
                      onClick={async () => {
                        if (!currentStep) return;
                        setIsFetchingHint(true);
                        try {
                          const response = await fetch("/api/get-hint", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              state: archetype,
                              step_display_text: currentStep.display_text || currentStep.action
                            })
                          });
                          if (response.ok) {
                            const result = await response.json();
                            setHintText(result.tip);
                          }
                        } catch (err) {
                          console.error("Error getting tactical hint:", err);
                        } finally {
                          setIsFetchingHint(false);
                        }
                      }}
                      className="w-full h-10 border border-[#3F3F46] hover:bg-[#1C1C24] disabled:bg-[#111115] disabled:text-zinc-500 text-white font-semibold rounded text-xs uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-2"
                    >
                      {isFetchingHint ? (
                        <>
                          <div className="w-4 h-4 rounded-full border-2 border-white/10 border-t-[#3B82F6] animate-spin" />
                          Analyzing Resistance Vectors...
                        </>
                      ) : (
                        "Request Tactical Hint 💡"
                      )}
                    </button>
                  )}
                </div>
              </div>

              {renderUrgencyLine()}

              <AnimatePresence>
                {showXpFlash && (
                  <motion.div
                    initial={{ opacity: 0, y: 0 }}
                    animate={{ opacity: 1, y: -40 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                    className="absolute left-1/2 -translate-x-1/2 bottom-[120px] text-[#3B82F6] text-[22px] font-bold font-mono pointer-events-none"
                  >
                    +25 XP
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Cryo-Save Capable Status Box (Part 2) */}
              <div className={`w-full border rounded-lg p-3.5 text-left font-mono text-[11px] tracking-wider uppercase transition-all duration-300 ${cryoSaveStatus.color}`}>
                <div className="flex items-center gap-2 mb-1.5 font-bold">
                  <span className="text-sm">❄️</span>
                  <span>{cryoSaveStatus.label}</span>
                </div>
                <p className="text-[9px] leading-relaxed text-[#A1A1AA] lowercase font-sans normal-case">
                  {cryoSaveStatus.desc}
                </p>
              </div>

              <div className="w-full flex flex-col gap-3">
                <button
                  type="button"
                  onClick={handleCompleteStepClick}
                  className="w-full h-11 bg-[#3B82F6] hover:bg-[#3B82F6]/90 text-white font-semibold rounded-lg text-sm uppercase tracking-wider transition-colors cursor-pointer"
                >
                  ✓ Objective Complete
                </button>

                {/* Demo / testing controls — small and unobtrusive */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    title="Abort this operation and return to mission control"
                    onClick={handleResetTask}
                    className="flex-1 h-9 border border-[#3F3F46] hover:border-red-500/40 text-zinc-500 hover:text-red-400 font-mono rounded text-[11px] uppercase tracking-wider transition-all cursor-pointer"
                  >
                    Abort
                  </button>
                  <button
                    type="button"
                    title="Demo: Instantly triggers the Crisis Protocol for testing (fires watchdog now)"
                    onClick={async () => {
                      if (!activeTask) return;
                      try {
                        const taskRef = doc(db, 'tasks', activeTask.id);
                        await updateDoc(taskRef, { watchdogTriggered: true });
                        // Also register watchdog on backend in case it isn't already
                        await fetch("/api/watchdog/register", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            taskId: activeTask.id,
                            deadline: activeTask.deadline,
                            recipient: activeTask.recipient,
                            accessToken: token || "demo-token-12345",
                            taskText: activeTask.taskText,
                          })
                        });
                      } catch (err) {
                        console.error("Failed to simulate breach:", err);
                      }
                    }}
                    className="flex-1 h-9 border border-[#EF4444]/30 hover:border-[#EF4444]/70 text-[#EF4444]/60 hover:text-[#EF4444] font-mono rounded text-[11px] uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1"
                  >
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                    ⚡ Simulate Breach
                  </button>
                </div>
              </div>

              {nextStep && (
                <p className="text-[#52525B] text-[12px] opacity-50 text-center font-mono">
                  Next: {(nextStep.display_text || nextStep.action).slice(0, 40)}...
                </p>
              )}

              <div className="fixed bottom-6 right-6 z-50">
                <button
                  type="button"
                  onClick={() => setIsReasoningOpen(!isReasoningOpen)}
                  className="text-xs text-[#52525B] hover:text-[#A1A1AA] font-mono transition cursor-pointer"
                >
                  {isReasoningOpen ? '▴ Hide' : '▾ Reasoning'}
                </button>
              </div>

              {isReasoningOpen && (
                <div className="fixed bottom-0 left-0 right-0 h-[280px] bg-[#111115] border-t border-[#27272A] z-40 p-4 overflow-y-auto font-mono text-xs text-left text-[#A1A1AA] shadow-2xl">
                  <div className="flex justify-between items-center border-b border-[#27272A] pb-2 mb-2">
                    <span className="font-bold text-white">REASONING ENGINE</span>
                    <button onClick={() => setIsReasoningOpen(false)} className="text-[#52525B] hover:text-white">✕</button>
                  </div>
                  <div className="space-y-2">
                    {reactLogs.map((log, idx) => (
                      <div key={idx} className="border-b border-white/5 pb-1">
                        <span className="text-[#3B82F6]">[Step {log.step}]</span> {log.thought}
                        {log.tool && (
                          <div className="pl-4 text-xs text-amber-500">
                            → Tool: {log.tool} ({log.result ? 'success' : 'pending'})
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {appPhase === 'crisis' && (
            <motion.div
              key="crisis"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="w-full max-w-[520px] flex flex-col space-y-6 text-left"
            >
              <span className="text-[#EF4444] text-[12px] tracking-[0.1em] uppercase font-mono font-bold block">
                ⚠ EMERGENCY PROTOCOL
              </span>

              <div className="space-y-2">
                <h1 className="text-white text-[28px] font-medium leading-tight font-sans">
                  Sending holding message in {Math.ceil(crisisCountdown)}s
                </h1>
                <p className="text-[#A1A1AA] text-[15px]">
                  I've drafted a message to {getRecipientFirstName(activeTask?.recipient || 'Partner')}. Review it before it sends.
                </p>
              </div>

              <textarea
                readOnly
                className="w-full bg-[#1A0A0A] border border-[#7F1D1D] rounded-lg p-3 text-[14px] text-white focus:outline-none resize-none leading-relaxed h-[120px]"
                value={crisisMsgText}
              />

              {/* Cryo-Save Emergency Section (Part 4) */}
              <div className="w-full bg-[#1e1b4b]/50 border border-[#818cf8]/30 rounded-xl p-5 text-left space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-[#818cf8]/20">
                  <span className="text-base">❄️</span>
                  <h3 className="text-xs font-mono font-bold text-[#c7d2fe] uppercase tracking-wider">
                    Cryo-Save Emergency Terminal
                  </h3>
                </div>

                <div className={`border rounded px-3 py-2 text-[10px] font-mono tracking-wider uppercase ${cryoSaveStatus.color}`}>
                  <span className="font-bold">STATUS:</span> {cryoSaveStatus.label}
                </div>

                <button
                  type="button"
                  id="activate-cryo-save-btn"
                  disabled={cryoSaveStatus.status !== 'Ready' || isAutoSubmitting}
                  onClick={handleTriggerCryoSave}
                  className={`w-full h-11 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer ${
                    cryoSaveStatus.status === 'Ready'
                      ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-lg shadow-indigo-950/50'
                      : 'bg-zinc-800 border border-zinc-700 text-zinc-500 cursor-not-allowed'
                  }`}
                >
                  {isAutoSubmitting ? (
                    <>
                      <div className="w-4 h-4 rounded-full border-2 border-zinc-600 border-t-white animate-spin" />
                      AUTONOMOUS COMPILER ENGAGED...
                    </>
                  ) : (
                    "ACTIVATE EMERGENCY CRYO-SAVE (Cost: 1 Save)"
                  )}
                </button>

                {cryoSaveStatus.status !== 'Ready' && (
                  <p className="text-[10px] text-zinc-500 leading-normal font-sans italic">
                    💡 {cryoSaveStatus.desc}
                  </p>
                )}

                <p className="text-[10px] text-zinc-400 leading-relaxed font-sans">
                  ⚠️ <span className="font-semibold text-rose-400">WARNING:</span> Activating Cryo-Save incurs a -50 XP penalty and consumes 1 of your limited Cryo-Saves. This will autonomously compile your files and submit them now.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-[#52525B] text-[13px] font-mono">
                    Sending in {crisisCountdown}s
                  </span>
                  <span className="text-[10px] font-mono text-[#A1A1AA] uppercase tracking-wider">
                    Grace Period
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: '15 min', value: 15 },
                    { label: '20 min', value: 20 },
                    { label: '30 min', value: 30 },
                    { label: '1 hour', value: 60 },
                  ].map((opt) => {
                    const isActive = (gracePeriodMinutes ?? 30) === opt.value && !showCustomGrace;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          setGracePeriodMinutes(opt.value);
                          setShowCustomGrace(false);
                          setCustomGraceInput('');
                        }}
                        className={`h-8 px-3 rounded text-xs font-mono border transition-all cursor-pointer ${
                          isActive
                            ? 'bg-[#EF4444]/20 border-[#EF4444] text-[#EF4444] font-semibold'
                            : 'border-[#3F3F46] text-[#A1A1AA] hover:border-[#EF4444]/50 hover:text-white'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setShowCustomGrace(prev => !prev)}
                    className={`h-8 px-3 rounded text-xs font-mono border transition-all cursor-pointer ${
                      showCustomGrace
                        ? 'bg-[#EF4444]/20 border-[#EF4444] text-[#EF4444] font-semibold'
                        : 'border-[#3F3F46] text-[#A1A1AA] hover:border-[#EF4444]/50 hover:text-white'
                    }`}
                  >
                    Custom
                  </button>
                </div>
                {showCustomGrace && (
                  <div className="flex gap-2 items-center">
                    <input
                      type="number"
                      min="5"
                      max="480"
                      placeholder="mins"
                      value={customGraceInput}
                      onChange={(e) => setCustomGraceInput(e.target.value)}
                      className="w-20 bg-[#111115] border border-[#3F3F46] focus:border-[#EF4444] rounded px-3 py-1.5 text-sm text-white focus:outline-none font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const mins = parseInt(customGraceInput);
                        if (!isNaN(mins) && mins >= 5) {
                          setGracePeriodMinutes(mins);
                        }
                      }}
                      className="h-8 px-3 rounded bg-[#EF4444]/20 border border-[#EF4444]/50 text-[#EF4444] text-xs font-mono font-semibold cursor-pointer hover:bg-[#EF4444]/30 transition"
                    >
                      Apply
                    </button>
                    <span className="text-[10px] font-mono text-zinc-500">minutes (5–480)</span>
                  </div>
                )}
              </div>

              <div className="w-full flex gap-4">
                <button
                  type="button"
                  onClick={() => handleSendCrisisAction(gracePeriodMinutes || 30)}
                  className="flex-1 h-11 bg-[#EF4444] hover:bg-[#EF4444]/90 text-white font-semibold rounded-lg text-sm uppercase tracking-wider transition-colors cursor-pointer text-center"
                >
                  Send Now
                </button>

                <button
                  type="button"
                  onClick={handleCancelCrisis}
                  className="flex-1 h-11 border border-[#3F3F46] hover:border-white/20 text-[#A1A1AA] hover:text-white font-semibold rounded-lg text-sm uppercase tracking-wider transition-colors cursor-pointer bg-transparent"
                >
                  Cancel — I'll handle it
                </button>
              </div>

              <p className="text-[#52525B] text-[12px] text-center font-mono w-full">
                This message doesn't claim you've finished. It only buys time honestly.
              </p>
            </motion.div>
          )}

          {appPhase === 'debrief' && (
            <motion.div
              key="debrief"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="w-full max-w-[440px] flex flex-col items-center text-center space-y-6 animate-fade-in"
            >
              {activeTask?.autoSubmitted ? (
                <div className="space-y-5 text-center w-full">
                  <span className="text-[#EF4444] text-[48px] font-bold font-mono tracking-tight block animate-pulse">
                    -50 XP
                  </span>
                  <span className="text-[#EF4444] text-[14px] font-mono font-bold uppercase tracking-widest block border border-[#EF4444]/30 bg-[#EF4444]/10 px-4 py-2 rounded-lg">
                    ❄️ OPERATION SAVED VIA CRYO-STASIS
                  </span>
                  
                  <div className="text-left bg-zinc-950/60 border border-zinc-800 rounded-lg p-4 space-y-2">
                    <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest block">
                      SYSTEM DISPATCH REPORT
                    </span>
                    <p className="text-zinc-300 text-xs leading-relaxed font-sans">
                      Due to extreme deadline delay and imminent stasis breach, ColdBreak's autonomous compiler intervened. Your RAG context documents were parsed and generated into a professional submission payload, then dispatched immediately to <span className="text-[#818cf8] font-semibold">{activeTask.recipient}</span>.
                    </p>
                  </div>

                  {debriefInsight && (
                    <div className="bg-[#1e1b4b]/40 border border-[#818cf8]/30 rounded-xl p-5 text-left space-y-2 shadow-xl mt-4">
                      <span className="text-[10px] font-mono text-[#a5b4fc] uppercase tracking-widest block font-bold">
                        COGNITIVE ANALYSIS
                      </span>
                      <p className="text-indigo-100 text-xs font-sans leading-relaxed">
                        {debriefInsight}
                      </p>
                    </div>
                  )}

                  <p className="text-zinc-600 text-[10px] font-mono pt-4 animate-pulse uppercase tracking-wider">
                    Terminating emergency override. Returning to base control soon...
                  </p>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <span className="text-[#3B82F6] text-[56px] font-bold font-mono tracking-tight block">
                      + {displayedXP} XP
                    </span>
                    <span className={`text-[15px] font-mono font-bold uppercase tracking-widest block ${
                      allCompleted ? 'text-[#22C55E]' : 'text-[#F59E0B]'
                    }`}>
                      Mission {allCompleted ? 'Complete' : 'Incomplete'}
                    </span>
                  </div>

                  <AnimatePresence>
                    {debriefShowQuestions && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="w-full space-y-6 text-left"
                      >
                        <div className="space-y-2">
                          <label className="text-white text-[15px] font-sans font-medium block">
                            What made this hardest?
                          </label>
                          <textarea
                            rows={2}
                            className="w-full bg-[#111115] border border-[#27272A] focus:border-[#3F3F46] rounded-lg p-3 text-[14px] text-[#FAFAFA] placeholder:text-[#52525B] focus:outline-none resize-none leading-relaxed"
                            placeholder="Too distracted / didn't know where to start / ..."
                            value={debriefHardestPart}
                            onChange={(e) => setDebriefHardestPart(e.target.value)}
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="text-white text-[15px] font-sans font-medium block">
                            Did this plan actually help?
                          </label>
                          <div className="flex gap-4">
                            <button
                              type="button"
                              onClick={() => setDebriefRating(5)}
                              className={`flex-1 h-12 rounded-lg border flex items-center justify-center gap-2 text-sm font-medium transition-all cursor-pointer ${
                                debriefRating === 5
                                  ? 'border-[#3B82F6] bg-[#3B82F6]/5 text-[#3B82F6]'
                                  : 'border-[#27272A] bg-[#111115] text-[#A1A1AA] hover:border-[#3F3F46]'
                              }`}
                            >
                              👍 Yes
                            </button>

                            <button
                              type="button"
                              onClick={() => setDebriefRating(1)}
                              className={`flex-1 h-12 rounded-lg border flex items-center justify-center gap-2 text-sm font-medium transition-all cursor-pointer ${
                                debriefRating === 1
                                  ? 'border-[#3B82F6] bg-[#3B82F6]/5 text-[#3B82F6]'
                                  : 'border-[#27272A] bg-[#111115] text-[#A1A1AA] hover:border-[#3F3F46]'
                              }`}
                            >
                              👎 Not really
                            </button>
                          </div>
                        </div>

                        {debriefStep !== 3 && (
                          <button
                            type="button"
                            disabled={!debriefHardestPart.trim() || debriefRating === 0}
                            onClick={async () => {
                              await handleDebriefSubmit();
                            }}
                            className={`w-full h-11 rounded-lg text-sm font-semibold uppercase tracking-wider transition-all ${
                              debriefHardestPart.trim() && debriefRating !== 0
                                ? 'bg-[#3B82F6] text-white cursor-pointer hover:bg-[#3B82F6]/90'
                                : 'bg-[#111115] text-[#52525B] border border-[#27272A] cursor-not-allowed opacity-50'
                            }`}
                          >
                            Done →
                          </button>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {debriefStep === 3 && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="space-y-2 mt-4"
                    >
                      <h3 className="text-white text-lg font-medium">
                        ColdBreak will remember that.
                      </h3>
                      <p className="text-[#52525B] text-sm">
                        Your profile gets sharper each mission.
                      </p>
                    </motion.div>
                  )}
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Task Nudge / Interruption Overlay (Section 4) */}
      <AnimatePresence>
        {nudgeVisible && (
          <div id="nudge-overlay" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-md bg-[#180F0F] border border-[#EF4444]/60 rounded-xl p-6 shadow-2xl relative text-left"
            >
              <div className="flex items-center gap-2 mb-3">
                <ShieldAlert className="w-5 h-5 text-[#EF4444] shrink-0 animate-bounce" />
                <span className="text-xs font-mono text-[#EF4444] uppercase tracking-widest font-bold">ATTENTION INTERRUPT TRIGGERED</span>
              </div>
              <h3 className="text-white text-lg font-semibold mb-2">Maintain High-Integrity Stasis</h3>
              <p className="text-zinc-300 text-sm leading-relaxed mb-5">
                Your current operative profile is flagged for <span className="text-live-accent font-semibold">{CLASSES_LIST.find(c => c.id === archetype)?.name.toUpperCase() || archetype.replace('_', ' ').toUpperCase()}</span>. 
                Have you strayed from the objective? External cues or tab switching will breach stasis. Re-stabilize focus immediately.
              </p>
              <button
                type="button"
                onClick={() => setNudgeVisible(false)}
                className="w-full h-11 bg-[#EF4444] hover:bg-[#EF4444]/90 text-white font-semibold rounded-lg text-sm uppercase tracking-wider transition-colors cursor-pointer"
              >
                Understood, staying focused
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Operative Dossier Modal (Section 5) */}
      <AnimatePresence>
        {showHistory && (
          <div id="dossier-modal" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 15 }}
              className="w-full max-w-lg bg-[#070B1E] border border-[#6366F1]/50 rounded-xl p-6 shadow-2xl relative text-left flex flex-col max-h-[85vh]"
            >
              {/* Modal Header */}
              <div className="flex justify-between items-center border-b border-[#6366F1]/20 pb-3 mb-4 shrink-0">
                <div className="flex items-center gap-2">
                  <UserIcon className="w-5 h-5 text-live-accent" />
                  <h2 className="text-white font-bold text-lg font-sans">OPERATIVE DOSSIER</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setShowHistory(false)}
                  className="text-zinc-500 hover:text-white transition text-sm font-mono cursor-pointer"
                >
                  [CLOSE]
                </button>
              </div>

              {/* Profile Stats Cards */}
              <div className="grid grid-cols-2 gap-3 mb-5 shrink-0">
                <div className="bg-[#0D122B] border border-[#6366F1]/30 rounded-lg p-3">
                  <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider block">OPERATIVE RANK</span>
                  <span className="text-white text-sm font-semibold block mt-0.5">{getLevelFromXP(totalXP).title}</span>
                  <span className="text-[10px] font-mono text-[#6366F1] block mt-1">Level {getLevelFromXP(totalXP).level} ({totalXP} XP)</span>
                </div>

                <div className="bg-[#0D122B] border border-[#6366F1]/30 rounded-lg p-3">
                  <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider block">CURRENT COLD STREAK</span>
                  <span className="text-white text-base font-bold block mt-0.5">{currentStreak} Days</span>
                  <span className="text-[10px] font-mono text-[#6366F1] block mt-1">{missionsCompleted} Missions Completed</span>
                </div>
              </div>

              {/* Operative Class Selection — was previously imported but never rendered */}
              <div className="shrink-0 space-y-3 mb-5">
                <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider block">OPERATIVE CLASS</span>
                <div className="grid grid-cols-2 gap-2">
                  {CLASSES_LIST.map((cls) => (
                    <ClassCard
                      key={cls.id}
                      classDef={cls}
                      isSelected={archetype === cls.id}
                      onSelect={() => {
                        saveProfileSettings(gamma, cls.id);
                      }}
                    />
                  ))}
                </div>
                <p className="text-[10px] font-mono text-zinc-600 leading-relaxed">
                  Changing your class updates how ColdBreak structures your steps. Saved to your profile.
                </p>
              </div>

              {/* Log list container */}
              <div className="flex-1 overflow-y-auto pr-1 min-h-[220px] mb-5 space-y-3">
                <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider block shrink-0">COMPLETED OPERATIONS</span>
                
                {missionHistory.length === 0 ? (
                  <div className="text-center py-8 text-zinc-600 font-mono text-xs border border-dashed border-[#27272a]/40 rounded-lg">
                    No archived missions on record. Complete an operation to populate the log.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {missionHistory.map((m, idx) => (
                      <div key={idx} className="bg-[#0A0D23] border border-[#27272A] rounded-lg p-3 flex flex-col gap-1 hover:border-[#6366F1]/40 transition">
                        <div className="flex justify-between items-start">
                          <span className="text-white text-xs font-medium line-clamp-1">{m.taskText}</span>
                          <span className="text-live-accent text-[10px] font-mono bg-[#6366F1]/10 px-1.5 py-0.5 rounded font-bold shrink-0">+{m.xpEarned} XP</span>
                        </div>
                        <div className="flex justify-between items-center text-[10px] font-mono text-zinc-500 mt-1">
                          <span>Objectives: {m.stepsCompleted}/{m.stepsTotal}</span>
                          <span>{m.createdAt ? new Date(m.createdAt).toLocaleDateString() : '—'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Bottom Dismiss */}
              <button
                type="button"
                onClick={() => setShowHistory(false)}
                className="w-full h-11 bg-[#6366F1] hover:bg-[#4F46E5] text-white font-semibold rounded-lg text-sm uppercase tracking-wider transition-colors cursor-pointer shrink-0"
              >
                Back to Operation
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Cryo-Save Draft Review and Auto-Submit Modal */}
      <AnimatePresence>
        {isCryoSaveReviewOpen && (
          <div id="cryo-save-review-modal" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="w-full max-w-2xl bg-[#080512] border border-[#818cf8]/40 rounded-xl p-6 shadow-2xl relative text-left flex flex-col max-h-[90vh] overflow-hidden"
            >
              <div className="flex justify-between items-center mb-4 pb-2 border-b border-[#818cf8]/20 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-xl animate-pulse">❄️</span>
                  <span className="text-xs font-mono text-[#818cf8] uppercase tracking-widest font-bold">
                    CRYO-SAVE STASIS REVIEW TERMINAL
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCryoSaveReviewOpen(false)}
                  className="text-zinc-500 hover:text-white transition text-xs font-mono uppercase"
                >
                  [Close]
                </button>
              </div>

              {cryoDraftLoading ? (
                <div className="flex-1 flex flex-col items-center justify-center py-12 space-y-4 shrink-0">
                  <Loader2 className="w-8 h-8 text-[#818cf8] animate-spin" />
                  <div className="text-center space-y-1">
                    <p className="text-sm font-mono text-[#c7d2fe] uppercase tracking-widest">
                      COMPILING RAG CONTEXT & DRAFTING SOLUTION...
                    </p>
                    <p className="text-xs text-zinc-500 max-w-[400px] leading-relaxed">
                      Sifting through stasis-registered context files via Gemini to compile your auto-submission payload. Please stand by.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col min-h-0 space-y-4 overflow-y-auto">
                  {/* Countdown Status Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-[#110c24] border border-[#818cf8]/20 rounded-lg p-4 shrink-0">
                    <div className="space-y-1">
                      <span className="text-[9px] font-mono text-zinc-400 uppercase tracking-widest block">
                        Autonomous Dispatch Timer
                      </span>
                      <div className="flex items-baseline gap-2.5">
                        <span className={`text-2xl font-mono font-bold tracking-wider ${isTimerPaused ? 'text-amber-400' : 'text-rose-500 animate-pulse'}`}>
                          {formatTimer(cryoTimerRemaining)}
                        </span>
                        <span className="text-[10px] font-mono text-zinc-500">
                          {isTimerPaused ? '[PAUSED]' : 'UNTIL AUTO-SUBMIT'}
                        </span>
                      </div>
                      <p className="text-[10px] text-zinc-400">
                        Solution will automatically submit when timer reaches 00:00.
                      </p>
                    </div>

                    <div className="flex flex-col justify-between items-end gap-2 md:gap-0">
                      <button
                        type="button"
                        onClick={() => setIsTimerPaused(prev => !prev)}
                        className={`px-3 py-1.5 rounded font-mono text-xs uppercase tracking-wider transition cursor-pointer w-full md:w-auto text-center ${
                          isTimerPaused
                            ? 'bg-amber-500/10 border border-amber-500/40 text-amber-400 hover:bg-amber-500/20'
                            : 'bg-zinc-800/60 border border-zinc-700 text-zinc-300 hover:text-white'
                        }`}
                      >
                        {isTimerPaused ? '▶ Resume Clock' : '⏸ Pause Clock'}
                      </button>

                      <div className="text-right">
                        <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest block">
                          Recipient
                        </span>
                        <span className="text-xs font-sans text-indigo-200">
                          {activeTask?.recipient || 'No recipient configured'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Compiled Preview Section */}
                  <div className="flex-1 flex flex-col min-h-[220px] space-y-1.5">
                    <div className="flex justify-between items-center shrink-0">
                      <label className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest block">
                        Compiled Solution Draft (Editable)
                      </label>
                      <span className="text-[9px] font-mono text-indigo-400 uppercase bg-indigo-950/60 border border-indigo-800/40 px-1.5 py-0.5 rounded font-bold">
                        Format: {activeTask?.submissionFormat || 'PDF'}
                      </span>
                    </div>

                    <input
                      type="text"
                      placeholder="Submission Title"
                      value={cryoDraftTitle}
                      onChange={(e) => setCryoDraftTitle(e.target.value)}
                      className="w-full bg-[#110d21] border border-[#27272A] focus:border-[#818cf8]/60 rounded-lg px-3 py-2 text-xs text-white focus:outline-none font-semibold shrink-0"
                    />

                    <textarea
                      placeholder="Compiled solution text..."
                      value={cryoDraftContent}
                      onChange={(e) => setCryoDraftContent(e.target.value)}
                      className="flex-1 w-full bg-[#110d21] border border-[#27272A] focus:border-[#818cf8]/60 rounded-lg p-3 text-xs text-zinc-200 focus:outline-none resize-none leading-relaxed font-sans min-h-[140px]"
                    />
                  </div>

                  {/* Warning Box */}
                  <div className="bg-rose-950/20 border border-rose-500/30 rounded-lg p-3 shrink-0 text-[11px] text-rose-300 leading-normal space-y-1 font-mono">
                    <p className="font-semibold text-rose-400">⚠️ PENALTIES & CONDITIONS:</p>
                    <p>• Sending will immediately consume 1 Cryo-Save token from your balance.</p>
                    <p>• A penalty of -50 XP will be deducted from your account profile.</p>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-3 shrink-0">
                    <button
                      type="button"
                      onClick={handleConfirmCryoSave}
                      className="flex-1 h-11 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold rounded-lg text-xs uppercase tracking-wider transition-all cursor-pointer text-center flex items-center justify-center"
                    >
                      SEND NOW
                    </button>
                    
                    <button
                      type="button"
                      onClick={() => setIsCryoSaveReviewOpen(false)}
                      className="flex-1 h-11 border border-zinc-700 hover:border-zinc-500 text-zinc-400 hover:text-white font-semibold rounded-lg text-xs uppercase tracking-wider transition-colors cursor-pointer bg-transparent"
                    >
                      ABORT PROTOCOL
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* XP Flash Alert Toast Overlay (Section 7) */}
      <AnimatePresence>
        {xpFlashVisible && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.9 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 bg-[#10B981] border border-[#10B981] text-white px-5 py-2.5 rounded-full shadow-2xl font-mono text-xs font-bold tracking-wider flex items-center gap-2 pointer-events-none"
          >
            <Award className="w-4 h-4 text-white animate-pulse" />
            <span>{xpFlashText}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <footer className="py-6 mt-12 border-t border-white/5 text-center text-[10px] font-mono text-[#52525B] tracking-widest uppercase shrink-0">
        <span>ColdBreak · AI accountability that sends honest updates for you · Every word it says is true</span>
      </footer>
    </div>
  );
}
