/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from "react";
import { format, isSameDay, addDays, addWeeks, addMonths, isBefore, startOfDay, isAfter } from "date-fns";
import { 
  auth, 
  signInWithGoogle, 
  signOut, 
  subscribeTasks, 
  addTask, 
  updateTask, 
  deleteTask, 
  getUserProfile,
  saveUserProfile,
  Task 
} from "./services/firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import { CircularClock } from "./components/CircularClock";
import { DailyDock } from "./components/DailyDock";
import { TaskForm } from "./components/TaskForm";
import { Reporting } from "./components/Reporting";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Search, Plus, LogOut, Settings2, BarChart3, CalendarDays, Filter, User as UserIcon } from "lucide-react";
import { Toaster, toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import { notificationService } from "./services/notificationService";
import { playSound } from "./lib/sounds";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedDate, setSelectedDate] = useState(startOfDay(new Date()));
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [view, setView] = useState("day");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [activeView, setActiveView] = useState<"home" | "profile">("home");
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [mockupState, setMockupState] = useState({ view: '6h', hopping: false });
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState({
    hideCompleted: false,
    darkMode: false,
    haptic: true,
    sound: true
  });

  const requestNotificationPermission = async () => {
    if ("Notification" in window) {
      const permission = await Notification.requestPermission();
      return permission === "granted";
    }
    return false;
  };

  useEffect(() => {
    if (user) {
      requestNotificationPermission();
    }
  }, [user]);

  // Handle Dark Mode
  useEffect(() => {
    if (settings.darkMode) {
      document.documentElement.classList.add("dark");
      document.documentElement.classList.remove("light");
    } else {
      document.documentElement.classList.add("light");
      document.documentElement.classList.remove("dark");
    }
  }, [settings.darkMode]);

  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const triggerFeedback = (type: 'click' | 'success' | 'error' | 'delete') => {
    if (settings.haptic && "vibrate" in navigator) {
      navigator.vibrate(type === 'success' ? [15, 30, 15] : 15);
    }
    if (settings.sound && (type === 'success' || type === 'error' || type === 'click')) {
      playSound(type, true);
    }
  };

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      toast.success("Back online. Syncing data...", { icon: "☁️" });
    };
    const handleOffline = () => {
      setIsOnline(false);
      toast.error("Working offline. Changes will save locally.", { icon: "📦", duration: 5000 });
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  };

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      // Script error is usually a CORS issue in the iframe, safely ignore if no details
      if (event.message === "Script error.") return;
      
      console.warn("Caught global error:", event.error || event.message);
    };
    window.addEventListener("error", handleError);
    
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      setIsLoggingIn(false);
      setLoading(false);
      if (user) {
        try {
          const profile = await getUserProfile(user.uid);
          if (profile) {
            setSettings(prev => ({ 
              ...prev, 
              ...profile,
              // Ensure defaults if keys are missing in old profiles
              haptic: profile.haptic ?? true,
              sound: profile.sound ?? true
            }));
          }
        } catch (err) {
          console.warn("Failed to fetch profile:", err);
        }
      }
    });
    return () => {
      unsubscribe();
      window.removeEventListener("error", handleError);
    };
  }, []);

  const handleLogin = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    try {
      // Small timeout to allow state to settle
      await new Promise(r => setTimeout(r, 100));
      await signInWithGoogle();
      toast.success("Successfully connected");
    } catch (error: any) {
      setIsLoggingIn(false);
      console.error("Authentication Error:", error);
      
      if (error.code === "auth/popup-closed-by-user" || error.code === "auth/cancelled-popup-request") {
        return;
      }
      
      if (error.code === "auth/unauthorized-domain") {
        toast.error("Domain Error", {
          description: "This domain is not authorized in your Firebase console. Please add this URL to 'Authorized domains' in Firebase Authentication settings.",
          duration: 8000
        });
      } else if (error.code === "auth/popup-blocked") {
        toast.error("Popup Blocked: Please enable popups for this site.");
      } else if (error.code === "auth/network-request-failed") {
        toast.error("Network Error: Could not reach Google. Try disabling VPN or refreshing.");
      } else if (error.code === "auth/internal-error") {
        toast.error("Internal Auth Error: Please refresh and try again.");
      } else {
        toast.error(`Sign-in failed: ${error.message || "Unknown error"}`);
      }
    }
  };

  useEffect(() => {
    if (user) {
      let isMounted = true;
      let unsubscribe: (() => void) | undefined;
      
      try {
        unsubscribe = subscribeTasks(user.uid, (newTasks) => {
          if (isMounted) setTasks(newTasks);
        });
      } catch (err) {
        console.error("Firestore Subscription Error:", err);
        toast.error("Database connection lost. Please refresh.");
      }

      notificationService.requestPermission();
      return () => {
        isMounted = false;
        unsubscribe?.();
      };
    } else {
      setTasks([]);
    }
  }, [user]);

  // Periodic Reminder Check
  useEffect(() => {
    if (tasks.length === 0) return;
    
    // Check immediately
    notificationService.checkReminders(tasks, settings);
    
    // Check every minute
    const interval = setInterval(() => {
      notificationService.checkReminders(tasks, settings);
    }, 60000);
    
    return () => clearInterval(interval);
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    return tasks.filter(task => {
      const matchesSearch = task.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            task.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesHideCompleted = !settings.hideCompleted || !task.completed;
      return matchesSearch && matchesHideCompleted;
    });
  }, [tasks, searchQuery, settings.hideCompleted]);

  const checkConcurrency = (taskData: Omit<Task, "id" | "userId"> & { id?: string }, allTasks: Task[]) => {
    const taskId = taskData.id;
    const start = taskData.startTime.getTime();
    const end = taskData.endTime.getTime();

    if (end <= start) return true;
    
    // STRICT: Filter out the task currently being edited by ID if it exists.
    // We include COMPLETED tasks in the count to enforce the hard limit of 3 per time slot.
    const activeTasks = allTasks.filter(t => t.id !== taskId);

    // Points of interest are all start and end times that fall within the range of the proposed task
    const points = new Set<number>();
    points.add(start);
    points.add(end);
    
    activeTasks.forEach(t => {
      const ts = t.startTime.getTime();
      const te = t.endTime.getTime();
      // Only care about existing tasks that actually overlap with our new range
      if (te > start && ts < end) {
        if (ts > start && ts < end) points.add(ts);
        if (te > start && te < end) points.add(te);
      }
    });

    const sortedPoints = Array.from(points).sort((a, b) => a - b);

    // For every interval between points, check if count > 3
    for (let i = 0; i < sortedPoints.length - 1; i++) {
      const point = sortedPoints[i];
      let count = 1; // Count the proposed task
      
      for (const t of activeTasks) {
        if (point >= t.startTime.getTime() && point < t.endTime.getTime()) {
          count++;
        }
      }
      
      if (count > 3) return false;
    }
    
    return true;
  };

  const handleTaskSave = async (taskData: Omit<Task, "id" | "userId"> & { id?: string }) => {
    if (!user) return;
    
    // Ensure we preserve the ID if we are editing
    const finalTaskData = editingTask?.id ? { ...taskData, id: editingTask.id } : taskData;

    // Strict concurrency check: Limit to 3 overlapping tasks
    if (!checkConcurrency(finalTaskData, tasks)) {
      toast.error("Scheduling Limit: You cannot have more than 3 tasks sharing a common time.");
      return;
    }

    try {
      if (finalTaskData.id) {
        const { id, ...updates } = finalTaskData;
        await updateTask(user.uid, finalTaskData.id, updates);
        triggerFeedback('success');
        toast.success("Task updated");
      } else {
        // New task creation
        await addTask(user.uid, finalTaskData);
        triggerFeedback('success');
        
        // Handle recurrence only for NEW tasks to avoid duplication on each update
        if (finalTaskData.recurring && finalTaskData.recurring.type !== "none") {
          toast.loading("Generating recurring instances...");
          const validRecurrences: (Omit<Task, "id" | "userId">)[] = [];
          
          let currentStart = new Date(taskData.startTime);
          let currentEnd = new Date(taskData.endTime);
          const until = taskData.recurring.until;

          for (let i = 0; i < 365; i++) {
            if (validRecurrences.length >= 365) break;

            let nextStart: Date;
            let nextEnd: Date;

            if (taskData.recurring.type === "daily") {
              nextStart = addDays(currentStart, 1);
              nextEnd = addDays(currentEnd, 1);
            } else if (taskData.recurring.type === "weekly") {
              const days = taskData.recurring.daysOfWeek || [taskData.startTime.getDay()];
              let checkDate = addDays(currentStart, 1);
              let found = false;
              for (let d = 0; d < 7; d++) {
                if (days.includes(checkDate.getDay())) {
                  nextStart = new Date(checkDate);
                  const duration = taskData.endTime.getTime() - taskData.startTime.getTime();
                  nextEnd = new Date(nextStart.getTime() + duration);
                  found = true;
                  break;
                }
                checkDate = addDays(checkDate, 1);
              }
              if (!found) break;
            } else break;

            if (until && isAfter(nextStart!, until)) break;

            const recurringTask = {
              ...taskData,
              startTime: nextStart!,
              endTime: nextEnd!,
              recurring: { type: "none" as const }
            };

            if (checkConcurrency(recurringTask as any, [taskData as any, ...tasks, ...validRecurrences as any])) {
              validRecurrences.push(recurringTask as any); 
            }
            currentStart = nextStart!;
            currentEnd = nextEnd!;
          }

          if (validRecurrences.length > 0) {
            await Promise.all(validRecurrences.map(t => addTask(user.uid, t)));
            toast.dismiss();
            toast.success(`Created ${validRecurrences.length + 1} task instances`);
          } else {
            toast.dismiss();
            toast.success("Task added");
          }
        } else {
          toast.success("Task added");
        }
      }
    } catch (error) {
      console.error("Save error:", error);
      toast.error("Failed to save task");
    } finally {
      setEditingTask(null);
    }
  };

  const handleTaskDelete = async (id: string) => {
    if (!user) return;
    
    const taskToDelete = tasks.find(t => t.id === id);
    if (!taskToDelete) return;

    try {
      await deleteTask(user.uid, id);
      triggerFeedback('delete');
      
      toast.success("Task deleted", {
        action: {
          label: "Undo",
          onClick: async () => {
            triggerFeedback('click');
            const { id: _, ...taskData } = taskToDelete;
            await addTask(user.uid, taskData as any);
            toast.success("Task restored");
          }
        },
        duration: 5000
      });
    } catch (error) {
      triggerFeedback('error');
      toast.error("Failed to delete task");
    }
  };

  const isPastDate = useMemo(() => {
    return isBefore(startOfDay(selectedDate), startOfDay(new Date()));
  }, [selectedDate]);

  const currentDayTasks = useMemo(() => {
    return filteredTasks.filter(task => isSameDay(task.startTime, selectedDate));
  }, [filteredTasks, selectedDate]);

  const toggleSetting = async (key: keyof typeof settings) => {
    // We want the feedback to reflect the action taken
    setSettings(prev => {
      const isCurrentlyEnabled = prev[key];
      const nextValue = !isCurrentlyEnabled;
      
      // Feedback: if we are turning it ON, use the new value to decide if we should vibrate/play
      // If we are turning it OFF, we might still want a click sound if sound is currently enabled
      if (prev.haptic && "vibrate" in navigator) {
        navigator.vibrate(15);
      }
      if (prev.sound) {
        playSound('click', true);
      }

      const updated = { ...prev, [key]: nextValue };
      if (user) {
        saveUserProfile(user.uid, updated).catch(err => console.error("Failed to save setting", err));
      }
      return updated;
    });
  };

  // 1. Fix loading flash: Show a clean splash while authenticating
  if (loading) {
    return (
      <div className="fixed inset-0 bg-[#FDF6E3] flex items-center justify-center">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
          className="flex flex-col items-center space-y-6"
        >
          <div className="w-20 h-20 bg-white rounded-[2.5rem] shadow-2xl flex items-center justify-center border border-white relative">
            <div className="absolute inset-0 rounded-[2.5rem] bg-gradient-to-br from-blue-500/10 to-purple-500/10" />
            <div className="w-8 h-8 rounded-full border-4 border-slate-200 border-t-slate-800 animate-spin relative z-10" />
          </div>
          <motion.p 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-slate-800 font-serif italic text-xl font-medium"
          >
            Chronos
          </motion.p>
        </motion.div>
      </div>
    );
  }
  if (!user) {
    const onboardingPages = [
      {
        title: "Master Your Time",
        description: "Experience your day visually with our intuitive circular interface.",
        icon: <BarChart3 className="w-12 h-12 text-blue-600" />,
        mockup: (
          <div className="w-full flex flex-col space-y-4 md:space-y-4 mt-12 overflow-visible relative items-start">
            {[
              { name: "Build a Portfolio", color: "bg-[#2E83F6]", width: "w-56 md:w-72" },
              { name: "Workout for 30 minutes", color: "bg-[#ED4B9E]", width: "w-44 md:w-60" },
              { name: "Read 10 pages.", color: "bg-[#19BDBB]", width: "w-64 md:w-80" },
            ].map((task, i) => (
              <motion.div
                key={i}
                initial={{ x: -400, opacity: 0 }}
                animate={{ x: -60, opacity: 1 }}
                transition={{ 
                  delay: i * 0.3, 
                  duration: 1.4, 
                  ease: [0.65, 0, 0.35, 1] 
                }}
                className="flex flex-col gap-1 w-full"
              >
                <span className="text-[10px] md:text-sm font-black uppercase tracking-widest text-[#1e293b]/50 pl-16 text-left">
                  {task.name}
                </span>
                <div className={cn("h-8 md:h-12 rounded-r-[2rem] shadow-[0_10px_25px_-5px_rgba(0,0,0,0.1)]", task.color, task.width)} />
              </motion.div>
            ))}
          </div>
        )
      },
      {
        title: "Organize with Color",
        description: "Categorize life with vibrant labels and flowing recurring tasks.",
        icon: <Filter className="w-12 h-12 text-purple-600" />,
        mockup: (
          <div className="flex gap-3">
            {[ 'bg-rose-400', 'bg-blue-400', 'bg-emerald-400', 'bg-amber-400' ].map((c, i) => (
              <motion.div 
                key={i}
                animate={{ y: [0, -10, 0] }}
                transition={{ delay: i * 0.1, repeat: Infinity, duration: 3 }}
                className={cn("w-12 h-12 rounded-2xl shadow-lg flex items-center justify-center text-white font-black", c)} 
              >
                {i + 1}
              </motion.div>
            ))}
          </div>
        )
      },
      {
        title: "Stay Notified",
        description: "Smart reminders that gently nudge you towards your next action.",
        icon: <CalendarDays className="w-12 h-12 text-rose-500" />,
        mockup: (
          <div className="relative h-40 w-full flex justify-center items-center scale-90 md:scale-100">
            {/* Left Card - Second in order */}
            <motion.div
              initial={{ opacity: 0, x: 0, y: 30, rotate: 0 }}
              animate={{ opacity: 1, x: -45, y: 15, rotate: -10 }}
              transition={{ delay: 0.8, duration: 1.2, ease: [0.23, 1, 0.32, 1] }}
              className="absolute bg-white/30 backdrop-blur-lg p-4 rounded-3xl shadow-lg border border-white/40 flex items-center gap-4 w-52 z-10"
            >
              <div className="w-10 h-10 bg-rose-500/10 rounded-xl flex items-center justify-center shrink-0">
                <Plus className="w-5 h-5 text-rose-500" />
              </div>
              <div className="space-y-1.5 flex-1 p-1">
                <div className="h-2.5 w-full bg-rose-400/30 rounded-full" />
                <div className="h-1.5 w-2/3 bg-rose-400/15 rounded-full" />
              </div>
            </motion.div>

            {/* Right Card - Third in order */}
            <motion.div
              initial={{ opacity: 0, x: 0, y: 30, rotate: 0 }}
              animate={{ opacity: 1, x: 45, y: 15, rotate: 10 }}
              transition={{ delay: 1.4, duration: 1.2, ease: [0.23, 1, 0.32, 1] }}
              className="absolute bg-white/30 backdrop-blur-lg p-4 rounded-3xl shadow-lg border border-white/40 flex items-center gap-4 w-52 z-10"
            >
              <div className="w-10 h-10 bg-rose-500/10 rounded-xl flex items-center justify-center shrink-0">
                <Plus className="w-5 h-5 text-rose-500" />
              </div>
              <div className="space-y-1.5 flex-1 p-1">
                <div className="h-2.5 w-full bg-rose-400/30 rounded-full" />
                <div className="h-1.5 w-2/3 bg-rose-400/15 rounded-full" />
              </div>
            </motion.div>

            {/* Center Card - First in order */}
            <motion.div
              initial={{ opacity: 0, y: 40, scale: 0.9 }}
              animate={{ opacity: 1, y: -10, scale: 1 }}
              transition={{ delay: 0.3, duration: 1.2, ease: [0.23, 1, 0.32, 1] }}
              className="absolute bg-white/60 backdrop-blur-xl p-5 rounded-[2.5rem] shadow-2xl border border-white/80 flex items-center gap-5 w-64 z-20"
            >
              <div className="w-12 h-12 bg-rose-500/15 rounded-2xl flex items-center justify-center shrink-0">
                <Plus className="w-6 h-6 text-rose-500" />
              </div>
              <div className="space-y-2 flex-1 p-1">
                <div className="h-3.5 w-full bg-rose-400/50 rounded-full" />
                <div className="h-2.5 w-3/4 bg-rose-400/30 rounded-full" />
              </div>
            </motion.div>
          </div>
        )
      },
      {
        title: "Your View",
        description: "Double tap the center to toggle between a 6-hour slice and a full 24-hour cycle.",
        icon: <Settings2 className="w-12 h-12 text-indigo-600" />,
        mockup: (
          <div 
            className="relative h-64 w-full flex items-center justify-center select-none cursor-pointer group"
            onDoubleClick={() => setMockupState(s => ({ ...s, view: s.view === '6h' ? '24h' : '6h' }))}
          >
            <motion.div 
              animate={{ 
                y: mockupState.view === '6h' ? "50%" : "0%",
                scale: mockupState.view === '6h' ? 1.6 : 1,
              }}
              transition={{ type: "spring", stiffness: 180, damping: 22 }}
              className="relative w-64 h-64 md:w-80 md:h-80 rounded-full border-[10px] border-white/40 bg-white/10 shadow-[0_40px_80px_-20px_rgba(0,0,0,0.1)] flex items-center justify-center backdrop-blur-3xl"
              style={{ 
                clipPath: mockupState.view === '6h' ? 'inset(0 0 50% 0)' : 'inset(-100% -100% -100% -100%)'
              }}
            >
              {/* Decorative rings */}
              <div className="absolute inset-2 rounded-full border border-white/20" />
              <div className="absolute inset-8 rounded-full border border-white/10" />
              
              {/* Central Pivot - Rose dot */}
              <div className="absolute w-4 h-4 bg-rose-500 rounded-full z-50 shadow-[0_0_10px_rgba(244,63,94,0.4)] border-2 border-white" />

              {/* Hands */}
              <motion.div 
                animate={{ rotate: mockupState.view === '6h' ? 30 : 180 }}
                className="absolute w-2 h-20 bg-slate-800 rounded-full origin-bottom z-30 shadow-lg"
                style={{ bottom: "50%" }}
              >
                <div className="absolute top-1 left-1/2 -translate-x-1/2 w-0.5 h-4 bg-slate-600 rounded-full opacity-40" />
              </motion.div>
              <motion.div 
                animate={{ rotate: mockupState.view === '6h' ? -80 : 45 }}
                className="absolute w-1.5 h-24 bg-slate-700/60 rounded-full origin-bottom z-20"
                style={{ bottom: "50%" }}
              />

              {/* Numbers */}
              {[12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((num) => {
                const angle = (num * 30);
                const isVisible = mockupState.view === '24h' || (num >= 6 && num <= 12) || num === 12;
                
                return (
                  <motion.div
                    key={num}
                    animate={{ 
                      opacity: isVisible ? 1 : 0,
                      scale: isVisible ? 1 : 0.4,
                      y: isVisible ? 0 : 20
                    }}
                    className="absolute font-sans font-black text-slate-800 text-lg md:text-xl pointer-events-none"
                    style={{
                      transform: `rotate(${angle}deg) translateY(-100px) rotate(-${angle}deg)`
                    }}
                  >
                    {num}
                  </motion.div>
                );
              })}

              {/* Minute Ticks */}
              {Array.from({ length: 60 }).map((_, i) => (
                <div 
                  key={i}
                  className={cn(
                    "absolute w-0.5 rounded-full transition-opacity duration-500",
                    i % 5 === 0 ? "h-3 bg-slate-800/20" : "h-1 bg-slate-800/10",
                    mockupState.view === '6h' && (i * 6 > 90 && i * 6 < 270) ? "opacity-0" : "opacity-100"
                  )}
                  style={{
                    transform: `rotate(${i * 6}deg) translateY(-120px)`
                  }}
                />
              ))}
            </motion.div>
          </div>
        )
      },
      {
        title: "Welcome",
        description: "Ready to rediscover the beauty of a well-lived hour?",
        icon: <UserIcon className="w-12 h-12 text-slate-900" />,
        mockup: (
          <Button 
            onClick={handleLogin} 
            disabled={isLoggingIn}
            className="w-72 h-18 bg-white/10 backdrop-blur-[20px] hover:bg-white/20 text-slate-900 rounded-full text-xl font-black uppercase tracking-[0.2em] shadow-[0_20px_50px_rgba(0,0,0,0.1)] transition-all hover:scale-105 active:scale-95 border border-white/60 ring-1 ring-black/5"
          >
            {isLoggingIn ? "Syncing..." : "Get Started"}
          </Button>
        )
      }
    ];

    const onboardingGradients = [
      "from-[#FFD1DC] via-[#FDF6E3] to-[#E6E6FA]", 
      "from-[#B3E5FC] via-[#E8F4FD] to-[#C5CAE9]", 
      "from-[#FFE0B2] via-[#FFF3E0] to-[#FFCCBC]",
      "from-[#E0F2F1] via-[#F5F5F5] to-[#B2DFDB]",
      "from-[#F3E5F5] via-[#FDF6E3] to-[#E1BEE7]",
    ];

    const current = onboardingPages[onboardingStep];

    return (
      <div className={cn(
        "fixed inset-0 transition-all duration-1000 ease-in-out overflow-hidden flex flex-col font-sans bg-gradient-to-br",
        onboardingGradients[onboardingStep]
      )}>
        {/* Shifting Blurred Ambient Elements */}
        <motion.div 
          animate={{ 
            x: [0, 150, -150, 0],
            y: [0, -100, 100, 0],
          }}
          transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
          className="absolute top-[-25%] right-[-15%] w-[120%] h-[120%] rounded-full blur-[160px] opacity-70 mix-blend-overlay bg-white/40" 
        />
        <motion.div 
          animate={{ 
            x: [0, -150, 150, 0],
            y: [0, 150, -150, 0],
          }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          className="absolute bottom-[-35%] left-[-25%] w-[130%] h-[130%] rounded-full blur-[160px] opacity-50 mix-blend-multiply bg-indigo-200" 
        />

        <div className="flex-1 flex flex-col items-center justify-center px-6 transition-all overflow-hidden relative z-10">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={onboardingStep}
              initial={{ opacity: 0, x: 10, scale: 0.995 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: -10, scale: 1.005 }}
              transition={{ 
                type: "spring", 
                stiffness: 400, 
                damping: 35,
                mass: 0.5,
                restDelta: 0.001
              }}
              className="max-w-md w-full flex flex-col items-center text-center space-y-2 md:space-y-8"
            >
              <motion.div 
                animate={{ y: [0, -6, 0] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                className="w-24 h-24 md:w-40 md:h-40 bg-white/40 backdrop-blur-xl rounded-[2.5rem] shadow-xl flex items-center justify-center border border-white/90 relative group"
              >
                <div className="absolute inset-2.5 rounded-[2rem] border border-white/50 bg-gradient-to-br from-white/20 to-transparent" />
                <div className="relative z-10 scale-[0.7] md:scale-100 italic">
                  {current.icon}
                </div>
              </motion.div>

              <div className="space-y-1 md:space-y-4 px-4 overflow-hidden">
                <h1 className="text-2xl md:text-5xl font-sans font-black text-slate-800 leading-tight tracking-tight">
                  {current.title}
                </h1>
                <p className="text-slate-600 text-[12px] md:text-lg leading-relaxed font-medium opacity-80 max-w-[240px] md:max-w-none mx-auto">
                  {current.description}
                </p>
              </div>

              {current.mockup && (
                <div className="h-40 md:h-72 flex items-center justify-center w-full relative">
                  <div className="absolute inset-x-6 inset-y-6 bg-white/20 blur-3xl rounded-full opacity-50" />
                  <div className={cn(
                    "relative z-10 w-full md:scale-100 flex",
                    onboardingStep === 0 ? "justify-start" : "justify-center scale-[0.85]"
                  )}>
                    {current.mockup}
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="pb-12 pt-2 px-6 flex flex-col items-center space-y-6 relative z-20 w-full mb-4">
          {onboardingStep < onboardingPages.length - 1 ? (
            <div className="flex w-full max-w-sm items-center justify-between">
              <Button 
                variant="ghost" 
                onClick={() => setOnboardingStep(onboardingPages.length - 1)}
                className="text-slate-500 font-bold hover:bg-white/40 rounded-2xl h-14 px-4 transition-colors"
              >
                Skip
              </Button>
              
              <div className="flex gap-2 items-center">
                {onboardingPages.map((_, i) => (
                  <motion.div 
                    key={i} 
                    animate={{ 
                      width: onboardingStep === i ? 24 : 8,
                      opacity: onboardingStep === i ? 1 : 0.2,
                      backgroundColor: "#1e293b"
                    }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    className="h-2 rounded-full" 
                  />
                ))}
              </div>

              <Button 
                onClick={() => setOnboardingStep(prev => prev + 1)}
                className="bg-slate-900 text-white rounded-3xl px-8 h-14 font-black shadow-[0_15px_30px_-5px_rgba(0,0,0,0.2)] hover:scale-105 active:scale-95 transition-all text-base border-2 border-white/20 whitespace-nowrap"
              >
                Next
              </Button>
            </div>
          ) : (
             <div className="flex gap-3 h-16 items-center">
              {onboardingPages.map((_, i) => (
                <div 
                  key={i} 
                  className={cn(
                    "h-2 rounded-full transition-all duration-500",
                    onboardingStep === i ? 'w-10 bg-slate-900' : 'w-2 bg-slate-900/20'
                  )} 
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (activeView === "profile") {
    return (
      <div className="min-h-screen max-w-lg mx-auto bg-paper flex flex-col animate-in slide-in-from-right duration-300">
        <header className="p-6 flex items-center justify-between border-b border-black/5 dark:border-white/5 bg-white/30 dark:bg-black/30 backdrop-blur-md">
          <Button variant="ghost" size="sm" onClick={() => setActiveView("home")} className="rounded-full">
            Back
          </Button>
          <h2 className="text-xl font-serif font-bold">Profile</h2>
          <div className="w-12" /> {/* Spacer */}
        </header>
        
        <main className="flex-1 p-6 space-y-8">
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="w-24 h-24 rounded-full border-4 border-white dark:border-zinc-800 shadow-xl overflow-hidden bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center">
              {user.photoURL ? (
                <img src={user.photoURL} alt={user.displayName || "User"} className="w-full h-full object-cover" />
              ) : (
                <UserIcon className="w-12 h-12 text-zinc-400 dark:text-zinc-500" />
              )}
            </div>
            <div>
              <h3 className="text-2xl font-serif font-black">{user.displayName}</h3>
              <p className="text-sm text-muted-foreground font-mono">{user.email}</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="glass-card p-6 space-y-6 rounded-[2.5rem] border border-black/5 dark:border-white/10 shadow-xl overflow-hidden">
              <div className="space-y-1">
                <h4 className="text-xs uppercase tracking-widest font-black text-muted-foreground">General Settings</h4>
                <div className="py-2 border-b border-black/5 dark:border-white/5 flex justify-between items-center cursor-pointer" onClick={() => toggleSetting('darkMode')}>
                  <span className="text-sm font-medium">Dark Mode</span>
                  <div className={cn(
                    "w-10 h-5 rounded-full relative transition-colors duration-300",
                    settings.darkMode ? "bg-indigo-500" : "bg-black/10"
                  )}>
                    <motion.div 
                      animate={{ x: settings.darkMode ? 20 : 0 }}
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                      className="absolute top-1 left-1 w-3 h-3 bg-white rounded-full shadow-sm" 
                    />
                  </div>
                </div>
                <div className="py-2 border-b border-black/5 dark:border-white/5 flex justify-between items-center cursor-pointer" onClick={() => toggleSetting('haptic')}>
                  <span className="text-sm font-medium">Haptic Feedback</span>
                  <div className={cn(
                    "w-10 h-5 rounded-full relative transition-colors duration-300",
                    settings.haptic ? "bg-green-500" : "bg-black/10"
                  )}>
                    <motion.div 
                      animate={{ x: settings.haptic ? 20 : 0 }}
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                      className="absolute top-1 left-1 w-3 h-3 bg-white rounded-full shadow-sm" 
                    />
                  </div>
                </div>
                <div className="py-2 border-b border-black/5 dark:border-white/5 flex justify-between items-center cursor-pointer" onClick={() => toggleSetting('sound')}>
                  <span className="text-sm font-medium">Sound Effects</span>
                  <div className={cn(
                    "w-10 h-5 rounded-full relative transition-colors duration-300",
                    settings.sound ? "bg-blue-500" : "bg-black/10"
                  )}>
                    <motion.div 
                      animate={{ x: settings.sound ? 20 : 0 }}
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                      className="absolute top-1 left-1 w-3 h-3 bg-white rounded-full shadow-sm" 
                    />
                  </div>
                </div>
                <div className="py-2 border-b border-black/5 dark:border-white/5 flex justify-between items-center cursor-pointer" onClick={() => toggleSetting('hideCompleted')}>
                  <span className="text-sm font-medium">Remove Completed Tasks</span>
                  <div className={cn(
                    "w-10 h-5 rounded-full relative transition-colors duration-300",
                    settings.hideCompleted ? "bg-orange-500" : "bg-black/10"
                  )}>
                    <motion.div 
                      animate={{ x: settings.hideCompleted ? 20 : 0 }}
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                      className="absolute top-1 left-1 w-3 h-3 bg-white rounded-full shadow-sm" 
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1 pt-4">
                <h4 className="text-xs uppercase tracking-widest font-black text-muted-foreground">Danger Zone</h4>
                <Button 
                  variant="destructive" 
                  onClick={() => { triggerFeedback('delete'); signOut(); setActiveView("home"); }} 
                  className="w-full rounded-2xl h-12 flex items-center justify-center gap-2"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </Button>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen max-w-lg mx-auto bg-paper flex flex-col relative overflow-visible">
      <Toaster />
      
      {/* Header Layer */}
      <header className="sticky top-0 bg-transparent p-6 space-y-4 z-[40]">
        <div className="flex justify-between items-center">
          <motion.div 
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="cursor-pointer active:opacity-70 transition-opacity"
            onClick={() => {
              const today = new Date();
              triggerFeedback('click');
              setSelectedDate(today);
              toast.info("Back to today", { 
                icon: <CalendarDays className="w-4 h-4" />,
                duration: 2000 
              });
            }}
          >
            <h1 className="text-3xl font-serif font-bold">{getGreeting()}</h1>
            <p className="text-xs text-muted-foreground font-mono">{format(new Date(), "EEEE, MMMM do")}</p>
          </motion.div>
          <div className="flex gap-2">
             <Button 
               variant="ghost" 
               size="icon" 
               onClick={() => { triggerFeedback('click'); setActiveView("profile"); }} 
               className="rounded-full w-10 h-10 bg-white/50 dark:bg-zinc-800/50 shadow-sm border border-white/20 dark:border-white/10 p-0 overflow-hidden flex items-center justify-center"
             >
               {user.photoURL ? (
                 <img src={user.photoURL} alt={user.displayName || "User"} className="w-full h-full object-cover" />
               ) : (
                 <UserIcon className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
               )}
             </Button>
          </div>
        </div>
      </header>

      {/* Main Content Area (Always Clear Layer) */}
      <main className="flex-1 relative flex items-center justify-center z-20 overflow-visible">
        <div className="w-full h-full flex items-center justify-center overflow-visible">
          <CircularClock 
            tasks={filteredTasks} 
            selectedDate={selectedDate} 
            onTaskClick={(task) => setEditingTask(task)}
            onTaskUpdate={handleTaskSave}
            onTaskDelete={handleTaskDelete}
            accentColor="#3B82F6"
            expandedTaskId={expandedTaskId}
            onExpandedTaskIdChange={setExpandedTaskId}
            hapticEnabled={settings.haptic}
            soundEnabled={settings.sound}
          />
        </div>
      </main>

      {/* Footer / Dock Area Layer */}
      <footer className="fixed bottom-0 left-0 right-0 z-30 pb-4 flex items-center justify-center pointer-events-none transition-all duration-500 bg-gradient-to-t from-paper/95 via-paper/80 to-transparent pt-20">
        <div className="flex items-center gap-4 pointer-events-auto scale-90 sm:scale-100 px-6">
          <div className="rounded-[40px] overflow-hidden shadow-[0_15px_45px_rgba(0,0,0,0.15)] bg-white/20 dark:bg-zinc-900/40 backdrop-blur-xl border border-white/40 dark:border-white/10 p-1">
             <DailyDock selectedDate={selectedDate} onDateSelect={(d) => { 
               triggerFeedback('click'); 
               setSelectedDate(d);
               setExpandedTaskId(null);
             }} />
          </div>
          
          <motion.button 
            whileHover={isPastDate ? {} : { scale: 1.1, rotate: 180 }}
            whileTap={isPastDate ? {} : { scale: 0.9 }}
            onClick={() => {
              if (!isPastDate) {
                triggerFeedback('click');
                setExpandedTaskId(null);
                setIsAddingTask(true);
              }
            }}
            className={cn(
               "w-14 h-14 rounded-full flex items-center justify-center group shrink-0 border-4 border-white/50 dark:border-white/10 backdrop-blur-md transition-all shadow-2xl",
               isPastDate 
                 ? "bg-muted text-muted-foreground opacity-50 cursor-not-allowed" 
                 : "bg-[#1A1A1A] dark:bg-[#2A2A2A] text-[#F5F2ED] dark:text-[#F5F2ED]"
            )}
            disabled={isPastDate}
          >
            <Plus className="w-7 h-7 font-black" />
          </motion.button>
        </div>
      </footer>

      {/* Floating Add Button Removed since it's now in the dock area */}

      {/* Bottom Sheet for Task Creation/Editing */}
      <AnimatePresence>
        {(isAddingTask || !!editingTask) && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setIsAddingTask(false); setEditingTask(null); }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
            />
            
            {/* Sheet */}
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto h-[85vh] z-50 rounded-t-[3rem] shadow-2xl overflow-hidden bg-paper"
            >
              {/* Handle */}
              <div className="absolute top-3 left-1/2 -translate-x-1/2 w-12 h-1.5 bg-black/10 dark:bg-white/20 rounded-full z-10" />
              
              <TaskForm 
                task={editingTask} 
                tasks={tasks} // Pass all tasks for color logic
                selectedDate={selectedDate} 
                onSave={handleTaskSave} 
                onDelete={handleTaskDelete}
                onClose={() => { setIsAddingTask(false); setEditingTask(null); }} 
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
