import React, { useState, useEffect, useMemo, useRef } from "react";
import { format, isSameDay, addDays, addWeeks, addMonths, isAfter, isBefore } from "date-fns";
import { Task } from "../services/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { motion, AnimatePresence, useScroll, useTransform, useMotionValue } from "motion/react";
import { Check, Repeat, Bell, X, ChevronUp, ChevronDown, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

// Wheel Sub-Picker for scrolling values
const WheelPicker = ({ 
  options, 
  value, 
  onChange, 
  itemHeight = 40 
}: { 
  options: (string | number)[], 
  value: string | number, 
  onChange: (val: any) => void,
  itemHeight?: number
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedIndex = options.indexOf(value);
  
  // Auto-scroll to selected index on mount or value change
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = selectedIndex * itemHeight;
    }
  }, [value, selectedIndex, itemHeight]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const scrollTop = e.currentTarget.scrollTop;
    const index = Math.round(scrollTop / itemHeight);
    if (options[index] !== undefined && options[index] !== value) {
      onChange(options[index]);
    }
  };

  return (
    <div 
      className="relative h-[120px] overflow-y-scroll no-scrollbar snap-y snap-mandatory select-none"
      style={{ height: itemHeight * 3 }}
      ref={containerRef}
      onScroll={handleScroll}
    >
      <div style={{ height: itemHeight }} /> {/* Padding top */}
      {options.map((opt, i) => {
        const isSelected = value === opt;
        return (
          <div 
            key={opt}
            className="snap-center flex items-center justify-center transition-all duration-200"
            style={{ height: itemHeight }}
          >
            <span className={cn(
              "font-mono font-black transition-all duration-300",
              isSelected ? "text-2xl text-ink scale-110 opacity-100" : "text-lg text-muted-foreground/30 scale-90 opacity-40 blur-[0.5px]"
            )}>
              {typeof opt === 'number' ? opt.toString().padStart(2, "0") : opt}
            </span>
          </div>
        );
      })}
      <div style={{ height: itemHeight }} /> {/* Padding bottom */}
      
      {/* Visual Overlay for boundaries */}
      <div className="absolute inset-x-0 top-[40px] h-[1px] bg-black/5 dark:bg-white/5 pointer-events-none" />
      <div className="absolute inset-x-0 bottom-[40px] h-[1px] bg-black/5 dark:bg-white/5 pointer-events-none" />
    </div>
  );
};

const ScrollTimePicker = ({ 
  label, 
  value, 
  onChange 
}: { 
  label: string, 
  value: string, 
  onChange: (val: string) => void 
}) => {
  const [h24, m] = value.split(":").map(Number);
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 || 12;

  const hours = Array.from({ length: 12 }, (_, i) => i + 1);
  const minutes = Array.from({ length: 12 }, (_, i) => i * 5); // 5m steps for better feel
  const periods = ["AM", "PM"];

  const updateTime = (newH12: number, newM: number, newPeriod: string) => {
    let h = newH12;
    if (newPeriod === "PM" && h !== 12) h += 12;
    if (newPeriod === "AM" && h === 12) h = 0;
    onChange(`${h.toString().padStart(2, "0")}:${newM.toString().padStart(2, "0")}`);
  };

  return (
    <div className="flex flex-col gap-1 flex-1">
      <span className="text-[9px] uppercase font-bold text-muted-foreground ml-1">{label}</span>
      <div className="flex items-center justify-center bg-black/5 dark:bg-white/5 px-2 rounded-3xl h-[120px] overflow-hidden relative">
        <div className="grid grid-cols-3 w-full gap-2 px-1">
          <WheelPicker 
            options={hours} 
            value={h12} 
            onChange={(h) => updateTime(h, m, ampm)} 
          />
          <WheelPicker 
            options={minutes} 
            value={Math.round(m / 5) * 5} 
            onChange={(min) => updateTime(h12, min, ampm)} 
          />
          <WheelPicker 
            options={periods} 
            value={ampm} 
            onChange={(p) => updateTime(h12, m, p)} 
          />
        </div>
        {/* Horizontal scan line / depth indicator */}
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-black/5 dark:from-white/5 via-transparent to-black/5 dark:to-white/5" />
      </div>
    </div>
  );
};

interface TaskFormProps {
  task?: Task | null;
  tasks?: Task[]; // To check for existing colors
  selectedDate: Date;
  onSave: (task: Omit<Task, "id" | "userId">) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
}

export const TaskForm: React.FC<TaskFormProps> = ({ task, tasks = [], selectedDate, onSave, onDelete, onClose }) => {
  const colors = ["#3B82F6", "#EF4444", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899", "#14B8A6"];
  
  // Find a color that is not currently in use for this day, or default to the least used
  const getDefaultColor = () => {
    const dayTasks = tasks.filter(t => isSameDay(t.startTime, selectedDate));
    const usedColors = new Set(dayTasks.map(t => t.color.toUpperCase()));
    
    // First pass: find an entirely unused color
    for (const c of colors) {
      if (!usedColors.has(c.toUpperCase())) return c;
    }
    
    // Second pass: if all used, find any that are used least frequently on THIS day
    const counts: Record<string, number> = {};
    dayTasks.forEach(t => {
      const c = t.color.toUpperCase();
      counts[c] = (counts[c] || 0) + 1;
    });
    
    let minColor = colors[0];
    let minVal = Infinity;
    for (const c of colors) {
      const val = counts[c.toUpperCase()] || 0;
      if (val < minVal) {
        minVal = val;
        minColor = c;
      }
    }
    return minColor;
  };

  // Helper to safely format dates that might be Timestamps or invalid
  const safeFormat = (date: any, formatStr: string, fallback: string = "") => {
    try {
      if (!date) return fallback;
      const d = date instanceof Date ? date : ('toDate' in date ? date.toDate() : new Date(date));
      if (isNaN(d.getTime())) return fallback;
      return format(d, formatStr);
    } catch {
      return fallback;
    }
  };

  const [title, setTitle] = useState(task?.title || "");
  const [description, setDescription] = useState(task?.description || "");
  const [startTime, setStartTime] = useState(safeFormat(task?.startTime || selectedDate, "HH:mm"));
  const [endTime, setEndTime] = useState(safeFormat(task?.endTime || selectedDate, "HH:mm"));
  const [color, setColor] = useState(task?.color || ""); // Initialized in useEffect to ensure tasks are ready
  const [tags, setTags] = useState(task?.tags?.join(", ") || "");
  const [completed, setCompleted] = useState(task?.completed || false);
  const [recurringType, setRecurringType] = useState<Task["recurring"]["type"]>(task?.recurring?.type || "none");
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(task?.recurring?.daysOfWeek || []);
  const [untilDate, setUntilDate] = useState<string>(
    task?.recurring?.until 
      ? safeFormat(task.recurring.until, "yyyy-MM-dd") 
      : safeFormat(addMonths(selectedDate, 1), "yyyy-MM-dd")
  );
  const [reminder, setReminder] = useState<number>(task?.reminder || 10);

  const isPastTask = useMemo(() => {
    if (!task) return false;
    return isBefore(task.endTime, new Date());
  }, [task]);

  // Initialize color properly
  useEffect(() => {
    if (!color) {
      setColor(task?.color || getDefaultColor());
    }
  }, [tasks, selectedDate, task]);

  // Adjust repeat count/defaults if recurring is turned on
  useEffect(() => {
    if (recurringType === "weekly" && daysOfWeek.length === 0) {
      // Default to current day's day of week
      setDaysOfWeek([selectedDate.getDay()]);
    }
  }, [recurringType, selectedDate]);

  // Logic to determine if task spans across midnight
  const isCrossDay = useMemo(() => {
    const [startH, startM] = startTime.split(":").map(Number);
    const [endH, endM] = endTime.split(":").map(Number);
    const startTotal = startH * 60 + startM;
    const endTotal = endH * 60 + endM;
    return endTotal < startTotal;
  }, [startTime, endTime]);

  const isTimeValid = useMemo(() => {
    return startTime !== endTime;
  }, [startTime, endTime]);

  const handleSave = () => {
    const start = new Date(selectedDate);
    const [startH, startM] = startTime.split(":").map(Number);
    start.setHours(startH, startM, 0, 0); // Floor to minutes

    const end = new Date(selectedDate);
    const [endH, endM] = endTime.split(":").map(Number);
    end.setHours(endH, endM, 0, 0); // Floor to minutes
    
    // If end time is before start time, it's the next day
    if (isCrossDay) {
      end.setDate(end.getDate() + 1);
    }

    const recurringConfig: Task["recurring"] = { type: recurringType };
    if (recurringType !== "none") {
      const uDate = new Date(untilDate);
      uDate.setHours(23, 59, 59);
      recurringConfig.until = uDate;
      
      if (recurringType === "weekly") {
        recurringConfig.daysOfWeek = daysOfWeek;
      }
    }

    onSave({
      title,
      description,
      startTime: start,
      endTime: end,
      color,
      tags: tags.split(",").map(t => t.trim()).filter(Boolean),
      completed,
      reminder,
      recurring: recurringConfig
    } as any);
    onClose();
  };

  const toggleDay = (day: number) => {
    setDaysOfWeek(prev => 
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort()
    );
  };

  const DAYS = [
    { label: "S", value: 0 },
    { label: "M", value: 1 },
    { label: "T", value: 2 },
    { label: "W", value: 3 },
    { label: "T", value: 4 },
    { label: "F", value: 5 },
    { label: "S", value: 6 },
  ];

  return (
    <div className="flex flex-col h-full bg-paper">
      <div className="flex items-center justify-between px-6 py-4 border-b border-black/5 dark:border-white/5">
        <button onClick={onClose} className="p-2 -ml-2 text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5 rounded-full transition-colors">
          <X className="w-5 h-5" />
        </button>
        <h2 className="text-lg font-serif font-black">{task ? "Edit Task" : "New Task"}</h2>
        <Button 
          variant="ghost" 
          onClick={handleSave} 
          disabled={!title || !isTimeValid || (recurringType === "weekly" && daysOfWeek.length === 0)}
          className="text-primary font-bold hover:bg-primary/5 rounded-full"
        >
          {task ? "Update" : "Done"}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* iOS Style Input Box */}
        <div className="space-y-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl p-4 shadow-sm border border-black/5 dark:border-white/5 space-y-4">
            <div className="space-y-1.5 px-1">
              <Label htmlFor="title" className="text-[11px] uppercase tracking-widest font-black text-muted-foreground">Task Title</Label>
              <Input 
                id="title" 
                value={title} 
                onChange={(e) => setTitle(e.target.value)} 
                placeholder="What needs to be done?"
                disabled={isPastTask}
                className="border-none bg-transparent p-0 h-auto text-xl font-serif font-black text-ink placeholder:text-muted-foreground/30 focus-visible:ring-0 disabled:opacity-50" 
              />
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-900 rounded-2xl p-4 shadow-sm border border-black/5 dark:border-white/5 space-y-4">
            <div className="flex items-center justify-between px-1">
              <Label className="text-[11px] uppercase tracking-widest font-black text-muted-foreground">Time Window</Label>
              {isCrossDay && (
                <div className="flex flex-col items-end">
                  <span className="text-[10px] text-primary font-black uppercase tracking-wider flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
                    Ends Tomorrow
                  </span>
                  <span className="text-[9px] text-muted-foreground font-bold">+1 Day</span>
                </div>
              )}
            </div>
            <div className="flex gap-4">
              <ScrollTimePicker 
                label="Start" 
                value={startTime} 
                onChange={isPastTask ? () => {} : setStartTime} 
              />
              <ScrollTimePicker 
                label="End" 
                value={endTime} 
                onChange={isPastTask ? () => {} : setEndTime} 
              />
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-900 rounded-2xl divide-y divide-black/5 dark:divide-white/5 shadow-sm border border-black/5 dark:border-white/5 overflow-hidden">
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Repeat className="w-4 h-4 text-muted-foreground" />
                  <Label className="font-bold text-sm">Recurring</Label>
                </div>
                <Select value={recurringType} onValueChange={(v: any) => setRecurringType(v)} disabled={isPastTask}>
                  <SelectTrigger className="border-none bg-black/5 dark:bg-white/5 h-8 text-xs font-bold rounded-full w-28 focus:ring-0">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Once</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <AnimatePresence>
                {recurringType !== "none" && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="space-y-4 pt-2 border-t border-black/5 overflow-hidden"
                  >
                    {recurringType === "weekly" && (
                      <div className="space-y-2">
                        <Label className="text-[10px] text-muted-foreground uppercase font-black px-1">Repeat on</Label>
                        <div className="flex justify-between gap-1">
                          {DAYS.map(day => (
                            <button
                              key={day.value}
                              onClick={() => toggleDay(day.value)}
                              className={cn(
                                "flex-1 h-9 rounded-xl text-xs font-bold transition-all",
                                daysOfWeek.includes(day.value) 
                                  ? "bg-ink dark:bg-primary text-paper dark:text-primary-foreground shadow-md scale-105" 
                                  : "bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10"
                              )}
                            >
                              {day.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-[10px] text-muted-foreground uppercase font-black px-1">End condition</Label>
                      </div>

                      <div className="flex items-center justify-between bg-black/5 dark:bg-white/5 p-3 rounded-2xl">
                        <span className="text-xs font-medium text-ink dark:text-ink/80">Until when?</span>
                        <Input 
                          type="date" 
                          value={untilDate}
                          onChange={(e) => setUntilDate(e.target.value)}
                          min={format(selectedDate, "yyyy-MM-dd")}
                          className="w-32 h-8 border-none bg-transparent text-xs font-bold focus-visible:ring-0 text-ink dark:text-ink"
                        />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Bell className="w-4 h-4 text-muted-foreground" />
                <Label className="font-bold text-sm">Reminder</Label>
              </div>
              <Select value={reminder.toString()} onValueChange={(v) => setReminder(Number(v))} disabled={isPastTask}>
                <SelectTrigger className="border-none bg-black/5 dark:bg-white/5 h-8 text-xs font-bold rounded-full w-36 focus:ring-0">
                  <SelectValue placeholder="Reminder" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">At time</SelectItem>
                  <SelectItem value="10">10m before</SelectItem>
                  <SelectItem value="15">15m before</SelectItem>
                  <SelectItem value="30">30m before</SelectItem>
                  <SelectItem value="60">1h before</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-900 rounded-2xl p-4 shadow-sm border border-black/5 dark:border-white/5 space-y-3">
            <Label className="text-[11px] uppercase tracking-widest font-black text-muted-foreground px-1">Label Color</Label>
            <div className="flex gap-3 px-1 py-2 overflow-x-auto no-scrollbar">
              {colors.map(c => (
                <button 
                  key={c} 
                  onClick={() => !isPastTask && setColor(c)}
                  className={cn(
                    "w-8 h-8 rounded-full border-2 shrink-0 transition-all",
                    color === c ? "border-ink scale-110 shadow-lg ring-2 ring-primary/10" : "border-transparent scale-100",
                    isPastTask && "opacity-50 grayscale-[0.5]"
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>

        {task && onDelete && (
          <Button 
            variant="ghost" 
            onClick={() => { onDelete(task.id!); onClose(); }}
            className="w-full text-red-500 font-bold hover:bg-red-50 dark:hover:bg-red-500/10 py-6 rounded-2xl h-auto"
          >
            Delete Task
          </Button>
        )}
      </div>
    </div>
  );
};
