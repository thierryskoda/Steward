import { create } from "zustand";

type IKanbanUIState = {
  selectedItemId: string | null;
  /** null = show all categories; string[] = filter to those ids. */
  selectedCategoryIds: string[] | null;
  /** Whether the detail modal is open (derived from selectedItemId but can be used for animation). */
  isDetailModalOpen: boolean;
};

type IKanbanUIActions = {
  setSelectedItemId: (itemId: string | null) => void;
  setSelectedCategoryIds: (ids: string[] | null) => void;
  openDetailModal: (itemId: string) => void;
  closeDetailModal: () => void;
};

export type IKanbanUIStore = IKanbanUIState & IKanbanUIActions;

function getInitialState(): IKanbanUIState {
  return {
    selectedItemId: null,
    selectedCategoryIds: null,
    isDetailModalOpen: false,
  };
}

export const useKanbanUIStore = create<IKanbanUIStore>((set) => ({
  ...getInitialState(),
  setSelectedItemId(itemId: string | null): void {
    set({
      selectedItemId: itemId,
      isDetailModalOpen: itemId !== null,
    });
  },
  setSelectedCategoryIds(selectedCategoryIds: string[] | null): void {
    set({ selectedCategoryIds });
  },
  openDetailModal(itemId: string): void {
    set({ selectedItemId: itemId, isDetailModalOpen: true });
  },
  closeDetailModal(): void {
    set({ selectedItemId: null, isDetailModalOpen: false });
  },
}));
