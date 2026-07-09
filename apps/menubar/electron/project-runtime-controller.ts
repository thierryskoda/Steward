import {
  addProject,
  getSelectedProject,
  listProjectsWithRuntimeStatus,
  removeProject,
  selectProject,
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
    stopProject,
    getProjectCliProvider,
    setProjectCliProvider,
  };
}
