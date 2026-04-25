import { Task } from "./firebase";
import { format, subMinutes, isAfter, isBefore, addMinutes } from "date-fns";
import { playSound } from "../lib/sounds";

class NotificationService {
  private permission: NotificationPermission = "default";
  private notifiedTaskIds: Set<string> = new Set();

  constructor() {
    if (typeof window !== "undefined" && "Notification" in window) {
      this.permission = Notification.permission;
    }
  }

  async requestPermission() {
    if (!("Notification" in window)) return false;
    
    if (Notification.permission !== "granted" && Notification.permission !== "denied") {
      this.permission = await Notification.requestPermission();
    }
    return this.permission === "granted";
  }

  hasPermission() {
    return this.permission === "granted";
  }

  checkReminders(tasks: Task[], settings?: { sound: boolean, haptic: boolean }) {
    if (!this.hasPermission()) return;

    const now = new Date();
    // Buffer: only check tasks starting in the next 2 hours
    const futureLimit = addMinutes(now, 120);

    tasks.forEach(task => {
      // Skip if already notified or completed
      if (this.notifiedTaskIds.has(task.id!) || task.completed) return;

      // Guard against invalid date objects
      if (!(task.startTime instanceof Date) || isNaN(task.startTime.getTime())) return;

      const reminderMinutes = task.reminder || 0;
      const reminderTime = subMinutes(task.startTime, reminderMinutes);

      // If current time is past the reminder time but before the actual start time (plus a small grace period)
      // And we haven't notified yet
      if (isAfter(now, reminderTime) && isBefore(now, addMinutes(task.startTime, 1))) {
        this.sendNotification(task, settings);
      }
    });

    // Cleanup Set periodically? For now, we just keep it simple.
  }

  private sendNotification(task: Task, settings?: { sound: boolean, haptic: boolean }) {
    if (this.notifiedTaskIds.has(task.id!)) return;

    const timeStr = format(task.startTime, "h:mm a");
    const body = task.reminder && task.reminder > 0 
      ? `Starts in ${task.reminder} minutes at ${timeStr}`
      : `Starting now at ${timeStr}`;

    try {
      const notification = new Notification(`Reminder: ${task.title}`, {
        body,
        icon: "/favicon.ico", 
        silent: !settings?.sound,
      });

      notification.onclick = () => {
        window.focus();
        notification.close();
      };
      
      if (settings?.haptic && "vibrate" in navigator) {
        navigator.vibrate([200, 100, 200]);
      }
      if (settings?.sound) {
        playSound('success', true);
      }
    } catch (err) {
      console.warn("Notification failed:", err);
    }

    this.notifiedTaskIds.add(task.id!);
  }
}

export const notificationService = new NotificationService();
