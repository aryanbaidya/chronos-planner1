import React, { useMemo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { Task } from "../services/firebase";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay } from "date-fns";

interface ReportingProps {
  tasks: Task[];
}

export const Reporting: React.FC<ReportingProps> = ({ tasks }) => {
  const categoryData = useMemo(() => {
    const counts = tasks.reduce((acc: any, task) => {
      acc[task.category] = (acc[task.category] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [tasks]);

  const completionData = useMemo(() => {
    const completed = tasks.filter(t => t.completed).length;
    const total = tasks.length;
    return [
      { name: "Completed", value: completed },
      { name: "Pending", value: total - completed }
    ];
  }, [tasks]);

  const COLORS = ["#10b981", "#ef4444", "#3b82f6", "#f59e0b"];

  return (
    <div className="flex items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Task Completion</CardTitle>
        </CardHeader>
        <CardContent className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={completionData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                paddingAngle={5}
                dataKey="value"
              >
                {completionData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={index === 0 ? "#10b981" : "var(--color-muted)"} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
};
