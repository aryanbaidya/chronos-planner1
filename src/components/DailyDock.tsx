import React, { useEffect, useRef, useMemo } from "react";
import { format, addDays, subDays, isSameDay, startOfDay } from "date-fns";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

interface DailyDockProps {
  selectedDate: Date;
  onDateSelect: (date: Date) => void;
}

export const DailyDock: React.FC<DailyDockProps> = ({ selectedDate, onDateSelect }) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  
  // Generate 61 days: 30 in past, today, 30 in future
  const days = useMemo(() => {
    const today = startOfDay(new Date());
    return Array.from({ length: 61 }, (_, i) => addDays(subDays(today, 30), i));
  }, []);

  // Auto-scroll to selected date on mount or date change
  useEffect(() => {
    const timer = setTimeout(() => {
      if (scrollContainerRef.current) {
        const selectedElement = scrollContainerRef.current.querySelector("[data-selected='true']");
        if (selectedElement) {
          selectedElement.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
        }
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [selectedDate]);

  return (
    <div 
      ref={scrollContainerRef}
      className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-white/90 dark:from-zinc-900/90 via-white/90 dark:via-zinc-900/90 to-blue-100/90 dark:to-blue-900/40 backdrop-blur-md rounded-full shadow-lg border border-white/20 dark:border-white/10 w-[240px] sm:w-[320px] overflow-x-auto no-scrollbar scroll-smooth"
    >
      {days.map((day, i) => {
        const selected = isSameDay(day, selectedDate);
        const isToday = isSameDay(day, new Date());
        
        return (
          <motion.button
            key={format(day, 'yyyy-MM-dd')}
            data-selected={selected}
            whileTap={{ scale: 0.95 }}
            onClick={() => onDateSelect(day)}
            className={cn(
              "relative flex flex-col items-center justify-center min-w-[48px] h-14 rounded-full transition-all z-10 shrink-0",
              selected ? "text-ink" : "text-muted-foreground",
              isToday && !selected && "bg-primary/5 shadow-inner"
            )}
          >
            {selected && (
              <>
                {/* Slidable highlight background: Perfectly circular to match the ring */}
                <motion.div
                  layoutId="active-date-bg"
                  className="absolute bg-white dark:bg-zinc-800 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.1)] z-[-1] border border-blue-50 dark:border-blue-900/30"
                  style={{ width: 44, height: 44, left: '50%', top: '50%', x: '-50%', y: '-50%' }}
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
                
                {/* Visual Accent: Highly visible Blue Ring using a div to avoid SVG issues */}
                <motion.div
                  layoutId="active-date-ring"
                  className="absolute border-2 border-blue-600 rounded-full z-20 pointer-events-none"
                  style={{ width: 42, height: 42, left: '50%', top: '50%', x: '-50%', y: '-50%' }}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              </>
            )}
            <span className={cn(
              "text-[9px] uppercase font-bold tracking-tighter opacity-70",
              selected && "text-ink"
            )}>
              {format(day, "EEE")}
            </span>
            <span className={cn(
              "text-lg font-bold leading-none",
              selected ? "text-ink" : "text-muted-foreground/60"
            )}>
              {format(day, "d")}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
};
