import React, { useMemo, useState, useEffect, useRef } from "react";
import { format, differenceInMinutes, startOfDay, addMinutes, isAfter, isBefore, isSameDay, isToday } from "date-fns";
import { motion, AnimatePresence, animate, useMotionValue, useTransform } from "motion/react";
import { Task } from "../services/firebase";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Hash, Check, AlertCircle, Pencil, Sun, Moon, Clock, Trash2 } from "lucide-react";

interface CircularClockProps {
  tasks: Task[];
  selectedDate: Date;
  onTaskClick: (task: Task) => void;
  onTaskUpdate?: (task: Task) => void;
  onTaskDelete?: (id: string) => void;
  accentColor: string;
  expandedTaskId?: string | null;
  onExpandedTaskIdChange?: (id: string | null) => void;
  hapticEnabled?: boolean;
  soundEnabled?: boolean;
}

export const CircularClock: React.FC<CircularClockProps> = ({ 
  tasks, 
  selectedDate, 
  onTaskClick,
  onTaskUpdate,
  onTaskDelete,
  accentColor,
  expandedTaskId: externalExpandedTaskId,
  onExpandedTaskIdChange,
  hapticEnabled = true,
  soundEnabled = true
}) => {
  const radius = 300;
  const innerRadius = 240;
  const centerX = 500; 
  const centerY = 290; 
  const svgRef = useRef<SVGSVGElement>(null);

  const [hoveredTask, setHoveredTask] = useState<Task | null>(null);
  const [internalExpandedTaskId, setInternalExpandedTaskId] = useState<string | null>(null);

  const expandedTaskId = externalExpandedTaskId !== undefined ? externalExpandedTaskId : internalExpandedTaskId;
  const setExpandedTaskId = (id: string | null) => {
    if (onExpandedTaskIdChange) {
      onExpandedTaskIdChange(id);
    } else {
      setInternalExpandedTaskId(id);
    }
  };
  const [isSummaryView, setIsSummaryView] = useState(false);
  
  // Use a motion value for transition progress to interpolate angles smoothly
  const summaryProgress = useMotionValue(0);
  const tickerMotion = useMotionValue(0);

  useEffect(() => {
    animate(summaryProgress, isSummaryView ? 1 : 0, {
      type: "spring",
      stiffness: 120,
      damping: 24,
      onUpdate: (v) => {
        tickerMotion.set(v);
        setForceUpdate({});
      }
    });
  }, [isSummaryView, summaryProgress, tickerMotion]);

  const [now, setNow] = useState(new Date());

  useEffect(() => {
    // Refresh every minute to sync clock hand
    const interval = setInterval(() => {
      setNow(new Date());
    }, 60000);
    return () => clearInterval(interval);
  }, []);
  
  const [scrollMinutes, setScrollMinutes] = useState(() => {
    const hours = now.getHours();
    return Math.floor(hours / 6) * 360;
  });
  const defaultScrollMinutes = useMemo(() => {
    const hours = now.getHours();
    return Math.floor(hours / 6) * 360;
  }, [now]);
  const scrollMinutesMotion = useMotionValue(scrollMinutes);
  
  // Update motion value when state changes (e.g. from external resets)
  useEffect(() => {
    scrollMinutesMotion.set(scrollMinutes);
  }, [scrollMinutes]);

  const [isScrolling, setIsScrolling] = useState(false);
  const scrollStartRef = useRef<{ y: number; startMinutes: number; startTime: number; lastY: number; velocity: number } | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Use a ticker for motion-driven derived values (like angles)
  const [ticker, setTicker] = useState(0);
  const [effectiveScrollMinutes, setEffectiveScrollMinutes] = useState(scrollMinutes);

  useEffect(() => {
    const unsubTicker = tickerMotion.on("change", (latest) => setTicker(latest));
    const unsubScroll = scrollMinutesMotion.on("change", (latest) => {
      if (!isNaN(latest)) setEffectiveScrollMinutes(latest);
    });
    return () => {
      unsubTicker();
      unsubScroll();
    };
  }, []);

  const [, setForceUpdate] = useState({});
  useEffect(() => {
    // No-op version since we unified with ticker above
    return undefined;
  }, []);

  const effectiveWindowStartMinutes = effectiveScrollMinutes;
  const effectiveWindowEndMinutes = effectiveWindowStartMinutes + 360;

  // STABLE TRACKS: Calculate tracks for current + next day
  const stableTaskLayout = useMemo(() => {
    const d = startOfDay(selectedDate);
    const dayStart = d;
    const dayEnd = addMinutes(d, 2880);

    const dayTasks = tasks.filter(task => {
      return isBefore(task.startTime, dayEnd) && isAfter(task.endTime, dayStart);
    });

    const tasksByCategory: Record<string, Task[]> = {};
    dayTasks.forEach(t => {
      const cat = t.category || "none";
      if (!tasksByCategory[cat]) tasksByCategory[cat] = [];
      tasksByCategory[cat].push(t);
    });

    const layout: (Task & { trackIndex: number })[] = [];
    const globalTracks: Date[] = []; // Global pool for better track utilization

    // Sort all tasks by start time to fill tracks efficiently
    const sortedTasks = [...dayTasks].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

    sortedTasks.forEach(task => {
      let trackIndex = 0;
      // Support unlimited tracks (theoretically) - spacing determined by trackIndex
      while (globalTracks[trackIndex] && isAfter(addMinutes(globalTracks[trackIndex], 2), task.startTime)) {
        trackIndex++;
      }
      globalTracks[trackIndex] = task.endTime;
      layout.push({ ...task, trackIndex });
    });

    const totalTracks = Math.max(3, globalTracks.length);
    const categoryOrder = ["none", "in-progress", "important", "urgent"];

    // Maintain category info for metadata but don't use for track offsets
    const categoryInfo = categoryOrder.map(cat => ({
      category: cat,
      firstTrack: 0,
      trackCount: globalTracks.length
    }));

    return { layout, totalTracks, categoryTrackInfo: categoryInfo };
  }, [tasks, selectedDate]);

  const categoryTrackInfo = stableTaskLayout.categoryTrackInfo;

  const currentWindowTasks = useMemo(() => {
    if (isSummaryView) {
      const d = startOfDay(selectedDate);
      const dayEnd = addMinutes(d, 1440);
      return stableTaskLayout.layout.filter(t => 
        isBefore(t.startTime, dayEnd) && isAfter(t.endTime, d)
      );
    }

    const d = startOfDay(selectedDate);
    const windowStart = addMinutes(d, effectiveWindowStartMinutes);
    const windowEnd = addMinutes(d, effectiveWindowEndMinutes);

    return stableTaskLayout.layout.filter(task => {
      return isBefore(task.startTime, windowEnd) && isAfter(task.endTime, windowStart);
    });
  }, [stableTaskLayout, effectiveWindowStartMinutes, selectedDate, isSummaryView]);

  const trackOffsets = useMemo(() => {
    const offsets: number[] = [0];
    let currentOffset = 0;
    
    // Account for at least 3 tracks to keep background strips consistent
    const trackCount = Math.max(3, stableTaskLayout.totalTracks);
    
    // Find if ANY task in the layout is expanded, and which track it's in.
    // This makes track positions STABLE during scrolling.
    const expandedTask = expandedTaskId ? stableTaskLayout.layout.find(t => t.id === expandedTaskId) : null;
    const expandedTrackIndex = expandedTask ? expandedTask.trackIndex : -1;

    for (let i = 0; i < trackCount; i++) {
      // Use a slightly more stable logic for track thickness
      const isTrackExpanded = (i === expandedTrackIndex);
      const trackThickness = isTrackExpanded ? 65 : 10;
      currentOffset += trackThickness;
      offsets[i + 1] = currentOffset;
    }
    return offsets;
  }, [stableTaskLayout.totalTracks, stableTaskLayout.layout, expandedTaskId]);

  const maxOuterRadius = useMemo(() => {
    // Collect all unique track indices used by ALL tasks for this day to determine the absolute "outermost"
    const relevantTasks = stableTaskLayout.layout;
    if (relevantTasks.length === 0) return radius + 20;

    let maxR = radius + 20;
    relevantTasks.forEach(task => {
      const isExpanded = expandedTaskId === task.id;
      // Formula matches trackRadius logic
      const tRadius = (radius - 30) + (task.trackIndex * 60) + (trackOffsets[task.trackIndex] || 0);
      const outerEdge = tRadius + (isExpanded ? 50 : 30);
      if (outerEdge > maxR) maxR = outerEdge;
    });
    return maxR + 20;
  }, [stableTaskLayout.layout, trackOffsets, expandedTaskId, radius]);

  const lastCenterClickRef = useRef<number>(0);

  const handleCenterClick = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    const now = Date.now();
    if (now - lastCenterClickRef.current < 300) {
      // Double tap detected
      setIsSummaryView(prev => !prev);
      setExpandedTaskId(null);
      triggerFeedback();
      lastCenterClickRef.current = 0; // Reset
    } else {
      lastCenterClickRef.current = now;
      setExpandedTaskId(null);
    }
  };

  // Reset scroll to current window if date is changed to "today" via greeting or other means
  useEffect(() => {
    if (isSameDay(selectedDate, new Date())) {
      const hours = new Date().getHours();
      const target = Math.floor(hours / 6) * 360;
      if (scrollMinutes !== target) {
        animate(scrollMinutesMotion, target, {
          type: "spring",
          stiffness: 120,
          damping: 25,
          onUpdate: (v) => setScrollMinutes(v)
        });
      }
    }
  }, [selectedDate, scrollMinutesMotion]);

  const getTimeAngle = (date: Date, clamp = true) => {
    const d = startOfDay(selectedDate);
    
    // Summary View Angle: 270 (top) sweep 360 clockwise
    const diffMsSummary = date.getTime() - d.getTime();
    const diffMinSummary = diffMsSummary / (1000 * 60);
    // Fixed: Ensure summary angle is correctly calculated for the full day (1440 mins)
    const summaryAngle = 270 + (diffMinSummary / 1440) * 360;

    // Normal View Angle: 90 (bottom) sweep 180 clockwise
    const winStart = addMinutes(d, effectiveWindowStartMinutes);
    const diffMsNormal = date.getTime() - winStart.getTime();
    const diffMinNormal = diffMsNormal / (1000 * 60);
    
    // In normal view, we MUST clamp so tasks outside the window don't wrap around the circle
    const finalMinNormal = clamp ? Math.max(0, Math.min(360, diffMinNormal)) : diffMinNormal;
    const normalAngle = 90 + (finalMinNormal / 360) * 180;

    // Blend based on summaryProgress for smooth path animation
    const progress = summaryProgress.get();
    return normalAngle + (summaryAngle - normalAngle) * progress;
  };

  const polarToCartesian = (cx: number, cy: number, r: number, angleDeg: number) => {
    if (isNaN(cx) || isNaN(cy) || isNaN(r) || isNaN(angleDeg)) return { x: 0, y: 0 };
    const angleRad = (angleDeg * Math.PI) / 180.0;
    return {
      x: cx + r * Math.cos(angleRad),
      y: cy + r * Math.sin(angleRad)
    };
  };

  const describeArc = (startAngle: number, endAngle: number, r: number) => {
    // Extensive guards for NaN/Infinite values to prevent 'Script error' in SVG rendering
    if (isNaN(startAngle) || isNaN(endAngle) || isNaN(r)) return "";
    
    // Reverse angles if start is greater than end for consistent arc drawing
    // This ensures the path always starts at the "earlier" point on the track
    const s = Math.min(startAngle, endAngle);
    const e = Math.max(startAngle, endAngle);

    const radius = Math.max(0.1, r);
    const startPos = polarToCartesian(centerX, centerY, radius, e);
    const endPos = polarToCartesian(centerX, centerY, radius, s);
    
    // Additional coordinate safety
    if (isNaN(startPos.x) || isNaN(startPos.y) || isNaN(endPos.x) || isNaN(endPos.y)) return "";

    const diff = e - s;
    const largeArcFlag = diff <= 180 ? "0" : "1";
    
    // Prevent drawing arc if start and end are too close (causes path pollution)
    if (diff < 0.01) return `M ${startPos.x} ${startPos.y}`;

    return [
      "M", startPos.x, startPos.y,
      "A", radius, radius, 0, largeArcFlag, 0, endPos.x, endPos.y
    ].join(" ");
  };

  const lastFeedbackMinutesRef = useRef<number>(scrollMinutes);

  const triggerFeedback = React.useCallback(() => {
    try {
      if (soundEnabled) {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        const ctx = audioContextRef.current;
        
        // Resume context if it was suspended (common in browsers)
        if (ctx.state === 'suspended') {
          ctx.resume();
        }

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.type = 'sine';
        // Slightly more audible frequency and duration
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.04);
        
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.04);
        
        osc.start();
        osc.stop(ctx.currentTime + 0.04);
      }
      
      // Haptic feedback
      if (hapticEnabled && navigator.vibrate) {
        navigator.vibrate(10);
      }
    } catch (e) {
      console.warn("Audio feedback failed:", e);
    }
  }, [soundEnabled, hapticEnabled]);

  useEffect(() => {
    const handleGlobalMove = (e: MouseEvent) => {
      if (isScrolling && scrollStartRef.current) {
        const dy = e.clientY - scrollStartRef.current.y;
        const deltaMinutes = dy * 4; // Increased sensitivity (was 2)
        // Allow scrolling up to end of next day (2880 mins for 48h range)
        const newMinutes = Math.max(0, Math.min(2880, scrollStartRef.current.startMinutes + deltaMinutes));
        
        // Velocity tracking
        const nowMs = Date.now();
        const dt = nowMs - scrollStartRef.current.startTime;
        if (dt > 0) {
          scrollStartRef.current.velocity = (e.clientY - scrollStartRef.current.lastY) / dt;
          scrollStartRef.current.lastY = e.clientY;
          scrollStartRef.current.startTime = nowMs;
        }

        scrollMinutesMotion.set(newMinutes);
        
        // Feedback on every 15 minutes of "scroll"
        const currentFeedbackStep = Math.floor(newMinutes / 15);
        if (currentFeedbackStep !== Math.floor(lastFeedbackMinutesRef.current / 15)) {
          triggerFeedback();
          lastFeedbackMinutesRef.current = newMinutes;
        }
      }
    };

    const handleGlobalUp = () => {
      if (isScrolling && scrollStartRef.current) {
        setIsScrolling(false);
        
        // Always snap back to default original format (6h window)
        animate(scrollMinutesMotion, defaultScrollMinutes, {
          type: "spring",
          stiffness: 200,
          damping: 25,
          onComplete: () => {
            setScrollMinutes(defaultScrollMinutes);
            lastFeedbackMinutesRef.current = defaultScrollMinutes;
          }
        });
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (isScrolling && scrollStartRef.current && e.touches[0]) {
        if (e.cancelable) e.preventDefault();
        const dy = e.touches[0].clientY - scrollStartRef.current.y;
        const deltaMinutes = dy * 4; // Consistent with mouse (was 2)
        const newMinutes = Math.max(0, Math.min(2880, scrollStartRef.current.startMinutes + deltaMinutes));
        
        const nowMs = Date.now();
        const dt = nowMs - scrollStartRef.current.startTime;
        if (dt > 0) {
          scrollStartRef.current.velocity = (e.touches[0].clientY - scrollStartRef.current.lastY) / dt;
          scrollStartRef.current.lastY = e.touches[0].clientY;
          scrollStartRef.current.startTime = nowMs;
        }

        scrollMinutesMotion.set(newMinutes);
        
        const currentFeedbackStep = Math.floor(newMinutes / 15);
        if (currentFeedbackStep !== Math.floor(lastFeedbackMinutesRef.current / 15)) {
          triggerFeedback();
          lastFeedbackMinutesRef.current = newMinutes;
        }
      }
    };

    if (isScrolling) {
      window.addEventListener("mousemove", handleGlobalMove);
      window.addEventListener("mouseup", handleGlobalUp);
      window.addEventListener("touchmove", handleTouchMove, { passive: false });
      window.addEventListener("touchend", handleGlobalUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleGlobalMove);
      window.removeEventListener("mouseup", handleGlobalUp);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleGlobalUp);
    };
  }, [isScrolling, soundEnabled, hapticEnabled]);

  // Handle forcing re-renders for the motion-interpolated angles
  useEffect(() => {
    const unsub = summaryProgress.on("change", (v) => {
      tickerMotion.set(v);
      setTicker(t => t + 1);
    });
    return unsub;
  }, [summaryProgress, tickerMotion]);

  // Stabilized Time angle for indicator - does NOT move with scroll
  const currentTimeAngle = useMemo(() => {
    const d = startOfDay(selectedDate);
    
    // Position in Summary View (24h)
    const diffMsSummary = now.getTime() - d.getTime();
    const diffMinSummary = diffMsSummary / (1000 * 60);
    const summaryAngle = 270 + (diffMinSummary / 1440) * 360;

    // Position in Normal View (Fixed relative to the 6h frame)
    const winStart = addMinutes(d, defaultScrollMinutes);
    const diffMsNormal = now.getTime() - winStart.getTime();
    const diffMinNormal = diffMsNormal / (1000 * 60);
    const normalAngle = 90 + (diffMinNormal / 360) * 180;

    // Blend based on summaryProgress for smooth transition between fixed and summary
    const progress = summaryProgress.get();
    return normalAngle + (summaryAngle - normalAngle) * progress;
  }, [now, defaultScrollMinutes, selectedDate, ticker]); // ticker ensures reactivity during motion

  const isCurrentTimeVisible = isToday(selectedDate) && (isSummaryView || (currentTimeAngle >= 90 && currentTimeAngle <= 270));

  const getSVGPoint = (e: React.MouseEvent | React.TouchEvent) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    
    if ('touches' in e) {
      pt.x = e.touches[0].clientX;
      pt.y = e.touches[0].clientY;
    } else {
      pt.x = (e as React.MouseEvent).clientX;
      pt.y = (e as React.MouseEvent).clientY;
    }
    
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    return pt.matrixTransform(ctm.inverse());
  };

  const isOuterRing = (svgPt: { x: number; y: number }) => {
    const dist = Math.hypot(svgPt.x - centerX, svgPt.y - centerY);
    // Ring is between innerRadius (240) and outer radius (300)
    // We allow some buffer for easier interaction
    return dist >= 180 && dist <= 380;
  };

  const markers = useMemo(() => {
    const result = [];
    // 48 hours for current + next day
    for (let i = 0; i <= 576; i++) {
      const isHour = i % 12 === 0;
      const is30m = i % 6 === 0;
      const is15m = i % 3 === 0;
      const totalMinutes = i * 5;
      
      const dayOffset = Math.floor(totalMinutes / 1440);
      const hourInDay = Math.floor((totalMinutes % 1440) / 60);
      const displayHour = hourInDay === 0 ? 12 : hourInDay > 12 ? hourInDay - 12 : hourInDay;
      const ampm = hourInDay >= 12 ? "PM" : "AM";
      const dayLabel = dayOffset > 0 ? " +1d" : "";

      result.push({
        isHour,
        is30m,
        is15m,
        value: isHour ? displayHour : null,
        suffix: isHour ? ampm + dayLabel : "",
        minutes: totalMinutes
      });
    }
    return result;
  }, []);

  const visibleMarkers = useMemo(() => {
    if (isSummaryView) {
      // Simplified 24h markers: Just Every 3 or 6 hours to avoid clutter
      return [0, 6, 12, 18].map(h => {
        // We use 270 as base for summary view calculation in getTimeAngle but markers need fixed positions here too
        const angle = 270 + (h / 24) * 360;
        return {
          minutes: h * 60,
          value: h === 0 ? "12" : (h > 12 ? h - 12 : h).toString(),
          suffix: h >= 12 ? "PM" : "AM",
          isHour: true,
          is30m: false,
          is15m: false,
          angle
        };
      });
    }

    return markers.map(m => {
      const diffMin = m.minutes - effectiveWindowStartMinutes;
      const angle = 90 + (diffMin / 360) * 180;
      return { ...m, angle };
    }).filter(m => m.angle >= 80 && m.angle <= 280);
  }, [markers, effectiveWindowStartMinutes, isSummaryView]);

  const isTodayDate = isToday(selectedDate);
  const nowTime = new Date();
  
  const expandedTask = useMemo(() => {
    return tasks.find(t => t.id === expandedTaskId) || null;
  }, [tasks, expandedTaskId]);

  const isPastViewTask = useMemo(() => {
    if (!expandedTask) return false;
    return isBefore(expandedTask.endTime, nowTime);
  }, [expandedTask, nowTime]);

  const isPastViewDay = useMemo(() => {
    return isBefore(startOfDay(selectedDate), startOfDay(nowTime));
  }, [selectedDate, nowTime]);

  // Clean up selection if task is deleted
  useEffect(() => {
    if (expandedTaskId && !tasks.some(t => t.id === expandedTaskId)) {
      setExpandedTaskId(null);
    }
  }, [tasks, expandedTaskId]);

  const onTaskArcClick = (task: Task) => {
    // If it's already expanded, deselect it (toggle behavior)
    if (expandedTaskId === task.id) {
      setExpandedTaskId(null);
      return;
    }

    // Otherwise select it
    setExpandedTaskId(task.id);
  };

  return (
    <div 
      className="relative w-full h-full flex items-center justify-center overflow-visible"
      onClick={() => setExpandedTaskId(null)}
    >
      {/* Fixed Task Island at the bottom */}
      <AnimatePresence mode="wait">
        {expandedTask && (
          <motion.div
            key={`island-${expandedTask.id}`}
            initial={{ opacity: 0, y: 30, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.9 }}
            className="absolute bottom-12 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-4"
          >
            <div className="glass-card px-8 py-5 flex flex-col items-center gap-4 min-w-[300px] shadow-[0_40px_80px_rgba(0,0,0,0.3)] bg-white/30 dark:bg-zinc-900/60 backdrop-blur-[60px] border border-white/50 dark:border-white/10 rounded-[40px] relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-br from-white/30 via-transparent to-black/5 pointer-events-none" />
              
              <div className="text-center relative z-10 w-full px-2">
                <h3 className="text-xl font-serif font-black text-ink leading-tight tracking-tight mb-1">{expandedTask.title.toUpperCase()}</h3>
                <div className="flex items-center justify-center gap-2">
                   <div className={cn("w-1.5 h-1.5 rounded-full", expandedTask.completed ? "bg-green-500" : "bg-primary animate-pulse")} />
                   <p className="text-[11px] font-mono text-muted-foreground uppercase tracking-[0.25em] font-bold">
                     {format(expandedTask.startTime, "h:mm a")} — {format(expandedTask.endTime, "h:mm a")}
                   </p>
                </div>
              </div>
              
              <div className="w-full h-[1px] bg-black/5" />
              
              <div className="flex items-center gap-2 relative z-10 w-full">
                {isPastViewTask ? (
                  <div className="flex items-center justify-between w-full gap-2">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        onTaskDelete?.(expandedTask.id!);
                        setExpandedTaskId(null);
                      }}
                      className="flex-1 px-4 py-3.5 bg-red-500/10 hover:bg-red-500/20 rounded-2xl transition-all text-red-600 flex items-center justify-center gap-2.5 active:scale-95 group/btn shadow-sm"
                    >
                      <Trash2 className="w-4 h-4 group-hover/btn:scale-110 transition-transform" />
                      <span className="text-xs font-black uppercase tracking-wider">Delete</span>
                    </button>
                    
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        onTaskUpdate?.({ ...expandedTask, completed: !expandedTask.completed });
                      }}
                      className={cn(
                        "flex-1 px-4 py-3.5 hover:bg-white/60 rounded-2xl transition-all flex items-center justify-center gap-2.5 active:scale-95 group/btn shadow-sm",
                        expandedTask.completed ? "text-green-600 bg-green-50/30" : "text-ink"
                      )}
                    >
                      <Check className={cn("w-4 h-4 transition-all duration-500", expandedTask.completed ? "scale-125 rotate-[360deg] stroke-[3]" : "group-hover/btn:scale-110")} />
                      <span className="text-xs font-black uppercase tracking-wider">
                        {expandedTask.completed ? "Victory" : "Accomplish"}
                      </span>
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between w-full gap-2">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        onTaskClick(expandedTask);
                      }}
                      className="flex-1 px-4 py-3.5 hover:bg-white/60 dark:hover:bg-white/10 rounded-2xl transition-all text-ink flex items-center justify-center gap-2.5 active:scale-95 group/btn shadow-sm"
                    >
                      <Pencil className="w-4 h-4 group-hover/btn:rotate-12 transition-transform opacity-70" />
                      <span className="text-xs font-black uppercase tracking-wider">Modify</span>
                    </button>
                    
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        onTaskUpdate?.({ ...expandedTask, completed: !expandedTask.completed });
                      }}
                      className={cn(
                        "flex-1 px-4 py-3.5 hover:bg-white/60 rounded-2xl transition-all flex items-center justify-center gap-2.5 active:scale-95 group/btn shadow-sm",
                        expandedTask.completed ? "text-green-600 bg-green-50/30" : "text-ink"
                      )}
                    >
                      <Check className={cn("w-4 h-4 transition-all duration-500", expandedTask.completed ? "scale-125 rotate-[360deg] stroke-[3]" : "group-hover/btn:scale-110")} />
                      <span className="text-xs font-black uppercase tracking-wider">
                        {expandedTask.completed ? "Victory" : "Accomplish"}
                      </span>
                    </button>
                  </div>
                )}
              </div>
            </div>
            
            <button 
              onClick={() => setExpandedTaskId(null)}
              className="text-[9px] font-black uppercase tracking-[0.3em] text-ink/40 hover:text-ink/60 transition-colors bg-white/20 dark:bg-white/5 px-3 py-1.5 rounded-full border border-white/40 dark:border-white/10"
            >
              Minimize View
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <svg 
        ref={svgRef}
        viewBox="0 -80 600 880" 
        className={cn(
          "w-full h-full overflow-visible select-none touch-none",
          isSummaryView && "drop-shadow-2xl"
        )}
        onMouseDown={(e) => {
          if (isSummaryView) return;
          const pt = getSVGPoint(e);
          const isOverTask = (e.target as SVGElement).closest('g.cursor-pointer');
          if (!isOverTask && isOuterRing(pt)) {
            if (audioContextRef.current?.state === 'suspended') {
              audioContextRef.current.resume();
            }
            setIsScrolling(true);
            scrollStartRef.current = { 
              y: e.clientY, 
              lastY: e.clientY,
              startMinutes: scrollMinutesMotion.get(),
              startTime: Date.now(),
              velocity: 0
            };
          }
        }}
        onTouchStart={(e) => {
          if (isSummaryView) return;
          const pt = getSVGPoint(e);
          const isOverTask = (e.target as SVGElement).closest('g.cursor-pointer');
          if (isOverTask) return;
          
          if (isOuterRing(pt) && e.touches[0]) {
            if (audioContextRef.current?.state === 'suspended') {
              audioContextRef.current.resume();
            }
            setIsScrolling(true);
            scrollStartRef.current = { 
              y: e.touches[0].clientY, 
              lastY: e.touches[0].clientY,
              startMinutes: scrollMinutesMotion.get(),
              startTime: Date.now(),
              velocity: 0
            };
          }
        }}
        onClick={(e) => {
          // Deselect task if clicking background
          if (e.target === e.currentTarget) {
            setExpandedTaskId(null);
          }
        }}
      >
        <defs>
          <radialGradient id="discGradient" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
            <stop offset="0%" style={{ stopColor: "var(--clock-inner)" }} />
            <stop offset="100%" style={{ stopColor: "var(--clock-outer)" }} />
          </radialGradient>
          <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="15" />
            <feOffset dx="0" dy="10" result="offsetblur" />
            <feComponentTransfer>
              <feFuncA type="linear" slope="0.1" />
            </feComponentTransfer>
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

      <motion.g
        animate={{ 
          x: isSummaryView ? -200 : -50, 
          y: 0, 
          scale: isSummaryView ? 0.6 : 1
        }}
        transition={{ 
          type: "spring", 
          stiffness: 90, 
          damping: 20,
          mass: 1
        }}
      >
        {/* Outer track line */}
        <circle cx={centerX} cy={centerY} r={radius} fill="none" stroke="currentColor" strokeWidth="0.5" className="text-black/5 dark:text-white/10" />
        
        {/* Main interactive disc */}
        <motion.circle 
          cx={centerX} 
          cy={centerY} 
          animate={{ r: (isSummaryView || expandedTaskId) ? innerRadius - 20 : innerRadius }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          fill="url(#discGradient)" 
          filter="url(#shadow)" 
          onClick={handleCenterClick}
          className="cursor-pointer"
        />
        <motion.circle 
          cx={centerX} 
          cy={centerY} 
          animate={{ r: (isSummaryView || expandedTaskId) ? innerRadius - 20 : innerRadius }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          fill="none" 
          stroke="currentColor" 
          strokeWidth="1" 
          className="text-black/10 dark:text-white/20 pointer-events-none" 
        />

        {/* Icons for 24h Summary */}
        <AnimatePresence>
          {isSummaryView && (
            <motion.g
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              className="pointer-events-none"
            >
              {/* Moon at Vertically Top (Midnight - 270 deg) */}
              <g transform={`translate(${polarToCartesian(centerX, centerY, innerRadius - 130, 270).x}, ${polarToCartesian(centerX, centerY, innerRadius - 130, 270).y})`}>
                <Moon className="w-8 h-8 text-blue-400/60" x="-16" y="-16" />
              </g>
              {/* Sun at Vertically Bottom (Noon - 90 deg) */}
              <g transform={`translate(${polarToCartesian(centerX, centerY, innerRadius - 130, 90).x}, ${polarToCartesian(centerX, centerY, innerRadius - 130, 90).y})`}>
                <Sun className="w-10 h-10 text-orange-400/60" x="-20" y="-20" />
              </g>
            </motion.g>
          )}
        </AnimatePresence>

        {/* Shared Task Track Backgrounds (dynamic based on tracks used) */}
        {Array.from({ length: Math.max(3, stableTaskLayout.totalTracks) }).map((_, i) => {
          const trackRadius = (radius - 30) + (i * 60) + (trackOffsets[i] || 0);
          
          if (isSummaryView) {
            // Full circles in summary view
            return (
              <circle 
                key={`bg-track-full-${i}`}
                cx={centerX}
                cy={centerY}
                r={trackRadius}
                fill="none"
                stroke="currentColor"
                strokeWidth={44}
                className="text-black/[0.1] dark:text-white/[0.15] pointer-events-none"
              />
            );
          }

          // Calculate angles that hit the right edge (x=600)
          const dx = 600 - centerX;
          const limitAngleRad = Math.acos(Math.max(-1, Math.min(1, dx / trackRadius)));
          const limitAngleDeg = (limitAngleRad * 180) / Math.PI;
          
          // We sweep from the bottom right point around the left to the top right point
          const startBound = limitAngleDeg; // Bottom right
          const endBound = 360 - limitAngleDeg; // Top right
          
          return (
            <g key={`bg-track-${i}`}>
              <motion.path
                animate={{ d: describeArc(startBound, endBound, trackRadius) }}
                fill="none"
                stroke="currentColor"
                strokeWidth={44}
                className="text-black/[0.1] dark:text-white/[0.15] pointer-events-none"
              />
              <motion.path
                animate={{ d: describeArc(startBound, endBound, trackRadius) }}
                fill="none"
                stroke="currentColor"
                strokeWidth="0.5"
                strokeDasharray="2 4"
                className="text-black/[0.15] dark:text-white/[0.2] pointer-events-none"
              />
            </g>
          );
        })}

        {/* Detailed Ticks: 5m, 15m, 30m, and Hour labels */}
        {visibleMarkers.map((marker, i) => {
          let tickLen = 6;
          let weight = 0.5;
          let opacity = "text-black/15 dark:text-white/25";
          
          if (marker.isHour) {
            tickLen = 24;
            weight = 2;
            opacity = "text-black/40 dark:text-white/50";
          } else if (marker.is30m) {
            tickLen = 16;
            weight = 1.2;
            opacity = "text-black/30 dark:text-white/40";
          } else if (marker.is15m) {
            tickLen = 10;
            weight = 0.8;
            opacity = "text-black/20 dark:text-white/30";
          }

          const currentInnerRadius = expandedTaskId ? innerRadius - 20 : innerRadius;
          const tickOuter = polarToCartesian(centerX, centerY, currentInnerRadius, marker.angle);
          const tickInner = polarToCartesian(centerX, centerY, currentInnerRadius - tickLen, marker.angle);
          const textPos = polarToCartesian(centerX, centerY, currentInnerRadius - 60, marker.angle);
          
          return (
            <g key={`marker-${marker.minutes}`}>
              <line 
                x1={tickInner.x} 
                y1={tickInner.y} 
                x2={tickOuter.x} 
                y2={tickOuter.y} 
                stroke="currentColor" 
                strokeWidth={weight} 
                className={opacity} 
              />
              {marker.isHour && (
                <g>
                  <text 
                    x={textPos.x} 
                    y={textPos.y}
                    textAnchor="middle" 
                    dominantBaseline="middle"
                    className="text-5xl font-serif font-black fill-ink tracking-tight select-none"
                  >
                    {marker.value}
                  </text>
                  {marker.suffix && (
                    <text
                      x={textPos.x}
                      y={textPos.y + 35}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className="text-[10px] font-black fill-primary uppercase opacity-60"
                    >
                      {marker.suffix}
                    </text>
                  )}
                </g>
              )}
            </g>
          );
        })}

        {currentWindowTasks.map((task) => {
          const isHovered = hoveredTask?.id === task.id;
          
          const taskStart = task.startTime;
          const taskEnd = task.endTime;
          
          const dayStart = startOfDay(selectedDate);
          const winStartDate = addMinutes(dayStart, effectiveWindowStartMinutes);
          const winEndDate = addMinutes(winStartDate, 6 * 60);

          // For normal view, we clamp to the 6h window.
          // For summary view, we want to see the full position in 24h.
          // We pass the "clamped" vs "raw" intention through the getTimeAngle blending.
          
          const startAngle = getTimeAngle(taskStart);
          const endAngle = getTimeAngle(taskEnd);
          const splitAngle = getTimeAngle(now); 

          // Always calculate absolute past and future segments relative to 'now', regardless of window
          const isEntirelyPast = isAfter(now, taskEnd);
          const isEntirelyFuture = isBefore(now, taskStart);
          const isCurrentlyActive = !isEntirelyPast && !isEntirelyFuture;
                   const isExpanded = expandedTaskId === task.id;
          
          // Calculate track radius: Base at radius - 30, then stack outwards
          // Add offset for expanded tasks to make them "pop" outwards
          const baseRadius = (radius - 30) + (task.trackIndex * 60) + (trackOffsets[task.trackIndex] || 0);
          const trackRadius = isExpanded ? baseRadius + 8 : baseRadius;

          return (
            <motion.g 
              key={task.id}
              initial={false}
              animate={{ 
                scale: task.completed ? [1, 1.02, 1] : 1,
              }}
              transition={{ 
                duration: 0.4,
                times: [0, 0.5, 1],
                ease: "easeInOut"
              }}
              onMouseEnter={() => setHoveredTask(task)}
              onMouseLeave={() => setHoveredTask(null)}
              onClick={(e) => {
                e.stopPropagation();
                onTaskArcClick(task);
              }}
              className={cn(
                "cursor-pointer transition-none",
                expandedTaskId && !isExpanded && "opacity-10 pointer-events-none"
              )}
            >
              {/* Modern Selection Halo (Focus Ring) */}
              <AnimatePresence>
                {isExpanded && (
                  <>
                    <motion.path
                      initial={{ opacity: 0, strokeWidth: 0 }}
                      animate={{ opacity: 0.3, strokeWidth: 70 }}
                      exit={{ opacity: 0, strokeWidth: 0 }}
                      transition={{ type: "spring", stiffness: 400, damping: 35 }}
                      d={describeArc(startAngle, endAngle, trackRadius)}
                      fill="none"
                      stroke={task.color}
                      strokeLinecap="round"
                      className="pointer-events-none"
                    />
                  </>
                )}
              </AnimatePresence>

              {/* Glow for hovered or expanded task */}
              {(isHovered || isExpanded) && !isExpanded && (
                <path
                  d={describeArc(startAngle, endAngle, trackRadius)}
                  fill="none"
                  stroke={task.color}
                  strokeWidth={54}
                  className="opacity-10 blur-sm pointer-events-none"
                />
              )}
              
              {/* Primary Task Arc: Uses direct d attribute to avoid FM string interpolation issues during transitions */}
              <motion.path
                initial={false}
                animate={{ 
                  opacity: task.completed ? 0.25 : (expandedTaskId && !isExpanded ? 0.1 : 1),
                  strokeWidth: task.completed ? 40 : 44,
                }}
                transition={{ 
                  type: "spring", 
                  stiffness: 300, 
                  damping: 30,
                  opacity: { duration: 0.5 }
                }}
                d={describeArc(startAngle, endAngle, trackRadius)}
                fill="none"
                stroke={task.color}
                strokeLinecap="round"
                className="transition-none"
              />

              {/* Progress Indicator within the arc (Current Time marker) */}
              {isCurrentlyActive && !task.completed && (
                 <path
                    d={describeArc(startAngle, getTimeAngle(now), trackRadius)}
                    fill="none"
                    stroke="#fff"
                    strokeWidth={8}
                    strokeLinecap="round"
                    className="opacity-40"
                 />
              )}

              {/* Completion Visual Feedback */}
              <AnimatePresence>
                {task.completed && (
                  <g key={`completion-${task.id}`}>
                    {/* Success Pulse Bloom */}
                    <motion.path
                      initial={{ opacity: 0.8, strokeWidth: isExpanded ? 80 : 44 }}
                      animate={{ opacity: 0, strokeWidth: isExpanded ? 140 : 100 }}
                      transition={{ duration: 0.7, ease: "circOut" }}
                      d={describeArc(startAngle, endAngle, trackRadius)}
                      fill="none"
                      stroke="white"
                      strokeLinecap="round"
                      pointerEvents="none"
                      className="z-50"
                    />
                    
                    {/* Completion Flourish: Using a static path with motion animation for consistency */}
                    <motion.path
                      initial={{ pathLength: 0, opacity: 0 }}
                      animate={{ 
                        pathLength: 1, 
                        opacity: 1, 
                        strokeDashoffset: [0, -12]
                      }}
                      exit={{ opacity: 0 }}
                      transition={{ 
                        pathLength: { duration: 0.5, ease: "easeOut" },
                        strokeDashoffset: { repeat: Infinity, duration: 1, ease: "linear" }
                      }}
                      d={describeArc(startAngle, endAngle, trackRadius)}
                      fill="none"
                      stroke="rgba(255,255,255,0.7)"
                      strokeWidth={isExpanded ? 4 : 2}
                      strokeLinecap="round"
                      strokeDasharray="4 8"
                      pointerEvents="none"
                    />
                  </g>
                )}
              </AnimatePresence>
              
              {/* Task Title on path */}
              <motion.text
                 animate={{ 
                   fontSize: isExpanded ? "24px" : "18px",
                   dy: isExpanded ? "9" : "7"
                 }}
                 className="font-sans font-black fill-white pointer-events-none select-none"
              >
                 <textPath 
                   href={`#taskPath-${task.id}`} 
                   startOffset="50%" 
                   textAnchor="middle" 
                   dominantBaseline="middle"
                   spacing="auto"
                 >
                    {task.title.toUpperCase()}
                 </textPath>
              </motion.text>

              {/* Define path for textPath */}
              <defs>
                 <path 
                    id={`taskPath-${task.id}`} 
                    d={describeArc(startAngle, endAngle, trackRadius)} 
                 />
              </defs>

              {/* Task Island Removed from here and made fixed at screen bottom */}
            </motion.g>
          );
        })}

        {/* Floating Task Preview Removed in favor of Task Island */}

  // Current Time Indicator Red Marker
        {/* Removed AnimatePresence/key swap to prevent position jump during coordinate shift */}
        {isCurrentTimeVisible && !isScrolling && (
          <motion.g
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
          >
            <line
              x1={centerX}
              y1={centerY}
              x2={polarToCartesian(centerX, centerY, maxOuterRadius, currentTimeAngle).x}
              y2={polarToCartesian(centerX, centerY, maxOuterRadius, currentTimeAngle).y}
              stroke="#EF4444"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <circle 
              cx={polarToCartesian(centerX, centerY, maxOuterRadius + 8, currentTimeAngle).x}
              cy={polarToCartesian(centerX, centerY, maxOuterRadius + 8, currentTimeAngle).y}
              r="5"
              className="fill-red-500 shadow-xl"
            />
            <text 
              x={polarToCartesian(centerX, centerY, maxOuterRadius + 45, currentTimeAngle).x}
              y={polarToCartesian(centerX, centerY, maxOuterRadius + 45, currentTimeAngle).y}
              textAnchor="middle"
              className="text-base font-black font-mono fill-red-600 drop-shadow-md"
            >
              {format(now, "H:mm")}
            </text>
          </motion.g>
        )}
        
        {/* Core Center Dot */}
        <circle cx={centerX} cy={centerY} r="6" className="fill-red-500 pointer-events-none" />
      </motion.g>
    </svg>
    </div>
  );
};
