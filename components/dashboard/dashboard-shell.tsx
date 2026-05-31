"use client";

import { createContext, useContext } from "react";
import { Sidebar } from "./sidebar";

type Project = { id: string; name: string };

const ProjectsContext = createContext<Project[]>([]);
export const useProjects = () => useContext(ProjectsContext);

export function DashboardShell({
  projects,
  children,
}: {
  projects: Project[];
  children: React.ReactNode;
}) {
  return (
    <ProjectsContext.Provider value={projects}>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="flex-1 p-8 min-w-0">{children}</main>
      </div>
    </ProjectsContext.Provider>
  );
}
