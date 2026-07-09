import { create } from "zustand";
import type { TabId } from "../types/types.js";

type INavigationState = {
  activeTab: TabId;
};

type INavigationActions = {
  setActiveTab: (tabId: TabId) => void;
};

export type INavigationStore = INavigationState & INavigationActions;

function getInitialState(): INavigationState {
  return {
    activeTab: "categories",
  };
}

export const useNavigationStore = create<INavigationStore>((set) => ({
  ...getInitialState(),
  setActiveTab(tabId: TabId): void {
    set({ activeTab: tabId });
  },
}));
