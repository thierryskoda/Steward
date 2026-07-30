import {
  addProject,
  getSelectedProject,
  listProjectsWithRuntimeStatus,
  removeProject,
  selectProject,
  startKnownProjects,
  startProject,
  stopProject,
  getProjectCliProvider,
  setProjectCliProvider,
} from "./runtime-orchestrator.js";

export type IProjectRuntimeController = {
  listProjects: typeof listProjectsWithRuntimeStatus;
  getSelectedProject: typeof getSelectedProject;
  selectProject: typeof selectProject;
  addProject: typeof addProject;
  removeProject: typeof removeProject;
  startProject: typeof startProject;
  startKnownProjects: typeof startKnownProjects;
  stopProject: typeof stopProject;
  getProjectCliProvider: typeof getProjectCliProvider;
  setProjectCliProvider: typeof setProjectCliProvider;
};

export function createProjectRuntimeController(): IProjectRuntimeController {
  return {
    listProjects: listProjectsWithRuntimeStatus,
    getSelectedProject,
    selectProject,
    addProject,
    removeProject,
    startProject,
    startKnownProjects,
    stopProject,
    getProjectCliProvider,
    setProjectCliProvider,
  };
}
