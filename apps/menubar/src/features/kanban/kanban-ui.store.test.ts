import { beforeEach, describe, it } from "node:test";
import assert from "node:assert";
import { useKanbanUIStore } from "./kanban-ui.store.js";

describe("useKanbanUIStore", () => {
  beforeEach(() => {
    useKanbanUIStore.setState({
      selectedItemId: null,
      selectedCategoryIds: null,
      isDetailModalOpen: false,
    });
  });

  it("stores only selected item id, not item object", () => {
    useKanbanUIStore.getState().setSelectedItemId("item-1");
    const state = useKanbanUIStore.getState();
    assert.strictEqual(state.selectedItemId, "item-1");
    assert.strictEqual(state.isDetailModalOpen, true);
  });

  it("clears selected item id when closing detail modal", () => {
    useKanbanUIStore.getState().openDetailModal("item-2");
    useKanbanUIStore.getState().closeDetailModal();
    const state = useKanbanUIStore.getState();
    assert.strictEqual(state.selectedItemId, null);
    assert.strictEqual(state.isDetailModalOpen, false);
  });
});
